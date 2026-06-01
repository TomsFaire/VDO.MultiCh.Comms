# Known Issues & Next Steps

## Outstanding: VDO.ninja auto-join parameters

**Status:** Unverified as of 2026-06-01.

The `joinUrl()` function in `app/renderer/app.js` generates the URL used by the hidden `WebContentsView` when Connect is clicked. The intended behaviour is that the view silently joins the VDO.ninja room as an audio-only participant — appearing in the director view with no UI interaction required.

Current URL shape:
```
https://vdo.ninja/?room=ROOMKEY&webcam=1&vd=0&videodevice=0&autostart=1&label=NAME&monomic=1&proaudio=1&...
```

**What we know:**
- Without `&webcam`, VDO.ninja shows a "Join with Microphone / Screenshare" choice screen and never auto-joins.
- `&autostart` only bypasses the device-selection step *after* join mode is chosen — `&webcam` is required alongside it.
- `&vd=0` and `&videodevice=0` should disable the camera feed.

**What needs to be confirmed:**
- Does `&webcam=1&vd=0&autostart=1` actually result in a silent audio-only join with no UI? Needs testing by loading the URL in a real browser.
- If VDO.ninja still shows UI, the alternative is `&push=STREAMID` which is the "push a stream" mode and may auto-start without any selection screen. Investigate `&push` as a fallback.
- The `WebContentsView` is 1×1px off-screen — confirm Chromium activates `getUserMedia` at that size. If not, try a larger hidden bounds like 320×240 placed off-screen (`x: -400, y: -400`).

---

## Shim audio → VDO.ninja bridge

**Status:** Implemented (2026-06-01). Needs end-to-end test with hardware.

`buildShimScript(channelId)` in `app/main.js` is injected into each `WebContentsView` on `dom-ready` (before VDO.ninja calls `getUserMedia`). It:

1. Creates an `AudioContext` at 48 kHz
2. Loads an `AudioWorkletProcessor` from a blob URL (no separate file needed)
3. Opens `ws://127.0.0.1:9696` and feeds frames where `channel_id === channelId` into the worklet
4. Overrides `navigator.mediaDevices.getUserMedia` so that when VDO.ninja requests audio, it receives the synthetic `MediaStreamDestinationNode` stream instead of the hardware mic

The `channelId` is `line.input_channel` (0-based index), passed through from the renderer via `window.api.connectLine(id, url, channelId)`.

**What still needs testing:**
- Confirm `[shim-bridge] ready — channel N` appears in the WebContentsView DevTools console on connect
- Confirm VDO.ninja director view shows non-zero kbps for the connected line
- The reverse path (VDO.ninja → shim playback producer) is not yet wired

---

## Electron app visible in director but shows muted / 0 kbps

If the shim bridge injected correctly (check DevTools console for `[shim-bridge] ready`), the most likely cause is that the shim WebSocket isn't running or has no audio signal on the selected channel. Confirm the shim process started (logged to Electron main process stdout) and that the hardware device is sending audio.

---

## Working

- First-run setup wizard (event name + line names → deterministic room keys)
- Session export/import (base64 code, Settings panel)
- Per-line QR codes and join links (audio-only, `&webcam&vd=0&autostart`)
- Director link per panel (`&director=ROOMKEY`)
- Device enumeration (CPAL channel count probe for BlackHole-style virtual devices)
- Channel dropdowns reflect actual hardware channel count
- Room keys are permanent — renaming a line does not change its room
- Port 9696 cleanup on app restart (`lsof -s tcp:LISTEN` targets only the shim's listening socket; Chromium client connections are no longer matched, eliminating the crash loop on shim restart — fixed build 22)
