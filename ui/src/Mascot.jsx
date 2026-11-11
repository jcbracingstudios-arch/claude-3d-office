import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useModel } from './models.jsx';
import { findPath } from './nav.js';
import { filmTime, talkAt } from './film.js';

const SPEED = 2.6; // m/s
const tmp = new THREE.Vector3();
const CHAT = ['💬', '😄', '💡', '☕', '🤔', '👍', '😂', '🐛', '🚀', '✨', '🍕', '📈'];
const SOLO = { bar: '☕', coffee: '☕', sofa: '😌', cafe: '🍪', terrace: '🌞', rail: '🌳', books: '📖' };
const hash = (n) => { const x = Math.sin(n) * 10000; return x - Math.floor(x); };

/** What the bubble shows now, and which gesture goes with it. Time-based so a pair stays in sync. */
function chatter(social, idNum, nowMs) {
  if (!social) return { text: '', gesture: null };
  if (social.cheer === 'self') return { text: '🙌', gesture: 'cheer' };
  if (social.cheer === 'clap') return { text: '👏', gesture: 'clap' };
  if (social.partner) {
    const slot = Math.floor(nowMs / 3500);
    const speaking = (slot % 2 === 0) === social.first;
    // short pauses between lines feel more natural than a nonstop bubble
    if (!speaking || nowMs % 3500 > 2800) return { text: '', gesture: speaking ? null : 'nod' };
    return { text: CHAT[Math.floor(hash(slot * 7.1 + idNum) * CHAT.length)], gesture: 'talk' };
  }
  const t = (nowMs + idNum * 997) % 14000;
  return { text: t < 3000 ? SOLO[social.kind] || '💭' : '', gesture: null };
}

const fmtClock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600); const mm = String(Math.floor(s / 60) % 60).padStart(2, '0'); const ss = String(s % 60).padStart(2, '0'); return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`; };

export default function Mascot({ id, target, mood, social, label, boss, selected, spawn, since, scale = 1, onClick }) {
  const bubble = useRef();
  const timer = useRef();
  const mouth = useRef();
  const { obj, parts } = useModel('mascot');
  const legs = useMemo(() => Object.entries(parts).filter(([n]) => /^Leg\d/.test(n)).flatMap(([, m]) => m), [parts]);
  const root = useRef();
  const body = useRef();
  const phase = useMemo(() => [...id].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 100, [id]);
  const start = useMemo(() => spawn || target.pos, []); // eslint-disable-line react-hooks/exhaustive-deps
  const sitY = target.sitY ?? 0.3;
  const path = useRef([]);
  const [tx, , tz] = target.pos;

  // New destination: plan a route through doors and around furniture.
  useEffect(() => {
    const g = root.current;
    path.current = g ? findPath([g.position.x, g.position.z], [tx, tz]) : [[tx, tz]];
  }, [tx, tz]);

  useFrame(({ clock }, dt) => {
    const g = root.current;
    if (!g) return;
    const t = clock.elapsedTime + phase;
    let walking = false;
    let budget = SPEED * Math.min(dt, 0.05);
    while (path.current.length && budget > 0) {
      const [wx, wz] = path.current[0];
      tmp.set(wx - g.position.x, 0, wz - g.position.z);
      const dist = tmp.length();
      if (dist < 0.02) { path.current.shift(); continue; }
      walking = true;
      const step = Math.min(dist, budget);
      g.position.addScaledVector(tmp.normalize(), step);
      budget -= step;
      turnTo(g, Math.atan2(tmp.x, tmp.z), dt * 10);
    }
    const p = !walking && mood === 'idle' && social?.partner;
    let face = target.rot;
    if (p) {
      face = Math.atan2(p[0] - g.position.x, p[1] - g.position.z);
      // Seated (stool, sofa): only turn the head-and-shoulders a little, or the body sinks into the counter.
      if (target.pose === 'sit') {
        const d = Math.atan2(Math.sin(face - target.rot), Math.cos(face - target.rot));
        face = target.rot + Math.max(-0.35, Math.min(0.35, d));
      }
    }
    if (!walking) turnTo(g, face, dt * 6);
    const chat = walking || mood !== 'idle' ? { text: '', gesture: null } : chatter(social, phase, Date.now());
    if (bubble.current && bubble.current.textContent !== chat.text) bubble.current.textContent = chat.text;
    // Usage limit: stopwatch since the limit was hit (Claude Code does not tell hooks when it resets).
    const tt = mood === 'limited' && since ? `⏳ ${fmtClock(Date.now() - Date.parse(since))}` : '';
    if (timer.current && timer.current.textContent !== tt) timer.current.textContent = tt;

    const sit = !walking && target.pose === 'sit';
    let y = sit ? sitY / scale : 0;
    let armL = 0, armR = 0, legSwing = 0, spin = 0, tilt = 0;
    body.current.rotation.x = 0;
    if (walking) {
      legSwing = Math.sin(t * 14) * 0.6;
      armL = Math.sin(t * 14) * 0.5; armR = -armL;
      y += Math.abs(Math.sin(t * 14)) * 0.05;
    } else if (mood === 'working') {
      armL = -1.1 + Math.sin(t * 22) * 0.18; // typing
      armR = -1.1 + Math.sin(t * 22 + 1.7) * 0.18;
      y += Math.abs(Math.sin(t * 11)) * 0.015;
    } else if (mood === 'present') {
      // Video presenter: talks to the camera, mouth and hands follow the voice.
      const ft = filmTime();
      const talk = talkAt(ft);
      if (mouth.current) mouth.current.scale.y = 1 + talk * 4;
      if (ft < 1.4) {
        armR = -2.5 + Math.sin(ft * 14) * 0.35; // hello wave
      } else {
        armR = -0.7 - talk * 0.9 + Math.sin(t * 2.3) * 0.2;
        armL = -0.5 - talk * 0.6 + Math.sin(t * 1.7 + 1) * 0.2;
      }
      y += 0.12 + talk * 0.03; // sits up straight for the camera
      tilt = Math.sin(t * 1.1) * 0.05;
    } else if (mood === 'celebrate') {
      y += Math.abs(Math.sin(t * 7)) * 0.45;
      armL = armR = -2.6;
      spin = t * 5;
    } else if (mood === 'waiting') {
      armR = -2.4 + Math.sin(t * 6) * 0.3; // raises a hand
    } else if (mood === 'limited' && !walking) {
      // Waiting for the servers: taps a rack now and then, otherwise arms crossed and foot tapping.
      const cycle = t % 6;
      if (cycle < 1.2) armR = -1.5 + Math.abs(Math.sin(t * 9)) * 0.35;
      else { armL = armR = -0.9; y += Math.abs(Math.sin(t * 5)) * 0.015; }
      tilt = Math.sin(t * 0.8) * 0.08;
    } else if (mood === 'error') {
      tilt = Math.sin(t * 30) * 0.05;
    } else if (chat.gesture === 'cheer') {
      armL = armR = -2.7 + Math.sin(t * 9) * 0.25;
      y += Math.abs(Math.sin(t * 6)) * 0.12;
    } else if (chat.gesture === 'clap') {
      armL = armR = -1.5 + Math.abs(Math.sin(t * 12)) * 0.5;
    } else if (chat.gesture === 'talk') {
      armR = -0.9 + Math.sin(t * 7) * 0.45; // hand-waving while speaking
      tilt = Math.sin(t * 3) * 0.06;
      y += Math.abs(Math.sin(t * 9)) * 0.01;
    } else if (chat.gesture === 'nod') {
      body.current.rotation.x = Math.max(0, Math.sin(t * 4)) * 0.08; // listening
    } else {
      y += Math.sin(t * 1.6) * 0.012; // idle breathing
      armL = Math.sin(t * 1.3) * 0.08; armR = -armL;
      tilt = Math.sin(t * 0.7) * 0.06;
    }
    body.current.position.y = y;
    body.current.rotation.y = spin;
    body.current.rotation.z = tilt;
    parts.ArmL?.forEach((m) => (m.rotation.x = armL));
    parts.ArmR?.forEach((m) => (m.rotation.x = armR));
    legs.forEach((leg, i) => (leg.rotation.x = sit ? -1.4 : legSwing * (i % 2 ? 1 : -1)));
  });

  const badge = mood === 'waiting' ? ['!', 'warn'] : mood === 'error' ? ['!', 'err'] : mood === 'celebrate' ? ['✓', 'ok'] : null;

  return (
    <group ref={root} position={start} scale={scale}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = '')}>
      <group ref={body}>
        <primitive object={obj} />
        {boss && (
          <mesh position={[0, 0.33, 0.236]}>
            <boxGeometry args={[0.07, 0.16, 0.02]} />
            <meshStandardMaterial color="#2b2a27" />
          </mesh>
        )}
        {mood === 'present' && (
          <mesh ref={mouth} position={[0, 0.45, 0.236]}>
            <boxGeometry args={[0.12, 0.018, 0.015]} />
            <meshStandardMaterial color="#2b2a27" />
          </mesh>
        )}
      </group>
      {selected && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.5, 0.58, 32]} />
          <meshBasicMaterial color="#d97757" />
        </mesh>
      )}
      <Html position={[0, (target.pose === 'sit' ? sitY / scale : 0) + 1.2, 0]} center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
        <div className="tag">
          <span ref={bubble} className="bubble" />
          <span ref={timer} className="timer" />
          {badge &&<span className={'badge ' + badge[1]}>{badge[0]}</span>}
          {label && <span className={boss ? 'name boss' : 'name'}>{label}</span>}
        </div>
      </Html>
    </group>
  );
}

function turnTo(g, angle, k) {
  let d = angle - g.rotation.y;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  g.rotation.y += d * Math.min(1, k);
}
