# Development Guide

**Version:** v0.1.4

---

## Prerequisites

- macOS arm64 (Apple Silicon)
- Node.js 18+ and npm
- Xcode Command Line Tools (for `node-gyp` / CoreAudio N-API build)

The Rust shim was removed in v0.1.1. You do **not** need Rust.

---

## Build the CoreAudio native addon

Required before dev run or DMG build.

```bash
cd app/native
npm install
npm run build
# → app/native/build/Release/coreaudio.node
```

Rebuild after any change to `coreaudio.mm`.

---

## Run in dev mode

```bash
cd app
npm install
npm start
```

Config is created on first run at `~/.vdo-multichan/config.json`.

---

## Build a distributable DMG

```bash
cd app/native && npm install && npm run build
cd .. && npm run build
# → app/dist/VDO.MultiCh.Comms-<version>-arm64.dmg
```

`scripts/bump-build.js` auto-increments the build number in `app/build-meta.json` before each dist build.

Pre-built releases are published on the [GitHub Releases page](https://github.com/TomsFaire/VDO.MultiCh.Comms/releases) when a `v*.*.*` tag is pushed.

---

## Viewing logs from the packaged app

```bash
/Applications/VDO.MultiCh.Comms.app/Contents/MacOS/VDO.MultiCh.Comms
```

Eject a mounted DMG before rebuilding:

```bash
hdiutil detach "/Volumes/VDO.MultiCh.Comms <version>" -force
```

---

## CI / releases

`.github/workflows/release.yml` runs on tag push `v*.*.*`:

1. `npm ci` in `app/`
2. Build `coreaudio.node` in `app/native/`
3. `npm run build` → DMG
4. Ad-hoc sign, SHA-256 checksums, publish via `softprops/action-gh-release`

To cut a release:

```bash
# 1. Update version in app/package.json and app/build-meta.json
# 2. Commit, tag, push
git add app/package.json app/build-meta.json
git commit -m "chore: bump version to x.y.z"
git tag vx.y.z
git push origin vx.y.z
# CI builds and publishes the DMG automatically
```

---

## Repo layout

```
app/
  main.js              Main process — CoreAudio, IPC, WebContentsView, line preloads
  preload.js           Renderer preload — IPC bridge
  build-meta.json      { "version", "build" }
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
  development.md       This file
  handoff.md           Maintainer handoff (deeper IPC/config detail)
  known-issues.md      Status and bugs
  self-hosting.md      VDO.ninja / TURN
  screenshot-v0.1.3.png  UI screenshot
```

---

## Architecture notes

### CoreAudio sessions

The N-API addon (`coreaudio.node`) manages a `std::map<string, AudioEngine>` keyed by session ID:

- **`"default"`** — shared session opened by `startAudio(capUid, nIn, pbUid, nOut, cb)` at startup. Handles all lines that use the global device. Capture is demultiplexed per channel; playback is per-channel ring buffers.
- **`"pl-N"` / `"pl-N_pb"`** — per-PL sessions opened by `startSession(sessionId, capUid, capCh, pbUid, pbCh, cb)` when a line has dedicated devices. Separate capture callback and playback ring for full isolation.

Key exports: `startSession`, `stopSession`, `pushPlaybackSamples(sessionId, ch, data, gain)`, `clearPlaybackChannel(ch, sessionId)`, `listDevices`, `playTestTone`.

### IPC audio bridge

- **Capture:** `captureCallback(ch, samples)` looks up `channelViews[ch]` (shared) or `sessionViews[lineId]` (per-PL) and calls `webContents.send('audio-frame', ch, samples)` to the correct line view. Input gain (`gain_in`) is applied before send.
- **Playback:** line shims call `ipcRenderer.send('playback-frame', outCh, samples, gain)`. Main process routes to `pushPlaybackSamples('pl-N', 0, ...)` for per-PL sessions or `pushPlaybackSamples('default', outCh, ...)` for shared lines. Output gain is read from the live `outputGainByLineId` cache.

### Shim (per-line preload)

`buildLineShim(inputChannel, outputChannel, gainOut, group, stripIce)` generates a preload script written to a temp file at connect time. It:

1. Overrides `getUserMedia` to inject an `AudioWorklet`-fed `MediaStreamDestination` stream (mic path)
2. Patches `RTCPeerConnection` to strip ICE servers when `STRIP_ICE` is true
3. Watches DOM for `<video>`/`<audio>` elements — immediately mutes them (`el.muted = true; el.volume = 0`) and taps their `srcObject` via a second AudioWorklet (remote tap path)
4. Sends captured remote audio frames back via `playback-frame` IPC

### LAN vs WAN mode

`webrtc_lan_mode: true` → `STRIP_ICE = true` in the shim (strips `iceServers` from all `RTCPeerConnection` configs) and adds `stunonly=1` to VDO.ninja URLs. Suppresses Chromium DNS resolution errors for TURN hosts on isolated LANs. Default is `false` (WAN/TURN enabled) for cross-building deployments.

### Level meters

`coreAudio.startAudio` fires ~30 times/sec. Main process tracks rolling peaks in `capturePeaks` and `playbackPeaks` maps (decayed by `LEVEL_DECAY = 0.85` each tick). Sent to renderer via `audio-levels` IPC; renderer maps 0–0.5 float to 0–100% bar width with color thresholds at 60% (yellow) and 95% (red).

---

## Further reading

- [handoff.md](handoff.md) — config model, URL builders, native addon API
- [known-issues.md](known-issues.md) — open limitations and resolved issues
