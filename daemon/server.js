// @ts-check
'use strict';
// Local daemon: tails events.jsonl, keeps session state, pushes it to the UI over SSE.
// Listens on 127.0.0.1 only; every request needs the install token (cookie set via /auth?t=TOKEN).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createState, apply, prune } = require('./state.js');
const { redact } = require('../collector/hook.js');
const { officeDir } = require('../scripts/settings.js');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const TAIL_BYTES = 2 * 1024 * 1024; // on start, replay only the end of a big log

function start({ port = Number(process.env.CLAUDE_OFFICE_PORT) || 7431, dir = officeDir(), uiDir = path.join(__dirname, '..', 'ui', 'dist') } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const tokenFile = path.join(dir, 'token');
  if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  const file = path.join(dir, 'events.jsonl');

  const state = createState();
  const clients = new Set();
  let offset = 0;
  let partial = '';

  const ingest = (text) => {
    const lines = (partial + text).split('\n');
    partial = lines.pop() || '';
    for (const l of lines) {
      if (!l.trim()) continue;
      try {
        const e = JSON.parse(l);
        if (e.detail) e.detail = redact(e.detail); // defense in depth: the hook already redacts
        apply(state, e);
      } catch {}
    }
  };

  const readNew = () => {
    let size;
    try { size = fs.statSync(file).size; } catch { return false; }
    if (size < offset) { offset = 0; partial = ''; } // file truncated or rotated
    if (size === offset) return false;
    const start = offset === 0 && size > TAIL_BYTES ? size - TAIL_BYTES : offset;
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    offset = size;
    let text = buf.toString('utf8');
    if (start !== 0 && start === size - TAIL_BYTES) text = text.slice(text.indexOf('\n') + 1); // drop the cut first line
    ingest(text);
    return true;
  };

  const snapshot = () => JSON.stringify({ now: new Date().toISOString(), sessions: Object.values(prune(state).sessions) });
  const broadcast = () => { const data = `data: ${snapshot()}\n\n`; for (const res of clients) res.write(data); };

  readNew();
  setInterval(() => { if (readNew()) broadcast(); }, 250).unref();
  setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 15000).unref();

  const cookieToken = (req) => (/(?:^|;\s*)c3o=([a-f0-9]+)/.exec(req.headers.cookie || '') || [])[1];
  const same = (a, b) => !!a && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

  const server = http.createServer((req, res) => {
    // Block DNS rebinding: only accept loopback Host headers.
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) { res.writeHead(403).end(); return; }
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/auth') {
      if (!same(url.searchParams.get('t') || '', token)) { res.writeHead(403).end('Jeton invalide'); return; }
      res.writeHead(302, { 'Set-Cookie': `c3o=${token}; HttpOnly; SameSite=Strict; Path=/`, Location: '/' }).end();
      return;
    }
    if (!same(cookieToken(req) || '', token)) {
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Ouvre le bureau avec : npx claude-3d-office');
      return;
    }
    if (url.pathname === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${snapshot()}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === '/api/state') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(snapshot()); return; }
    // Static UI
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const target = path.join(uiDir, rel);
    if (!target.startsWith(uiDir + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream' });
    fs.createReadStream(target).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const p = /** @type {import('net').AddressInfo} */ (server.address()).port;
      resolve({ server, port: p, token, url: `http://127.0.0.1:${p}/auth?t=${token}` });
    });
  });
}

module.exports = { start };
