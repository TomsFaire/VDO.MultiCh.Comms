# VDO.Spacial.Comms

> **Early development.** Forked from [VDO.MultiCh.Comms](https://github.com/TomsFaire/VDO.MultiCh.Comms).

Spatial binaural intercom built on [VDO.ninja](https://vdo.ninja). Each party line is positioned in a virtual space — drag it left, right, front, back — and the mix renders binaurally through headphones via Web Audio HRTF. Push-to-talk on one or more lines from a Stream Deck, tablet, or phone.

Designed to run headless on a dedicated box (NUC, Mac mini, or Pi 5). The operator UI is a web app served by the app itself — open it on any browser on the network, no monitor on the audio host required.

**Interoperates** with VDO.MultiCh.Comms: both apps share the same VDO.ninja room and party lines. A classic hardware-routed operator and a spatial operator can be on the same lines simultaneously.

---

## Status

| Track | Status |
|---|---|
| Binaural PoC (static PannerNodes, HRTF verify) | 🔧 In progress |
| Render Layer (live VDO lines → PannerNodes) | ⏳ Planned — Phase 1 |
| Web UI (radar view, settings, presets) | ⏳ Planned — Phase 2 |
| Talk-back core (per-channel inputSource, PTT) | ⏳ Planned — Phase 3 |
| Control API (HTTP/WebSocket, serves web UI) | ⏳ Planned — Phase 3 |
| Companion module | ⏳ Planned — Phase 4 |
| CLI installer (headless setup, systemd) | ⏳ Planned — Phase 5 |
| Presets and polish | ⏳ Planned — Phase 5 |
| Direct channels (1:1 private lines) | ⏳ Post-v1 |
| Mobile beltpack web client | ⏳ Post-v1 |
| Discrete multichannel HDMI/MADI backend | ⏳ Post-v1 |

Full architecture and phased plan: [docs/spatial-architecture.md](docs/spatial-architecture.md)

---

## How it relates to VDO.MultiCh.Comms

VDO.MultiCh.Comms routes each party line to a dedicated hardware output channel via a CoreAudio N-API addon. This fork replaces that output model with a spatial binaural mix — all lines go through Web Audio `PannerNode`s into one stereo headphone output. These are two separate products for different use cases; there is no mode toggle.

The VDO ingestion layer (per-line `WebContentsView` + preload + IPC audio bridge) is inherited unchanged. Session export codes (`comms_room` + group names) are compatible between both apps — share a session code and both clients join the same party lines.

---

## Architecture

```
VDO.ninja (WebRTC, per-line group)
  → WebContentsView + preload (IPC audio-frame, inherited from VDO.MultiCh.Comms)
  → Spatial Mixer (hidden renderer, Web Audio)
      PannerNode[line0] ──┐
      PannerNode[line1] ──┼── AudioContext.destination → headphones
      PannerNode[lineN] ──┘

Operator mic (getUserMedia — no native addon needed for v1)
  → transmittingChannels gate (PTT / latch)
  → VDO.ninja push (per active line's group)

Control API + Web UI (one HTTP/WebSocket server, one port)
  ← Browser on any device (radar view, settings, presets)
  ← Bitfocus Companion module
  ← Electron window (same web page, if a monitor is attached)
```

**The UI is a web app, not an Electron-native window.** Radar positioning, settings, presets, and Direct channel management are served by the Control API as a single web page — reachable from any browser on the network. Electron's own window just loads that same page when a local monitor is present. The audio host can run fully headless.

Full detail: [docs/spatial-architecture.md](docs/spatial-architecture.md)

---

## Target hardware

**Dev/PoC host:** 6th-gen i3 NUC (8GB RAM, 256GB SSD). Handles the v1 workload (Opus decode + HRTF convolution for 10–12 sources) with zero porting work — v1 needs no native addon at all.

**Production options:** any x86 N100/N150 mini PC (Beelink, GMKtec, etc.) or Mac mini. Pi 5 is the realistic floor in the Pi family but currently cost-competitive with x86 mini PCs that offer more headroom and simpler HDMI audio paths.

Pi 4 is **not recommended** — too underpowered for simultaneous WebRTC decode + HRTF convolution at the 10–12 participant target.

---

## For developers

### Prerequisites

- Node.js 18+
- macOS (Apple Silicon) or any Debian-based x86/arm64 Linux — both supported
- CoreAudio native addon is **not required for v1** — used only for `dedicated`-type input channels (macOS) and the future HDMI backend
- Linux headless: Xvfb or `--enable-offscreen-rendering` flags needed for Chromium with no display attached (exact flags TBD once tested on target hardware)

### Dev run

```bash
cd app
npm install
npm start
```

Config lives at `~/.vdo-multichan/config.json`.

### Binaural PoC (no Electron needed)

Open `test/binaural-poc.html` in any browser with headphones. Six static PannerNodes at fixed azimuths — confirms HRTF placement is audible on this platform before wiring into Electron.

### Config

`~/.vdo-multichan/config.json` — same base format as VDO.MultiCh.Comms, with additional optional spatial fields:

```json
{
  "comms_room": "my-event",
  "lines": [
    {
      "id": 0, "name": "PL1", "group": "pl1",
      "azimuth": -45, "volume": 1.0, "listening": true,
      "inputSource": "sharedMic"
    }
  ]
}
```

New spatial fields default gracefully — a config saved by VDO.MultiCh.Comms loads without migration.

---

### Documentation

| Doc | Contents |
|-----|----------|
| [docs/spatial-architecture.md](docs/spatial-architecture.md) | Full design: architecture, phases, data model, platform notes |
| [docs/usage.md](docs/usage.md) | End-user guide (inherited, will be updated) |
| [docs/development.md](docs/development.md) | Build from source, CI |
| [docs/self-hosting.md](docs/self-hosting.md) | VDO.ninja self-hosting, TURN |
