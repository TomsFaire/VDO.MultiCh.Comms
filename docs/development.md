# Development

## Prerequisites

- macOS on Apple Silicon
- Xcode Command Line Tools (`xcode-select --install`) for the native addon
- Node.js 20 (matches CI)

No Rust toolchain is needed; the old Rust/CPAL shim is gone.

## Layout

```
app/                 Electron app (package.json, main.js, preload.js, renderer/)
app/native/          CoreAudio N-API addon (coreaudio.mm, binding.gyp)
app/scripts/         bump-build.js, make-icns.sh
packaging/           LaunchAgent plist and install script
.github/workflows/   release.yml
```

## Build and run

```bash
# 1. App dependencies
cd app
npm ci

# 2. CoreAudio addon (node-gyp; links CoreAudio + Foundation, deployment target 12.0)
cd native
npm install        # runs `node-gyp rebuild` via the install script
npm run build      # rebuild explicitly after editing coreaudio.mm
cd ..

# 3. Run in dev
npm start          # electron .
```

The addon outputs `app/native/build/Release/coreaudio.node`. Dev runs load it from there; packaged builds load it from `Resources/coreaudio.node` (electron-builder `extraResources`).

If the addon fails to load after an Electron upgrade, rebuild it; the addon is N-API so it should not need per-Electron-version rebuilds, but a stale build directory can cause trouble (`rm -rf app/native/build` and rebuild).

## Package a DMG

```bash
cd app
npm run build        # bump-build.js, then electron-builder (arm64 dmg) -> app/dist/
npm run build:dir    # unpacked .app only, faster for testing
```

`scripts/bump-build.js` increments the build number in `app/build-meta.json` on each build.

Unsigned local builds: `CSC_IDENTITY_AUTO_DISCOVERY=false npm run build`, then optionally `codesign --force --deep --sign - dist/*.dmg`.

## Release

Push a tag matching `v*.*.*`. `.github/workflows/release.yml` (macos-latest, Node 20):

1. `npm ci` in `app/`
2. `npm install` + `npm run build` in `app/native/`
3. `npm run build` in `app/` with `CSC_IDENTITY_AUTO_DISCOVERY=false`
4. Ad-hoc sign the DMG, write `sha256sums.txt`
5. Publish a GitHub Release with release notes from the commit log since the previous tag

Bump `version` in `app/package.json` before tagging.

## Testing

There is no automated test suite. Verification is manual on a real Mac with a second machine or a phone as other participants; see the checklist in the plan for the intercom MVP (fresh install, abandoned wizard, 3-party audio, relaunch, crash respawn, reboot, network drop, late USB, network modes, roomcap).

Also check by hand: level meters move with mic input and with remote speech; no remote audio comes out of the Mac's default output (audio bleed); Room name in Settings reconnects the box; clicking the QR copies it.

The native addon (`app/native/coreaudio.mm`) keeps a per-session engine map (`startSession`/`stopSession`). This app uses only the legacy `default` session via `startAudio`/`stopAudio`, and addresses it explicitly for playback (`pushPlaybackSamples('default', ...)`, `clearPlaybackChannel(ch, 'default')`).

## Config and logs

- Config: `~/.vdo-multichan/config.json` (see [handoff.md](handoff.md) for the schema)
- Delete it to re-run the wizard
- Runtime logs: see [deployment.md](deployment.md#troubleshooting)

## Notes

- Do not commit `.env` files; `.claude/plans/` is git-ignored.
- `session.setPreloads` is deprecated in newer Electron; migrate to `registerPreloadScript` when convenient.
