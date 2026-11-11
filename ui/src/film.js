// Film mode: when the video capture script injects window.__FILM, the UI plays a scripted scene
// (state snapshots, camera path, time of day, presenter lip-sync) on a virtual clock.
export const FILM = typeof window !== 'undefined' ? window.__FILM : undefined;

export const filmTime = () => performance.now() / 1000; // virtual clock, driven frame by frame by the capture script

const ease = (x) => x * x * (3 - 2 * x);
const lerp = (a, b, k) => a + (b - a) * k;
const lerpV = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));

// keys: [{ t, ...values }] sorted by t. Returns eased interpolation of every numeric / array field.
export function keyAt(keys, t) {
  if (!keys?.length) return null;
  if (t <= keys[0].t) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    if (t <= b.t) {
      const k = ease((t - a.t) / (b.t - a.t || 1));
      const out = { t };
      for (const f of Object.keys(b)) {
        if (f === 't') continue;
        out[f] = Array.isArray(b[f]) ? lerpV(a[f] ?? b[f], b[f], k) : typeof b[f] === 'number' ? lerp(a[f] ?? b[f], b[f], k) : b[f];
      }
      return out;
    }
  }
  return keys[keys.length - 1];
}

// Last item with item.t <= t.
export function stepAt(items, t) {
  let cur = null;
  for (const it of items || []) { if (it.t <= t) cur = it; else break; }
  return cur;
}

// Mouth opening 0..1 from the voice loudness track (one value per 1/30 s).
export function talkAt(t) {
  const a = FILM?.talk;
  if (!a?.length || t < 0) return 0;
  return a[Math.min(a.length - 1, Math.floor(t * 30))] || 0;
}
