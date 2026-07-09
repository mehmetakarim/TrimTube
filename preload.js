const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getInfo: (url) => ipcRenderer.invoke('get-info', url),
  download: (opts) => ipcRenderer.invoke('download', opts),
  cancel: () => ipcRenderer.invoke('cancel'),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  openFolder: (folder) => ipcRenderer.invoke('open-folder', folder),
  getDefaultFolder: () => ipcRenderer.invoke('get-default-folder'),
  onProgress: (cb) => ipcRenderer.on('progress', (e, p) => cb(p)),
  onLog: (cb) => ipcRenderer.on('log', (e, line) => cb(line)),
  onPhase: (cb) => ipcRenderer.on('phase', (e, phase) => cb(phase))
});
