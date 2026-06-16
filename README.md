# VDO.MultiCh.Comms

> **Alpha — v0.1.1.** Not production-ready. Expect rough edges.

Multi-channel IP intercom built on [VDO.ninja](https://vdo.ninja) (WebRTC) and macOS CoreAudio hardware I/O. Designed for live production environments where you need independent party lines routed to a multi-channel audio interface — without a separate audio daemon or WebSocket bridge.

4 independent party lines share **one VDO.ninja Comms room**; each line is a **group** inside that room. Remote participants join from any mobile browser via a QR code — no app install required.

---

## Install

1. Download `VDO.MultiCh.Comms-0.1.1-arm64.dmg` from the [Releases page](https://github.com/TomsFaire/VDO.MultiCh.Comms/releases)
2. Mount the DMG and drag the app to Applications
3. **Right-click → Open** on first launch — the app is ad-hoc signed but not notarized; Gatekeeper blocks a normal double-click until you explicitly allow it

No Rust or Node.js required for end users.

See [docs/usage.md](docs/usage.md) for a full walkthrough (setup wizard, Comms QR, audio routing, session export).

---

## What's new in v0.1.1

- **CoreAudio N-API addon** replaces the Rust CPAL shim — audio I/O runs in-process, no WebSocket on port 9696
- **Single Comms room + groups** — one mobile QR/link for the whole event; lines are VDO.ninja groups inside that room
- **Full duplex hardware routing** — remote audio returns to the configured output channel, not just system speakers
- **LAN WebRTC mode** (default) — strips ICE servers in Electron views to avoid DNS failures on same-LAN shows
- **GitHub Actions releases** — tagged `v*.*.*` builds publish a signed DMG and SHA-256 checksums automatically

---

## How it works

```
Hardware mic / BlackHole (CoreAudio)
  → coreaudio.node N-API addon (main process, per-channel capture)
  → Electron IPC (audio-frame per input channel)
  → Per-line preload (AudioWorklet getUserMedia override)
  → VDO.ninja push (group-scoped, single comms room)
  → WebRTC → remote participants (phone, web browser)

Remote audio (inbound)
  → VDO.ninja group-scoped playback in same session
  → DOM remote-tap + AudioWorklet (per-line preload)
  → Electron IPC (playback-frame)
  → coreaudio.node → hardware output channel
```

**Hardware I/O** runs in-process via a native **CoreAudio N-API addon** (`coreaudio.node`). Capture is clocked by the audio device callback; each input channel is forwarded over Electron IPC to the matching line’s hidden `WebContentsView`.

**VDO.ninja** uses a **single comms room** (`comms_room`) with **group mode** (`groupmode=1`). Each party line publishes to `push=<room>_<group>` and listens only within its group — no separate room URL per line, no second listen-only session. Mobile clients open one `/comms?room=…&groups=…` link and pick a line button before talking.

The old **Rust shim** (CPAL + WebSocket on port 9696) has been **removed**. Audio no longer crosses a local WebSocket or a separate process.

---

## Status

| Feature | Status |
|---|---|
| First-run setup wizard (event name + line naming) | ✅ Done |
| Session export / import (base64 code) | ✅ Done |
| Single Comms room + per-line groups | ✅ Done (v0.1.1) |
| Per-line QR codes and join links | ✅ Done |
| Director link (all groups in one room) | ✅ Done |
| VDO.ninja WebContentsView auto-join (silent, audio-only) | ✅ Done |
| CoreAudio N-API capture + playback | ✅ Done |
| In-process IPC audio bridge (no WebSocket shim) | ✅ Done (v0.1.1) |
| Combined push + group listen in one view per line | ✅ Done (v0.1.1) |
| LAN WebRTC mode (strip ICE servers in Electron) | ✅ Done (v0.1.1) |
| Device enumeration from CoreAudio (channel counts) | ✅ Done |
| Mic/device change restarts unified audio | ✅ Done |
| Build number auto-bump + DMG packaging | ✅ Done |
| macOS TCC microphone permission | ✅ Done |
| Inbound audio (remote → hardware output channel) | ✅ Done (v0.1.1) |
| Outbound audio (hardware → VDO.ninja) | ✅ Working |
| STUN/TURN (cross-NAT) | ⏳ LAN only for now |
| Code signing | ⏳ Post-alpha |
| `session.setPreloads` → `registerPreloadScript` | ⏳ Low priority |

---

## Prerequisites

- macOS (Apple Silicon — arm64 DMG)
- Node.js 18+ and npm — to build the Electron app and native addon
- Xcode Command Line Tools — for `node-gyp` / CoreAudio N-API build
- A multi-channel audio interface (e.g. BlackHole, Focusrite), or use the Mac’s built-in mic

---

## Getting started (developers)

Build from source or see [docs/development.md](docs/development.md) for CI and release tagging.

### 1. Build the CoreAudio native addon

```bash
cd app/native
npm install
npm run build
# Output: app/native/build/Release/coreaudio.node
```

### 2. Install and launch the Electron app (dev)

```bash
cd app
npm install
npm start
```

Config lives at `~/.vdo-multichan/config.json` and is created on first run.

### 3. Build a distributable DMG

```bash
cd app/native && npm install && npm run build
cd .. && npm run build
# Output: app/dist/VDO.MultiCh.Comms-<version>-arm64.dmg
```

The app is unsigned — right-click → Open on first launch on any machine.

---

## Configuration

`~/.vdo-multichan/config.json` — written by the app UI, editable manually.

```json
{
  "instance_name": "faire-2026",
  "comms_room": "faire2026",
  "comms_password": "",
  "vdo_base_url": "https://vdo.ninja",
  "input_device_uid": "<CoreAudio device UID>",
  "output_device_uid": "<CoreAudio device UID>",
  "sample_rate": 48000,
  "webrtc_lan_mode": true,
  "lines": [
    { "id": 0, "name": "PL1", "group": "pl1", "input_channel": 0, "output_channel": 0, "gain_in": 1.0, "gain_out": 1.0 },
    { "id": 1, "name": "PL2", "group": "pl2", "input_channel": 1, "output_channel": 1, "gain_in": 1.0, "gain_out": 1.0 }
  ]
}
```

- **`comms_room`** — single VDO.ninja room shared by all lines and the mobile Comms UI.
- **`group`** (per line) — party-line identity inside that room; derived from the line name at setup. Renaming a line updates the label, not necessarily the stored group (edit in settings if you need to change routing).
- Legacy configs with per-line `room_key` are migrated automatically into `comms_room` + `group`.

---

## Joining a party line

**Mobile / remote:** scan the **Comms** QR code (one link for the whole event). On the Comms page, tap the button for the party line you want before talking — ungrouped audio is heard on all lines.

**Per-line panel:** each line still shows its own director/push URL for the desktop operator view (group-scoped push into the shared room).

1. Scan the QR code or open the link on any device
2. Allow microphone access when prompted
3. Select your party line (Comms UI) or connect from the desktop panel
4. You're in — no install, no account

---

## Architecture notes

### CoreAudio capture and playback

The N-API addon opens the configured input/output devices (or duplex on the same device). The IO proc callback de-interleaves capture buffers and invokes a JS callback per channel. Playback uses per-output-channel ring buffers fed by `pushPlaybackSamples()` from the renderer preload’s remote-tap path.

### IPC audio bridge (replaces Rust shim)

Each active line registers its input channel in `channelViews`. When a capture frame arrives for that channel, main process sends `audio-frame` over `webContents.send()` to the line’s hidden view. The injected preload feeds an `AudioWorkletNode` ring buffer and resolves the `getUserMedia` override with a `MediaStreamDestination` stream.

Inbound remote audio is tapped from VDO.ninja `<video>` / `<audio>` elements in the same view, batched in an AudioWorklet, and sent back via `playback-frame` IPC to the matching output channel.

### Single room, grouped lines

Instead of four separate VDO.ninja rooms (four push sessions + four listen sessions), the app uses:

- **Operator / mobile Comms:** `https://vdo.ninja/comms?room=<comms_room>&groups=<g1>,<g2>,…&groupmode=1`
- **Per-line desktop push:** `room=<comms_room>&push=<comms_room>_<group>&group=<group>&groupmode=1`

One hidden `WebContentsView` per line handles both publish and group-scoped listen.

### Device change

Saving new input/output devices restarts the unified CoreAudio session. Active lines keep their VDO.ninja views; capture routing updates via `channelViews` on reconnect.

---

## Documentation

| Doc | Audience |
|-----|----------|
| [docs/usage.md](docs/usage.md) | End users — setup, Comms QR, audio devices, session codes |
| [docs/development.md](docs/development.md) | Developers — build from source, repo layout, architecture |
| [docs/self-hosting.md](docs/self-hosting.md) | Ops — self-hosted VDO.ninja, TURN, LAN vs cross-NAT |
| [docs/known-issues.md](docs/known-issues.md) | Status, resolved issues, open limitations |
| [docs/handoff.md](docs/handoff.md) | Maintainer handoff — config model, IPC flow, CI |

---

## Contributing

Alpha-stage project. Issues and PRs welcome. To build from source or cut a release, see [docs/development.md](docs/development.md).
