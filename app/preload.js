const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  testVdoUrl: (url) => ipcRenderer.invoke('test-vdo-url', url),
  generateQr: (text) => ipcRenderer.invoke('generate-qr', text),
  isFirstRun: () => ipcRenderer.invoke('is-first-run'),
  connectLine: (id, url) => ipcRenderer.invoke('connect-line', { id, url }),
  disconnectLine: (id) => ipcRenderer.invoke('disconnect-line', id),
});
