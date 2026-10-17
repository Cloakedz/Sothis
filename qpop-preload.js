const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("qp", {
  onShow: cb => ipcRenderer.on("qp:show", (_e, d) => cb(d)),
  go: () => ipcRenderer.send("qp:go"),
  close: () => ipcRenderer.send("qp:close")
});
