const { app, BrowserWindow, BrowserView, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const CONFIG_PATH = path.join(os.homedir(), '.vdo-multichan', 'config.json');
const SHIM_BIN = path.join(__dirname, '..', 'shim', 'target', 'release', 'shim');

const DEFAULT_CONFIG = {
  instance_name: 'default',
  vdo_base_url: 'https://vdo.ninja',
  audio_device: '',
  sample_rate: 48000,
  lines: [
    { id: 0, name: 'PL1', room_key: 'pl1-' + randomKey(), input_channel: 0, output_channel: 0, gain_in: 1.0, gain_out: 1.0 },
    { id: 1, name: 'PL2', room_key: 'pl2-' + randomKey(), input_channel: 1, output_channel: 1, gain_in: 1.0, gain_out: 1.0 },
    { id: 2, name: 'PL3', room_key: 'pl3-' + randomKey(), input_channel: 2, output_channel: 2, gain_in: 1.0, gain_out: 1.0 },
    { id: 3, name: 'PL4', room_key: 'pl4-' + randomKey(), input_channel: 3, output_channel: 3, gain_in: 1.0, gain_out: 1.0 },
  ],
};

function randomKey() {
  return Math.random().toString(36).slice(2, 8);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

let shimProcess = null;

function startShim() {
  if (!fs.existsSync(SHIM_BIN)) {
    console.warn('Shim binary not found at', SHIM_BIN, '— audio I/O disabled');
    return;
  }
  shimProcess = spawn(SHIM_BIN, [], { stdio: 'inherit' });
  shimProcess.on('exit', (code) => {
    console.log('Shim exited with code', code);
  });
}

app.whenReady().then(() => {
  const config = loadConfig();
  startShim();

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
    title: 'VDO.MultiCh.Comms',
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // IPC handlers
  ipcMain.handle('get-config', () => loadConfig());
  ipcMain.handle('save-config', (_, cfg) => { saveConfig(cfg); return true; });
  ipcMain.handle('test-vdo-url', async (_, url) => {
    try {
      const { net } = require('electron');
      const req = net.request(url);
      return await new Promise((resolve) => {
        req.on('response', (res) => resolve({ ok: res.statusCode < 400, status: res.statusCode }));
        req.on('error', (e) => resolve({ ok: false, error: e.message }));
        req.end();
      });
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
});

app.on('window-all-closed', () => {
  if (shimProcess) shimProcess.kill();
  app.quit();
});
