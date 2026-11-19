# Production branch

**`single-channel` is the intended intercom production branch for the foreseeable future.** All intercom (VDO.MultiCh.Comms) work — fixes, releases, deployment — happens here.

## This repo holds two separate products

| Branch | Product | Status |
|---|---|---|
| `single-channel` | **VDO.MultiCh.Comms** — the single-persistent-channel intercom (this doc) | Active, production-intended |
| `main` | **VDO.Spacial.Comms** — spatial/binaural intercom, forked from this app | Separate product; do not merge or build it expecting intercom behavior |

The two diverged after the [v0.1.4](https://github.com/TomsFaire/VDO.MultiCh.Comms/releases/tag/v0.1.4) release (see below): `main` went on to become the spatial product, while intercom development continued on `single-channel`. They share history up to that point but are otherwise unrelated going forward. Don't assume `main` contains the intercom app, and don't assume `single-channel` tracks `main`.

## Branch protection

Both `single-channel` and `production` require pull requests to merge (0 approvals needed, so a solo maintainer isn't blocked), and disallow force-pushes and branch deletion, enforced for admins too. `main` currently has no protection rules (out of scope here — it's a separate product).

## The `v0.1.4` release

[`v0.1.4`](https://github.com/TomsFaire/VDO.MultiCh.Comms/releases/tag/v0.1.4) is GitHub's current "Latest" release and the last release of the **previous, 4-line multi-channel architecture** (`vdo-multichan-comms`, one WebRTC room per party line). It predates the single-channel rewrite and is not part of `single-channel`'s lineage going forward — it's kept for historical reference and as the point where the two products' histories diverge. It is **not** a release of what's on `single-channel` today.

The closest thing to a validated single-channel release right now is the `production` branch / `production-baseline-2026-11-04` tag (commit `d8b9088`, see [below](#validated-builds)) and the draft prerelease [`v0.2.0-beta.1`](https://github.com/TomsFaire/VDO.MultiCh.Comms/releases/tag/untagged-dbf6dd187cccd141bcdd) (currently build 7, untested beyond a single two-machine pass — see that release's notes).

## Validated builds

Only one commit on this line has recorded field-validation evidence:

- **`d8b9088`** (`build: v0.2.0 build 6 test DMG`) — tagged `production-baseline-2026-11-04`, branch `production`. A two-machine cross-network test passed with no audio issues. One commit later (`40ca7ec`, in build 7 / current `single-channel` tip) added a phone-QR-join fix that has **not** been field-confirmed.

`single-channel`'s tip moves ahead of this as development continues. Before calling any later commit "production-validated," get the same kind of direct confirmation and record it the same way (a tagged commit, not an assumption) — see [PR #18](https://github.com/TomsFaire/VDO.MultiCh.Comms/pull/18) for the full unticked validation checklist (reboot persistence, 3-participant audio, Wi-Fi reconnect, USB hot-plug, etc.) that still applies to anything past build 6.

## Building from a specific commit

To build exactly what a given commit produces (e.g. to reproduce a field-tested build), don't just build the branch tip:

```bash
git fetch origin
git checkout <commit-sha>          # or: git checkout -b build-check <commit-sha>
cd app && npm ci
cd native && npm install && cd ..  # builds the CoreAudio N-API addon
npm run build                      # bump-build.js, then electron-builder -> app/dist/*.dmg
```

This mirrors `.github/workflows/release.yml`'s steps (Node 20, same order). See [development.md](development.md) for the full build/run/package reference, troubleshooting, and the manual test checklist — this doc only covers which commit/branch to build from and why.

To confirm which exact build an existing DMG came from, check its bundled `app/build-meta.json` (`{"version": ..., "build": N}`) against this branch's `build: vX.Y.Z build N` commits — each one is a single-commit marker for that build number.
