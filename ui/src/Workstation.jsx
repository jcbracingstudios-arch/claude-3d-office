import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { useModel } from './models.jsx';

const GLYPHS = 6;

/** A desk (boss or employee). When active, the screen glows and lines of "code" rise above it. */
export default function Workstation({ model, position, rotation = 0, active, night = 0, hideMonitor = false }) {
  const { obj, parts } = useModel(model, ['Screen', 'LampShade']);
  // Presenter shots film from where the monitor stands.
  ['Screen', 'MonitorFrame', 'Stand', 'StandBase'].forEach((n) => parts[n]?.forEach((m) => (m.visible = !hideMonitor)));
  const glyphs = useRef([]);
  const seeds = useMemo(() => Array.from({ length: GLYPHS }, () => Math.random()), []);
  const top = model === 'desk_boss' ? 1.25 : 1.08;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    parts.Screen?.forEach((m) => {
      m.material.emissive.set(active ? '#3fd47f' : '#2a3b55');
      m.material.emissiveIntensity = active ? 0.9 + Math.sin(t * 9 + seeds[0] * 6) * 0.25 : 0.08 + night * 0.25;
    });
    parts.LampShade?.forEach((m) => { m.material.emissive.set('#ffcf7a'); m.material.emissiveIntensity = night * 1.6; });
    glyphs.current.forEach((g, i) => {
      if (!g) return;
      g.visible = active && !hideMonitor;
      if (!g.visible) return;
      const p = (t * 0.6 + seeds[i]) % 1; // rise and fade above the screen
      g.position.set((seeds[i] - 0.5) * 0.7, top + p * 0.8, 0.12);
      g.material.opacity = 1 - p;
      g.scale.x = 0.06 + seeds[(i + 3) % GLYPHS] * 0.2;
    });
  });

  return (
    <group position={position} rotation-y={rotation}>
      <primitive object={obj} />
      {seeds.map((_, i) => (
        <mesh key={i} ref={(m) => (glyphs.current[i] = m)} visible={false}>
          <boxGeometry args={[1, 0.03, 0.01]} />
          <meshBasicMaterial color={i % 3 ? '#3fd47f' : '#d97757'} transparent toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}
