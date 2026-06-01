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

## Outstanding: Shim audio → VDO.ninja bridge

**Status:** Not yet implemented.

The Rust shim captures hardware audio channels over CPAL and exposes them as tagged PCM frames over a local WebSocket (`ws://127.0.0.1:9696`). The `WebContentsView` for each party line connects to VDO.ninja and captures from Chromium's default microphone — it does NOT yet receive audio from the shim.

**What needs to be built:**
1. In each `WebContentsView`, inject a content script that:
   - Opens a WebSocket to the shim
   - Receives PCM frames for the assigned channel
   - Creates a `MediaStream` from an `AudioWorklet` or `ScriptProcessorNode` fed by the shim PCM
   - Replaces the VDO.ninja microphone track with this synthetic stream via the [IFRAME API](https://docs.vdo.ninja/api-documentation/iframe-api) or by overriding `getUserMedia`
2. The output path (VDO.ninja audio → shim → hardware output channel) mirrors this in reverse.

**Alternative approach:**
Route BlackHole channel N to macOS system default audio input before connecting. VDO.ninja will then capture the correct channel natively without needing the Web Audio bridge. This is a valid interim workaround for controlled hardware setups.

---

## Outstanding: Electron app visible in director but shows muted / 0 kbps

This is a symptom of the shim bridge being missing — the `WebContentsView` joins the room but captures from whatever Chromium picks as its default input. If that device has no signal, the participant appears muted.

---

## Working

- First-run setup wizard (event name + line names → deterministic room keys)
- Session export/import (base64 code, Settings panel)
- Per-line QR codes and join links (audio-only, `&webcam&vd=0&autostart`)
- Director link per panel (`&director=ROOMKEY`)
- Device enumeration (CPAL channel count probe for BlackHole-style virtual devices)
- Channel dropdowns reflect actual hardware channel count
- Room keys are permanent — renaming a line does not change its room
- Port 9696 cleanup on app restart
