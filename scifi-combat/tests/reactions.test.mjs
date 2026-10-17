// Hit reactions and the ragdoll's muscles (Red Dead Redemption 2 / NaturalMotion Euphoria in
// spirit): a dying body folds at the knees instead of falling like a plank, a head shot is
// lights-out, a soldier going down alive breaks the fall with his hands and clutches the wound,
// one thrown alive flails. A hit that doesn't put you down rocks you (a stumble, the gun off
// target; a leg hit drops you onto that knee), one that does stumbles you first. Blasts that kill
// outright mangle. The downed crawl on their bellies or scoot on their backs facing the threat,
// and the revived get up injured (limping, slower, aim swaying) until a stim treats them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bus } from '../src/core/EventBus.js';
import { Ragdoll, J, local } from '../src/physics/Ragdoll.js';
import { RagdollDrive } from '../src/physics/RagdollDrive.js';
import { woundSite } from '../src/combat/HitReactions.js';
import { hitSpheres } from '../src/movement/Hitboxes.js';
import { makeWorld, data, v, DT } from './harness.mjs';

const MV = JSON.parse(readFileSync(new URL('../data/movement.json', import.meta.url)));
const R = MV.ragdoll, S = MV.stagger;
const flat = { groundAt: () => 0, nearBoxes: () => [] };
const events = (types) => { const got = []; const off = bus.on('*', (t, e) => types.includes(t) && got.push({ t, e })); return { got, off }; };
const restUntil = (step, pred, max = 900) => { for (let i = 0; i < max && !pred(); i++) step(); };

/** A standing body on flat ground (facing -Z) pushed at a point; what touched the ground when. */
function fall({ vital = 'dead', drive = true, imp = [0, 0, 0], at = null, wound = null, limp = false, secs = 3, each = null }) {
  const rd = new Ragdoll(R);
  if (drive) rd.drive = new RagdollDrive(R.drive);
  rd.init('stand', { x: 0, y: 0, z: 0 }, 0, 1, null, flat);
  rd.drive?.start(rd, { pose: local(R.poses.stand), vital, limp, wound });
  rd.applyImpulse(imp[0], imp[1], imp[2], at, at ? R.hitFocus : R.blastFocus);
  const o = { rd, knee: null, hands: null, head: null, chestAtHands: null, t: 0, trace: [] };
  const touch = (i) => rd.y[i] - rd.r[i] < 0.03;
  while (o.t < secs && !rd.asleep) {
    rd.step(DT, flat); o.t += DT;
    if (o.knee === null && (touch(J.KNEE_L) || touch(J.KNEE_R))) o.knee = o.t;
    if (o.hands === null && (touch(J.HAND_L) || touch(J.HAND_R))) { o.hands = o.t; o.chestAtHands = rd.y[J.CHEST]; }
    if (o.head === null && touch(J.HEAD)) o.head = o.t;
    o.trace.push([...rd.x, ...rd.y, ...rd.z]);
    each?.(rd, o.t);
  }
  return o;
}
const CHEST = { x: 0, y: 1.28, z: -0.15 }, BACK = { x: 0, y: 1.2, z: 0.15 };

test('dying: the muscles hold for a moment and let go legs first, so the body folds at the knees and drops', () => {
  const plank = fall({ drive: false, imp: [0, 0.2, 1.6], at: CHEST });
  const fold = fall({ imp: [0, 0.2, 1.6], at: CHEST, wound: { ...CHEST, site: 'chest' } });
  assert.ok(fold.knee < fold.head - 0.15, `the knees go down first (knees ${fold.knee.toFixed(2)} s, head ${fold.head.toFixed(2)} s)`);
  assert.ok(fold.knee < plank.knee, `sooner than a limp body's (${fold.knee.toFixed(2)} vs ${plank.knee.toFixed(2)} s)`);
  assert.ok(fold.head > plank.head + 0.15, `and the head comes down later, folded, not swung down like a plank (${fold.head.toFixed(2)} vs ${plank.head.toFixed(2)} s)`);
  assert.ok(fold.rd.asleep && fold.t < 2.5, `at rest in ${fold.t.toFixed(2)} s`);
  // Lights out: a killing head shot has no muscle at all (the body falls exactly as a limp one).
  const out = fall({ imp: [0, 0.3, 2.4], at: { x: 0, y: 1.65, z: -0.1 }, limp: true });
  const limp = fall({ drive: false, imp: [0, 0.3, 2.4], at: { x: 0, y: 1.65, z: -0.1 } });
  assert.deepEqual(out.trace.at(-1), limp.trace.at(-1), 'lights out = limp');
});

test('going down alive: a hand goes to the wound, then both reach for the ground ahead and break the fall', () => {
  const hit = { vital: 'downed', imp: [0, 0.2, -1.4], at: BACK };
  const caught = fall({ ...hit, wound: { x: 0.1, y: 1.0, z: -0.14, site: 'gut' } });
  const dead = fall({ ...hit, vital: 'dead' });
  assert.ok(caught.hands < caught.head - 0.04, `hands down before the head (${caught.hands.toFixed(2)} vs ${caught.head.toFixed(2)} s)`);
  assert.ok(caught.chestAtHands > dead.chestAtHands + 0.1, `the arms take the chest's weight (chest at ${caught.chestAtHands.toFixed(2)} m when the hands land, a dead body's at ${dead.chestAtHands.toFixed(2)} m)`);
  // Hit in the chest: the hand on that side goes to the wound at once (then to the ground).
  const W = { x: 0.1, y: 1.28, z: -0.15 };
  let best = 9;
  fall({ vital: 'downed', imp: [0, 0.2, 1.4], at: W, wound: { ...W, site: 'chest' }, each: (rd, t) => {
    if (t > 0.3 || !rd.drive.wound) return;
    const { chest } = rd.frames(), [lr, lu, lf] = rd.drive.wound.local;
    const wx = rd.x[J.CHEST] + chest.r[0] * lr + chest.d[0] * lu + chest.n[0] * lf, wy = rd.y[J.CHEST] + chest.r[1] * lr + chest.d[1] * lu + chest.n[1] * lf, wz = rd.z[J.CHEST] + chest.r[2] * lr + chest.d[2] * lu + chest.n[2] * lf;
    best = Math.min(best, Math.hypot(rd.x[J.HAND_R] - wx, rd.y[J.HAND_R] - wy, rd.z[J.HAND_R] - wz));
  } });
  assert.ok(best < 0.12, `a hand to the wound (${best.toFixed(2)} m off it)`);
});

test('thrown alive, the arms windmill and the legs pedal in the air; a dead body just tumbles', () => {
  const spin = (vital) => {
    let turn = 0, last = null;
    fall({ vital, imp: [0, 5, -7], at: { x: 0, y: 0.1, z: 0.8 }, each: (rd) => {
      if (rd.grounded) return;
      const { chest } = rd.frames(), dx = rd.x[J.HAND_L] - rd.x[J.SHOULDER_L], dy = rd.y[J.HAND_L] - rd.y[J.SHOULDER_L], dz = rd.z[J.HAND_L] - rd.z[J.SHOULDER_L];
      const a = Math.atan2(dx * chest.n[0] + dy * chest.n[1] + dz * chest.n[2], dx * chest.d[0] + dy * chest.d[1] + dz * chest.d[2]);
      if (last !== null) turn += Math.abs(Math.atan2(Math.sin(a - last), Math.cos(a - last)));
      last = a;
    } });
    return turn;
  };
  const alive = spin('alive'), dead = spin('dead');
  assert.ok(alive > 3 && alive > dead * 1.6, `the arm swings round the shoulder (${alive.toFixed(1)} rad in the air, a dead body's ${dead.toFixed(1)})`);
});

test('muscled bodies are deterministic, and a snapshot continues exactly', () => {
  const make = () => { const rd = new Ragdoll(R); rd.drive = new RagdollDrive(R.drive); rd.init('stand', { x: 0, y: 0, z: 0 }, 0.4, 1, null, flat); rd.drive.start(rd, { pose: local(R.poses.stand), vital: 'downed', wound: { x: 0.1, y: 1.1, z: -0.1, site: 'gut' } }); rd.applyImpulse(0.6, 0.3, -1.2, BACK, R.hitFocus); return rd; };
  const a = make(), b = make();
  for (let i = 0; i < 40; i++) { a.step(DT, flat); b.step(DT, flat); }
  const snap = JSON.parse(JSON.stringify(a.serialize()));
  const c = new Ragdoll(R); c.drive = new RagdollDrive(R.drive); c.restore(snap);
  for (let i = 0; i < 50; i++) { a.step(DT, flat); b.step(DT, flat); c.step(DT, flat); }
  assert.deepEqual([...a.x, ...a.y, ...a.z], [...b.x, ...b.y, ...b.z], 'same inputs, same body');
  assert.deepEqual([...c.x, ...c.y, ...c.z], [...a.x, ...a.y, ...a.z], 'restored mid-fall, it carries on exactly');
});

test('where a hit lands: head, chest, an arm, the gut, a leg (by side)', () => {
  const { fighter } = makeWorld([], { down: true });
  const A = fighter(1, 0, v(0, 0, 0), 'lancer');
  A.movement.state.bodyYaw = 0;   // facing -Z: right is +X
  assert.equal(woundSite(A, { zone: 'head', part: 0 }), 'head');
  assert.equal(woundSite(A, { zone: 'body', part: 1, point: v(0.05, 1.3, -0.25) }), 'chest');
  assert.equal(woundSite(A, { zone: 'body', part: 1, point: v(-0.27, 1.3, 0) }), 'armL');
  assert.equal(woundSite(A, { zone: 'body', part: 1, point: v(0.28, 1.25, 0.05) }), 'armR');
  assert.equal(woundSite(A, { zone: 'body', part: 2, point: v(0.1, 1.0, -0.2) }), 'gut');
  assert.equal(woundSite(A, { zone: 'limb', part: 3, point: v(-0.1, 0.5, 0) }), 'legL');
  assert.equal(woundSite(A, { zone: 'limb', part: 3, point: v(0.12, 0.4, 0) }), 'legR');
  // Health books each hit there.
  A.health.damage(10, { kind: 'gun', zone: 'limb', part: 3, point: v(-0.1, 0.5, 0) }, null);
  A.health.damage(10, { kind: 'gun', zone: 'body', part: 2, point: v(0.1, 1.0, -0.2) }, null);
  assert.ok(A.health.wounds.legL > 0 && A.health.wounds.gut > 0 && A.health.lastSite === 'gut');
});

test('rocked: a hit taking a fifth of you stumbles you along it, the gun off target; hit again before you find your feet, you go over', () => {
  const { fighter, step, seconds } = makeWorld([], { down: true });
  const shooter = fighter(9, 1, v(0, 0, 10), 'lancer');
  const A = fighter(1, 0, v(0, 0, 0), 'lancer', { hp: 100 });
  const ev = events(['move:stagger', 'move:staggerEnd']);
  A.health.damage(25, { kind: 'gun', zone: 'body', part: 1, point: v(0, 1.25, 0.15) }, shooter);
  step();
  assert.equal(A.movement.state.mode, 'stagger', 'stumbling');
  assert.equal(A.movement.state.weaponReady, false, 'the gun off target');
  seconds(0.35);
  assert.ok(A.movement.state.position.z < -0.3, `pushed along the shot (${A.movement.state.position.z.toFixed(2)} m)`);
  seconds(0.6);
  ev.off();
  assert.equal(A.movement.state.mode, 'ground', 'found his feet');
  assert.ok(ev.got.some((g) => g.t === 'move:staggerEnd' && g.e.id === 1));
  step(3);
  assert.equal(A.movement.state.weaponReady, true, 'and the gun back up');
  // Twice in a row: over he goes.
  const B = fighter(2, 0, v(6, 0, 0), 'lancer', { hp: 200 });
  B.health.damage(80, { kind: 'gun', zone: 'body', part: 1, point: v(6, 1.25, 0.15) }, shooter);
  step(4);
  assert.equal(B.movement.state.mode, 'stagger');
  B.health.damage(80, { kind: 'gun', zone: 'body', part: 1, point: v(6, 1.25, -0.1) }, shooter);
  assert.equal(B.movement.state.mode, 'ragdoll', 'knocked over');
  // A small hit does nothing of the sort.
  const C = fighter(3, 0, v(-6, 0, 0), 'lancer', { hp: 100 });
  C.health.damage(8, { kind: 'gun', zone: 'body', part: 1, point: v(-6, 1.25, 0.15) }, shooter);
  step();
  assert.equal(C.movement.state.mode, 'ground', 'a graze: no stumble');
});

test('a leg hit drops you onto that knee for a moment (lower to hit), then you are up', () => {
  const { fighter, step, seconds } = makeWorld([], { down: true });
  const shooter = fighter(9, 1, v(0, 0, 10), 'lancer');
  const A = fighter(1, 0, v(0, 0, 0), 'lancer', { hp: 100 });
  A.movement.state.bodyYaw = 0;
  const head0 = hitSpheres(A)[0].y;
  A.health.damage(18, { kind: 'gun', zone: 'limb', part: 3, point: v(-0.1, 0.5, 0.05) }, shooter);
  step();
  const g = A.movement.state.stagger;
  assert.equal(g?.kind, 'buckle'); assert.equal(g.side, -1, 'the left knee');
  assert.ok(hitSpheres(A)[0].y < head0 - 0.3, 'down on a knee: the head is lower');
  seconds(S.time[1] + 0.2);
  assert.equal(A.movement.state.mode, 'ground'); assert.ok(Math.abs(hitSpheres(A)[0].y - head0) < 0.05, 'back up');
});

test('killed by a hit that does not throw: a stumble along it, then the knees go and the corpse comes to rest', () => {
  const { fighter, step } = makeWorld([], { down: true });
  const shooter = fighter(9, 1, v(0, 0, 10), 'lancer');
  const A = fighter(1, 0, v(0, 0, 0), 'lancer', { hp: 100 });
  A.health.hp = 30;
  const p0 = A.movement.state.position.clone();
  A.health.damage(40, { kind: 'gun', zone: 'body', part: 1, point: v(0.05, 1.25, 0.15), noDown: true }, shooter);
  assert.equal(A.health.dead, true);
  assert.equal(A.movement.state.mode, 'stagger', 'still on his feet a moment');
  let fellAt = null, t = 0;
  for (let i = 0; i < 400 && !(A.movement.state.mode === 'ragdoll' && A.movement.ragdoll.asleep); i++) {
    step(); t += DT;
    if (fellAt === null && A.movement.state.mode === 'ragdoll') fellAt = { t, z: A.movement.state.position.z };
  }
  assert.ok(fellAt && fellAt.t <= S.die.time[1] + 0.05, `the knees go after ${fellAt?.t.toFixed(2)} s`);
  assert.ok(p0.z - fellAt.z > 0.2, `a step or two along the shot first (${(p0.z - fellAt.z).toFixed(2)} m)`);
  assert.ok(A.movement.ragdoll.asleep, 'the corpse at rest');
  assert.equal(A.movement.ragdoll.drive.phase, 'dead');
});

test('downed by a hit: stumble, catch the fall, then the crawl; a mangling blast is dead and limp at once', () => {
  const { world, fighter, step } = makeWorld([], { down: true });
  const shooter = fighter(9, 1, v(0, 0, 12), 'lancer');
  const A = fighter(1, 0, v(0, 0, 0), 'lancer', { hp: 100 });
  const ev = events(['move:stagger', 'move:ragdoll', 'move:ragdollRest']);
  A.health.hp = 15;   // (a big hit would be a critical: thrown, no stumble)
  A.health.damage(25, { kind: 'gun', zone: 'body', part: 2, point: v(0.1, 1.0, 0.1) }, shooter);
  assert.equal(A.health.downed, true);
  restUntil(step, () => A.movement.state.downed);
  ev.off();
  const mine = ev.got.filter((g) => g.e.id === 1).map((g) => g.t);
  assert.deepEqual(mine, ['move:stagger', 'move:ragdoll', 'move:ragdollRest'], 'stumble, fall, rest');
  assert.ok(ev.got.find((g) => g.t === 'move:stagger').e.falling, 'a stumble that ends in a fall');
  assert.equal(A.movement.state.mode, 'ground'); assert.equal(A.movement.state.stance, 'prone');
  // A blast that kills outright: mangled, limp, no getting up from it.
  const B = fighter(2, 0, v(8, 0, 0), 'lancer', { hp: 100 });
  const d = events(['entity:death']);
  world.explode(v(8, 0, 0.3), 5, { id: 'test', damage: { base: 400 }, knockback: 12, ammoType: 'explosive' }, { team: 1, ownerId: 9 });
  d.off();
  assert.equal(B.health.dead, true);
  assert.equal(d.got.find((g) => g.e.id === 2)?.e.how, 'mangled');
  assert.equal(B.movement.state.mode, 'ragdoll'); assert.equal(B.movement.ragdoll.drive.limp, true, 'lights out');
});

test('downed: push toward where you look and you crawl on your belly; pull back and you roll over and scoot away on your back, facing it', () => {
  const { fighter, step, seconds, aim, move } = makeWorld([], { down: true });
  const enemy = fighter(9, 1, v(0, 0, -30), 'lancer');
  const A = fighter(1, 0, v(0, 0, 0), 'lancer', { hp: 100 });
  A.health.damage(110, { kind: 'gun' }, enemy);
  restUntil(step, () => A.movement.state.downed);
  const D = MV.downed;
  aim(A, 0);                          // looking toward -Z (the enemy)
  move(A, 0, -1);                     // pull back
  seconds(D.rollTime + 0.1);
  const s = A.movement.state;
  assert.equal(s.supine, true, 'on his back');
  assert.ok(Math.abs(Math.atan2(Math.sin(s.bodyYaw), Math.cos(s.bodyYaw))) < 0.15, `feet toward where he looks (bodyYaw ${s.bodyYaw.toFixed(2)})`);
  const z0 = s.position.z;
  seconds(2);
  const back = s.position.z - z0;
  assert.ok(back > 0.3 && back < 2 * D.crawlSpeed * D.supineMul + 0.1, `scooting away from it (${back.toFixed(2)} m in 2 s)`);
  move(A, 0, 1);                      // push toward it again
  seconds(D.rollTime + 0.1);
  assert.equal(s.supine, false, 'rolled onto his belly');
  const z1 = s.position.z;
  seconds(2);
  assert.ok(z1 - s.position.z > 0.4, `crawling toward where he looks (${(z1 - s.position.z).toFixed(2)} m)`);
});

test('revived injured: a limp (slower, no sprint), the aim wandering, until a stim treats it', () => {
  const { fighter, step, seconds, hold, release, aim, aimAt, move, press } = makeWorld([], { down: true });
  const enemy = fighter(9, 1, v(0, 0, 40), 'lancer');
  const A = fighter(1, 0, v(0, 0, 0), 'lancer', { hp: 100 });
  const Rv = fighter(2, 0, v(1.2, 0, 0), 'lancer', { hp: 100 });
  A.health.damage(110, { kind: 'gun', zone: 'limb', part: 3, point: v(0.1, 0.5, 0.05) }, enemy);
  restUntil(step, () => A.movement.state.downed);
  Rv.movement.reset(A.movement.state.position.clone().add(v(0.9, 0, 0)), 0);
  hold(Rv, 'interact'); seconds(data.down.reviveTime + 0.1); release(Rv, 'interact');
  assert.equal(A.health.downed, false, 'revived');
  assert.deepEqual(A.health.injury, { site: 'legR' }, 'hurt where it put him down');
  assert.equal(A.status.has('injured'), true);
  seconds(1.5);
  aim(A, 0); move(A, 0, 1); hold(A, 'sprint');
  seconds(2.5);
  const s = A.movement.state;
  assert.equal(s.sprinting, false, 'no sprinting on that leg');
  const jog = MV.speeds.jog;
  assert.ok(s.speed < jog * 0.85 && s.speed > jog * 0.5, `limping along at ${s.speed.toFixed(2)} m/s (jog ${jog})`);
  // A medic's stim: patched up, the limp gone (and he'd stim a hurt man at full health too).
  release(A, 'sprint'); move(A, 0, 0); step(30);
  A.health.hp = A.health.max;
  const M = fighter(3, 0, A.movement.state.position.clone().add(v(0, 0, 1.4)), 'mender', { role: 'medic' });
  aimAt(M, A.movement.state.position.clone().setY(1.2)); step(2);
  press(M, 'item'); step(2);
  assert.equal(A.health.injury, null, 'treated');
  assert.equal(A.status.has('injured'), false);
});
