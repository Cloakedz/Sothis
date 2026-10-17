# Sothis: docks Azahar's window inside a Sothis window.
# Waits for Azahar (process -AzPid) to open its window, makes it a borderless child of -Parent, then
# reads "move x y w h", "focus" and "close" lines. Prints "embedded|<hwnd>" and "gone".
param([int]$AzPid, [long]$Parent, [int]$X = 0, [int]$Y = 0, [int]$W = 800, [int]$H = 600)
$ErrorActionPreference = "SilentlyContinue"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class SothisDock {
  [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetLong(IntPtr h, int i);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] public static extern IntPtr SetLong(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool repaint);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool on);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  public static void Dock(IntPtr child, IntPtr parent) {
    long st = GetLong(child, -16).ToInt64();
    st &= ~(0x00C00000L | 0x00040000L | 0x80000000L | 0x00020000L | 0x00010000L);  // no caption, frame, popup, min/max boxes
    st |= 0x40000000L;                                                             // child window
    SetLong(child, -16, new IntPtr(st));
    long ex = GetLong(child, -20).ToInt64();
    ex &= ~(0x00000001L | 0x00000200L | 0x00000100L | 0x00040000L);                // no dialog/client/window edge, no taskbar button
    SetLong(child, -20, new IntPtr(ex));
    SetParent(child, parent);
    ShowWindow(child, 5);
  }
  public static void Focus(IntPtr child) {
    uint p; uint t = GetWindowThreadProcessId(child, out p), me = GetCurrentThreadId();
    AttachThreadInput(me, t, true); SetFocus(child); AttachThreadInput(me, t, false);
  }
}
"@
[void][SothisDock]::SetProcessDpiAwarenessContext([IntPtr](-4))
$proc = Get-Process -Id $AzPid
$hw = [IntPtr]::Zero
for ($i = 0; $i -lt 150 -and $hw -eq [IntPtr]::Zero; $i++) {
  Start-Sleep -Milliseconds 200
  $proc.Refresh()
  if ($proc.HasExited) { [Console]::Out.WriteLine("gone"); exit }
  $hw = $proc.MainWindowHandle
}
if ($hw -eq [IntPtr]::Zero) { [Console]::Out.WriteLine("gone"); exit }
Start-Sleep -Milliseconds 400
[SothisDock]::Dock($hw, [IntPtr]$Parent)
[void][SothisDock]::MoveWindow($hw, $X, $Y, $W, $H, $true)
[SothisDock]::Focus($hw)
[Console]::Out.WriteLine("embedded|" + $hw.ToInt64()); [Console]::Out.Flush()
$reader = [Console]::In
$task = $reader.ReadLineAsync()
while ($true) {
  if ($proc.HasExited -or -not [SothisDock]::IsWindow($hw)) { [Console]::Out.WriteLine("gone"); [Console]::Out.Flush(); exit }
  if ($task.Wait(250)) {
    $line = $task.Result
    if ($line -eq $null) { exit }
    $p = $line.Trim().Split(' ')
    if ($p[0] -eq "move" -and $p.Length -eq 5) { [void][SothisDock]::MoveWindow($hw, [int]$p[1], [int]$p[2], [int]$p[3], [int]$p[4], $true) }
    elseif ($p[0] -eq "focus") { [SothisDock]::Focus($hw) }
    elseif ($p[0] -eq "close") { [void][SothisDock]::PostMessage($hw, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }
    $task = $reader.ReadLineAsync()
  }
}
