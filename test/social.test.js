'use strict';
const test = require('node:test');
const assert = require('node:assert');

test('idle mascots in the same pause group chat; a colleague who just finished gets applause', async () => {
  const { withSocial } = await import('../ui/src/social.js');
  const { pauseSpot } = await import('../ui/src/layout.js');
  const p = (id, i, extra = {}) => ({ s: { id }, target: pauseSpot(i), mood: 'idle', justDone: false, ...extra });
  const out = withSocial([p('a', 0), p('b', 1, { justDone: true }), p('c', 2), { s: { id: 'd' }, target: { pos: [0, 0, 0] }, mood: 'working' }]);
  const [a, b, c, d] = out.map((x) => x.social);
  assert.deepStrictEqual(a.partner, [pauseSpot(1).pos[0], pauseSpot(1).pos[2]]); // spots 0 and 1 are the same group
  assert.strictEqual(a.first, true);
  assert.strictEqual(b.first, false);
  assert.strictEqual(a.cheer, 'clap');
  assert.strictEqual(b.cheer, 'self');
  assert.strictEqual(c.partner, null); // alone in the next group
  assert.strictEqual(c.kind, pauseSpot(2).kind);
  assert.strictEqual(d, null);
  // groups move: with another shift the first spot is somewhere else
  assert.notDeepStrictEqual(pauseSpot(0, 1).pos, pauseSpot(0, 0).pos);
});
