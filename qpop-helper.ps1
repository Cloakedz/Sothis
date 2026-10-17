# Sothis queue-pop helper: listens for programs flashing their taskbar button (games do this when a match is found
# while you're tabbed out) and prints "flash|<program>.exe|<window>". Reads "focus <window>" to bring a game to the front.
$ErrorActionPreference = "SilentlyContinue"
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public class SothisFlash : Form {
  [DllImport("user32.dll")] static extern bool RegisterShellHookWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool DeregisterShellHookWindow(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint RegisterWindowMessage(string s);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  uint shellMsg;

  public SothisFlash() {
    ShowInTaskbar = false; FormBorderStyle = FormBorderStyle.None; Opacity = 0;
    StartPosition = FormStartPosition.Manual; Left = -32000; Top = -32000; Width = 1; Height = 1;
    var t = new Thread(ReadInput); t.IsBackground = true; t.Start();
  }
  protected override void SetVisibleCore(bool value) {
    if (!IsHandleCreated) CreateHandle();
    base.SetVisibleCore(false);
  }
  protected override void OnHandleCreated(EventArgs e) {
    base.OnHandleCreated(e);
    shellMsg = RegisterWindowMessage("SHELLHOOK");
    RegisterShellHookWindow(Handle);
    Console.Out.WriteLine("ready|"); Console.Out.Flush();
  }
  protected override void OnHandleDestroyed(EventArgs e) { DeregisterShellHookWindow(Handle); base.OnHandleDestroyed(e); }
  protected override void WndProc(ref Message m) {
    if (shellMsg != 0 && m.Msg == (int)shellMsg && ((long)m.WParam & 0xFFFF) == 0x8006) {
      try {
        uint pid; GetWindowThreadProcessId(m.LParam, out pid);
        var p = Process.GetProcessById((int)pid);
        Console.Out.WriteLine("flash|" + p.ProcessName + ".exe|" + m.LParam.ToInt64()); Console.Out.Flush();
      } catch {}
    }
    base.WndProc(ref m);
  }
  void ReadInput() {
    string line;
    while ((line = Console.In.ReadLine()) != null) {
      var parts = line.Trim().Split(' ');
      long h;
      if (parts.Length == 2 && parts[0] == "focus" && long.TryParse(parts[1], out h)) {
        var hw = new IntPtr(h);
        try {
          BeginInvoke((Action)(() => {
            if (!IsWindow(hw)) return;
            if (IsIconic(hw)) ShowWindow(hw, 9);
            keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);   // lets Windows hand over the focus
            SetForegroundWindow(hw);
          }));
        } catch {}
      }
    }
    try { BeginInvoke((Action)(() => Application.Exit())); } catch { Environment.Exit(0); }
  }
}
"@
[System.Windows.Forms.Application]::Run((New-Object SothisFlash))
