# Documentation Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh all project docs for v0.1.0 — replace build-from-source install with a download-DMG flow, add a full usage walkthrough, move developer build instructions to a dedicated file, and refresh all existing docs for version accuracy.

**Architecture:** Six independent file edits — README.md rewritten as a clean landing page; two new files created (docs/usage.md, docs/development.md); three existing docs refreshed (known-issues.md, self-hosting.md, handoff.md). Each task is self-contained and can be reviewed independently.

**Tech Stack:** Markdown

---

## File Map

| Action | Path |
|--------|------|
| Modify | `README.md` |
| Create | `docs/usage.md` |
| Create | `docs/development.md` |
| Modify | `docs/known-issues.md` |
| Modify | `docs/self-hosting.md` |
| Modify | `docs/handoff.md` |

---

### Task 1: Rewrite README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the full contents of `README.md`**

Write the following content to `README.md`:

```markdown
# VDO.MultiCh.Comms

> **v0.1.0** — Alpha. Not production-ready. Expect rough edges.

A macOS desktop app that turns a multi-channel audio interface into a multi-party-line IP intercom — no SIP, no server, no install for remote participants.

---

## What it does

- **4 independent party lines**, each a separate WebRTC room — crews on different lines don't hear each other
- **Remote participants join from any phone or browser via QR code** — no app, no account required
- **Hardware audio routed per channel** via a Rust/CPAL shim; works with BlackHole, Focusrite, and other multi-channel interfaces
- **WebRTC transport via [VDO.ninja](https://vdo.ninja)** — handles NAT traversal, codec negotiation, and mixing

---

## Requirements

- macOS Apple Silicon (arm64)
- A multi-channel audio interface (e.g. BlackHole, Focusrite), or use the Mac's built-in mic
- No Rust or Node.js required for end-users

---

## Install

1. Download `VDO.MultiCh.Comms-0.1.0-arm64.dmg` from the [Releases page](../../releases)
2. Mount the DMG and drag the app to Applications
3. **Right-click → Open** on first launch — the app is ad-hoc signed but not notarized; Gatekeeper will block a normal double-click until you explicitly allow it

---

## Getting started

On first launch a setup wizard prompts for an event name and up to 4 line names. Room keys are generated once from those names and are permanent.

Each line panel shows a QR code. Remote participants scan it, allow microphone access, and are immediately connected.

See [docs/usage.md](docs/usage.md) for a full walkthrough including audio device setup, session export/import, and the director view.

---

## How it works

```
Hardware mic / BlackHole
  → Rust shim (CPAL, per-channel capture)
  → WebSocket ws://127.0.0.1:9696
  → Electron WebContentsView preload (AudioWorklet bridge)
  → VDO.ninja getUserMedia override
  → WebRTC → remote participants (phone, web browser)
```

The **Rust shim** handles hardware audio I/O. It captures from a physical or virtual audio interface, accumulates per-channel PCM frames, and broadcasts them over a local WebSocket the moment each frame is ready — clocked by the hardware audio callback, not a software timer.

The **Electron app** embeds one VDO.ninja room per party line in a hidden `WebContentsView`. A per-line preload script intercepts `getUserMedia` and feeds the shim's audio stream into VDO.ninja instead of the hardware mic. VDO.ninja handles WebRTC, NAT traversal, codec negotiation, and mixing.

Remote participants scan a QR code and join from any device — no install required.

---

## Status

| Feature | Status |
|---|---|
| First-run setup wizard (event name + line naming) | ✅ Done |
| Session export / import (base64 code) | ✅ Done |
| Per-line QR codes and join links | ✅ Done |
| Director link per panel | ✅ Done |
| VDO.ninja WebContentsView auto-join (silent, audio-only) | ✅ Done |
| Rust shim — CPAL capture + playback | ✅ Done |
| Shim → VDO.ninja AudioWorklet bridge | ✅ Stable |
| Hardware-clocked broadcast dispatch (no timer drift) | ✅ Done |
| Mic change reconnects active lines automatically | ✅ Done |
| 2-machine party line (PoC validated) | ✅ Done |
| Device enumeration from shim (CPAL channel counts) | ✅ Done |
| Build number auto-bump + DMG packaging | ✅ Done |
| macOS TCC microphone permission | ✅ Done |
| Inbound audio (remote → local speakers) | ✅ Done |
| Outbound audio via shim bridge | ✅ Stable |
| Inbound audio → hardware output channels | ⏳ Not yet wired |
| STUN/TURN (cross-NAT) | ⏳ LAN only for now |
| Code signing / notarization | ⏳ Post-alpha |

---

## Configuration

`~/.vdo-multichan/config.json` — written by the app UI, editable manually.

```json
{
  "instance_name": "faire-2026",
  "vdo_base_url": "https://vdo.ninja",
  "input_device": "BlackHole 2ch",
  "output_device": "",
  "sample_rate": 48000,
  "lines": [
    { "id": 0, "name": "PL1", "room_key": "pl1abc123", "input_channel": 0, "output_channel": 0, "gain_in": 1.0, "gain_out": 1.0 },
    { "id": 1, "name": "PL2", "room_key": "pl2def456", "input_channel": 1, "output_channel": 1, "gain_in": 1.0, "gain_out": 1.0 }
  ]
}
```

Room keys are permanent — derived from line names at first-run setup. Renaming a line in settings does not change its room key.

---

## Self-hosting

See [docs/self-hosting.md](docs/self-hosting.md) for running your own VDO.ninja instance and TURN server.

---

## Development

See [docs/development.md](docs/development.md) for source build instructions, repo layout, and architecture notes.

---

## Known issues

See [docs/known-issues.md](docs/known-issues.md).

---

## Contributing

Alpha-stage project. Issues and PRs welcome.
```

- [ ] **Step 2: Verify key content is present**

```bash
grep -c "v0.1.0" README.md
grep -c "docs/usage.md" README.md
grep -c "docs/development.md" README.md
grep -c "Right-click" README.md
grep -c "2-machine party line" README.md
```
Expected: each command prints `1`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for v0.1.0 release — install from DMG, usage/dev links"
```

---

### Task 2: Create docs/usage.md

**Files:**
- Create: `docs/usage.md`

- [ ] **Step 1: Write `docs/usage.md`**

```markdown
# Usage Guide

## First run

On first launch a setup wizard prompts for:

- **Event name** — identifies this instance (e.g. `faire-2026`)
- **Line names** — up to 4 names, one per party line (e.g. `Stage`, `FOH`, `Truck`, `Green Room`)

Room keys are generated once from the line names and are permanent. Renaming a line later in Settings does **not** change its room key — the same QR codes and join links remain valid.

---

## Audio device setup

1. Open Settings (gear icon, top right)
2. Select **Input device** — your audio interface, BlackHole channel, or built-in mic
3. Select **Output device** — where remote participants' audio plays back
4. Assign **Input channel** and **Output channel** per line (0-based index):
   - Line 1 on channel 0, Line 2 on channel 1, etc.
   - BlackHole 16ch: channels 0–15 available; BlackHole 2ch: channels 0–1
5. Click **Save** — the shim restarts automatically with the new device

> The shim enumerates your audio interface's actual channel count. If a device shows fewer channels than expected, check that the interface is connected before launching the app.

---

## Sharing a line

Each line panel shows:

- **QR code** — scan from any phone camera app
- **Copy link button** — paste into any messaging app or browser
- **Director link** (person icon) — opens the VDO.ninja director view for that room in your system browser; lets you see and manage all participants on that line

Remote participants:
1. Scan the QR code or open the link on any device
2. Allow microphone access when prompted
3. They're immediately connected — no app, no account required

---

## During a session

Each panel shows the line name and a connection indicator. The app runs all lines simultaneously — each is an independent WebRTC room.

Participant muting is handled within VDO.ninja via the director view. There is no per-participant mute in the app UI.

---

## Session export / import

Use this to move your configuration between machines, back it up, or restore after reinstall.

**Export:**
1. Open Settings
2. Click **Export** — a base64 code is copied to your clipboard
3. Save the code somewhere safe (notes app, message to yourself)

**Import:**
1. Open Settings on the target machine
2. Click **Import** and paste the code
3. Save — the app restores all line names, room keys, and device config

Imported sessions use the same room keys, so the same QR codes work on both machines simultaneously.

---

## Quitting and restarting

Config is saved at `~/.vdo-multichan/config.json` and persists across restarts. Lines reconnect automatically on next launch.

To reset completely, delete `~/.vdo-multichan/config.json` — the setup wizard runs again on next launch.
```

- [ ] **Step 2: Verify key sections are present**

```bash
grep -c "First run" docs/usage.md
grep -c "Audio device setup" docs/usage.md
grep -c "Sharing a line" docs/usage.md
grep -c "Session export" docs/usage.md
grep -c "Quitting" docs/usage.md
```
Expected: each command prints `1`

- [ ] **Step 3: Commit**

```bash
git add docs/usage.md
git commit -m "docs: add usage.md — full end-user walkthrough for v0.1.0"
```

---

### Task 3: Create docs/development.md

**Files:**
- Create: `docs/development.md`

- [ ] **Step 1: Write `docs/development.md`**

```markdown
# Development Guide

## Prerequisites

- macOS arm64 (Apple Silicon)
- [Rust](https://rustup.rs) stable toolchain
- Node.js 18+

---

## Build the shim

```bash
cd shim
cargo build --release
```

Rebuild whenever `shim/src/audio.rs` or `shim/src/main.rs` changes.

---

## Run in dev mode

The shim must be built before starting the app in dev mode.

```bash
cd app
npm install
npm start
```

The app spawns the pre-built shim binary automatically on startup.

---

## Build a distributable DMG

```bash
cd shim && cargo build --release
cd ../app && npm run build
# Output: app/dist/VDO.MultiCh.Comms-0.1.0-arm64.dmg
```

The build number in `app/build-meta.json` auto-increments on each DMG build. The v0.1.0 release DMG is also available on the [GitHub Releases page](../../releases).

---

## Viewing logs from the packaged app

Run the app binary directly from Terminal to see stdout/stderr:

```bash
/Applications/VDO.MultiCh.Comms.app/Contents/MacOS/VDO.MultiCh.Comms
```

If a previously mounted DMG is blocking install, eject it first:

```bash
hdiutil detach "/Volumes/VDO.MultiCh.Comms 0.1.0" -force
```

---

## Repo layout

```
app/              Electron app (Node.js main + HTML/JS renderer)
  main.js         Main process — shim lifecycle, IPC, WebContentsView setup
  preload.js      Renderer preload — exposes IPC to renderer
  renderer/
    app.js        UI logic (connectShim closes after device list — critical)
    index.html    UI shell + styles
  assets/
    icon.icns     App icon
  scripts/
    bump-build.js Auto-increments build-meta.json before each dist build
  build-meta.json { "version": "0.1.0", "build": 28 }
  package.json    electron-builder config, targets mac arm64 DMG

shim/             Rust audio shim
  src/main.rs     WebSocket server, broadcast dispatch
  src/audio.rs    CPAL capture (broadcast) + playback (ring buffer)
```

---

## Architecture notes

### Shim broadcast dispatch

The CPAL input callback accumulates interleaved samples into pre-allocated per-channel `Vec<f32>` buffers. When all channels reach `FRAME_SIZE` (480 samples = 10ms @ 48kHz), a multi-channel binary packet is packed and sent via `tokio::sync::broadcast::Sender`. `send()` is non-async and safe to call from the real-time CPAL thread.

Packet format: `[ch: u32 LE][n_samples: u32 LE][samples: f32[] LE]` × N channels (N = actual device channel count, max `CHANNEL_COUNT=4`).

Each WebSocket client subscribes independently with `frame_tx.subscribe()` — no shared consumer contention. If a client lags, the broadcast drops old frames with a `Lagged` warning rather than applying backpressure.

### AudioWorklet bridge

Each VDO.ninja `WebContentsView` gets a per-line preload script loaded via `session.setPreloads`. The preload overrides `navigator.mediaDevices.getUserMedia` synchronously before any VDO.ninja JS runs.

On async init it opens `ws://127.0.0.1:9696`, feeds matching-channel frames into an `AudioWorkletNode` ring buffer (2s / 96000 samples, 500ms startup hold), and resolves `getUserMedia` with the `MediaStreamDestinationNode` stream. Falls back to native mic if the shim is unavailable within 10s.

`audioCtx.resume()` is called at WS open and again before resolving the stream as a defence against browser autoplay policy.

### Renderer WS connection

`app.js connectShim` connects to port 9696 solely to retrieve the device list for Settings dropdowns. **It closes immediately (code 1000) after receiving the `devices` message.** If it stayed connected, it would compete with the preload's audio receiver for broadcast frames and starve audio.

### Mic change reconnect

`lineConfigs` (map of id → `{url, channelId}`) tracks all active lines. After `killPortAndStartShim` spawns a new shim process, a 1s timer fires and reconnects every line — destroying the old `WebContentsView` and creating a new one with a fresh preload pointing to the new shim instance.

### Shim binary path

```js
app.isPackaged
  ? path.join(process.resourcesPath, 'shim')   // packaged DMG
  : path.join(__dirname, '..', 'shim', 'target', 'release', 'shim')  // dev
```

### VDO.ninja join URL

```
https://vdo.ninja/?room=ROOMKEY&webcam=1&vd=0&videodevice=0&autostart=1&label=NAME&monomic=1&proaudio=1&noisetgate=0&compressor=0&autoGain=0
```

`&webcam=1` is required for `&autostart=1` to bypass the device selection screen.
```

- [ ] **Step 2: Verify key sections are present**

```bash
grep -c "Build the shim" docs/development.md
grep -c "AudioWorklet bridge" docs/development.md
grep -c "Mic change reconnect" docs/development.md
grep -c "Shim binary path" docs/development.md
```
Expected: each command prints `1`

- [ ] **Step 3: Commit**

```bash
git add docs/development.md
git commit -m "docs: add development.md — source build, repo layout, architecture notes"
```

---

### Task 4: Refresh docs/known-issues.md

**Files:**
- Modify: `docs/known-issues.md`

- [ ] **Step 1: Replace the full contents of `docs/known-issues.md`**

```markdown
# Known Issues & Status

**Last updated:** 2026-06-02 — v0.1.0 build 28

---

## Install notes

### App is ad-hoc signed, not notarized

Right-click → Open is required on first launch on any Mac. Gatekeeper blocks a normal double-click until the user explicitly allows the app. This is expected for v0.1.0. Full Apple Developer ID notarization is planned post-alpha.

---

## Resolved

### Shim → VDO.ninja AudioWorklet bridge
**Fixed (build 28).** The bridge is working and stable.

Root causes found and fixed:
- **Shared ring buffer contention** — the renderer's device-enumeration WebSocket and the per-line preload's audio WebSocket both connected to port 9696 and competed for the same `HeapConsumer`. Fix: renderer closes its WS immediately (code 1000) after receiving the device list.
- **Timer-driven dispatch jitter** — tokio 10ms interval missed ticks under load, causing burst/drain cycles. Fix: replaced with CPAL-event-driven broadcast dispatch.
- **JS ring buffer too small** — 80ms ring exhausted by scheduler jitter. Increased to 2s (96000 samples) with 500ms startup hold.
- **DevTools flood** — underrun counter fired per-sample. Fixed to per-`process()` call.
- **`Fixed(480)` CPAL buffer size** — broke on MacBook Pro Microphone. Reverted to `Default`; the accumulator + broadcast design makes buffer size irrelevant.

### Network service crash loop
**Fixed (build 22).** `lsof -ti tcp:9696` without `-s tcp:LISTEN` matched Chromium's outbound connections to port 9696. Fixed with `lsof -ti tcp:9696 -s tcp:LISTEN`.

### Mic change not taking effect
**Fixed (build 28).** Active lines now automatically reconnect when the shim restarts after a device change.

---

## Open

### Inbound audio not routed to hardware output channels
The Rust shim has playback ring buffers (`playback_producers`) but they are not yet fed from VDO.ninja's WebRTC output. Remote audio plays through Electron's default audio output device rather than a specific hardware channel.

### STUN/TURN DNS failures in logs
`errorcode: -105` from `services/network/p2p/socket_manager.cc` — cosmetic. WebRTC falls back to host ICE candidates (direct LAN IP). Works on LAN without TURN. Will not traverse NAT without a TURN server.

**Workaround for cross-NAT use:** self-host Coturn. See [docs/self-hosting.md](self-hosting.md).

### `session.setPreloads` deprecation warning
Should migrate to `session.registerPreloadScript`. Low priority — `setPreloads` still works in the current Electron version.

---

## Working

- First-run setup wizard (event name + line names → permanent room keys)
- Session export / import (base64 code, Settings panel)
- Per-line QR codes and join links (audio-only, `&webcam=1&vd=0&autostart=1`)
- Director link per panel (`&director=ROOMKEY`, opens in system browser)
- Device enumeration (CPAL channel count probe)
- Settings dropdowns populated from shim device list
- Shim auto-starts on app launch, restarts on device change
- Active lines reconnect after shim restart
- Port 9696 cleanup — only the shim's LISTEN socket is killed
- AudioWorklet bridge: shim audio flows into VDO.ninja without hardware mic
- 2s ring buffer + 500ms startup hold — stable under normal scheduler jitter
- 2-machine party line validated (v0.1.0 PoC)
- Build number in footer, auto-incremented on each DMG build
```

- [ ] **Step 2: Verify key content**

```bash
grep -c "v0.1.0" docs/known-issues.md
grep -c "Install notes" docs/known-issues.md
grep -c "Right-click" docs/known-issues.md
grep -c "2-machine party line" docs/known-issues.md
```
Expected: each command prints `1`

- [ ] **Step 3: Commit**

```bash
git add docs/known-issues.md
git commit -m "docs: refresh known-issues for v0.1.0 — add install/Gatekeeper note, add PoC validation"
```

---

### Task 5: Refresh docs/self-hosting.md

**Files:**
- Modify: `docs/self-hosting.md`

- [ ] **Step 1: Remove the "Test connection" button reference**

Find and remove the sentence:
```
Verify with the **Test connection** button in the app Settings panel
```
from the Quick-start checklist at the bottom of `docs/self-hosting.md`.

The checklist currently ends with:
```markdown
- [ ] (Optional) Edit VDO.ninja `config.js` to use your TURN server
- [ ] Verify with the **Test connection** button in the app Settings panel
```

Replace it with:
```markdown
- [ ] (Optional) Edit VDO.ninja `config.js` to use your TURN server
- [ ] Verify by launching the app, joining a line from a remote device, and confirming audio flows
```

Also update the header version reference. Find:
```
VDO.MultiCh.Comms uses VDO.ninja for WebRTC transport.
```
No version is mentioned in this doc — no change needed there.

- [ ] **Step 2: Verify the change**

```bash
grep "Test connection" docs/self-hosting.md
```
Expected: no output (line removed)

```bash
grep "Verify by launching" docs/self-hosting.md
```
Expected: prints the replacement line

- [ ] **Step 3: Commit**

```bash
git add docs/self-hosting.md
git commit -m "docs: remove unimplemented Test connection button reference from self-hosting"
```

---

### Task 6: Refresh docs/handoff.md

**Files:**
- Modify: `docs/handoff.md`

- [ ] **Step 1: Update version references**

In `docs/handoff.md`, make these targeted changes:

**Change 1** — header date/build line:
Find:
```
**Current build:** 0.0.1 build 28
```
Replace with:
```
**Current build:** 0.1.0 build 28
```

**Change 2** — build-meta.json snippet:
Find:
```
  build-meta.json { "version": "0.0.1", "build": 28 }
```
Replace with:
```
  build-meta.json { "version": "0.1.0", "build": 28 }
```

**Change 3** — DMG output path in build instructions:
Find:
```
# Output: app/dist/VDO.MultiCh.Comms-0.0.1-arm64.dmg
```
Replace with:
```
# Output: app/dist/VDO.MultiCh.Comms-0.1.0-arm64.dmg
```

**Change 4** — add release note after the DMG build command block. Find the line:
```
**Run from terminal to see logs:**
```
Insert before it:
```markdown
The v0.1.0 DMG is also published on the [GitHub Releases page](../../releases). For end-user install instructions see [docs/usage.md](usage.md); for full source build details see [docs/development.md](development.md).

```

- [ ] **Step 2: Verify changes**

```bash
grep "0.1.0" docs/handoff.md | head -5
```
Expected: shows version 0.1.0 in header, build-meta, and DMG path (at least 3 lines)

```bash
grep "Test connection" docs/handoff.md
```
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add docs/handoff.md
git commit -m "docs: update handoff.md to v0.1.0 — version bump, release link, dev doc links"
```
