# GitHub Actions Release Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a GitHub Actions workflow that builds a macOS arm64 `.dmg` + Rust shim, ad-hoc signs it, and publishes a GitHub Release with checksums and auto-generated release notes whenever a `v*.*.*` tag is pushed.

**Architecture:** Two sequential jobs — `build-shim` compiles the Rust binary and uploads it as a workflow artifact; `build-electron` downloads that artifact, runs `electron-builder`, signs ad-hoc, generates checksums and release notes, then publishes the GitHub Release using `softprops/action-gh-release@v2`.

**Tech Stack:** GitHub Actions, `actions/checkout@v4`, `actions/cache@v4`, `actions/upload-artifact@v4`, `actions/download-artifact@v4`, `actions/setup-node@v4`, `softprops/action-gh-release@v2`, Cargo, electron-builder, codesign (macOS), shasum

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `.github/workflows/release.yml` | Full release workflow |
| Modify | `app/package.json` | Bump version to `0.1.0` |
| Modify | `app/build-meta.json` | Bump version to `0.1.0` |

---

### Task 1: Bump version to 0.1.0

**Files:**
- Modify: `app/package.json`
- Modify: `app/build-meta.json`

- [ ] **Step 1: Update `app/package.json` version field**

Edit `app/package.json` line 3 — change `"version": "0.0.1"` to:
```json
"version": "0.1.0",
```

- [ ] **Step 2: Update `app/build-meta.json` version field**

Edit `app/build-meta.json` — change `"version": "0.0.1"` to:
```json
{
  "version": "0.1.0",
  "build": 27
}
```
(keep `build` at current value — CI will bump it automatically during the build step)

- [ ] **Step 3: Verify both files**

```bash
node -e "const p=require('./app/package.json'); const m=require('./app/build-meta.json'); console.log(p.version, m.version);"
```
Expected output: `0.1.0 0.1.0`

- [ ] **Step 4: Commit**

```bash
git add app/package.json app/build-meta.json
git commit -m "chore: bump version to 0.1.0"
```

---

### Task 2: Create the GitHub Actions workflow directory and file skeleton

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Create `.github/workflows/release.yml` with the full workflow**

```yaml
name: Release

on:
  push:
    tags:
      - 'v*.*.*'

jobs:
  build-shim:
    name: Build Rust shim (arm64)
    runs-on: macos-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Cache Cargo registry and build
        uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            shim/target
          key: ${{ runner.os }}-cargo-${{ hashFiles('shim/Cargo.lock') }}
          restore-keys: |
            ${{ runner.os }}-cargo-

      - name: Build shim
        working-directory: shim
        run: cargo build --release

      - name: Upload shim binary
        uses: actions/upload-artifact@v4
        with:
          name: shim-binary
          path: shim/target/release/shim
          if-no-files-found: error

  build-electron:
    name: Build Electron app and publish release
    runs-on: macos-latest
    needs: build-shim
    permissions:
      contents: write
    steps:
      - name: Checkout (full history for release notes)
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Download shim binary
        uses: actions/download-artifact@v4
        with:
          name: shim-binary
          path: shim/target/release

      - name: Make shim executable
        run: chmod +x shim/target/release/shim

      - name: Set up Node 20
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: app/package-lock.json

      - name: Install Node dependencies
        working-directory: app
        run: npm ci

      - name: Build DMG
        working-directory: app
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: 'false'
        run: npm run build

      - name: Ad-hoc sign DMG
        run: codesign --force --deep --sign - app/dist/*.dmg

      - name: Generate SHA-256 checksums
        run: |
          cd app/dist
          shasum -a 256 *.dmg > sha256sums.txt
          cat sha256sums.txt

      - name: Generate release notes
        id: release_notes
        run: |
          # Get previous tag; fall back to initial commit if this is the first tag
          PREV_TAG=$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || git rev-list --max-parents=0 HEAD)
          echo "Generating notes from ${PREV_TAG} to HEAD"
          git log "${PREV_TAG}..HEAD" --pretty=format:"- %s" > release-notes.md
          echo "" >> release-notes.md
          cat release-notes.md

      - name: Extract version from tag
        id: version
        run: echo "VERSION=${GITHUB_REF_NAME#v}" >> "$GITHUB_OUTPUT"

      - name: Publish GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          name: "v${{ steps.version.outputs.VERSION }} — VDO.MultiCh.Comms"
          body_path: release-notes.md
          files: |
            app/dist/*.dmg
            app/dist/sha256sums.txt
          fail_on_unmatched_files: true
```

- [ ] **Step 3: Verify YAML is valid**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))" && echo "YAML valid"
```
Expected: `YAML valid`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add GitHub Actions release workflow for v0.1.0"
```

---

### Task 3: Tag and trigger the release

**Files:** (none changed — this task pushes the tag)

- [ ] **Step 1: Confirm you are on `main` and working tree is clean**

```bash
git status
git log --oneline -5
```
Expected: clean working tree, all version bump and CI commits present.

- [ ] **Step 2: Create the annotated tag**

```bash
git tag -a v0.1.0 -m "Release v0.1.0 — first 2-machine PoC validated"
```

- [ ] **Step 3: Push the tag to origin**

```bash
git push origin v0.1.0
```

- [ ] **Step 4: Confirm the workflow triggered**

Open your repository on GitHub → Actions tab. You should see a "Release" workflow run triggered by the `v0.1.0` tag. Both jobs (`Build Rust shim` and `Build Electron app`) should appear.

- [ ] **Step 5: Confirm the release published**

Once the workflow completes (typically 5–10 min), go to the repository's **Releases** page. Verify:
- Release title is `v0.1.0 — VDO.MultiCh.Comms`
- Assets include a `.dmg` and `sha256sums.txt`
- Release body contains bullet-point commit messages
