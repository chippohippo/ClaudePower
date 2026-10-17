// Reloads that cost (docs/GAMEPLAY_PLAN.md §1, WeaponComponent): the reserve is whole magazines,
// a tactical reload throws away what was left in the mag, two stages whose second survives an
// interruption, sprinting holds a reload, a hit holds it briefly instead of cancelling it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bus } from '../src/core/EventBus.js';
import { makeWorld, v } from './harness.mjs';

/** A soldier with the AR (mag 30, reserve 180: six mags; tactical 1.9 s = 0.9 + 1.0, empty +0.6). */
function setup() {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer', { hp: 5000 });
  A.mode = 'gun';
  w.step(3);
  return { w, A, gun: A.weapons.current };
}

/** Seconds from a reload press to its end (or Infinity). */
function timeReload(w, A, max = 6) {
  let t = 0;
  const off = bus.on('weapon:reloadEnd', (e) => { if (e.id === A.id) t = -t; });
  w.press(A, 'reload');
  for (let i = 0; i < max * 60 && t >= 0; i++) { w.step(1); t += 1 / 60; }
  off();
  return t < 0 ? -t : Infinity;
}

test('the reserve is whole mags; a tactical reload throws away the rounds left in the mag', () => {
  const { w, A, gun } = setup();
  assert.equal(gun.reserve % gun.s.mag, 0, 'six full mags');
  gun.mag = 20;                                   // ten fired
  const lost = [];
  const off = bus.on('weapon:magOut', (e) => { if (e.id === A.id) lost.push(e.lost); });
  const t = timeReload(w, A);
  off();
  assert.ok(Math.abs(t - 1.9) < 0.1, `tactical: 1.9 s (${t.toFixed(2)})`);
  assert.equal(gun.mag, 30);
  assert.equal(gun.reserve, 150, 'one mag out of the reserve');
  assert.deepEqual(lost, [20], 'the old mag went with its 20 rounds');
  // From empty: the bolt is worked too.
  gun.mag = 0;
  const t2 = timeReload(w, A);
  assert.ok(Math.abs(t2 - 2.5) < 0.1, `from empty: 2.5 s (${t2.toFixed(2)})`);
});

test('interrupted after the old mag is out, the next reload picks up stage 2 where it stopped', () => {
  const { w, A, gun } = setup();
  gun.mag = 12;
  w.press(A, 'reload');
  w.seconds(1.4);                                 // stage 1 done (0.9 s), half a second into stage 2
  assert.equal(gun.mag, 0, 'the old mag is out');
  A.weapons.interrupt('melee');
  assert.notEqual(A.weapons.phase, 'reloading', 'interrupted');
  assert.ok(gun.magOut && gun.inT > 0.4, `stage 2 progress kept on the gun (${gun.inT.toFixed(2)} s)`);
  const t = timeReload(w, A);
  assert.ok(t < 0.65, `only the rest of stage 2 (${t.toFixed(2)} s)`);
  assert.equal(gun.mag, 30);
});

test('interrupted in stage 1, it starts over with the old mag still in', () => {
  const { w, A, gun } = setup();
  gun.mag = 12;
  w.press(A, 'reload');
  w.seconds(0.5);
  A.weapons.interrupt('stun');
  assert.equal(gun.mag, 12, 'nothing lost yet');
  assert.ok(!gun.magOut);
  const t = timeReload(w, A);
  assert.ok(Math.abs(t - 1.9) < 0.1, `the whole reload again (${t.toFixed(2)} s)`);
});

test('sprinting holds a reload without losing progress; a hit holds it 0.2 s instead of cancelling it', () => {
  const { w, A, gun } = setup();
  gun.mag = 5;
  w.press(A, 'reload');
  w.seconds(0.5);
  const p0 = A.weapons.rl.t;
  w.hold(A, 'sprint'); w.move(A, 0, 1);
  w.seconds(1);
  assert.ok(A.movement.state.sprinting, 'sprinting');
  assert.equal(A.weapons.phase, 'reloading', 'still reloading');
  assert.ok(A.weapons.rl.t - p0 < 0.05 && A.weapons.rl.stage === 1, `and no further on for the second of sprinting (${(A.weapons.rl.t - p0).toFixed(3)} s: the tick it took to break into a run)`);
  w.release(A, 'sprint'); w.move(A, 0, 0);
  w.seconds(0.4);
  assert.ok(A.weapons.rl.t > p0 || A.weapons.rl.stage === 2, 'picked up again');
  // A hit while reloading: held 0.2 s, not cancelled.
  const before = A.weapons.rl.stage * 10 + A.weapons.rl.t;
  A.weapons.interrupt('flinch');
  w.seconds(0.15);
  assert.equal(A.weapons.phase, 'reloading', 'the hit didn\'t cancel it');
  assert.ok(Math.abs(A.weapons.rl.stage * 10 + A.weapons.rl.t - before) < 1e-6, 'held');
  w.seconds(2);
  assert.equal(gun.mag, 30, 'done');
});

test('you walk slower while you reload', () => {
  const { w, A, gun } = setup();
  gun.mag = 3;
  w.move(A, 0, 1);
  w.seconds(1);
  const free = Math.hypot(A.movement.state.velocity.x, A.movement.state.velocity.z);
  w.press(A, 'reload');
  w.seconds(0.6);
  const loaded = Math.hypot(A.movement.state.velocity.x, A.movement.state.velocity.z);
  assert.ok(loaded < free * 0.9 && loaded > free * 0.75, `85% pace (${loaded.toFixed(2)} of ${free.toFixed(2)} m/s)`);
});
