const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("toastAPI", {
  done: () => ipcRenderer.send("toast:done"),
  click: () => ipcRenderer.send("toast:click")
});
