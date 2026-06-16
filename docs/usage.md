# Usage Guide

**Version:** v0.1.3

---

## First run

On first launch a setup wizard prompts for:

- **Event name** — identifies this instance (e.g. `studio-2026`); becomes the shared VDO.ninja **comms room**
- **Line names** — up to 4 names, one per party line (e.g. `Party Line`, `Audio`, `TECH`, `PGM`)

Each line gets a **group** inside that room (derived from the line name). The Comms bar at the top shows one QR code and join link for the whole event — mobile users pick their line on the Comms page.

---

## Audio device setup

### Global device (shared across lines)

1. Open **Settings** (gear icon, top right)
2. Select **Input device** — your audio interface or built-in mic
3. Select **Output device** — where remote participants' audio is played back
4. Click **Save**

### Per-line device (dedicated interface per PL)

Each line panel has its own **In device** and **Out device** dropdowns. When a line has its own devices set:

- A dedicated CoreAudio session is opened for that line on connect
- The line's audio is fully isolated from other lines — useful for assigning one USB headset or belt-pack interface per operator
- Set both dropdowns to the same interface for a duplex (single-device) session

If a per-PL device is left unset (blank), the line falls back to the global device and channel index routing.

### Channel assignment

Each line panel also has **In** and **Out** channel selectors (1-based in the UI, 0-based in config):

- Line 1 on channel 1, Line 2 on channel 2, etc.
- A 4-channel interface can run 4 independent party lines simultaneously
- BlackHole 16ch: channels 1–16; Focusrite Scarlett 4i4: channels 1–4

---

## Gain and level meters

Each line panel shows:

- **Gain in** — scales the mic capture before it's sent over WebRTC (0–10×, ~+20 dB max)
- **Gain out** — scales incoming remote audio before it's written to the output channel (0–10×)
- **Level meters** — two bars per line: mic (left, green) and remote (right, blue)
  - Yellow at 60%, red at 95% — signals approaching clip

Sliders update the display live and save on release (no audio restart).

---

## Joining from mobile / remote

The **Comms bar** (top of the main window) shows:

- **QR code** — one link for the whole event
- **Copy link** — paste into messaging apps or browsers
- **Director link** — opens the VDO.ninja director view for all groups in your system browser

Remote participants:

1. Scan the Comms QR code or open the link
2. Allow microphone access when prompted
3. **Tap the button for their party line** before talking — ungrouped audio is heard on all lines
4. They're in — no app, no account

Each desktop line panel also shows a group-scoped push URL for the operator view.

---

## During a session

- Click **Connect** on each line panel to open a VDO.ninja session for that group
- Lines can run simultaneously inside the same comms room
- Remote audio for a line plays on that line's configured output channel / device
- Level meters update in real time — mic bar shows what you're sending, remote bar shows what's coming in

When connecting multiple lines at once, the app staggers joins slightly to avoid signaling contention.

---

## Session export / import

Move configuration between machines, back it up, or restore after reinstall.

**Export:**

1. Open Settings
2. Click **Export** — a base64 code is copied to your clipboard
3. Save the code somewhere safe

**Import:**

1. Open Settings on the target machine
2. Click **Import** and paste the code
3. Save — restores `comms_room`, groups, line names, and optional room password

Imported sessions use the same comms room and groups, so the same Comms QR works on both machines.

---

## Settings reference

| Setting | Purpose |
|---------|---------|
| VDO.ninja URL | Public `https://vdo.ninja` or your self-hosted HTTPS frontend |
| **Test connection** | Verifies HTTPS reachability of a custom base URL |
| Comms password | Optional room password appended to all generated URLs |
| LAN WebRTC mode | Strip TURN/STUN from Electron views — suppresses DNS errors on same-LAN shows; disable (default) for WAN/cross-building use |

See [self-hosting.md](self-hosting.md) for custom VDO.ninja and TURN setup.

---

## Quitting and restarting

Config is saved at `~/.vdo-multichan/config.json` and persists across restarts.

To reset completely, delete `~/.vdo-multichan/config.json` — the setup wizard runs again on next launch.

Legacy configs with per-line `room_key` values are migrated automatically to `comms_room` + `group` on load.
