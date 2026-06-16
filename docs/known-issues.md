# Known Issues & Status

**Last updated:** 2026-06-15 — v0.1.1

See also: [usage.md](usage.md) (end users), [development.md](development.md) (build from source), [self-hosting.md](self-hosting.md) (TURN / custom VDO.ninja).

---

## Resolved (v0.1.1)

### Rust shim removed — CoreAudio in-process
**Done.** The separate Rust CPAL process and `ws://127.0.0.1:9696` bridge are gone. Capture and playback run in the Electron main process via `coreaudio.node` (CoreAudio N-API addon). Per-channel frames route over Electron IPC (`audio-frame` / `playback-frame`) to each line’s preload.

This eliminates an entire class of shim-era bugs (port 9696 contention, broadcast consumer starvation, tokio timer jitter, separate-process lifecycle).

### Inbound audio → hardware output channels
**Done.** Remote participants are tapped from VDO.ninja media elements in the same hidden view that publishes the line. Samples are batched in an AudioWorklet and sent to `coreAudio.pushPlaybackSamples()` on the configured output channel. No longer limited to Electron’s default speakers.

### Single Comms room + grouped lines
**Done.** All party lines share one `comms_room`. VDO.ninja `group` / `groups` / `groupmode=1` replaces separate room URLs per line. Mobile clients use one `/comms?room=…&groups=…` link; desktop lines push with `push=<room>_<group>` in the same room.

### Combined push + listen per line
**Done.** One hidden `WebContentsView` per line handles both publish and group-scoped listen (no second listen-only session).

### LAN WebRTC mode (Electron DNS failures)
**Done (default on).** When `webrtc_lan_mode` is true (default), line preloads patch `RTCPeerConnection` to strip `iceServers`, and join URLs include `turn=off` + `stunonly`. This avoids Chromium `errorcode: -105` DNS lookups to public STUN/TURN hosts that often fail inside Electron on LAN-only shows.

---

## Resolved (shim era — historical)

These applied to v0.0.1 builds using the Rust shim; kept for context if you’re comparing old DMGs or logs.

- **Shim → VDO.ninja AudioWorklet bridge** — stable by build 28; superseded by IPC bridge in v0.1.1.
- **Shared ring buffer / WS consumer contention** — renderer enumeration WS starved preload; fixed by closing after device list (no longer relevant — no WS).
- **Timer-driven dispatch jitter** — CPAL-event-driven broadcast replaced tokio 10ms timer.
- **Port 9696 crash loop** — `lsof` without `-s tcp:LISTEN` killed Chromium clients; fixed before shim removal.
- **Mic change not taking effect** — shim restart + line reconnect; now unified `startUnifiedAudio()` on config save.

---

## Open

### Cross-NAT / WAN use
**LAN-first.** Default config enables LAN mode (`webrtc_lan_mode: true`, `turn=off`, ICE stripped in Electron views). Peer-to-peer on the same LAN works via host candidates.

Cross-NAT or internet traversal requires a TURN server and a VDO.ninja frontend configured to use it. You must also disable or relax LAN mode in `config.json` (`webrtc_lan_mode: false`) so STUN/TURN can be used — see [self-hosting.md](self-hosting.md).

### `session.setPreloads` deprecation warning
Should migrate to `session.registerPreloadScript`. Low priority — `setPreloads` still works in the current Electron version.

### App is unsigned
Right-click → Open required on first launch on any macOS machine that hasn’t run it before. Gatekeeper blocks a normal double-click until the user explicitly allows it.

### macOS only
CoreAudio N-API addon is Darwin-only. No Windows/Linux build today.

### Group routing on mobile
Ungrouped talk on the Comms page is heard on **all** lines. Operators must tap the correct party-line button before speaking.

---

## Working (v0.1.1)

- First-run setup wizard (event name + line names → `comms_room` + per-line `group`)
- Session export / import (base64, v2 format with `comms_room` + groups)
- Single Comms QR / join link (`/comms?room=…&groups=…`)
- Per-line desktop push URLs (group-scoped into shared room)
- Director link (all groups, opens in system browser)
- CoreAudio device enumeration (UID + channel counts)
- Unified capture/playback (duplex on same device when input = output UID)
- Per-line IPC audio bridge (hardware → VDO.ninja, remote → hardware channel)
- Device change restarts audio via `applyAudioFromConfig()`
- Optional comms room password (`comms_password`)
- Build footer (v0.1.1 build N), auto-incremented on each DMG build
- Settings **Test connection** against custom `vdo_base_url`
