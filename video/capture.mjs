// Renders each shot frame by frame (virtual clock) with headless Chromium, to video/frames/<shot>/0001.jpg…
// Usage: node video/capture.mjs [shotId ...] [--frames N]   (needs `npm run build` first)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { START, snapshots } from './shots.mjs';
// --shots other.mjs: capture another shot list (e.g. close-ups to inspect a scene)
const SHOTS_FILE = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const { SHOTS } = await import(SHOTS_FILE ? pathToFileURL(path.resolve(SHOTS_FILE)).href : './shots.mjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', 'ui', 'dist');
const FPS = 30;
const args = process.argv.slice(2);
const only = args.filter((a, i) => !a.startsWith('--') && !/^\d+$/.test(a) && args[i - 1] !== '--shots');
const maxFrames = args.includes('--frames') ? Number(args[args.indexOf('--frames') + 1]) : Infinity;
const timing = fs.existsSync(path.join(here, 'out', 'timing.json')) ? JSON.parse(fs.readFileSync(path.join(here, 'out', 'timing.json'), 'utf8')) : {};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  const p = path.join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname === '/' ? '/index.html' : new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(dist) || !fs.existsSync(p)) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0, '127.0.0.1');
const port = await new Promise((r) => server.on('listening', () => r(server.address().port)));

// Virtual clock: performance.now / Date.now / requestAnimationFrame advance only when we say so.
function clockScript({ film, start }) {
  window.__FILM = film;
  let vt = 0;
  performance.now = () => vt;
  Date.now = () => start + vt;
  let queue = [];
  window.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
  window.cancelAnimationFrame = () => {};
  window.__step = (ms) => { vt += ms; const q = queue; queue = []; q.forEach((cb) => cb(vt)); };
}

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
for (const shot of SHOTS) {
  if (shot.card || (only.length && !only.includes(shot.id))) continue;
  const dur = timing[shot.id]?.dur ?? 4;
  const frames = Math.min(maxFrames, Math.round(dur * FPS));
  const film = { snapshots: snapshots(shot.events), camera: shot.camera, hours: shot.hours, selected: shot.selected || [],
    presenter: shot.presenter, shift: shot.shift || 0, talk: timing[shot.id]?.talk || [] };
  const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.error(`[${shot.id}] page error:`, e.message));
  await page.addInitScript(clockScript, { film, start: START });
  await page.goto(`http://127.0.0.1:${port}/`);
  // Warm-up: let models load and the scene settle without advancing virtual time.
  await page.waitForFunction(() => document.querySelector('canvas'), null, { timeout: 30000 });
  for (let i = 0; i < 40; i++) { await page.evaluate(() => window.__step(0)); await page.waitForTimeout(75); }
  const out = path.join(here, 'frames', shot.id);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) {
    await page.evaluate((ms) => window.__step(ms), 1000 / FPS);
    await page.screenshot({ path: path.join(out, String(f + 1).padStart(4, '0') + '.jpg'), type: 'jpeg', quality: 93 });
  }
  console.log(`${shot.id}: ${frames} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.close();
}
await browser.close();
server.close();
