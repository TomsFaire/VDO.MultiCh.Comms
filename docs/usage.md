# Usage Guide

**Version:** v0.1.1

---

## First run

On first launch a setup wizard prompts for:

- **Event name** — identifies this instance (e.g. `faire-2026`); becomes the shared VDO.ninja **comms room**
- **Line names** — up to 4 names, one per party line (e.g. `Stage`, `FOH`, `Truck`, `Green Room`)

Each line gets a **group** inside that room (derived from the line name). The Comms bar at the top shows one QR code and join link for the whole event — mobile users pick their line on the Comms page.

Renaming a line in Settings updates the display label. The stored **group** (routing identity) does not change automatically; edit it in Settings if you need different routing.

---

## Audio device setup

1. Open **Settings** (gear icon, top right)
2. Select **Input device** — your audio interface, BlackHole, or built-in mic
3. Select **Output device** — where remote participants' audio is played back (can be the same device for duplex routing)
4. Assign **Input channel** and **Output channel** per line (0-based index):
   - Line 1 on channel 0, Line 2 on channel 1, etc.
   - BlackHole 16ch: channels 0–15; BlackHole 2ch: channels 0–1
5. Click **Save** — CoreAudio restarts with the new devices; connected lines keep their VDO.ninja sessions

The app enumerates devices via CoreAudio and shows accurate channel counts. If a device shows fewer channels than expected, connect the interface before launching the app.

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

- Connect lines from the desktop panels — each opens a hidden VDO.ninja view for that group
- All lines can run simultaneously inside the same comms room
- Remote audio for a line plays on that line's configured **output channel** on your audio interface
- Participant muting is handled in the VDO.ninja director view; there is no per-participant mute in the app UI

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
| LAN WebRTC mode | Default on — best for same-LAN shows; disable for cross-NAT with TURN |

See [self-hosting.md](self-hosting.md) for custom VDO.ninja and TURN setup.

---

## Quitting and restarting

Config is saved at `~/.vdo-multichan/config.json` and persists across restarts.

To reset completely, delete `~/.vdo-multichan/config.json` — the setup wizard runs again on next launch.

Legacy configs with per-line `room_key` values are migrated automatically to `comms_room` + `group` on load.
