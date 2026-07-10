const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getInfo: (url) => ipcRenderer.invoke('get-info', url),
  download: (opts) => ipcRenderer.invoke('download', opts),
  cancel: () => ipcRenderer.invoke('cancel'),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  openFolder: (folder) => ipcRenderer.invoke('open-folder', folder),
  getDefaultFolder: () => ipcRenderer.invoke('get-default-folder'),
  getWaveform: (opts) => ipcRenderer.invoke('waveform', opts),
  onProgress: (cb) => ipcRenderer.on('progress', (e, p) => cb(p)),
  onLog: (cb) => ipcRenderer.on('log', (e, line) => cb(line)),
  onPhase: (cb) => ipcRenderer.on('phase', (e, phase) => cb(phase)),
  onEta: (cb) => ipcRenderer.on('eta', (e, eta) => cb(eta)),

  downloadUpdate: () => ipcRenderer.invoke('update-download'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (e, version) => cb(version)),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (e, percent) => cb(percent)),
  onUpdateReady: (cb) => ipcRenderer.on('update-ready', () => cb()),
  onUpdateError: (cb) => ipcRenderer.on('update-error', (e, message) => cb(message)),

  onMainError: (cb) => ipcRenderer.on('main-error', (e, message) => cb(message))
});
