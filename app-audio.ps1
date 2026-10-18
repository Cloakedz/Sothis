# Sothis per-app sound for clips (Windows 10 2004 or newer).
# Records the sound of one app (Include) or everything except one app (Exclude) with Windows' own process loopback,
# and streams it to Sothis as raw 48 kHz stereo 16-bit audio with a clock stamp on every packet.
#   -Mode Include -Target Discord   -> only Discord (your friends' voices)
#   -Mode Exclude -Target Discord   -> everything except Discord (game, music...)
# Output (binary, stdout): "SOTA" + int64 wall-clock ms + int64 clock (100 ns), then packets of
#   int64 clock (100 ns) + int32 frames + frames*4 bytes of audio. Exits when the target app starts/stops so Sothis can restart it.
param([string]$Mode = "Exclude", [string]$Target = "Discord")
$ErrorActionPreference = "Stop"

Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace SothisAudio {
  [StructLayout(LayoutKind.Sequential)]
  public struct ActParams { public int ActivationType; public uint TargetProcessId; public int ProcessLoopbackMode; }

  [StructLayout(LayoutKind.Explicit)]
  public struct PropVariant {
    [FieldOffset(0)] public ushort vt;
    [FieldOffset(8)] public uint cbSize;
    [FieldOffset(16)] public IntPtr pBlobData;
  }

  [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IActivateAudioInterfaceAsyncOperation {
    void GetActivateResult(out int activateResult, [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
  }

  [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IActivateAudioInterfaceCompletionHandler {
    void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op);
  }

  [ComImport, Guid("94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAgileObject { }

  [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioClient {
    [PreserveSig] int Initialize(int shareMode, uint streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
    [PreserveSig] int GetBufferSize(out uint frames);
    [PreserveSig] int GetStreamLatency(out long latency);
    [PreserveSig] int GetCurrentPadding(out uint padding);
    [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
    [PreserveSig] int GetMixFormat(out IntPtr format);
    [PreserveSig] int GetDevicePeriod(out long def, out long min);
    [PreserveSig] int Start();
    [PreserveSig] int Stop();
    [PreserveSig] int Reset();
    [PreserveSig] int SetEventHandle(IntPtr handle);
    [PreserveSig] int GetService(ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
  }

  [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioCaptureClient {
    [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
    [PreserveSig] int ReleaseBuffer(uint frames);
    [PreserveSig] int GetNextPacketSize(out uint frames);
  }

  [ClassInterface(ClassInterfaceType.None)]
  public class Done : IActivateAudioInterfaceCompletionHandler, IAgileObject {
    public readonly ManualResetEvent Ev = new ManualResetEvent(false);
    public IActivateAudioInterfaceAsyncOperation Op;
    public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op) { Op = op; Ev.Set(); }
  }

  public static class Rec {
    [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
    static extern void ActivateAudioInterfaceAsync([MarshalAs(UnmanagedType.LPWStr)] string path, [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
      IntPtr activationParams, IActivateAudioInterfaceCompletionHandler handler, out IActivateAudioInterfaceAsyncOperation op);
    [DllImport("kernel32.dll")] static extern bool QueryPerformanceCounter(out long v);
    [DllImport("kernel32.dll")] static extern bool QueryPerformanceFrequency(out long v);

    static long Now100ns() { long c, f; QueryPerformanceCounter(out c); QueryPerformanceFrequency(out f); return (long)((double)c * 10000000.0 / f); }

    // runs until stop() says so; returns an error text or null
    public static string Run(uint pid, bool include, Func<bool> stop) {
      var p = new ActParams { ActivationType = 1, TargetProcessId = pid, ProcessLoopbackMode = include ? 0 : 1 };
      IntPtr pp = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(ActParams)));
      Marshal.StructureToPtr(p, pp, false);
      var pv = new PropVariant { vt = 65, cbSize = (uint)Marshal.SizeOf(typeof(ActParams)), pBlobData = pp };
      IntPtr ppv = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(PropVariant)));
      Marshal.StructureToPtr(pv, ppv, false);
      var done = new Done();
      IActivateAudioInterfaceAsyncOperation op;
      ActivateAudioInterfaceAsync("VAD\\Process_Loopback", typeof(IAudioClient).GUID, ppv, done, out op);
      if (!done.Ev.WaitOne(5000)) return "activation timed out";
      int hr; object o;
      done.Op.GetActivateResult(out hr, out o);
      if (hr != 0 || o == null) return "activation failed 0x" + hr.ToString("X8");
      var client = (IAudioClient)o;
      // 48 kHz, stereo, 16-bit
      IntPtr fmt = Marshal.AllocHGlobal(18);
      byte[] wf = new byte[18];
      BitConverter.GetBytes((ushort)1).CopyTo(wf, 0); BitConverter.GetBytes((ushort)2).CopyTo(wf, 2);
      BitConverter.GetBytes((uint)48000).CopyTo(wf, 4); BitConverter.GetBytes((uint)192000).CopyTo(wf, 8);
      BitConverter.GetBytes((ushort)4).CopyTo(wf, 12); BitConverter.GetBytes((ushort)16).CopyTo(wf, 14); BitConverter.GetBytes((ushort)0).CopyTo(wf, 16);
      Marshal.Copy(wf, 0, fmt, 18);
      // shared, loopback, wakes us when there's sound, convert to our format; 1 s of room so a slow moment loses nothing
      hr = client.Initialize(0, 0x00020000u | 0x00040000u | 0x80000000u | 0x08000000u, 10000000, 0, fmt, IntPtr.Zero);
      if (hr != 0) return "initialize failed 0x" + hr.ToString("X8");
      var wake = new AutoResetEvent(false);
      hr = client.SetEventHandle(wake.SafeWaitHandle.DangerousGetHandle());
      if (hr != 0) return "event failed 0x" + hr.ToString("X8");
      Guid iidCap = typeof(IAudioCaptureClient).GUID; object co;
      hr = client.GetService(ref iidCap, out co);
      if (hr != 0) return "capture client failed 0x" + hr.ToString("X8");
      var cap = (IAudioCaptureClient)co;
      var outp = Console.OpenStandardOutput();
      var hdr = new byte[20];
      // clock pairing: wall-clock ms and the audio clock, read back to back
      long q0 = Now100ns(); long w0 = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
      var first = new byte[20];
      System.Text.Encoding.ASCII.GetBytes("SOTA").CopyTo(first, 0); BitConverter.GetBytes(w0).CopyTo(first, 4); BitConverter.GetBytes(q0).CopyTo(first, 12);
      outp.Write(first, 0, 20); outp.Flush();
      hr = client.Start();
      if (hr != 0) return "start failed 0x" + hr.ToString("X8");
      byte[] buf = new byte[48000 * 4];
      while (!stop()) {
        wake.WaitOne(100);
        uint next;
        while (cap.GetNextPacketSize(out next) == 0 && next > 0) {
          IntPtr data; uint frames, flags; ulong dpos, qpos;
          if (cap.GetBuffer(out data, out frames, out flags, out dpos, out qpos) != 0) break;
          int bytes = (int)frames * 4;
          if (bytes > buf.Length) buf = new byte[bytes];
          if ((flags & 2) != 0 || data == IntPtr.Zero) Array.Clear(buf, 0, bytes); else Marshal.Copy(data, buf, 0, bytes);
          cap.ReleaseBuffer(frames);
          BitConverter.GetBytes((long)qpos).CopyTo(hdr, 0); BitConverter.GetBytes((int)frames).CopyTo(hdr, 8);
          outp.Write(hdr, 0, 12); outp.Write(buf, 0, bytes);
        }
        outp.Flush();
      }
      client.Stop();
      return null;
    }
  }
}
'@

# the app's main process (its sound comes from a child process, which the whole-tree mode covers)
function Root-Pid([string]$name) {
  $all = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match ("^" + [regex]::Escape($name) + "(PTB|Canary)?\.exe$") })
  if (-not $all.Count) { return 0 }
  $ids = @{}; foreach ($p in $all) { $ids[[uint32]$p.ProcessId] = 1 }
  $root = $all | Where-Object { -not $ids.ContainsKey([uint32]$_.ParentProcessId) } | Select-Object -First 1
  if ($root) { return [uint32]$root.ProcessId } else { return [uint32]$all[0].ProcessId }
}

$target = Root-Pid $Target
$include = $Mode -eq "Include"
if ($include -and -not $target) { [Console]::Error.WriteLine("notarget"); exit 3 }
# nothing to leave out: leave out this helper itself (it makes no sound), so it records everything
$pid0 = if ($target) { $target } else { [uint32]$PID }
$script:last = [DateTime]::UtcNow
$stop = [Func[bool]] {
  if (([DateTime]::UtcNow - $script:last).TotalSeconds -lt 10) { return $false }
  $script:last = [DateTime]::UtcNow
  # restart when the app starts or quits, so the split stays right
  return ((Root-Pid $Target) -ne $target)
}
$err = [SothisAudio.Rec]::Run([uint32]$pid0, $include, $stop)
if ($err) { [Console]::Error.WriteLine($err); exit 2 }
exit 0
