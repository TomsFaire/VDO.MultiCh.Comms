# Development Handoff — VDO.MultiCh.Comms

**Date:** 2026-06-15  
**Current version:** 0.1.1 (see `app/build-meta.json` for build number)  
**Branch:** `feature/comms-single-room`

---

## What this project is

A macOS Electron app for multi-channel IP intercom. It connects up to four **party lines** to a **single VDO.ninja Comms room**, with each line as a **group** inside that room. Broadcast crew (e.g. at a live event) route hardware audio channels independently while mobile users join one Comms link.

**Architecture:**

```
Hardware mic / BlackHole (CoreAudio)
  → coreaudio.node N-API addon (main process)
  → captureCallback → webContents.send('audio-frame', ch, samples)
  → Per-line preload (AudioWorklet getUserMedia override)
  → VDO.ninja push (group-scoped, room=comms_room)
  → WebRTC → remote participants

Remote audio (inbound)
  → Same WebContentsView (group-scoped listen)
  → DOM remote-tap + AudioWorklet
  → ipcRenderer.send('playback-frame', outCh, samples, gain)
  → coreAudio.pushPlaybackSamples() → hardware output channel
```

The **Rust shim** (`shim/`, CPAL, WebSocket :9696) was **deleted** in v0.1.1. Do not resurrect it — all audio I/O is in `app/native/coreaudio.mm`.

---

## Repo layout

```
app/
  main.js              Main process — CoreAudio, IPC, WebContentsView, line preloads
  preload.js           Renderer preload — IPC bridge
  build-meta.json      { "version", "build" } — bumped by scripts/bump-build.js
  package.json         electron-builder; extraResources ships coreaudio.node
  renderer/
    app.js             UI — comms bar, groups, line connect, settings
    index.html         UI shell
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

Rebuild after any change to `coreaudio.mm`.

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

### Logs from packaged app

```bash
/path/to/VDO.MultiCh.Comms.app/Contents/MacOS/VDO.MultiCh.Comms
```

Eject a mounted DMG before rebuilding:

```bash
hdiutil detach "/Volumes/VDO.MultiCh.Comms <version>" -force
```

### CI

`.github/workflows/release.yml` — single job: build native addon, `npm run build`, ad-hoc sign DMG, publish on `v*.*.*` tags. No Rust shim step.

---

## Config model

Path: `~/.vdo-multichan/config.json`

| Field | Purpose |
|-------|---------|
| `comms_room` | Single VDO.ninja room for all lines + mobile Comms |
| `comms_password` | Optional room password (appended to all URLs) |
| `lines[].group` | Party-line identity inside the room (from line name) |
| `lines[].input_channel` / `output_channel` | Hardware channel index (0-based) |
| `input_device_uid` / `output_device_uid` | CoreAudio device UID |
| `webrtc_lan_mode` | Default `true` — strip ICE in preloads, `turn=off` on URLs |
| `webrtc_turn_off` / `webrtc_stun_only` | URL params for WebRTC behavior |

**Migration:** legacy per-line `room_key` configs are upgraded in `migrateConfig()` (`main.js`) to `comms_room` + `group`.

**Session export:** v2 base64 JSON `{ v: 2, comms_room, comms_password, lines: [{ id, name, group }] }`. v1 (room_key list) still imports.

---

## VDO.ninja URL builders (`renderer/app.js`)

- `commsJoinUrl()` — mobile: `/comms?room=&groups=&groupmode=1`
- `lineUrl(line)` — desktop push: `room`, `push=<room>_<group>`, `group`, `groupmode=1`, audio-only flags
- `directorUrl()` — `director=<comms_room>`, all groups

`applyWebRtcParams()` adds `turn=off` and `stunonly` when LAN mode is on.

---

## Main process audio flow (`main.js`)

1. `coreAudio.startAudio(capUid, nIn, pbUid, nOut, captureCallbackLogged)` — unified session
2. `channelViews` maps input channel → `webContents.id` for active lines
3. `captureCallback` sends `audio-frame` to the matching line view
4. `playback-frame` IPC → `coreAudio.pushPlaybackSamples(outCh, floats, gain)`
5. `disconnect-line` → `coreAudio.clearPlaybackChannel(outputChannel)`

### Line views

- `connect-line` writes a temp preload (`buildLineShim`) — name is historical; it’s an IPC AudioWorklet bridge, not the Rust shim
- One `WebContentsView` per line, muted speaker output (`setAudioMuted(true)`)
- Preload patches `RTCPeerConnection` when `webrtc_lan_mode` strips ICE servers
- Staggered connect delay in renderer when multiple lines connect (`otherConnected * 1500ms`)

---

## Native addon (`coreaudio.mm`)

- `listDevices()` — UID, name, in/out channel counts
- `startAudio` / `stopAudio` — IO proc capture + per-channel playback rings
- `pushPlaybackSamples(channel, float32, gain)`
- `clearPlaybackChannel(channel)` — on remote track teardown
- `playTestTone(channel, ms)` — settings/debug

Max 16 channels; 48 kHz expected.

---

## Current status

See [known-issues.md](known-issues.md) for the full list. Summary:

- **Working:** full duplex hardware routing, grouped Comms room, session import/export, LAN WebRTC mode
- **Open:** cross-NAT (needs TURN + `webrtc_lan_mode: false`), unsigned DMG, macOS-only, `setPreloads` deprecation

---

## Test environment notes

- Apple Silicon MacBook Pro (arm64)
- Typical devices: BlackHole 2ch/16ch, built-in mic, NDI Audio, ZoomAudioDevice
- macOS TCC microphone: `systemPreferences.askForMediaAccess('microphone')` on launch
- App unsigned — right-click → Open on first launch
