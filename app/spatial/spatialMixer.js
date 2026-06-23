'use strict';

// Spatial mixer — runs in the MAIN renderer window (index.html), NOT inside the
// per-line WebContentsViews. Every party line feeds PCM frames (delivered over
// IPC as 'spatial-audio-frame') into a single shared AudioContext so the HRTF
// panners produce one coherent spatial image, routed to one output device via
// AudioContext.setSinkId().

(function () {
  const SAMPLE_RATE = 48000;

  let _ctx = null;
  let _workletReady = false;
  let _started = false;
  let _channelCount = 2;

  // key(lineId) → { workletNode, gainNode, pannerNode, volume, listening }
  const _nodes = new Map();

  // Normalise line ids so a number (local radar / main IPC) and a string
  // (control-API web UI) address the same line.
  function _key(lineId) {
    return String(lineId);
  }

  // Playback-direction ring buffer: PCM frames arrive via port.postMessage and
  // are streamed out as audio. Mirror of the capture-side RemoteCapture worklet.
  const PLAYBACK_WORKLET = `
    class SpatialPlayback extends AudioWorkletProcessor {
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
          } else { out[i] = 0; }
        }
        return true;
      }
    }
    registerProcessor('spatial-playback', SpatialPlayback);
  `;

  function _azimuthToPosition(azimuth) {
    const rad = (azimuth * Math.PI) / 180;
    return { x: Math.sin(rad), y: 0, z: -Math.cos(rad) };
  }

  function _makePanner(ctx, azimuth) {
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.maxDistance = 10000;
    panner.rolloffFactor = 0;
    const pos = _azimuthToPosition(azimuth);
    panner.positionX.value = pos.x;
    panner.positionY.value = pos.y;
    panner.positionZ.value = pos.z;
    return panner;
  }

  // Create the shared AudioContext, point it at the chosen output device and
  // load the playback worklet. channelCount is 2 (stereo) or 6 (5.1).
  async function start(outputDeviceId, channelCount) {
    if (_started) return;
    _started = true;
    _ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });

    // Route to the selected output device. Empty string = system default.
    if (outputDeviceId && typeof _ctx.setSinkId === 'function') {
      try {
        await _ctx.setSinkId(outputDeviceId);
      } catch (err) {
        console.warn('[spatialMixer] setSinkId failed:', err.message);
      }
    }

    // 5.1 support: widen the destination when a multichannel device is selected.
    // True VBAP speaker panning is a future enhancement — stereo HRTF binaural
    // works for any channel count >= 2.
    _channelCount = channelCount || 2;
    if (_channelCount >= 6) {
      try {
        const max = _ctx.destination.maxChannelCount;
        _ctx.destination.channelCount = Math.min(6, max);
        _ctx.destination.channelCountMode = 'explicit';
      } catch (err) {
        console.warn('[spatialMixer] could not set 5.1 destination:', err.message);
      }
    }

    const blobUrl = URL.createObjectURL(new Blob([PLAYBACK_WORKLET], { type: 'application/javascript' }));
    await _ctx.audioWorklet.addModule(blobUrl);
    URL.revokeObjectURL(blobUrl);
    _workletReady = true;
    await _ctx.resume();
    console.log('[spatialMixer] started ch=' + _channelCount + ' sink=' + (outputDeviceId || 'default'));
  }

  // Enqueue a PCM frame for a line into its playback worklet's ring buffer.
  // Frames that arrive before connect() (or after disconnect) are dropped.
  function feedFrame(lineId, samples) {
    const entry = _nodes.get(_key(lineId));
    if (!entry || !samples || !samples.length) return;
    entry.workletNode.port.postMessage(samples);
  }

  // Build the per-line node graph: worklet source → gain → HRTF panner → dest.
  function connect(lineId, channelState) {
    if (!_ctx || !_workletReady) {
      console.warn('[spatialMixer] connect before start — ignoring line', lineId);
      return;
    }
    const k = _key(lineId);
    if (_nodes.has(k)) disconnect(lineId);

    // connect() is reached via the Connect-button click (a user gesture), so
    // this is a safe point to resume a context that started suspended.
    if (_ctx.state === 'suspended') _ctx.resume();

    const cs = channelState || {};
    const azimuth = cs.azimuth ?? 0;
    const volume = cs.volume ?? 1;
    const listening = cs.listening !== false;

    const workletNode = new AudioWorkletNode(_ctx, 'spatial-playback', { outputChannelCount: [1] });
    const gainNode = _ctx.createGain();
    gainNode.gain.value = listening ? volume : 0;
    const pannerNode = _makePanner(_ctx, azimuth);

    workletNode.connect(gainNode);
    gainNode.connect(pannerNode);
    pannerNode.connect(_ctx.destination);

    _nodes.set(k, { workletNode, gainNode, pannerNode, volume, listening });
  }

  function updatePosition(lineId, azimuth) {
    const entry = _nodes.get(_key(lineId));
    if (!entry) return;
    const pos = _azimuthToPosition(azimuth);
    const t = _ctx.currentTime;
    entry.pannerNode.positionX.setTargetAtTime(pos.x, t, 0.01);
    entry.pannerNode.positionY.setTargetAtTime(pos.y, t, 0.01);
    entry.pannerNode.positionZ.setTargetAtTime(pos.z, t, 0.01);
  }

  function updateVolume(lineId, volume) {
    const entry = _nodes.get(_key(lineId));
    if (!entry) return;
    entry.volume = volume;
    // Don't unmute a muted line just because the fader moved.
    if (entry.listening) {
      entry.gainNode.gain.setTargetAtTime(volume, _ctx.currentTime, 0.01);
    }
  }

  function setListening(lineId, listening) {
    const entry = _nodes.get(_key(lineId));
    if (!entry) return;
    entry.listening = listening;
    // Restore to the line's stored volume (not 1.0) when re-enabling.
    const target = listening ? entry.volume : 0;
    entry.gainNode.gain.setTargetAtTime(target, _ctx.currentTime, 0.01);
  }

  function disconnect(lineId) {
    const k = _key(lineId);
    const entry = _nodes.get(k);
    if (!entry) return;
    try {
      entry.workletNode.port.onmessage = null;
      entry.workletNode.disconnect();
      entry.gainNode.disconnect();
      entry.pannerNode.disconnect();
    } catch (_) {}
    _nodes.delete(k);
  }

  function teardown() {
    for (const k of [..._nodes.keys()]) disconnect(k);
    if (_ctx) {
      _ctx.close();
      _ctx = null;
    }
    _workletReady = false;
    _started = false;
  }

  const spatialMixer = { start, feedFrame, connect, disconnect, updatePosition, updateVolume, setListening, teardown };

  // Runs only in the main renderer window, loaded via a <script> tag.
  if (typeof window !== 'undefined') {
    window.spatialMixer = spatialMixer;
  }
})();
