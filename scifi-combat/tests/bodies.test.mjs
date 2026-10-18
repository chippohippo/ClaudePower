// Bodies (docs/MOVEMENT.md, "Bodies"): soldiers can't walk through each other. Head on they stop
// and slide round; side by side they stay a body's width apart, standing, crouched or prone; a
// sprint into a man shoves him off his feet; walking into someone lying down you step over him,
// slower; pressed into a teammate who won't move, you squeeze past instead of jamming for good.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Box3 } from 'three';
import { MovementController, FlatGroundBody } from '../src/movement/MovementController.js';
import { BodyContacts, closestSegSeg } from '../src/movement/BodyContacts.js';
import { bus } from '../src/core/EventBus.js';
import { data, DT } from './harness.mjs';

const T = data.movement, B = T.bodies;
const NO = { down: false, pressed: false, released: false };

/** A few soldiers on open ground (or among `boxes`), each with his own command, and the contacts between them. */
function scene(specs, boxes = []) {
  const men = specs.map((o, i) => {
    const pos = new Vector3(o.x, 0, o.z);
    const m = new MovementController(T, new FlatGroundBody(pos, boxes), o.mods ?? {}, i + 1);
    m.state.position.copy(pos);
    m.state.bodyYaw = m.state.yaw = o.yaw ?? 0;
    m.hooks.vital = () => 'alive';
    const f = { id: i + 1, team: o.team ?? 0, movement: m, health: { dead: false, downed: false } };
    f.cmd = { moveX: 0, moveY: 0, yaw: o.yaw ?? 0, pitch: 0, buttons: {} };
    f.hold = new Set(o.hold ?? []);
    return f;
  });
  const contacts = new BodyContacts(B);
  const prev = new Map(men.map((f) => [f.id, new Set()]));
  const tick = (corpses = []) => {
    for (const f of men) {
      const was = prev.get(f.id);
      for (const k of ['sprint', 'crouch', 'prone', 'jump']) f.cmd.buttons[k] = { down: f.hold.has(k), pressed: f.hold.has(k) && !was.has(k), released: !f.hold.has(k) && was.has(k) };
      prev.set(f.id, new Set(f.hold));
      f.movement.update(f.cmd, DT);
    }
    contacts.step(men, corpses, DT, (f, dx, dz) => f.movement.nudge(dx, dz));
  };
  const run = (s, corpses) => { for (let i = 0; i < Math.round(s / DT); i++) tick(corpses); };
  return { men, contacts, tick, run };
}
const at = (f) => f.movement.state.position;
const gap = (a, b) => Math.hypot(at(a).x - at(b).x, at(a).z - at(b).z);

test('segment geometry: the closest points between two capsules\' spines', () => {
  const o = {};
  closestSegSeg(0, 0, 2, 0, 1, 1, 1, 3, o);
  assert.ok(Math.abs(o.d2 - 1) < 1e-9 && Math.abs(o.x1 - 1) < 1e-9, 'a T: 1 m apart at the middle');
  closestSegSeg(0, 0, 0, 0, 3, 4, 3, 4, o);
  assert.ok(Math.abs(o.d2 - 25) < 1e-9, 'two points');
  closestSegSeg(0, 0, 4, 0, 1, -1, 3, 1, o);
  assert.ok(o.d2 < 1e-9, 'crossing');
});

test('head on, two men don\'t walk through each other: they stop a body apart, then slide round', () => {
  const S = scene([{ x: 0, z: 0, yaw: 0 }, { x: 0.05, z: -6, yaw: Math.PI }]);
  const [a, b] = S.men;
  a.cmd.moveY = 1; b.cmd.moveY = 1;   // both walk forward, at each other
  let closest = 9;
  for (let i = 0; i < 120; i++) { S.tick(); closest = Math.min(closest, gap(a, b)); }
  assert.ok(closest > 2 * B.radius.medium - 0.06, `never closer than a body apart (${closest.toFixed(2)} m)`);
  // Kept walking, they slide off each other and pass side by side, not through.
  S.run(3);
  assert.ok(at(a).z < -3 && at(b).z > -3, `past each other (${at(a).z.toFixed(1)}, ${at(b).z.toFixed(1)})`);
  assert.ok(Math.abs(at(a).x - at(b).x) > 2 * B.radius.medium - 0.06, 'round, not through');
});

test('shoulder to shoulder: men standing, crouched or prone in a line keep a body\'s width apart', () => {
  for (const [stance, min] of [[null, 2 * B.radius.medium], ['crouch', 2 * (B.radius.medium + B.crouchExtra)], ['prone', 2 * B.lying.radius]]) {
    // Five men squeezed into a 1.2 m line, all told to take the same spot.
    const S = scene([0, 0.3, 0.6, 0.9, 1.2].map((x) => ({ x, z: 0, hold: stance ? [stance] : [] })));
    S.run(stance === 'prone' ? 2.5 : 1.5);
    for (let i = 0; i < S.men.length; i++) for (let j = i + 1; j < S.men.length; j++) {
      const d = gap(S.men[i], S.men[j]);
      assert.ok(d > min - 0.05, `${stance ?? 'standing'}: ${i} and ${j} ${d.toFixed(2)} m apart (a body is ${min.toFixed(2)})`);
    }
    if (stance === 'prone') assert.ok(S.men.every((f) => f.movement.state.stance === 'prone'), 'all down');
  }
});

test('a sprint into a man is a bump: he stumbles with it, and you lose your run', () => {
  const S = scene([{ x: 0, z: 0, hold: ['sprint'] }, { x: 0, z: -9, yaw: Math.PI / 2 }]);
  const [runner, stood] = S.men;
  runner.cmd.moveY = 1;
  const bumps = [], staggers = [];
  const off = [bus.on('body:bump', (e) => bumps.push(e)), bus.on('move:stagger', (e) => staggers.push(e))];
  try {
    for (let i = 0; i < 150 && !bumps.length; i++) S.tick();
    assert.equal(bumps.length, 1, 'one bump');
    assert.ok(bumps[0].speed > B.bump.speed, `at ${bumps[0].speed.toFixed(1)} m/s`);
    S.run(0.1);
    assert.ok(staggers.some((e) => e.id === stood.id), 'the man stood there stumbles');
    assert.ok(runner.movement.state.speed < 5, `the runner's checked (${runner.movement.state.speed.toFixed(1)} m/s)`);
    S.run(1);
    assert.ok(gap(runner, stood) > 2 * B.radius.medium - 0.06, 'and still not through him');
  } finally { off.forEach((f) => f()); }
});

test('walking into someone lying down: you step over him (slower), you don\'t stop dead or walk on him', () => {
  // A man lying across the way, head to the side.
  const S = scene([{ x: 0, z: 0 }, { x: 0, z: -4, yaw: Math.PI / 2, hold: ['prone'] }]);
  const [walker, lying] = S.men;
  S.run(1.5);   // (he gets down)
  assert.equal(lying.movement.state.stance, 'prone');
  walker.cmd.moveY = 1;
  let over = 0, slow = Infinity;
  for (let i = 0; i < 200 && at(walker).z > -7; i++) {
    S.tick();
    if (walker.movement.state.overBody > 0) { over++; slow = Math.min(slow, walker.movement.state.speed); }
  }
  assert.ok(at(walker).z <= -7, `got past him (${at(walker).z.toFixed(1)})`);
  assert.ok(over > 5, `over him for ${over} ticks`);
  assert.ok(slow < T.speeds.jog * 0.95, `slower while over him (${slow.toFixed(1)} m/s)`);
  assert.ok(Math.hypot(at(lying).x, at(lying).z + 4) < 0.05, 'and he wasn\'t shoved about');
  // A corpse lying across the way: the same.
  const C = scene([{ x: 0, z: 0 }]);
  C.men[0].cmd.moveY = 1;
  const corpse = [{ id: 9, ax: -0.9, az: -4, bx: 0.8, bz: -4, y: 0 }];
  let overC = 0;
  for (let i = 0; i < 200 && at(C.men[0]).z > -7; i++) { C.tick(corpse); if (C.men[0].movement.state.overBody > 0) overC++; }
  assert.ok(at(C.men[0]).z <= -7 && overC > 5, 'stepped over the dead');
});

test('a narrow passage with a teammate standing in it: you squeeze past him, the trench never jams', () => {
  // A corridor 0.9 m wide (walls either side), a teammate standing in the middle of it.
  const walls = [new Box3(new Vector3(-3, 0, -12), new Vector3(-0.45, 2, 2)), new Box3(new Vector3(0.45, 0, -12), new Vector3(3, 2, 2))];
  const S = scene([{ x: 0, z: 0 }, { x: 0, z: -4, yaw: Math.PI }], walls);
  const [mover, stander] = S.men;
  mover.cmd.moveY = 1;
  const squeezes = [];
  const off = bus.on('body:squeeze', (e) => squeezes.push(e));
  try {
    let t = 0;
    while (at(mover).z > -7 && t < 8) { S.tick(); t += DT; }
    assert.ok(at(mover).z <= -7, `through in ${t.toFixed(1)} s (at ${at(mover).z.toFixed(1)})`);
    assert.ok(squeezes.length >= 1 && squeezes[0].id === mover.id, 'by squeezing past');
    assert.ok(Math.abs(at(stander).x) < 0.45 && Math.abs(at(stander).z + 4) < 1.2, 'the man he passed is where he was, more or less');
  } finally { off(); }
});

test('enemies don\'t squeeze through each other', () => {
  const walls = [new Box3(new Vector3(-3, 0, -12), new Vector3(-0.45, 2, 2)), new Box3(new Vector3(0.45, 0, -12), new Vector3(3, 2, 2))];
  const S = scene([{ x: 0, z: 0, team: 0 }, { x: 0, z: -4, yaw: Math.PI, team: 1, mods: { armor: 'heavy' } }], walls);
  const [a, b] = S.men;
  a.cmd.moveY = 1;
  S.run(5);
  assert.ok(at(a).z > at(b).z, 'still on his own side of him');
  assert.ok(gap(a, b) > (B.radius.medium + B.radius.heavy) - 0.06, 'a body apart');
});
