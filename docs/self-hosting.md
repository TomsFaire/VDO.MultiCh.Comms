# Self-Hosting Guide

VDO.MultiCh.Comms uses VDO.ninja for WebRTC transport. This guide explains how to host each component yourself.

**The app defaults to the public instance, `https://vdo.ninja`.** Self-hosting is optional. To use your own instance, set the VDO.ninja endpoint to a custom URL in Settings (stored as `vdo_base_url`; it travels in the session code, so every box picks it up).

## What depends on what

```
VDO.MultiCh.Comms app
        │
        ▼
VDO.ninja frontend (HTML/JS)   ← you can self-host this (optional)
        │
        ▼
Signaling server (WSS)         ← VDO.ninja hosts this by default (optional to self-host)
        │
        ▼
TURN server (Coturn)           ← VDO.ninja's public TURN by default (recommended to self-host)
```

**Minimum for most use cases:** self-host the frontend + your own TURN server. The public VDO.ninja signaling server can stay.

**Full independence (air-gapped):** self-host all three.

---

## 1. VDO.ninja frontend (static files)

The VDO.ninja UI is a static web app. Host it anywhere that serves HTTPS.

```bash
git clone https://github.com/steveseguin/vdo.ninja.git
cd vdo.ninja
# Serve with nginx, Caddy, or any static host
```

Remote guests join via `{vdo_base_url}/comms?room=<room>`. The file ships in the standard VDO.ninja repo, but your web server has to route `/comms` to it (see the nginx example).

**nginx example (`/etc/nginx/sites-available/vdo`):**
```nginx
server {
    listen 443 ssl;
    server_name live.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/live.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/live.yourdomain.com/privkey.pem;

    root /var/www/vdo.ninja;
    index index.html;

    # /comms must serve comms.html, otherwise the guest join link returns 404
    location / {
        try_files $uri $uri.html $uri/ /index.html;
    }
}
```

`$uri.html` is what makes `/comms` resolve to `comms.html`. Without it the join link 404s.

Once deployed, choose the custom instance in Settings and enter `https://live.yourdomain.com`. Until you do, the app keeps using public vdo.ninja.

---

## 2. TURN server (Coturn)

The app takes TURN settings directly (see [Network settings](#network-settings-in-the-app)), so you do not need to edit VDO.ninja's `config.js` for the app's own boxes.

Required when peers are behind symmetric NAT and can't connect peer-to-peer. A VPS with a public IP is sufficient.

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

### Point a self-hosted VDO.ninja at your TURN server (optional)

Only needed if other clients (not the app) should use it by default. In your cloned VDO.ninja repo, edit `config.js` (or `turnconfig.js` depending on version):

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

Redeploy the static files after this change.

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

VDO.ninja uses a hosted WebSocket signaling server (`wss://ws.vdo.ninja`). For most deployments you don't need to replace this. If you need full air-gapped independence:

- See the [VDO.ninja self-hosting docs](https://github.com/steveseguin/vdo.ninja/blob/master/SELF_HOSTING.md) for the signaling server setup.
- The signaling server is a small Node.js process.
- Once running, point VDO.ninja's `config.js` at your signaling WSS endpoint.

**Cloudflare Tunnel note:** the signaling source (`vdoninja-http.js`) is a plain HTTP/WS server. If it sits behind a Cloudflare Tunnel, the tunnel's service URL must be `http://`, not `https://`. With `https://` the tunnel attempts a TLS handshake to the container and fails, and `noTLSVerify` does not bypass that handshake. Cloudflare terminates TLS at the edge, so clients still connect with `wss://`.

---

## Reference deployment (self-hosted, two machines)

This is the layout currently in use: all three components on two machines (.22 and .60) behind a Cloudflare Tunnel for HA. The tunnel fails over between connectors without intervention.

| Component | URL / endpoint | Machines |
|---|---|---|
| VDO.ninja frontend | `https://vdo.yourdomain.com` | .22 (port 8900) + .60 (port 8900) |
| Signaling (WSS) | `wss://vdo-handshake.yourdomain.com` | .22 (port 8910) + .60 (port 8910) |
| TURN server | `turn:192.168.1.22:3478` / `turn:192.168.1.60:3478` | LAN only. Cloudflare Tunnel can't proxy UDP |

To use it, set the custom endpoint in Settings to `https://vdo.yourdomain.com`.

### Frontend (nginx:alpine)

Static files live at:
- SkullAi (primary): `/home/tom/stack/vdo-ninja/html/`
- docker .22 (replica): `/home/tom/docker/vdo-ninja/html/`

**Always edit on SkullAi first.** A nightly cron (3am) rsyncs html from SkullAi to .22. To propagate immediately, run `/home/tom/bin/vdo-sync.sh`.

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

Plain HTTP/WS server on port 443 inside the container. TLS is terminated by Cloudflare at the edge, so clients see `wss://vdo-handshake.yourdomain.com` (and the tunnel service URL is `http://`, see above).

Source: `/home/tom/stack/vdo-ninja/handshake/vdoninja-http.js` (SkullAi primary).

The two signaling instances don't share room state (in-memory only). WebRTC media is P2P, so a Cloudflare failover mid-session won't drop streams, but new connections briefly re-establish signaling.

Rebuild after source changes:
```bash
# SkullAi
ssh tom@192.168.1.60 "cd /home/tom/stack && docker compose build vdo-handshake && docker compose up -d vdo-handshake"
# .22
cd /home/tom/docker && docker compose build vdo-handshake && docker compose up -d vdo-handshake
```

### Coturn on both machines

Config at `/home/tom/stack/coturn/turnserver.conf` (SkullAi) and `/home/tom/docker/coturn/turnserver.conf` (.22):

```conf
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech
realm=skullai.local
user=vdoninja:vdoninja_turn_pass
```

Apply changes to both machines:
```bash
/home/tom/bin/vdo-sync.sh   # syncs conf from SkullAi to .22
docker restart coturn
ssh tom@192.168.1.60 "docker restart coturn"
```

### Keeping .22 and .60 in sync

**SkullAi (.60) is the source of truth** for all VDO.ninja files. Make changes there, then run `/home/tom/bin/vdo-sync.sh` (html, handshake source, coturn conf to .22). The script does not restart containers on SkullAi; do that manually after editing on .60.

### Adding public TURN to the reference deployment

The coturn setup above is LAN-only. For remote participants over the internet:

1. Forward UDP/TCP 3478 and UDP 49152-65535 through your router to one or both machines.
2. Update the `index.html` TURN URLs to a WAN IP or DDNS hostname.
3. Optionally update coturn `realm` to match your public domain.
4. Run `vdo-sync.sh` and restart coturn on both machines.

A VPS with a static public IP running coturn is more reliable than NAT hairpinning. The app's own TURN fields (below) are the simpler route for the app's boxes.

---

## Network settings in the app

Settings has a **Network** selector; it applies to all boxes (carried in the session code). The default is **Internet**.

| Mode | URL params | Use |
|---|---|---|
| LAN | `turn=off`, `stunonly`; ICE candidates stripped in the shim | All boxes on one network; no internet dependency |
| Internet (default) | No `turn=` param, so vdo.ninja's built-in STUN/TURN is used. With a custom TURN server: `&turn=<username>;<credential>;turn:<host>:<port>` | Boxes or guests across NATs/sites |

Custom TURN fields appear only after ticking **Use my own TURN server** in Internet mode: TURN host, port, username, credential. These match the Coturn user in section 2 (`user=commspipe:...`). Use the TLS listener (`turns:` on 5349, or 443 if your network blocks other ports) when behind corporate firewalls. The `turn=` URL format and `turns:` support should be confirmed against current vdo.ninja docs.

TURN credentials are embedded in the join link and QR shown to guests; see [security.md](security.md). Prefer a dedicated low-privilege TURN user.

---

## Quick-start checklist

- [ ] Clone `steveseguin/vdo.ninja`, deploy to HTTPS host
- [ ] Choose the custom VDO.ninja endpoint in VDO.MultiCh.Comms Settings and enter your domain (the app defaults to public vdo.ninja)
- [ ] (Optional) Install Coturn, configure realm + credentials
- [ ] Tick **Use my own TURN server** and enter host/port/username/credential in Settings on every box (or set it once and share the session code)
- [ ] (Optional) Edit VDO.ninja `config.js` to use your TURN server for other clients
- [ ] Verify by launching the app, joining from a remote device, and confirming audio flows
