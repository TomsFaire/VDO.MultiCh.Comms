# Known Issues & Status

**Last updated:** 2026-06-16 — v0.1.4

See also: [usage.md](usage.md) (end users), [development.md](development.md) (build from source), [self-hosting.md](self-hosting.md) (TURN / custom VDO.ninja).

---

## Resolved (v0.1.4)

### Room name editable from Settings
`comms_room` was only settable at the first-run wizard. Added a 'Room name' text input to the Settings panel. Changing it regenerates all join URLs and the QR code and clears any active lock.

### Room lock
Added a 'Lock room' button to the comms bar. Locking applies a random 16-char password to all VDO.ninja URLs via `&password=` (signaling encryption). New joiners with the old URL cannot communicate into the room; existing p2p connections are unaffected. Lock state persisted in config (`room_locked`, `lock_password`).

---

## Resolved (v0.1.3)

### Per-PL audio device selection
Each party line can now have its own dedicated input and output CoreAudio device. `connect-line` calls `startSession("pl-N", capUid, capCh, pbUid, pbCh, cb)` when per-PL devices are set and differ from the global device. Lines on the global device continue to use the shared session and channel-index routing.

### Audio bleed — VDO.ninja elements playing through system speakers
VDO.ninja `<video>`/`<audio>` elements in each line's hidden view were playing remote audio through the system default output (e.g. MacBook built-in speakers) independently of the CoreAudio routing. Fixed by immediately muting all media elements in the shim (`el.muted = true; el.volume = 0`) and re-muting on every `playing` event and every 3-second polling interval.

### Audio bleed — shared PL playback routing to wrong session
When a per-PL session (e.g. MacBook speakers) was active, `playbackEngine()` would fall back to that session for all shared PLs, routing all remote audio to the per-PL device. Fixed by switching shared PLs to the explicit `pushPlaybackSamples('default', ch, ...)` form.

### WebRTC settings hardcoded — LAN/WAN not user-configurable
`webrtc_turn_off`, `webrtc_stun_only`, and `webrtc_lan_mode` were hardcoded to `false` on every config load, making them impossible to change via config. Switched to null-guard defaults (`if (cfg.x == null) cfg.x = false`) so saved values are respected. Default remains WAN mode (TURN/STUN enabled).

### Gain slider range too narrow
Gain sliders were capped at 3× (≈+10 dB). Raised to 10× (≈+20 dB) to handle quiet sources without clipping. No soft limiting — high gain on loud signals will hard-clip at ±1.0 in the CoreAudio ring buffer.

### Level meter red threshold too low
Red color triggered at 85%. Moved to 95%; yellow remains at 60%.

---

## Resolved (v0.1.1)

### Rust shim removed — CoreAudio in-process
The separate Rust CPAL process and `ws://127.0.0.1:9696` bridge are gone. Capture and playback run in the Electron main process via `coreaudio.node`. Per-channel frames route over Electron IPC to each line's preload.

### Inbound audio → hardware output channels
Remote participants are tapped from VDO.ninja media elements in the same hidden view that publishes the line. Samples are batched in an AudioWorklet and sent to `coreAudio.pushPlaybackSamples()` on the configured output channel.

### Single Comms room + grouped lines
All party lines share one `comms_room`. VDO.ninja `group` / `groups` / `groupmode=1` replaces separate room URLs per line.

### Combined push + listen per line
One hidden `WebContentsView` per line handles both publish and group-scoped listen.

---

## Open

### Same-channel conflict (two PLs, same I/O)
If two lines are configured with the same output channel (shared session), only one receives remote audio — whichever sends frames last wins. No UI warning is shown. Unique output channels per line are assumed.

### High-gain clipping
No soft limiter in the audio path. Gain values above ~3–4× on loud sources will hard-clip in the ring buffer. A `tanh`-based soft limiter in `pushPlaybackRing` would help; not yet implemented.

### App is unsigned
Right-click → Open required on first launch. Gatekeeper blocks a normal double-click until explicitly allowed.

### macOS only
CoreAudio N-API addon is Darwin-only. No Windows/Linux build.

### Group routing on mobile
Ungrouped talk on the Comms page is heard on **all** lines. Operators must tap the correct party-line button before speaking.

### `session.setPreloads` deprecation warning
Should migrate to `session.registerPreloadScript`. Low priority — `setPreloads` still works in the current Electron version.

---

## Working (v0.1.4)

- First-run setup wizard (event name + line names → `comms_room` + per-line `group`)
- Session export / import (base64, v2 format)
- Single Comms QR / join link (`/comms?room=…&groups=…`)
- Per-line desktop push URLs (group-scoped into shared room)
- Director link (all groups, opens in system browser)
- CoreAudio device enumeration (UID + channel counts)
- Global unified capture/playback (duplex when input = output UID)
- Per-PL dedicated device sessions (`startSession` / `stopSession`)
- Per-line IPC audio bridge (hardware → VDO.ninja, remote → hardware channel)
- VDO.ninja media element muting (no speaker bleed)
- Live level meters (mic + remote, green/blue/yellow/red)
- Per-line gain in/out (0–10×, save on slider release)
- LAN/WAN WebRTC mode configurable via `webrtc_lan_mode`
- Room name editable from Settings (regenerates QR and URLs)
- Room lock (comms bar button — applies random password to exclude new joiners)
- Optional comms room password
- Build footer (v0.1.3 build N), auto-incremented on each DMG build
- Settings **Test connection** against custom `vdo_base_url`
