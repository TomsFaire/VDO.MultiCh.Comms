# Spatial Intercom — Project Plan

## Vision
A spatial intercom mix built directly on top of the existing `VDO.MultiCh.Comms` foundation. Each VDO-sourced party line gets rendered into a shared spatial mix instead of getting its own dedicated output channel; operators drag each line's position around a virtual "space" to place it left/right/front/back. The same spatial position data drives more than one render target over time: binaural stereo for personal headphone use first, with discrete multichannel HDMI output for fixed control-room/mixing-booth installs as a near-term follow-on (riding existing video-router infrastructure, de-embedded downstream via MADI into the room's actual audio domain). Talk-back is a first-class part of this, not an afterthought: operators select one or more lines and push-to-talk, the same way a real intercom beltpack works, with the control surface itself varying by who's using it — Stream Deck/Companion in a studio, a tablet or phone web GUI for mobile/remote use.

## Architecture Decision
Resolved: build this as an extension of `VDO.MultiCh.Comms` rather than a separate native engine. VDO ingestion — WebRTC decode, per-line IPC — stays exactly where it already lives. What's new is a spatial render stage, a talk-back/mic layer, and a control API, all sitting on top of that existing foundation.

## Compatibility with VDO.MultiCh.Comms
This needs to stay a mode, not a replacement — "normal" `VDO.MultiCh.Comms` users shouldn't lose anything they have today. Two places in this plan are genuine breaking changes if not handled carefully, both worth calling out explicitly rather than assuming they're purely additive:

- **Output routing.** Today, each party line routes 1:1 to its own dedicated hardware output channel — that's the core of what the existing app does. The Spatial Mix Bus design replaces that with everything summing into one shared output (binaural now, discrete multichannel HDMI later). These are mutually exclusive models. **Required change:** add an explicit Output Mode setting — *Classic* (today's per-line dedicated routing, byte-for-byte unchanged) vs. *Spatial* (shared mix bus) — rather than removing the existing behavior.
- **Input/talk routing — correction from earlier framing.** This isn't actually a global mode split the way output is. Whether a channel's audio comes from a dedicated hardware input (today's existing per-line model, untouched) or from the shared operator mic gated by talk-press depends on the channel and the use case, and both can coexist in the same running app: a sound op might wire their program mix straight into a "PGM" channel as a continuous dedicated feed for everyone to monitor, while using the shared mic for ordinary back-and-forth on other channels. **Required change:** add a per-channel `inputSource` property (`dedicated` | `sharedMic`) rather than a global toggle — `dedicated` channels reuse today's existing per-line input config exactly as-is, no talk button at all since they're always live; `sharedMic` channels use the new `transmittingChannels` gating. Mobile/touchscreen users only ever have `sharedMic` channels, since a phone has exactly one mic.
- **`config.json` schema.** Gains new optional fields (an `outputMode` flag; per-line `type`, `positionMode`, `azimuth`, `volume`, `listening`). These need sensible defaults so a config saved by today's normal app still loads and behaves identically — no forced migration, no breaking change to the existing schema.
- **Settings UI.** Gains a mode toggle. The existing per-line In/Out device and channel fields stay exactly as they are today and remain the active configuration surface specifically when Classic mode is selected; Spatial-mode-specific fields (azimuth, volume, listening) only appear when that mode is active.
- **Setup flow.** Today's GUI wizard stays exactly as it is for Classic mode. Spatial mode — particularly headless deployments — gets a separate CLI installer (see Architecture §5a) rather than extending the GUI wizard to cover a case it wasn't designed for.
- **Native CoreAudio addon — not used at all by core v1.** Binaural output goes through standard Web Audio (`AudioContext.destination`), and `sharedMic` talk is plain `getUserMedia` — neither touches the custom native addon. It's only invoked for `dedicated`-type input channels and the future HDMI backend, both already working on Mac today; Classic mode continues using it exactly as before on Mac, and a Linux ALSA/PipeWire equivalent is only needed once `dedicated` channels or HDMI are actually wanted on Linux specifically, not for v1.
- **Process note:** keep Classic-mode code paths as close to upstream as practical (minimize intertwining with new Spatial-mode logic) so future fixes/improvements to "normal" `VDO.MultiCh.Comms` stay easy to pull in, whether this lives as a real git fork or a clearly separated branch.

## Use Cases
- **Personal/mobile binaural** — operator wearing headphones, no installed infrastructure. The fastest path to prove out, and the v1 render target.
- **Fixed control room / mixing booth** — the same spatial mix embedded as discrete multichannel audio into HDMI, riding the room's existing video router/matrix instead of needing its own cable run, then de-embedded downstream (often via MADI) into whatever the room's actual audio domain is — a console, a Dante network, etc. Also the natural seam for splitting channels out to other hardware later.
- **Studio talk control** — a Stream Deck driven by Bitfocus Companion, one button per channel. Press-and-hold a channel's button to talk on it, the same muscle memory as a real beltpack key panel; hold several at once to talk on multiple lines simultaneously.
- **Mixing-room touchscreen control** — a tablet or phone kept within arm's reach, controlling the *same* session that's actually doing audio I/O on a separate machine. Either Companion's own panel for a few quick buttons, or the full web UI for everything else — both are zero-additional-build options once the Control API and web UI exist.
- **Mobile beltpack replacement (other participants)** — a separate self-contained mobile web client for *other* people — crew, talent, anyone who'd otherwise wear a hardware beltpack — joining directly from their own phone, not necessarily on the same network as anyone else. Distinct audience and architecture from the touchscreen control surface above; see the dedicated section below.

## Known Limitations
- **Scaling is bound by participants, not party lines.** VDO.ninja's groups (our party lines) are just a lightweight label — no inherent cap on how many you define. The real ceiling is total participants/peers in the room: Chrome caps WebRTC connections around 128 peers, but CPU/bandwidth on the host and guests' machines becomes the practical bottleneck well before that — roughly 30 people comfortably, more or less depending on hardware and connection quality. Plan capacity around expected participant count, not party line count. PoC target is 4–5 participants; the real-world use case target is 10–12 — both comfortably inside that ~30-person ceiling, no special mitigations (`&broadcast`, disabled previews, `roombitrate=0`) needed at either size.
- **Spatial granularity is per-party-line, not per-individual-participant — for now.** If three people are talking in "Main PL," all three are heard from wherever "Main PL" is positioned; there's currently no way to place two people in the same PL on opposite sides. This is a choice in how our own capture shim works today (it sums every peer in a group into one stream before tapping it), not a VDO.ninja protocol limit — group members are actually separate peer connections under the hood. Tapping per-peer instead of per-group would unlock true per-person positioning later without any upstream change needed; not in scope for v1, but a real future option rather than a dead end.

## Goals (v1)
- Source: VDO.ninja party lines only, via the existing `VDO.MultiCh.Comms` pipeline. Analog hardware, SIP, and Dante are later phases — see Roadmap.
- Listen: a single binaural stereo mix via Web Audio `PannerNode`s, one per active line, sharing one spatial position model that's designed to support additional render backends (HDMI/discrete multichannel) without rearchitecting later.
- Talk: push-to-talk to one or more selected lines, controllable from a Stream Deck (via Companion) or a tablet/mobile web GUI, both talking to one local Control API.
- Initial hardware: a Linux host (Pi 5 or, likely better value/performance right now, an N100/N150 mini PC — see Platform Notes) or Mac mini for the binaural render; standard headphone/line-out, no AVR or HDMI multichannel requirement yet.

## Non-Goals (v1)
- Analog hardware capture, SIP, Dante/AES67 sourcing (deferred — see Roadmap).
- Actually shipping the discrete multichannel HDMI render backend (deferred — but the Render Layer must be built pluggable from day one so this doesn't require a rewrite when it's added).
- A custom/measured HRTF dataset — Chromium's built-in HRTF panner is the v1 bar.
- Elevation — azimuth only for v1; a Day 2 follow-on (see Roadmap).
- A separate Mobile Beltpack rendering client — that one's still a Day 2/roadmap item, distinct from the operator's own web UI.
- Breaking Classic mode — existing per-line dedicated input/output routing must keep working unchanged; see Compatibility with VDO.MultiCh.Comms.

## Tech Stack
- Electron (the existing `VDO.MultiCh.Comms` app) — extend rather than replace.
- **The UI is a web app, not an Electron-native window.** Radar positioning, settings, presets, Direct channel management — everything an operator interacts with — is served by the Control API as a single web app, the same pattern already used for Companion and the touchscreen surface. Electron's own window, if shown at all, just renders that same page; there's no separate native UI to build. This is what lets the actual audio host run headless.
- Web Audio API's `PannerNode` (`panningModel: 'HRTF'`) for binaural rendering — real 3D placement via Chromium's built-in HRTF convolution, no custom DSP needed for v1.
- A lightweight local Control API (HTTP/WebSocket server inside the Electron app) for talk-back and now the entire UI, consumed by the web UI, a Companion module, and the Mobile Beltpack's roster/provisioning calls — one engine, multiple consumers.
- Native audio I/O: pure v1 (VDO sources, binaural output, `sharedMic` talk) needs **no native addon at all** — VDO capture is plain WebRTC/AudioWorklet, the operator's mic is plain `getUserMedia`, and output is the browser's default stereo device. That makes v1 trivially portable to any Electron-capable host — NUC, Pi, Mac mini — with zero porting work. The existing CoreAudio addon only becomes relevant for two specific things: `dedicated`-type input channels (reusing today's per-line hardware routing) and the future discrete multichannel HDMI backend. Both already work on Mac (today's addon targets Apple Silicon); a Linux equivalent (ALSA/PipeWire) is only needed once one of those two features is actually wanted on Linux, not for v1 itself.
- **Headless deployment:** the audio engine (WebRTC capture, the `PannerNode` render, mic/talk logic) runs in a hidden renderer context with no visible window, the same pattern the existing per-line `WebContentsView`s already use — nothing new conceptually, just extended to the whole engine. On Linux specifically, headless Chromium typically still wants a virtual display (Xvfb) or offscreen-rendering flags even with no monitor attached; worth confirming the exact flags needed once this is actually built, not assuming it's automatic.

## Architecture

### 1. Source Layer (unchanged from `VDO.MultiCh.Comms`)
- Per-line VDO.ninja group, WebRTC decode, AudioWorklet capture — exactly as it works today. Capture is at the group level (everyone in a PL summed into one stream); see Known Limitations for what that does and doesn't allow.

### 2. Render Layer (pluggable, shared spatial model)
- **Binaural backend (v1):** each active line feeds its own `PannerNode` (HRTF mode) positioned by its azimuth/elevation; all connect to one `AudioContext.destination`. Output is plain stereo to whatever default device the OS provides.
- **Discrete multichannel HDMI backend (near-term follow-on, not v1):** the same per-line azimuth data drives a speaker-panning law (ITU 5.1 or VBAP) into a shared N-channel buffer, pushed to a native multichannel output device routed over HDMI. Built once the binaural path is proven; the Render Layer's interface should be designed now so this slots in without touching the spatial data model or UI.

### 3. Spatial Data Model
- Each channel (party line or Direct): id, label, type, positionMode, azimuth, elevation (Day 2, not v1 — see Roadmap), volume (gain, default unity), listening (boolean, default true — whether this channel's audio is currently included in the mix at all, independent of volume), inputSource (`dedicated` | `sharedMic` — see Talk-Back layer below).

### 4. Talk-Back / Mic Capture Layer (new)
- Per-channel `inputSource`, not a global setting:
  - **`dedicated`** — exactly today's existing per-line hardware input (its own device/channel config), continuously live, no talk button at all. Example: a sound op routes their program mix straight into a "PGM" channel as a standing feed everyone else can monitor — that's a `dedicated` channel from the sound op's side, an ordinary listenable channel for everyone else.
  - **`sharedMic`** — one shared operator mic, dynamically gated by talk-press. The same sound op uses this for ordinary back-and-forth on other channels, separate from their PGM feed. Mobile/touchscreen users only ever have `sharedMic` channels, since a phone has exactly one mic.
- Core primitive for `sharedMic` channels: `transmittingChannels` — the live set of channels currently receiving the operator's mic audio. The actual mic-routing logic is simple regardless of control surface: publish live mic frames into the VDO.ninja group for every channel currently in `transmittingChannels`, mute otherwise.
- Two control-surface mappings onto that one primitive:
  - **Studio (Stream Deck/Companion):** each channel button supports both latch and momentary PTT from the same physical button, split by press duration — short press (released before 500ms) toggles a persistent `latched` flag for that channel; holding past 500ms starts momentary PTT (`longPressActive`) for as long as it's held, independent of the latch state, reverting to whatever the latch state was on release. A channel is in `transmittingChannels` whenever `latched OR longPressActive` is true. This timing logic lives in the Control API itself, not in Companion — Companion's job is just to relay raw button-down/button-up per channel; the 500ms classification happens once, centrally, so the same logic would work unchanged for any other future studio control surface (footswitch, MIDI controller, etc.).
  - **Touchscreen control surface (tablet/phone in the mixing room):** the same per-channel short/long-press model as Studio above, driving the same `transmittingChannels` primitive — one consistent gesture across every control surface rather than a separate "arm then global PTT" pattern.

### 5. Control API (new)
- Local HTTP/WebSocket server inside the app exposing, per channel (party line or Direct): talk PTT down/up, listen enable/disable, set volume, set/adjust azimuth (and elevation later) — plus live status for whether you're transmitting, whether you're listening, and whether the channel is currently active (someone else talking on it).
- Also exposes preset operations: list saved presets, save the current layout as a named preset, recall a named preset.
- That last one needs a small new piece: a lightweight level/VAD tap per channel (reusing the level-metering approach already in `VDO.MultiCh.Comms` today) crossing a threshold to produce a simple "is this channel active right now" boolean — the actual signal a Companion light reflects.
- Consumed by a custom Bitfocus Companion module and the web UI — one API, multiple control surfaces.
- **One server, one port.** The Control API and the web UI are the same HTTP/WebSocket server — it serves the static web UI assets and exposes the API the UI calls. There's exactly one port to configure, not two.

### 5a. CLI Installer (new, Spatial-mode/headless deployments)
- A separate setup path from today's existing GUI wizard, which stays untouched for Classic mode. For Spatial mode — especially headless boxes with no monitor — setup runs via an interactive CLI installer instead.
- Assumes the box already has network connectivity (Ethernet/DHCP, or WiFi pre-configured at the OS level) before the installer runs; the installer's job is app setup, not network bootstrapping.
- Interactive prompts: Web UI port (sensible default, e.g. 8080, with basic in-use validation), and operator display name — consolidating the "set your name at first launch" step from Direct Channels into this flow rather than a separate GUI step, for Spatial mode specifically.
- Sets up a systemd service so the app auto-starts on boot and stays running — required for an unattended headless box.
- On completion, enumerates the box's network interface(s) and echoes the full access URL(s), e.g. `Web UI available at http://192.168.1.42:8080` (more than one line if multi-homed).

### 6. Control Surfaces (Companion + Touchscreen)
One action/feedback spec, expressed through Companion — including the touchscreen need for Day 1. Companion already ships its own browser-based virtual panel ("web buttons") mirroring whatever the module defines, live feedback colors included, reachable from any tablet or phone browser pointed at the Companion host. That covers "control buttons near my hands in a mixing room" with zero additional engineering once the module exists — no separate custom touchscreen page needed for Day 1.
- **Actions**, per channel (party line or Direct): Talk (PTT down/up, using the existing short/long-press latch logic), Listen on/off, Set Volume, Pan as an incremental nudge (step left/right by a fixed amount, with continuous adjustment via a rotary encoder as a nicer option on Stream Deck+), and Recall Preset (a dropdown of saved preset names, applying that preset's full layout in one step).
- **Feedbacks**, per channel: lit when the channel is currently active (someone talking on it), a distinct state for when *you* are transmitting on it, a distinct state for whether you're currently listening to it, and optionally which preset (if any) matches the currently active layout.
- **Companion module:** custom from the start, not generic HTTP actions — this surface is more than a couple of generic calls can express cleanly.
- **Day 1 touchscreen:** Companion's own web-buttons panel covers the "just a few buttons near my hands" case with zero additional engineering. For full control — including positioning — the same web UI from the UI Layer below works on any tablet or phone browser too, since it's just a web page; this resolves the earlier open question about whether the touchscreen surface needs a read-only spatial view — it gets the real one, for free, by virtue of being the same app.

### 7. UI Layer
- A web app served by the Control API — not an Electron-native window. Radar (or sphere, once elevation is added) view, listener at center, each party line draggable by position; dragging updates that line's `PannerNode` live, no apply step. Settings, presets, and Direct channel management live here too.
- Works identically whether opened in Electron's own window (if a monitor's attached locally) or from any browser elsewhere on the network — same page either way. This is what lets the audio host run fully headless.
- Also needs to surface live talk state — which lines are currently receiving mic audio — visually, not just position.
- Party lines and Direct channels need clearly distinct icon treatment, not just "draggable vs. not": e.g. PLs as a round, freely-draggable marker; Direct channels as a smaller pinned/person-style marker fixed to its slot, so a stationary PL can't be mistaken for a Direct channel at a glance. Worth treating as a starting point to refine once it's actually on screen, not a final spec.

### 8. Persistence
- Named presets, each a snapshot of every channel's azimuth, volume, and listening state (talk/PTT state isn't part of a preset — that's session-level, not layout).
- Stored locally inside the app (a JSON file alongside the existing `~/.vdo-multichan/config.json`-style local config, not synced anywhere).
- Recallable two ways: from the radar UI directly, and from Companion via a dedicated action (see Companion Module).

## Platform Notes
- **Mac mini & Linux host:** both trivially support standard stereo audio out for the v1 binaural render — no platform-specific output work needed yet. They diverge on features beyond v1, not speed: Mac mini already has the existing native CoreAudio addon, so `dedicated` channels and the future HDMI backend work there with zero new native code; Linux needs that addon's ALSA/PipeWire equivalent built before either of those two features is usable there, whenever that becomes a priority.
- **Linux target — reconsider Pi vs. an x86 mini PC.** Pi 4 is genuinely too weak for this workload (1.5GHz Cortex-A72, real risk of dropouts decoding multiple simultaneous WebRTC streams plus per-line HRTF convolution at the 10-12 participant target) — not recommended. Pi 5 is the realistic floor within the Pi family, but current pricing has eroded its advantage: 2026's DRAM shortage has pushed a fully kitted 8GB Pi 5 (board, power supply, cooling, storage) to roughly $135-195, putting it at or above N100/N150-class Celeron mini PCs (Beelink, GMKtec, Minisforum, etc.) with meaningfully more CPU headroom, NVMe storage standard, and more RAM. Two reasons to lean toward the mini PC specifically for this app: Electron/Node.js workloads have traditionally favored x86 performance-per-dollar, and HDMI multichannel audio — already this plan's single biggest hardware risk — is far more standardized on Intel's HDA driver path than on the Pi's VC4/RP1-specific HDMI quirks. The one real reason to stay in the Pi family is GPIO/physical hardware extensibility, relevant to the longer-term hardware-product ambition but not urgent now.
- **Chosen dev/PoC host: a 6th-gen i3 NUC (8GB RAM, 256GB SSD).** A decade-old dual-core/4-thread x86 chip is comfortably sufficient for v1's actual workload — audio-only Opus decode is cheap, and HRTF convolution for a handful of sources is modest DSP work well within reach. Combined with v1 needing no native addon at all (see Tech Stack), this should just run, no porting work required. A future N100/N150 box remains worth considering for a dedicated/permanent unit, but isn't necessary to get started.
- **Debian-based host, generally:** the eventual native Linux work (ALSA/PipeWire output backend, packaging) should follow standard Debian/ALSA conventions rather than Pi-specific tooling where possible, so it works on either an SBC or an x86 mini PC without rearchitecting. That said, the lowest-level HDMI/audio quirks (`config.txt` on Pi vs. standard ALSA HDA config on x86) are inherently hardware-specific — switching host types later still needs its own from-scratch verification of the HDMI path, not just a recompile.
- **Mobile, later:** keeping the Render Layer's logic platform-agnostic now (not leaning on anything Electron-specific in the `PannerNode`/`AudioContext` code) keeps the door open for the Mobile Beltpack UX, which renders its own binaural mix independently of the desktop app.

## Phased Build Plan
1. **Phase 0 — Binaural proof of concept.** Two or three static `PannerNode`s at different azimuths, confirm by ear (real headphones, both target platforms) that left/right/front/back are actually distinguishable.
2. **Phase 1 — Wire it to live VDO lines.** Add the Output Mode setting first (Classic vs. Spatial), then replace per-line dedicated output routing with the `PannerNode` render layer *only* when Spatial mode is active — Classic mode's existing routing stays untouched. Static azimuths to start.
3. **Phase 2 — Web UI.** Build the radar/positioning view as a web app served by the Control API (not an Electron-native window), draggable position UI wired to live azimuth changes on each line's `PannerNode`. Works the same whether opened locally or remotely — settings, presets, and Direct channel management land here too as they come online in later phases.
4. **Phase 3 — Talk-back core.** The per-channel `inputSource` model (`dedicated` reusing today's existing input config, `sharedMic` for the new gated model), the `transmittingChannels` primitive, and the Control API — testable via raw HTTP calls before any control surface exists.
5. **Phase 4 — Control surfaces.** The custom Companion module (Talk/Listen/Volume/Pan/Recall-Preset actions, activity/transmitting/listening feedbacks) against the Control API — Companion's own web-buttons panel covers the touchscreen need for free, no separate build required here.
6. **Phase 5 — CLI installer.** Port selection, operator name prompt, systemd service setup, network-interface enumeration to echo the access URL(s). Depends on the Control API/web UI existing (Phases 2-3), so it's naturally last.
6. **Phase 5 — Presets and polish**, including live talk-state indicators in the UI and Companion Feedbacks.
7. **Later — Roadmap items** (below): discrete multichannel HDMI/MADI backend, analog hardware input, SIP, Dante/AES67, full mobile rendering app, other hardware platforms.

## Execution Strategy: Branching, Parallel Agents & Models
**Branch, not a fork.** Work on a branch within the existing `VDO.MultiCh.Comms` repo (e.g. `spatial-intercom`) rather than a separate repo — the Compatibility design above only holds together if Spatial mode can realistically merge back as an option alongside Classic. A hard fork is worth revisiting later if this ever needs to be distributed as a fully separate project, but isn't the starting assumption.

**One sync point before splitting up:** agree the shared channel data model (id, label, type, positionMode, azimuth, volume, listening, inputSource) first — every track below builds on it, so getting it stable before parallel work starts avoids rework.

**Parallel tracks**, each independent enough to run on its own agent/branch with a defined merge point:
- **Track A — Core Listen Pipeline** (sequential within itself): Output Mode setting → binaural proof of concept → Render Layer → Web UI.
- **Track B — Core Talk Pipeline** (independent of A until final integration, since talk and listen are mostly orthogonal subsystems): the `inputSource`/`transmittingChannels` model → Control API → Companion module.
- **Track C — Presets:** light dependency on the shared data model only, otherwise standalone.
- **Track D — Mobile Beltpack:** fully independent, separate codebase entirely, can start day one alongside everything else.
- **Track E — Direct Channels:** depends on A and B reaching a stable v1, since it reuses both the render and talk primitives.
- **Track F — Roadmap items**, each independent of the others, all gated on v1 (A+B+C) shipping: HDMI/MADI backend, SIP, Dante/AES67, Elevation, dedicated touchscreen UI, analog hardware input — good candidates to fan out across several agents simultaneously once v1 is done.

**Model per piece** — defaulting to the cheapest tier the risk profile allows, reserving the most capable model for the places mistakes are genuinely hard to debug or compatibility-sensitive:
- Output Mode setting (config schema + settings toggle): mid-tier — mechanical, but touches existing config loading that must stay backward-compatible, so care matters more than raw difficulty.
- Binaural proof of concept: cheapest tier — small, disposable test, easy to verify by ear regardless of code quality.
- Render Layer (wiring `PannerNode` into the existing real-time audio/IPC pipeline): most capable tier — real-time audio thread safety is the most failure-prone area flagged repeatedly in this plan; bugs here are quiet and hard to debug.
- Web UI: cheapest tier — standard web frontend work (not Electron-specific APIs), low blast radius, easy to iterate.
- Talk-Back layer (`inputSource` branching, short/long-press classification): mid-tier — compatibility-sensitive (must not disturb existing dedicated-input behavior) plus real timing logic.
- Control API: cheapest tier — once the primitives it wraps exist, this is mostly mechanical REST/WebSocket plumbing.
- Companion module: cheapest-to-mid tier — glue code against a documented Companion SDK and our own API contract.
- Presets: cheapest tier — simple JSON read/write/recall.
- Direct Channels (provisioning, on-demand WebRTC spin-up/tear-down, signaling): most capable tier — the trickiest new subsystem in this plan, genuine connection-lifecycle/state-machine risk.
- Mobile Beltpack: mid-tier overall (fresh codebase reimplementing Render+Talk concepts independently); its simpler UI pieces could drop to the cheapest tier.
- HDMI/MADI native backend (ALSA/CoreAudio multichannel): most capable tier — low-level, hardware-specific, hard to iterate without real hardware in the loop.
- SIP and Dante/AES67 integrations: mid-tier — real protocol complexity, but well-trodden ground with mature libraries.
- Elevation, dedicated touchscreen UI (Day 2 items): cheapest tier — mechanical extensions of already-proven patterns.
- Analog hardware input: mid-tier — native audio device handling, moderate risk.

## Open Questions
- Where should the Mobile Beltpack static page actually be hosted — alongside a self-hosted VDO.ninja instance, or separately?
- Should Mobile Beltpack users also get the roster/Direct-line-request flow, or is requesting a Direct line desktop-only for now?
- ~~First-time headless setup~~ — resolved: CLI installer, see Architecture §5a.
- Break-glass access if the Control API/web UI is unreachable (crashed process, network down): proposing a small CLI companion command (e.g. `status`, runnable over SSH) that re-displays the access URL and basic health, reusing the same network-interface-enumeration logic as the installer. Flagging this as a proposal, not yet confirmed — let me know if this covers it or you want something else.

## Risks
- Control-surface-to-mic-gate latency (Stream Deck → Companion → Control API → mic gate) is a new round trip worth measuring early — PTT responsiveness matters for usability even if the absolute delay is small.
- Chromium's built-in HRTF is generic, not personalized per listener — front-back confusion is a known general limitation of any non-personalized binaural system. Fine for distinguishing simultaneous talkers, not guaranteed for every listener's localization.
- Real-time position updates (dragging) need to update `PannerNode` parameters smoothly (e.g. `setTargetAtTime`) to avoid clicks/jumps.
- Need to confirm exactly how decoded VDO audio currently reaches the renderer process in `VDO.MultiCh.Comms` (today tapped from muted media elements via IPC) — both the binaural render layer and the talk-back mic layer need to hook into that same pipeline cleanly.

## Direct Channels (User-to-User)
A Direct channel is a private 1:1 audio path between two specific operators, alongside (not instead of) party lines — e.g. a director's dedicated line to the TD, or an A2's dedicated line to the sound mixer.

- **Concept:** the channel model generalizes to `type: 'partyline' | 'direct'` and `positionMode: 'free' | 'fixed'`. A Direct channel is, under the hood, the same VDO.ninja group mechanism as a PL — just scoped to exactly two members — with a pinned position instead of a draggable one.
- **Listen/render:** identical pipeline to PLs — same capture, same `PannerNode` feeding the same `AudioContext.destination`. The only difference is the radar UI doesn't let a Direct channel be dragged, and should render it with a distinct (pinned) visual treatment so it isn't mistaken for an un-moved PL.
- **Talk:** same `transmittingChannels` primitive as PLs — a Direct channel just gets its own button on whichever control surface (Stream Deck/Companion or mobile), sharing the same button budget as party lines.
- **Identity:** each operator sets a display name at first launch (extending the existing setup wizard), editable later from a Settings page. For the actual deterministic group-name derivation, generate a separate, immutable ID behind the scenes at first launch too — the hash should be based on that hidden stable ID, not the editable display name, so renaming later doesn't orphan existing Direct-channel pairings.
- **Roster/discovery:** a browse UI showing who's currently online, fed by the same lightweight signaling/presence layer used for the request itself — pick a target from that list rather than needing to pre-know an identifier.
- **Provisioning flow:** request and acceptance travel over the signaling connection each operator's instance already maintains (no new server needed); once requested, both sides derive the same private group name deterministically from both operators' stable IDs rather than transmitting one. No explicit accept step on the receiving end — a request just establishes the line directly, the same way the "ring" itself works.
- **Connection model — on-demand, not standing.** The lightweight VDO.ninja signaling connection is what stays "always on" (it's already required for presence regardless); the actual WebRTC audio peer connection for a Direct channel only spins up when someone presses their direct-talk button: a small "ring" message goes out over signaling, both sides establish the real connection, audio starts once it's up, and after an idle-grace window post-release it tears back down — defaulting to 30 seconds, exposed as a user-configurable setting. This avoids the CPU/bandwidth cost of standing connections, which matters on Pi-class hardware — traded against a real, if small, connection-setup delay on first press (more noticeable over WAN/NAT than on a local network).

## Mobile Beltpack UX (Remote Participants)
A self-contained mobile web client replacing today's stock VDO.ninja `/comms` page — small, ambiguously-gestured tiles, a tiny "listen" eye icon, no activity feedback, no spatial positioning — with something purpose-built for whoever would otherwise be wearing a hardware beltpack: talent, crew, anyone joining from their own phone.

- **Per channel (PL or Direct) the user has access to:**
  - A clear, separate Listen toggle (on/off), independent of talk.
  - Talk using the same short/long-press model as every other surface in this plan: short press toggles latch, holding past 500ms is momentary PTT. One consistent gesture everywhere rather than a phone-specific pattern.
  - A "someone's talking on this channel" indicator — the same activity/level-detection concept as the Companion feedback.
  - Retained panning — each user drags their own channels around their own binaural mix, same `PannerNode`-per-channel model as the desktop app, rendered locally for that one phone's hearing, not the operator's.
- **Architecture — separate from the Control API, not routed through it.** This client connects directly to VDO.ninja the same way the stock comms page does today: its own WebRTC connections, its own local Web Audio graph for binaural rendering, its own local talk/activity state. It has no reason to talk to the Electron app's Control API — that API is specifically for controlling the operator's own session, a different audience entirely.
- **Audio I/O:** standard browser input/output — wired headset or Bluetooth, whatever the phone currently has selected. No native code needed; this is exactly the case Web Audio + WebRTC already handle natively on mobile browsers.
- **Delivery:** a small standalone static web app, PWA-installable for an app-like home-screen icon, no app store involved. `VDO.MultiCh.Comms` already generates a join link/QR pointing at the stock comms page for exactly this purpose — same mechanism, just retargeted at this purpose-built page instead.

## Roadmap Beyond v1
- **Direct channels (user-to-user)** — see dedicated section above; private, pinned-position lines between two specific operators, on-demand connection.
- **Discrete multichannel HDMI/MADI render backend** — the control-room/mixing-booth target described above; second renderer off the same spatial model.
- **Analog hardware input** — direct multichannel capture from a hardware audio interface, feeding the same render layer as another source type.
- **Day 2 — Elevation** — add elevation on top of azimuth in the spatial data model, render layer, and UI (a sphere/dome instead of a flat ring).
- **Day 2 — SIP** — register as a SIP extension against RTS, Clear-Com, or Riedel's SIP bridges (PJSIP/drachtio/sip.js), feeding the same render layer.
- **Later — Dante/AES67** — Dante Virtual Soundcard (or AES67) as another input device option; the highest-fidelity, most universal way to tap real intercom systems.
- **Mobile beltpack UX** — see dedicated section above; a separate self-contained client for other participants, full design already specified, build sequencing still post-v1.
- **Later — other hardware platforms** — once the Pi/Mac mini software path is proven.
