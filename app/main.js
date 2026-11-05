const { app, BrowserWindow, WebContentsView, ipcMain, session, shell, systemPreferences, net, powerSaveBlocker } = require('electron');

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();

const path = require('path');
const fs = require('fs');
const os = require('os');
const { buildPushUrl, buildJoinUrl, buildDirectorUrl } = require('./shared/urls');

const nativeAddonPath = app.isPackaged
  ? path.join(process.resourcesPath, 'coreaudio.node')
  : path.join(__dirname, 'native/build/Release/coreaudio.node');
const coreAudio = require(nativeAddonPath);

const CONFIG_PATH = path.join(os.homedir(), '.vdo-multichan', 'config.json');

function buildLineShim(inputChannel, outputChannel, gainOut, stripIceServers) {
  return `
(function() {
  const INPUT_CH = ${inputChannel};
  const OUTPUT_CH = ${outputChannel};
  let GAIN_OUT = ${gainOut};
  const STRIP_ICE = ${stripIceServers ? 'true' : 'false'};
  const SAMPLE_RATE = 48000;
  const ipc = require('electron').ipcRenderer;

  window.alert = (message) => { ipc.send('line-alert', String(message)); };
  window.confirm = (message) => { ipc.send('line-alert', String(message)); return true; };
  window.prompt = (message) => { ipc.send('line-alert', String(message)); return null; };

  setInterval(() => ipc.send('line-heartbeat'), 5000);
  ipc.on('gain-out', (_e, gain) => { GAIN_OUT = gain; });

  let _resolveStream;
  const _streamPromise = new Promise(r => { _resolveStream = r; });

  const _origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async function(constraints) {
    if (constraints && constraints.audio) {
      const stream = await _streamPromise;
      if (stream) return stream;
    }
    return _origGUM(constraints);
  };

  function stripIceConfig(config) {
    if (!STRIP_ICE || !config || typeof config !== 'object') return config;
    return { ...config, iceServers: [] };
  }

  const _OrigPC = window.RTCPeerConnection;
  window.RTCPeerConnection = class PatchedPC extends _OrigPC {
    constructor(config, ...rest) {
      super(stripIceConfig(config), ...rest);
    }
    setConfiguration(config) {
      return super.setConfiguration(stripIceConfig(config));
    }
  };

  (async function initPublishShim() {
    try {
      const { ipcRenderer } = require('electron');
      const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
      await audioCtx.resume();

      const processorSrc = \`
        class ShimProcessor extends AudioWorkletProcessor {
          constructor() {
            super();
            const CAP = 96000;
            this._buf = new Float32Array(CAP);
            this._head = 0;
            this._tail = 0;
            this._size = 0;
            this._cap = CAP;
            this._ready = false;
            this.port.onmessage = (e) => {
              const data = e.data;
              for (let i = 0; i < data.length; i++) {
                if (this._size < this._cap) {
                  this._buf[this._tail] = data[i];
                  this._tail = (this._tail + 1) % this._cap;
                  this._size++;
                }
              }
              if (!this._ready && this._size >= 960) this._ready = true;
            };
          }
          process(inputs, outputs) {
            const out = outputs[0][0];
            if (!this._ready) { out.fill(0); return true; }
            for (let i = 0; i < out.length; i++) {
              if (this._size > 0) {
                out[i] = this._buf[this._head];
                this._head = (this._head + 1) % this._cap;
                this._size--;
              } else out[i] = 0;
            }
            return true;
          }
        }
        registerProcessor('shim-proc', ShimProcessor);
      \`;
      const blobUrl = URL.createObjectURL(new Blob([processorSrc], { type: 'application/javascript' }));
      await audioCtx.audioWorklet.addModule(blobUrl);
      URL.revokeObjectURL(blobUrl);

      const node = new AudioWorkletNode(audioCtx, 'shim-proc', { outputChannelCount: [1] });
      const dest = audioCtx.createMediaStreamDestination();
      node.connect(dest);

      ipcRenderer.on('audio-frame', (_e, ch, samples) => {
        if (ch === INPUT_CH) node.port.postMessage(samples);
      });

      await audioCtx.resume();
      console.log('[shim-bridge] push ready in ch', INPUT_CH);
      _resolveStream(dest.stream);
    } catch (err) {
      console.error('[shim-bridge] push init failed:', err.message);
      _resolveStream(null);
    }
  })();

  (async function initRemoteTap() {
    try {
      const { ipcRenderer } = require('electron');
      const tapCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
      await tapCtx.audioWorklet.addModule(URL.createObjectURL(new Blob([\`
        class RemoteCapture extends AudioWorkletProcessor {
          constructor() {
            super();
            this._flush = 480;
            this._acc = new Float32Array(this._flush);
            this._pos = 0;
          }
          _emit() {
            if (this._pos <= 0) return;
            this.port.postMessage(this._acc.slice(0, this._pos));
            this._acc = new Float32Array(this._flush);
            this._pos = 0;
          }
          process(inputs) {
            const ch0 = inputs[0] && inputs[0][0];
            if (!ch0 || !ch0.length) return true;
            let off = 0;
            while (off < ch0.length) {
              const n = Math.min(this._flush - this._pos, ch0.length - off);
              this._acc.set(ch0.subarray(off, off + n), this._pos);
              this._pos += n;
              off += n;
              if (this._pos >= this._flush) this._emit();
            }
            return true;
          }
        }
        registerProcessor('remote-cap', RemoteCapture);
      \`], { type: 'application/javascript' })));
      await tapCtx.resume();

      const taps = new Map();
      let batchCount = 0;
      const SILENCE_PEAK = 0.002;
      const seenElements = new WeakSet();

      const cap = new AudioWorkletNode(tapCtx, 'remote-cap', {
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      const mute = tapCtx.createGain();
      mute.gain.value = 0;
      cap.connect(mute);
      mute.connect(tapCtx.destination);

      function sendSamples(samples) {
        let peak = 0;
        for (let i = 0; i < samples.length; i++) {
          const a = Math.abs(samples[i]);
          if (a > peak) peak = a;
        }
        if (peak < SILENCE_PEAK) return;
        ipcRenderer.send('playback-frame', OUTPUT_CH, samples, GAIN_OUT);
        batchCount++;
        if (batchCount === 1 || batchCount % 500 === 0) {
          console.log('[remote-tap] batch', batchCount, '→ out ch', OUTPUT_CH, 'tracks', taps.size, 'peak', peak.toFixed(4));
        }
      }

      cap.port.onmessage = (e) => {
        const data = e.data;
        if (data && data.length) sendSamples(data);
      };

      function untapTrack(track) {
        const src = taps.get(track);
        if (!src) return;
        try { src.disconnect(); } catch (_) {}
        taps.delete(track);
        if (taps.size === 0) ipcRenderer.send('clear-playback', OUTPUT_CH);
        console.log('[remote-tap] detached track', track.id || track.label, 'remaining', taps.size);
      }

      function isLocalPreview(el) {
        if (!el) return true;
        const hint = ((el.id || '') + ' ' + (el.className || '') + ' ' + (el.getAttribute('data-label') || '')).toLowerCase();
        if (/local|self|preview|mirror|director|own|publish/.test(hint)) return true;
        if (el.dataset && el.dataset.local === 'true') return true;
        return false;
      }

      function tapTrack(track) {
        if (!track || track.kind !== 'audio' || track.readyState !== 'live' || taps.has(track)) return;
        try {
          const src = tapCtx.createMediaStreamSource(new MediaStream([track]));
          src.connect(cap);
          taps.set(track, src);
          track.addEventListener('ended', () => untapTrack(track));
          console.log('[remote-tap] attached track', track.id || track.label, '→ out ch', OUTPUT_CH, 'tracks', taps.size);
        } catch (err) {
          console.warn('[remote-tap] failed:', err.message);
        }
      }

      function maybeTapElement(el) {
        if (!el || !el.srcObject || isLocalPreview(el)) return;
        if (el.paused && el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
        if (el.srcObject.getAudioTracks) el.srcObject.getAudioTracks().forEach(tapTrack);
      }

      // Silence vdo.ninja's own media elements so remote audio can't leak out of
      // the system default output. The tap reads the MediaStreamTrack directly,
      // so muting the element does not affect it.
      function silenceElement(el) {
        if (!el) return;
        el.muted = true;
        el.volume = 0;
      }

      function watchElement(el) {
        if (!el || seenElements.has(el)) return;
        seenElements.add(el);
        silenceElement(el);
        el.addEventListener('playing', () => { silenceElement(el); maybeTapElement(el); });
        if (el.srcObject) maybeTapElement(el);
      }

      new MutationObserver((muts) => {
        for (const m of muts) {
          for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.matches && node.matches('video,audio')) watchElement(node);
            if (node.querySelectorAll) node.querySelectorAll('video,audio').forEach(watchElement);
          }
        }
      }).observe(document.documentElement, { childList: true, subtree: true });

      document.querySelectorAll('video,audio').forEach(watchElement);
      setInterval(() => {
        document.querySelectorAll('video,audio').forEach(silenceElement);
        document.querySelectorAll('video,audio').forEach(maybeTapElement);
      }, 3000);
    } catch (err) {
      console.error('[remote-tap] init failed:', err.message);
    }
  })();
})();
`;
}

const DEFAULT_CONFIG = {
  configured: false,
  comms_room: '',
  comms_password: '',
  vdo_base_url: 'https://vdo.ninja',
  box_name: '',
  location: '',
  input_device_uid: '',
  input_device_name: '',
  output_device_uid: '',
  output_device_name: '',
  input_channel: 0,
  output_channel: 0,
  gain_out: 1.0,
  input_channels_override: null,
  output_channels_override: null,
  network_mode: 'internet',
  turn: { host: '', port: '', username: '', credential: '' },
  roomcap: null,
  auth: { mode: 'password' },
};

function freshConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function loadConfig() {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    const cfg = freshConfig();
    saveConfig(cfg);
    return cfg;
  }
  const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (Array.isArray(parsed.lines)) {
    fs.renameSync(CONFIG_PATH, `${CONFIG_PATH}.bak`);
    const cfg = freshConfig();
    saveConfig(cfg);
    return cfg;
  }
  const defaults = freshConfig();
  return {
    ...defaults,
    ...parsed,
    turn: { ...defaults.turn, ...parsed.turn },
    auth: { ...defaults.auth, ...parsed.auth },
  };
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

const SHIM_PATH = path.join(app.getPath('temp'), 'shim-line.js');

const BACKOFF_MIN_MS = 2000;
const BACKOFF_MAX_MS = 60000;
const HEARTBEAT_STALE_MS = 20000;
const CONNECT_GRACE_MS = 30000;
const HEALTHY_RESET_MS = 60000;
const HEALTH_CHECK_MS = 5000;
const DEVICE_RETRY_MS = 10000;
const ONLINE_POLL_MS = 10000;

const RESTART_KEYS = [
  'comms_room', 'comms_password', 'vdo_base_url', 'box_name', 'location',
  'input_device_uid', 'input_device_name', 'output_device_uid', 'output_device_name',
  'input_channel', 'output_channel', 'input_channels_override', 'output_channels_override',
  'network_mode', 'turn', 'roomcap', 'auth',
];

let lineView = null;
let linePushUrl = null;
let lineInputChannel = 0;
let lineOutputChannel = 0;
let mainWin = null;
let isQuitting = false;
let playbackFrameCount = 0;

// Live level meters: running peaks, sent to the renderer at ~30 fps and decayed
// each frame (0.85^30 ≈ 1% after ~1s).
let capturePeak = 0;
let playbackPeak = 0;
const LEVEL_DECAY = 0.85;
const LEVEL_INTERVAL_MS = 33;

const lineState = { status: 'disconnected', detail: '', alert: '' };
let reconnectTimer = null;
let deviceTimer = null;
let healthTimer = null;
let powerBlockerId = null;
let backoffMs = BACKOFF_MIN_MS;
let connectedAt = 0;
let lastHeartbeat = 0;
let healthySince = 0;
let authFailed = false;

function setLineState(patch) {
  const next = { ...lineState, ...patch };
  if (JSON.stringify(next) === JSON.stringify(lineState)) return;
  Object.assign(lineState, next);
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('line-status', lineState);
}

function setLineStatus(status, detail = '') {
  setLineState({ status, detail });
}

function sameLocation(a, b) {
  const trim = (p) => p.replace(/\/$/, '');
  return a.origin === b.origin && trim(a.pathname) === trim(b.pathname);
}

function scheduleReconnect(reason) {
  if (reconnectTimer || !lineView) return;
  const delay = authFailed ? BACKOFF_MAX_MS : backoffMs;
  console.warn(`Line reconnect in ${delay}ms: ${reason}`);
  healthySince = 0;
  if (!authFailed) setLineStatus('reconnecting', reason);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    disconnectLine();
    connectLine();
  }, delay);
  backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
}

function checkLineHealth() {
  if (!lineView || reconnectTimer || authFailed) return;
  const now = Date.now();
  if (now - connectedAt > CONNECT_GRACE_MS && now - lastHeartbeat > HEARTBEAT_STALE_MS) {
    scheduleReconnect('No heartbeat from line page');
    return;
  }
  if (healthySince && now - healthySince >= HEALTHY_RESET_MS) {
    backoffMs = BACKOFF_MIN_MS;
    setLineState({ alert: '' });
  }
}

function onLineNavigated(view, url) {
  if (lineView !== view || !linePushUrl) return;
  let target;
  try { target = new URL(url); } catch { return; }
  if (sameLocation(target, new URL(linePushUrl))) {
    if (authFailed) {
      authFailed = false;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      setLineStatus('connecting');
    }
    return;
  }
  authFailed = true;
  console.warn(`Line navigated away from push URL: ${target.origin}${target.pathname}`);
  setLineStatus('auth-failed', `Redirected to ${target.host}`);
  scheduleReconnect('auth');
}

function createLineView(preloadPath, url) {
  const lineSes = session.fromPartition('persist:line');
  lineSes.setPreloads([preloadPath]);
  lineSes.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'microphone');
  });
  lineSes.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'media' || permission === 'microphone';
  });

  const view = new WebContentsView({
    webPreferences: {
      session: lineSes,
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });

  const wc = view.webContents;
  wc.setAudioMuted(true);
  wc.on('did-fail-load', (_e, errorCode, desc, _url, isMainFrame) => {
    if (lineView === view && isMainFrame && errorCode !== -3) scheduleReconnect(`Load failed: ${desc}`);
  });
  wc.on('render-process-gone', (_e, details) => {
    if (lineView === view) scheduleReconnect(`Line page crashed: ${details.reason}`);
  });
  wc.on('unresponsive', () => {
    if (lineView === view) scheduleReconnect('Line page unresponsive');
  });
  wc.on('did-navigate', (_e, navUrl) => onLineNavigated(view, navUrl));
  mainWin.contentView.addChildView(view);
  view.setBounds({ x: -400, y: -400, width: 320, height: 240 });
  wc.loadURL(url);
  return view;
}

function connectLine() {
  if (lineView) return;
  const cfg = loadConfig();
  if (!cfg.configured || !cfg.comms_room || !cfg.box_name) return;

  lineInputChannel = cfg.input_channel;
  lineOutputChannel = cfg.output_channel;
  const stripIce = cfg.network_mode === 'lan';
  fs.writeFileSync(SHIM_PATH, buildLineShim(cfg.input_channel, cfg.output_channel, cfg.gain_out, stripIce));

  authFailed = false;
  connectedAt = Date.now();
  lastHeartbeat = 0;
  healthySince = 0;
  setLineStatus('connecting');
  linePushUrl = buildPushUrl(cfg);
  lineView = createLineView(SHIM_PATH, linePushUrl);
  powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  healthTimer = setInterval(checkLineHealth, HEALTH_CHECK_MS);
  console.log(`Line in ch${cfg.input_channel} → out ch${cfg.output_channel} lan=${stripIce}`);
  console.log(`  url: ${linePushUrl}`);
}

function disconnectLine() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  clearInterval(healthTimer);
  healthTimer = null;
  if (powerBlockerId !== null) {
    powerSaveBlocker.stop(powerBlockerId);
    powerBlockerId = null;
  }
  if (!lineView) return;
  const view = lineView;
  lineView = null;
  linePushUrl = null;
  if (mainWin && !mainWin.isDestroyed()) mainWin.contentView.removeChildView(view);
  view.webContents.close();
  try { fs.unlinkSync(SHIM_PATH); } catch (_) {}
  try { coreAudio.clearPlaybackChannel(lineOutputChannel, 'default'); } catch (_) {}
  console.log('Line disconnected');
}

function captureCallback(ch, samples) {
  if (ch !== lineInputChannel) return;
  let p = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > p) p = a;
  }
  if (p > capturePeak) capturePeak = p;
  if (!lineView) return;
  const wc = lineView.webContents;
  if (!wc.isDestroyed()) wc.send('audio-frame', ch, samples);
}

let captureFrameCount = 0;

function captureCallbackLogged(ch, samples) {
  captureCallback(ch, samples);
  captureFrameCount++;
  if (captureFrameCount === 1 || captureFrameCount % 2000 === 0) {
    console.log(`capture-frame #${captureFrameCount} ch${ch} (${samples.length} samples)`);
  }
}

function findDevice(devs, uid, name, channelKey) {
  const pool = devs.filter((d) => d[channelKey] > 0);
  const byUid = uid && pool.find((d) => d.uid === uid);
  if (byUid) return byUid;
  if (!name) return null;
  const lower = name.toLowerCase();
  return pool.find((d) => d.name === name) || pool.find((d) => d.name.toLowerCase().includes(lower)) || null;
}

function resolveAudioDevices(cfg) {
  const devs = coreAudio.listDevices();
  const missing = [];
  const resolve = (label, uid, name, channelKey) => {
    if (!uid && !name) return null;
    const dev = findDevice(devs, uid, name, channelKey);
    if (!dev) {
      missing.push(`${label} "${name || uid}"`);
      console.error(`${label} device not found (uid=${uid || '-'} name=${name || '-'})`);
      return null;
    }
    if (dev.uid !== uid) {
      console.warn(`${label} device UID changed; matched by name "${dev.name}" (${uid || '-'} → ${dev.uid})`);
    }
    return dev;
  };
  return {
    inDev: resolve('Input', cfg.input_device_uid, cfg.input_device_name, 'inChannels'),
    outDev: resolve('Output', cfg.output_device_uid, cfg.output_device_name, 'outChannels'),
    missing,
  };
}

function startAudio(cfg) {
  if (process.platform !== 'darwin') return { ok: true };
  try {
    const { inDev, outDev, missing } = resolveAudioDevices(cfg);
    if (missing.length) return { ok: false, missing };
    const capUid = inDev?.uid || '';
    const pbUid = outDev?.uid || '';
    const nIn = inDev?.inChannels || 4;
    const nOut = cfg.output_channels_override || outDev?.outChannels || 4;

    coreAudio.startAudio(capUid, nIn, pbUid, nOut, captureCallbackLogged);
    const duplex = capUid && pbUid && capUid === pbUid;
    console.log(`Audio started: cap=${capUid || 'off'} pb=${pbUid || 'off'} duplex=${duplex} (device @ 48 kHz expected)`);
    return { ok: true };
  } catch (e) {
    console.error('Audio start failed:', e.message);
    return { ok: false, error: e.message };
  }
}

function startLine() {
  clearTimeout(deviceTimer);
  deviceTimer = null;
  const cfg = loadConfig();
  if (!cfg.configured) {
    setLineStatus('disconnected');
    return;
  }
  lineInputChannel = cfg.input_channel;
  lineOutputChannel = cfg.output_channel;
  const audio = startAudio(cfg);
  if (!audio.ok) {
    const detail = audio.missing
      ? `Audio device not found: ${audio.missing.join(', ')}`
      : `Audio start failed: ${audio.error}`;
    setLineStatus('device-missing', detail);
    deviceTimer = setTimeout(startLine, DEVICE_RETRY_MS);
    return;
  }
  connectLine();
}

function restartLine() {
  disconnectLine();
  backoffMs = BACKOFF_MIN_MS;
  startLine();
}

function showMainWindow() {
  if (!mainWin || mainWin.isDestroyed()) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

function createMainWindow(title, show) {
  mainWin = new BrowserWindow({
    width: 1200,
    height: 800,
    show,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      backgroundThrottling: false,
    },
    title,
  });
  mainWin.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    mainWin.hide();
  });
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function startLevelMeters() {
  setInterval(() => {
    const levels = { capture: capturePeak, playback: playbackPeak };
    capturePeak *= LEVEL_DECAY;
    playbackPeak *= LEVEL_DECAY;
    if (mainWin && !mainWin.isDestroyed() && mainWin.isVisible()) {
      mainWin.webContents.send('audio-levels', levels);
    }
  }, LEVEL_INTERVAL_MS);
}

function watchNetworkAndPower() {
  const { powerMonitor } = require('electron');
  powerMonitor.on('resume', () => scheduleReconnect('System resumed from sleep'));
  let wasOnline = net.isOnline();
  setInterval(() => {
    const online = net.isOnline();
    if (online && !wasOnline) scheduleReconnect('Network back online');
    wasOnline = online;
  }, ONLINE_POLL_MS);
}

function needsRestart(prev, next) {
  return RESTART_KEYS.some((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]));
}

app.on('second-instance', showMainWindow);
app.on('activate', showMainWindow);
app.on('before-quit', () => { isQuitting = true; });

if (hasInstanceLock) app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'microphone' || permission === 'camera');
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return permission === 'media' || permission === 'microphone' || permission === 'camera';
  });

  ipcMain.handle('is-first-run', () => !loadConfig().configured);

  const buildMeta = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'build-meta.json'), 'utf8')); }
    catch { return { version: '0.0.1', build: 0 }; }
  })();
  ipcMain.handle('get-build-meta', () => buildMeta);

  const windowTitle = `VDO.MultiCh.Comms v${buildMeta.version} build ${buildMeta.build}`;

  if (process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('microphone').then(granted => {
      console.log('Microphone TCC permission:', granted ? 'granted' : 'denied');
    });
  }

  createMainWindow(windowTitle, !loadConfig().configured);

  ipcMain.handle('reconnect-line', () => {
    restartLine();
    return lineState;
  });
  ipcMain.handle('get-line-status', () => lineState);
  ipcMain.on('line-heartbeat', (e) => {
    if (!lineView || e.sender !== lineView.webContents || authFailed || reconnectTimer) return;
    lastHeartbeat = Date.now();
    if (!healthySince) healthySince = lastHeartbeat;
    setLineStatus('connected');
  });
  ipcMain.on('line-alert', (e, message) => {
    if (!lineView || e.sender !== lineView.webContents) return;
    console.warn(`Line page alert: ${message}`);
    setLineState({ alert: String(message) });
    scheduleReconnect(`Line page alert: ${message}`);
  });
  ipcMain.handle('get-links', () => {
    const current = loadConfig();
    if (!current.comms_room) return { join: '', director: '' };
    return { join: buildJoinUrl(current), director: buildDirectorUrl(current) };
  });

  ipcMain.handle('list-audio-devices', () => coreAudio.listDevices());

  ipcMain.on('clear-playback', (_e, outCh) => {
    try {
      coreAudio.clearPlaybackChannel(outCh ?? 0, 'default');
    } catch (err) {
      console.error('clear-playback error:', err.message);
    }
  });

  ipcMain.on('playback-frame', (_e, outCh, samples, gain) => {
    try {
      let floats = samples;
      if (Buffer.isBuffer(samples)) {
        floats = new Float32Array(samples.buffer, samples.byteOffset, samples.byteLength / 4);
      } else if (Array.isArray(samples)) {
        floats = Float32Array.from(samples);
      } else if (samples && samples.buffer && samples.byteLength) {
        floats = new Float32Array(samples.buffer, samples.byteOffset || 0, (samples.byteLength || samples.length * 4) / 4);
      }
      if (!floats || !floats.length) return;
      let peak = 0;
      for (let i = 0; i < floats.length; i++) {
        const a = Math.abs(floats[i]);
        if (a > peak) peak = a;
      }
      if (peak < 0.002) return;
      if (peak > playbackPeak) playbackPeak = peak;
      coreAudio.pushPlaybackSamples('default', outCh, floats, gain ?? 1.0);
      playbackFrameCount++;
      if (playbackFrameCount === 1 || playbackFrameCount % 500 === 0) {
        console.log(`playback-frame batch #${playbackFrameCount} → out ch ${outCh} (${floats.length} samples, peak=${peak.toFixed(4)})`);
      }
    } catch (err) {
      console.error('playback-frame error:', err.message);
    }
  });

  ipcMain.handle('play-test-tone', (_e, channel, ms) => {
    try {
      coreAudio.playTestTone(channel ?? 0, ms ?? 500);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('generate-qr', async (_, text) => {
    const QRCode = require('qrcode');
    return QRCode.toDataURL(text, { width: 120, margin: 1 });
  });
  ipcMain.handle('get-config', () => loadConfig());
  ipcMain.handle('save-config', (_, cfg) => {
    const prev = loadConfig();
    saveConfig(cfg);
    if (cfg.configured && (!prev.configured || needsRestart(prev, cfg))) {
      restartLine();
    } else if (lineView && prev.gain_out !== cfg.gain_out) {
      lineView.webContents.send('gain-out', cfg.gain_out);
    }
    return true;
  });
  ipcMain.handle('test-vdo-url', async (_, url) => {
    try {
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

  startLevelMeters();
  watchNetworkAndPower();
  startLine();
});

app.on('will-quit', () => {
  disconnectLine();
  try { coreAudio.stopAudio(); } catch (_) {}
});
