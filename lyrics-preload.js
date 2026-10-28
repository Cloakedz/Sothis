// The pop-out lyrics window: gets the song, its lines and the playback position from Sothis.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("ly", {
  onState: cb => ipcRenderer.on("lyrics:state", (_e, d) => cb(d)),
  onTop: cb => ipcRenderer.on("lyrics:top", (_e, v) => cb(v)),
  top: () => ipcRenderer.invoke("lyrics:top"),
  win: what => ipcRenderer.send("lyrics:win", what)
});
