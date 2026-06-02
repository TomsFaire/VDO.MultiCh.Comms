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
