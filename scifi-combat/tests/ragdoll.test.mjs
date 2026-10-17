// Ragdoll: the body must stay a body (bones hold, knees and elbows bend one way, nothing sinks
// into the ground or through cover), come to rest where the physics puts it, behave the same on
// every machine, and be hit where it is drawn.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { Ragdoll, J } from '../src/physics/Ragdoll.js';
import { Terrain } from '../src/world/Terrain.js';
import { hitSpheres } from '../src/movement/Hitboxes.js';
import { ProceduralHumanoid } from '../src/anim/ProceduralHumanoid.js';
import { makeWorld, v } from './harness.mjs';

const MV = JSON.parse(readFileSync(new URL('../data/movement.json', import.meta.url)));
const RIG = JSON.parse(readFileSync(new URL('../data/animation/humanoid.json', import.meta.url)));
const R = MV.ragdoll;
const DT = 1 / 60;
const flat = { groundAt: () => 0, nearBoxes: () => [] };
const BONES = [[J.HIP_L, J.KNEE_L], [J.KNEE_L, J.ANKLE_L], [J.HIP_R, J.KNEE_R], [J.KNEE_R, J.ANKLE_R],
  [J.SHOULDER_L, J.ELBOW_L], [J.ELBOW_L, J.HAND_L], [J.SHOULDER_R, J.ELBOW_R], [J.ELBOW_R, J.HAND_R], [J.NECK, J.HEAD]];

function throwBody(pose, collider, imp, at, { root = v(0, 0, 0), yaw = 0, maxT = 6, each = null } = {}) {
  const rd = new Ragdoll(R);
  root.y = collider.groundAt(root.x, root.z);
  rd.init(pose, root, yaw, 1, null, collider);
  const st = R.poses.stand, rest = BONES.map(([a, b]) => Math.hypot(st[a][0] - st[b][0], st[a][1] - st[b][1], st[a][2] - st[b][2]));
  rd.applyImpulse(imp.x, imp.y, imp.z, at, R.blastFocus);
  const worst = { bone: 0, knee: 0, below: 0 };
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  let t = 0;
  while (!rd.asleep && t < maxT) {
    rd.step(DT, collider); t += DT;
    BONES.forEach(([p, q], k) => { worst.bone = Math.max(worst.bone, Math.abs(rd.get(p, a).distanceTo(rd.get(q, b)) - rest[k])); });
    const n = new Vector3(...rd.frames().pelvis.n);
    for (const [h, k, an] of [[J.HIP_L, J.KNEE_L, J.ANKLE_L], [J.HIP_R, J.KNEE_R, J.ANKLE_R]]) {
      rd.get(h, a); rd.get(k, b); rd.get(an, c);
      const e = c.clone().sub(a), s = Math.max(0, Math.min(1, b.clone().sub(a).dot(e) / e.lengthSq()));
      worst.knee = Math.min(worst.knee, b.clone().sub(a.clone().addScaledVector(e, s)).dot(n)); // < 0: hyperextended
    }
    for (let i = 0; i < 16; i++) { rd.get(i, a); assert.ok(Number.isFinite(a.x + a.y + a.z), 'finite'); worst.below = Math.max(worst.below, collider.groundAt(a.x, a.z) - (a.y - rd.r[i])); }
    each?.(rd);
  }
  return { rd, t, worst };
}

test('ragdoll: blasts from any side keep the body whole and it comes to rest', () => {
  const terrain = Terrain.generate({ seed: 4, minX: -60, minZ: -60, width: 120, depth: 120, amp: 8 });
  const hills = { groundAt: (x, z) => terrain.height(x, z), nearBoxes: () => [] };
  const cases = [
    ['stand', flat, v(0, 4.5, -10), v(0, 0, 1.5)], ['stand', flat, v(0, 4.5, 10), v(0, 0, -1.5)],
    ['stand', flat, v(9, 4, 0), v(-1.5, 0, 0)], ['crouch', flat, v(6, 3, 2), v(-1, 0, 0)],
    ['prone', flat, v(0, 5, 3), v(0, 0, -1)], ['supine', flat, v(1, 1, 0), null],
    ['stand', hills, v(7, 5, 3), v(9, 0, 5)], ['stand', flat, v(18, 9, 0), v(-1, 0.2, 0)],
  ];
  for (const [pose, col, imp, at] of cases) {
    const { rd, t, worst } = throwBody(pose, col, imp, at, { root: col === hills ? v(10, 0, 5) : v(0, 0, 0) });
    assert.ok(rd.asleep && t < 4, `${pose}: at rest after ${t.toFixed(2)} s`);
    assert.ok(worst.bone < 0.03, `${pose}: bones hold (worst stretch ${(worst.bone * 100).toFixed(1)} cm)`);
    assert.ok(worst.knee > -0.02, `${pose}: knees never bend backward (${(worst.knee * 100).toFixed(1)} cm)`);
    assert.ok(worst.below < 0.005, `${pose}: nothing sinks into the ground (${(worst.below * 100).toFixed(1)} cm)`);
  }
});

test('ragdoll: thrown from behind lands face down, from the front face up; bigger blasts throw further', () => {
  const back = throwBody('stand', flat, v(0, 4.5, -10), v(0, 0, 1.5)).rd;
  const front = throwBody('stand', flat, v(0, 4.5, 10), v(0, 0, -1.5)).rd;
  assert.equal(back.faceUp(), false);
  assert.equal(front.faceUp(), true);
  const small = throwBody('stand', flat, v(4, 2, 0), v(-1, 0, 0)).rd.get(J.PELVIS, new Vector3()).x;
  const big = throwBody('stand', flat, v(14, 6, 0), v(-1, 0, 0)).rd.get(J.PELVIS, new Vector3()).x;
  assert.ok(big > small + 3, `big blast ${big.toFixed(1)} m vs small ${small.toFixed(1)} m`);
});

test('ragdoll: bodies collide with cover (thrown into a wall, it stays on its side)', () => {
  const wall = { min: v(-3, 0, -2.2), max: v(3, 2.5, -1.8) };
  const col = { groundAt: () => 0, nearBoxes: () => [wall] };
  const { rd } = throwBody('stand', col, v(0, 2, -12), v(0, 0, 1), { each: (b) => {
    for (let i = 0; i < 16; i++) assert.ok(b.z[i] > wall.max.z - 0.01 || b.y[i] > wall.max.y - 0.01, 'never inside the wall');
  } });
  assert.ok(rd.get(J.PELVIS, new Vector3()).z > -1.8, 'came to rest in front of the wall');
});

test('ragdoll: deterministic, and a serialized body continues exactly', () => {
  const a = throwBody('stand', flat, v(7, 4, 3), v(-1, 0, 0), { maxT: 0.5 }).rd;
  const b = throwBody('stand', flat, v(7, 4, 3), v(-1, 0, 0), { maxT: 0.5 }).rd;
  assert.deepEqual([...a.x, ...a.y, ...a.z], [...b.x, ...b.y, ...b.z]);
  const c = new Ragdoll(R); c.restore(a.serialize());
  for (let i = 0; i < 30; i++) { a.step(DT, flat); c.step(DT, flat); }
  assert.deepEqual([...a.x, ...a.y, ...a.z], [...c.x, ...c.y, ...c.z]);
});

test("ragdoll poses are the rig's joints in each stance (start limp in the animated shape)", () => {
  const { fighter } = makeWorld();
  const order = ['pelvis', 'neck', 'head', ['hip', 0], ['hip', 1], ['knee', 0], ['knee', 1], ['ankle', 0], ['ankle', 1], ['shoulder', 0], ['shoulder', 1], ['elbow', 0], ['elbow', 1], ['hand', 0], ['hand', 1]];
  let id = 1;
  for (const [name, stance, supine] of [['stand', 'stand', false], ['crouch', 'crouch', false], ['prone', 'prone', false], ['supine', 'prone', true]]) {
    const f = fighter(id++, 0, v(0, 0, 0), 'lancer');
    Object.assign(f.movement.state, { stance, supine, bodyYaw: 0, yaw: 0, mode: 'ground' });
    f.mode = 'gun';
    const h = new ProceduralHumanoid(f, RIG, {});
    for (let i = 0; i < 120; i++) h.update(DT, f.movement.state.position, { yaw: 0, aimYaw: 0, aimPitch: 0, lod: 0, emit: false });
    order.forEach((k, i) => {
      const p = Array.isArray(k) ? h.j[k[0]][k[1]] : h.j[k];
      const [a, u, fw] = R.poses[name][i];
      const d = Math.hypot(p.x - a, p.y - u, -p.z - fw);
      assert.ok(d < 0.03, `${name} ${k}: template is ${(d * 100).toFixed(1)} cm off the rig`);
    });
  }
});

test('ragdoll hitboxes sit on the body, mid-air and at rest', () => {
  const { world, fighter, step } = makeWorld();
  const A = fighter(1, 0, v(0, 0, 0), 'lancer');
  A.movement.impulse(6, 5, 0, { cause: 'explosion', ragdoll: true });
  const rd = A.movement.ragdoll, head = new Vector3();
  for (let i = 0; i < 90; i++) {
    step();
    if (A.movement.state.mode !== 'ragdoll') break;
    const hs = hitSpheres(A);
    rd.get(J.HEAD, head);
    assert.ok(Math.hypot(hs[0].x - head.x, hs[0].y - head.y, hs[0].z - head.z) < 1e-9, 'head sphere on the head');
    // A shot straight down at the drawn head hits the head.
    const eye = v(head.x, head.y + 6, head.z), hit = world.raycast(eye, v(0, -1, 0), 10, 99);
    assert.equal(hit?.entity?.id, 1); assert.equal(hit.zone, 'head');
  }
});

test('blasts: limp inside 75% of the radius, shoved outside it; prone soldiers resist', () => {
  const { world, fighter, step } = makeWorld();
  const near = fighter(1, 0, v(2, 0, 0), 'lancer', { hp: 5000 });
  const edge = fighter(2, 0, v(0, 0, 4.5), 'lancer', { hp: 5000 });
  const proneFar = fighter(3, 0, v(-3, 0, 0), 'lancer', { hp: 5000 });
  const proneNear = fighter(4, 0, v(0, 0, -1.2), 'lancer', { hp: 5000 });
  for (const p of [proneFar, proneNear]) p.movement.state.stance = 'prone';
  step();
  world.explode(v(0, 0, 0), 5, { id: 'test', damage: { base: 10 }, knockback: 10, ammoType: 'explosive' }, { team: 1, ownerId: 99 });
  assert.equal(near.movement.state.mode, 'ragdoll', '2 m of 5: thrown');
  assert.notEqual(edge.movement.state.mode, 'ragdoll', '4.5 m of 5: shoved');
  assert.notEqual(proneFar.movement.state.mode, 'ragdoll', 'prone at 3 m: resists');
  assert.equal(proneNear.movement.state.mode, 'ragdoll', 'prone at 1.2 m: thrown');
});

test("critical hits throw you along the shot; small hits don't; kills collapse and the corpse rests until respawn", () => {
  const { fighter, step, seconds } = makeWorld();
  const shooter = fighter(9, 1, v(0, 0, 10), 'lancer');
  const A = fighter(1, 0, v(0, 0, 0), 'lancer', { hp: 100 });
  A.health.damage(20, { kind: 'gun', zone: 'body' }, shooter);
  step();
  assert.notEqual(A.movement.state.mode, 'ragdoll', '20% of the pool: a flinch, not a throw');
  A.health.damage(50, { kind: 'gun', zone: 'body', point: v(0, 1.2, 0) }, shooter);
  step();
  assert.equal(A.movement.state.mode, 'ragdoll', '50% of the pool in one hit: critical');
  seconds(0.4);
  assert.ok(A.movement.state.position.z < -0.4, `thrown away from the shooter (z ${A.movement.state.position.z.toFixed(2)})`);
  seconds(4);
  assert.equal(A.movement.state.mode, 'ground', 'got up');

  const B = fighter(2, 0, v(5, 0, 0), 'lancer', { hp: 100 });
  B.health.damage(150, { kind: 'gun', zone: 'head' }, shooter);
  assert.equal(B.movement.state.mode, 'ragdoll', 'killed: limp');
  for (let i = 0; i < 300 && !B.movement.ragdoll.asleep; i++) B.movement.simulateCorpse(DT);
  assert.ok(B.movement.ragdoll.asleep, 'the corpse comes to rest');
  assert.equal(B.movement.state.mode, 'ragdoll', 'and stays a corpse');
  B.movement.reset(v(20, 0, 0), 0);
  assert.equal(B.movement.state.mode, 'ground'); assert.equal(B.movement.state.stance, 'stand');
  assert.ok(hitSpheres(B)[0].y > 1.5, 'respawned standing');
});

test('later blasts throw the bodies already lying there', () => {
  const { world, fighter } = makeWorld();
  const shooter = fighter(9, 1, v(0, 0, 10), 'lancer');
  const B = fighter(2, 0, v(0, 0, 0), 'lancer', { hp: 100 });
  B.health.damage(150, { kind: 'gun' }, shooter);
  for (let i = 0; i < 300 && !B.movement.ragdoll.asleep; i++) B.movement.simulateCorpse(DT);
  const before = B.movement.state.position.clone();
  world.explode(before.clone().add(v(-1.5, 0, 0)), 5, { id: 'test', damage: { base: 10 }, knockback: 12, ammoType: 'explosive' }, { team: 1, ownerId: 9 });
  for (let i = 0; i < 120; i++) B.movement.simulateCorpse(DT);
  assert.ok(B.movement.state.position.x > before.x + 1, `the corpse was thrown (${(B.movement.state.position.x - before.x).toFixed(2)} m)`);
});
