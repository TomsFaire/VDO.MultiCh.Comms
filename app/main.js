const { app, BrowserWindow, WebContentsView, webContents, ipcMain, session, shell, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// CoreAudio addon is macOS-only and not used for v1 spatial binaural output
// (which routes through Web Audio AudioContext.destination instead).
// Optional require so the app starts on Linux/Pi without a native build.
let coreAudio = null;
try {
  const nativeAddonPath = app.isPackaged
    ? path.join(process.resourcesPath, 'coreaudio.node')
    : path.join(__dirname, 'native/build/Release/coreaudio.node');
  coreAudio = require(nativeAddonPath);
} catch (_) {
  console.log('[audio] CoreAudio addon unavailable — running in Web Audio only mode');
}

const CONFIG_PATH = path.join(os.homedir(), '.vdo-multichan', 'config.json');

function buildLineShim(inputChannel, outputChannel, gainOut, groupName, stripIceServers, inputDeviceId, useWebGum) {
  const groupLiteral = JSON.stringify(String(groupName || ''));
  const deviceIdLiteral = JSON.stringify(inputDeviceId || '');
  return `
(function() {
  const INPUT_CH = ${inputChannel};
  const OUTPUT_CH = ${outputChannel};
  const GAIN_OUT = ${gainOut};
  const GROUP = ${groupLiteral};
  const STRIP_ICE = ${stripIceServers ? 'true' : 'false'};
  const SAMPLE_RATE = 48000;
  const USE_WEB_GUM = ${useWebGum ? 'true' : 'false'};
  const GUM_DEVICE_ID = ${deviceIdLiteral};

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

      if (USE_WEB_GUM) {
        // CoreAudio unavailable — capture mic directly via getUserMedia + channel splitter
        const constraints = { audio: {
          ...(GUM_DEVICE_ID ? { deviceId: { exact: GUM_DEVICE_ID } } : {}),
          channelCount: { ideal: INPUT_CH + 1 },
          sampleRate: SAMPLE_RATE,
          echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        }};
        try {
          const micStream = await _origGUM(constraints);
          const micCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
          const src = micCtx.createMediaStreamSource(micStream);
          const numCh = micStream.getAudioTracks()[0]?.getSettings()?.channelCount || 1;
          const dest = micCtx.createMediaStreamDestination();
          if (INPUT_CH > 0 && numCh > INPUT_CH) {
            const splitter = micCtx.createChannelSplitter(numCh);
            const merger = micCtx.createChannelMerger(1);
            src.connect(splitter);
            splitter.connect(merger, INPUT_CH, 0);
            merger.connect(dest);
          } else {
            src.connect(dest);
          }
          console.log('[shim-bridge] Web GUM ready device=' + (GUM_DEVICE_ID || 'default') + ' ch=' + INPUT_CH + '/' + numCh);
          _resolveStream(dest.stream);
        } catch (e) {
          console.error('[shim-bridge] Web GUM failed:', e.message);
          _resolveStream(null);
        }
        return;
      }

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

      let activeNodes = null;
      let activeTrack = null;
      let batchCount = 0;
      const SILENCE_PEAK = 0.002;
      const seenElements = new WeakSet();

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
          console.log('[remote-tap] batch', batchCount, '→ out ch', OUTPUT_CH, 'group', GROUP, 'peak', peak.toFixed(4));
        }
      }

      function teardownActiveTap() {
        if (!activeNodes) return;
        try {
          activeNodes.src.disconnect();
          activeNodes.cap.disconnect();
          activeNodes.mute.disconnect();
        } catch (_) {}
        activeNodes = null;
        activeTrack = null;
        ipcRenderer.send('clear-playback', OUTPUT_CH);
      }

      function isLocalPreview(el) {
        if (!el) return true;
        const hint = ((el.id || '') + ' ' + (el.className || '') + ' ' + (el.getAttribute('data-label') || '')).toLowerCase();
        if (/local|self|preview|mirror|director|own|publish/.test(hint)) return true;
        if (el.dataset && el.dataset.local === 'true') return true;
        return false;
      }

      function tapTrack(track) {
        if (!track || track.kind !== 'audio' || track.readyState === 'ended') return;
        if (activeTrack === track) return;
        teardownActiveTap();
        activeTrack = track;
        try {
          const src = tapCtx.createMediaStreamSource(new MediaStream([track]));
          const cap = new AudioWorkletNode(tapCtx, 'remote-cap');
          cap.port.onmessage = (e) => {
            const data = e.data;
            if (data && data.length) sendSamples(data);
          };
          const mute = tapCtx.createGain();
          mute.gain.value = 0;
          src.connect(cap);
          cap.connect(mute);
          mute.connect(tapCtx.destination);
          activeNodes = { src, cap, mute, track };
          track.addEventListener('ended', () => {
            if (activeTrack === track) teardownActiveTap();
          });
          console.log('[remote-tap] attached track', track.id || track.label, '→ out ch', OUTPUT_CH, 'group', GROUP);
        } catch (err) {
          console.warn('[remote-tap] failed:', err.message);
        }
      }

      function tapStreamFromDom(stream) {
        if (!stream || !stream.getAudioTracks) return;
        for (const t of stream.getAudioTracks()) {
          if (t.kind === 'audio' && t.readyState === 'live') {
            tapTrack(t);
            return;
          }
        }
      }

      function maybeTapElement(el) {
        if (!el || !el.srcObject || isLocalPreview(el)) return;
        if (activeTrack && activeTrack.readyState === 'live') return;
        if (el.paused && el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
        tapStreamFromDom(el.srcObject);
      }

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
        if (activeTrack && activeTrack.readyState === 'live') return;
        document.querySelectorAll('video,audio').forEach(maybeTapElement);
      }, 3000);
    } catch (err) {
      console.error('[remote-tap] init failed:', err.message);
    }
  })();
})();
`;
}

function sanitiseKey(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function groupFromName(name, fallbackId) {
  const g = sanitiseKey(name);
  return g || `pl${fallbackId + 1}`;
}

const DEFAULT_CONFIG = {
  instance_name: 'default',
  comms_room: 'default',
  comms_password: '',
  vdo_base_url: 'https://vdo.whatadickmove.com',
  input_device: '',
  output_device: '',
  input_device_uid: '',
  output_device_uid: '',
  sample_rate: 48000,
  outputMode: 'classic',
  spatialOutputDeviceId: '',   // empty string = system default device
  spatialOutputChannels: 2,    // 2 = stereo, 6 = 5.1
  webrtc_turn_off: false,
  webrtc_stun_only: false,
  webrtc_lan_mode: false,
  room_locked: false,
  lock_password: '',
  controlApiPort: 8080,
  lines: [
    { id: 0, name: 'PL1', group: '1', input_channel: 0, output_channel: 0, gain_in: 1.0, gain_out: 1.0, input_device_uid: null, output_device_uid: null },
    { id: 1, name: 'PL2', group: '2', input_channel: 1, output_channel: 1, gain_in: 1.0, gain_out: 1.0, input_device_uid: null, output_device_uid: null },
    { id: 2, name: 'PL3', group: '3', input_channel: 2, output_channel: 2, gain_in: 1.0, gain_out: 1.0, input_device_uid: null, output_device_uid: null },
    { id: 3, name: 'PL4', group: '4', input_channel: 3, output_channel: 3, gain_in: 1.0, gain_out: 1.0, input_device_uid: null, output_device_uid: null },
  ],
};

function migrateConfig(cfg) {
  if (!cfg.comms_room) {
    if (cfg.instance_name && cfg.instance_name !== 'default') {
      cfg.comms_room = sanitiseKey(cfg.instance_name);
    } else if (cfg.lines?.[0]?.room_key) {
      const keys = cfg.lines.map((l) => l.room_key).filter(Boolean);
      let prefix = keys[0] || 'default';
      for (const key of keys) {
        let i = 0;
        while (i < prefix.length && i < key.length && prefix[i] === key[i]) i++;
        prefix = prefix.slice(0, i);
      }
      cfg.comms_room = prefix || keys[0] || 'default';
    } else {
      cfg.comms_room = 'default';
    }
  }
  if (cfg.comms_password == null) cfg.comms_password = '';
  if (cfg.outputMode == null) cfg.outputMode = 'classic';
  if (cfg.spatialOutputDeviceId == null) cfg.spatialOutputDeviceId = '';
  if (cfg.spatialOutputChannels == null) cfg.spatialOutputChannels = 2;
  if (cfg.webrtc_turn_off == null)  cfg.webrtc_turn_off = false;
  if (cfg.webrtc_stun_only == null) cfg.webrtc_stun_only = false;
  if (cfg.webrtc_lan_mode == null)  cfg.webrtc_lan_mode = false;
  if (cfg.room_locked == null)      cfg.room_locked = false;
  if (cfg.lock_password == null)    cfg.lock_password = '';
  if (cfg.controlApiPort == null)   cfg.controlApiPort = 8080;
  for (const line of cfg.lines || []) {
    if (!line.group) {
      if (line.room_key && cfg.comms_room && line.room_key.startsWith(cfg.comms_room)) {
        line.group = line.room_key.slice(cfg.comms_room.length) || groupFromName(line.name, line.id);
      } else if (line.room_key) {
        line.group = sanitiseKey(line.room_key);
      } else {
        line.group = groupFromName(line.name, line.id);
      }
    }
    if (line.input_device_uid === undefined) line.input_device_uid = null;
    if (line.output_device_uid === undefined) line.output_device_uid = null;
  }
  return cfg;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
  const cfg = migrateConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
  saveConfig(cfg);
  return cfg;
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// Map of line id → WebContentsView for active VDO.ninja connections
const lineViews = new Map();
// Track connect args so lines can be reconnected if needed
const lineConfigs = new Map(); // id → { url, channelId }
const channelViews = new Map(); // channelId -> WebContents ID
const sessionViews = new Map(); // lineId (number) → webContentsId — for lines with own device session
let mainWin = null;
let captureActive = false;
let playbackFrameCount = 0;

const capturePeaks = new Map();   // ch (0-indexed) → running peak float
const playbackPeaks = new Map();  // ch (0-indexed) → running peak float
const LEVEL_DECAY = 0.85;         // applied each 33ms frame; ~1s to silence

// Live gain cache — keyed by channel/lineId, updated on config load/save
const inputGainByChannel = new Map();  // input_channel → gain_in
const outputGainByLineId = new Map();  // lineId → gain_out

function updateGainCache(cfg) {
  inputGainByChannel.clear();
  outputGainByLineId.clear();
  for (const line of cfg.lines || []) {
    inputGainByChannel.set(line.input_channel, line.gain_in ?? 1.0);
    outputGainByLineId.set(line.id, line.gain_out ?? 1.0);
  }
}

function captureCallback(ch, samples) {
  const wcId = channelViews.get(ch);
  if (wcId == null) return;
  const gain = inputGainByChannel.get(ch) ?? 1.0;
  let toSend = samples;
  let p = 0;
  if (gain !== 1.0) {
    toSend = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      toSend[i] = samples[i] * gain;
      const a = Math.abs(toSend[i]);
      if (a > p) p = a;
    }
  } else {
    for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > p) p = a; }
  }
  capturePeaks.set(ch, Math.max(capturePeaks.get(ch) || 0, p));
  const wc = webContents.fromId(wcId);
  if (wc && !wc.isDestroyed()) {
    wc.send('audio-frame', ch, toSend);
  }
}

let captureFrameCount = 0;

function captureCallbackLogged(ch, samples) {
  captureCallback(ch, samples);
  captureFrameCount++;
  if (captureFrameCount === 1 || captureFrameCount % 2000 === 0) {
    console.log(`capture-frame #${captureFrameCount} ch${ch} (${samples.length} samples)`);
  }
}

function startUnifiedAudio(cfg, withCapture) {
  if (process.platform !== 'darwin') return { ok: true };
  try {
    const devs = coreAudio.listDevices();
    const capUid = withCapture ? (cfg.input_device_uid || '') : '';
    const pbUid = cfg.output_device_uid || '';
    const inDev = devs.find((d) => d.uid === capUid);
    const outDev = devs.find((d) => d.uid === pbUid);
    const nIn = inDev?.inChannels || 4;
    const nOut = cfg.output_channels_override || outDev?.outChannels || 4;

    coreAudio.startAudio(capUid, nIn, pbUid, nOut, captureCallbackLogged);
    const duplex = capUid && pbUid && capUid === pbUid;
    console.log(`Audio started: cap=${capUid || 'off'} pb=${pbUid || 'off'} duplex=${duplex} (device @ 48 kHz expected)`);
    return { ok: true, duplex };
  } catch (e) {
    console.error('Audio start failed:', e.message);
    return { ok: false, error: e.message };
  }
}

function applyAudioFromConfig(cfg) {
  startUnifiedAudio(cfg, captureActive);
}

// Capture first-run state before loadConfig() creates the file
const FIRST_RUN = !fs.existsSync(CONFIG_PATH);

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

  const buildMeta = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'build-meta.json'), 'utf8')); }
    catch { return { version: '0.0.1', build: 0 }; }
  })();
  ipcMain.handle('get-build-meta', () => buildMeta);

  const windowTitle = `VDO.MultiCh.Comms v${buildMeta.version} build ${buildMeta.build}`;

  // Request macOS TCC microphone permission — without this getUserMedia returns
  // a muted track on macOS even when Electron's own permission handler says yes.
  if (process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('microphone').then(granted => {
      console.log('Microphone TCC permission:', granted ? 'granted' : 'denied');
    });
  }

  const cfg = loadConfig();
  updateGainCache(cfg);
  applyAudioFromConfig(cfg);

  mainWin = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1200,
    minHeight: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
    title: windowTitle,
  });

  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  const controlApi = require('./spatial/controlApi');

  function getSpatialState() {
    return (cfg.lines || []).map((line) => {
      const ch = cfg.spatial?.channels?.[line.id] || {};
      return {
        id: line.id,
        label: line.name || `PL${line.id + 1}`,
        azimuth: ch.azimuth ?? 0,
        volume: ch.volume ?? 1,
        listening: ch.listening ?? true,
        active: false,
      };
    });
  }

  const api = controlApi.start(cfg, getSpatialState, (id, update) => {
    if (!cfg.spatial) cfg.spatial = {};
    if (!cfg.spatial.channels) cfg.spatial.channels = {};
    if (!cfg.spatial.channels[id]) cfg.spatial.channels[id] = {};
    Object.assign(cfg.spatial.channels[id], update);
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('spatial-channel-update', id, update);
    }
  });

  setInterval(() => {
    if (!mainWin || mainWin.isDestroyed()) return;
    const capture = {}, playback = {};
    for (const [ch, p] of capturePeaks) { capture[ch] = p; capturePeaks.set(ch, p * LEVEL_DECAY); }
    for (const [ch, p] of playbackPeaks) { playback[ch] = p; playbackPeaks.set(ch, p * LEVEL_DECAY); }
    mainWin.webContents.send('audio-levels', { capture, playback });
  }, 33);

  // Open all target="_blank" links (director pages, join links) in the system browser
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // One hidden WebContentsView per line (push + group-scoped listen in a single session).
  function createLineView(partition, preloadPath, url) {
    const lineSes = session.fromPartition(partition);
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
      },
    });

    view.webContents.setAudioMuted(true);
    mainWin.contentView.addChildView(view);
    view.setBounds({ x: -400, y: -400, width: 320, height: 240 });
    view.webContents.loadURL(url);
    return view;
  }

  ipcMain.handle('connect-line', (_, { id, url, inputChannel, outputChannel, gainOut, group }) => {
    if (lineViews.has(id)) return;

    const cfg = loadConfig();
    const stripIce = cfg.webrtc_lan_mode !== false;
    const line = cfg.lines.find(l => l.id === id);
    const hasOwnDevices = !!(line?.input_device_uid && line?.output_device_uid);
    // Per-session is for dedicated per-PL interfaces. If the per-PL device is the
    // same as the global device, the shared session already handles all channels
    // correctly via channelViews — starting a redundant per-session would only ever
    // capture ch0 regardless of line.input_channel, causing married meters.
    const isGlobalDevice = hasOwnDevices
      && line.input_device_uid === (cfg.input_device_uid || '')
      && line.output_device_uid === (cfg.output_device_uid || '');
    const shouldUsePerSession = hasOwnDevices && !isGlobalDevice;

    const tempDir = app.getPath('temp');
    const preloadPath = path.join(tempDir, `shim-line-${id}.js`);
    fs.writeFileSync(
      preloadPath,
      buildLineShim(inputChannel ?? 0, outputChannel ?? 0, gainOut ?? 1.0, group ?? '', stripIce,
        line?.input_device_uid || cfg.input_device_uid || '', !coreAudio)
    );

    const view = createLineView(`persist:line-${id}`, preloadPath, url);

    lineViews.set(id, view);

    let actuallyHasOwnSession = false;
    console.log(`connect-line PL${id}: hasOwnDevices=${hasOwnDevices} isGlobalDevice=${isGlobalDevice} shouldUsePerSession=${shouldUsePerSession} in_uid=${line?.input_device_uid || 'none'} input_ch=${line?.input_channel}`);
    if (shouldUsePerSession) {
      const sessionId = `pl-${id}`;
      try {
        coreAudio.startSession(
          sessionId,
          line.input_device_uid, 1,
          line.output_device_uid, 1,
          (ch, samples) => {
            let p = 0;
            for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > p) p = a; }
            capturePeaks.set(line.input_channel, Math.max(capturePeaks.get(line.input_channel) || 0, p));
            const wcId = sessionViews.get(id);
            if (wcId == null) return;
            const wc = webContents.fromId(wcId);
            if (wc && !wc.isDestroyed()) wc.send('audio-frame', line.input_channel, samples);
          }
        );
        actuallyHasOwnSession = true;
        sessionViews.set(id, view.webContents.id);
        console.log(`Line ${id} own-session pl-${id} cap=${line.input_device_uid} pb=${line.output_device_uid} → out ch${outputChannel} group=${group} lan=${stripIce}`);
      } catch (e) {
        console.error(`startSession failed for PL ${id}:`, e.message);
        // Fall through to shared session path
        channelViews.set(inputChannel ?? 0, view.webContents.id);
        console.log(`Line ${id} fell back to shared-session in ch${inputChannel} → out ch${outputChannel} group=${group} lan=${stripIce}`);
      }
    } else {
      // Shared session: handles global device + same-as-global per-PL assignments
      channelViews.set(inputChannel ?? 0, view.webContents.id);
      console.log(`Line ${id} shared-session ch${inputChannel} → out ch${outputChannel} group=${group} lan=${stripIce}`);
    }

    // For separate in/out devices, startSessionImpl creates "pl-N_pb" for playback.
    // For same device (duplex), "pl-N" handles both. Use the right ID when pushing.
    const playbackSessionId = (actuallyHasOwnSession && line.input_device_uid !== line.output_device_uid)
      ? `pl-${id}_pb`
      : `pl-${id}`;

    lineConfigs.set(id, {
      url,
      inputChannel: inputChannel ?? 0,
      outputChannel: outputChannel ?? 0,
      gainOut: gainOut ?? 1.0,
      group: group ?? '',
      hasOwnSession: actuallyHasOwnSession,
      playbackSessionId,
    });
    console.log(`  url: ${url}`);
    api.broadcastState(getSpatialState());
  });

  ipcMain.handle('disconnect-line', (_, id) => {
    const view = lineViews.get(id);
    if (!view) return;
    mainWin.contentView.removeChildView(view);
    view.webContents.close();
    const lineCfg = lineConfigs.get(id);
    if (lineCfg?.hasOwnSession) {
      try { coreAudio.stopSession(`pl-${id}`); } catch (_) {}
      sessionViews.delete(id);
    } else {
      for (const [ch, wcId] of channelViews) {
        if (wcId === view.webContents.id) channelViews.delete(ch);
      }
    }
    const tempDir = app.getPath('temp');
    try { fs.unlinkSync(path.join(tempDir, `shim-line-${id}.js`)); } catch (_) {}
    if (lineCfg?.outputChannel != null) {
      try { coreAudio.clearPlaybackChannel(lineCfg.outputChannel); } catch (_) {}
    }
    lineViews.delete(id);
    lineConfigs.delete(id);
    console.log(`Line ${id} disconnected`);
    api.broadcastState(getSpatialState());
  });

  // CoreAudio IPC handlers — all guarded: coreAudio is null when the native addon
  // isn't built (Linux, or Mac without a native build). Spatial mode doesn't need it.
  ipcMain.handle('list-audio-devices', () => coreAudio ? coreAudio.listDevices() : []);

  ipcMain.handle('start-audio-capture', (_e, deviceUID, nChannels) => {
    try {
      captureActive = true;
      const cfg = loadConfig();
      if (deviceUID) cfg.input_device_uid = deviceUID;
      return startUnifiedAudio(cfg, true);
    } catch (e) {
      console.error('Capture failed:', e.message);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('stop-audio-capture', () => {
    captureActive = false;
    return startUnifiedAudio(loadConfig(), false);
  });

  ipcMain.on('clear-playback', (_e, outCh) => {
    try {
      if (coreAudio) coreAudio.clearPlaybackChannel(outCh ?? 0);
    } catch (err) {
      console.error('clear-playback error:', err.message);
    }
  });

  ipcMain.on('playback-frame', (event, outCh, samples, gain) => {
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
      playbackPeaks.set(outCh, Math.max(playbackPeaks.get(outCh) || 0, peak));

      // Resolve which line sent this frame.
      let foundLineId = null;
      for (const [lineId, view] of lineViews) {
        if (view.webContents.id === event.sender.id) { foundLineId = lineId; break; }
      }

      // Spatial mode: all lines feed ONE shared AudioContext in the main
      // renderer (single destination + setSinkId). Forward the PCM there
      // instead of pushing to a hardware channel via coreAudio.
      if (cfg.outputMode === 'spatial') {
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send('spatial-audio-frame', foundLineId, floats);
        }
        return;
      }

      // Classic mode — route to per-PL session if the sending view has its own session
      let usedOwnSession = false;
      if (foundLineId != null) {
        const lc = lineConfigs.get(foundLineId);
        if (lc?.hasOwnSession) {
          const liveGain = outputGainByLineId.get(foundLineId) ?? 1.0;
          if (coreAudio) coreAudio.pushPlaybackSamples(lc.playbackSessionId ?? `pl-${foundLineId}`, 0, floats, liveGain);
          usedOwnSession = true;
        }
      }
      if (!usedOwnSession && coreAudio) {
        const liveGain = (foundLineId != null ? outputGainByLineId.get(foundLineId) : null) ?? 1.0;
        coreAudio.pushPlaybackSamples('default', outCh, floats, liveGain);
      }

      playbackFrameCount++;
      if (playbackFrameCount === 1 || playbackFrameCount % 500 === 0) {
        console.log(`playback-frame batch #${playbackFrameCount} → ${usedOwnSession ? `session pl-${[...lineViews.keys()].find(id => lineViews.get(id).webContents.id === event.sender.id)}` : `out ch ${outCh}`} (${floats.length} samples, peak=${peak.toFixed(4)})`);
      }
    } catch (err) {
      console.error('playback-frame error:', err.message);
    }
  });

  ipcMain.handle('play-test-tone', (_e, channel, ms) => {
    try {
      if (coreAudio) coreAudio.playTestTone(channel ?? 0, ms ?? 500);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('open-spatial-ui', () => {
    shell.openExternal(`http://localhost:${cfg.controlApiPort || 8080}`);
  });

  ipcMain.on('spatial-update-line', (_e, lineId, update) => {
    const view = lineViews.get(lineId);
    if (!view || view.webContents.isDestroyed()) return;
    view.webContents.send('spatial-update', update);
  });

  // IPC handlers
  ipcMain.handle('generate-qr', async (_, text) => {
    const QRCode = require('qrcode');
    return QRCode.toDataURL(text, { width: 120, margin: 1 });
  });
  ipcMain.handle('get-config', () => loadConfig());
  ipcMain.handle('save-config', (_, newCfg) => {
    saveConfig(newCfg);
    updateGainCache(newCfg);
    // Keep the long-lived cfg used by the playback-frame router in sync so a
    // mode/device switch takes effect without restarting the app.
    cfg.outputMode = newCfg.outputMode;
    cfg.spatialOutputDeviceId = newCfg.spatialOutputDeviceId;
    cfg.spatialOutputChannels = newCfg.spatialOutputChannels;
    return true;
  });
  ipcMain.handle('restart-playback', () => {
    return startUnifiedAudio(loadConfig(), captureActive);
  });
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

app.on('will-quit', () => {
  // Stop all per-line sessions before the default session
  for (const [lineId, lc] of lineConfigs) {
    if (lc.hasOwnSession) {
      try { coreAudio.stopSession(`pl-${lineId}`); } catch (_) {}
    }
  }
  try { coreAudio.stopAudio(); } catch (_) {}
});

app.on('window-all-closed', () => {
  app.quit();
});
