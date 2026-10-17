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
  assert.equal(nav.field('B', 30, 0, 3), f, 'the field keeps serving (no rebuild hitch on a blast)');
  nav.maintain(Infinity);
  const f2 = nav.field('B', 30, 0, 3);
  assert.ok(Number.isFinite(nav.distance(f2, -30, 0)), 'maintain() repaired it after the cover changed');
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

/** Same reachable cells and the same route lengths (to float rounding: a repair adds them up in another order). */
function sameField(a, b, msg) {
  let worst = 0, diff = 0;
  for (let i = 0; i < b.dist.length; i++) {
    const x = a.dist[i], y = b.dist[i];
    if (x === Infinity || y === Infinity) { if (x !== y) diff++; continue; }
    worst = Math.max(worst, Math.abs(x - y) / Math.max(1, y));
  }
  assert.equal(diff, 0, `${msg}: ${diff} cells reachable in one and not the other`);
  assert.ok(worst < 1e-4, `${msg}: route lengths differ by ${(worst * 100).toFixed(4)}%`);
}

test('NavGrid: a field repairs only what a change cut off, in slices, and matches a fresh solve', () => {
  // Frontline-sized grid (500 x 200 cells) with scattered cover.
  const cover = new CoverIndex(randomBoxes(400, 900));
  const grid = { minX: -500, minZ: -200, width: 1000, depth: 400, cell: 2 };
  const nav = new NavGrid(grid, { cover });
  const f = nav.field('pt', 300, 0, 6);
  const change = (b, add) => { if (add) cover.add(b); else cover.remove(b); nav.updateRegion(b.min.x, b.min.z, b.max.x, b.max.z); };
  // A wall goes up across the routes from the west, a tall box near the goal is blown away, and
  // sandbags (vaultable) are stacked on the goal itself.
  change({ min: v(100, 0, -15), max: v(104, 3, 15) }, true);
  change(cover.list.find((b) => b.max.y > 2 && b.min.x > 200 && b.min.x < 280 && Math.abs(b.min.z) < 150), false);
  change({ min: v(299, 0, -3), max: v(300, 0.8, 3) }, true);
  assert.equal(nav.field('pt', 300, 0, 6), f, 'keeps serving while it waits for repair');
  const work = nav.stats.cells;
  let calls = 0;
  while ((nav.job || nav.stale.size) && calls < 10000) { nav.maintain(4000); calls++; }
  const ref = new NavGrid(grid, { cover }).field('pt', 300, 0, 6);
  sameField(f, ref, 'repaired');
  assert.ok(nav.stats.repairs >= 1 && nav.stats.builds === 1, `repaired in place (${nav.stats.repairs} repairs, ${nav.stats.builds} builds)`);
  assert.ok(nav.stats.cells - work < 50000, `half the work of a rebuild or less (${nav.stats.cells - work} cells of 100k)`);
  // Following it from behind the wall reaches the goal, around it.
  const route = nav.trace(f, -100, 0);
  assert.ok(route.reached, 'reaches the goal');
  assert.ok(!route.pts.some((p) => p.x > 99 && p.x < 105 && Math.abs(p.z) < 15), 'around the wall');
});

test('NavGrid: repairs stay exact through many changes, built and blown, near and far', () => {
  const cover = new CoverIndex(randomBoxes(300, 400));
  const grid = { minX: -250, minZ: -120, width: 500, depth: 240, cell: 2 };
  const nav = new NavGrid(grid, { cover });
  const fs = [nav.field('a', 150, 0, 4), nav.field('b', -180, 60, 3), nav.field('c', 0, -100, 5)];
  const r = mulberry32(99), added = [];
  for (let round = 0; round < 40; round++) {
    // Up to three changes before the nav catches up (some land mid-repair).
    for (let k = 0; k < 1 + Math.floor(r() * 3); k++) {
      let b;
      if (added.length && r() < 0.4) { b = added.splice(Math.floor(r() * added.length), 1)[0]; cover.remove(b); }
      else {
        const x = -240 + r() * 480, z = -110 + r() * 220, w = 0.5 + r() * (r() < 0.2 ? 40 : 6), d = 0.5 + r() * 6;
        b = { min: v(x, 0, z), max: v(x + w, r() < 0.5 ? 0.8 : 2.5, z + d) };
        cover.add(b); added.push(b);
      }
      nav.updateRegion(b.min.x, b.min.z, b.max.x, b.max.z);
      nav.maintain(1500);
    }
    if (round % 8 !== 7) continue;
    for (let i = 0; i < 10000 && (nav.job || nav.stale.size); i++) nav.maintain(4000);
    const ref = new NavGrid(grid, { cover });
    sameField(fs[0], ref.field('a', 150, 0, 4), `round ${round}, field a`);
    sameField(fs[1], ref.field('b', -180, 60, 3), `round ${round}, field b`);
    sameField(fs[2], ref.field('c', 0, -100, 5), `round ${round}, field c`);
  }
});

test('NavGrid on a big map: fields build in the background, reach REACH metres, and only nearby changes touch them', () => {
  // 1000 x 200 cells (2 km x 400 m): a big map.
  const cover = new CoverIndex(randomBoxes(500, 1000));
  const grid = { minX: -1000, minZ: -200, width: 2000, depth: 400, cell: 2 };
  const nav = new NavGrid(grid, { cover });
  assert.ok(nav.big);
  assert.equal(nav.want('east', 700, 0, 6), null, 'not ready at once');
  let calls = 0;
  while (!nav.want('east', 700, 0, 6) && calls < 10000) { nav.maintain(4000); calls++; }
  const f = nav.want('east', 700, 0, 6);
  assert.ok(f && calls > 1, `built across ${calls} maintain() calls`);
  assert.ok(Number.isFinite(nav.distance(f, 300, 0)), 'reaches 400 m');
  assert.equal(nav.distance(f, -600, 0), Infinity, 'but not 1.3 km');
  const full = nav.field('full', 700, 0, 6, { reach: Infinity });
  assert.ok(Number.isFinite(nav.distance(full, -600, 0)), 'a field asked for with reach: Infinity covers the map');
  // Within its reach, a capped field is the full one.
  let same = 0, n = 0;
  for (let i = 0; i < f.dist.length; i++) if (f.dist[i] <= f.cap) { n++; if (f.dist[i] === full.dist[i]) same++; }
  assert.equal(same, n, 'same routes inside the reach');
  // A wall far beyond its reach doesn't touch it; one close by does.
  const before = nav.stats.repairs;
  const far = { min: v(-900, 0, -50), max: v(-896, 3, 50) };
  cover.add(far); nav.updateRegion(far.min.x, far.min.z, far.max.x, far.max.z);
  assert.equal(f.worse.length, 0, 'a wall 1.6 km away is none of its business');
  assert.ok(full.worse.length > 0, 'the full field cares');
  const near = { min: v(500, 0, -50), max: v(504, 3, 50) };
  cover.add(near); nav.updateRegion(near.min.x, near.min.z, near.max.x, near.max.z);
  assert.ok(f.worse.length > 0, 'one 200 m away is');
  for (let i = 0; i < 10000 && (nav.job || nav.stale.size); i++) nav.maintain(4000);
  assert.ok(nav.stats.repairs > before, 'repaired');
  const ref = new NavGrid(grid, { cover });
  sameField(full, ref.field('full', 700, 0, 6, { reach: Infinity }), 'the full field');
  const capped = ref.field('east', 700, 0, 6);
  for (let i = 0; i < f.dist.length; i++) if (capped.dist[i] <= f.cap) assert.ok(Math.abs(f.dist[i] - capped.dist[i]) < 1e-3 * Math.max(1, capped.dist[i]), 'the capped one, inside its reach');
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
