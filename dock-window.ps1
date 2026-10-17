# Sothis: docks another app's window inside a Sothis window (used for Opera GX).
#   -Parent <hwnd>            the Sothis window to put it in
#   -Exe <path> -Proc <name>  start the app (with -AppArgs) and dock the new window it opens
#   -Hwnd <hwnd>              or dock this window directly
# Then reads lines: "move x y w h", "focus", "close", "release" (give the window back to the desktop).
# Prints "embedded|<hwnd>", "noapp" and "gone".
param([long]$Parent, [string]$Exe = "", [string]$AppArgs = "", [string]$Proc = "", [long]$Hwnd = 0, [switch]$AnyWindow, [switch]$Overlay, [int]$X = 0, [int]$Y = 0, [int]$W = 800, [int]$H = 600)
$ErrorActionPreference = "SilentlyContinue"
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class SothisDock2 {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetLong(IntPtr h, int i);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] public static extern IntPtr SetLong(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool repaint);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool on);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  public static List<long> TopWindows(string cls) {
    var list = new List<long>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h) || GetWindowTextLength(h) == 0 || GetWindow(h, 4) != IntPtr.Zero) return true;   // visible, titled, not owned
      var sb = new StringBuilder(256); GetClassName(h, sb, 256);
      if (cls.Length == 0 || sb.ToString() == cls) list.Add(h.ToInt64());
      return true;
    }, IntPtr.Zero);
    return list;
  }
  public static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
  public static long OldStyle, OldEx;
  public static void Dock(IntPtr child, IntPtr parent) {
    long st = GetLong(child, -16).ToInt64(); OldStyle = st;
    st &= ~(0x00C00000L | 0x00040000L | 0x80000000L | 0x00020000L | 0x00010000L | 0x01000000L);   // no caption/frame/popup/min/max, not maximized
    st |= 0x40000000L;                                                                         // child window
    SetLong(child, -16, new IntPtr(st));
    long ex = GetLong(child, -20).ToInt64(); OldEx = ex;
    ex &= ~(0x00000001L | 0x00000200L | 0x00000100L | 0x00040000L);
    SetLong(child, -20, new IntPtr(ex));
    SetParent(child, parent);
    ShowWindow(child, 5);
  }
  public static void Release(IntPtr child) {
    SetParent(child, IntPtr.Zero);
    SetLong(child, -16, new IntPtr(OldStyle & ~0x40000000L));
    SetLong(child, -20, new IntPtr(OldEx));
    ShowWindow(child, 9); SetForegroundWindow(child);
  }
  public static void Focus(IntPtr child) {
    uint p; uint t = GetWindowThreadProcessId(child, out p), me = GetCurrentThreadId();
    AttachThreadInput(me, t, true); SetFocus(child); AttachThreadInput(me, t, false);
  }
}
"@
[void][SothisDock2]::SetProcessDpiAwarenessContext([IntPtr](-4))
function Mine([long[]]$hws) {
  if ($Proc -eq "") { return $hws }
  $out = @(); foreach ($h in $hws) { $p = Get-Process -Id ([SothisDock2]::Pid([IntPtr]$h)); if ($p -and $p.ProcessName -ieq $Proc) { $out += $h } }; return $out
}
$hw = [IntPtr]::Zero
if ($Hwnd -ne 0) { $hw = [IntPtr]$Hwnd }
else {
  if ($Exe -eq "" -or -not (Test-Path $Exe)) { [Console]::Out.WriteLine("noapp"); exit }
  $before = @(Mine ([SothisDock2]::TopWindows("Chrome_WidgetWin_1")))
  # -AnyWindow: use the app's own window (e.g. Discord's main window), bringing it up from the tray if needed
  if ($AnyWindow -and $before.Count -gt 0) { $hw = [IntPtr][long]$before[0] }
  else {
    if ($AppArgs -ne "") { Start-Process -FilePath $Exe -ArgumentList $AppArgs } else { Start-Process -FilePath $Exe }
    for ($i = 0; $i -lt 150 -and $hw -eq [IntPtr]::Zero; $i++) {
      Start-Sleep -Milliseconds 200
      $now = @(Mine ([SothisDock2]::TopWindows("Chrome_WidgetWin_1")))
      $new = if ($AnyWindow) { $now } else { @($now | Where-Object { $before -notcontains $_ }) }
      if ($new.Count -gt 0) { $hw = [IntPtr][long]$new[0] }
    }
  }
  if ($hw -eq [IntPtr]::Zero) { [Console]::Out.WriteLine("gone"); exit }
  Start-Sleep -Milliseconds 500
}
if (-not [SothisDock2]::IsWindow($hw)) { [Console]::Out.WriteLine("gone"); exit }
if ($Overlay) {
  # Overlay: the app keeps its own window (nothing is re-parented, so it can't be broken when Sothis closes);
  # Sothis just holds it on top, exactly over its page, and puts it back where it was afterwards.
  $orig = New-Object SothisDock2+RECT; [void][SothisDock2]::GetWindowRect($hw, [ref]$orig)
  if ([SothisDock2]::IsIconic($hw)) { [void][SothisDock2]::ShowWindow($hw, 9) }
  [Console]::Out.WriteLine("embedded|" + $hw.ToInt64()); [Console]::Out.Flush()
  $selfHidden = $false; $vis = $true
  $reader = [Console]::In; $task = $reader.ReadLineAsync()
  $back = { [void][SothisDock2]::SetWindowPos($hw, [IntPtr](-2), $orig.L, $orig.T, ($orig.R - $orig.L), ($orig.B - $orig.T), 0x0040); [void][SothisDock2]::ShowWindow($hw, 5) }
  while ($true) {
    if (-not [SothisDock2]::IsWindow($hw)) { [Console]::Out.WriteLine("gone"); [Console]::Out.Flush(); exit }
    $v = [SothisDock2]::IsWindowVisible($hw)
    if (-not $selfHidden -and $v -ne $vis) { $vis = $v; [Console]::Out.WriteLine($(if ($v) { "shown" } else { "hidden" })); [Console]::Out.Flush() }
    if ($task.Wait(250)) {
      $line = $task.Result
      if ($line -eq $null) { & $back; exit }
      $p = $line.Trim().Split(' ')
      if ($p[0] -eq "move" -and $p.Length -eq 5) {
        $selfHidden = $false; $vis = $true
        if ([SothisDock2]::IsIconic($hw)) { [void][SothisDock2]::ShowWindow($hw, 9) }
        [void][SothisDock2]::SetWindowPos($hw, [IntPtr](-1), [int]$p[1], [int]$p[2], [int]$p[3], [int]$p[4], 0x0040)   # topmost + show
      }
      elseif ($p[0] -eq "hide") { $selfHidden = $true; [void][SothisDock2]::SetWindowPos($hw, [IntPtr](-2), 0, 0, 0, 0, 0x0013); [void][SothisDock2]::ShowWindow($hw, 0) }
      elseif ($p[0] -eq "focus") { [void][SothisDock2]::SetForegroundWindow($hw) }
      elseif ($p[0] -eq "release") { & $back; [void][SothisDock2]::SetForegroundWindow($hw); [Console]::Out.WriteLine("released"); [Console]::Out.Flush(); exit }
      $task = $reader.ReadLineAsync()
    }
  }
}
[SothisDock2]::Dock($hw, [IntPtr]$Parent)
[void][SothisDock2]::MoveWindow($hw, $X, $Y, $W, $H, $true)
[SothisDock2]::Focus($hw)
[Console]::Out.WriteLine("embedded|" + $hw.ToInt64()); [Console]::Out.Flush()
$reader = [Console]::In
$task = $reader.ReadLineAsync()
$vis = $true
while ($true) {
  if (-not [SothisDock2]::IsWindow($hw)) { [Console]::Out.WriteLine("gone"); [Console]::Out.Flush(); exit }
  $v = [SothisDock2]::IsWindowVisible($hw)   # apps like Discord hide their window (to the tray) instead of closing
  if ($v -ne $vis) { $vis = $v; [Console]::Out.WriteLine($(if ($v) { "shown" } else { "hidden" })); [Console]::Out.Flush() }
  if ($task.Wait(250)) {
    $line = $task.Result
    if ($line -eq $null) { [SothisDock2]::Release($hw); exit }   # Sothis went away: hand the window back
    $p = $line.Trim().Split(' ')
    if ($p[0] -eq "move" -and $p.Length -eq 5) { [void][SothisDock2]::MoveWindow($hw, [int]$p[1], [int]$p[2], [int]$p[3], [int]$p[4], $true) }
    elseif ($p[0] -eq "focus") { [SothisDock2]::Focus($hw) }
    elseif ($p[0] -eq "close") { [void][SothisDock2]::PostMessage($hw, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }
    elseif ($p[0] -eq "release") { [SothisDock2]::Release($hw); [Console]::Out.WriteLine("released"); [Console]::Out.Flush(); exit }
    $task = $reader.ReadLineAsync()
  }
}
