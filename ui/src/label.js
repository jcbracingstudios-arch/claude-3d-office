// Screen-space label for a 3D object: a plain DOM element positioned every frame.
// Replaces drei <Html>, whose per-label React root could be wiped by a deferred unmount and stay empty.
import { useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';

const v = new THREE.Vector3();

export function useLabel() {
  const parts = useMemo(() => {
    const el = document.createElement('div');
    el.className = 'tag3d';
    el.innerHTML = '<div class="tag"><span class="bubble"></span><span class="timer"></span><span class="badge"></span><span class="name"></span></div>';
    const [bubble, timer, badge, name] = el.firstChild.children;
    return { el, bubble, timer, badge, name };
  }, []);
  useLayoutEffect(() => {
    (document.getElementById('labels') || document.body).appendChild(parts.el);
    return () => parts.el.remove();
  }, [parts]);
  return parts;
}

const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
const setClass = (node, cls) => { if (node.className !== cls) node.className = cls; };

/** Call from useFrame: places the label above `object` (local offset y) and updates its texts. */
export function updateLabel(parts, object, y, camera, size, { bubble = '', timer = '', badge = null, name = '', boss = false }) {
  object.localToWorld(v.set(0, y, 0));
  v.project(camera);
  const hidden = v.z > 1 || v.z < -1;
  parts.el.style.display = hidden ? 'none' : '';
  if (!hidden) parts.el.style.transform = `translate3d(${((v.x + 1) / 2) * size.width}px,${((1 - v.y) / 2) * size.height}px,0) translate(-50%,-50%)`;
  setText(parts.bubble, bubble);
  setText(parts.timer, timer);
  setText(parts.badge, badge ? badge[0] : '');
  setClass(parts.badge, badge ? 'badge ' + badge[1] : 'badge');
  setText(parts.name, name || '');
  setClass(parts.name, boss ? 'name boss' : 'name');
}
