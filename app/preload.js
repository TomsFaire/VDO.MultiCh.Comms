const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  testVdoUrl: (url) => ipcRenderer.invoke('test-vdo-url', url),
  generateQr: (text) => ipcRenderer.invoke('generate-qr', text),
  isFirstRun: () => ipcRenderer.invoke('is-first-run'),
  getBuildMeta: () => ipcRenderer.invoke('get-build-meta'),
  listAudioDevices: () => ipcRenderer.invoke('list-audio-devices'),
  startAudioCapture: (uid, nCh) => ipcRenderer.invoke('start-audio-capture', uid, nCh),
  stopAudioCapture: () => ipcRenderer.invoke('stop-audio-capture'),
  restartPlayback: () => ipcRenderer.invoke('restart-playback'),
  playTestTone: (channel, ms) => ipcRenderer.invoke('play-test-tone', channel, ms),
  connectLine: (id, url, inputChannel, outputChannel, gainOut, group) =>
    ipcRenderer.invoke('connect-line', { id, url, inputChannel, outputChannel, gainOut, group }),
  disconnectLine: (id) => ipcRenderer.invoke('disconnect-line', id),
  onAudioLevels: (cb) => ipcRenderer.on('audio-levels', (_e, data) => cb(data)),
  sendSpatialUpdate: (lineId, update) => ipcRenderer.send('spatial-update-line', lineId, update),
  onSpatialChannelUpdate: (cb) => ipcRenderer.on('spatial-channel-update', (_e, id, update) => cb(id, update)),
});
