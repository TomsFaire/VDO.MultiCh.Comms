# Development Guide

**Version:** v0.1.1

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

See [superpowers/specs/2026-06-02-github-actions-release-design.md](superpowers/specs/2026-06-02-github-actions-release-design.md) for the full design.

To cut a release:

```bash
# Update app/package.json and app/build-meta.json version
git add app/package.json app/build-meta.json
git commit -m "chore: bump version to x.y.z"
git tag vx.y.z
git push origin vx.y.z
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
  development.md       This file
  handoff.md           Maintainer handoff (deeper IPC/config detail)
  known-issues.md      Status and bugs
  self-hosting.md      VDO.ninja / TURN
```

---

## Architecture notes

### CoreAudio capture and playback

The N-API addon (`coreaudio.node`) opens configured input/output devices. The IO proc callback de-interleaves capture buffers and invokes a JS callback per channel. Playback uses per-output-channel ring buffers fed by `pushPlaybackSamples()` from the renderer preload.

### IPC audio bridge

Each active line registers its input channel in `channelViews`. Main process sends `audio-frame` to the line's hidden `WebContentsView`. The per-line preload feeds an `AudioWorkletNode` ring buffer and resolves the `getUserMedia` override with a `MediaStreamDestination` stream.

Inbound remote audio is tapped from VDO.ninja media elements, batched in an AudioWorklet, and sent back via `playback-frame` IPC to the matching hardware output channel.

### Single room, grouped lines

- **Mobile Comms:** `/comms?room=<comms_room>&groups=<g1>,<g2>,…&groupmode=1`
- **Desktop line push:** `room=<comms_room>&push=<comms_room>_<group>&group=<group>&groupmode=1`
- **Director:** `director=<comms_room>&groups=<all>&groupmode=1`

One hidden `WebContentsView` per line handles both publish and group-scoped listen.

### LAN WebRTC mode

When `webrtc_lan_mode` is true (default), line preloads patch `RTCPeerConnection` to strip `iceServers`, and join URLs include `turn=off` + `stunonly`. This avoids Electron DNS failures against public STUN/TURN hostnames on LAN-only shows.

### Device change

Saving new input/output devices restarts the unified CoreAudio session via `applyAudioFromConfig()`. Active lines keep their VDO.ninja views; capture routing updates via `channelViews`.

---

## Further reading

- [handoff.md](handoff.md) — config model, URL builders, native addon API
- [known-issues.md](known-issues.md) — open limitations and resolved shim-era issues
