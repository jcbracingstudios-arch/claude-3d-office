import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Prop, useModel } from './models.jsx';
import {
  BAR, CAFE_TABLES, LOUNGE_SOFA, LOUNGERS_X, MEETING, PARASOLS, POTS, RACKS_X, SERVER_ROOM, TERRACE_PLANTERS_Z, WALLS,
} from './layout.js';

const H = 3.2; // height of the glass facade
const FRAME = '#3b3f45';
// Lawn island around the building (diorama style).
const LAWN = { x1: -15.5, z1: -12, x2: 17, z2: 12.5, r: 3, depth: 1.6 };
const PATH_X = 9.75;
const LAWN_Y = -0.16; // grass level; the office floor is at 0

// ---------- procedural textures (no network, no image files) ----------
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

function useTextures() {
  return useMemo(() => {
    const r = rng(7);
    const planks = canvasTexture(256, 256, (g, w) => {
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 2; x++) {
          const l = 205 + Math.floor(r() * 18);
          g.fillStyle = `rgb(${l + 18},${l},${l - 32})`;
          const off = (y % 2) * 64;
          g.fillRect((x * 128 + off) % w, y * 32, 128, 32);
          g.fillRect(((x * 128 + off) % w) - w, y * 32, 128, 32);
        }
        g.fillStyle = '#00000014'; g.fillRect(0, y * 32, w, 1.5);
      }
      for (let i = 0; i < 16; i++) { g.fillStyle = '#00000012'; g.fillRect(((i * 64 + (Math.floor(i / 2) % 2) * 64) % w), Math.floor(i / 2) * 32, 1.5, 32); }
    });
    planks.repeat.set(9, 8);
    const deck = canvasTexture(128, 128, (g, w, h) => {
      for (let x = 0; x < 8; x++) {
        const l = 150 + Math.floor(r() * 25);
        g.fillStyle = `rgb(${l},${l - 40},${l - 78})`;
        g.fillRect(x * 16, 0, 15, h);
      }
    });
    deck.repeat.set(4, 12);
    const tiles = canvasTexture(64, 64, (g, w, h) => {
      g.fillStyle = '#ece9e2'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#d6d1c6'; g.lineWidth = 2; g.strokeRect(0, 0, w, h);
    });
    tiles.repeat.set(12, 5);
    const grass = canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = '#86b562'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        g.fillStyle = r() < 0.5 ? '#7aa957' : '#94c26f';
        g.fillRect(r() * w, r() * h, 1.5, 3);
      }
    });
    grass.repeat.set(0.25, 0.25); // ExtrudeGeometry UVs are in world units
    return { planks, deck, tiles, grass };
  }, []);
}

// ---------- glass wall between two points ----------
function GlassWall({ from, to, height = H, step = 1.6, gap = null, sill = 0.1, glassOpacity = 0.16 }) {
  const [x1, z1] = from, [x2, z2] = to;
  const len = Math.hypot(x2 - x1, z2 - z1);
  const ang = Math.atan2(z2 - z1, x2 - x1);
  const n = Math.max(1, Math.round(len / step));
  const mid = [(x1 + x2) / 2, (z1 + z2) / 2];
  const panes = gap ? [[0, gap[0]], [gap[1], len]] : [[0, len]];
  return (
    <group position={[mid[0], 0, mid[1]]} rotation-y={-ang}>
      {panes.map(([a, b], i) => b - a > 0.01 && (
        <group key={i}>
          <mesh position={[a + (b - a) / 2 - len / 2, height / 2, 0]} renderOrder={2}>
            <planeGeometry args={[b - a, height]} />
            <meshStandardMaterial color="#bfe3f2" transparent opacity={glassOpacity} roughness={0.05} metalness={0.2} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <mesh position={[a + (b - a) / 2 - len / 2, sill / 2, 0]} castShadow>
            <boxGeometry args={[b - a, sill, 0.1]} />
            <meshStandardMaterial color={FRAME} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, height, 0]} castShadow>
        <boxGeometry args={[len, 0.1, 0.12]} />
        <meshStandardMaterial color={FRAME} />
      </mesh>
      {Array.from({ length: n + 1 }, (_, i) => {
        const d = (i * len) / n;
        if (gap && d > gap[0] + 0.05 && d < gap[1] - 0.05) return null;
        return (
          <mesh key={i} position={[d - len / 2, height / 2, 0]} castShadow>
            <boxGeometry args={[0.06, height, 0.08]} />
            <meshStandardMaterial color={FRAME} />
          </mesh>
        );
      })}
      {gap && [gap[0], gap[1]].map((d, i) => (
        <mesh key={'g' + i} position={[d - len / 2, height / 2, 0]}>
          <boxGeometry args={[0.07, height, 0.09]} />
          <meshStandardMaterial color={FRAME} />
        </mesh>
      ))}
    </group>
  );
}

function Wall({ w }) {
  if (w.rail) return <GlassWall from={w.from} to={w.to} height={1.05} step={1.4} sill={0.05} glassOpacity={0.22} />;
  if (w.room) return <GlassWall from={w.from} to={w.to} gap={w.gap} height={w.height || 2.4} step={w.step || 1.4} />;
  return <GlassWall from={w.from} to={w.to} gap={w.gap} />;
}

// ---------- lawn island, trees, path ----------
function Lawn({ tex }) {
  const geo = useMemo(() => {
    const { x1, z1, x2, z2, r, depth } = LAWN;
    const s = new THREE.Shape();
    s.moveTo(x1 + r, z1);
    s.lineTo(x2 - r, z1); s.quadraticCurveTo(x2, z1, x2, z1 + r);
    s.lineTo(x2, z2 - r); s.quadraticCurveTo(x2, z2, x2 - r, z2);
    s.lineTo(x1 + r, z2); s.quadraticCurveTo(x1, z2, x1, z2 - r);
    s.lineTo(x1, z1 + r); s.quadraticCurveTo(x1, z1, x1 + r, z1);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.25, bevelSegments: 3, curveSegments: 8 });
    g.rotateX(Math.PI / 2); // shape Y -> world Z, extrusion goes down
    return g;
  }, []);
  return (
    // top cap sits bevelThickness above y: keep the lawn at -0.16, under the building slab
    <mesh geometry={geo} position={[0, LAWN_Y - 0.2, 0]} receiveShadow>
      <meshStandardMaterial attach="material-0" color="#ffffff" map={tex.grass} />
      <meshStandardMaterial attach="material-1" color="#8a6a4a" />
    </mesh>
  );
}

const TREE_GREENS = ['#5e8c5a', '#6f9e5b', '#7fae6b', '#4f7d4d'];
function Tree({ position, size = 1, seed = 1 }) {
  const r = rng(seed * 97 + 13);
  const crowns = useMemo(() => Array.from({ length: 3 }, (_, i) => ({
    pos: [(r() - 0.5) * 0.7, 1.6 + i * 0.45 + r() * 0.2, (r() - 0.5) * 0.7],
    s: 0.75 - i * 0.15 + r() * 0.15,
    c: TREE_GREENS[Math.floor(r() * TREE_GREENS.length)],
  })), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group position={position} scale={size}>
      <mesh position={[0, 0.8, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.14, 1.6, 6]} />
        <meshStandardMaterial color="#7a5a40" flatShading />
      </mesh>
      {crowns.map((c, i) => (
        <mesh key={i} position={c.pos} castShadow>
          <icosahedronGeometry args={[c.s, 0]} />
          <meshStandardMaterial color={c.c} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function Bush({ position, size = 0.5, color = '#6f9e5b' }) {
  return (
    <group position={position}>
      <mesh position={[0, size * 0.6, 0]} castShadow scale={[1, 0.8, 1]}>
        <icosahedronGeometry args={[size, 0]} />
        <meshStandardMaterial color={color} flatShading />
      </mesh>
      <mesh position={[size * 0.8, size * 0.4, size * 0.3]} castShadow scale={[1, 0.8, 1]}>
        <icosahedronGeometry args={[size * 0.7, 0]} />
        <meshStandardMaterial color={TREE_GREENS[0]} flatShading />
      </mesh>
    </group>
  );
}

function GardenLamp({ position, night }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.7, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.05, 1.4, 6]} />
        <meshStandardMaterial color={FRAME} />
      </mesh>
      <mesh position={[0, 1.48, 0]}>
        <boxGeometry args={[0.2, 0.2, 0.2]} />
        <meshStandardMaterial color="#fff3d6" emissive="#ffd59a" emissiveIntensity={0.2 + night * 2.5} />
      </mesh>
      <pointLight position={[0, 1.6, 0]} intensity={night * 4} distance={5} decay={1.5} color="#ffd59a" />
    </group>
  );
}

const TREES = [
  [-13.2, -10], [-8, -10.3], [-2.5, -10.1], [3, -10.4], [8.5, -10.2], [14.5, -10], // behind
  [-13.6, -5], [-13.4, 0.5], [-13.7, 5.5], [-13.2, 10.3], // left
  [15, -6], [15.2, -1], [15, 4.5], [14.6, 10.4], // right
];
const BUSHES = [[-9, 10.4], [-5.5, 10.8], [-2, 10.2], [2.5, 10.6], [6, 10.3], [12.5, 10.8], [-12, -11], [16, 0.5], [-14.5, 2.8]];

function Garden({ night }) {
  return (
    <group position-y={LAWN_Y}>
      {TREES.map(([x, z], i) => <Tree key={i} position={[x, 0, z]} size={0.9 + ((i * 37) % 10) / 25} seed={i + 1} />)}
      {BUSHES.map(([x, z], i) => <Bush key={i} position={[x, 0, z]} size={0.4 + ((i * 13) % 5) / 20} color={TREE_GREENS[i % 4]} />)}
      {/* stone path from the lawn edge to the terrace */}
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={i} position={[PATH_X + (i % 2 ? 0.08 : -0.08), 0.04, 8.75 + i * 0.68]} receiveShadow>
          <boxGeometry args={[1.3, 0.14, 0.5]} />
          <meshStandardMaterial color="#d8d3c8" />
        </mesh>
      ))}
      <GardenLamp position={[PATH_X - 1.2, 0, 9.6]} night={night} />
      <GardenLamp position={[PATH_X + 1.2, 0, 11.4]} night={night} />
    </group>
  );
}

function Rack({ position }) {
  const { obj, parts } = useModel('rack', ['LedsA', 'LedsB']);
  const seed = useMemo(() => Math.random() * 10, []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + seed;
    parts.LedsA?.forEach((m) => (m.material.emissiveIntensity = 3 + Math.sin(t * 13) * 2 + (Math.sin(t * 3.7) > 0.6 ? 3 : 0)));
    parts.LedsB?.forEach((m) => (m.material.emissiveIntensity = 3 + Math.sin(t * 7.3 + 1) * 2.5));
  });
  return <primitive object={obj} position={position} />;
}

function Zone({ rect: [x1, z1, x2, z2], color, map, y = 0.004 }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[(x1 + x2) / 2, y, (z1 + z2) / 2]} receiveShadow>
      <planeGeometry args={[x2 - x1, z2 - z1]} />
      <meshStandardMaterial color={color} map={map || null} />
    </mesh>
  );
}

function Lights({ light }) {
  const { scene } = useThree();
  useEffect(() => { scene.background = light.sky; scene.fog = null; }, [scene, light]);
  const warm = light.night * 7;
  return (
    <>
      <hemisphereLight args={['#fffaf0', '#7d8a64', light.ambient]} />
      <directionalLight position={light.sunPos} color={light.sunColor} intensity={light.sunIntensity} castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
        shadow-camera-left={-22} shadow-camera-right={22} shadow-camera-top={22} shadow-camera-bottom={-22} />
      {/* interior warm lights take over at night */}
      {[[-8.4, -4.7], [-4, -4.7], [-8.4, 0.6], [-4, 0.6], [-6.2, 5.9], [1.2, -2.5], [2.6, -6.4], [5.4, -3], [2, 2.2], [5.2, 6]].map(([x, z], i) => (
        <pointLight key={i} position={[x, 2.8, z]} intensity={warm} distance={7} decay={1.6} color="#ffd6a3" />
      ))}
    </>
  );
}

export default function Environment({ light }) {
  const tex = useTextures();
  const [mx1, mz1, mx2, mz2] = MEETING.room;
  const [sx1, sz1, sx2, sz2] = SERVER_ROOM;
  return (
    <group>
      <Lights light={light} />
      <Lawn tex={tex} />
      <Garden night={light.night} />

      {/* building slab, just above the lawn */}
      <mesh position={[0.75, -0.08, 0]} receiveShadow castShadow>
        <boxGeometry args={[24.1, 0.16, 16.6]} />
        <meshStandardMaterial color="#cfccc4" />
      </mesh>
      {/* floors */}
      <Zone rect={[-11, -8, 7, 8]} color="#ffffff" map={tex.planks} y={0.002} />
      <Zone rect={[7, -8, 12.5, 8]} color="#ffffff" map={tex.deck} y={0.002} />
      <Zone rect={[-0.2, -8, 6.4, -5.3]} color="#ffffff" map={tex.tiles} />
      <Zone rect={[mx1, mz1, mx2, mz2]} color="#c9d3d9" />
      <Zone rect={[sx1, sz1, sx2, sz2]} color="#5d6268" />
      <Zone rect={[3.9, -4.6, 6.9, -1.6]} color="#cdb79a" />

      {WALLS.map((w, i) => <Wall key={i} w={w} />)}

      <Prop name="meeting" position={[MEETING.center[0], 0, MEETING.center[1]]} />
      {RACKS_X.map((x) => <Rack key={x} position={[x, 0, 7.3]} />)}
      <Prop name="bar" position={[BAR[0], 0, BAR[1]]} />
      <Prop name="bookshelf" position={[6.2, 0, -7.6]} />
      <Prop name="sofa" position={[LOUNGE_SOFA[0], 0, LOUNGE_SOFA[1]]} />
      <Prop name="lowtable" position={[LOUNGE_SOFA[0], 0, LOUNGE_SOFA[1] + 1.1]} />
      {CAFE_TABLES.map(([x, z]) => <Prop key={x} name="table" position={[x, 0, z]} />)}
      <Prop name="planter" position={[1.75, 0, 3.9]} />
      {POTS.map(([x, z, kind], i) => <Prop key={i} name={kind} position={[x, 0, z]} />)}

      {/* terrace */}
      {LOUNGERS_X.map((x) => <Prop key={x} name="lounger" position={[x, 0, -5.5]} />)}
      {PARASOLS.map(([x, z]) => <Prop key={x} name="parasol" position={[x, 0, z]} />)}
      {TERRACE_PLANTERS_Z.map((z) => <Prop key={z} name="planter" position={[12.05, 0, z]} rotation-y={Math.PI / 2} />)}
    </group>
  );
}
