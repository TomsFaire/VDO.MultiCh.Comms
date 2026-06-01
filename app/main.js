const { app, BrowserWindow, WebContentsView, ipcMain, session } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const CONFIG_PATH = path.join(os.homedir(), '.vdo-multichan', 'config.json');
const SHIM_BIN = path.join(__dirname, '..', 'shim', 'target', 'release', 'shim');

const DEFAULT_CONFIG = {
  instance_name: 'default',
  vdo_base_url: 'https://vdo.ninja',
  input_device: '',
  output_device: '',
  sample_rate: 48000,
  lines: [
    { id: 0, name: 'PL1', room_key: nameKey('PL1'), input_channel: 0, output_channel: 0, gain_in: 1.0, gain_out: 1.0 },
    { id: 1, name: 'PL2', room_key: nameKey('PL2'), input_channel: 1, output_channel: 1, gain_in: 1.0, gain_out: 1.0 },
    { id: 2, name: 'PL3', room_key: nameKey('PL3'), input_channel: 2, output_channel: 2, gain_in: 1.0, gain_out: 1.0 },
    { id: 3, name: 'PL4', room_key: nameKey('PL4'), input_channel: 3, output_channel: 3, gain_in: 1.0, gain_out: 1.0 },
  ],
};

function randomKey() {
  return Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(0, 4);
}

function nameKey(name) {
  const sanitised = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return sanitised + randomKey();
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
// Map of line id → WebContentsView for active VDO.ninja connections
const lineViews = new Map();
let mainWin = null;

// Capture first-run state before loadConfig() creates the file
const FIRST_RUN = !fs.existsSync(CONFIG_PATH);

function killPortAndStartShim() {
  if (!fs.existsSync(SHIM_BIN)) {
    console.warn('Shim binary not found at', SHIM_BIN, '— audio I/O disabled');
    return;
  }
  // Kill any process already holding port 9696 before spawning the shim
  const killer = spawn('lsof', ['-ti', 'tcp:9696']);
  let pids = '';
  killer.stdout.on('data', d => { pids += d.toString(); });
  killer.on('close', () => {
    pids.trim().split('\n').filter(Boolean).forEach(pid => {
      try { process.kill(parseInt(pid), 'SIGTERM'); } catch (_) {}
    });
    // Small delay to let the port release
    setTimeout(() => {
      shimProcess = spawn(SHIM_BIN, [], { stdio: 'inherit' });
      shimProcess.on('exit', code => console.log('Shim exited with code', code));
    }, 300);
  });
}

app.whenReady().then(() => {
  // Grant mic + camera permission for all web contents (renderer + VDO.ninja views)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'microphone' || permission === 'camera');
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return permission === 'media' || permission === 'microphone' || permission === 'camera';
  });

  // FIRST_RUN was captured at module load, before loadConfig() created the file
  ipcMain.handle('is-first-run', () => FIRST_RUN);

  const config = loadConfig();
  killPortAndStartShim();

  mainWin = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
    title: 'VDO.MultiCh.Comms',
  });

  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Connect a line: create a WebContentsView that loads VDO.ninja as a real browser tab
  ipcMain.handle('connect-line', (_, { id, url }) => {
    if (lineViews.has(id)) return; // already connected

    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
      },
    });

    // 0×0 at position 0,0 — invisible but fully active (WebRTC runs normally)
    mainWin.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

    view.webContents.loadURL(url);
    lineViews.set(id, view);
    console.log(`Line ${id} connected: ${url}`);
  });

  // Disconnect a line: destroy the WebContentsView
  ipcMain.handle('disconnect-line', (_, id) => {
    const view = lineViews.get(id);
    if (!view) return;
    mainWin.contentView.removeChildView(view);
    view.webContents.close();
    lineViews.delete(id);
    console.log(`Line ${id} disconnected`);
  });

  // IPC handlers
  ipcMain.handle('generate-qr', async (_, text) => {
    const QRCode = require('qrcode');
    return QRCode.toDataURL(text, { width: 120, margin: 1 });
  });
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
