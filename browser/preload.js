const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("sb", {
  min: () => ipcRenderer.send("win:min"), max: () => ipcRenderer.send("win:max"), close: () => ipcRenderer.send("win:close"), full: on => ipcRenderer.send("win:full", on),
  onWin: cb => ipcRenderer.on("win:state", (_e, s) => cb(s)),
  cfg: () => ipcRenderer.invoke("cfg:get"), setCfg: o => ipcRenderer.invoke("cfg:set", o),
  adCount: id => ipcRenderer.invoke("ad:count", id),
  onBlocked: cb => ipcRenderer.on("web:blocked", (_e, d) => cb(d)),
  onOpen: cb => ipcRenderer.on("web:open", (_e, d) => cb(d)),
  onPopup: cb => ipcRenderer.on("web:popup", (_e, d) => cb(d)),
  onKey: cb => ipcRenderer.on("web:key", (_e, k) => cb(k)),
  onDl: cb => ipcRenderer.on("dl:update", (_e, d) => cb(d)),
  dlOpen: f => ipcRenderer.invoke("dl:open", f), dlShow: f => ipcRenderer.invoke("dl:show", f), dlFolder: () => ipcRenderer.invoke("dl:folder"),
  clearData: () => ipcRenderer.invoke("data:clear"),
  importBookmarks: which => ipcRenderer.invoke("import:bookmarks", which),
  external: u => ipcRenderer.send("open-external", u),
  defaultOpen: () => ipcRenderer.invoke("default:open"), isDefault: () => ipcRenderer.invoke("default:is"), startUrl: () => ipcRenderer.invoke("start:url"),
  updGet: () => ipcRenderer.invoke("upd:get"), updCheck: () => ipcRenderer.invoke("upd:check"), onUpd: cb => ipcRenderer.on("upd:ready", (_e, d) => cb(d)), restart: () => ipcRenderer.send("upd:restart")
});
