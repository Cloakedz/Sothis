# Sothis: every few seconds, print the titles of open windows that mention Crunchyroll (one JSON line per check),
# so Sothis can show what you're watching in your Discord status. Reads window titles only.
$ErrorActionPreference = "SilentlyContinue"
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class SothisCr {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static string[] Titles() {
    var list = new List<string>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      var t = sb.ToString();
      if (t.IndexOf("crunchyroll", StringComparison.OrdinalIgnoreCase) >= 0) list.Add(t);
      return true;
    }, IntPtr.Zero);
    return list.ToArray();
  }
}
"@
while ($true) {
  $t = [SothisCr]::Titles()
  Write-Output (ConvertTo-Json -Compress -InputObject @($t))
  Start-Sleep -Seconds 10
}
