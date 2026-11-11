import { useGLTF } from '@react-three/drei';
import { useMemo } from 'react';

export const MODELS = ['mascot', 'desk_small', 'desk_boss', 'bar', 'meeting', 'rack', 'lounger', 'parasol', 'planter',
  'plant', 'tree', 'sofa', 'bookshelf', 'table', 'lowtable'];
MODELS.forEach((m) => useGLTF.preload(`/models/${m}.glb`));

// Blender may suffix duplicate names ("Screen.001" -> "Screen001" after glTF sanitising): match on the base name.
export const baseName = (n) => n.replace(/\d{3}$/, '');

/** Clone of a GLB scene with shadows on; `own` lists base names whose material gets its own copy (to animate it). */
export function useModel(name, own = []) {
  const { scene } = useGLTF(`/models/${name}.glb`);
  return useMemo(() => {
    const obj = scene.clone(true);
    const parts = {};
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      const b = baseName(o.name);
      if (own.includes(b)) o.material = o.material.clone();
      (parts[b] ||= []).push(o);
    });
    return { obj, parts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);
}

export function Prop({ name, ...props }) {
  const { obj } = useModel(name);
  return <primitive object={obj} {...props} />;
}
