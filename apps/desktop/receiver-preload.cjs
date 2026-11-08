const { contextBridge, ipcRenderer } = require('electron');
// Remote pages receive window chrome controls only, never local library/file IPC.
contextBridge.exposeInMainWorld('matroDesktop', {
  window: action => ipcRenderer.invoke('receiver:window', action),
  chooseSource: () => ipcRenderer.invoke('receiver:source'),
  fullscreen: () => ipcRenderer.invoke('receiver:fullscreen'),
  onFullscreen: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('receiver:fullscreen-changed', listener);
    return () => ipcRenderer.removeListener('receiver:fullscreen-changed', listener);
  }
});
