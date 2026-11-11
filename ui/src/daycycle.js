import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { FILM, filmTime, keyAt } from './film.js';

const NIGHT_SKY = new THREE.Color('#141b33');
const DAY_SKY = new THREE.Color('#bcd9ef');
const DUSK_SKY = new THREE.Color('#f0a46e');
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Lighting for a given local hour (0-24): sky colour, sun, how "night" it is. */
export function lightingAt(h) {
  const alt = Math.sin((Math.PI * (h - 6)) / 12); // >0 between 6h and 18h
  const day = smooth(-0.12, 0.3, alt);
  const dusk = Math.exp(-(((alt - 0.04) / 0.16) ** 2)) * (alt > -0.25 ? 1 : 0);
  const sky = NIGHT_SKY.clone().lerp(DAY_SKY, day).lerp(DUSK_SKY, dusk * 0.55);
  const az = (Math.PI * (h - 6)) / 12;
  return {
    hour: h,
    day,
    night: 1 - day,
    sky,
    sunPos: [Math.cos(az) * 25, Math.max(alt, 0.15) * 25, 10],
    sunColor: new THREE.Color('#fff6e8').lerp(new THREE.Color('#ffae6b'), dusk),
    sunIntensity: 2.3 * day,
    ambient: 0.32 + 0.85 * day,
  };
}

// Film mode: FILM.hours = [{ t, h }] drives the time of day (sunset timelapse).
function useFilmHour() {
  const [h, setH] = useState(() => keyAt(FILM.hours, 0)?.h ?? 11);
  useEffect(() => {
    let raf;
    const loop = () => { const k = keyAt(FILM.hours, filmTime()); if (k) setH(Math.round(k.h * 50) / 50); raf = requestAnimationFrame(loop); };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);
  return lightingAt(h);
}

// ?hour=21 in the URL freezes the time (handy to preview the night).
export function useDayCycle() {
  if (FILM) return useFilmHour(); // eslint-disable-line react-hooks/rules-of-hooks -- FILM never changes at runtime
  const forced = Number(new URLSearchParams(location.search).get('hour'));
  const now = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; };
  const [h, setH] = useState(Number.isFinite(forced) && location.search.includes('hour=') ? forced : now());
  useEffect(() => {
    if (location.search.includes('hour=')) return;
    const t = setInterval(() => setH(now()), 60000);
    return () => clearInterval(t);
  }, []);
  return lightingAt(h);
}
