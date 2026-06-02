# Development Guide

## Prerequisites

- macOS arm64 (Apple Silicon)
- [Rust](https://rustup.rs) stable toolchain
- Node.js 18+

---

## Build the shim

```bash
cd shim
cargo build --release
```

Rebuild whenever `shim/src/audio.rs` or `shim/src/main.rs` changes.

---

## Run in dev mode

The shim must be built before starting the app in dev mode.

```bash
cd app
npm install
npm start
```

The app spawns the pre-built shim binary automatically on startup.

---

## Build a distributable DMG

```bash
cd shim && cargo build --release
cd ../app && npm run build
# Output: app/dist/VDO.MultiCh.Comms-0.1.0-arm64.dmg
```

The build number in `app/build-meta.json` auto-increments on each DMG build. The v0.1.0 release DMG is also available on the [GitHub Releases page](../../releases).

---

## Viewing logs from the packaged app

Run the app binary directly from Terminal to see stdout/stderr:

```bash
/Applications/VDO.MultiCh.Comms.app/Contents/MacOS/VDO.MultiCh.Comms
```

If a previously mounted DMG is blocking install, eject it first:

```bash
hdiutil detach "/Volumes/VDO.MultiCh.Comms 0.1.0" -force
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
  build-meta.json { "version": "0.1.0", "build": 28 }
  package.json    electron-builder config, targets mac arm64 DMG

shim/             Rust audio shim
  src/main.rs     WebSocket server, broadcast dispatch
  src/audio.rs    CPAL capture (broadcast) + playback (ring buffer)
```

---

## Architecture notes

### Shim broadcast dispatch

The CPAL input callback accumulates interleaved samples into pre-allocated per-channel `Vec<f32>` buffers. When all channels reach `FRAME_SIZE` (480 samples = 10ms @ 48kHz), a multi-channel binary packet is packed and sent via `tokio::sync::broadcast::Sender`. `send()` is non-async and safe to call from the real-time CPAL thread.

Packet format: `[ch: u32 LE][n_samples: u32 LE][samples: f32[] LE]` × N channels (N = actual device channel count, max `CHANNEL_COUNT=4`).

Each WebSocket client subscribes independently with `frame_tx.subscribe()` — no shared consumer contention. If a client lags, the broadcast drops old frames with a `Lagged` warning rather than applying backpressure.

### AudioWorklet bridge

Each VDO.ninja `WebContentsView` gets a per-line preload script loaded via `session.setPreloads`. The preload overrides `navigator.mediaDevices.getUserMedia` synchronously before any VDO.ninja JS runs.

On async init it opens `ws://127.0.0.1:9696`, feeds matching-channel frames into an `AudioWorkletNode` ring buffer (2s / 96000 samples, 500ms startup hold), and resolves `getUserMedia` with the `MediaStreamDestinationNode` stream. Falls back to native mic if the shim is unavailable within 10s.

`audioCtx.resume()` is called at WS open and again before resolving the stream as a defence against browser autoplay policy.

### Renderer WS connection

`app.js connectShim` connects to port 9696 solely to retrieve the device list for Settings dropdowns. **It closes immediately (code 1000) after receiving the `devices` message.** If it stayed connected, it would compete with the preload's audio receiver for broadcast frames and starve audio.

### Mic change reconnect

`lineConfigs` (map of id → `{url, channelId}`) tracks all active lines. After `killPortAndStartShim` spawns a new shim process, a 1s timer fires and reconnects every line — destroying the old `WebContentsView` and creating a new one with a fresh preload pointing to the new shim instance.

### Shim binary path

```js
app.isPackaged
  ? path.join(process.resourcesPath, 'shim')   // packaged DMG
  : path.join(__dirname, '..', 'shim', 'target', 'release', 'shim')  // dev
```

### VDO.ninja join URL

```
https://vdo.ninja/?room=ROOMKEY&webcam=1&vd=0&videodevice=0&autostart=1&label=NAME&monomic=1&proaudio=1&noisetgate=0&compressor=0&autoGain=0
```

`&webcam=1` is required for `&autostart=1` to bypass the device selection screen.
