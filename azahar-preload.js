const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("aza", {
  full: () => ipcRenderer.send("aza:full"),
  min: () => ipcRenderer.send("aza:min"),
  close: () => ipcRenderer.send("aza:close"),
  onState: cb => ipcRenderer.on("aza:state", (_e, s) => cb(s))
});
