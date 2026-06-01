let config = null;
let inputChannelCount = 2;
let outputChannelCount = 2;

async function renderQr(id, url) {
  const img = document.getElementById(`qr-${id}`);
  if (!img) return;
  try {
    img.src = await window.api.generateQr(url);
  } catch (_) {
    img.alt = 'QR unavailable';
  }
}
let shimDevices = []; // device names received from shim on connect
const lineStates = {}; // { [id]: { connected: boolean } }

// ── Shim WebSocket ─────────────────────────────────────────────────────────

let shimWs = null;

function connectShim() {
  shimWs = new WebSocket('ws://127.0.0.1:9696');
  shimWs.addEventListener('message', (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'devices' && config) {
        // Shim sends names only — merge with deviceIds from Web Audio API enumeration
        // Merge shim entries (have channels) with Web Audio entries (have deviceId)
        const merge = (shimEntries, existing) => shimEntries.map(e => ({
          name: e.name,
          channels: e.channels,
          deviceId: existing.find(d => d.name === e.name)?.deviceId || '',
        }));
        shimDevices = {
          inputs: merge(msg.input_devices || [], shimDevices.inputs || []),
          outputs: merge(msg.output_devices || [], shimDevices.outputs || []),
        };
        populateDeviceDropdown(document.getElementById('input-device-select'), shimDevices.inputs, 'input_device');
        populateDeviceDropdown(document.getElementById('output-device-select'), shimDevices.outputs, 'output_device');
        // Shim has accurate channel counts — update dropdowns now
        const c = queryChannelCounts(config.input_device, config.output_device);
        inputChannelCount = c.inCount;
        outputChannelCount = c.outCount;
        updateChannelDropdowns();
      }
    } catch (_) { /* audio frames — ignore for now */ }
  });
  shimWs.addEventListener('close', () => {
    setTimeout(connectShim, 2000); // reconnect if shim restarts
  });
}

// devices is [{name, deviceId}] or [string] — normalises both
function populateDeviceDropdown(select, devices, configKey) {
  if (!select) return;
  select.innerHTML = '<option value="">Default</option>';
  devices.forEach((d) => {
    const name = typeof d === 'string' ? d : d.name;
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    if (name === config?.[configKey]) opt.selected = true;
    select.appendChild(opt);
  });
}

// Enumerate audio devices — returns {name, deviceId} objects so channel counts can be queried
async function enumerateAudioDevices() {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop()));
    const all = await navigator.mediaDevices.enumerateDevices();
    const seen = (kind) => {
      const names = new Set();
      return all
        .filter(d => d.kind === kind && d.label)
        .filter(d => names.has(d.label) ? false : names.add(d.label))
        .map(d => ({ name: d.label, deviceId: d.deviceId }));
    };
    return { inputs: seen('audioinput'), outputs: seen('audiooutput') };
  } catch (_) {
    return { inputs: [], outputs: [] };
  }
}

// Look up channel counts from shim device info (CPAL — accurate for multi-channel interfaces)
function queryChannelCounts(inputName, outputName) {
  const inDev = shimDevices.inputs?.find(d => d.name === inputName);
  const outDev = shimDevices.outputs?.find(d => d.name === outputName);
  return {
    inCount: inDev?.channels || 2,
    outCount: outDev?.channels || 2,
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
  const i = config.input_device || 'Default';
  const o = config.output_device || 'Default';
  label.textContent = `In: ${i} / Out: ${o}`;
}

async function init() {
  config = await window.api.getConfig();
  connectShim();
  updateDeviceLabel();
  renderLines();
  setupSettings();
  // Populate device lists immediately from Web Audio API — shim may not be running yet
  shimDevices = await enumerateAudioDevices();
  populateDeviceDropdown(document.getElementById('input-device-select'), shimDevices.inputs, 'input_device');
  populateDeviceDropdown(document.getElementById('output-device-select'), shimDevices.outputs, 'output_device');
  // Set channel dropdowns to match the currently configured devices
  const counts = queryChannelCounts(config.input_device, config.output_device);
  inputChannelCount = counts.inCount;
  outputChannelCount = counts.outCount;
  updateChannelDropdowns();
}

function channelOptions(selected, count = 16) {
  return Array.from({ length: count }, (_, i) =>
    `<option value="${i}" ${i === selected ? 'selected' : ''}>Ch ${i}</option>`
  ).join('');
}

function directorUrl(baseUrl, roomKey) {
  const params = new URLSearchParams({
    room: roomKey,
    director: '1',
    vd: '0',
    ad: '0',
    channelCount: '1',
    sampleRate: '48000',
    noisetgate: '0',
    compressor: '0',
    autoGain: '0',
    label: config.instance_name || 'Director',
  });
  return `${baseUrl}/?${params}`;
}

function joinUrl(line) {
  const params = new URLSearchParams({
    room: line.room_key,
    vd: '0',
    videodevice: '0',
    audio: '1',
    label: line.location || line.name,
    noisetgate: '0',
    compressor: '0',
    autoGain: '0',
  });
  return `${config.vdo_base_url}/?${params}`;
}

function renderLines() {
  const container = document.getElementById('lines');
  container.innerHTML = '';

  config.lines.forEach((line) => {
    lineStates[line.id] = lineStates[line.id] || { connected: false };
    const panel = document.createElement('div');
    panel.className = 'line-panel';
    panel.id = `line-${line.id}`;

    panel.innerHTML = `
      <h2><span class="editable-name" data-line="${line.id}" contenteditable="true" spellcheck="false">${line.name}</span></h2>
      <div class="location-row"><span class="editable-location" data-line="${line.id}" contenteditable="true" spellcheck="false" data-placeholder="Location…">${line.location || ''}</span></div>
      <div class="meter"><div class="meter-bar" id="meter-${line.id}"></div></div>
      <div class="channel-row">
        <label>In</label>
        <select id="ch-in-${line.id}" data-line="${line.id}" data-dir="in">
          ${channelOptions(line.input_channel)}
        </select>
      </div>
      <div class="channel-row">
        <label>Out</label>
        <select id="ch-out-${line.id}" data-line="${line.id}" data-dir="out">
          ${channelOptions(line.output_channel)}
        </select>
      </div>
      <div class="gain-row">
        <span>Gain in</span>
        <input type="range" min="0" max="3" step="0.05" value="${line.gain_in}" data-line="${line.id}" data-dir="in" />
        <span id="gain-in-val-${line.id}">${line.gain_in.toFixed(2)}</span>
      </div>
      <div class="gain-row">
        <span>Gain out</span>
        <input type="range" min="0" max="3" step="0.05" value="${line.gain_out}" data-line="${line.id}" data-dir="out" />
        <span id="gain-out-val-${line.id}">${line.gain_out.toFixed(2)}</span>
      </div>
      <div class="join-section">
        <img class="qr" id="qr-${line.id}" alt="QR code" />
        <div class="copy-row">
          <input type="text" readonly value="${joinUrl(line)}" id="join-${line.id}" />
          <button onclick="copyJoinLink(${line.id})">Copy</button>
        </div>
      </div>
      <button class="connect-btn" id="connect-${line.id}" onclick="toggleConnect(${line.id})">Connect</button>
    `;

    container.appendChild(panel);
  });

  // QR codes — generated in main process via IPC (qrcode is Node-only, no browser bundle)
  config.lines.forEach((line) => renderQr(line.id, joinUrl(line)));

  // Channel select listeners
  document.querySelectorAll('select[data-line]').forEach((el) => {
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

  // Gain slider listeners
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
      window.api.saveConfig(config);
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
        const sanitised = val.toLowerCase().replace(/[^a-z0-9]/g, '');
        line.room_key = sanitised + Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(0, 4);
        const url = joinUrl(line);
        const input = document.getElementById(`join-${id}`);
        if (input) input.value = url;
        renderQr(id, url);
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

function toggleConnect(id) {
  const state = lineStates[id];
  state.connected = !state.connected;
  const btn = document.getElementById(`connect-${id}`);
  btn.textContent = state.connected ? 'Disconnect' : 'Connect';
  btn.classList.toggle('connected', state.connected);
  // TODO: signal shim to start/stop audio bridge for this channel
}

function copyJoinLink(id) {
  const el = document.getElementById(`join-${id}`);
  navigator.clipboard.writeText(el.value);
  const btn = el.nextElementSibling;
  btn.textContent = 'Copied!';
  setTimeout(() => (btn.textContent = 'Copy'), 1500);
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
    shimDevices = await enumerateAudioDevices();
    populateDeviceDropdown(document.getElementById('input-device-select'), shimDevices.inputs, 'input_device');
    populateDeviceDropdown(document.getElementById('output-device-select'), shimDevices.outputs, 'output_device');
    overlay.classList.add('open');
  });

  preset.addEventListener('change', () => {
    const isCustom = preset.value === 'custom';
    customRow.style.display = isCustom ? 'flex' : 'none';
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
    config.input_device = document.getElementById('input-device-select').value;
    config.output_device = document.getElementById('output-device-select').value;
    const isCustom = preset.value === 'custom';
    config.vdo_base_url = isCustom ? customUrl.value.trim() : 'https://vdo.ninja';
    // Update channel counts before saving so clamped values are persisted
    const counts = queryChannelCounts(config.input_device, config.output_device);
    inputChannelCount = counts.inCount;
    outputChannelCount = counts.outCount;
    updateChannelDropdowns();
    await window.api.saveConfig(config);
    updateDeviceLabel();
    overlay.classList.remove('open');
    // Refresh join links and QR codes
    config.lines.forEach((line) => {
      const url = joinUrl(line);
      const input = document.getElementById(`join-${line.id}`);
      if (input) input.value = url;
      const canvas = document.getElementById(`qr-${line.id}`);
      renderQr(line.id, url);
    });
  });
}

init();
