# Sothis volume mixer helper: per-app volume through Windows' own audio sessions.
# Reads one command per line on stdin, answers one JSON line on stdout:
#   list                 -> [{"name":..,"pids":[..],"vol":0..1,"mute":bool,"path":..}]
#   set <0..1> <name>    -> {"ok":true}
#   mute <0|1> <name>    -> {"ok":true}
$ErrorActionPreference = "SilentlyContinue"
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace SothisAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCo {}

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  }

  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    int GetAudioSessionControl(IntPtr a, int b, out IntPtr c);
    int GetSimpleAudioVolume(IntPtr a, int b, out IntPtr c);
    int GetSessionEnumerator(out IAudioSessionEnumerator e);
  }

  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    int GetCount(out int count);
    int GetSession(int index, out IAudioSessionControl2 session);
  }

  [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    int GetState(out int state);
    int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    int SetDisplayName(IntPtr a, IntPtr b);
    int GetIconPath(IntPtr a);
    int SetIconPath(IntPtr a, IntPtr b);
    int GetGroupingParam(IntPtr a);
    int SetGroupingParam(IntPtr a, IntPtr b);
    int RegisterAudioSessionNotification(IntPtr a);
    int UnregisterAudioSessionNotification(IntPtr a);
    int GetSessionIdentifier(IntPtr a);
    int GetSessionInstanceIdentifier(IntPtr a);
    int GetProcessId(out uint pid);
    int IsSystemSoundsSession();
  }

  [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume {
    int SetMasterVolume(float level, ref Guid ctx);
    int GetMasterVolume(out float level);
    int SetMute(bool mute, ref Guid ctx);
    int GetMute(out bool mute);
  }

  public static class Mixer {
    class Sess { public string Name; public uint Pid; public ISimpleAudioVolume Vol; public string Path; }

    static List<Sess> Sessions() {
      var list = new List<Sess>();
      var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCo();
      IMMDevice dev;
      if (en.GetDefaultAudioEndpoint(0, 1, out dev) != 0 || dev == null) return list;
      var iid = typeof(IAudioSessionManager2).GUID;
      object o;
      dev.Activate(ref iid, 23, IntPtr.Zero, out o);
      var mgr = (IAudioSessionManager2)o;
      IAudioSessionEnumerator se;
      mgr.GetSessionEnumerator(out se);
      int n; se.GetCount(out n);
      for (int i = 0; i < n; i++) {
        IAudioSessionControl2 c; se.GetSession(i, out c);
        if (c == null) continue;
        int state; c.GetState(out state);
        if (state == 2) continue;                       // expired
        uint pid; c.GetProcessId(out pid);
        var s = new Sess { Pid = pid, Vol = (ISimpleAudioVolume)c };
        if (pid == 0) { s.Name = "System sounds"; }
        else {
          try { var p = Process.GetProcessById((int)pid); s.Name = p.ProcessName; try { s.Path = p.MainModule.FileName; } catch {} }
          catch { continue; }
        }
        list.Add(s);
      }
      return list;
    }

    static string Esc(string s) {
      if (s == null) return "";
      var b = new StringBuilder();
      foreach (var ch in s) {
        if (ch == '"' || ch == '\\') b.Append('\\').Append(ch);
        else if (ch < 32) b.AppendFormat("\\u{0:x4}", (int)ch);
        else b.Append(ch);
      }
      return b.ToString();
    }

    public static string List() {
      var groups = new Dictionary<string, List<Sess>>(StringComparer.OrdinalIgnoreCase);
      var order = new List<string>();
      foreach (var s in Sessions()) {
        if (!groups.ContainsKey(s.Name)) { groups[s.Name] = new List<Sess>(); order.Add(s.Name); }
        groups[s.Name].Add(s);
      }
      var sb = new StringBuilder("[");
      bool first = true;
      foreach (var name in order) {
        var g = groups[name];
        float v = 1; bool m = false;
        g[0].Vol.GetMasterVolume(out v); g[0].Vol.GetMute(out m);
        string path = null; var pids = new List<string>();
        foreach (var s in g) { pids.Add(s.Pid.ToString()); if (path == null) path = s.Path; }
        if (!first) sb.Append(",");
        first = false;
        sb.AppendFormat(System.Globalization.CultureInfo.InvariantCulture,
          "{{\"name\":\"{0}\",\"pids\":[{1}],\"vol\":{2:0.###},\"mute\":{3},\"path\":\"{4}\"}}",
          Esc(name), string.Join(",", pids), v, m ? "true" : "false", Esc(path));
      }
      return sb.Append("]").ToString();
    }

    public static int Set(string name, float v) {
      int hit = 0; var ctx = Guid.Empty;
      foreach (var s in Sessions()) if (string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase)) { s.Vol.SetMasterVolume(Math.Max(0, Math.Min(1, v)), ref ctx); hit++; }
      return hit;
    }
    public static int Mute(string name, bool m) {
      int hit = 0; var ctx = Guid.Empty;
      foreach (var s in Sessions()) if (string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase)) { s.Vol.SetMute(m, ref ctx); hit++; }
      return hit;
    }
  }
}
"@

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $parts = $line.Trim() -split " ", 3
  try {
    switch ($parts[0]) {
      "list" { [Console]::Out.WriteLine([SothisAudio.Mixer]::List()) }
      "set"  { $n = [SothisAudio.Mixer]::Set($parts[2], [float]::Parse($parts[1], [Globalization.CultureInfo]::InvariantCulture)); [Console]::Out.WriteLine("{""ok"":true,""hit"":$n}") }
      "mute" { $n = [SothisAudio.Mixer]::Mute($parts[2], $parts[1] -eq "1"); [Console]::Out.WriteLine("{""ok"":true,""hit"":$n}") }
      default { [Console]::Out.WriteLine("{""ok"":false}") }
    }
  } catch { [Console]::Out.WriteLine("{""ok"":false,""err"":""" + ($_.Exception.Message -replace '"', "'") + """}") }
  [Console]::Out.Flush()
}
