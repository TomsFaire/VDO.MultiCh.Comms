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
