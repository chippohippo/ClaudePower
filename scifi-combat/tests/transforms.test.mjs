import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bus } from '../src/core/EventBus.js';
import { makeWorld, v } from './harness.mjs';

const fire = (w, e, n = 1) => { w.press(e, 'light'); w.step(n); };
const superUp = (w, e) => { e.abilities.gainSuper(100); w.press(e, 'super'); w.seconds(1.4); };

test('Lance of Dawn swaps the gun, two hits Ignite, then reverts to the original loadout', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer');
  const B = w.fighter(2, 1, v(0, 0, -10), 'monolith', { hp: 2000 });
  const original = A.weapons.current.s.id;
  superUp(w, A);
  assert.equal(A.weapons.current.s.id, 'super_lance');
  assert.equal(A.mode, 'gun');
  w.aimAt(A, B.movement.state.position.clone().setY(1.1));
  const { got, off } = (() => { const got = []; const off = bus.on('status:threshold', (e) => got.push(e)); return { got, off }; })();
  fire(w, A, 20); fire(w, A, 20);
  off();
  assert.ok(got.some((e) => e.to === 'ignite' && e.id === 2), 'two lance hits ignite');
  w.seconds(10);
  assert.equal(A.transform, null);
  assert.equal(A.weapons.current.s.id, original);
});

test('Judgment pierces cover and ends early after its 3 shots', () => {
  const cover = [{ min: v(-2, 0, -6), max: v(2, 3, -5) }];
  const w = makeWorld(cover);
  const A = w.fighter(1, 0, v(0, 0, 0), 'seraph');
  const B = w.fighter(2, 1, v(0, 0, -15), 'monolith', { hp: 2000 });
  superUp(w, A);
  w.aimAt(A, B.movement.state.position.clone().setY(1.1));
  for (let i = 0; i < 3; i++) fire(w, A, 95);
  assert.ok(B.health.hp <= 2000 - 600, `three 300-damage shots through cover, hp=${B.health.hp}`);
  w.seconds(0.2);
  assert.equal(A.transform, null, 'ended early when empty');
});

test('Siege Frame: frame HP absorbs damage, no sprint, and the super ends when the frame breaks', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'artificer');
  w.fighter(2, 1, v(0, 0, -10), 'monolith');
  superUp(w, A);
  assert.equal(A.transform?.form, 'siege_frame');
  assert.equal(A.movement.mods.canSprint, false);
  A.health.damage(1000, {}, null);
  assert.equal(A.health.hp, A.health.max, 'frame took the hit');
  A.health.damage(600, {}, null);
  w.seconds(0.1);
  assert.equal(A.transform, null);
  assert.notEqual(A.movement.mods.canSprint, false, 'movement mods restored');
});

test('Daybreak heavy launches a flame wave; a guarding flame knight reflects it', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'dawnblade');
  const B = w.fighter(2, 1, v(0, 0, -12), 'ashsworn', { hp: 2000 });
  w.aim(B, Math.PI);
  superUp(w, A);
  assert.equal(A.melee.w.attacks.heavy1.projectile.speed, 26);
  w.press(A, 'heavy'); w.step(1); w.seconds(1.2);
  assert.ok(B.health.hp < 2000, 'wave hit');
  const hpA = A.health.hp;
  const got = [], hitsOnB = [];
  const off1 = bus.on('projectile:deflect', (e) => got.push(e));
  const off2 = bus.on('weapon:hit', (e) => e.victim === 2 && hitsOnB.push(e));
  w.hold(B, 'guard'); w.step(2);
  w.press(A, 'heavy'); w.step(1); w.seconds(1.5);
  off1(); off2();
  assert.equal(got.length, 1, 'reflected');
  assert.equal(hitsOnB.length, 0, 'defender not hit by the wave (Scorch DoT from the first wave may still tick)');
  assert.ok(A.health.hp < hpA, 'caster hit by own wave');
});

test('Spectral Daggers: 3 throws, then empty until a kill refills them', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'veil');
  w.fighter(2, 1, v(0, 0, -30), 'monolith');
  superUp(w, A);
  const { got, off } = (() => { const got = []; const off = bus.on('melee:projectile', (e) => e.id === 1 && got.push(e)); return { got, off }; })();
  for (let i = 0; i < 4; i++) { w.press(A, 'light'); w.seconds(0.5); }
  assert.equal(got.length, 3);
  A.melee.onKill();
  w.press(A, 'light'); w.seconds(0.5);
  off();
  assert.equal(got.length, 4);
});

test('dying mid-super reverts the transform', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'reaver');
  superUp(w, A);
  assert.equal(A.weapons.current.s.id, 'super_rift_shotgun');
  A.health.damage(9999, {}, null); w.step(2);
  assert.equal(A.transform, null);
  assert.notEqual(A.weapons.current.s.id, 'super_rift_shotgun');
});
