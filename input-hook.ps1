# Sothis: watches your keyboard and mouse buttons (for the clip key and the key overlay in clips).
# Prints one line per change: "K|1|<vk>" key down, "K|0|<vk>" key up, "M|1|L" / "M|0|L" mouse buttons (L R M X1 X2), "W|1|0" wheel.
# Only button presses are seen, never what you type into which window, and nothing is saved by this script.
$ErrorActionPreference = "SilentlyContinue"
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public static class SothisHook {
  delegate IntPtr Proc(int code, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, Proc fn, IntPtr mod, uint thread);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
  static Proc kp = K, mp = M;
  static IntPtr kh, mh;
  static bool[] down = new bool[256];
  static void Out(string s) { try { Console.Out.WriteLine(s); Console.Out.Flush(); } catch { Application.Exit(); } }
  static IntPtr K(int code, IntPtr w, IntPtr l) {
    if (code >= 0) {
      int msg = w.ToInt32(), vk = Marshal.ReadInt32(l) & 255;
      bool isDown = msg == 0x100 || msg == 0x104, isUp = msg == 0x101 || msg == 0x105;
      if (isDown && !down[vk]) { down[vk] = true; Out("K|1|" + vk); }
      else if (isUp && down[vk]) { down[vk] = false; Out("K|0|" + vk); }
    }
    return CallNextHookEx(kh, code, w, l);
  }
  static IntPtr M(int code, IntPtr w, IntPtr l) {
    if (code >= 0) {
      int msg = w.ToInt32();
      switch (msg) {
        case 0x201: Out("M|1|L"); break; case 0x202: Out("M|0|L"); break;
        case 0x204: Out("M|1|R"); break; case 0x205: Out("M|0|R"); break;
        case 0x207: Out("M|1|M"); break; case 0x208: Out("M|0|M"); break;
        case 0x20B: case 0x20C: {
          int x = (Marshal.ReadInt32(l, 8) >> 16) & 0xFFFF;
          string b = x == 1 ? "X1" : "X2";
          Out("M|" + (msg == 0x20B ? "1" : "0") + "|" + b); break;
        }
        case 0x20A: Out("W|1|0"); break;
      }
    }
    return CallNextHookEx(mh, code, w, l);
  }
  public static void Run() {
    IntPtr mod = GetModuleHandle(Process.GetCurrentProcess().MainModule.ModuleName);
    kh = SetWindowsHookEx(13, kp, mod, 0);
    mh = SetWindowsHookEx(14, mp, mod, 0);
    Out("READY|" + (kh != IntPtr.Zero ? 1 : 0) + "|" + (mh != IntPtr.Zero ? 1 : 0));
    // stop when Sothis goes away (stdin closes)
    new System.Threading.Thread(() => { try { while (Console.In.ReadLine() != null) { } } catch { } Application.Exit(); }) { IsBackground = true }.Start();
    Application.Run();
  }
}
"@
[SothisHook]::Run()
