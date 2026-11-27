const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("roundsSettings", {
  scan: () => ipcRenderer.invoke("settings:scan"),
  save: (patch) => ipcRenderer.invoke("settings:save", patch),
  identity: (id) => ipcRenderer.invoke("settings:identity", id),
  usage: (id) => ipcRenderer.invoke("settings:usage", id),
  general: (patch) => ipcRenderer.invoke("settings:general", patch)
});
