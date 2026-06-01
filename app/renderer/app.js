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
          deviceId: existing.find(d => {
            const a = d.name.toLowerCase(), b = e.name.toLowerCase();
            return a.includes(b) || b.includes(a);
          })?.deviceId || '',
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

// Look up channel counts from shim device info (CPAL — accurate for multi-channel interfaces).
// Uses substring matching because CPAL and Web Audio API report different names for the same
// device on macOS (e.g. "BlackHole 16ch" vs "BlackHole 16ch (Virtual)").
function queryChannelCounts(inputName, outputName) {
  const fuzzy = (devices, name) => {
    if (!name || !devices) return null;
    const a = name.toLowerCase();
    return devices.find(d => {
      const b = d.name.toLowerCase();
      return a.includes(b) || b.includes(a);
    });
  };
  const inDev = fuzzy(shimDevices.inputs, inputName);
  const outDev = fuzzy(shimDevices.outputs, outputName);
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
  const firstRun = await window.api.isFirstRun();
  config = await window.api.getConfig();
  connectShim();
  updateDeviceLabel();
  setupSettings();
  if (firstRun) {
    await showSetupWizard();
  }
  renderLines();
  // Populate device lists immediately from Web Audio API — shim may not be running yet
  shimDevices = await enumerateAudioDevices();
  populateDeviceDropdown(document.getElementById('input-device-select'), shimDevices.inputs, 'input_device');
  populateDeviceDropdown(document.getElementById('output-device-select'), shimDevices.outputs, 'output_device');
  // Set channel dropdowns — honour saved overrides, fall back to detected
  const counts = queryChannelCounts(config.input_device, config.output_device);
  inputChannelCount = config.input_channels_override || counts.inCount;
  outputChannelCount = config.output_channels_override || counts.outCount;
  updateChannelDropdowns();
}

function channelOptions(selected, count = 16) {
  return Array.from({ length: count }, (_, i) =>
    `<option value="${i}" ${i === selected ? 'selected' : ''}>Ch ${i}</option>`
  ).join('');
}

function directorUrl(baseUrl, roomKey) {
  // VDO.ninja: &director=ROOMNAME (room name is the param value, not a separate &room)
  const params = new URLSearchParams({
    director: roomKey,
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
  });
  return `${baseUrl}/?${params}`;
}

function joinUrl(line) {
  const params = new URLSearchParams({
    room: line.room_key,
    webcam: '1',          // join as mic/webcam participant (required for autostart to work)
    vd: '0',              // no video device
    videodevice: '0',     // no camera
    autostart: '1',       // auto-join without clicking Start (essential for hidden view)
    label: line.location || line.name,
    labelsuggestion: '1',
    monomic: '1',
    proaudio: '1',
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
      <div class="director-row">
        <span class="director-label">Director</span>
        <a class="director-link" id="director-${line.id}" href="${directorUrl(config.vdo_base_url, line.room_key)}" target="_blank">Open ↗</a>
        <button onclick="copyDirectorLink(${line.id})">Copy link</button>
      </div>
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
        // Room key is permanent — renaming does not change which room this line uses
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

async function toggleConnect(id) {
  const state = lineStates[id];
  state.connected = !state.connected;
  const btn = document.getElementById(`connect-${id}`);
  btn.textContent = state.connected ? 'Disconnect' : 'Connect';
  btn.classList.toggle('connected', state.connected);

  const line = config.lines.find(l => l.id === id);
  if (!line) return;

  if (state.connected) {
    // Use a WebContentsView in the main process — proper Chromium instance with
    // real mic access, not a suppressed hidden iframe
    await window.api.connectLine(id, joinUrl(line));
  } else {
    await window.api.disconnectLine(id);
  }
}

function copyJoinLink(id) {
  const el = document.getElementById(`join-${id}`);
  navigator.clipboard.writeText(el.value);
  const btn = el.nextElementSibling;
  btn.textContent = 'Copied!';
  setTimeout(() => (btn.textContent = 'Copy'), 1500);
}

function copyDirectorLink(id) {
  const line = config.lines.find(l => l.id === id);
  if (!line) return;
  const url = directorUrl(config.vdo_base_url, line.room_key);
  navigator.clipboard.writeText(url);
  const btn = document.querySelector(`#director-${id} + button`) ||
    document.querySelector(`.director-row button[onclick="copyDirectorLink(${id})"]`);
  if (btn) { btn.textContent = 'Copied!'; setTimeout(() => (btn.textContent = 'Copy'), 1500); }
}

// ── Session export / import ───────────────────────────────────────────────────

function exportSession() {
  const session = {
    v: 1,
    lines: config.lines.map(l => ({ id: l.id, name: l.name, room_key: l.room_key })),
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
  if (parsed.v !== 1 || !Array.isArray(parsed.lines)) {
    throw new Error('Invalid session code — unexpected format.');
  }
  parsed.lines.forEach((sl, i) => {
    const line = config.lines[i];
    if (!line) return;
    line.name = sl.name;
    line.room_key = sl.room_key;
  });
}

// ── First-run setup wizard ────────────────────────────────────────────────────

function sanitiseKey(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

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

      // Live preview of room keys
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
          const linePart = sanitiseKey(nameInput?.value || line.name);
          keyEl.textContent = valid ? `room: ${event}${linePart || `pl${line.id + 1}`}` : '';
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
      config.lines.forEach((line) => {
        const nameInput = document.getElementById(`setup-line-${line.id}`);
        const name = nameInput?.value.trim() || line.name;
        line.name = name;
        line.room_key = event + sanitiseKey(name || `pl${line.id + 1}`);
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
    shimDevices = await enumerateAudioDevices();
    populateDeviceDropdown(document.getElementById('input-device-select'), shimDevices.inputs, 'input_device');
    populateDeviceDropdown(document.getElementById('output-device-select'), shimDevices.outputs, 'output_device');
    // Show detected channel counts as hints; pre-fill overrides from config
    const detected = queryChannelCounts(config.input_device, config.output_device);
    document.getElementById('input-ch-detected').textContent = `(detected: ${detected.inCount})`;
    document.getElementById('output-ch-detected').textContent = `(detected: ${detected.outCount})`;
    document.getElementById('input-ch-override').value = config.input_channels_override || '';
    document.getElementById('output-ch-override').value = config.output_channels_override || '';
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
    // Apply channel count overrides (or detected values from shim)
    const inOverride = parseInt(document.getElementById('input-ch-override').value) || 0;
    const outOverride = parseInt(document.getElementById('output-ch-override').value) || 0;
    config.input_channels_override = inOverride || null;
    config.output_channels_override = outOverride || null;
    const detected = queryChannelCounts(config.input_device, config.output_device);
    inputChannelCount = inOverride || detected.inCount;
    outputChannelCount = outOverride || detected.outCount;
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
