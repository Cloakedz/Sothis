# Sothis: keep the Watch windows (Edge app windows for Netflix, Prime Video, Hulu, Crunchyroll) above other windows, or let them go.
param([string]$Match = "", [int]$On = 1)
$ErrorActionPreference = "SilentlyContinue"
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
public static class SothisTop {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  public static int Apply(string match, bool on) {
    var re = new Regex(match, RegexOptions.IgnoreCase); int n = 0;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      var t = sb.ToString(); if (t.Length == 0 || !re.IsMatch(t)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      try { var p = Process.GetProcessById((int)pid); if (!p.ProcessName.Equals("msedge", StringComparison.OrdinalIgnoreCase) && !p.ProcessName.Equals("chrome", StringComparison.OrdinalIgnoreCase)) return true; } catch { return true; }
      SetWindowPos(h, new IntPtr(on ? -1 : -2), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);
      n++; return true;
    }, IntPtr.Zero);
    return n;
  }
}
"@
if ($Match) { [Console]::Out.WriteLine([SothisTop]::Apply($Match, $On -eq 1)) }
