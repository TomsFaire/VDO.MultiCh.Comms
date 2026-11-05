# Usage Guide

The app is one persistent channel. Everyone connected to the room hears everyone else.

## First run (wizard)

The wizard runs until it completes. Quitting halfway leaves the box unconfigured and it will not join anything on relaunch.

**New session**
1. Event name (becomes the room)
2. Room password
3. Box name (must be unique across boxes; becomes this box's stream ID)

**Join an existing session**
1. Paste the session code from another box (Settings, Export)
2. Enter this box's name (unique)

Either path marks the box configured. From then on it connects automatically at launch, with no window shown.

## Audio devices

Open Settings:

1. **Input device** and **Output device**: your audio interface
2. **Input channel** and **Output channel** (0-based) on those devices
3. **Output gain**
4. Save

Devices are matched by UID, then by name. If the interface is missing at boot (late USB enumeration), the status card shows "device missing" and the app retries every 10 seconds.

## Status card

Shows connection state, box name and location, input/output channel, output gain (0 to 10), a test tone, and Reconnect. States distinguish network problems from authentication problems.

**Level meters:** two bars under the gain slider. Green is the mic (capture frames for this box's input channel); blue is remote audio (playback frames pushed to its output channel). Both turn yellow at 60% and red at 95%, and fall back over about a second. They only update while the window is visible.

## Settings

- **Room name**: lowercase letters and numbers only. Changing it reconnects the box to the new room and changes the join link, director link, and QR code. Change it on every box (or re-export the session code) so they stay together.
- **Password**: shared room password, sent on every URL. Change it on all boxes together.
- **Network**: Internet (default) or LAN.
  - Internet: nothing to fill in. VDO.ninja's built-in STUN/TURN servers are used. Tick **Use my own TURN server** only if you run one, then enter host, port, username and credential (see [self-hosting.md](self-hosting.md)).
  - LAN: no TURN, STUN only, ICE candidate stripping. Only boxes on the same network can connect; remote guests can't.
- **Max participants** (optional): empty means no limit. When set, vdo.ninja refuses joins beyond N. Changing it does not drop connected boxes.
- **Box name / location**
- **VDO.Ninja base URL**: default is the public instance (`https://vdo.ninja`); choose Custom to point at a self-hosted one.

## Adding a remote guest

Send them two things:

1. The **join link** (or QR code) from the share panel. Click the QR image to copy it as a PNG to the clipboard (falls back to copying the link text)
2. The room **password**

They open the link on any phone or browser, allow the microphone, and enter the password. No app or account needed. The link includes the password and TURN credentials in Internet mode, so treat it as a secret. See [security.md](security.md).

A **director link** is also available to see and manage participants in vdo.ninja.

## Adding another box

Export the session code on a configured box (Settings, Export), then on the new box choose "Join an existing session" and paste it. The code carries room, password, base URL, and network settings; the new box only needs its own name and devices.

## Quitting and restarting

Config is saved at `~/.vdo-multichan/config.json`. A configured box reconnects on its own at launch. Cmd-Q is a deliberate quit and will not be respawned by launchd; a crash will. Reach the window from the Dock to change settings. To start over, delete the config file and relaunch.
