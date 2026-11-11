'use strict';
const test = require('node:test');
const assert = require('node:assert');

const cross = (a, b, c, d) => {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};

test('mascots never cross a glass wall between any two spots', async () => {
  const nav = await import('../ui/src/nav.js');
  const L = await import('../ui/src/layout.js');
  const walls = nav.wallPieces();
  const spots = [
    L.bossDesk(L.PODS[0]).seat.pos, L.bossDesk(L.PODS[5]).seat.pos, L.employeeDesk(L.PODS[3], 4).seat.pos,
    L.meetingSeat(0).pos, L.meetingSeat(4).pos, L.serverSpot(0).pos, L.serverSpot(5).pos, ...Array.from({ length: 18 }, (_, i) => L.pauseSpot(i).pos),
  ].map(([x, , z]) => [x, z]);
  // sanity: a straight line from the meeting room to the terrace does cross glass
  assert.ok(walls.some(([w1, w2]) => cross(spots[3], spots[spots.length - 4], w1, w2)));
  for (const a of spots) {
    for (const b of spots) {
      if (a === b) continue;
      const path = [a, ...nav.findPath(a, b)];
      assert.deepStrictEqual(path[path.length - 1], b);
      for (let k = 1; k < path.length; k++) {
        for (const [w1, w2] of walls) {
          assert.ok(!cross(path[k - 1], path[k], w1, w2), `path ${a} -> ${b} crosses wall ${w1}-${w2}`);
        }
      }
    }
  }
});
