# VDO.MultiCh.Comms

A macOS app that turns an audio interface channel into a persistent, single-channel IP intercom. Everyone in the room hears everyone. Remote guests join from any phone or browser with a link and a password.

Status: alpha (v0.1.x).

## How it works

```
Audio interface (CoreAudio)
        |  coreaudio.node (N-API addon: device enumeration, capture, playback)
        v
Electron main process  -- config, auto-join, watchdog, launchd integration
        |  IPC
        v
Hidden WebContentsView -> vdo.ninja URL (room + password)
        |  preload shim: feeds hardware input into getUserMedia,
        |  mixes all remote WebRTC audio into one hardware output channel
        v
WebRTC (VDO.Ninja)  <->  other boxes and remote guests
```

- One persistent channel per box. One room, no groups, no per-line setup.
- Transport is [VDO.Ninja](https://vdo.ninja) (public instance by default; self-hostable).
- Network mode defaults to Internet, using VDO.ninja's built-in STUN/TURN with nothing to configure. A custom TURN server is optional. Switch to LAN in Settings for boxes on one network.
- The status card has live mic and remote level meters; the share panel's QR code copies to the clipboard when clicked.
- The main process connects on its own at launch from saved config. No login and no Join button, so a box recovers unattended after a reboot.
- Target deployment: a Mac running Zoom Rooms that reboots weekly, with the app started by a launchd LaunchAgent.

## Requirements

- macOS 12+ on Apple Silicon (arm64)
- An audio interface (a dedicated one if running next to Zoom Rooms)

## Quick start

1. Download the DMG from the [Releases page](../../releases) and drag the app to Applications.
2. Right-click, Open on first launch (ad-hoc signed, not notarized).
3. Allow microphone access when prompted.
4. In the wizard, either start a new session (event name, password, box name) or join an existing one (paste the session code, enter a box name).
5. Optional: pick input/output devices and channels in Settings. Left on Default, the box uses the Mac's system default mic and speakers. The room name can also be changed there.

Unattended installs: see [docs/deployment.md](docs/deployment.md).

## Docs

- [Usage](docs/usage.md) - wizard, settings, adding remote guests
- [Deployment](docs/deployment.md) - LaunchAgent, mic permission, weekly reboot, troubleshooting
- [Security](docs/security.md) - password model, TURN credentials, SSO plan
- [Self-hosting](docs/self-hosting.md) - VDO.Ninja, TURN, network settings
- [Development](docs/development.md) - building the addon and the app
- [Handoff](docs/handoff.md) - architecture and file map
- [Known issues](docs/known-issues.md)
