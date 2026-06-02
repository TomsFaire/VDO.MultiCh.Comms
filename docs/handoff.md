# Agent Handoff — VDO.MultiCh.Comms

**Date:** 2026-06-02
**Current build:** 0.1.0 build 28
**Branch:** `main`

---

## What this project is

A macOS Electron app for multi-channel IP intercom. It connects multiple "party lines" to VDO.ninja rooms so broadcast crew (e.g. at a Faire event) can communicate across audio channels independently.

**Architecture:**
```
Hardware mic / BlackHole
  → Rust shim (CPAL, per-channel PCM capture)
  → tokio::sync::broadcast (hardware-clocked, no timer)
  → WebSocket ws://127.0.0.1:9696
  → Electron WebContentsView preload (AudioWorklet bridge)
  → VDO.ninja getUserMedia override
  → WebRTC → remote participants (phone, web browser)
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
    make-icns.sh  PNG → ICNS conversion
  build-meta.json { "version": "0.1.0", "build": 28 }
  package.json    electron-builder config, targets mac arm64 DMG

shim/             Rust audio shim
  src/main.rs     WebSocket server, broadcast dispatch
  src/audio.rs    CPAL capture (broadcast) + playback (ring buffer)
```

---

## How to build

```bash
# Rebuild shim whenever audio.rs or main.rs changes
cd shim && cargo build --release

# Build DMG (auto-bumps build number)
cd app && npm run build
# Output: app/dist/VDO.MultiCh.Comms-0.1.0-arm64.dmg

# Run dev (no DMG, shim must be pre-built)
cd app && npx electron .
```

The v0.1.0 DMG is published on the [GitHub Releases page](../../releases). For end-user install instructions see [docs/usage.md](usage.md); for full source build details see [docs/development.md](development.md).

**Run from terminal to see logs:**
```bash
/path/to/VDO.MultiCh.Comms.app/Contents/MacOS/VDO.MultiCh.Comms
```

If the previous DMG is still mounted, eject it first:
```bash
hdiutil detach "/Volumes/VDO.MultiCh.Comms 0.1.0" -force
```

---

## Current status (build 28)

### Working
- First-run setup wizard, session export/import, QR codes, director links
- VDO.ninja WebContentsView auto-joins rooms silently (`&webcam=1&vd=0&autostart=1`)
- **Outbound audio via shim bridge** ✅ — stable as of build 28
- **Mic change reconnect** ✅ — changing input device in Settings reconnects all active lines automatically
- Inbound audio (remote → Electron speakers) ✅
- Shim auto-starts on launch, restarts on Settings save
- Build number in footer

### Known open issues
1. **Inbound audio not routed to hardware output** — playback ring buffers exist in the Rust shim (`playback_producers`) but aren't fed from VDO.ninja WebRTC output. Remote audio plays through Electron's default audio output device, not a specific hardware channel.

2. **STUN/TURN DNS failures** — cosmetic noise in logs. Works on LAN via host ICE candidates; cross-NAT requires a TURN server.

3. **`session.setPreloads` deprecation** — low priority, still works.

4. **App unsigned** — right-click → Open on first launch.

---

## Key implementation details

### Shim broadcast dispatch (audio.rs)
The CPAL input callback accumulates interleaved samples into pre-allocated per-channel `Vec<f32>` buffers. When all channels reach `FRAME_SIZE` (480 samples = 10ms @ 48kHz), a multi-channel binary packet is packed and sent via `tokio::sync::broadcast::Sender`. `send()` is non-async and safe to call from the real-time CPAL thread.

Packet format: `[ch: u32 LE][n_samples: u32 LE][samples: f32[] LE]` × N channels (N = actual device channel count, max CHANNEL_COUNT=4).

### Per-client broadcast receivers (main.rs)
Each `handle_client` subscribes to the broadcast with `frame_tx.subscribe()`. A `cap_task` tokio task loops on `rx.recv().await` and forwards frames as binary WebSocket messages. If a client lags (slow WS write), the broadcast drops old frames with a `Lagged` warning — no global backpressure.

### AudioWorklet bridge (main.js buildShimScript)
Injected as a preload into each line's `WebContentsView` via `session.setPreloads` with `contextIsolation: false`. Overrides `getUserMedia` synchronously before VDO.ninja JS runs.

- Ring buffer: 96000 samples (2s) Float32Array, startup hold 24000 samples (500ms)
- Parses multi-channel packets from WS, pushes matching channel into ring
- Falls back to native mic if shim WS unavailable within 10s
- `audioCtx.resume()` called at WS open and again before resolving stream (autoplay policy defence)

### Renderer WS connection (app.js connectShim)
The renderer connects to 9696 solely to get the device list for Settings dropdowns. **It closes immediately (code 1000) after receiving the `devices` message.** If it stayed connected, it would starve the preload's audio receiver by competing for frames on the same broadcast channel.

### Mic change reconnect (main.js)
`lineConfigs` map (id → `{url, channelId}`) tracks all active lines. After `killPortAndStartShim` spawns a new shim process, a 1s timer fires and reconnects every line in `lineConfigs` — destroying the old `WebContentsView` and creating a new one with a fresh preload script pointing to the new shim.

### Shim binary path
```js
app.isPackaged
  ? path.join(process.resourcesPath, 'shim')   // packaged app
  : path.join(__dirname, '..', 'shim', 'target', 'release', 'shim')  // dev
```

### VDO.ninja join URL
```
https://vdo.ninja/?room=ROOMKEY&webcam=1&vd=0&videodevice=0&autostart=1&label=NAME&monomic=1&proaudio=1&noisetgate=0&compressor=0&autoGain=0
```
`&webcam=1` is required for `&autostart=1` to bypass the device selection screen.

---

## Environment / test machine
- Apple Silicon MacBook Pro (arm64)
- Audio devices: BlackHole 16ch, BlackHole 2ch, MacBook Pro Microphone, NDI Audio, Microsoft Teams Audio, ZoomAudioDevice
- MacBook Pro Speakers: NOT enumerated by CPAL — shim falls back to `default_output_device()` when empty or unmatched
- App unsigned — right-click → Open on first launch
- macOS TCC microphone: granted
