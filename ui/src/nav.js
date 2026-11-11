// Grid path-finding so mascots walk through doors and around furniture instead of through glass.
import { WALLS, WALKABLE, obstacles } from './layout.js';

const CELL = 0.25;
const RADIUS = 0.28; // mascot half-width
const X0 = -11.5, Z0 = -8.5, X1 = 13, Z1 = 8.5;
const NX = Math.ceil((X1 - X0) / CELL), NZ = Math.ceil((Z1 - Z0) / CELL);

let grid = null;

function wallPieces() {
  const out = [];
  for (const w of WALLS) {
    const [x1, z1] = w.from, [x2, z2] = w.to;
    const len = Math.hypot(x2 - x1, z2 - z1);
    const at = (d) => [x1 + ((x2 - x1) * d) / len, z1 + ((z2 - z1) * d) / len];
    if (w.gap) { out.push([w.from, at(w.gap[0])], [at(w.gap[1]), w.to]); } else out.push([w.from, w.to]);
  }
  return out;
}

function segDist([px, pz], [ax, az], [bx, bz]) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}

export function buildGrid() {
  const g = new Uint8Array(NX * NZ); // 1 = blocked
  const pieces = wallPieces();
  const obs = obstacles();
  const m = RADIUS * 0.6;
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const p = center(i, j);
      const inside = WALKABLE.some(([a, b, c, d]) => p[0] > a + RADIUS && p[0] < c - RADIUS && p[1] > b + RADIUS && p[1] < d - RADIUS * 0.5);
      const nearWall = pieces.some(([a, b]) => segDist(p, a, b) < RADIUS);
      const inObstacle = obs.some(([a, b, c, d]) => p[0] > a - m && p[0] < c + m && p[1] > b - m && p[1] < d + m);
      g[j * NX + i] = inside && !nearWall && !inObstacle ? 0 : 1;
    }
  }
  return g;
}

const center = (i, j) => [X0 + (i + 0.5) * CELL, Z0 + (j + 0.5) * CELL];
const cellOf = ([x, z]) => [Math.min(NX - 1, Math.max(0, Math.floor((x - X0) / CELL))), Math.min(NZ - 1, Math.max(0, Math.floor((z - Z0) / CELL)))];
const free = (i, j) => i >= 0 && j >= 0 && i < NX && j < NZ && grid[j * NX + i] === 0;

function nearestFree([i0, j0]) {
  if (free(i0, j0)) return [i0, j0];
  for (let r = 1; r < 40; r++) {
    let best = null, bd = Infinity;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r || !free(i0 + di, j0 + dj)) continue;
      const d = di * di + dj * dj;
      if (d < bd) { bd = d; best = [i0 + di, j0 + dj]; }
    }
    if (best) return best;
  }
  return null;
}

// Straight line stays on free cells (sampled every half cell).
function lineFree(a, b) {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL / 2));
  for (let k = 0; k <= n; k++) {
    const [i, j] = cellOf([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    if (!free(i, j)) return false;
  }
  return true;
}

/** Waypoints [x, z] from `from` to `to`, ending exactly at `to`. */
export function findPath(from, to) {
  grid ||= buildGrid();
  const s = nearestFree(cellOf(from)), g = nearestFree(cellOf(to));
  if (!s || !g) return [to];
  const key = (i, j) => j * NX + i;
  const goal = key(...g);
  const gScore = new Float32Array(NX * NZ).fill(Infinity);
  const came = new Int32Array(NX * NZ).fill(-1);
  const closed = new Uint8Array(NX * NZ);
  const h = (i, j) => { const dx = Math.abs(i - g[0]), dz = Math.abs(j - g[1]); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  const open = [[h(...s), key(...s)]]; // shortcut: array "heap" (sorted insert); fine for a ~7k-cell grid
  gScore[key(...s)] = 0;
  while (open.length) {
    const [, cur] = open.shift();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const ci = cur % NX, cj = (cur - ci) / NX;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj;
      if (!free(ni, nj) || (di && dj && (!free(ci + di, cj) || !free(ci, cj + dj)))) continue; // no corner cutting
      const nk = key(ni, nj);
      const cost = gScore[cur] + (di && dj ? 1.414 : 1);
      if (cost >= gScore[nk]) continue;
      gScore[nk] = cost;
      came[nk] = cur;
      const f = cost + h(ni, nj);
      let lo = 0, hi = open.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (open[mid][0] < f) lo = mid + 1; else hi = mid; }
      open.splice(lo, 0, [f, nk]);
    }
  }
  if (came[goal] === -1 && goal !== key(...s)) return [to]; // unreachable: go straight (should not happen)
  const cells = [];
  for (let k = goal; k !== -1; k = came[k]) cells.push(center(k % NX, Math.floor(k / NX)));
  cells.reverse();
  // String-pulling: keep only the turns.
  const out = [cells[0]];
  let anchor = cells[0];
  for (let k = 1; k < cells.length; k++) {
    if (!lineFree(anchor, cells[k])) { anchor = cells[k - 1]; out.push(anchor); }
  }
  out.push(cells[cells.length - 1], to);
  return out;
}

export { wallPieces };
