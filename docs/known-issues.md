# Known Issues & Status

**Last updated:** 2026-06-02 — v0.1.0 build 28

---

## Install notes

### App is ad-hoc signed, not notarized

Right-click → Open is required on first launch on any Mac. Gatekeeper blocks a normal double-click until the user explicitly allows the app. This is expected for v0.1.0. Full Apple Developer ID notarization is planned post-alpha.

---

## Resolved

The Rust/CPAL shim and its WebSocket bridge (port 9696) were replaced by the CoreAudio N-API addon; the ring-buffer, dispatch-jitter, buffer-size and port-cleanup issues that applied to the shim no longer exist.

---

## Open

### STUN/TURN DNS failures in logs
`errorcode: -105` from `services/network/p2p/socket_manager.cc` — cosmetic. WebRTC falls back to host ICE candidates (direct LAN IP). Works on LAN without TURN. Will not traverse NAT without a TURN server.

**Workaround for cross-NAT use:** self-host Coturn. See [docs/self-hosting.md](self-hosting.md).

### `session.setPreloads` deprecation warning
Should migrate to `session.registerPreloadScript`. Low priority — `setPreloads` still works in the current Electron version.

---

## Working

- Single-channel wizard (new session or join with session code), session export / import
- Device enumeration and capture/playback via the CoreAudio addon
- Auto-join from saved config, hidden, with watchdog reconnect
- Build number in footer, auto-incremented on each DMG build
