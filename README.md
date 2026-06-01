# VDO.MultiCh.Comms

Multi-channel IP intercom using VDO.ninja (WebRTC) for transport and CPAL for hardware audio I/O.

4 independent party lines. Remote participants join from any mobile browser — no app install.

## Architecture

```
Electron app (4 × VDO.ninja iframes)
        ↕ ws://localhost:9696
Rust audio shim (CPAL, 4-channel I/O)
        ↕
Hardware audio interface
```

The Rust shim captures/plays audio on up to 4 hardware channels and exchanges raw PCM frames with the Electron app over a local WebSocket. VDO.ninja handles all networking (WebRTC, NAT traversal, codec, mixing).

## Getting started

### Prerequisites
- Rust (stable)
- Node.js 18+
- A multi-channel audio interface (or built-in mic for testing)

### Build the shim

```bash
cd shim
cargo build --release
```

### Run the app

```bash
cd app
npm install
npm start
```

The app reads config from `~/.vdo-multichan/config.json` (created with defaults on first run).

## Configuration

```json
{
  "instance_name": "sf-01",
  "vdo_base_url": "https://vdo.ninja",
  "audio_device": "Focusrite",
  "sample_rate": 48000,
  "lines": [
    { "id": 0, "name": "PL1", "room_key": "pl1-abc123", "input_channel": 0, "output_channel": 0, "gain_in": 1.0, "gain_out": 1.0 }
  ]
}
```

Change `vdo_base_url` in the app's **Settings** panel to use a self-hosted VDO.ninja instance.

## Self-hosting

See [docs/self-hosting.md](docs/self-hosting.md) for a complete guide to hosting your own VDO.ninja frontend and TURN server.

## Remote users

Each party line shows a **join link**. Remote participants open this in any browser (iOS Safari, Android Chrome, desktop). No app install required.

For best results on the remote end, disable browser audio processing:
```
https://vdo.ninja/?room=YOUR_ROOM&noisetgate=0&compressor=0&autoGain=0
```
(This is already baked into the generated join links.)
