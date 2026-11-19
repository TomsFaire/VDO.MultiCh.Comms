# Deployment (unattended box)

Target: a Mac running Zoom Rooms that force-reboots weekly. The app starts from a launchd LaunchAgent, joins hidden from saved config, and recovers on its own.

## Before you install

1. Install the app to /Applications and launch it once manually.
2. Complete the wizard (a box is only auto-joined once `configured: true`).
3. Allow microphone access when macOS prompts. Do this once, interactively: TCC permission is stored per app and persists across reboots and under launchd.
4. Pick the audio devices in Settings and confirm audio both ways.
5. Quit (Cmd-Q).

## Dedicated audio interface

Use an interface for the intercom that Zoom Rooms does not use. Sharing a device with Zoom Rooms causes sample-rate and channel contention. Select the intercom interface explicitly; do not rely on the system default device. The app expects 48 kHz.

## Install the LaunchAgent

Files (in `packaging/`):

- `com.vdo-multichan.comms.plist`: template. Label `com.vdo-multichan.comms`, `RunAtLoad: true`, `KeepAlive: { SuccessfulExit: false }`, `ThrottleInterval: 10`, `LimitLoadToSessionType: Aqua`. Runs `<app>/Contents/MacOS/VDO.MultiCh.Comms`.
- `install-agent.sh [path/to/VDO.MultiCh.Comms.app]`: substitutes the app path (default `/Applications/VDO.MultiCh.Comms.app`) and `$HOME` into the template, writes `~/Library/LaunchAgents/com.vdo-multichan.comms.plist`, creates the log directory, then runs `launchctl bootout` (errors ignored) and `launchctl bootstrap gui/$(id -u)`.
- `uninstall-agent.sh`: `launchctl bootout` and removes the installed plist.

Run the install script as the user that auto-logs in to the Mac:

```bash
packaging/install-agent.sh
```

Do not also add the app as a Login Item; two launch mechanisms start two copies, which fight over the same stream ID (the app's single-instance lock is only a backstop).

Uninstall:

```bash
packaging/uninstall-agent.sh
```

## Behaviour

- **Crash** (`kill -9`, segfault): launchd respawns the app and it rejoins.
- **Cmd-Q / normal exit**: not respawned (`SuccessfulExit: false`).
- **Weekly reboot**: after auto-login the LaunchAgent starts the app. It launches without showing or focusing a window, so it does not cover Zoom Rooms, then starts audio and joins.
- **Network not up at boot**: the watchdog retries with backoff (2s to 60s).
- **USB interface late**: the app retries device resolution every 10s and shows "device missing" until found.
- **After a hard power cycle**: vdo.ninja may briefly still hold the old stream ID; the watchdog retries until it clears.
- **Closing the window** hides it; the app keeps running. Quit with Cmd-Q or the app menu. A Dock click or a second launch shows the window.
- **Settings**: click the Dock icon to show the window.
- **Prerequisite**: the Mac must auto-login to a user session; LaunchAgents do not run before login.

## Troubleshooting

Service state:

```bash
launchctl list | grep vdo-multichan          # PID, last exit status
launchctl print gui/$(id -u)/com.vdo-multichan.comms
launchctl kickstart -k gui/$(id -u)/com.vdo-multichan.comms   # restart now
```

Logs:

```bash
# System log for the process
log show --last 30m --predicate 'process == "VDO.MultiCh.Comms"' --info
# App stdout/stderr
tail -f ~/Library/Logs/VDO.MultiCh.Comms/stdout.log ~/Library/Logs/VDO.MultiCh.Comms/stderr.log
```

Status card values: `connecting`, `connected`, `reconnecting`, `device-missing`, `auth-failed`, `disconnected` (not configured). The card also shows the reason for the last reconnect and the last alert text raised by the vdo.ninja page.

| Symptom | Check |
|---|---|
| Not running after reboot | Auto-login enabled? `launchctl list`; plist loaded in the right user? Box `configured`? |
| Running but silent | "device missing" on status card; log lines about UID/name match; mic permission in System Settings, Privacy, Microphone |
| Won't stay connected | Duplicate box name (stream ID collision); duplicate launch mechanism; check log for "ID in use" retries |
| Kicks other box | Two boxes with the same box name |
| Shows "Auth failed" | Password changed on other boxes, or SSO token expired (future) |
| Respawn loop | `launchctl list` exit status; addon missing or config unreadable |
| Window needed | Click Dock icon; or run `kickstart -k` after fixing config |
