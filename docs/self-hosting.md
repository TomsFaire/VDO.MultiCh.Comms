# Self-Hosting Guide

VDO.MultiCh.Comms uses VDO.ninja for WebRTC transport. This guide explains how to host each component yourself.

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

Once deployed, set `vdo_base_url` in your config (or via the Settings UI) to `https://live.yourdomain.com`.

---

## 2. TURN server (Coturn)

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

---

## Quick-start checklist

- [ ] Clone `steveseguin/vdo.ninja`, deploy to HTTPS host
- [ ] Set `vdo_base_url` in VDO.MultiCh.Comms settings to your domain
- [ ] (Optional) Install Coturn, configure realm + credentials
- [ ] (Optional) Edit VDO.ninja `config.js` to use your TURN server
- [ ] Verify with the **Test connection** button in the app Settings panel
