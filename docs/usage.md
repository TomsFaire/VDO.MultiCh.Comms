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

Shows connection state, box name and location, input/output channel, output gain, a test tone, and Reconnect. States distinguish network problems from authentication problems.

## Settings

- **Password**: shared room password, sent on every URL. Change it on all boxes together.
- **Network**: LAN or Internet.
  - LAN: no TURN, STUN only, ICE candidate stripping. For boxes on the same network.
  - Internet: enter TURN host, port, username, credential. See [self-hosting.md](self-hosting.md).
- **Max participants** (optional): empty means no limit. When set, vdo.ninja refuses joins beyond N. Changing it does not drop connected boxes.
- **Box name / location**
- **VDO.Ninja base URL**: default is the public instance.

## Adding a remote guest

Send them two things:

1. The **join link** (or QR code) from the status/share panel
2. The room **password**

They open the link on any phone or browser, allow the microphone, and enter the password. No app or account needed. The link includes the password and TURN credentials in Internet mode, so treat it as a secret. See [security.md](security.md).

A **director link** is also available to see and manage participants in vdo.ninja.

## Adding another box

Export the session code on a configured box (Settings, Export), then on the new box choose "Join an existing session" and paste it. The code carries room, password, base URL, and network settings; the new box only needs its own name and devices.

## Quitting and restarting

Config is saved at `~/.vdo-multichan/config.json`. A configured box reconnects on its own at launch. Cmd-Q is a deliberate quit and will not be respawned by launchd; a crash will. Reach the window from the Dock to change settings. To start over, delete the config file and relaunch.
