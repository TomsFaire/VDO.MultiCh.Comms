# Usage Guide

## First run

On first launch a setup wizard prompts for:

- **Event name** — identifies this instance (e.g. `faire-2026`)
- **Line names** — up to 4 names, one per party line (e.g. `Stage`, `FOH`, `Truck`, `Green Room`)

Room keys are generated once from the line names and are permanent. Renaming a line later in Settings does **not** change its room key — the same QR codes and join links remain valid.

---

## Audio device setup

1. Open Settings (gear icon, top right)
2. Select **Input device** — your audio interface, BlackHole channel, or built-in mic
3. Select **Output device** — where remote participants' audio plays back
4. Assign **Input channel** and **Output channel** per line (0-based index):
   - Line 1 on channel 0, Line 2 on channel 1, etc.
   - BlackHole 16ch: channels 0–15 available; BlackHole 2ch: channels 0–1
5. Click **Save** — the shim restarts automatically with the new device

> The shim enumerates your audio interface's actual channel count. If a device shows fewer channels than expected, check that the interface is connected before launching the app.

---

## Sharing a line

Each line panel shows:

- **QR code** — scan from any phone camera app
- **Copy link button** — paste into any messaging app or browser
- **Director link** (person icon) — opens the VDO.ninja director view for that room in your system browser; lets you see and manage all participants on that line

Remote participants:
1. Scan the QR code or open the link on any device
2. Allow microphone access when prompted
3. They're immediately connected — no app, no account required

---

## During a session

Each panel shows the line name and a connection indicator. The app runs all lines simultaneously — each is an independent WebRTC room.

Participant muting is handled within VDO.ninja via the director view. There is no per-participant mute in the app UI.

---

## Session export / import

Use this to move your configuration between machines, back it up, or restore after reinstall.

**Export:**
1. Open Settings
2. Click **Export** — a base64 code is copied to your clipboard
3. Save the code somewhere safe (notes app, message to yourself)

**Import:**
1. Open Settings on the target machine
2. Click **Import** and paste the code
3. Save — the app restores all line names, room keys, and device config

Imported sessions use the same room keys, so the same QR codes work on both machines simultaneously.

---

## Quitting and restarting

Config is saved at `~/.vdo-multichan/config.json` and persists across restarts. Lines reconnect automatically on next launch.

To reset completely, delete `~/.vdo-multichan/config.json` — the setup wizard runs again on next launch.
