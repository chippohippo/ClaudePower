// Down but not out: 0 HP downs you (overkill still kills), you crawl and bleed out, a teammate's
// revive gets you up, the enemy can finish you, and only deaths cost tickets.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { bus } from '../src/core/EventBus.js';
import { J } from '../src/physics/Ragdoll.js';
import { hitSpheres } from '../src/movement/Hitboxes.js';
import { FrontlineSession } from '../src/game/FrontlineSession.js';
import { makeWorld, data, v } from './harness.mjs';

const D = data.down;
const events = (types) => { const got = []; const off = bus.on('*', (t, e) => types.includes(t) && got.push({ t, e })); return { got, off }; };
const restUntil = (step, pred, max = 600) => { for (let i = 0; i < max && !pred(); i++) step(); };

test('0 HP downs you instead of killing; overkill and big headshots still kill', () => {
  const { fighter } = makeWorld([], { down: true });
  const enemy = fighter(9, 1, v(0, 0, 20), 'lancer');
  const A = fighter(1, 0, v(0, 0, 0), 'lancer', { hp: 100 });
  const { got, off } = events(['entity:downed', 'entity:death']);
  const r = A.health.damage(120, { kind: 'gun' }, enemy);
  assert.equal(r.downed, true); assert.equal(A.health.downed, true); assert.equal(A.health.dead, false);
  assert.equal(A.health.hp, 0, 'at 0');
  const B = fighter(2, 0, v(4, 0, 0), 'lancer', { hp: 100 });
  assert.equal(B.health.damage(100 + D.overkill * 100 + 1, { kind: 'gun' }, enemy).killed, true, 'overkill: dead outright');
  const C = fighter(3, 0, v(8, 0, 0), 'lancer', { hp: 100 });
  assert.equal(C.health.damage(101, { kind: 'gun', zone: 'head' }, enemy).killed, true, 'a big headshot to 0: dead');
  const E = fighter(4, 0, v(12, 0, 0), 'lancer', { hp: 100 });
  E.health.hp = 30;
  assert.equal(E.health.damage(D.headshotKill * 100 - 10, { kind: 'gun', zone: 'head' }, enemy).downed, true, 'a rifle headshot to 0: downed');
  off();
  assert.deepEqual(got.map((g) => g.t), ['entity:downed', 'entity:death', 'entity:death', 'entity:downed']);
});

test('downed: no shooting, casting or sprinting, a slow crawl; finishing shots and bleeding out kill', () => {
  const { fighter, step, seconds, move, hold, aim } = makeWorld([], { down: true });
  const enemy = fighter(9, 1, v(0, 0, 30), 'lancer');
  const A = fighter(1, 0, v(0, 0, 0), 'lancer', { hp: 100 });
  A.health.damage(110, { kind: 'gun' }, enemy);
  restUntil(step, () => A.movement.state.downed);
  assert.equal(A.movement.state.downed, true, 'the body came to rest downed');
  assert.equal(A.movement.state.mode, 'ground'); assert.equal(A.movement.state.stance, 'prone');
  assert.equal(A.movement.canAct(), false); assert.equal(A.movement.state.weaponReady, false);
  const shots = A.weapons.current.mag;
  hold(A, 'light', 'sprint'); aim(A, 0); move(A, 0, 1);
  const p0 = A.movement.state.position.clone();
  seconds(2);
  assert.equal(A.weapons.current.mag, shots, 'no shots while downed');
  const crawled = A.movement.state.position.distanceTo(p0);
  assert.ok(crawled > 0.3 && crawled < 1.2, `a slow crawl (${crawled.toFixed(2)} m in 2 s)`);
  // Finishing: the downed pool, then dead, credited to the finisher.
  const { got, off } = events(['entity:death']);
  A.health.damage(D.downHp - 1, { kind: 'gun' }, enemy);
  assert.equal(A.health.dead, false);
  A.health.damage(5, { kind: 'gun' }, enemy);
  off();
  assert.equal(A.health.dead, true);
  assert.equal(got[0].e.how, 'finished'); assert.equal(got[0].e.by, 9);
  // Bleeding out: dead after bleedOut, credited to whoever downed them.
  const B = fighter(2, 0, v(6, 0, 0), 'lancer', { hp: 100 });
  B.health.damage(110, { kind: 'gun' }, enemy);
  const b = events(['entity:death']);
  seconds(D.bleedOut - 0.5);
  assert.equal(B.health.dead, false, 'still bleeding');
  seconds(1);
  b.off();
  assert.equal(B.health.dead, true);
  assert.equal(b.got[0].e.how, 'bledOut'); assert.equal(b.got[0].e.by, 9);
});

test('revive: hold interact beside them; the bleed pauses; medics are faster and bring more HP; letting go cancels', () => {
  const { fighter, step, seconds, hold, release } = makeWorld([], { down: true });
  const enemy = fighter(9, 1, v(0, 0, 40), 'lancer');
  const A = fighter(1, 0, v(0, 0, 0), 'lancer', { hp: 100 });
  const R = fighter(2, 0, v(1.2, 0, 0), 'lancer', { hp: 100 });
  A.health.damage(110, { kind: 'gun' }, enemy);
  restUntil(step, () => A.movement.state.downed);
  R.movement.reset(A.movement.state.position.clone().add(v(0.9, 0, 0)), 0);
  const bleed0 = A.health.bleed;
  hold(R, 'interact'); seconds(1.5);
  assert.equal(R.movement.state.stance === 'crouch' || R.movement.state.stanceT?.to === 'crouch', true, 'the reviver kneels');
  assert.ok(Math.abs(A.health.bleed - bleed0) < 0.05, 'no bleeding while being revived');
  release(R, 'interact'); step(2);
  assert.equal(A.health.downed, true, 'letting go cancels');
  seconds(1);
  assert.ok(A.health.bleed < bleed0 - 0.8, 'bleeding again');
  hold(R, 'interact'); seconds(D.reviveTime + 0.1);
  assert.equal(A.health.downed, false, 'revived');
  assert.ok(Math.abs(A.health.hp - 100 * D.reviveHp) < 1e-6, `back at ${A.health.hp} HP`);
  release(R, 'interact');
  seconds(1.5);
  assert.equal(A.movement.state.mode, 'ground'); assert.equal(A.movement.state.stance, 'stand', 'got up');
  // A medic: half the time, more HP.
  const B = fighter(3, 0, v(10, 0, 0), 'lancer', { hp: 100 });
  const M = fighter(4, 0, v(11, 0, 0), 'lancer', { hp: 100, role: 'medic' });
  B.health.damage(110, { kind: 'gun' }, enemy);
  restUntil(step, () => B.movement.state.downed);
  M.movement.reset(B.movement.state.position.clone().add(v(0.9, 0, 0)), 0);
  hold(M, 'interact'); seconds(D.medicReviveTime + 0.1);
  assert.equal(B.health.downed, false);
  assert.ok(Math.abs(B.health.hp - 100 * D.medicReviveHp) < 1e-6);
});

test('giving up: hold jump while downed to die now', () => {
  const { fighter, step, seconds, hold } = makeWorld([], { down: true });
  const enemy = fighter(9, 1, v(0, 0, 40), 'lancer');
  const A = fighter(1, 0, v(0, 0, 0), 'lancer', { hp: 100 });
  A.health.damage(110, { kind: 'gun' }, enemy);
  restUntil(step, () => A.movement.state.downed);
  const { got, off } = events(['entity:death']);
  hold(A, 'jump'); seconds(D.giveUpHold - 0.2);
  assert.equal(A.health.dead, false);
  seconds(0.4);
  off();
  assert.equal(A.health.dead, true); assert.equal(got[0].e.how, 'gaveUp'); assert.equal(got[0].e.by, 9, 'the downer gets the kill');
});

test('a blast that downs you throws you first; you end up downed at 0 with the body whole', () => {
  const { world, fighter, step } = makeWorld([], { down: true });
  fighter(9, 1, v(0, 0, 40), 'lancer');
  const A = fighter(1, 0, v(0, 0, 0), 'lancer', { hp: 100 });
  A.health.shield = 0;
  world.explode(v(-1.5, 0, 0), 6, { id: 'shell', damage: { base: 140 }, knockback: 12, ammoType: 'explosive' }, { team: 1, ownerId: 9 }); // ~116 at 1.5 m: down, not overkill
  assert.equal(A.health.downed, true, 'survived the blast: downed');
  assert.equal(A.movement.state.mode, 'ragdoll', 'and thrown');
  restUntil(step, () => A.movement.state.mode !== 'ragdoll');
  assert.ok(A.movement.state.position.x > 1, `thrown away from the blast (${A.movement.state.position.x.toFixed(2)} m)`);
  assert.equal(A.movement.state.downed, true); assert.equal(A.health.hp, 0);
  // Body intact: every bone the length it was (no limb loss).
  const rd = A.movement.ragdoll, a = new Vector3(), b = new Vector3();
  for (const [p, q, L] of [[J.HIP_L, J.KNEE_L, 0.45], [J.KNEE_R, J.ANKLE_R, 0.45], [J.SHOULDER_L, J.ELBOW_L, 0.29], [J.ELBOW_R, J.HAND_R, 0.28]]) {
    assert.ok(Math.abs(rd.get(p, a).distanceTo(rd.get(q, b)) - L) < 0.03, 'limbs attached');
  }
  assert.ok(hitSpheres(A)[0].y < 0.6, 'lying low: the head is near the ground');
});

test('bots: a downed teammate gets revived; downed bots alone give up', () => {
  const { bot, fighter, step, seconds } = makeWorld([], { down: true });
  const enemy = fighter(9, 1, v(60, 0, 60), 'lancer');
  const medic = bot(1, 0, v(0, 0, 0), 'lumen');
  const hurt = bot(2, 0, v(8, 0, 0), 'lancer');
  hurt.health.damage(hurt.health.max + hurt.health.maxShield + 10, { kind: 'gun' }, enemy);
  assert.equal(hurt.health.downed, true);
  seconds(12);
  assert.equal(hurt.health.downed, false, 'the medic came and got them up');
  assert.equal(hurt.health.dead, false);
  void medic;
  const lone = bot(3, 0, v(200, 0, 200), 'lancer');
  lone.health.damage(lone.health.max + lone.health.maxShield + 10, { kind: 'gun' }, enemy);
  seconds(6);
  assert.equal(lone.health.dead, true, 'nobody within reach: gave up to respawn');
  void step;
});

test('frontline: downs don’t cost tickets, deaths do; the downed don’t hold points', () => {
  const H = data;
  const s = new FrontlineSession({
    movement: H.movement, weaponFiles: [H.ballistic, H.energy], attachments: H.attachments, recoil: H.recoil, statuses: H.statuses,
    meleeWeapons: H.melee, kits: H.kits, classes: H.classes, damageMatrix: H.matrix, supers: H.supers, vehicleDefs: H.vehicles,
    personalities: H.ai.personalities, difficulty: H.ai.difficulty.veteran, down: H.down,
  }, { players: 8, seed: 2 });
  const f = s.fighters.find((x) => x.team === 0), foe = s.fighters.find((x) => x.team === 1);
  const t0 = s.mode.tickets[0];
  f.health.damage(f.health.max + f.health.maxShield + 5, { kind: 'gun' }, foe);
  assert.equal(f.health.downed, true);
  assert.equal(s.mode.tickets[0], t0, 'downed: no ticket');
  f.health.giveUp();
  assert.equal(s.mode.tickets[0], t0 - 1, 'dead: one ticket');
  // A downed soldier standing on a point doesn't count toward it.
  const g = s.fighters.filter((x) => x.team === 0)[1];
  const p = s.mode.points.find((q) => s.mode.capturable(q));
  g.movement.reset(p.pos.clone(), 0);
  g.health.damage(g.health.max + g.health.maxShield + 5, { kind: 'gun' }, foe);
  s.world.refreshSpatial();
  s.mode.update(1 / 60, s.fighters, s.world);
  assert.equal(s.mode.points[p.id].counts[0], 0);
  s.dispose();
});
