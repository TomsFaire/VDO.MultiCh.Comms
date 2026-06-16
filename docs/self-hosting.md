# Self-Hosting Guide

VDO.MultiCh.Comms uses VDO.ninja for WebRTC transport. This guide explains how to host each component yourself and how that interacts with the app’s **single Comms room + groups** model.

## What depends on what

```
VDO.MultiCh.Comms app (macOS Electron)
        │
        ▼
VDO.ninja frontend (HTML/JS)   ← optional self-host (HTTPS)
        │
        ▼
Signaling server (WSS)         ← VDO.ninja hosts by default (optional to self-host)
        │
        ▼
TURN server (Coturn)           ← required for cross-NAT; LAN shows often skip this
```

**Minimum for most LAN shows:** use the public VDO.ninja frontend at `https://vdo.ninja` with default **LAN mode** in the app (no self-hosting required).

**Self-hosted frontend:** host the static VDO.ninja files on your own HTTPS domain and set `vdo_base_url` in app settings.

**Cross-NAT / internet:** self-host Coturn, point your VDO.ninja `config.js` at it, and disable LAN mode in the app config (see [LAN vs TURN](#lan-mode-vs-turn) below).

---

## How the app uses VDO.ninja

All lines share one **comms room** (`comms_room` in config). Routing is by **group**, not separate room URLs:

| Client | URL pattern |
|--------|-------------|
| Mobile Comms UI | `{vdo_base_url}/comms?room=<comms_room>&groups=<g1>,<g2>,…&groupmode=1` |
| Desktop line (push) | `{vdo_base_url}/?room=<comms_room>&push=<comms_room>_<group>&group=<group>&groupmode=1&…` |
| Director | `{vdo_base_url}/?director=<comms_room>&groups=<all>&groupmode=1&…` |

Optional `comms_password` adds `password=` to all generated URLs.

Your self-hosted VDO.ninja instance **must** include the `/comms` page (standard in the upstream repo). The app warns in the UI if the join URL is not a `/comms?` link.

---

## LAN mode vs TURN

By default the app is tuned for **same-LAN** operation:

- Join URLs include `turn=off` and `stunonly`
- Hidden line views patch `RTCPeerConnection` to clear `iceServers` when `webrtc_lan_mode` is true (default in `config.json`)

That avoids Electron DNS failures against public STUN/TURN hostnames and keeps signaling simple on a trusted network.

**When you self-host TURN for cross-NAT**, also update `~/.vdo-multichan/config.json`:

```json
{
  "webrtc_lan_mode": false,
  "webrtc_turn_off": false,
  "webrtc_stun_only": false
}
```

Then configure your VDO.ninja frontend’s TURN credentials (below). Restart connected lines after changing WebRTC settings.

---

## 1. VDO.ninja frontend (static files)

The VDO.ninja UI is a static web app. Host it anywhere that serves HTTPS.

```bash
git clone https://github.com/steveseguin/vdo.ninja.git
cd vdo.ninja
# Deploy to nginx, Caddy, or any static host
```

Remote mobile users join via `{vdo_base_url}/comms` with `room` and `groups` query params — the app generates these automatically once you set your base URL.

**nginx example (`/etc/nginx/sites-available/vdo`):**

```nginx
server {
    listen 443 ssl;
    server_name live.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/live.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/live.yourdomain.com/privkey.pem;

    root /var/www/vdo.ninja;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Once deployed:

1. Open **Settings** in VDO.MultiCh.Comms
2. Set VDO.ninja preset to **Custom** and enter `https://live.yourdomain.com`
3. Click **Test connection** to verify HTTPS reachability
4. Save — Comms bar and QR codes will use the new base URL

---

## 2. TURN server (Coturn)

Required when peers are behind symmetric NAT and can’t connect peer-to-peer. A VPS with a public IP is sufficient.

### Install

```bash
# Ubuntu/Debian
apt install coturn

# Enable the service
systemctl enable coturn
```

### Configure `/etc/turnserver.conf`

```conf
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech
realm=turn.yourdomain.com
server-name=turn.yourdomain.com
user=commspipe:CHANGEME_STRONG_PASSWORD
cert=/etc/letsencrypt/live/turn.yourdomain.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.yourdomain.com/privkey.pem
log-file=/var/log/coturn/turnserver.log
```

```bash
systemctl restart coturn
```

Open firewall ports: TCP/UDP 3478, TCP/UDP 5349, UDP 49152–65535.

### Point VDO.ninja at your TURN server

In your cloned VDO.ninja repo, edit `config.js` (or `turnconfig.js` depending on version):

```js
// config.js
var turnservers = [
  {
    urls: "turns:turn.yourdomain.com:5349",
    username: "commspipe",
    credential: "CHANGEME_STRONG_PASSWORD"
  }
];
```

Redeploy the static files after this change. Disable LAN mode in the app config (see [LAN mode vs TURN](#lan-mode-vs-turn)).

### systemd unit (if not installed via apt)

```ini
[Unit]
Description=Coturn TURN server
After=network.target

[Service]
ExecStart=/usr/bin/turnserver -c /etc/turnserver.conf
Restart=always

[Install]
WantedBy=multi-user.target
```

---

## 3. Signaling server (advanced / air-gapped only)

VDO.ninja uses a hosted WebSocket signaling server (`wss://ws.vdo.ninja`). For most deployments you don’t need to replace this. If you need full air-gapped independence:

- See the [VDO.ninja self-hosting docs](https://github.com/steveseguin/vdo.ninja/blob/master/SELF_HOSTING.md) for the signaling server setup.
- The signaling server is a small Node.js process.
- Once running, point VDO.ninja’s `config.js` at your signaling WSS endpoint.

---

## Quick-start checklist

- [ ] Clone `steveseguin/vdo.ninja`, deploy to HTTPS host (include `/comms`)
- [ ] Set custom `vdo_base_url` in VDO.MultiCh.Comms Settings
- [ ] **Test connection** in Settings confirms HTTPS reachability
- [ ] (LAN only) leave default `webrtc_lan_mode: true` — no TURN required
- [ ] (Cross-NAT) Install Coturn, edit VDO.ninja `config.js`, set `webrtc_lan_mode: false` in app config
- [ ] (Optional) Set `comms_password` in Settings or `config.json` for room access control
- [ ] Export session code from Settings so other machines can import the same `comms_room` + groups
