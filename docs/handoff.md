# Development Handoff — VDO.MultiCh.Comms

**Date:** 2026-06-16
**Current version:** 0.1.3 (see `app/build-meta.json` for build number)
**Branch:** `feature/audio-bifurcation`

---

## What this project is

A macOS Electron app for multi-channel IP intercom. Primary use case: bridging two buildings with hardware intercom systems and multiple party lines over WAN (IP replacement for ISDN/analogue intercom trunks). Also works on LAN.

Connects up to four **party lines** to a **single VDO.ninja Comms room**, with each line as a **group** inside that room. Broadcast crew route hardware audio channels independently; mobile users join one Comms link.

**Architecture:**

```
Hardware mic / audio interface (CoreAudio)
  → coreaudio.node N-API addon (main process)
  → captureCallback → webContents.send('audio-frame', ch, samples)
  → Per-line preload (AudioWorklet getUserMedia override)
  → VDO.ninja push (group-scoped, room=comms_room)
  → WebRTC → remote participants

Remote audio (inbound)
  → Same WebContentsView (group-scoped listen)
  → DOM remote-tap + AudioWorklet (media elements muted)
  → ipcRenderer.send('playback-frame', outCh, samples, gain)
  → coreAudio.pushPlaybackSamples(sessionId, ch, data, gain)
  → hardware output channel
```

The **Rust shim** (`shim/`, CPAL, WebSocket :9696) was **deleted** in v0.1.1. Do not resurrect it.

---

## Repo layout

```
app/
  main.js              Main process — CoreAudio, IPC, WebContentsView, line preloads
  preload.js           Renderer preload — IPC bridge
  build-meta.json      { "version", "build" } — bumped by scripts/bump-build.js
  package.json         electron-builder; extraResources ships coreaudio.node
  renderer/
    app.js             UI — comms bar, groups, line connect, settings, meters
    index.html         UI shell + styles
  native/
    coreaudio.mm       CoreAudio capture/playback N-API addon
    binding.gyp
    package.json       node-gyp build scripts
  scripts/
    bump-build.js      Auto-increment build before dist

docs/
  usage.md             End-user guide
  development.md       Build from source, architecture
  handoff.md           This file
  known-issues.md      Status and open bugs
  self-hosting.md      VDO.ninja / TURN / signaling
  screenshot-v0.1.3.png  UI screenshot (v0.1.3)
```

---

## How to build

### Native addon (required before run or dist)

```bash
cd app/native
npm install
npm run build
# → app/native/build/Release/coreaudio.node
```

### Dev run

```bash
cd app
npm install
npm start
```

### DMG (auto-bumps build number)

```bash
cd app/native && npm run build
cd .. && npm run build
# → app/dist/VDO.MultiCh.Comms-<version>-arm64.dmg
```

### CI

`.github/workflows/release.yml` — builds native addon, `npm run build`, ad-hoc signs DMG, publishes on `v*.*.*` tags.

---

## Config model

Path: `~/.vdo-multichan/config.json`

| Field | Purpose |
|-------|---------|
| `comms_room` | Single VDO.ninja room for all lines + mobile Comms |
| `comms_password` | Optional room password (appended to all URLs) |
| `input_device_uid` / `output_device_uid` | Global CoreAudio device UIDs |
| `webrtc_lan_mode` | `true` = strip ICE servers in preloads + `stunonly=1` on URLs. Default `false` (WAN) |
| `webrtc_turn_off` / `webrtc_stun_only` | Additional URL params for WebRTC behavior |
| `lines[].group` | Party-line identity inside the room (from line name) |
| `lines[].input_channel` / `output_channel` | Hardware channel index (0-based) |
| `lines[].input_device_uid` / `output_device_uid` | Per-PL dedicated device UID; `null` falls back to global |
| `lines[].gain_in` / `gain_out` | Capture and playback gain multiplier (0–10×) |

**Migration:** legacy per-line `room_key` configs are upgraded in `migrateConfig()` to `comms_room` + `group`. `webrtc_*` fields use null-guard defaults so they are never forcibly overwritten.

**Session export:** v2 base64 JSON `{ v: 2, comms_room, comms_password, lines: [{ id, name, group }] }`.

---

## VDO.ninja URL builders (`renderer/app.js`)

- `commsJoinUrl()` — mobile: `/comms?room=&groups=&groupmode=1`
- `lineUrl(line)` — desktop push: `room`, `push=<room>_<group>`, `group`, `groupmode=1`, audio-only flags
- `directorUrl()` — `director=<comms_room>`, all groups
- `applyWebRtcParams()` — adds `turn=off` / `stunonly=1` when LAN mode is on

---

## Main process audio flow (`main.js`)

### Shared session (global device)

1. `coreAudio.startAudio(capUid, nIn, pbUid, nOut, captureCallbackLogged)` → `"default"` session
2. `channelViews` maps input channel → `webContents.id` for shared lines
3. `captureCallback(ch, samples)` applies `gain_in`, sends `audio-frame` to matching view
4. `playback-frame` IPC → `coreAudio.pushPlaybackSamples('default', outCh, floats, liveGain)`
5. `disconnect-line` → `coreAudio.clearPlaybackChannel(outputChannel)`

### Per-PL session (dedicated device)

1. `connect-line` detects `shouldUsePerSession` (has own devices, different from global)
2. `coreAudio.startSession('pl-N', capUid, 1, pbUid, 1, cb)` — separate `AudioEngine`
3. Capture callback sends `audio-frame` to `sessionViews[lineId]`
4. `playback-frame` → `coreAudio.pushPlaybackSamples(lc.playbackSessionId, 0, floats, liveGain)`
   - `playbackSessionId` = `'pl-N_pb'` (separate in/out devices) or `'pl-N'` (duplex)
5. `disconnect-line` → `coreAudio.stopSession('pl-N')`

### Gain cache

`inputGainByChannel` and `outputGainByLineId` maps are updated by `updateGainCache(cfg)` on load and on config save (not on audio restart). `gain_in` is applied in `captureCallback`; `gain_out` is looked up live in the `playback-frame` handler.

---

## Native addon (`coreaudio.mm`)

`std::map<string, AudioEngine> g_sessions` — one engine per session ID.

| Export | Signature |
|--------|-----------|
| `startSession` | `(sessionId, capUid, capCh, pbUid, pbCh, capCb)` |
| `stopSession` | `(sessionId)` — also stops `sessionId + "_pb"` |
| `startAudio` | Legacy — delegates to `startSessionImpl("default", ...)` |
| `stopAudio` | Legacy — stops `"default"` + `"default_pb"` |
| `pushPlaybackSamples` | `(sessionId, ch, data, gain)` or legacy `(ch, data, gain)` |
| `clearPlaybackChannel` | `(ch [, sessionId="default"])` |
| `listDevices` | Returns UID, name, inChannels, outChannels |
| `playTestTone` | `(ch, ms)` — injects a sine wave into playback ring |

HAL callbacks use `clientData = &eng.uid` (pointer to the session ID string stored inside the `AudioEngine`). `stopSession` calls `AudioDeviceStop` outside `g_sessionsMutex` to avoid deadlock, then erases the map entry under lock.

Max 16 channels; 48 kHz expected; ring capacity 192 000 frames; max latency 4 800 frames (~100 ms).

---

## Current status

See [known-issues.md](known-issues.md) for the full list. Summary:

- **Working:** full duplex hardware routing, per-PL device sessions, grouped Comms room, live level meters, audio bleed isolation, session import/export, configurable LAN/WAN mode
- **Open:** same-output-channel conflict (no UI warning), high-gain hard clipping (no soft limiter), unsigned DMG, macOS-only, `setPreloads` deprecation

---

## Test environment notes

- Apple Silicon MacBook Pro (arm64)
- Typical devices: Behringer UMC404HD, BlackHole 2ch/16ch, built-in mic, USB headsets
- macOS TCC microphone: `systemPreferences.askForMediaAccess('microphone')` on launch
- App unsigned — right-click → Open on first launch
