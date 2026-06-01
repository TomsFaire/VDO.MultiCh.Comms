let config = null;
let shimDevices = []; // device names received from shim on connect
const lineStates = {}; // { [id]: { connected: boolean } }

// ── Shim WebSocket ─────────────────────────────────────────────────────────

let shimWs = null;

function connectShim() {
  shimWs = new WebSocket('ws://127.0.0.1:9696');
  shimWs.addEventListener('message', (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'devices') {
        shimDevices = msg.devices;
        populateDeviceDropdown(document.getElementById('audio-device-select'), shimDevices);
      }
    } catch (_) { /* audio frames — ignore for now */ }
  });
  shimWs.addEventListener('close', () => {
    setTimeout(connectShim, 2000); // reconnect if shim restarts
  });
}

function populateDeviceDropdown(select, devices) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">Default device</option>';
  devices.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    if (name === current || name === config?.audio_device) opt.selected = true;
    select.appendChild(opt);
  });
}

// ── Boot ───────────────────────────────────────────────────────────────────

async function init() {
  config = await window.api.getConfig();
  connectShim();
  renderLines();
  setupSettings();
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
  });
  return `${baseUrl}/?${params}`;
}

function joinUrl(line) {
  return `${config.vdo_base_url}/comms?room=${line.room_key}`;
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
      <h2>${line.name}</h2>
      <div class="room-key">${line.room_key}</div>
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
        <canvas id="qr-${line.id}" width="120" height="120"></canvas>
        <div class="copy-row">
          <input type="text" readonly value="${joinUrl(line)}" id="join-${line.id}" />
          <button onclick="copyJoinLink(${line.id})">Copy</button>
        </div>
      </div>
      <button class="connect-btn" id="connect-${line.id}" onclick="toggleConnect(${line.id})">Connect</button>
    `;

    container.appendChild(panel);
  });

  // QR codes
  config.lines.forEach((line) => {
    const canvas = document.getElementById(`qr-${line.id}`);
    if (canvas) QRCode.toCanvas(canvas, joinUrl(line), { width: 120, margin: 1, color: { dark: '#000', light: '#fff' } });
  });

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

  document.getElementById('open-settings').addEventListener('click', () => {
    const isCustom = config.vdo_base_url !== 'https://vdo.ninja';
    preset.value = isCustom ? 'custom' : 'https://vdo.ninja';
    customUrl.value = isCustom ? config.vdo_base_url : '';
    customRow.style.display = isCustom ? 'flex' : 'none';
    testStatus.textContent = '';
    // Populate device dropdown with latest shim device list
    const devSelect = document.getElementById('audio-device-select');
    populateDeviceDropdown(devSelect, shimDevices);
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
    const devSelect = document.getElementById('audio-device-select');
    config.audio_device = devSelect.value;
    const isCustom = preset.value === 'custom';
    config.vdo_base_url = isCustom ? customUrl.value.trim() : 'https://vdo.ninja';
    await window.api.saveConfig(config);
    overlay.classList.remove('open');
    // Refresh join links and QR codes
    config.lines.forEach((line) => {
      const url = joinUrl(line);
      const input = document.getElementById(`join-${line.id}`);
      if (input) input.value = url;
      const canvas = document.getElementById(`qr-${line.id}`);
      if (canvas) QRCode.toCanvas(canvas, url, { width: 120, margin: 1, color: { dark: '#000', light: '#fff' } });
    });
  });
}

init();
