const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  testVdoUrl: (url) => ipcRenderer.invoke('test-vdo-url', url),
  generateQr: (text) => ipcRenderer.invoke('generate-qr', text),
  isFirstRun: () => ipcRenderer.invoke('is-first-run'),
  getBuildMeta: () => ipcRenderer.invoke('get-build-meta'),
  listAudioDevices: () => ipcRenderer.invoke('list-audio-devices'),
  playTestTone: (channel, ms) => ipcRenderer.invoke('play-test-tone', channel, ms),
  reconnectLine: () => ipcRenderer.invoke('reconnect-line'),
  getLineStatus: () => ipcRenderer.invoke('get-line-status'),
  getLinks: () => ipcRenderer.invoke('get-links'),
  onAudioLevels: (cb) => ipcRenderer.on('audio-levels', (_e, levels) => cb(levels)),
  onLineStatus: (cb) => ipcRenderer.on('line-status', (_e, state) => cb(state)),
});
