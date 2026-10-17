const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("vo", {
  onState: cb => ipcRenderer.on("vo:state", (_e, s) => cb(s)),
  size: (w, h) => ipcRenderer.send("vo:size", { w, h })
});
