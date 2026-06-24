let config = null;
let inputChannelCount = 2;
let outputChannelCount = 2;
const spatialChannels = {}; // { [id]: { azimuth, listening } }

async function renderQr(id, url) {
  const img = document.getElementById(`qr-${id}`);
  if (!img) return;
  try {
    img.src = await window.api.generateQr(url);
  } catch (_) {
    img.alt = 'QR unavailable';
  }
}
let shimDevices = { inputs: [], outputs: [] };
const lineStates = {}; // { [id]: { connected: boolean } }

async function connectShim() {
  const devices = await window.api.listAudioDevices();
  if (devices.length > 0) {
    shimDevices = {
      inputs:  devices.filter(d => d.inChannels  > 0).map(d => ({
        name: d.name, uid: d.uid, channels: d.inChannels,
      })),
      outputs: devices.filter(d => d.outChannels > 0).map(d => ({
        name: d.name, uid: d.uid, channels: d.outChannels,
      })),
    };
    return;
  }
  // CoreAudio unavailable — enumerate via Web Audio API instead
  try {
    // getUserMedia first to unlock device labels (required by browser security model)
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach(t => t.stop());
  } catch (_) {}
  const webDevs = await navigator.mediaDevices.enumerateDevices();
  shimDevices = {
    inputs:  webDevs.filter(d => d.kind === 'audioinput' && d.deviceId !== 'communications')
               .map(d => ({ name: d.label || d.deviceId, uid: d.deviceId, channels: 2 })),
    outputs: webDevs.filter(d => d.kind === 'audiooutput' && d.deviceId !== 'communications')
               .map(d => ({ name: d.label || d.deviceId, uid: d.deviceId, channels: 2 })),
  };
}

// devices is [{name, uid, channels}] — dropdown values are UIDs
function populateDeviceDropdown(select, devices, uidKey, nameKey) {
  if (!select) return;
  select.innerHTML = '<option value="">Default</option>';
  devices.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d.uid;
    const chLabel = d.channels != null ? ` (${d.channels} ch)` : '';
    opt.textContent = `${d.name}${chLabel}`;
    if (d.uid === config?.[uidKey] || (!config?.[uidKey] && d.name === config?.[nameKey])) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

// Populate per-line device dropdowns
function populateLineDeviceDropdown(select, devices, currentUid) {
  select.innerHTML = '<option value="">Using global</option>';
  devices.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.uid;
    opt.textContent = `${d.name} (${d.channels}ch)`;
    if (d.uid === currentUid) opt.selected = true;
    select.appendChild(opt);
  });
}

// Spatial mode routes through the Web Audio AudioContext, so its output device
// list comes from the browser (enumerateDevices), not the CoreAudio addon.
async function populateSpatialOutputDevices() {
  const sel = document.getElementById('spatial-output-device-select');
  if (!sel) return;
  let devices = [];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch (e) {
    console.warn('enumerateDevices failed:', e);
  }
  const outs = devices.filter((d) => d.kind === 'audiooutput');
  sel.innerHTML = '<option value="">System default</option>';
  outs.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Output ${(d.deviceId || '').slice(0, 8)}`;
    if (d.deviceId === config.spatialOutputDeviceId) opt.selected = true;
    sel.appendChild(opt);
  });
}

// Show/hide the spatial output controls vs the per-line hardware output
// selectors depending on the currently chosen output mode.
function applySettingsModeVisibility(mode) {
  const isSpatial = mode === 'spatial';
  const spatialRow = document.getElementById('spatial-output-row');
  const channelsRow = document.getElementById('spatial-channels-row');
  if (spatialRow) spatialRow.style.display = isSpatial ? '' : 'none';
  if (channelsRow) channelsRow.style.display = isSpatial ? '' : 'none';
}

function findInputDevice() {
  if (config.input_device_uid) {
    return shimDevices.inputs.find(d => d.uid === config.input_device_uid);
  }
  if (config.input_device) {
    return shimDevices.inputs.find(d => d.name === config.input_device) ||
      shimDevices.inputs.find(d => d.name.toLowerCase().includes(config.input_device.toLowerCase()));
  }
  return null;
}

function findOutputDevice() {
  if (config.output_device_uid) {
    return shimDevices.outputs.find(d => d.uid === config.output_device_uid);
  }
  if (config.output_device) {
    return shimDevices.outputs.find(d => d.name === config.output_device) ||
      shimDevices.outputs.find(d => d.name.toLowerCase().includes(config.output_device.toLowerCase()));
  }
  return null;
}

function queryChannelCounts() {
  const inDev  = findInputDevice();
  const outDev = findOutputDevice();
  return {
    inCount:  inDev  ? inDev.channels  : 2,
    outCount: outDev ? outDev.channels : 2,
  };
}

// Rebuild all per-line channel dropdowns to match device capabilities
function updateChannelDropdowns() {
  config.lines.forEach((line) => {
    const inSel = document.getElementById(`ch-in-${line.id}`);
    const outSel = document.getElementById(`ch-out-${line.id}`);
    if (inSel) {
      const clampedIn = Math.min(line.input_channel, inputChannelCount - 1);
      inSel.innerHTML = channelOptions(clampedIn, inputChannelCount);
      if (clampedIn !== line.input_channel) { line.input_channel = clampedIn; }
    }
    if (outSel) {
      const clampedOut = Math.min(line.output_channel, outputChannelCount - 1);
      outSel.innerHTML = channelOptions(clampedOut, outputChannelCount);
      if (clampedOut !== line.output_channel) { line.output_channel = clampedOut; }
    }
  });
}

// ── Boot ───────────────────────────────────────────────────────────────────

function updateDeviceLabel() {
  const label = document.getElementById('device-label');
  if (!label) return;
  const inDev = findInputDevice();
  const outDev = findOutputDevice();
  const i = inDev ? `${inDev.name} (${inDev.channels}ch)` : 'Default';
  const o = outDev ? `${outDev.name} (${outDev.channels}ch)` : 'Default';
  label.textContent = `In: ${i} / Out: ${o}`;
}

async function startCaptureForConfig() {
  const inDev = findInputDevice();
  if (!inDev) return;
  const counts = queryChannelCounts();
  const nCh = config.input_channels_override || counts.inCount;
  const result = await window.api.startAudioCapture(inDev.uid, nCh);
  if (result && !result.ok) {
    console.error('Audio capture failed:', result.error);
    alert(`Audio capture failed: ${result.error}`);
  }
}

async function init() {
  const firstRun = await window.api.isFirstRun();
  config = await window.api.getConfig();
  const meta = await window.api.getBuildMeta();
  const versionLabel = `v${meta.version} build ${meta.build}`;
  document.getElementById('build-label').textContent = versionLabel;
  const headerVer = document.getElementById('header-version');
  if (headerVer) headerVer.textContent = versionLabel;
  document.title = `VDO.MultiCh.Comms ${versionLabel}`;
  await connectShim();
  updateDeviceLabel();
  setupSettings();
  if (firstRun) {
    await showSetupWizard();
  }
  renderCommsBar();
  renderLines();
  populateDeviceDropdown(document.getElementById('input-device-select'), shimDevices.inputs, 'input_device_uid', 'input_device');
  populateDeviceDropdown(document.getElementById('output-device-select'), shimDevices.outputs, 'output_device_uid', 'output_device');
  const counts = queryChannelCounts();
  inputChannelCount = config.input_channels_override || counts.inCount;
  outputChannelCount = config.output_channels_override || counts.outCount;
  updateChannelDropdowns();
  if (config.input_device_uid || config.input_device) {
    await startCaptureForConfig();
  }
  updateModeIndicator();
  if (config.outputMode === 'spatial') {
    try {
      await window.spatialMixer.start(config.spatialOutputDeviceId || '', config.spatialOutputChannels || 2);
    } catch (e) {
      console.error('spatialMixer.start failed:', e);
    }
  }
}

function channelOptions(selected, count = 16) {
  return Array.from({ length: count }, (_, i) =>
    `<option value="${i}" ${i === selected ? 'selected' : ''}>${i + 1}</option>`
  ).join('');
}

function sanitiseKey(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function groupFromName(name, fallbackId) {
  const g = sanitiseKey(name);
  return g || `pl${fallbackId + 1}`;
}

function vdoBaseUrl() {
  return (config.vdo_base_url || 'https://vdo.ninja').replace(/\/$/, '');
}

function getCommsRoom() {
  return config.comms_room || sanitiseKey(config.instance_name) || 'default';
}

function getLineGroup(line) {
  return line.group || groupFromName(line.name, line.id);
}

function allGroups() {
  return config.lines.map(getLineGroup).join(',');
}

function withPassword(params) {
  const pw = config.room_locked ? config.lock_password : config.comms_password;
  if (pw) params.set('password', pw);
  return params;
}

function randomLockCode() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

async function toggleRoomLock() {
  if (config.room_locked) {
    config.room_locked = false;
    config.lock_password = '';
  } else {
    config.room_locked = true;
    config.lock_password = randomLockCode();
  }
  await window.api.saveConfig(config);
  renderCommsBar();
}


function applyWebRtcParams(params) {
  if (config.webrtc_turn_off !== false) params.set('turn', 'off');
  if (config.webrtc_stun_only || config.webrtc_lan_mode !== false) params.set('stunonly', '1');
  return params;
}

function commsJoinUrl() {
  const params = withPassword(new URLSearchParams({
    room: getCommsRoom(),
    groups: allGroups(),
    groupmode: '1',
  }));
  if (config.webrtc_turn_off !== false) params.set('turn', 'off');
  return `${vdoBaseUrl()}/comms?${params}`;
}

function lineUrl(line) {
  const group = getLineGroup(line);
  const params = applyWebRtcParams(withPassword(new URLSearchParams({
    room: getCommsRoom(),
    push: `${getCommsRoom()}_${group}`,
    group,
    groupmode: '1',
    webcam: '1',
    vd: '0',
    videodevice: '0',
    autostart: '1',
    label: line.location || line.name,
    labelsuggestion: '1',
    monomic: '1',
    proaudio: '1',
    sampleRate: '48000',
    noisetgate: '0',
    compressor: '0',
    autoGain: '0',
    cleanoutput: '1',
  })));
  return `${vdoBaseUrl()}/?${params}`;
}

function directorUrl() {
  const params = applyWebRtcParams(withPassword(new URLSearchParams({
    director: getCommsRoom(),
    groups: allGroups(),
    groupmode: '1',
    vd: '0',
    ad: '0',
    channelCount: '1',
    sampleRate: '48000',
    noisetgate: '0',
    compressor: '0',
    autoGain: '0',
    label: config.instance_name || 'Director',
    notify: '1',
    showconnections: '1',
  })));
  return `${vdoBaseUrl()}/?${params}`;
}

function renderCommsBar() {
  const joinUrl = commsJoinUrl();
  const dirUrl = directorUrl();
  const roomEl = document.getElementById('comms-room-label');
  const joinInput = document.getElementById('comms-join-url');
  const dirLink = document.getElementById('comms-director-link');
  const buildHint = document.getElementById('comms-build-hint');
  const lockBtn = document.getElementById('lock-room-btn');
  const bar = document.getElementById('comms-bar');
  const locked = !!config.room_locked;
  if (roomEl) roomEl.textContent = getCommsRoom();
  if (joinInput) joinInput.value = joinUrl;
  if (dirLink) dirLink.href = dirUrl;
  if (lockBtn) {
    lockBtn.textContent = locked ? 'Unlock room' : 'Lock room';
    lockBtn.classList.toggle('locked', locked);
    lockBtn.title = locked
      ? 'Room is locked — new participants cannot join. Click to unlock.'
      : 'Lock room to prevent new participants joining';
  }
  if (bar) bar.classList.toggle('room-locked', locked);
  if (buildHint && !joinUrl.includes('/comms?')) {
    buildHint.textContent = 'Warning: join URL is not a Comms link — reinstall the latest build.';
    buildHint.className = 'comms-warn';
  } else if (buildHint) {
    buildHint.textContent = locked
      ? 'Room is locked — share a new link to allow additional participants.'
      : 'Mobile: tap a party-line button before talking (ungrouped audio goes to all lines).';
    buildHint.className = locked ? 'comms-warn' : 'comms-hint';
  }
  renderQr('comms', joinUrl);
}

function renderLines() {
  const container = document.getElementById('lines');

  if (!container._deviceListenersAttached) {
    container._deviceListenersAttached = true;

    container.addEventListener('change', e => {
      const el = e.target;
      if (!el.matches('select[id^="dev-in-"]')) return;
      const id = parseInt(el.dataset.line);
      const line = config.lines.find(l => l.id === id);
      if (line) {
        line.input_device_uid = el.value || null;
        window.api.saveConfig(config);
      }
    });

    container.addEventListener('change', e => {
      const el = e.target;
      if (!el.matches('select[id^="dev-out-"]')) return;
      const id = parseInt(el.dataset.line);
      const line = config.lines.find(l => l.id === id);
      if (line) {
        line.output_device_uid = el.value || null;
        window.api.saveConfig(config);
      }
    });
  }

  container.innerHTML = '';

  config.lines.forEach((line) => {
    lineStates[line.id] = lineStates[line.id] || { connected: false };
    const panel = document.createElement('div');
    panel.className = 'line-panel';
    panel.id = `line-${line.id}`;

    panel.innerHTML = `
      <h2><span class="editable-name" data-line="${line.id}" contenteditable="true" spellcheck="false">${line.name}</span></h2>
      <div class="group-badge">Group: <span class="group-name" id="group-${line.id}">${getLineGroup(line)}</span></div>
      <div class="location-row"><span class="editable-location" data-line="${line.id}" contenteditable="true" spellcheck="false" data-placeholder="Location…">${line.location || ''}</span></div>
      <div class="meter-stack">
        <div class="meter"><div class="meter-bar" id="meter-in-${line.id}"></div></div>
        <div class="meter"><div class="meter-bar meter-bar-out" id="meter-out-${line.id}"></div></div>
        <div class="meter-labels"><span>mic</span><span>remote</span></div>
      </div>
      <div class="device-row">
        <label>In device</label>
        <select id="dev-in-${line.id}" data-line="${line.id}" data-dir="in">
          <option value="">Using global</option>
        </select>
      </div>
      <div class="device-row out-device-row">
        <label>Out device</label>
        <select id="dev-out-${line.id}" data-line="${line.id}" data-dir="out">
          <option value="">Using global</option>
        </select>
      </div>
      <div class="channel-row">
        <label>In</label>
        <select id="ch-in-${line.id}" data-line="${line.id}" data-dir="in" title="Hardware input 1–${outputChannelCount}">
          ${channelOptions(line.input_channel, inputChannelCount)}
        </select>
      </div>
      <div class="channel-row out-channel-row">
        <label>Out</label>
        <select id="ch-out-${line.id}" data-line="${line.id}" data-dir="out" title="Hardware output 1–${outputChannelCount}">
          ${channelOptions(line.output_channel, outputChannelCount)}
        </select>
        <button type="button" class="test-btn" onclick="testOutChannel(${line.id})" title="440 Hz test tone on this output">Test</button>
      </div>
      <div class="gain-row">
        <span>Gain in</span>
        <input type="range" min="0" max="10" step="0.05" value="${line.gain_in}" data-line="${line.id}" data-dir="in" />
        <span id="gain-in-val-${line.id}">${line.gain_in.toFixed(2)}</span>
      </div>
      <div class="gain-row">
        <span>Gain out</span>
        <input type="range" min="0" max="10" step="0.05" value="${line.gain_out}" data-line="${line.id}" data-dir="out" />
        <span id="gain-out-val-${line.id}">${line.gain_out.toFixed(2)}</span>
      </div>
      <button class="connect-btn" id="connect-${line.id}" onclick="toggleConnect(${line.id})">Connect</button>
      <div class="pan-section" id="pan-section-${line.id}">
        <svg class="pan-radar" id="pan-radar-${line.id}" viewBox="0 0 80 80" width="80" height="80">
          <circle cx="40" cy="40" r="36" fill="#1a1a1a" stroke="#333" stroke-width="1"/>
          <circle cx="40" cy="40" r="24" fill="none" stroke="#2a2a2a" stroke-width="1"/>
          <circle cx="40" cy="40" r="12" fill="none" stroke="#2a2a2a" stroke-width="1"/>
          <line x1="40" y1="4" x2="40" y2="76" stroke="#2a2a2a" stroke-width="1"/>
          <line x1="4" y1="40" x2="76" y2="40" stroke="#2a2a2a" stroke-width="1"/>
          <text x="40" y="7" text-anchor="middle" fill="#444" font-size="5">F</text>
          <text x="40" y="77" text-anchor="middle" fill="#444" font-size="5">B</text>
          <text x="5" y="42" text-anchor="middle" fill="#444" font-size="5">L</text>
          <text x="75" y="42" text-anchor="middle" fill="#444" font-size="5">R</text>
          <circle cx="40" cy="40" r="2.5" fill="#666"/>
          <circle id="pan-thumb-${line.id}" cx="40" cy="4" r="5" fill="#4a9eff" style="filter:drop-shadow(0 0 3px rgba(74,158,255,0.6));cursor:grab"/>
        </svg>
        <div class="pan-side">
          <span class="pan-readout" id="pan-readout-${line.id}">0° (Front)</span>
          <button class="pan-listen-btn" id="pan-listen-${line.id}" onclick="toggleSpatialListen(${line.id})">Listen</button>
        </div>
      </div>
    `;

    container.appendChild(panel);

    spatialChannels[line.id] = spatialChannels[line.id] || { azimuth: 0, listening: true };
    syncPanUI(line.id, spatialChannels[line.id]);

    const radar = document.getElementById(`pan-radar-${line.id}`);
    if (radar) {
      const CX = 40, CY = 40, R = 31;
      let dragging = false;
      const getAz = (e) => {
        const rect = radar.getBoundingClientRect();
        const scale = 80 / rect.width;
        const dx = (e.clientX - rect.left) * scale - CX;
        const dy = (e.clientY - rect.top)  * scale - CY;
        return Math.atan2(dx, -dy) * 180 / Math.PI;
      };
      radar.addEventListener('mousedown', (e) => {
        dragging = true;
        e.preventDefault();
        updateSpatialChannel(line.id, { azimuth: getAz(e) });
      });
      document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        updateSpatialChannel(line.id, { azimuth: getAz(e) });
      });
      document.addEventListener('mouseup', (e) => {
        if (!dragging) return;
        dragging = false;
        updateSpatialChannel(line.id, { azimuth: Math.round(getAz(e) * 10) / 10 });
      });
      radar.addEventListener('dblclick', () => {
        updateSpatialChannel(line.id, { azimuth: 0 });
      });
    }

    // Populate device dropdowns for this line
    populateLineDeviceDropdown(
      document.getElementById(`dev-in-${line.id}`),
      shimDevices.inputs,
      line.input_device_uid || ''
    );
    populateLineDeviceDropdown(
      document.getElementById(`dev-out-${line.id}`),
      shimDevices.outputs,
      line.output_device_uid || ''
    );
  });

  // Channel select listeners
  document.querySelectorAll('select[data-line][id^="ch-"]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const id = parseInt(e.target.dataset.line);
      const dir = e.target.dataset.dir;
      const val = parseInt(e.target.value);
      const line = config.lines.find((l) => l.id === id);
      if (!line) return;
      if (dir === 'in') line.input_channel = val;
      else line.output_channel = val;
      window.api.saveConfig(config);
    });
  });

  // Gain slider listeners — update display live, save only on release
  document.querySelectorAll('input[type=range]').forEach((el) => {
    el.addEventListener('input', (e) => {
      const id = parseInt(e.target.dataset.line);
      const dir = e.target.dataset.dir;
      const val = parseFloat(e.target.value);
      const line = config.lines.find((l) => l.id === id);
      if (!line) return;
      if (dir === 'in') {
        line.gain_in = val;
        document.getElementById(`gain-in-val-${id}`).textContent = val.toFixed(2);
      } else {
        line.gain_out = val;
        document.getElementById(`gain-out-val-${id}`).textContent = val.toFixed(2);
      }
    });
    el.addEventListener('change', (e) => {
      const id = parseInt(e.target.dataset.line);
      const line = config.lines.find((l) => l.id === id);
      if (line) window.api.saveConfig(config);
    });
  });

  // Inline-editable name (h2)
  document.querySelectorAll('.editable-name').forEach((el) => {
    el.addEventListener('blur', () => {
      const id = parseInt(el.dataset.line);
      const val = el.textContent.trim() || `PL${id + 1}`;
      el.textContent = val;
      const line = config.lines.find((l) => l.id === id);
      if (line) {
        line.name = val;
        line.group = groupFromName(val, id);
        const groupEl = document.getElementById(`group-${id}`);
        if (groupEl) groupEl.textContent = line.group;
        renderCommsBar();
        window.api.saveConfig(config);
      }
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
  });

  // Inline-editable location
  document.querySelectorAll('.editable-location').forEach((el) => {
    el.addEventListener('blur', () => {
      const id = parseInt(el.dataset.line);
      const val = el.textContent.trim();
      const line = config.lines.find((l) => l.id === id);
      if (line) { line.location = val; window.api.saveConfig(config); }
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
  });
}

async function testOutChannel(id) {
  const line = config.lines.find((l) => l.id === id);
  if (!line) return;
  const res = await window.api.playTestTone(line.output_channel, 800);
  if (!res.ok) alert('Test tone failed: ' + (res.error || 'unknown'));
}

async function toggleConnect(id) {
  const state = lineStates[id];
  state.connected = !state.connected;
  const btn = document.getElementById(`connect-${id}`);
  btn.textContent = state.connected ? 'Disconnect' : 'Connect';
  btn.classList.toggle('connected', state.connected);

  const line = config.lines.find(l => l.id === id);
  if (!line) return;

  if (state.connected) {
    const otherConnected = config.lines.filter(
      (l) => l.id !== id && lineStates[l.id]?.connected
    ).length;
    if (otherConnected > 0) {
      await new Promise((r) => setTimeout(r, otherConnected * 1500));
    }
    await window.api.connectLine(
      id,
      lineUrl(line),
      line.input_channel,
      line.output_channel,
      line.gain_out,
      getLineGroup(line)
    );
    if (config.outputMode === 'spatial') {
      const channelState = config.spatial?.channels?.[id] ?? {};
      window.spatialMixer.connect(id, channelState);
    }
  } else {
    if (config.outputMode === 'spatial') window.spatialMixer.disconnect(id);
    await window.api.disconnectLine(id);
  }
}

function azimuthLabel(az) {
  if (az === 0) return '0° (Front)';
  return az < 0 ? `L ${Math.abs(az).toFixed(1)}°` : `R ${az.toFixed(1)}°`;
}

function syncPanUI(id, channelState) {
  const thumb = document.getElementById(`pan-thumb-${id}`);
  const readout = document.getElementById(`pan-readout-${id}`);
  const listenBtn = document.getElementById(`pan-listen-${id}`);
  if (!thumb || !readout) return;
  const az = channelState.azimuth ?? 0;
  const rad = (az * Math.PI) / 180;
  const R = 31, CX = 40, CY = 40;
  thumb.setAttribute('cx', CX + Math.sin(rad) * R);
  thumb.setAttribute('cy', CY - Math.cos(rad) * R);
  readout.textContent = azimuthLabel(az);
  if (listenBtn) {
    const listening = channelState.listening !== false;
    listenBtn.textContent = listening ? 'Listen' : 'Muted';
    listenBtn.classList.toggle('muted', !listening);
  }
}

function updateSpatialChannel(id, update) {
  if (config.outputMode !== 'spatial') return;
  if (!config.spatial) config.spatial = { channels: {} };
  if (!config.spatial.channels) config.spatial.channels = {};
  Object.assign(config.spatial.channels[id] = config.spatial.channels[id] ?? {}, update);
  spatialChannels[id] = Object.assign(spatialChannels[id] || { azimuth: 0, listening: true }, update);
  syncPanUI(id, spatialChannels[id]);
  // Drive the single shared mixer running in this renderer window.
  if (update.azimuth !== undefined) window.spatialMixer.updatePosition(id, update.azimuth);
  if (update.volume !== undefined) window.spatialMixer.updateVolume(id, update.volume);
  if (update.listening !== undefined) window.spatialMixer.setListening(id, update.listening);
  window.api.sendSpatialUpdate(id, update);
}

function toggleSpatialListen(id) {
  const ch = spatialChannels[id] || { azimuth: 0, listening: true };
  updateSpatialChannel(id, { listening: !ch.listening });
}

function updateModeIndicator() {
  const isSpatial = config?.outputMode === 'spatial';
  const pill = document.getElementById('mode-pill');
  const spatialBtn = document.getElementById('spatial-ui-btn');
  if (pill) {
    pill.textContent = isSpatial ? 'Spatial' : 'Classic';
    pill.className = `mode-pill ${isSpatial ? 'spatial' : 'classic'}`;
  }
  if (spatialBtn) spatialBtn.style.display = isSpatial ? '' : 'none';
  document.querySelectorAll('.pan-section').forEach(el => {
    el.classList.toggle('spatial-visible', isSpatial);
  });
  // Spatial mode hides the per-line hardware output selectors (the single
  // shared spatial device replaces them).
  document.body.classList.toggle('spatial-mode', isSpatial);
}

function openSpatialUI() {
  window.api.openSpatialUI();
}

async function copyQrImage() {
  const img = document.getElementById('qr-comms');
  if (!img?.src) return;
  try {
    const blob = await (await fetch(img.src)).blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  } catch (_) {
    navigator.clipboard.writeText(document.getElementById('comms-join-url').value);
  }
  const wrap = img.closest('.qr-wrap');
  wrap.classList.add('copied');
  setTimeout(() => wrap.classList.remove('copied'), 1200);
}

function copyCommsLink() {
  const el = document.getElementById('comms-join-url');
  navigator.clipboard.writeText(el.value);
  const btn = document.getElementById('comms-copy-btn');
  btn.textContent = 'Copied!';
  setTimeout(() => (btn.textContent = 'Copy link'), 1500);
}

function copyDirectorLink() {
  navigator.clipboard.writeText(directorUrl());
  const btn = document.getElementById('comms-director-copy');
  btn.textContent = 'Copied!';
  setTimeout(() => (btn.textContent = 'Copy'), 1500);
}

// ── Session export / import ───────────────────────────────────────────────────

function exportSession() {
  const session = {
    v: 2,
    comms_room: getCommsRoom(),
    comms_password: config.comms_password || '',
    lines: config.lines.map(l => ({ id: l.id, name: l.name, group: getLineGroup(l) })),
  };
  return btoa(JSON.stringify(session));
}

function applySession(code) {
  let parsed;
  try {
    parsed = JSON.parse(atob(code.trim()));
  } catch (_) {
    throw new Error('Invalid session code — could not decode.');
  }
  if (parsed.v === 2) {
    if (!parsed.comms_room || !Array.isArray(parsed.lines)) {
      throw new Error('Invalid session code — unexpected format.');
    }
    config.comms_room = sanitiseKey(parsed.comms_room);
    config.instance_name = config.comms_room;
    config.comms_password = parsed.comms_password || '';
    parsed.lines.forEach((sl, i) => {
      const line = config.lines[i];
      if (!line) return;
      line.name = sl.name;
      line.group = sanitiseKey(sl.group) || groupFromName(sl.name, line.id);
    });
    return;
  }
  if (parsed.v === 1 && Array.isArray(parsed.lines)) {
    const keys = parsed.lines.map(l => l.room_key).filter(Boolean);
    let prefix = keys[0] || 'default';
    for (const key of keys) {
      let i = 0;
      while (i < prefix.length && i < key.length && prefix[i] === key[i]) i++;
      prefix = prefix.slice(0, i);
    }
    config.comms_room = prefix || keys[0] || 'default';
    config.instance_name = config.comms_room;
    parsed.lines.forEach((sl, i) => {
      const line = config.lines[i];
      if (!line) return;
      line.name = sl.name;
      if (config.comms_room && sl.room_key?.startsWith(config.comms_room)) {
        line.group = sl.room_key.slice(config.comms_room.length) || groupFromName(sl.name, line.id);
      } else {
        line.group = sanitiseKey(sl.room_key) || groupFromName(sl.name, line.id);
      }
    });
    return;
  }
  throw new Error('Invalid session code — unexpected format.');
}

// ── First-run setup wizard ────────────────────────────────────────────────────

function showSetupWizard() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('setup-overlay');
    overlay.classList.add('open');

    // ── Step 1: new vs join ──────────────────────────────────────────────────
    document.getElementById('setup-join-btn').addEventListener('click', () => {
      document.getElementById('setup-join-section').classList.add('visible');
    });

    document.getElementById('setup-apply').addEventListener('click', async () => {
      const code = document.getElementById('setup-join-code').value;
      const msg = document.getElementById('setup-msg');
      try {
        applySession(code);
        await window.api.saveConfig(config);
        msg.textContent = 'Session applied!';
        msg.className = 'setup-msg ok';
        setTimeout(() => { overlay.classList.remove('open'); resolve(); }, 800);
      } catch (e) {
        msg.textContent = e.message;
        msg.className = 'setup-msg fail';
      }
    });

    document.getElementById('setup-new').addEventListener('click', () => {
      // Advance to step 2
      document.getElementById('setup-step-1').style.display = 'none';
      const step2 = document.getElementById('setup-step-2');
      step2.classList.add('visible');

      // Build the line name grid
      const grid = document.getElementById('setup-lines-grid');
      grid.innerHTML = '';
      config.lines.forEach((line) => {
        const div = document.createElement('div');
        div.className = 'setup-line-field';
        div.innerHTML = `
          <label>Line ${line.id + 1} name</label>
          <input type="text" id="setup-line-${line.id}" value="${line.name}" maxlength="24" placeholder="e.g. Production" />
          <div class="setup-line-key" id="setup-line-key-${line.id}"></div>
        `;
        grid.appendChild(div);
      });

      // Live preview of comms room + groups
      const eventInput = document.getElementById('setup-event-name');
      const confirmBtn = document.getElementById('setup-confirm');
      const preview = document.getElementById('setup-key-preview');

      function updatePreviews() {
        const event = sanitiseKey(eventInput.value);
        const valid = event.length >= 2;
        confirmBtn.disabled = !valid;
        preview.textContent = valid ? '' : 'Minimum 2 characters';
        config.lines.forEach((line) => {
          const nameInput = document.getElementById(`setup-line-${line.id}`);
          const keyEl = document.getElementById(`setup-line-key-${line.id}`);
          const group = groupFromName(nameInput?.value || line.name, line.id);
          keyEl.textContent = valid ? `group: ${group}` : '';
        });
      }

      eventInput.addEventListener('input', updatePreviews);
      config.lines.forEach((line) => {
        document.getElementById(`setup-line-${line.id}`)?.addEventListener('input', updatePreviews);
      });
      updatePreviews();
    });

    // ── Step 2: confirm ──────────────────────────────────────────────────────
    document.getElementById('setup-confirm').addEventListener('click', async () => {
      const event = sanitiseKey(document.getElementById('setup-event-name').value);
      const msg = document.getElementById('setup-step2-msg');
      if (event.length < 2) {
        msg.textContent = 'Enter an event name (min 2 characters)';
        msg.className = 'setup-msg fail';
        return;
      }
      config.comms_room = event;
      config.instance_name = event;
      config.lines.forEach((line) => {
        const nameInput = document.getElementById(`setup-line-${line.id}`);
        const name = nameInput?.value.trim() || line.name;
        line.name = name;
        line.group = groupFromName(name || `pl${line.id + 1}`, line.id);
      });
      await window.api.saveConfig(config);
      overlay.classList.remove('open');
      resolve();
    });
  });
}

// ── Settings ──────────────────────────────────────────────────────────────────

function setupSettings() {
  const overlay = document.getElementById('settings-overlay');
  const preset = document.getElementById('vdo-preset');
  const customRow = document.getElementById('custom-url-row');
  const customUrl = document.getElementById('vdo-custom-url');
  const testBtn = document.getElementById('test-url-btn');
  const testStatus = document.getElementById('test-status');

  document.getElementById('open-settings').addEventListener('click', async () => {
    const isCustom = config.vdo_base_url !== 'https://vdo.ninja';
    preset.value = isCustom ? 'custom' : 'https://vdo.ninja';
    customUrl.value = isCustom ? config.vdo_base_url : '';
    customRow.style.display = isCustom ? 'flex' : 'none';
    testStatus.textContent = '';
    // Re-enumerate on open so newly connected devices appear
    await connectShim();
    populateDeviceDropdown(document.getElementById('input-device-select'), shimDevices.inputs, 'input_device_uid', 'input_device');
    populateDeviceDropdown(document.getElementById('output-device-select'), shimDevices.outputs, 'output_device_uid', 'output_device');
    config.lines.forEach(line => {
      populateLineDeviceDropdown(
        document.getElementById(`dev-in-${line.id}`),
        shimDevices.inputs,
        line.input_device_uid || ''
      );
      populateLineDeviceDropdown(
        document.getElementById(`dev-out-${line.id}`),
        shimDevices.outputs,
        line.output_device_uid || ''
      );
    });
    // Show detected channel counts as hints; pre-fill overrides from config
    const detected = queryChannelCounts();
    document.getElementById('input-ch-detected').textContent = `(detected: ${detected.inCount})`;
    document.getElementById('output-ch-detected').textContent = `(detected: ${detected.outCount})`;
    document.getElementById('input-ch-override').value = config.input_channels_override || '';
    document.getElementById('output-ch-override').value = config.output_channels_override || '';
    document.getElementById('comms-room-input').value = config.comms_room || '';
    document.getElementById('comms-password').value = config.comms_password || '';
    document.getElementById('output-mode-select').value = config.outputMode || 'classic';
    await populateSpatialOutputDevices();
    document.getElementById('spatial-channels-select').value = String(config.spatialOutputChannels || 2);
    applySettingsModeVisibility(config.outputMode || 'classic');
    // Pre-populate export code
    document.getElementById('session-export-code').value = exportSession();
    document.getElementById('session-export-msg').textContent = '';
    document.getElementById('session-import-code').value = '';
    document.getElementById('session-import-msg').textContent = '';
    document.getElementById('session-import-msg').className = 'session-import-msg';
    overlay.classList.add('open');
  });

  // Session export
  document.getElementById('session-export-btn').addEventListener('click', () => {
    const code = exportSession();
    document.getElementById('session-export-code').value = code;
    navigator.clipboard.writeText(code);
    const msg = document.getElementById('session-export-msg');
    msg.textContent = 'Session code copied!';
    setTimeout(() => { msg.textContent = ''; }, 2000);
  });

  // Session import
  document.getElementById('session-import-btn').addEventListener('click', async () => {
    const code = document.getElementById('session-import-code').value;
    const msg = document.getElementById('session-import-msg');
    try {
      applySession(code);
      await window.api.saveConfig(config);
      renderCommsBar();
      renderLines();
      msg.textContent = 'Session imported successfully.';
      msg.className = 'session-import-msg ok';
    } catch (e) {
      msg.textContent = e.message;
      msg.className = 'session-import-msg fail';
    }
  });

  preset.addEventListener('change', () => {
    const isCustom = preset.value === 'custom';
    customRow.style.display = isCustom ? 'flex' : 'none';
  });

  document.getElementById('output-mode-select').addEventListener('change', (e) => {
    applySettingsModeVisibility(e.target.value);
  });

  testBtn.addEventListener('click', async () => {
    const url = customUrl.value.trim();
    if (!url) return;
    testStatus.textContent = 'Testing…';
    testStatus.className = 'test-status';
    const result = await window.api.testVdoUrl(url);
    if (result.ok) {
      testStatus.textContent = '✓ Reachable';
      testStatus.className = 'test-status ok';
    } else {
      testStatus.textContent = `✗ ${result.error || `HTTP ${result.status}`}`;
      testStatus.className = 'test-status fail';
    }
  });

  document.getElementById('cancel-settings').addEventListener('click', () => {
    overlay.classList.remove('open');
  });

  document.getElementById('save-settings').addEventListener('click', async () => {
    const inUid = document.getElementById('input-device-select').value;
    const outUid = document.getElementById('output-device-select').value;
    const inDev = shimDevices.inputs.find(d => d.uid === inUid);
    const outDev = shimDevices.outputs.find(d => d.uid === outUid);
    config.input_device_uid = inUid || '';
    config.output_device_uid = outUid || '';
    config.input_device = inDev?.name || '';
    config.output_device = outDev?.name || '';
    const isCustom = preset.value === 'custom';
    config.vdo_base_url = isCustom ? customUrl.value.trim() : 'https://vdo.ninja';
    const newRoom = sanitiseKey(document.getElementById('comms-room-input').value);
    if (newRoom && newRoom !== config.comms_room) {
      config.comms_room = newRoom;
      config.instance_name = newRoom;
      // Changing the room name invalidates any existing lock
      config.room_locked = false;
      config.lock_password = '';
    }
    config.comms_password = document.getElementById('comms-password').value.trim();
    config.outputMode = document.getElementById('output-mode-select').value || 'classic';
    config.spatialOutputDeviceId = document.getElementById('spatial-output-device-select').value || '';
    config.spatialOutputChannels = parseInt(document.getElementById('spatial-channels-select').value, 10) || 2;
    // Apply channel count overrides (or detected values from shim)
    const inOverride = parseInt(document.getElementById('input-ch-override').value) || 0;
    const outOverride = parseInt(document.getElementById('output-ch-override').value) || 0;
    config.input_channels_override = inOverride || null;
    config.output_channels_override = outOverride || null;
    const detected = queryChannelCounts();
    inputChannelCount = inOverride || detected.inCount;
    outputChannelCount = outOverride || detected.outCount;
    updateChannelDropdowns();
    await window.api.saveConfig(config);
    updateModeIndicator();
    // (Re)build the shared spatial mixer with the saved device/channels.
    // teardown() is a no-op if it was never started (e.g. classic mode).
    window.spatialMixer.teardown();
    if (config.outputMode === 'spatial') {
      try {
        await window.spatialMixer.start(config.spatialOutputDeviceId || '', config.spatialOutputChannels || 2);
        // Re-attach any lines that are currently connected.
        config.lines.forEach((line) => {
          if (lineStates[line.id]?.connected) {
            window.spatialMixer.connect(line.id, config.spatial?.channels?.[line.id] ?? {});
          }
        });
      } catch (e) {
        console.error('spatialMixer.start failed:', e);
      }
    }
    if (config.input_device_uid) {
      await startCaptureForConfig();
    } else {
      await window.api.stopAudioCapture();
    }
    updateDeviceLabel();
    overlay.classList.remove('open');
    renderCommsBar();
  });
}

function meterColor(pct, isInput) {
  if (pct >= 95) return '#e53935';
  if (pct >= 60) return '#f9a825';
  return isInput ? '#4caf50' : '#4a8abf';
}

window.api.onSpatialChannelUpdate((id, update) => {
  updateSpatialChannel(id, update);
});

window.api.onSpatialAudioFrame((lineId, samples) => {
  window.spatialMixer.feedFrame(lineId, samples);
});

window.api.onAudioLevels(({ capture, playback }) => {
  if (!config) return;
  config.lines.forEach((line) => {
    const inBar  = document.getElementById(`meter-in-${line.id}`);
    const outBar = document.getElementById(`meter-out-${line.id}`);
    if (inBar) {
      const pct = Math.min(100, (capture[line.input_channel]  || 0) * 200);
      inBar.style.width = `${pct}%`;
      inBar.style.background = meterColor(pct, true);
    }
    if (outBar) {
      const pct = Math.min(100, (playback[line.output_channel] || 0) * 200);
      outBar.style.width = `${pct}%`;
      outBar.style.background = meterColor(pct, false);
    }
  });
});

init();
