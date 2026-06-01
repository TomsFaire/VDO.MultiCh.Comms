# VDO.MultiCh.Comms

> **Alpha — v0.0.1.** Not production-ready. Expect rough edges.

Multi-channel IP intercom built on [VDO.ninja](https://vdo.ninja) (WebRTC) and CPAL hardware audio I/O. Designed for live production environments where you need independent party lines routed to a multi-channel audio interface — without managing a custom UDP transport stack.

4 independent party lines. Remote participants join from any mobile browser via a QR code — no app install required.

---

## How it works

```
Electron app  ┌─────────────────────────────────────┐
              │  PL1  │  PL2  │  PL3  │  PL4        │
              │  VDO  │  VDO  │  VDO  │  VDO  iframes│
              └──────────────────────────────────────┘
                         ↕ ws://localhost:9696
Rust shim     ┌──────────────────────────────────────┐
              │  CPAL — 4-channel capture + playback  │
              └──────────────────────────────────────┘
                         ↕
Hardware      multi-channel audio interface (e.g. Focusrite)
```

The **Rust shim** handles hardware audio I/O — capturing and playing back up to 4 independent mono channels from a physical audio interface. It exchanges raw PCM frames with the Electron app over a local WebSocket.

The **Electron app** embeds one VDO.ninja room per party line. VDO.ninja handles everything network-side: WebRTC peer connections, NAT traversal, codec negotiation, and audio mixing. Each line displays a QR code and join link so remote participants can connect from any device.

---

## Status

| Feature | Status |
|---|---|
| Rust shim — CPAL 4-channel I/O + WS server | ✅ Scaffolded |
| Electron app — 4-panel layout | ✅ Scaffolded |
| Per-line audio device + channel assignment UI | ✅ Done |
| VDO.ninja iframe embedding | 🔧 In progress |
| Web Audio API bridge (shim ↔ VDO.ninja) | 🔧 In progress |
| QR code join links | ✅ Done |
| Configurable VDO.ninja base URL + test button | ✅ Done |
| Self-hosting guide | ✅ Done |
| End-to-end audio test | ⏳ Pending |
| Packaging / code signing | ⏳ Post-alpha |

---

## Prerequisites

- [Rust](https://rustup.rs) (stable)
- Node.js 18+
- A multi-channel audio interface, or use your Mac's built-in mic for testing

---

## Getting started

### 1. Build the Rust audio shim

```bash
cd shim
cargo build --release
```

### 2. Install and launch the Electron app

```bash
cd app
npm install
npm start
```

The app spawns the shim automatically on startup (expects it at `shim/target/release/shim`). Config is created on first run at `~/.vdo-multichan/config.json`.

---

## Configuration

`~/.vdo-multichan/config.json` — created automatically with defaults on first run.

```json
{
  "instance_name": "sf-01",
  "vdo_base_url": "https://vdo.ninja",
  "audio_device": "Focusrite",
  "sample_rate": 48000,
  "lines": [
    { "id": 0, "name": "PL1", "room_key": "pl1abc123", "input_channel": 0, "output_channel": 0, "gain_in": 1.0, "gain_out": 1.0 },
    { "id": 1, "name": "PL2", "room_key": "pl2def456", "input_channel": 1, "output_channel": 1, "gain_in": 1.0, "gain_out": 1.0 },
    { "id": 2, "name": "PL3", "room_key": "pl3ghi789", "input_channel": 2, "output_channel": 2, "gain_in": 1.0, "gain_out": 1.0 },
    { "id": 3, "name": "PL4", "room_key": "pl4jkl012", "input_channel": 3, "output_channel": 3, "gain_in": 1.0, "gain_out": 1.0 }
  ]
}
```

Room keys must be alphanumeric (VDO.ninja requirement). The app UI writes config changes back to this file automatically.

### Changing the VDO.ninja endpoint

Open **Settings** in the app and choose:
- **VDO.ninja (public)** — zero setup, uses the public VDO.ninja service
- **Custom instance** — enter your own domain, use the **Test** button to verify before saving

This makes migrating to a self-hosted or organisation-owned endpoint a one-click change.

---

## Joining a party line

Each line panel shows a QR code and a copy button. Remote participants:
1. Scan the QR code or open the link on any device
2. Allow microphone access when prompted
3. They're in — no app install, no account

Join links point to `vdo.ninja/comms` — VDO.ninja's purpose-built intercom interface, optimised for mobile party line use.

---

## Self-hosting

See [docs/self-hosting.md](docs/self-hosting.md) for a complete guide covering:
- Hosting the VDO.ninja static frontend
- Running your own Coturn TURN server
- Full independence (self-hosted signaling, air-gapped deployments)

---

## Contributing

This project is in early alpha. Issues and PRs welcome.
