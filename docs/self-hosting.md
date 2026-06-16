# Self-Hosting Guide

VDO.MultiCh.Comms uses VDO.ninja for WebRTC transport. This guide explains how to host each component yourself and how that interacts with the app's **single Comms room + groups** model.

## What depends on what

```
VDO.MultiCh.Comms app (macOS Electron)
        │
        ▼
VDO.ninja frontend (HTML/JS)   ← self-hosted at vdo.yourdomain.com
        │
        ▼
Signaling server (WSS)         ← self-hosted at vdo-handshake.yourdomain.com
        │
        ▼
TURN server (Coturn)           ← self-hosted on .22 and .60 (LAN, port 3478)
```

## Active deployment

All three components are self-hosted on two machines (.22 and .60) behind a Cloudflare Tunnel for HA. The tunnel auto-fails-over between connectors — no manual intervention needed if one machine goes down.

| Component | URL / endpoint | Machines |
|---|---|---|
| VDO.ninja frontend | `https://vdo.yourdomain.com` | .22 (port 8900) + .60 (port 8900) |
| Signaling (WSS) | `wss://vdo-handshake.yourdomain.com` | .22 (port 8910) + .60 (port 8910) |
| TURN server | `turn:192.168.1.22:3478` / `turn:192.168.1.60:3478` | LAN only — Cloudflare Tunnel can't proxy UDP |

**App config (Settings → VDO.ninja URL):** `https://vdo.yourdomain.com`

---

## How the app uses VDO.ninja

All lines share one **comms room** (`comms_room` in config). Routing is by **group**, not separate room URLs:

| Client | URL pattern |
|--------|-------------|
| Mobile Comms UI | `{vdo_base_url}/comms?room=<comms_room>&groups=<g1>,<g2>,…&groupmode=1` |
| Desktop line (push) | `{vdo_base_url}/?room=<comms_room>&push=<comms_room>_<group>&group=<group>&groupmode=1&…` |
| Director | `{vdo_base_url}/?director=<comms_room>&groups=<all>&groupmode=1&…` |

Optional `comms_password` adds `password=` to all generated URLs.

---

## LAN mode vs TURN

By default the app is tuned for **same-LAN** operation:

- Join URLs include `turn=off` and `stunonly`
- Hidden line views patch `RTCPeerConnection` to clear `iceServers` when `webrtc_lan_mode` is true (default in `config.json`)

This avoids Electron DNS failures against public STUN/TURN hostnames and keeps signaling simple on a trusted network.

**When you need cross-NAT (e.g. remote talent on internet)**, update `~/.vdo-multichan/config.json`:

```json
{
  "webrtc_lan_mode": false,
  "webrtc_turn_off": false,
  "webrtc_stun_only": false
}
```

The TURN servers configured in `index.html` (`192.168.1.22:3478` and `192.168.1.60:3478`) work for devices on the same LAN. For internet TURN, see [Adding public TURN](#adding-public-turn) below.

---

## Infrastructure layout

### VDO.ninja frontend (nginx:alpine)

Static files live at:
- SkullAi (primary): `/home/tom/stack/vdo-ninja/html/`
- docker .22 (replica): `/home/tom/docker/vdo-ninja/html/`

**Always edit on SkullAi first.** A nightly cron (3am) rsyncs html from SkullAi → .22 automatically. To propagate immediately, run:

```bash
/home/tom/bin/vdo-sync.sh
```

Key config in `html/index.html`:
```js
session.wss = "wss://vdo-handshake.yourdomain.com:443";
session.customWSS = true;
// TURN servers (LAN only):
turn.username = "vdoninja";
turn.credential = "vdoninja_turn_pass";
turn.urls = ["turn:192.168.1.22:3478", "turn:192.168.1.60:3478"];
```

### Signaling server (vdo-handshake)

Plain HTTP/WS server on port 443 inside the container. TLS is terminated by Cloudflare at the edge — clients see `wss://vdo-handshake.yourdomain.com`.

Source: `/home/tom/stack/vdo-ninja/handshake/vdoninja-http.js` (SkullAi primary)

**Note:** The two signaling instances don't share room state (in-memory only). WebRTC media is P2P so a Cloudflare failover mid-session won't drop streams, but signaling for new connections will briefly re-establish.

To rebuild after source changes:
```bash
# SkullAi
ssh tom@192.168.1.60 "cd /home/tom/stack && docker compose build vdo-handshake && docker compose up -d vdo-handshake"
# .22
cd /home/tom/docker && docker compose build vdo-handshake && docker compose up -d vdo-handshake
```

### TURN server (Coturn)

Running on host network on both machines. Config at:
- SkullAi: `/home/tom/stack/coturn/turnserver.conf`
- docker .22: `/home/tom/docker/coturn/turnserver.conf`

```conf
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech
realm=skullai.local
user=vdoninja:vdoninja_turn_pass
```

To apply coturn config changes to both machines:
```bash
/home/tom/bin/vdo-sync.sh   # syncs conf from SkullAi → .22
docker restart coturn
ssh tom@192.168.1.60 "docker restart coturn"
```

---

## Keeping .22 and .60 in sync

**Rule:** SkullAi (.60) is the source of truth for all VDO.ninja files. Make changes there, then sync.

```bash
# Sync html + handshake source + coturn conf → .22, then restart containers
/home/tom/bin/vdo-sync.sh
```

The script does NOT restart containers on SkullAi — do that manually after editing on .60.

---

## Adding public TURN

The current coturn setup is LAN-only. For remote participants over the internet:

1. Forward UDP/TCP 3478 and UDP 49152–65535 through your router to one or both machines.
2. Update `index.html` TURN URLs to use your WAN IP or a DDNS hostname instead of `192.168.1.x`.
3. Optionally update coturn `realm` to match your public domain.
4. Run `vdo-sync.sh` and restart coturn on both machines.

For fully public deployments, a VPS with a static public IP running coturn is more reliable than NAT hairpinning.

---

## Quick-start checklist (existing deployment)

- [x] VDO.ninja frontend deployed at `https://vdo.yourdomain.com`
- [x] Signaling at `wss://vdo-handshake.yourdomain.com:443`
- [x] coturn on both .22 and .60 (LAN TURN)
- [x] HA via Cloudflare Tunnel (both machines running connectors)
- [ ] Set app VDO.ninja URL to `https://vdo.yourdomain.com` in Settings
- [ ] (Cross-NAT) Set `webrtc_lan_mode: false` in `~/.vdo-multichan/config.json` and configure public TURN
- [ ] (Optional) Set `comms_password` for room access control
