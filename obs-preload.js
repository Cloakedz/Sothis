const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("obsAPI", {
  getPass: () => ipcRenderer.invoke("obs:getPass"),
  setPass: p => ipcRenderer.invoke("obs:setPass", p),
  openObs: () => ipcRenderer.invoke("obs:open"),
  close: () => ipcRenderer.send("obs:close")
});
