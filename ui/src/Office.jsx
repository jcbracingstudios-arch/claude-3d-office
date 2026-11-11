import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { Suspense, useRef } from 'react';
import * as THREE from 'three';
import { FILM, filmTime, keyAt } from './film.js';
import Environment from './Environment.jsx';
import Workstation from './Workstation.jsx';
import Mascot from './Mascot.jsx';
import { useDayCycle } from './daycycle.js';
import { withSocial } from './social.js';
import { bossDesk, employeeDesk, meetingSeat, pauseSpot, podOrigin, serverSpot } from './layout.js';

const RUGS = ['#d9c7b0', '#c7d0c2', '#cfc4d6', '#c9d4dc', '#dccbbd', '#d3d0bd'];
const TARGET = [0.8, 0, -0.3];

function Pod({ index, session, light }) {
  const origin = podOrigin(index);
  const [px, pz] = origin;
  const boss = bossDesk(origin);
  const agents = Object.values(session?.agents || {});
  const desks = Math.min(6, Math.max(2, agents.length));
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[px, 0.006, pz - 0.5]} receiveShadow>
        <planeGeometry args={[3.4, 4.6]} />
        <meshStandardMaterial color={RUGS[index % RUGS.length]} />
      </mesh>
      <Workstation model="desk_boss" position={boss.pos} active={session?.status === 'working'} night={light.night}
        hideMonitor={!!session && FILM?.presenter === session.id} />
      {Array.from({ length: desks }, (_, j) => {
        const d = employeeDesk(origin, j);
        const a = agents[j];
        return <Workstation key={j} model="desk_small" position={d.pos} rotation={d.rot} active={a?.status === 'working'} night={light.night} />;
      })}
    </group>
  );
}

// Agent teams: shared task list progress, shown next to the lead's name.
const teamProgress = (s) => {
  const tasks = Object.values(s.tasks || {});
  return tasks.length ? ` · 📋 ${tasks.filter((t) => t.done).length}/${tasks.length}` : '';
};

// Film mode: cinematic perspective camera following FILM.camera keyframes [{ t, pos, look, fov }].
function FilmCamera() {
  const cam = useRef();
  useFrame(() => {
    const k = keyAt(FILM.camera, filmTime());
    if (!k || !cam.current) return;
    cam.current.position.set(...k.pos);
    cam.current.fov = k.fov || 35;
    cam.current.updateProjectionMatrix();
    cam.current.lookAt(...k.look);
  });
  return <PerspectiveCamera makeDefault ref={cam} fov={35} near={0.05} far={400} />;
}

// Desk microphone with a glowing, colour-cycling ring (presenter shots).
function Mic({ position }) {
  const ring = useRef();
  const c = useRef(new THREE.Color());
  useFrame(() => {
    if (ring.current) ring.current.emissive.copy(c.current.setHSL((filmTime() * 0.15) % 1, 0.9, 0.55));
  });
  return (
    <group position={position}>
      <mesh position={[0, 0.01, 0]}><cylinderGeometry args={[0.07, 0.08, 0.02, 16]} /><meshStandardMaterial color="#222" /></mesh>
      <mesh position={[0, 0.12, 0]}><cylinderGeometry args={[0.008, 0.008, 0.22, 6]} /><meshStandardMaterial color="#333" /></mesh>
      <mesh position={[0, 0.27, 0]} castShadow><capsuleGeometry args={[0.045, 0.1, 6, 12]} /><meshStandardMaterial color="#1b1b1d" roughness={0.4} /></mesh>
      <mesh position={[0, 0.235, 0]}>
        <cylinderGeometry args={[0.048, 0.048, 0.05, 20, 1, true]} />
        <meshStandardMaterial ref={ring} color="#111" emissiveIntensity={2.2} toneMapped={false} />
      </mesh>
    </group>
  );
}

export default function Office({ sessions, selected, onSelect }) {
  const light = useDayCycle();
  // Stable pod per session: order of arrival.
  const ordered = [...sessions].sort((a, b) => Date.parse(a.logs[0]?.ts || 0) - Date.parse(b.logs[0]?.ts || 0) || (a.id < b.id ? -1 : 1));
  const pods = Math.max(4, ordered.length);
  const now = Date.now();
  let idleIdx = 0;
  let meetIdx = 0;
  let limIdx = 0;
  // every 3 minutes the groups on break move to other places
  const shift = FILM ? FILM.shift || 0 : Math.floor(now / 180000);

  return (
    <Canvas shadows dpr={FILM ? window.devicePixelRatio : [1, 2]} onPointerMissed={() => onSelect(null)}>
      {FILM ? <FilmCamera /> : (
        <>
          <OrthographicCamera makeDefault position={[TARGET[0] + 15, 14, TARGET[2] + 11.7]} zoom={Math.max(18, Math.min(window.innerWidth / 36, 60))} near={-100} far={300} />
          <OrbitControls target={TARGET} maxPolarAngle={Math.PI / 2.3} minZoom={15} maxZoom={160} />
        </>
      )}
      <Suspense fallback={null}>
        <Environment light={light} />
        {Array.from({ length: pods }, (_, i) => (
          <Pod key={i} index={i} session={ordered[i]} light={light} />
        ))}
        {withSocial(ordered.map((s, i) => {
          const origin = podOrigin(i);
          const age = now - Date.parse(s.since);
          const celebrating = s.status === 'done' && age < 5000;
          const atDesk = s.status === 'working' || s.status === 'error' || celebrating;
          const target = atDesk ? bossDesk(origin).seat
            : s.status === 'waiting' ? meetingSeat(meetIdx++)
            : s.status === 'limited' ? serverSpot(limIdx++)
            : pauseSpot(idleIdx++, shift);
          const mood = celebrating ? 'celebrate' : s.status === 'done' ? 'idle' : s.status;
          return { s, origin, target, mood, justDone: s.status === 'done' && age >= 5000 && age < 30000 };
        })).map(({ s, origin, target, mood, social }) => {
          const agents = Object.values(s.agents || {});
          const seat = bossDesk(origin).seat;
          const spawn = seat.pos;
          const presenting = FILM?.presenter === s.id;
          return (
            <group key={s.id}>
              {presenting && <Mic position={[seat.pos[0] + 0.32, 0.77, seat.pos[2] + 0.34]} />}
              <Mascot id={s.id} target={target} mood={presenting ? 'present' : mood} social={social} boss
                label={presenting ? null : s.project + teamProgress(s)}
                since={s.since} say={/^SendMessage/.test(s.lastAction || '') && s.status === 'working' ? '✉️' : null}
                selected={selected === s.id} onClick={() => onSelect(s.id)} />
              {agents.map((a, j) => (
                <Mascot key={a.id} id={a.id} spawn={spawn} scale={0.62} label={a.name || a.type} target={employeeDesk(origin, j).seat}
                  say={/^SendMessage/.test(a.lastAction || '') ? '✉️' : null}
                  mood={a.status === 'working' ? 'working' : 'idle'} onClick={() => onSelect(s.id)} />
              ))}
            </group>
          );
        })}
      </Suspense>
    </Canvas>
  );
}
