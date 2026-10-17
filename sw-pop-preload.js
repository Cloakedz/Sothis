const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("swPop", {
  close: () => ipcRenderer.send("swpop:close"),
  full: on => ipcRenderer.send("swpop:full", on),
  top: () => ipcRenderer.invoke("swpop:top"),
  state: () => ipcRenderer.invoke("swpop:state"),
  onFull: cb => ipcRenderer.on("swpop:isfull", (_e, on) => cb(on))
});
