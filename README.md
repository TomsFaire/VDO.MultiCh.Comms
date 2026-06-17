# VDO.Spacial.Comms

> **Active development — pre-alpha.** Forked from [VDO.MultiCh.Comms](https://github.com/TomsFaire/VDO.MultiCh.Comms).

Spatial binaural intercom for live production. Each party line sits at a position in virtual space — drag it left, right, front, back — and the mix renders through headphones via Web Audio HRTF. Push-to-talk on one or more lines from a Stream Deck, tablet, or phone. Runs headless on a dedicated box; the operator UI is a web page served by the app and reachable from any browser on the network.

Built on [VDO.ninja](https://vdo.ninja) for transport. No proprietary server, no accounts, no app install for remote participants.

---

## Where we are

The fork is set up and the foundation is laid. Currently verifying the binaural PoC on Mac and NUC before starting Phase 1.

| Component | Status | Notes |
|---|---|---|
| Fork, branch, package rename | ✅ Done | `ReynoldsProductions/VDO.Spacial.Comms`, branch `spatial-intercom` |
| Channel data model | ✅ Done | `app/spatial/channelModel.js` — sync point for all parallel tracks |
| Linux build targets | ✅ Done | AppImage + deb, arm64 + x64 |
| CoreAudio optional | ✅ Done | App starts on Linux with no native addon |
| Binaural PoC | 🔧 Verifying | `test/binaural-poc.html` — open in Chrome with headphones |
| **Phase 1 — Render Layer** | ⏳ Next | Wire live VDO lines into PannerNodes |
| **Phase 2 — Web UI** | ⏳ Planned | Radar view, settings, presets — served by Control API |
| **Phase 3 — Talk-back + Control API** | ⏳ Planned | PTT/latch, transmittingChannels, HTTP/WebSocket server |
| **Phase 4 — Companion module** | ⏳ Planned | Talk/Listen/Pan/Preset actions + feedbacks |
| **Phase 5 — CLI installer + presets** | ⏳ Planned | Headless setup, systemd, access URL echo |
| Direct channels (1:1 private lines) | ⏳ Post-v1 | |
| Mobile beltpack web client | ⏳ Post-v1 | |
| HDMI/MADI multichannel backend | ⏳ Post-v1 | |

**Gate to Phase 1:** binaural PoC confirmed audible on both Mac and NUC (left/right clearly distinguishable with headphones).

Full architecture, parallel tracks, and model assignments: [docs/spatial-architecture.md](docs/spatial-architecture.md)

---

## How it works

```
VDO.ninja (WebRTC, per-line group)
  → WebContentsView + preload  ← inherited from VDO.MultiCh.Comms, unchanged
  → Spatial Mixer (hidden renderer, Web Audio)
      PannerNode[PL1] ──┐
      PannerNode[PL2] ──┼── AudioContext.destination → headphones
      PannerNode[PLn] ──┘

Operator mic (getUserMedia — no native addon for v1)
  → transmittingChannels gate
  → VDO.ninja push per active line

Control API + Web UI  (one HTTP/WebSocket server, one port)
  ← any browser: radar view, settings, presets
  ← Bitfocus Companion module
  ← Electron's own window (same page, when a monitor is present)
```

The UI is a web app served by the Control API, not an Electron-native window. This means the audio host can run headless — no monitor, no GUI. Opening `http://<host>:<port>` from any device on the network gives you the full operator interface.

---

## Interoperability with VDO.MultiCh.Comms

These are two separate products. VDO.MultiCh.Comms routes each party line to a dedicated hardware output channel (CoreAudio, macOS). This app replaces that output model with a shared binaural mix — no mode toggle, no shared codebase going forward.

What they share: the VDO.ninja room and group names. A VDO.MultiCh.Comms operator and a VDO.Spacial.Comms operator can be on the same party lines simultaneously — each hears and talks the same lines, each app routes the audio differently on its own side. Session export codes are compatible: import a session from either app and you're in the same room.

Direct channel interoperability with VDO.MultiCh.Comms (so classic-app operators can participate in Direct channels initiated from this app) is planned but not yet built on either side.

---

## Target hardware

**Current dev/PoC host:** 6th-gen i3 NUC (8GB RAM, 256GB SSD). Comfortably handles the v1 workload — audio-only Opus decode is cheap, and HRTF convolution for 10–12 sources is modest DSP. Zero porting work needed since v1 uses no native addon.

**Production:** any x86 N100/N150 mini PC (Beelink, GMKtec, Minisforum, etc.) or Mac mini. Better CPU headroom and simpler HDMI audio paths than Pi for this workload.

**Pi 5:** viable floor within the Pi family, but current pricing (~$135–195 fully kitted) makes it cost-competitive with N100 mini PCs that offer more headroom. Pi 4 is not recommended — underpowered for simultaneous WebRTC decode + HRTF at the 10–12 participant target.

---

## Development

### Prerequisites

- Node.js 18+
- macOS or Debian-based Linux (x86 or arm64)
- No native addon required for v1
- Linux headless: needs Xvfb or `--enable-offscreen-rendering` for Chromium with no display (exact invocation TBD on target hardware)

### Run

```bash
cd app && npm install && npm start
```

Config: `~/.vdo-multichan/config.json` — same format as VDO.MultiCh.Comms, spatial fields optional and default gracefully.

### Verify the binaural PoC first

Before building Phase 1, open `test/binaural-poc.html` in Chrome with headphones (no Electron needed). Six static PannerNodes at fixed azimuths. Hard left (−90°) and hard right (+90°) should be unambiguous. Front/behind may be subtle — that's expected with generic HRTF and not a failure condition.

### Docs

| Doc | Contents |
|---|---|
| [docs/spatial-architecture.md](docs/spatial-architecture.md) | Full design, phased build plan, parallel tracks, model assignments |
| [docs/development.md](docs/development.md) | Build from source, CI, release tagging |
| [docs/self-hosting.md](docs/self-hosting.md) | VDO.ninja self-hosting, TURN server setup |
