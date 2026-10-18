// Under fire and on the trigger: a round cracking past makes you flinch, a mag dumped makes your
// hands shake for a few seconds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bus } from '../src/core/EventBus.js';
import { Suppression } from '../src/ai/tactics/Suppression.js';
import { makeWorld, v } from './harness.mjs';

test('a mag dumped makes your hands shake for a few seconds, then they settle', () => {
  const { fighter, hold, release, seconds, step } = makeWorld();
  const A = fighter(1, 0, v(0, 0, 0), 'lancer');
  const W = A.weapons;
  hold(A, 'light'); seconds(0.4); release(A, 'light'); seconds(0.5);
  assert.ok(W.tremor < 0.35, `a burst barely does it (${W.tremor.toFixed(2)})`);
  seconds(4);
  assert.equal(W.tremor, 0);
  hold(A, 'light'); seconds(2.4); release(A, 'light');   // most of a 30-round magazine
  assert.ok(W.tremor > 0.8, `a mag dumped (${W.tremor.toFixed(2)})`);
  // The aim shakes round where the gun points.
  let dev = 0;
  for (let i = 0; i < 30; i++) { step(); dev = Math.max(dev, Math.abs(W.aimPitch - W.weaponPitch - W.recoilPitch)); }
  assert.ok(dev > 0.002, `the aim shakes (${dev.toFixed(4)} rad)`);
  seconds(4.5);
  assert.equal(W.tremor, 0, 'settled');
});

test('a round cracking past makes you flinch: your aim jumps and your body (the rig) is told', () => {
  const { world, fighter, step } = makeWorld();
  const S = new Suppression(world);
  fighter(1, 1, v(0, 0, -40), 'lancer');
  const me = fighter(2, 0, v(0, 0, 0), 'lancer');
  step(2);
  const pitch0 = me.weapons.weaponPitch, seen = [];
  const off = bus.on('fighter:nearMiss', (e) => seen.push(e));
  // A round from the shooter passing a metre to his side at chest height.
  const dx = 1, dz = 40, L = Math.hypot(dx, dz);
  bus.emit('weapon:tracer', { id: 1, from: [0, 1.1, -40], dir: [dx / L, 0, dz / L], dist: 60 });
  off(); S.dispose();
  assert.ok(me.weapons.weaponPitch > pitch0, 'the aim jumps');
  assert.equal(seen.length, 1); assert.equal(seen[0].id, 2);
  assert.ok(seen[0].k > 0.3 && seen[0].k < 1, `how close it came (${seen[0].k.toFixed(2)})`);
  assert.ok(me.suppression > 0, 'and it suppresses');
});
