// Bots and things coming down: a route that rubble has landed across is planned again at once (not
// walked into until stuck); soldiers get out from under a building that has started to fall.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoverIndex } from '../src/world/CoverIndex.js';
import { NavGrid } from '../src/world/NavGrid.js';
import { buildHouse } from '../src/game/frontline/Houses.js';
import { StructureSystem } from '../src/world/Structures.js';
import { makeWorld, v } from './harness.mjs';

const wall = (x0, z0, x1, z1, h) => ({ min: v(x0, 0, z0), max: v(x1, h, z1), kind: 'rubble', surface: 'concrete' });

test('nav: a route is cut by what has been blocked across it since it was planned, not by low rubble or by changes elsewhere', () => {
  const cover = new CoverIndex([], { cell: 8 });
  const nav = new NavGrid({ minX: -60, minZ: -60, width: 120, depth: 120, cell: 2 }, { cover });
  const route = nav.path(0, 40, 0, -40), at = nav.cutN;
  assert.ok(route.reached && route.pts.every((x, i) => i % 2 || Math.abs(x) < 1.5), 'open ground: straight down the street');
  const add = (b) => { cover.add(b); nav.updateRegion(b.min.x, b.min.z, b.max.x, b.max.z); };
  add(wall(20, -5, 30, 5, 3));
  assert.ok(!nav.cut(route.pts, 0, 0, 40, at), 'a wall off to the side: the route stands');
  add(wall(-6, 0, 6, 1, 0.8));
  assert.ok(!nav.cut(route.pts, 0, 0, 40, at), 'rubble low enough to climb over: still a way through');
  add(wall(-14, 0, 14, 2, 3));
  assert.ok(nav.cut(route.pts, 0, 0, 40, at), 'a wall come down across it: cut');
  assert.ok(!nav.cut(route.pts, 0, 0, -30, at), 'not for a walker already past it');
  assert.ok(!nav.cut(route.pts, 0, 0, 40, nav.cutN), 'and only what changed since the route was planned');
});

test('a bot walking a route plans a new one the moment a wall comes down across it, and walks round', () => {
  const cover = new CoverIndex([], { cell: 8 });
  const W = makeWorld(cover);
  W.world.nav = new NavGrid({ minX: -60, minZ: -60, width: 120, depth: 120, cell: 2 }, { cover });
  const b = W.bot(1, 0, v(0, 0, 40), 'lancer');
  const brain = W.brainOf(b);
  brain.order = { kind: 'move', pos: v(0, 0, -40), arrive: 1.5 };
  W.seconds(1.5);
  const p = b.movement.state.position;
  assert.ok(p.z < 36 && brain.route, `on the way (${p.z.toFixed(1)})`);
  // A wall drops across the street ahead (rubble from a house front, say).
  const block = wall(-14, 2, 14, 4, 3);
  cover.add(block); W.world.nav.updateRegion(block.min.x, block.min.z, block.max.x, block.max.z);
  const before = brain.route, t0 = brain.time;
  W.step(2);
  assert.ok(brain.route !== before && brain.route.at >= t0, 'a new route at once');
  assert.ok(brain.route.pts.some((x, i) => i % 2 === 0 && Math.abs(x) > 13), 'round the end of the wall');
  let inside = false, closest = Infinity;
  for (let i = 0; i < 60 * 25 && Math.hypot(p.x, p.z + 40) > 2; i++) {
    W.step();
    if (p.x > block.min.x && p.x < block.max.x && p.z > block.min.z && p.z < block.max.z) inside = true;
    closest = Math.min(closest, Math.hypot(p.x, p.z + 40));
  }
  assert.ok(!inside, 'never into the wall');
  assert.ok(closest < 2.5, `and gets there (${closest.toFixed(1)} m off)`);
  assert.ok(brain.stuck.level < 2, 'without getting stuck on it first');
});

/** A three-storey house on a sidewalk slab at the origin (16 x 11 m), as in the structures tests. */
function town() {
  let s = 99;
  const rand = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const boxes = [];
  const b = { rand, R: (a, c) => a + (c - a) * rand(), boxRect: (x0, z0, x1, z1, h, o) => { const bx = { min: v(x0, o.bottom ?? 0, z0), max: v(x1, o.top ?? h, z1), kind: o.kind, surface: o.surface ?? 'concrete', render: o.render }; boxes.push(bx); return bx; } };
  const kerb = { min: v(-6, -0.25, -6), max: v(22, 0.16, 17), kind: 'kerb', surface: 'concrete' };
  const h = buildHouse(b, { id: 0, x0: 0, z0: 0, x1: 16, z1: 11, base: 0.16, storeys: 3, street: [2, 0] });
  const cover = new CoverIndex([kerb, ...boxes], { cell: 8 });
  const w = makeWorld(cover);
  const st = new StructureSystem(w.world, { city: { houses: [h] } });
  w.world.structures = st;
  const run = (secs) => { for (let i = 0; i < Math.round(secs * 60); i++) { w.step(1); st.update(1 / 60); } };
  return { ...w, st, run };
}

test('soldiers get out from under a house front that has started to come down, and say so', () => {
  const T = town();
  // Two bots in the street by the front wall; the wall's foot is shelled out from under it.
  const a = T.bot(1, 0, v(6, 0.16, -1.5), 'lancer'), b = T.bot(2, 0, v(10, 0.16, -2), 'lancer');
  for (const e of [a, b]) T.brainOf(e).order = { kind: 'hold', pos: e.movement.state.position.clone(), arrive: 1 };
  const said = [];
  const off = T.world.barks ? (() => { const f = T.world.barks.say.bind(T.world.barks); T.world.barks.say = (e, kind, o) => { if (kind === 'collapse') said.push(e.id); return f(e, kind, o); }; return () => { T.world.barks.say = f; }; })() : () => {};
  T.world.explode(v(8, 1, -0.6), 9, { id: 'shell', damage: { base: 320, splash: 9 }, ammoType: 'explosive', artillery: {} }, { ownerId: null, team: -1 });
  assert.ok(T.st.falling.length >= 1, 'the ground it will come down on is known');
  const F = T.st.falling[0], out = v(0, 0, 0);
  assert.ok(T.st.dangerAt(8, -2, out) && out.z < 0, 'in front of it: out into the street');
  T.run(3);
  off();
  for (const e of [a, b]) {
    const p = e.movement.state.position;
    assert.ok(p.x < F.x0 || p.x > F.x1 || p.z < F.z0 || p.z > F.z1 || e.health.dead, `bot ${e.id} got clear (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
  }
  assert.ok(said.length >= 1, 'shouting it');
});
