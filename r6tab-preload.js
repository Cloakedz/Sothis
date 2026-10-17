const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("r6tab", {
  hidden: () => ipcRenderer.send("r6tab:hidden")
});
