# Handoff

Current architecture for the single-channel intercom. If something here disagrees with the code, the code wins; fix this file.

## Architecture

```
Electron main (app/main.js)
  - loads config, single-instance lock, boot sequence
  - loads coreaudio.node: enumerate devices, capture input, play output
  - owns ONE line view (hidden WebContentsView -> vdo.ninja URL)
  - connectLine() / disconnectLine(), watchdog, powerSaveBlocker
  - builds all vdo.ninja URLs via the shared URL module
Preload shim (injected into the line view)
  - getUserMedia -> hardware input channel (AudioWorklet fed from main)
  - taps EVERY remote audio track into one remote-cap worklet (summed), sent to the hardware output channel
  - sends line-heartbeat IPC every 5s
Renderer (app/renderer/) - settings and a single status card
```

## Boot sequence

`whenReady` -> `requestSingleInstanceLock()` -> load config.

- `configured: true`: window stays hidden (`show: false`), `startLine()` starts audio with capture in main, then `connectLine()`.
- Otherwise: show window, run the wizard. Only a completed wizard or a session import sets `configured: true`. An abandoned wizard never auto-joins.
- `save-config` calls `restartLine()` when the config becomes configured or any device, channel, network, room, password, box name, location or roomcap value changes. A `gain_out`-only change is pushed live to the shim (`gain-out`) without reconnecting. The renderer never starts capture.
- Closing the window hides it; `before-quit` sets `isQuitting` so Cmd-Q really quits. `activate` and `second-instance` show the window.

Windows and the line view use `backgroundThrottling: false`; `powerSaveBlocker('prevent-app-suspension')` is held while connected.

## Device resolution

One helper in main (`findDevice` / `resolveAudioDevices`) matches input/output by UID, then by exact name, then case-insensitive substring. If a configured device matches neither, status is `device-missing` and `startLine()` retries every 10s (late-enumerating USB interfaces) until audio starts, then connects. Name-fallback matches and misses are logged. The renderer's device lookup uses the same UID-then-name order. An input or output with no UID and no name means no capture/playback on that side.

## Watchdog

Watches the line view's `webContents`: main-frame `did-fail-load`, `render-process-gone`, `unresponsive`, a stale `line-heartbeat` (over 20s, checked after a 30s grace from connect), a `line-alert`, `powerMonitor` `resume`, and an offline to online change of `net.isOnline()` (polled every 10s). Any trigger schedules one reconnect (`disconnectLine()` then `connectLine()`) with exponential backoff from 2s to 60s; there is never more than one pending timer. Backoff resets after the line has been healthy for 60s. It never uses peer count (zero peers is normal).

The shim overrides `alert`/`confirm`/`prompt` to be non-blocking and forwards the text over `line-alert` (a blocking dialog would freeze the hidden view). vdo.ninja alerts, such as "stream ID in use" after a power cycle, therefore cause a retry. A `did-navigate` away from the push URL's origin and path (e.g. a login page) sets `auth-failed` and reconnects at the maximum backoff.

Status values (`line-status` payload `{ status, detail, alert }`): `disconnected` (not configured), `connecting` (until first heartbeat), `connected`, `reconnecting` (during backoff; `detail` is the reason), `device-missing` (also used when audio fails to start; `detail` explains; retried every 10s), `auth-failed`.

## Shared URL module

All vdo.ninja URLs (push, guest join link, director link) are built in `app/shared/urls.js`, used by main. It takes config and returns URLs:

- Push: `room`, `push=<sanitised box_name>`, `label`, audio params, `password`, network params, `roomcap` if set
- Join link: `/comms?room=...` (falls back to `/?room=...` if `/comms` misbehaves without groups)
- Director link: room + password
- Network: `lan` adds `turn=off` + `stunonly` (and the shim strips ICE candidates); `internet` adds `&turn=<username>;<credential>;turn:<host>:<port>`
- Auth: config `auth` section; MVP is `{ mode: 'password' }`. SSO later adds `{ mode: 'sso', universaltoken }` here only. See [security.md](security.md).

## Config schema (`~/.vdo-multichan/config.json`)

| Key | Notes |
|---|---|
| `configured` | true only after wizard/import |
| `comms_room`, `comms_password`, `vdo_base_url` | shared by all boxes |
| `box_name` | unique per box; becomes the push ID |
| `location` | display only |
| `input_device_uid` / `input_device_name`, `output_device_uid` / `output_device_name` | resolved UID then name |
| `input_channel`, `output_channel`, `gain_out`, channel overrides | |
| `network_mode` | `lan` or `internet` |
| `turn` | `{ host, port, username, credential }`, used in internet mode |
| `roomcap` | `null` = no limit (no param sent) |

Removed: `lines[]`, `group`, `gain_in`, `instance_name`, `webrtc_*` flags. A config containing `lines` (old schema) is renamed to `config.json.bak` and the app starts unconfigured.

## Session code

Base64 of `{ v: 3, comms_room, comms_password, vdo_base_url, network_mode, turn }`. No box name or devices, so every box gets identical network settings. Non-v3 codes are rejected.

## IPC (renderer <-> main)

Renderer to main: `get-line-status`, `reconnect-line` (restarts audio and the line), `get-config`, `save-config`, `get-links`, `list-audio-devices`, `play-test-tone`, plus wizard/settings helpers. Main to renderer: `line-status` with `{ status, detail, alert }`. Line view to main: `line-heartbeat`, `line-alert`; main to line view: `audio-frame`, `gain-out`. Connect/disconnect are internal to main.

## File map

| Path | Purpose |
|---|---|
| `app/main.js` | boot, config, audio, line view, watchdog |
| `app/preload.js` | renderer bridge |
| `app/shared/urls.js` | all vdo.ninja URL building |
| `app/renderer/index.html`, `app.js` | wizard, settings, status card |
| `app/native/coreaudio.mm`, `binding.gyp` | CoreAudio addon |
| `packaging/com.vdo-multichan.comms.plist`, `install-agent.sh`, `uninstall-agent.sh` | LaunchAgent (see [deployment.md](deployment.md)) |
| `.github/workflows/release.yml` | tag-triggered DMG release |

## Gotchas

- Homebrew Node omits `uv.h`; the addon uses `ThreadSafeFunction::NonBlockingCall` rather than `uv_async_t`.
- Launch via launchd only; do not also add a login item. Two copies publishing the same stream ID kick each other (the single-instance lock is a backstop).
- Never use `alert()`; unattended boxes must not hold modals.
