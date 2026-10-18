// Rigid bodies (src/physics/RigidWorld.js): what comes off a building falls, lands, stacks, swings on
// what still holds it, tears loose and smashes, the same way every time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { RigidWorld } from '../src/physics/RigidWorld.js';

const v = (x, y, z) => new Vector3(x, y, z);
const box = (x0, y0, z0, x1, y1, z1, meta = null) => ({ min: v(x0, y0, z0), max: v(x1, y1, z1), density: 2.4, meta });
const run = (W, secs) => { for (let i = 0; i < Math.round(secs * 60); i++) W.step(1 / 60); };
/** How far b is turned from how it started (degrees). */
const turned = (b) => (2 * Math.acos(Math.min(1, Math.abs(b.q[3]))) * 180) / Math.PI;
const listOf = (statics) => (x0, z0, x1, z1, cb) => { for (const s of statics) if (s.max.x >= x0 && s.min.x <= x1 && s.max.z >= z0 && s.min.z <= z1) cb(s); };

test('a box dropped on the ground lands flat where it fell and goes to sleep', () => {
  const W = new RigidWorld();
  const b = W.addBody([box(-0.5, 2, -0.5, 0.5, 3, 0.5)]);
  run(W, 3);
  assert.ok(b.asleep, 'at rest, asleep');
  assert.ok(Math.abs(b.x[1] - 0.5) < 0.01, `resting on the ground (centre at ${b.x[1].toFixed(3)})`);
  assert.ok(Math.hypot(b.x[0], b.x[2]) < 0.02 && turned(b) < 1, `no slide, no spin (${Math.hypot(b.x[0], b.x[2]).toFixed(3)} m, ${turned(b).toFixed(1)}°)`);
  assert.equal(W.awake.length, 0, 'nothing left to simulate');
});

test('boxes stay stacked, rest on a table, and a tumbling slab lands on a face', () => {
  const table = { min: v(4, 0, -2), max: v(8, 1, 2) };
  const W = new RigidWorld({ statics: listOf([table]) });
  const stack = [0, 1, 2].map((i) => W.addBody([box(-0.5 + i * 0.1, i, -0.5, 0.5 + i * 0.1, i + 1, 0.5)]));
  const onTable = W.addBody([box(5.5, 2, -0.5, 6.5, 2.5, 0.5)]);
  const slab = W.addBody([box(-6, 3, -1, -2, 3.3, 1)], { w: [1.2, 0.4, 2.5] });
  run(W, 5);
  stack.forEach((b, i) => assert.ok(Math.abs(b.x[1] - (i + 0.5)) < 0.02 && turned(b) < 2, `box ${i} of the stack where it was put (${b.x[1].toFixed(3)})`));
  assert.ok(Math.abs(onTable.x[1] - 1.25) < 0.01, `on the table (${onTable.x[1].toFixed(3)})`);
  const lie = [0.15, 1, 2].some((h) => Math.abs(slab.x[1] - h) < 0.03);
  assert.ok(slab.asleep && lie, `the slab lies on one of its faces (centre at ${slab.x[1].toFixed(3)})`);
  assert.ok(W.bodies.every((b) => b.aabb[1] > -0.01), 'nothing sank into the ground');
});

test('a floor let go on three sides tears along its top, swings down on its bottom corners and comes to rest on the floor below as a ramp', () => {
  const wall = { min: v(-3, 0, -2), max: v(0, 6, 2) }, below = { min: v(-3, 1.8, -2), max: v(6, 2, 2) };
  const W = new RigidWorld({ statics: listOf([wall, below]) });
  const slab = W.addBody([box(0, 5, -1, 4, 5.3, 1)], { ignore: [wall] });
  const weight = slab.m * 9.8;
  const joints = [[5, -1], [5, 1], [5.3, -1], [5.3, 1]].map(([y, z]) => W.joint(slab, v(0, y, z), null, { strength: 1.5 * weight, stretch: 0.02, normal: { x: 1, y: 0, z: 0 }, box: wall }));
  run(W, 0.1);
  assert.ok(joints.every((j) => !j.broken) && slab.x[1] < 5.14, 'it sags first (the joints stretch)');
  run(W, 0.4);
  assert.ok(joints[2].broken && joints[3].broken, 'then the top corners tear (bending pulls the top of the slab off the wall)');
  assert.ok(!joints[0].broken && !joints[1].broken, 'the bottom corners hold (pressed together)');
  run(W, 3);
  assert.ok(!joints[0].broken && !joints[1].broken, 'and hold it all the way down');
  assert.ok(slab.asleep, 'at rest');
  const ang = turned(slab);
  assert.ok(ang > 35 && ang < 60, `a ramp from the floor above to the one below (${ang.toFixed(0)}°)`);
  const low = slab.aabb[1];
  assert.ok(low > 1.95 && low < 2.15, `its far end on the floor below (${low.toFixed(2)})`);
  assert.equal(W.torn.length, 2);
});

test('a joint tears pulled apart or sheared, not pressed together; an overloaded one tires and goes', () => {
  {
    // A block hanging from the ceiling by one joint: pulled past its strength, it tears.
    const W = new RigidWorld();
    const b = W.addBody([box(-0.5, 4, -0.5, 0.5, 5, 0.5)]);
    const j = W.joint(b, v(0, 5, 0), null, { strength: b.m * 9.8 * 0.8, normal: { x: 0, y: -1, z: 0 } });
    run(W, 0.3);
    assert.ok(j.broken, 'pulled off the ceiling');
  }
  {
    // The same joint under a block standing on it (pressed together) holds for good.
    const W = new RigidWorld();
    const b = W.addBody([box(-0.5, 4, -0.5, 0.5, 5, 0.5)]);
    const j = W.joint(b, v(0, 4, 0), null, { strength: b.m * 9.8 * 0.8, normal: { x: 0, y: 1, z: 0 } });
    run(W, 3);
    assert.ok(!j.broken && b.asleep && Math.abs(b.x[1] - 4.5) < 0.05, `it holds the block up (${b.x[1].toFixed(2)})`);
  }
  {
    // Held at 70% of what it can take, it gets weaker until it goes.
    const W = new RigidWorld();
    const b = W.addBody([box(-0.5, 4, -0.5, 0.5, 5, 0.5)]);
    const j = W.joint(b, v(0, 5, 0), null, { strength: (b.m * 9.8) / 0.7, normal: { x: 0, y: -1, z: 0 } });
    run(W, 0.5);
    assert.ok(!j.broken, 'it holds at first');
    run(W, 6);
    assert.ok(j.broken, `it tires and tears (${j.S.toFixed(0)} of ${j.S0.toFixed(0)} kN left)`);
  }
});

test('a wall that hits the ground breaks into pieces that carry on as it was going; its joints go with the pieces holding them', () => {
  const W = new RigidWorld();
  // Four blocks fixed together into one wall, toppling over.
  const wall = W.addBody([0, 1, 2, 3].map((i) => box(-0.15, 1 + i, -1, 0.15, 2 + i, 1, { i })), { w: [0, 0, -1.5] });
  const anchor = W.joint(wall, v(0, 5, -1), null, { strength: 1e6 });
  for (let i = 0; i < 30; i++) W.step(1 / 60);
  const before = [...wall.v];
  const pieces = W.fracture(wall, [[wall.boxes[0], wall.boxes[1]], [wall.boxes[2]], [wall.boxes[3]]], { hit: (boxes) => boxes.some((k) => k.meta.i === 0) });
  assert.equal(pieces.length, 3);
  assert.ok(wall.removed && W.bodies.length === 3, 'the wall is its pieces now');
  const mass = pieces.reduce((a, p) => a + p.m, 0);
  assert.ok(Math.abs(mass - wall.m) < 1e-6, 'and they weigh what it did');
  const top = pieces.find((p) => p.boxes[0].meta.i === 3);
  assert.ok(top.joints.includes(anchor) && anchor.a === top, 'the joint at the top went with the top piece');
  assert.ok(Math.hypot(...top.v) > Math.hypot(...before) * 0.5, 'the pieces carry on moving');
  run(W, 4);
  assert.ok(pieces.every((p) => p.asleep || p.joints.length), 'and come to rest');
});

test('the same fall comes out the same every time, and a pile of a hundred costs about a millisecond a tick', () => {
  const play = () => {
    const W = new RigidWorld({ statics: listOf([{ min: v(-2, 0, -2), max: v(2, 0.8, 2) }]) });
    let s = 7;
    const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 100; i++) {
      const x = (r() - 0.5) * 8, z = (r() - 0.5) * 8, y = 1 + r() * 10;
      W.addBody([box(x, y, z, x + 0.5 + r() * 1.5, y + 0.3 + r() * 0.6, z + 0.5 + r() * 1.5)], { w: [r() - 0.5, r() - 0.5, r() - 0.5] });
    }
    W.step(1 / 60);   // (compiled)
    const t0 = performance.now();
    run(W, 3);
    const ms = (performance.now() - t0) / 180;
    run(W, 6);
    return { ms, poses: W.bodies.map((b) => [...b.x, ...b.q].map((a) => a.toFixed(6)).join(',')).sort().join('|'), awake: W.awake.length };
  };
  const a = play(), b = play();
  assert.equal(a.poses, b.poses, 'the same poses');
  assert.equal(b.awake, 0, 'all at rest');
  assert.ok(b.ms < 4, `a hundred falling and piling up: ${b.ms.toFixed(2)} ms a tick`);
});
