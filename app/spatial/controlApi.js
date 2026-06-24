'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const UI_PATH = path.join(__dirname, '..', 'ui', 'index.html');

function injectPort(html, port) {
  return html.replace('</head>', `<script>window.SPATIAL_PORT = ${port};</script>\n</head>`);
}

function start(cfg, getSpatialState, onUpdate) {
  const port = cfg.controlApiPort || 8080;

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      let html;
      try {
        html = fs.readFileSync(UI_PATH, 'utf8');
      } catch (_) {
        html = `<!DOCTYPE html><html><head><title>Spatial Control</title></head><body><p>UI not yet available.</p></body></html>`;
      }
      const body = injectPort(html, port);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });

  const wss = new WebSocketServer({ server });

  function broadcast(state) {
    const msg = JSON.stringify({ type: 'state', lines: state });
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) {
        client.send(msg);
      }
    }
  }

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'state', lines: getSpatialState() }));

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (_) { return; }
      if (msg.type !== 'update' || msg.id == null) return;
      const update = {};
      if (msg.azimuth  !== undefined) update.azimuth  = msg.azimuth;
      if (msg.volume   !== undefined) update.volume   = msg.volume;
      if (msg.listening !== undefined) update.listening = msg.listening;
      if (!Object.keys(update).length) return;
      onUpdate(msg.id, update);
      broadcast(getSpatialState());
    });
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[control-api] Web UI at http://localhost:${port}`);
  });

  return {
    port,
    broadcastState(state) { broadcast(state); },
    close() { wss.close(); server.close(); },
  };
}

module.exports = { start };
