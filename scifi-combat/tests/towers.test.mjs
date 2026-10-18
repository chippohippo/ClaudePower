// Towers coming down (Structures.js): worn through at the foot by shelling, or brought down in a
// city battle; it topples the way it was hurt, across the street, onto what's there: another tower
// (which may go too), a car (smashed), soldiers (crushed, or knocked flying). What's left is rubble
// the bots route round.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bus } from '../src/core/EventBus.js';
import { CoverIndex } from '../src/world/CoverIndex.js';
import { StructureSystem } from '../src/world/Structures.js';
import { FrontlineSession } from '../src/game/FrontlineSession.js';
import { makeWorld, data as H, v } from './harness.mjs';

const SHELL = { id: 'shell', damage: { base: 320, splash: 9 }, ammoType: 'explosive', artillery: {} };
const NOBODY = { ownerId: null, team: -1 };
const tower = (x0, z0, x1, z1, h, street = [1]) => ({ box: { min: v(x0, 0, z0), max: v(x1, h, z1), kind: 'tower', surface: 'concrete', render: 'city' }, storeys: Math.round(h / 3.6), base: 0, street });

/** Tower A (60 m) west of a 14 m street, tower B (45 m) east of it. */
function street() {
  const A = tower(-20, -8, 0, 8, 60), B = tower(14, -9, 30, 9, 45, [0]);
  const cover = new CoverIndex([A.box, B.box], { cell: 8 });
  const W = makeWorld(cover);
  const st = new StructureSystem(W.world, { city: { buildings: [A, B], houses: [] } });
  W.world.structures = st;
  const run = (s) => { for (let i = 0; i < Math.round(s * 60); i++) { W.step(1); st.update(1 / 60); } };
  return { ...W, st, A: st.towers[0], B: st.towers[1], cover, run };
}

test('shelling a tower\'s foot wears it down (a shell high up much less); worn through, it comes down the way it was hurt', () => {
  const T = street();
  const hp0 = T.A.hp;
  T.world.explode(v(-10, 50, 8.6), 9, SHELL, NOBODY);
  const high = hp0 - T.A.hp;
  T.world.explode(v(-10, 1, 8.6), 9, SHELL, NOBODY);
  const low = hp0 - T.A.hp - high;
  assert.ok(low > high * 3, `the foot (${low.toFixed(0)}) far more than up high (${high.toFixed(0)})`);
  // Keep at its north side's foot until it goes.
  let n = 0;
  while (!T.A.down && n++ < 60) T.world.explode(v(-10, 1, 8.6), 9, SHELL, NOBODY);
  assert.ok(T.A.down && n >= 6, `down after ${n + 2} shells`);
  assert.ok(!T.cover.list.includes(T.A.box), 'gone from the cover');
  T.run(6);
  const bodies = T.st.rigid.bodies.filter((b) => b.data.tower === T.A);
  const z = bodies.reduce((a, b) => a + b.x[2] * b.m, 0) / bodies.reduce((a, b) => a + b.m, 0);
  assert.ok(z > 8, `fallen north, the side it was hurt from (its mass now at z ${z.toFixed(1)})`);
});

test('brought down: it groans first, the ground it will cover marked; then it topples across the street onto the tower there, which goes too', () => {
  const T = street();
  const ev = [];
  const off = bus.on('structure:tower', (e) => ev.push(e));
  T.st.bringDown(T.A, { dx: 1, dz: 0 });
  off();
  assert.equal(ev.length, 1);
  assert.ok(ev[0].warn > 2, 'a warning');
  const out = v(0, 0, 0);
  assert.ok(T.st.dangerAt(7, 0, out) && T.st.dangerAt(40, 0, out), 'the street and beyond are marked');
  assert.ok(!T.st.dangerAt(7, 40, out), 'not off to the side');
  T.run(ev[0].warn - 0.5);
  assert.equal(T.st.rigid.bodies.length, 0, 'still standing while it groans');
  T.run(1);
  assert.ok(T.A.down && T.st.rigid.bodies.length > 3, 'then it goes');
  T.run(5);
  assert.ok(T.B.hp < T.B.max, 'it hits the tower across the street');
  T.run(10);
  assert.ok(T.B.down, 'and brings it down too');
  // It all comes to rest as rubble: cover, and a way round it for the bots.
  T.run(8);
  const rubble = T.cover.list.filter((b) => b.kind === 'rubble');
  assert.ok(rubble.length > 50, `a pile of rubble (${rubble.length} boxes)`);
  assert.ok(Math.max(...rubble.map((b) => b.max.x)) > 30, 'across the street and past where the tower there stood');
});

test('what it comes down on: a car is smashed (it burns, then blows), the soldier under it is crushed, one nearby is knocked flying', () => {
  const T = street();
  const car = T.world.vehicles.spawn('solari_recon_car', 0, v(7, 0, 3), 0);
  const under = T.fighter(1, 0, v(6, 0, -3), 'lancer'), near = T.fighter(2, 0, v(9, 0, 13), 'lancer'), clear = T.fighter(3, 0, v(-8, 0, 40), 'lancer');
  const thrown = [];
  const off = bus.on('move:ragdoll', (e) => { if (e.id === near.id) thrown.push(e); });
  T.st.bringDown(T.A, { dx: 1, dz: 0 });
  T.run(12);
  off();
  assert.ok(car.health.dead && (car.wreck || car.removed), 'the car: smashed');
  assert.ok(under.health.dead, 'the soldier under it: crushed');
  assert.ok(near.health.dead || thrown.length > 0 || near.health.hp < near.health.max, 'the one nearby: thrown, or hurt');
  assert.ok(!clear.health.dead, 'the one well clear of it: fine');
  assert.ok(T.st.stats.wrecked >= 1);
});

test('the same tower brought down the same way comes down the same: one pile', () => {
  const once = () => {
    const T = street();
    T.st.bringDown(T.A, { dx: 1, dz: 0 });
    T.run(12);
    return T.st.rigid.bodies.map((b) => [...b.x].map((x) => x.toFixed(6)).join(',')).join(';');
  };
  assert.equal(once(), once());
});

test('a city battle: some way in, a tall tower near the fighting comes down (with its warning)', () => {
  const DATA = {
    movement: H.movement, weaponFiles: [H.ballistic, H.energy], attachments: H.attachments, recoil: H.recoil, statuses: H.statuses,
    meleeWeapons: H.melee, kits: H.kits, classes: H.classes, damageMatrix: H.matrix, supers: H.supers, vehicleDefs: H.vehicles,
    personalities: H.ai.personalities, difficulty: H.ai.difficulty.veteran, down: H.down, barks: H.barks, stratagems: H.stratagems,
  };
  const S = new FrontlineSession(DATA, { size: '12v12', seed: 7, map: 'city' });
  S.step(1 / 60);
  const L = S.mode.cfg.timeLimit;
  assert.ok(S.towerFallAt >= L * 0.25 && S.towerFallAt <= L * 0.55, `some way in (${S.towerFallAt.toFixed(0)} s of ${L})`);
  const ev = [];
  const off = bus.on('structure:tower', (e) => ev.push(e));
  S.mode.time = S.towerFallAt;
  S.step(1 / 60);
  off();
  assert.equal(ev.length, 1, 'one comes down');
  const T = S.structures.towers[ev[0].tower];
  assert.ok(T.going && T.h >= 25, `a tall one (${T.h.toFixed(0)} m)`);
  S.dispose();
});
