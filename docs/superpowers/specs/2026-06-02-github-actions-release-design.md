# GitHub Actions Release Workflow — Design Spec

> **Status: COMPLETED** — shipped in CI; updated 2026-06-15 for CoreAudio native addon (Rust shim removed).

**Original date:** 2026-06-02  
**Completed:** 2026-06-02 (initial workflow), revised 2026-06-15 (native addon build)  
**Current workflow:** `.github/workflows/release.yml`

---

## What shipped vs original design

| Original plan | As built |
|---------------|----------|
| Two jobs: `build-shim` → `build-electron` | **Single job** `build-electron` |
| Rust shim `cargo build` artifact | **`app/native` node-gyp** builds `coreaudio.node` in CI |
| Shim bundled via `extraResources` | **`coreaudio.node`** bundled via `extraResources` |

Everything else (tag trigger, ad-hoc sign, checksums, release notes, `softprops/action-gh-release`) matches the original spec.

---

## Overview

GitHub Actions workflow that builds and publishes a GitHub Release when a version tag is pushed. The release includes an ad-hoc signed macOS arm64 `.dmg`, a SHA-256 checksums file, and auto-generated release notes from git history.

---

## Trigger

- **Event:** `push` to tags matching `v*.*.*`
- **Branch scope:** Tags may be pushed from any branch (typically `main`)

---

## Versioning

Before tagging, update:

- `app/package.json` → `"version": "x.y.z"`
- `app/build-meta.json` → `"version": "x.y.z"` (`build` auto-increments during `npm run build`)

Then:

```bash
git add app/package.json app/build-meta.json
git commit -m "chore: bump version to x.y.z"
git tag vx.y.z
git push origin vx.y.z
```

The workflow extracts the version from the tag name (strips leading `v`).

---

## Workflow architecture (current)

**File:** `.github/workflows/release.yml`  
**Single job:** `build-electron`

| Step | Detail |
|------|--------|
| Checkout | `actions/checkout@v4`, `fetch-depth: 0` |
| Node setup | `actions/setup-node@v4`, Node 20, npm cache |
| Install deps | `npm ci` in `app/` |
| Native addon | `npm install && npm run build` in `app/native/` |
| Build DMG | `npm run build` in `app/` with `CSC_IDENTITY_AUTO_DISCOVERY=false` |
| Ad-hoc sign | `codesign --force --deep --sign - app/dist/*.dmg` |
| Checksums | `shasum -a 256 app/dist/*.dmg > app/dist/sha256sums.txt` |
| Release notes | `git log <prev-tag>..HEAD --pretty=format:"- %s"` |
| Publish | `softprops/action-gh-release@v2` |

---

## Signing

- Apple Developer ID signing skipped (`CSC_IDENTITY_AUTO_DISCOVERY=false`)
- Ad-hoc signing via `codesign --force --deep --sign -`
- Users must right-click → Open on first launch (post-alpha consideration: notarization)

---

## Permissions & secrets

- Job requires `contents: write`
- Uses built-in `GITHUB_TOKEN` only — no custom secrets

---

## Artifacts

| File | Description |
|------|-------------|
| `VDO.MultiCh.Comms-<version>-arm64.dmg` | macOS arm64 installer |
| `sha256sums.txt` | SHA-256 hash of the DMG |
| Release body | Bullet list of commits since previous tag |

---

## Future considerations (not started)

- Apple Developer ID notarization
- Windows build job
- macOS x64 / universal binary
