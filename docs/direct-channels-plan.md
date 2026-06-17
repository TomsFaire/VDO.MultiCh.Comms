# Planned: Direct Channels Interoperability

**Status:** planned — not started  
**Depends on:** `vdo.spacialComms` defining and shipping the signaling layer first

---

## What this is

Direct channels are private 1:1 audio paths between two specific operators — e.g. a director's dedicated line to the TD — running alongside party lines in the same VDO.ninja room. They are fully specified in `vdo.spacialComms` (see that repo's architecture doc). This document describes what VDO.MultiCh.Comms needs to add so that a classic-app operator can participate in a Direct channel initiated by a spatial-app operator.

Interoperability target: a classic operator appears in the spatial app's roster and can accept/establish a Direct channel. The classic app treats a Direct channel as an additional line — a `WebContentsView` pushing to and listening from the same private group the spatial app derives. No spatial rendering needed on the classic side.

---

## What the classic app already has

- One `WebContentsView` per party line, handling both push and group-scoped listen
- Session export/import format (v2 base64 JSON: `comms_room`, `comms_password`, `lines`)
- Setup wizard generating per-line `group` names from line names

The Direct channel group name derivation, on-demand connection model, and identity scheme are all defined in `vdo.spacialComms` and must be adopted here unchanged to interoperate.

---

## What needs to be added

### 1. Stable operator identity
- Generate a stable, immutable operator ID at first launch (UUID, stored in `config.json`)
- Add a display name field to the setup wizard (editable later in Settings)
- The Direct channel group name is derived deterministically from both operators' stable IDs — same algorithm as `vdo.spacialComms`, so both sides arrive at the same private group name

### 2. Signaling / presence layer
- Adopt the same signaling transport `vdo.spacialComms` defines — transport TBD by that project (likely a lightweight WebSocket channel piggybacking the existing VDO.ninja room, or a separate presence endpoint)
- Announce presence (stable ID + display name) on room join; withdraw on quit
- Listen for incoming Direct channel requests

### 3. Roster UI
- A panel (or popover off the comms bar) showing currently online operators in the same room
- Presence data fed by the signaling layer
- Tap a name to request a Direct channel; incoming requests show a notification

### 4. Direct channel line handling
- On request sent or accepted: spin up a `WebContentsView` for the derived private group, same as any party line — push to it when talking, listen from it, route output to a configured hardware channel
- Assign the new view an input/output channel via the same per-line config model
- On idle-grace timeout (default 30 s, user-configurable): tear down the `WebContentsView`; reconnect on next talk press

### 5. Comms bar
- Direct channel lines appear in the comms bar alongside party lines
- Distinct visual treatment (e.g. person icon vs. group icon) to distinguish them from PLs

---

## What does NOT need to change

- CoreAudio addon — Direct channels are just another audio line, same I/O path
- Party line handling — zero changes, Direct channels are additive
- Session export format — extend with optional `operators` (stable ID + display name) if cross-app session sharing is needed; party-line fields unchanged

---

## Open questions (defer to `vdo.spacialComms`)

- Exact signaling transport (WebSocket endpoint? VDO.ninja data channel? Something else?)
- Wire format for presence announcements and request messages
- Whether the classic app needs to implement the accept/decline flow or whether requests auto-establish (spatial plan leans toward auto-establish, no explicit accept)
- Whether classic operators can appear in the spatial app's roster if they haven't added this feature yet (probably yes — they're just "online but no Direct channel support")
