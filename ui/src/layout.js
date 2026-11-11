// Office floor plan (three.js units = meters). Camera looks from +X/+Z, so furniture faces +Z or +X.
// Interior: x [-11, 7], z [-8, 8]. Terrace: x [7, 12.5].

// Team pods: boss desk at the back of the pod, employees on small desks on both sides, facing each other.
export const PODS = [[-8.4, -4.7], [-4.0, -4.7], [-8.4, 0.6], [-4.0, 0.6], [-8.4, 5.9], [-4.0, 5.9]];
export const MAX_EMPLOYEE_DESKS = 6;

export function podOrigin(i) {
  if (i < PODS.length) return PODS[i];
  // shortcut: more than 6 sessions spill onto extra rows outside the room; add floors/zoom-out if you run that many
  const k = i - PODS.length;
  return [-8.4 + (k % 2) * 4.4, 11.2 + Math.floor(k / 2) * 5.3];
}

export function bossDesk([px, pz]) {
  return { pos: [px, 0, pz - 1.9], rot: 0, seat: { pos: [px, 0, pz - 2.52], rot: 0, pose: 'sit', sitY: 0.3 } };
}

// Employee desk j: alternates left/right, three rows. Mascot faces the desk (toward the pod's centre line).
export function employeeDesk([px, pz], j) {
  const side = j % 2 ? 1 : -1;
  const row = Math.floor(j / 2);
  const rot = side < 0 ? Math.PI / 2 : -Math.PI / 2;
  const z = pz - 0.7 + row * 1.1;
  if (j >= MAX_EMPLOYEE_DESKS) {
    return { pos: null, seat: { pos: [px + side * 0.6, 0, pz + 2.2 + (row - 3) * 0.6], rot: Math.PI, pose: 'stand' } };
  }
  return { pos: [px + side * 0.75, 0, z], rot, seat: { pos: [px + side * 1.3, 0, z], rot, pose: 'sit', sitY: 0.26 } };
}

// Glass meeting room: sessions waiting for your approval sit here with a raised hand.
export const MEETING = { center: [1.2, -2.5], room: [-0.9, -4.4, 3.3, -0.6] };
export const meetingSeat = (i) => {
  const [cx, cz] = MEETING.center;
  const front = i < 3; // front row faces the camera
  const x = cx + ((i % 3) - 1) * 0.8;
  return front
    ? { pos: [x, 0, cz - 0.82], rot: 0, pose: 'sit', sitY: 0.26 }
    : { pos: [x, 0, cz + 0.82], rot: Math.PI, pose: 'sit', sitY: 0.26 };
};

// Usage limit reached: wait in the server room, in front of the racks (z 7.3), looking at them.
export const serverSpot = (i) => ({ pos: [4.1 + (i % 4) * 0.75, 0, 6.35 - Math.floor(i / 4) * 0.7], rot: 0, pose: 'stand' });

export const BAR = [2.6, -7.25];
export const LOUNGE_SOFA = [5.4, -3.6];
export const SERVER_ROOM = [3.4, 4.2, 7, 8];
export const CAFE_TABLES = [[0.5, 2.2], [3.0, 2.2]];
export const RACKS_X = [3.95, 4.7, 5.45, 6.2];
export const LOUNGERS_X = [8.6, 9.9, 11.2];
export const PARASOLS = [[9.9, -3.3], [9.4, 4.6]];
export const TERRACE_PLANTERS_Z = [-1.6, 1.8, 6.6];
// Potted trees / plants: [x, z, kind]
export const POTS = [[6.5, -1.2, 'tree'], [-10.4, -7.4, 'tree'], [-1.5, -7.5, 'plant'], [-10.5, 3.2, 'plant'], [-1.6, 3.3, 'plant'],
  [-1.3, 7.3, 'tree'], [7.8, -7.4, 'tree'], [7.8, 7.4, 'tree']];

// Walls the mascots must not cross. gap = [start, end] distance along the wall (a door).
const [mx1, mz1, mx2, mz2] = MEETING.room;
const [sx1, sz1, sx2, sz2] = SERVER_ROOM;
export const WALLS = [
  { from: [-11, -8], to: [7, -8] }, // back facade
  { from: [-11, 8], to: [-11, -8] }, // left facade
  { from: [7, -8], to: [7, 8], gap: [7.2, 8.8] }, // office / terrace, sliding door
  { from: [7, -8], to: [12.5, -8], rail: true },
  { from: [12.5, -8], to: [12.5, 8], rail: true },
  { from: [mx1, mz1], to: [mx2, mz1], room: true }, // meeting room
  { from: [mx1, mz2], to: [mx1, mz1], room: true },
  { from: [mx2, mz1], to: [mx2, mz2], room: true },
  { from: [mx1, mz2], to: [mx2, mz2], room: true, gap: [1.6, 2.6] },
  { from: [sx1, sz1], to: [sx2, sz1], room: true, height: 2.6, step: 1.2, gap: [0.3, 1.2] }, // server room
  { from: [sx1, sz2], to: [sx1, sz1], room: true, height: 2.6, step: 1.2 },
];

// Where mascots may walk: office + terrace (the front edge of the building is open).
export const WALKABLE = [[-11, -8, 12.5, 8]];

// Furniture footprints to walk around: [x1, z1, x2, z2]. Seats sit just outside these.
const rect = (cx, cz, w, d) => [cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2];
export function obstacles() {
  const list = [];
  PODS.forEach((o) => {
    const b = bossDesk(o).pos;
    list.push(rect(b[0], b[2], 1.6, 0.8));
    for (let j = 0; j < MAX_EMPLOYEE_DESKS; j++) { const d = employeeDesk(o, j).pos; list.push(rect(d[0], d[2], 0.6, 1.0)); }
  });
  list.push(rect(MEETING.center[0], MEETING.center[1], 2.4, 1.0), rect(MEETING.center[0] - 1.7, MEETING.center[1], 0.4, 1.5));
  list.push([BAR[0] - 2.13, BAR[1] - 0.95, BAR[0] + 2.9, BAR[1] + 0.05], rect(BAR[0], BAR[1] + 1.05, 3.4, 0.75)); // counter+fridge, island
  list.push(rect(6.2, -7.6, 1.2, 0.4)); // bookshelf
  list.push(rect(LOUNGE_SOFA[0], LOUNGE_SOFA[1], 2.0, 0.8), rect(LOUNGE_SOFA[0], LOUNGE_SOFA[1] + 1.1, 1.0, 0.55));
  CAFE_TABLES.forEach(([x, z]) => list.push(rect(x, z, 1.0, 1.0)));
  list.push(rect(1.75, 3.9, 2.0, 0.5)); // planter
  list.push([RACKS_X[0] - 0.35, 6.85, RACKS_X[RACKS_X.length - 1] + 0.35, 7.75]);
  LOUNGERS_X.forEach((x) => list.push(rect(x, -5.5, 0.62, 1.8)));
  PARASOLS.forEach(([x, z]) => list.push(rect(x, z, 0.5, 0.5), rect(x + 0.7, z - 0.5, 0.65, 0.65)));
  TERRACE_PLANTERS_Z.forEach((z) => list.push(rect(12.05, z, 0.5, 2.0)));
  POTS.forEach(([x, z, k]) => list.push(rect(x, z, k === 'tree' ? 0.6 : 0.4, k === 'tree' ? 0.6 : 0.4)));
  return list;
}

// Pause spots, grouped by place. Spots of a group are close: mascots placed there chat together.
// `kind` picks what a mascot alone there thinks about.
// Sits a little behind the stool centre so the body clears the island counter.
const stool = (dx) => ({ pos: [BAR[0] + dx, 0, BAR[1] + 1.75], rot: Math.PI, pose: 'sit', sitY: 0.57 });
// Standing at a round cafe table (radius 0.55), facing it, far enough not to sink into it.
const atTable = ([x, z], side) => ({ pos: [x + side * 0.9, 0, z], rot: side < 0 ? Math.PI / 2 : -Math.PI / 2, pose: 'stand' });
const PAUSE_GROUPS = [
  { kind: 'bar', spots: [stool(-1.2), stool(-0.4)] },
  { kind: 'sofa', spots: [-0.4, 0.4].map((dx) => ({ pos: [LOUNGE_SOFA[0] + dx, 0, LOUNGE_SOFA[1] + 0.05], rot: 0, pose: 'sit', sitY: 0.27 })) },
  { kind: 'cafe', spots: [atTable(CAFE_TABLES[0], -1), atTable(CAFE_TABLES[0], 1)] },
  { kind: 'terrace', spots: [8.6, 9.9].map((x) => ({ pos: [x, 0, -5.25], rot: 0, pose: 'sit', sitY: 0.18 })) },
  { kind: 'coffee', spots: [{ pos: [1.4, 0, -6.9], rot: Math.PI, pose: 'stand' }, { pos: [2.3, 0, -6.9], rot: Math.PI, pose: 'stand' }] },
  { kind: 'rail', spots: [{ pos: [11.8, 0, 1.2], rot: Math.PI / 2, pose: 'stand' }, { pos: [11.8, 0, 2.6], rot: Math.PI / 2, pose: 'stand' }] },
  { kind: 'cafe', spots: [atTable(CAFE_TABLES[1], -1), atTable(CAFE_TABLES[1], 1)] },
  { kind: 'books', spots: [{ pos: [5.6, 0, -6.8], rot: Math.PI, pose: 'stand' }, { pos: [6.8, 0, -6.8], rot: Math.PI, pose: 'stand' }] },
  { kind: 'bar', spots: [stool(0.4), stool(1.2)] },
  { kind: 'terrace', spots: [{ pos: [11.2, 0, -5.25], rot: 0, pose: 'sit', sitY: 0.18 }] },
];
const PAUSE_COUNT = PAUSE_GROUPS.reduce((n, g) => n + g.spots.length, 0);

/** i-th idle mascot's spot. `shift` rotates which places are used first, so groups move around over time. */
export function pauseSpot(i, shift = 0) {
  if (i < PAUSE_COUNT) {
    const n = PAUSE_GROUPS.length;
    let k = i;
    for (let g = 0; g < n; g++) {
      const group = PAUSE_GROUPS[(g + shift) % n];
      if (k < group.spots.length) return { ...group.spots[k], kind: group.kind };
      k -= group.spots.length;
    }
  }
  const k = i - PAUSE_COUNT; // overflow: mingle on the terrace
  return { pos: [8.4 + (k % 4) * 0.9, 0, 0.5 + Math.floor(k / 4) * 0.9], rot: Math.PI / 4, pose: 'stand', kind: 'rail' };
}
