# Documentation Refresh — Design Spec

**Date:** 2026-06-02
**Version target:** v0.1.0
**Status:** Approved

---

## Overview

Refresh all project documentation for the v0.1.0 release. Replace build-from-source install instructions with a download-the-DMG flow, add a full usage walkthrough, move developer build instructions to a dedicated file, and refresh all existing docs for accuracy and version consistency.

---

## Audiences

- **End-users** — live production crew (A2s, stage managers, broadcast engineers) who know what a party line is but are not developers. Primary path: download DMG, run, share QR codes.
- **Developers/contributors** — technically inclined, may want to build from source, will read architecture notes.

---

## Files Changed

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `README.md` | Landing page — pitch, install, essentials, links |
| Create | `docs/usage.md` | Full end-user usage walkthrough |
| Create | `docs/development.md` | Source build instructions + architecture notes |
| Modify | `docs/known-issues.md` | Version bump to v0.1.0, add Gatekeeper note |
| Modify | `docs/self-hosting.md` | Remove unimplemented "Test connection" button reference |
| Modify | `docs/handoff.md` | Version bump, reference release DMG as primary artifact |

---

## README.md

### Structure (in order)

1. **Header** — title + version badge (`v0.1.0`) + one-sentence pitch:
   > "A macOS desktop app that turns a multi-channel audio interface into a multi-party-line IP intercom — no SIP, no server, no install for remote participants."

2. **What it does** — 4 bullets:
   - 4 independent party lines, each a separate WebRTC room
   - Remote participants join from any phone or browser via QR code — no app, no account
   - Hardware audio routed per channel via a Rust/CPAL shim; works with BlackHole, Focusrite, and other multi-channel interfaces
   - WebRTC transport via VDO.ninja — handles NAT traversal, codec negotiation, and mixing

3. **Requirements** — macOS Apple Silicon (arm64); multi-channel audio interface (or built-in mic); no Rust or Node.js required for end-users

4. **Install** — download the `.dmg` from the GitHub Releases page; mount and drag to Applications; right-click → Open on first launch (app is ad-hoc signed, not notarized — Gatekeeper will block a normal double-click until the user explicitly allows it)

5. **Getting started** — first-run wizard (event name + line names), share a QR code — link to `docs/usage.md` for full walkthrough

6. **How it works** — existing architecture diagram + short paragraph retained for technical audience

7. **Status table** — updated for v0.1.0; remove per-build parentheticals like "(build 28)"; keep ✅/⏳ symbols; add row for "2-machine party line" as ✅ validated

8. **Configuration** — existing `config.json` snippet retained

9. **Self-hosting** — one line + link to `docs/self-hosting.md`

10. **Development** — one line + link to `docs/development.md`

11. **Known issues** — one line + link to `docs/known-issues.md`

---

## docs/usage.md (new)

### Sections

1. **First run**
   - Wizard prompts for event name and up to 4 line names
   - Room keys are generated once from line names and are permanent — renaming a line later does not change its room key

2. **Audio device setup**
   - Open Settings (gear icon)
   - Select input device (your audio interface, BlackHole, or built-in mic)
   - Select output device (where remote audio plays)
   - Assign input/output channel index per line (0-based; e.g. BlackHole 16ch: line 1 → channel 0, line 2 → channel 1)
   - Save — the shim restarts automatically with the new device

3. **Sharing a line**
   - Each panel shows a QR code and a copy-link button
   - Remote participants scan or tap the link, allow microphone access when prompted, and are immediately connected — no app, no account
   - Director link (person icon) opens the VDO.ninja director view for that room in the system browser

4. **During a session**
   - Each panel shows line name and connection indicator
   - Participant muting is handled within VDO.ninja (via the director view) — there is no per-participant mute in the app UI

5. **Session export / import**
   - Settings → Export copies a base64 code to clipboard — contains all line names, room keys, and device config
   - Settings → Import pastes a code and restores config — use to move setup between machines or restore after reinstall
   - Room keys in an exported session are permanent; importing on a second machine gives identical room keys (same QR codes)

6. **Quitting and restarting**
   - Config persists at `~/.vdo-multichan/config.json`
   - Lines reconnect automatically on next launch

---

## docs/development.md (new)

### Sections

1. **Prerequisites** — Rust stable (via rustup), Node.js 18+, macOS arm64

2. **Build the shim**
   ```bash
   cd shim
   cargo build --release
   ```

3. **Run in dev mode** (shim must be pre-built first)
   ```bash
   cd app
   npm install
   npm start
   ```

4. **Build a DMG**
   ```bash
   cd shim && cargo build --release
   cd ../app && npm run build
   # Output: app/dist/VDO.MultiCh.Comms-0.1.0-arm64.dmg
   ```
   Build number auto-increments in `app/build-meta.json` on each DMG build.

5. **Viewing logs from the packaged app**
   ```bash
   /Applications/VDO.MultiCh.Comms.app/Contents/MacOS/VDO.MultiCh.Comms
   ```
   If a previously mounted DMG is blocking install, eject it first:
   ```bash
   hdiutil detach "/Volumes/VDO.MultiCh.Comms 0.1.0" -force
   ```

6. **Repo layout** — `app/` (Electron), `shim/` (Rust), `docs/` (documentation)

7. **Architecture notes** — move detailed sections from current README:
   - Shim broadcast dispatch
   - AudioWorklet bridge
   - Mic change reconnect
   - Shim binary path (packaged vs dev)
   - VDO.ninja join URL format

---

## docs/known-issues.md

- Update header: `v0.1.0 build 28`
- Move "App is unsigned / Gatekeeper" from Open Issues to its own **Install Notes** section at the top — it affects every new user of the release DMG and should be prominent
- All other resolved/open content remains accurate — no changes needed

---

## docs/self-hosting.md

- Remove the sentence "Verify with the **Test connection** button in the app Settings panel" — this button is not implemented
- All other content is accurate

---

## docs/handoff.md

- Update version header: `0.1.0 build 28`
- Update `build-meta.json` snippet to show `"version": "0.1.0"`
- Replace the "How to build" DMG output path `0.0.1` → `0.1.0`
- Add note that the v0.1.0 DMG is published on GitHub Releases; link to `docs/development.md` for source build instructions
- All architecture/implementation detail sections remain accurate — no changes needed
