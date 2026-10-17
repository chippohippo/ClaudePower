// Scale foundations: spatial indexes must give exactly the brute-force answers, terrain must
// carry movement, bullets and vehicles, and flow fields must route bots around cover.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { CoverIndex, rayBox } from '../src/world/CoverIndex.js';
import { EntityGrid } from '../src/world/EntityGrid.js';
import { Terrain, mulberry32 } from '../src/world/Terrain.js';
import { NavGrid } from '../src/world/NavGrid.js';
import { CombatWorld } from '../src/combat/CombatWorld.js';
import { MovementController, FlatGroundBody } from '../src/movement/MovementController.js';
import { data, DT, v } from './harness.mjs';

const rand = mulberry32(1234);
const R = (a, b) => a + (b - a) * rand();

function randomBoxes(n, span = 400) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = R(-span, span), z = R(-span / 2, span / 2), w = R(0.4, 6), d = R(0.4, 6), h = R(0.5, 4);
    out.push({ min: v(x, 0, z), max: v(x + w, h, z + d), destructible: rand() < 0.3 });
  }
  return out;
}
function bruteRay(boxes, o, d, max) {
  let best = null;
  for (const b of boxes) { const h = rayBox(o, d, b, max); if (h && (!best || h.t < best.t)) best = { t: h.t, b }; }
  return best;
}

test('CoverIndex: raycasts and rectangle queries match brute force exactly', () => {
  const boxes = randomBoxes(1500);
  const idx = new CoverIndex(boxes, { cell: 8 });
  assert.equal(idx.length, boxes.length);
  for (let i = 0; i < 2000; i++) {
    const o = v(R(-420, 420), R(0.2, 3), R(-220, 220));
    const d = v(R(-1, 1), R(-0.15, 0.1), R(-1, 1)).normalize();
    const a = idx.raycast(o, d, 150), b = bruteRay(boxes, o, d, 150);
    if (!b) { assert.equal(a, null); continue; }
    // Same distance; the box may differ only on exact ties (a ray starting inside overlapping boxes).
    assert.ok(a && Math.abs(a.distance - b.t) < 1e-6, `ray ${i}`);
    assert.ok(a.cover === b.b || Math.abs(rayBox(o, d, a.cover, 150).t - b.t) < 1e-6, `ray ${i} box`);
  }
  for (let i = 0; i < 300; i++) {
    const x = R(-400, 400), z = R(-200, 200), w = R(0, 30);
    const got = new Set(); idx.queryAABB(x, z, x + w, z + w, (b) => got.add(b));
    const want = boxes.filter((b) => b.max.x >= x && b.min.x <= x + w && b.max.z >= z && b.min.z <= z + w);
    assert.equal(got.size, want.length);
    for (const b of want) assert.ok(got.has(b));
  }
  // Removing a box removes it from every cell it touched.
  const victim = boxes[10];
  idx.remove(victim);
  let seen = false;
  idx.queryAABB(victim.min.x, victim.min.z, victim.max.x, victim.max.z, (b) => { if (b === victim) seen = true; });
  assert.ok(!seen && idx.length === boxes.length - 1);
});

test('EntityGrid: circle queries include every fighter in range', () => {
  const ents = Array.from({ length: 128 }, (_, i) => ({ id: i, movement: { state: { position: v(R(-500, 500), 0, R(-200, 200)) } } }));
  const g = new EntityGrid({ cell: 12 });
  g.rebuild(ents);
  for (let i = 0; i < 200; i++) {
    const p = v(R(-500, 500), 0, R(-200, 200)), r = R(1, 60);
    const got = new Set(); g.queryCircle(p.x, p.z, r, (e) => got.add(e));
    for (const e of ents) if (e.movement.state.position.distanceTo(p) <= r) assert.ok(got.has(e));
  }
});

test('Terrain: continuous heights, raycasts land on the surface, soldiers walk the hills', () => {
  const t = Terrain.generate({ seed: 3, minX: -100, minZ: -100, width: 200, depth: 200 });
  for (let i = 0; i < 200; i++) {
    const x = R(-90, 90), z = R(-90, 90);
    assert.ok(Math.abs(t.height(x, z) - t.height(x + 0.01, z)) < 0.05, 'continuous');
    assert.ok(t.normal(x, z).y > 0.5, 'normals point up');
  }
  for (let i = 0; i < 200; i++) {
    const o = v(R(-80, 80), 30, R(-80, 80)), d = v(R(-1, 1), R(-1, -0.2), R(-1, 1)).normalize();
    const hit = t.raycast(o, d, 300);
    if (!hit) continue;
    assert.ok(Math.abs(hit.point.y - t.height(hit.point.x, hit.point.z)) < 0.02, 'hit is on the surface');
  }
  // A jogging soldier stays glued to the ground over the hills.
  const start = v(-60, t.height(-60, 0), 0);
  const m = new MovementController(data.movement, new FlatGroundBody(start, [], { terrain: t }), {}, 1);
  m.state.position.copy(start);
  const cmd = { moveX: 0, moveY: 1, yaw: -Math.PI / 2, pitch: 0, buttons: {} };
  let worst = 0, airborne = 0;
  for (let i = 0; i < 1000; i++) {
    m.update(cmd, DT);
    const p = m.state.position;
    worst = Math.max(worst, Math.abs(p.y - t.height(p.x, p.z)));
    if (m.state.mode === 'air') airborne++;
  }
  assert.ok(m.state.position.x > 0, `walked across the hills (${m.state.position.x.toFixed(1)})`);
  assert.ok(worst < 0.25 && airborne < 30, `stays on the ground (worst gap ${worst.toFixed(2)} m, ${airborne} airborne ticks)`);
});

test('NavGrid: flow fields route around walls, stay out of enclosures, reopen when cover breaks', () => {
  // A long wall between A and B with a gap at its far end; a destructible plug fills the middle.
  const wall = [{ min: v(-2, 0, -80), max: v(2, 3, 20) }];
  const plug = { min: v(-2, 0, 20), max: v(2, 3, 26), destructible: true };
  const cover = new CoverIndex([...wall, plug, { min: v(-2, 0, 26), max: v(2, 3, 80) }]);
  const world = new CombatWorld({ cover });
  const nav = new NavGrid({ minX: -60, minZ: -70, width: 120, depth: 140, cell: 2 }, { cover });
  world.nav = nav;
  const f = nav.field('B', 30, 0, 3);
  assert.equal(nav.distance(f, -30, 0), Infinity, 'fully walled: unreachable');
  assert.equal(nav.sample(f, -30, 0, new Vector3()), false);
  // Blow the plug: the route opens through the gap.
  world.destroyCover(v(0, 1, 23), 2, null);
  assert.equal(nav.field('B', 30, 0, 3), f, 'the stale field stays usable (no rebuild hitch on a blast)');
  nav.maintain(Infinity);
  const f2 = nav.field('B', 30, 0, 3);
  assert.notEqual(f2, f, 'maintain() rebuilt it after the cover changed');
  const route = nav.trace(f2, -30, 0);
  assert.ok(route.reached, 'reaches the goal');
  assert.ok(route.pts.some((p) => p.z > 18 && p.z < 28 && Math.abs(p.x) < 3), 'through the breach');
  // Following the sampled directions walks there without touching the wall.
  const p = v(-30, 0, 0), dir = new Vector3();
  for (let i = 0; i < 2000 && nav.sample(f2, p.x, p.z, dir); i++) {
    p.addScaledVector(dir, 0.5);
    assert.ok(!nav.blocked(p.x, p.z), 'never inside blocked cells');
  }
  assert.ok(Math.hypot(p.x - 30, p.z) < 5, `arrived (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
});

test('NavGrid: a stale 1 km field is rebuilt in slices across ticks and matches a fresh solve', () => {
  // Frontline-sized grid (500 x 200 cells): one full search is far over a tick's nav budget.
  const cover = new CoverIndex(randomBoxes(400, 900));
  const nav = new NavGrid({ minX: -500, minZ: -200, width: 1000, depth: 400, cell: 2 }, { cover });
  const f = nav.field('pt', 300, 0, 6);
  nav.updateRegion(-10, -10, 10, 10); // as if cover broke: walkability version moves on
  assert.equal(nav.field('pt', 300, 0, 6), f, 'stale field keeps serving');
  let calls = 0;
  while (nav.field('pt', 300, 0, 6) === f && calls < 10000) { nav.maintain(4000); calls++; }
  const f2 = nav.field('pt', 300, 0, 6);
  assert.ok(calls > 1, `rebuild was split across ${calls} maintain() calls`);
  assert.equal(f2.version, nav.version, 'fresh after the rebuild');
  const ref = new NavGrid({ minX: -500, minZ: -200, width: 1000, depth: 400, cell: 2 }, { cover }).field('pt', 300, 0, 6);
  assert.deepEqual(f2.dist, ref.dist, 'a sliced solve equals an uninterrupted one');
});

test('CombatWorld with spatial indexes answers exactly like the brute-force world', () => {
  const boxes = randomBoxes(600, 200);
  const terrain = Terrain.generate({ seed: 9, minX: -250, minZ: -150, width: 500, depth: 300, amp: 4 });
  const mk = (cover, spatial) => {
    const w = new CombatWorld({ damageMatrix: data.matrix, cover, terrain, spatial });
    for (let i = 0; i < 128; i++) {
      const p = v(R(-200, 200), 0, R(-100, 100)); p.y = terrain.height(p.x, p.z);
      const m = new MovementController(data.movement, new FlatGroundBody(p, cover, { terrain }), {}, i + 1);
      m.state.position.copy(p);
      w.add({ id: i + 1, team: i % 2, movement: m, health: { dead: false } });
    }
    return w;
  };
  const seed = rand;
  const plain = mk(boxes, false), fast = mk(new CoverIndex(boxes), true);
  for (let i = 0; i < 128; i++) fast.entities[i].movement.state.position.copy(plain.entities[i].movement.state.position);
  fast.refreshSpatial();
  for (let i = 0; i < 1500; i++) {
    const e = plain.entities[i % 128];
    const o = e.movement.state.position.clone(); o.y += 1.5;
    const d = v(seed() - 0.5, (seed() - 0.6) * 0.3, seed() - 0.5).normalize();
    const a = plain.raycast(o, d, 120, e.id), b = fast.raycast(o, d, 120, e.id);
    assert.equal(!!a, !!b, `ray ${i} hit/miss`);
    if (a) { assert.ok(Math.abs(a.distance - b.distance) < 1e-4, `ray ${i} distance: plain ${a.distance} ${a.entity?.id} ${a.surface} ${!!a.cover} / fast ${b.distance} ${b.entity?.id} ${b.surface} ${!!b.cover} o ${o.toArray()} d ${d.toArray()}`); assert.equal(a.entity?.id, b.entity?.id); }
  }
  for (let i = 0; i < 100; i++) {
    const p = v(R(-200, 200), 0, R(-100, 100)), r = R(2, 30);
    assert.deepEqual(plain.entitiesInRadius(p, r).map((e) => e.id).sort(), fast.entitiesInRadius(p, r).map((e) => e.id).sort());
  }
  // fighters() is cached until membership changes.
  const f1 = fast.fighters();
  assert.equal(fast.fighters(), f1);
  fast.add({ id: 999, team: 0, movement: { state: { position: v(0, 0, 0) } }, health: { dead: false } });
  assert.notEqual(fast.fighters(), f1);
});

test('scale budget: 128 fighters and 2000 cover boxes', () => {
  const boxes = randomBoxes(2000, 500);
  const cover = new CoverIndex(boxes);
  const terrain = Terrain.generate({ seed: 2 });
  const w = new CombatWorld({ damageMatrix: data.matrix, cover, terrain });
  for (let i = 0; i < 128; i++) {
    const p = v(R(-480, 480), 0, R(-180, 180)); p.y = terrain.height(p.x, p.z);
    const m = new MovementController(data.movement, new FlatGroundBody(p, cover, { terrain }), {}, i + 1);
    m.state.position.copy(p);
    w.add({ id: i + 1, team: i % 2, movement: m, health: { dead: false } });
  }
  w.refreshSpatial();
  const t0 = performance.now();
  for (let i = 0; i < 5000; i++) {
    const e = w.entities[i % 128], o = e.movement.state.position.clone(); o.y += 1.5;
    w.raycast(o, v(R(-1, 1), R(-0.1, 0.05), R(-1, 1)).normalize(), 150, e.id);
  }
  const perRay = (performance.now() - t0) / 5000;
  const cmd = { moveX: 0.3, moveY: 1, yaw: 0, pitch: 0, buttons: {} };
  const t1 = performance.now();
  for (let k = 0; k < 60; k++) { for (const e of w.entities) e.movement.update(cmd, DT); w.refreshSpatial(); }
  const perTick = (performance.now() - t1) / 60;
  assert.ok(perRay < 0.05, `${(perRay * 1000).toFixed(1)} µs per full combat raycast`);
  assert.ok(perTick < 8, `${perTick.toFixed(2)} ms per tick to move 128 fighters over terrain and cover`);
});
