let config = null;
let inputChannelCount = 2;
let outputChannelCount = 2;
let shimDevices = { inputs: [], outputs: [] };
let links = { join: '', director: '' };

const $ = (id) => document.getElementById(id);

function sanitiseKey(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function setMsg(id, text, cls) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  if (cls !== undefined) el.className = cls;
}

async function renderQr(url) {
  const img = $('qr-comms');
  if (!img || !url) return;
  try {
    img.src = await window.api.generateQr(url);
  } catch (_) {
    img.alt = 'QR unavailable';
  }
}

async function connectShim() {
  const devices = await window.api.listAudioDevices();
  shimDevices = {
    inputs:  devices.filter(d => d.inChannels  > 0).map(d => ({
      name: d.name, uid: d.uid, channels: d.inChannels,
    })),
    outputs: devices.filter(d => d.outChannels > 0).map(d => ({
      name: d.name, uid: d.uid, channels: d.outChannels,
    })),
  };
}

function populateDeviceDropdown(select, devices, uidKey, nameKey) {
  if (!select) return;
  select.innerHTML = '<option value="">Default</option>';
  const selected = findDevice(devices, config?.[uidKey], config?.[nameKey]);
  devices.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d.uid;
    const chLabel = d.channels != null ? ` (${d.channels} ch)` : '';
    opt.textContent = `${d.name}${chLabel}`;
    if (d === selected) opt.selected = true;
    select.appendChild(opt);
  });
}

function findDevice(devices, uid, name) {
  const byUid = uid && devices.find(d => d.uid === uid);
  if (byUid) return byUid;
  if (!name) return null;
  return devices.find(d => d.name === name) ||
    devices.find(d => d.name.toLowerCase().includes(name.toLowerCase())) ||
    null;
}

function findInputDevice() {
  return findDevice(shimDevices.inputs, config.input_device_uid, config.input_device_name);
}

function findOutputDevice() {
  return findDevice(shimDevices.outputs, config.output_device_uid, config.output_device_name);
}

function queryChannelCounts() {
  const inDev = findInputDevice();
  const outDev = findOutputDevice();
  return {
    inCount: inDev ? inDev.channels : 2,
    outCount: outDev ? outDev.channels : 2,
  };
}

function channelOptions(selected, count) {
  return Array.from({ length: count }, (_, i) =>
    `<option value="${i}" ${i === selected ? 'selected' : ''}>${i + 1}</option>`
  ).join('');
}

function updateChannelDropdowns() {
  config.input_channel = Math.min(config.input_channel, inputChannelCount - 1);
  config.output_channel = Math.min(config.output_channel, outputChannelCount - 1);
  $('ch-in').innerHTML = channelOptions(config.input_channel, inputChannelCount);
  $('ch-out').innerHTML = channelOptions(config.output_channel, outputChannelCount);
}

function updateChannelCounts() {
  const counts = queryChannelCounts();
  inputChannelCount = config.input_channels_override || counts.inCount;
  outputChannelCount = config.output_channels_override || counts.outCount;
}

function updateDeviceLabel() {
  const inDev = findInputDevice();
  const outDev = findOutputDevice();
  const i = inDev ? `${inDev.name} (${inDev.channels}ch)` : 'Default';
  const o = outDev ? `${outDev.name} (${outDev.channels}ch)` : 'Default';
  $('device-label').textContent = `In: ${i} / Out: ${o}`;
}

const STATUS_LABELS = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  'device-missing': 'Device missing',
  'auth-failed': 'Auth failed',
};

function renderStatus(state) {
  const { status, detail, alert } = state;
  const el = $('line-status');
  el.textContent = STATUS_LABELS[status] || status;
  el.className = `line-status ${status}`;
  const lines = [detail];
  if (alert && alert !== detail && !detail.includes(alert)) lines.push(`Last alert: ${alert}`);
  $('line-detail').textContent = lines.filter(Boolean).join(' | ');
  $('connect-btn').textContent = status === 'disconnected' ? 'Connect' : 'Reconnect';
}

// Meter colours: green mic / blue remote, yellow from 60%, red from 95%.
function meterColor(pct, isMic) {
  if (pct >= 95) return '#e53935';
  if (pct >= 60) return '#f9a825';
  return isMic ? '#4caf50' : '#4a8abf';
}

function setMeter(id, level, isMic) {
  const bar = $(id);
  if (!bar) return;
  const pct = Math.min(100, (level || 0) * 200);
  bar.style.width = `${pct}%`;
  bar.style.background = meterColor(pct, isMic);
}

window.api.onAudioLevels(({ capture, playback }) => {
  setMeter('meter-mic', capture, true);
  setMeter('meter-remote', playback, false);
});

function renderLineCard() {
  $('line-box-name').textContent = config.box_name || '';
  $('line-location').textContent = config.location || '';
  $('gain-out').value = config.gain_out;
  $('gain-out-val').textContent = config.gain_out.toFixed(2);
  updateChannelDropdowns();
}

async function renderCommsBar() {
  links = await window.api.getLinks();
  $('comms-room-label').textContent = config.comms_room || '…';
  $('comms-join-url').value = links.join;
  $('comms-director-link').href = links.director || '#';
  renderQr(links.join);
}

function flashButton(id) {
  const btn = $(id);
  const original = btn.textContent;
  btn.textContent = 'Copied!';
  setTimeout(() => (btn.textContent = original), 1500);
}

async function copyQrImage() {
  const img = $('qr-comms');
  if (!img?.src) return;
  try {
    const blob = await (await fetch(img.src)).blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  } catch (_) {
    navigator.clipboard.writeText($('comms-join-url').value);
  }
  const wrap = img.closest('.qr-wrap');
  wrap.classList.add('copied');
  setTimeout(() => wrap.classList.remove('copied'), 1200);
}

function copyCommsLink() {
  navigator.clipboard.writeText(links.join);
  flashButton('comms-copy-btn');
}

function copyDirectorLink() {
  navigator.clipboard.writeText(links.director);
  flashButton('comms-director-copy');
}

function setupLineCard() {
  $('ch-in').addEventListener('change', (e) => {
    config.input_channel = parseInt(e.target.value);
    window.api.saveConfig(config);
  });
  $('ch-out').addEventListener('change', (e) => {
    config.output_channel = parseInt(e.target.value);
    window.api.saveConfig(config);
  });
  $('gain-out').addEventListener('input', (e) => {
    config.gain_out = parseFloat(e.target.value);
    $('gain-out-val').textContent = config.gain_out.toFixed(2);
    window.api.saveConfig(config);
  });
  const loc = $('line-location');
  loc.addEventListener('blur', () => {
    config.location = loc.textContent.trim();
    window.api.saveConfig(config);
  });
  loc.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); loc.blur(); } });

  $('test-tone-btn').addEventListener('click', async () => {
    setMsg('line-msg', '');
    const res = await window.api.playTestTone(config.output_channel, 800);
    if (!res.ok) setMsg('line-msg', `Test tone failed: ${res.error || 'unknown'}`);
  });

  $('connect-btn').addEventListener('click', async () => {
    setMsg('line-msg', '');
    await window.api.reconnectLine();
  });

  window.api.onLineStatus(renderStatus);
}

function exportSession() {
  return btoa(JSON.stringify({
    v: 3,
    comms_room: config.comms_room,
    comms_password: config.comms_password || '',
    vdo_base_url: config.vdo_base_url,
    network_mode: config.network_mode,
    turn: config.turn,
  }));
}

function applySession(code) {
  let parsed;
  try {
    parsed = JSON.parse(atob(code.trim()));
  } catch (_) {
    throw new Error('Invalid session code — could not decode.');
  }
  if (parsed.v !== 3) {
    throw new Error('Unsupported session code version — ask the host to export a new v3 code.');
  }
  if (!parsed.comms_room) {
    throw new Error('Invalid session code — missing room.');
  }
  config.comms_room = sanitiseKey(parsed.comms_room);
  config.comms_password = parsed.comms_password || '';
  config.vdo_base_url = parsed.vdo_base_url || 'https://vdo.ninja';
  config.network_mode = parsed.network_mode === 'lan' ? 'lan' : 'internet';
  config.turn = { host: '', port: '', username: '', credential: '', ...parsed.turn };
}

function showSetupWizard() {
  return new Promise((resolve) => {
    const overlay = $('setup-overlay');
    overlay.classList.add('open');

    const finish = async () => {
      config.configured = true;
      await window.api.saveConfig(config);
      overlay.classList.remove('open');
      resolve();
    };

    $('setup-new').addEventListener('click', () => {
      $('setup-step-1').style.display = 'none';
      $('setup-step-new').classList.add('visible');
      $('setup-event-name').focus();
    });

    $('setup-join-btn').addEventListener('click', () => {
      $('setup-step-1').style.display = 'none';
      $('setup-step-join').classList.add('visible');
      $('setup-join-code').focus();
    });

    const eventInput = $('setup-event-name');
    const boxInput = $('setup-new-box-name');
    const confirmBtn = $('setup-confirm');
    function updateNewValidity() {
      const event = sanitiseKey(eventInput.value);
      const eventOk = event.length >= 2;
      confirmBtn.disabled = !(eventOk && sanitiseKey(boxInput.value).length >= 1);
      setMsg('setup-key-preview', eventOk ? `room: ${event}` : 'Minimum 2 characters');
    }
    eventInput.addEventListener('input', updateNewValidity);
    boxInput.addEventListener('input', updateNewValidity);
    updateNewValidity();

    confirmBtn.addEventListener('click', async () => {
      config.comms_room = sanitiseKey(eventInput.value);
      config.comms_password = $('setup-password').value.trim();
      config.box_name = boxInput.value.trim();
      await finish();
    });

    $('setup-apply').addEventListener('click', async () => {
      const boxName = $('setup-join-box-name').value.trim();
      if (!sanitiseKey(boxName)) {
        setMsg('setup-msg', 'Enter a name for this box.', 'setup-msg fail');
        return;
      }
      try {
        applySession($('setup-join-code').value);
      } catch (e) {
        setMsg('setup-msg', e.message, 'setup-msg fail');
        return;
      }
      config.box_name = boxName;
      await finish();
    });
  });
}

function syncTurnVisibility() {
  $('turn-fields').style.display = $('network-mode').value === 'internet' ? 'flex' : 'none';
}

function setupSettings() {
  const overlay = $('settings-overlay');
  const preset = $('vdo-preset');
  const customRow = $('custom-url-row');
  const customUrl = $('vdo-custom-url');
  const testBtn = $('test-url-btn');
  const testStatus = $('test-status');

  $('open-settings').addEventListener('click', async () => {
    const isCustom = config.vdo_base_url !== 'https://vdo.ninja';
    preset.value = isCustom ? 'custom' : 'https://vdo.ninja';
    customUrl.value = isCustom ? config.vdo_base_url : '';
    customRow.style.display = isCustom ? 'flex' : 'none';
    testStatus.textContent = '';
    await connectShim();
    populateDeviceDropdown($('input-device-select'), shimDevices.inputs, 'input_device_uid', 'input_device_name');
    populateDeviceDropdown($('output-device-select'), shimDevices.outputs, 'output_device_uid', 'output_device_name');
    const detected = queryChannelCounts();
    $('input-ch-detected').textContent = `(detected: ${detected.inCount})`;
    $('output-ch-detected').textContent = `(detected: ${detected.outCount})`;
    $('input-ch-override').value = config.input_channels_override || '';
    $('output-ch-override').value = config.output_channels_override || '';
    $('comms-room-input').value = config.comms_room || '';
    $('comms-password').value = config.comms_password || '';
    $('roomcap').value = config.roomcap || '';
    $('network-mode').value = config.network_mode;
    $('turn-host').value = config.turn.host || '';
    $('turn-port').value = config.turn.port || '';
    $('turn-username').value = config.turn.username || '';
    $('turn-credential').value = config.turn.credential || '';
    $('box-name').value = config.box_name || '';
    syncTurnVisibility();
    $('session-export-code').value = exportSession();
    setMsg('session-export-msg', '');
    $('session-import-code').value = '';
    setMsg('session-import-msg', '', 'session-import-msg');
    setMsg('settings-msg', '');
    overlay.classList.add('open');
  });

  $('network-mode').addEventListener('change', syncTurnVisibility);

  $('session-export-btn').addEventListener('click', () => {
    const code = exportSession();
    $('session-export-code').value = code;
    navigator.clipboard.writeText(code);
    setMsg('session-export-msg', 'Session code copied!');
    setTimeout(() => setMsg('session-export-msg', ''), 2000);
  });

  $('session-import-btn').addEventListener('click', async () => {
    try {
      applySession($('session-import-code').value);
      config.configured = true;
      await window.api.saveConfig(config);
      await renderCommsBar();
      setMsg('session-import-msg', 'Session imported. Reconnect to apply.', 'session-import-msg ok');
    } catch (e) {
      setMsg('session-import-msg', e.message, 'session-import-msg fail');
    }
  });

  preset.addEventListener('change', () => {
    customRow.style.display = preset.value === 'custom' ? 'flex' : 'none';
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

  $('cancel-settings').addEventListener('click', () => {
    overlay.classList.remove('open');
  });

  $('save-settings').addEventListener('click', async () => {
    const boxName = $('box-name').value.trim();
    if (!sanitiseKey(boxName)) {
      setMsg('settings-msg', 'Box name is required.');
      return;
    }
    const roomName = sanitiseKey($('comms-room-input').value);
    if (roomName.length < 2) {
      setMsg('settings-msg', 'Room name must be at least 2 letters or numbers.');
      return;
    }
    const inUid = $('input-device-select').value;
    const outUid = $('output-device-select').value;
    const inDev = shimDevices.inputs.find(d => d.uid === inUid);
    const outDev = shimDevices.outputs.find(d => d.uid === outUid);
    config.input_device_uid = inUid || '';
    config.output_device_uid = outUid || '';
    config.input_device_name = inDev?.name || '';
    config.output_device_name = outDev?.name || '';
    config.vdo_base_url = preset.value === 'custom' ? customUrl.value.trim() : 'https://vdo.ninja';
    config.comms_room = roomName;
    config.comms_password = $('comms-password').value.trim();
    config.box_name = boxName;
    config.roomcap = parseInt($('roomcap').value) || null;
    config.network_mode = $('network-mode').value;
    config.turn = {
      host: $('turn-host').value.trim(),
      port: $('turn-port').value.trim(),
      username: $('turn-username').value.trim(),
      credential: $('turn-credential').value.trim(),
    };
    config.input_channels_override = parseInt($('input-ch-override').value) || null;
    config.output_channels_override = parseInt($('output-ch-override').value) || null;
    updateChannelCounts();
    updateChannelDropdowns();
    await window.api.saveConfig(config);
    updateDeviceLabel();
    await renderCommsBar();
    renderLineCard();
    overlay.classList.remove('open');
  });
}

async function init() {
  const firstRun = await window.api.isFirstRun();
  config = await window.api.getConfig();
  const meta = await window.api.getBuildMeta();
  const versionLabel = `v${meta.version} build ${meta.build}`;
  $('build-label').textContent = versionLabel;
  $('header-version').textContent = versionLabel;
  document.title = `VDO.MultiCh.Comms ${versionLabel}`;
  await connectShim();
  updateChannelCounts();
  updateDeviceLabel();
  setupSettings();
  setupLineCard();
  if (firstRun) {
    await showSetupWizard();
  }
  renderLineCard();
  await renderCommsBar();
  renderStatus(await window.api.getLineStatus());
}

init();
