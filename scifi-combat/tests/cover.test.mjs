// Cover: your back to the wall, barrier or parked car in front of you; shuffle along it, come up
// over low cover or out round a high corner to aim and shoot, back in when you let go.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, v } from './harness.mjs';

const box = (x0, z0, x1, z1, h, kind = 'barrier') => ({ min: v(x0, 0, z0), max: v(x1, h, z1), kind, surface: 'concrete' });

/** A soldier 2 m behind (south of) a wall along x from -3 to 3, its face at z = -0.5, looking at it (yaw 0 looks at -z). */
function behind(h) {
  const W = makeWorld([box(-3, -1, 3, -0.5, h)]);
  const me = W.fighter(1, 0, v(0, 0, 1.5), 'lancer');
  me.mode = 'gun';
  W.step(5);
  return { ...W, me, s: me.movement.state };
}

test('low cover: in behind it crouched, the gun down; shuffle along to its end; aim and you come up over it, gun up; let go and you are back down', () => {
  const { me, s, press, hold, release, move, step, seconds } = behind(1.1);
  press(me, 'cover'); step(2);
  assert.equal(s.mode, 'cover');
  assert.ok(!s.cover.high && s.stance === 'crouch', 'low cover: crouched');
  seconds(0.4);
  assert.ok(Math.abs(s.position.z - (-0.5 + s.cover.gap)) < 0.05, `against it (${s.position.z.toFixed(2)})`);
  assert.equal(s.weaponReady, false, 'the gun is down behind it');
  // Along it to the right: stops at its end.
  move(me, 1, 0); seconds(2.5); move(me, 0, 0);
  assert.ok(s.position.x > 2.6 && s.position.x <= 3.01, `along to the end (${s.position.x.toFixed(2)})`);
  assert.equal(s.mode, 'cover', 'still in cover');
  // Aim: up over it.
  hold(me, 'guard'); seconds(0.4);
  assert.equal(s.stance, 'stand', 'up over it');
  assert.ok(s.cover.out > 0.95 && s.weaponReady, 'out, gun up');
  release(me, 'guard'); seconds(0.4);
  assert.ok(s.stance === 'crouch' && s.cover.out === 0 && !s.weaponReady, 'back down');
  // The key again: out of cover.
  press(me, 'cover'); step(2);
  assert.equal(s.mode, 'ground');
});

test('high cover: standing at the wall; halfway along it aiming brings nothing out; at its corner you step out past it to aim, and back', () => {
  const { me, s, press, hold, release, move, step, seconds } = behind(2.6);
  press(me, 'cover'); step(2);
  assert.ok(s.mode === 'cover' && s.cover.high && s.stance === 'stand', 'high cover: standing at it');
  hold(me, 'guard'); seconds(0.4);
  assert.equal(s.cover.out, 0, 'halfway along a wall: nothing to come out to');
  assert.equal(s.weaponReady, false);
  release(me, 'guard'); step(1);
  move(me, -1, 0); seconds(2.5); move(me, 0, 0);
  assert.ok(s.position.x < -2.6, `at the left corner (${s.position.x.toFixed(2)})`);
  hold(me, 'guard'); seconds(0.4);
  assert.ok(s.cover.out > 0.95 && s.weaponReady, 'out round the corner, gun up');
  assert.ok(s.position.x < -3.3, `stepped out past it (${s.position.x.toFixed(2)})`);
  release(me, 'guard'); seconds(0.4);
  assert.ok(s.position.x > -3.05, 'and back in behind it');
});

test('out of cover: pushing away from it, a dive, or the cover being blown away', () => {
  const T = behind(1.1);
  T.press(T.me, 'cover'); T.step(2);
  T.move(T.me, 0, -1); T.seconds(0.4);   // (yaw 0: back is +z, away from the wall)
  assert.equal(T.s.mode, 'ground', 'walked away from it');
  T.move(T.me, 0, 0); T.seconds(0.5);
  T.press(T.me, 'cover'); T.step(2);
  assert.equal(T.s.mode, 'cover', 'back in');
  T.press(T.me, 'dodge'); T.step(2);
  assert.equal(T.s.mode, 'dive', 'dived out of it');
  T.seconds(2);
  const U = behind(1.1);
  U.press(U.me, 'cover'); U.step(2);
  U.world.removeCover(U.world.cover[0]);
  U.seconds(0.4);
  assert.notEqual(U.s.mode, 'cover', 'the wall gone: out of cover');
});

test('a parked car is cover (crouched behind its bodywork); one driving off is not', () => {
  const W = makeWorld([]);
  const car = W.world.vehicles.spawn('solari_recon_car', 0, v(0, 0, -2), Math.PI / 2);   // across the way, side on
  W.step(30);
  const me = W.fighter(1, 0, v(0.3, 0, 0.6), 'lancer');
  me.mode = 'gun';
  W.step(2);
  const s = me.movement.state;
  W.press(me, 'cover'); W.step(2);
  assert.equal(s.mode, 'cover', 'in cover behind the car');
  assert.ok(!s.cover.high && s.stance === 'crouch', 'crouched behind it');
  assert.equal(s.cover.face.src, car);
  // Driven off: out of cover.
  car.car.vel.set(6, 0, 0);
  W.step(20);
  assert.notEqual(s.mode, 'cover', 'the car moved: no cover');
});

test('no cover to take in the open, or behind something too low to hide behind', () => {
  const open = makeWorld([]);
  const a = open.fighter(1, 0, v(0, 0, 0), 'lancer');
  open.press(a, 'cover'); open.step(2);
  assert.equal(a.movement.state.mode, 'ground');
  const low = behind(0.5);
  low.press(low.me, 'cover'); low.step(2);
  assert.equal(low.s.mode, 'ground', 'a kerb is no cover');
});
