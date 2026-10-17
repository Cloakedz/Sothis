const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("emuHost", {
  onClosing: cb => ipcRenderer.on("emu:closing", () => cb()),
  saved: () => ipcRenderer.send("emu:saved")
});
