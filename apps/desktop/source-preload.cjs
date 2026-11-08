const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('matroSource', {
  state: () => ipcRenderer.invoke('desktop:source-state'),
  connect: address => ipcRenderer.invoke('desktop:source-connect', address),
  local: () => ipcRenderer.invoke('desktop:source-local')
});
