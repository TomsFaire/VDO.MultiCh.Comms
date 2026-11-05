function sanitiseKey(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function baseUrl(config) {
  return (config.vdo_base_url || 'https://vdo.ninja').replace(/\/$/, '');
}

function applyAuth(params, config) {
  const auth = config.auth || { mode: 'password' };
  if (auth.mode === 'password' && config.comms_password) {
    params.set('password', config.comms_password);
  }
  return params;
}

function applyNetwork(params, config) {
  if (config.network_mode === 'lan') {
    params.set('turn', 'off');
    params.set('stunonly', '');
    return params;
  }
  const turn = config.turn || {};
  if (turn.host) {
    const scheme = Number(turn.port) === 443 ? 'turns' : 'turn';
    const server = `${scheme}:${turn.host}${turn.port ? `:${turn.port}` : ''}`;
    params.set('turn', `${turn.username || ''};${turn.credential || ''};${server}`);
  }
  return params;
}

function applyRoomcap(params, config) {
  if (config.roomcap) params.set('roomcap', String(config.roomcap));
  return params;
}

function finish(params, config) {
  return applyRoomcap(applyNetwork(applyAuth(params, config), config), config);
}

function buildPushUrl(config) {
  const params = finish(new URLSearchParams({
    room: config.comms_room,
    push: sanitiseKey(config.box_name),
    webcam: '1',
    vd: '0',
    videodevice: '0',
    autostart: '1',
    label: config.location || config.box_name,
    labelsuggestion: '1',
    monomic: '1',
    proaudio: '1',
    sampleRate: '48000',
    noisetgate: '0',
    compressor: '0',
    autoGain: '0',
    cleanoutput: '1',
  }), config);
  return `${baseUrl(config)}/?${params}`;
}

function buildJoinUrl(config) {
  const params = finish(new URLSearchParams({
    room: config.comms_room,
    push: '',
    vd: '0',
  }), config);
  return `${baseUrl(config)}/?${params}`;
}

function buildDirectorUrl(config) {
  const params = finish(new URLSearchParams({
    director: config.comms_room,
    vd: '0',
    ad: '0',
    channelCount: '1',
    sampleRate: '48000',
    noisetgate: '0',
    compressor: '0',
    autoGain: '0',
    label: 'Director',
    notify: '1',
    showconnections: '1',
  }), config);
  return `${baseUrl(config)}/?${params}`;
}

module.exports = { sanitiseKey, buildPushUrl, buildJoinUrl, buildDirectorUrl };
