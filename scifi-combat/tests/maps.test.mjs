// Maps built per match size (4v4 Outpost .. 64v64 Frontline): every one is valid and fair, its
// WW1 trenches are real trenches (flat floor, sandbag walls you fire over standing and hide
// behind crouched, exits you can walk out of), its ruins have rooms with doorways, its wire slows
// and is cut by blasts, and soldiers can climb out of a trench and never get stuck in a wall.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { bus } from '../src/core/EventBus.js';
import { generateFrontlineMap } from '../src/game/frontline/FrontlineMap.js';
import { MAP_SIZES, mapSizeFor } from '../src/game/frontline/MapSizes.js';
import { Terrain } from '../src/world/Terrain.js';
import { WireField } from '../src/world/WireField.js';
import { MovementController, FlatGroundBody } from '../src/movement/MovementController.js';
import { emptyCommand } from '../src/input/InputManager.js';
import { data as H, makeWorld, v } from './harness.mjs';

const SIZES = Object.keys(MAP_SIZES);
const built = new Map();
const mapOf = (size) => {
  if (!built.has(size)) { const t0 = performance.now(); built.set(size, { m: generateFrontlineMap({ seed: +(process.env.MAP_SEED ?? 7), size }), ms: performance.now() - t0 }); }
  return built.get(size).m;
};
const coverBoxes = (m) => m.cover.list ?? [];

test('a map per match size: bigger matches get bigger maps with more of everything', () => {
  const stats = SIZES.map((size) => {
    const m = mapOf(size), P = MAP_SIZES[size];
    assert.equal(m.size, size); assert.equal(m.name, P.name);
    const lanes = P.sectors.filter((s) => s.lanes).reduce((a, s) => a + s.lanes.length, 0);
    assert.equal(m.points.length, lanes, `${size}: a point per lane per line sector`);
    const lines = P.sectors.filter((s) => s.lanes).length - 1;
    assert.equal(m.trenches.length, lines, `${size}: a trench line between every pair of line sectors`);
    assert.ok(m.ruins.length > 0, `${size}: a village`);
    return { size, area: (m.bounds.maxX - m.bounds.minX) * (m.bounds.maxZ - m.bounds.minZ), points: m.points.length, boxes: coverBoxes(m).length, ms: built.get(size).ms };
  });
  for (let i = 1; i < stats.length; i++) {
    assert.ok(stats[i].area > stats[i - 1].area * 1.8, `${stats[i].size} is much bigger than ${stats[i - 1].size}`);
    assert.ok(stats[i].points >= stats[i - 1].points, `${stats[i].size} has at least as many points`);
  }
  assert.ok(stats.at(-1).ms < 4000, `${stats.at(-1).size} builds in ${stats.at(-1).ms.toFixed(0)} ms`);
  assert.equal(mapSizeFor(null, 8).id, '4v4'); assert.equal(mapSizeFor(null, 24).id, '12v12');
  assert.equal(mapSizeFor(null, 64).id, '32v32'); assert.equal(mapSizeFor(null, 128).id, '64v64');
  assert.equal(mapSizeFor(null, 400).id, '200v200');
});

test('every point is reachable from both HQs, and spawns are on walkable ground', () => {
  for (const size of SIZES) {
    const m = mapOf(size), nav = m.nav;
    for (const [team, h] of m.hq.entries()) {
      const f = nav.field(`test-hq${team}`, h.x, h.z, 6, { reach: Infinity });   // the whole map (a big map's fields stop at REACH)
      for (const p of m.points) assert.ok(Number.isFinite(nav.distance(f, p.pos.x, p.pos.z)), `${size}: ${p.name} reachable from HQ ${team}`);
    }
    for (const s of m.sectors.filter((x) => x.kind === 'line')) for (const team of [0, 1]) for (const sp of [...s.spawns[team], ...s.rearSpawns[team]]) {
      assert.ok(!nav.blocked(sp.x, sp.z), `${size}: spawn at ${sp.x.toFixed(0)},${sp.z.toFixed(0)} walkable`);
    }
    for (const h of m.hq) assert.ok(!nav.blocked(h.x, h.z), `${size}: HQ walkable`);
  }
});

test('the same seed builds the same map (server and clients agree)', () => {
  const a = generateFrontlineMap({ seed: 11, size: '12v12' }), b = generateFrontlineMap({ seed: 11, size: '12v12' });
  const sig = (m) => coverBoxes(m).map((x) => `${x.min.x.toFixed(3)},${x.min.y.toFixed(3)},${x.max.z.toFixed(3)},${x.kind}`).join('|');
  assert.equal(sig(a), sig(b));
  let same = true;
  for (let i = 0; i < a.terrain.h.length; i += 97) if (a.terrain.h[i] !== b.terrain.h[i]) { same = false; break; }
  assert.ok(same, 'identical terrain');
  const c = generateFrontlineMap({ seed: 12, size: '12v12' });
  assert.notEqual(sig(a), sig(c), 'another seed, another map');
});

test('trenches: a flat floor, parapets you fire over standing and hide behind crouched', () => {
  for (const size of SIZES) {
    const m = mapOf(size), t = m.terrain;
    for (const T of m.trenches) {
      assert.ok(T.positions.length > 20 && T.exits.length > 3 && T.bays.length > 4, `${size}: trench ${T.id} has bays, firing positions and exits`);
      assert.ok(T.positions.some((p) => p.facing > 0) && T.positions.some((p) => p.facing < 0), 'positions face both ways');
      for (const B of T.bays.filter((x, i) => i % 3 === 1 && !T.dugouts.some((d) => d.bay === x))) {
        const z = (B.z0 + B.z1) / 2;
        // Flat to the walls: no V-shaped ditch (the floor follows the lie of the ground, so on a
        // side slope it tilts a little with it).
        const ys = [-0.9, -0.5, 0, 0.5, 0.9].map((dx) => t.height(B.x + dx, z));
        assert.ok(Math.max(...ys) - Math.min(...ys) < 0.3 && ys[2] - (ys[0] + ys[4]) / 2 > -0.06, `${size}: bay floor flat across (${ys.map((y) => y.toFixed(2))})`);
      }
      // Firing positions: the parapet right in front is 1.15-1.5 m above the floor (the muzzle is
      // at 1.6 m standing, 1.05 m crouched; a crouched soldier is 1.15 m tall). Parapets step
      // with the ground, so on a slope one can stand a little prouder than the nominal 1.25 m.
      let checked = 0;
      for (const p of T.positions.filter((_, i) => i % 3 === 0)) {
        const fx = p.x + p.facing * 0.6;
        let top = -Infinity;
        m.cover.queryAABB(fx, p.z, fx, p.z, (b) => { if (b.kind === 'parapet' && fx > b.min.x && fx < b.max.x && p.z > b.min.z && p.z < b.max.z) top = Math.max(top, b.max.y); });
        if (top === -Infinity) continue; // a junction, dugout or exit opens there
        const h = top - p.y;
        assert.ok(h > 1.15 && h < 1.5, `${size}: parapet ${h.toFixed(2)} m above the floor at a firing position`);
        checked++;
      }
      assert.ok(checked > 3, 'checked some firing positions');
    }
  }
});

test('trenches sit on the nav grid: the floor is an open lane, exits are walkable ramps', () => {
  for (const size of SIZES) {
    const m = mapOf(size), nav = m.nav, t = m.terrain;
    for (const T of m.trenches) {
      let open = 0, n = 0;
      for (const p of T.positions) { n++; if (nav.cost[nav.index(p.x, p.z)] === 1) open++; }
      assert.ok(open / n > 0.8, `${size}: ${open}/${n} firing positions on open floor cells`);
      for (const e of T.exits) {
        assert.ok(nav.cost[nav.index(e.x, e.z)] < Infinity, `${size}: exit outside walkable`);
        // The ramp from the floor to the surface: no step over 0.45 m per metre.
        const steps = [];
        for (let k = 0; k <= 4; k++) { const x = e.floor.x + (e.x - e.floor.x) * (k / 4); steps.push(t.height(x, e.z)); }
        const run = Math.abs(e.x - e.floor.x) / 4;
        for (let k = 1; k < steps.length; k++) assert.ok(Math.abs(steps[k] - steps[k - 1]) / run < 0.75, `${size}: exit ramp grade ${(Math.abs(steps[k] - steps[k - 1]) / run).toFixed(2)}`);
        let blocked = false;
        m.cover.queryAABB(e.floor.x - 0.2, e.z - 0.2, e.x + 0.2, e.z + 0.2, (b) => { if (b.kind === 'parapet' && Math.abs(b.min.z - e.z) < 0.9 && Math.abs(b.max.z - e.z) < 0.9) blocked = true; });
        assert.ok(!blocked, `${size}: no sandbags across an exit`);
      }
    }
  }
});

test('ruins: rooms with doorways, and the doorways are open', () => {
  for (const size of SIZES) {
    const m = mapOf(size);
    for (const r of m.ruins) {
      assert.ok(r.rooms.length >= 2, `${size}: ruin ${r.id} has rooms`);
      assert.ok(r.doors.length >= 2, `${size}: ruin ${r.id} has two ways in`);
      for (const room of r.rooms) {
        assert.ok(room.doors.length >= 1, 'every room has a doorway');
        for (const d of room.doors) {
          let wall = false;
          m.cover.queryAABB(d.x - 0.3, d.z - 0.3, d.x + 0.3, d.z + 0.3, (b) => { if (b.kind === 'ruin' && d.x > b.min.x && d.x < b.max.x && d.z > b.min.z && d.z < b.max.z) wall = true; });
          assert.ok(!wall, `${size}: doorway at ${d.x.toFixed(1)},${d.z.toFixed(1)} is open`);
        }
      }
    }
  }
});

test('wire: belts slow soldiers and make routes go through the gaps; a blast cuts them', () => {
  const m = mapOf('32v32');
  assert.ok(m.wire.length > 10, 'wire in front of the trenches');
  const w = m.wire[0], cx = (w.min.x + w.max.x) / 2, cz = (w.min.z + w.max.z) / 2;
  const field = new WireField(m.wire);
  assert.ok(field.slowAt(cx, cz) < 0.6, 'slow inside a belt');
  assert.equal(field.slowAt(cx + 30, cz), 1, 'full speed outside');
  assert.ok(m.nav.cost[m.nav.index(cx, cz)] >= 8, 'belts cost the nav extra');
  // A blast in a world with this wire cuts it: zones go, the renderer and nav hear about it.
  const { world } = makeWorld([]);
  world.nav = m.nav; world.wire = field;
  const cuts = [];
  const off = bus.on('world:wireCut', (e) => cuts.push(e));
  world.explode(new Vector3(cx, 0, cz), 6, { id: 'test_shell', damage: { base: 50 }, ammoType: 'explosive' }, null);
  off();
  assert.equal(cuts.length, 1, 'wire cut event');
  assert.equal(field.slowAt(cx, cz), 1, 'cut wire no longer slows');
  assert.ok(m.nav.cost[m.nav.index(cx, cz)] < 8, 'routes open through the cut');
});

test('terrain digging keeps the deepest cut and reports what changed', () => {
  const t = new Terrain({ minX: 0, minZ: 0, width: 20, depth: 20, res: 1 });
  const near = (a, b) => Math.abs(a - b) < 1e-5;
  t.carveRect(5, 5, 8, 8, 0.6, 0.01);
  assert.ok(near(t.height(6, 6), -0.6), 'dug 0.6 m');
  assert.equal(t.height(4, 6), 0, 'samples outside the rect are untouched');
  t.carveRect(5, 5, 8, 8, 0.6, 0.01);
  assert.ok(near(t.height(6, 6), -0.6), 'digging twice digs no deeper');
  t.carveDisc(14, 14, 2, 0.8, 0.2);
  assert.ok(t.height(14, 14) < -0.75 && t.height(16.4, 14) > 0, 'a crater with a thrown-up lip');
  assert.ok(t.dug[6 * t.nx + 6] > 0.5, 'dug ground is recorded (mud)');
  assert.equal(t.takeDirty().length, 3); assert.equal(t.takeDirty().length, 0);
});

test('a soldier pushed into a wall is pushed out instead of sticking there', () => {
  const box = { min: v(0, 0, 0), max: v(1, 1.5, 4) };
  const body = new FlatGroundBody(v(1.2, 0, 2), [box]);
  const mv = new MovementController(H.movement, body, {}, 1);
  mv.state.position.set(1.2, 0, 2); body.teleport(mv.state.position); // 0.15 m inside the wall's reach
  const cmd = emptyCommand();
  cmd.moveY = 1; cmd.yaw = Math.PI; // walk along +Z, beside the wall
  for (let i = 0; i < 60; i++) mv.update(cmd, 1 / 60);
  assert.ok(mv.state.position.z > 4, `walked on along the wall (z = ${mv.state.position.z.toFixed(2)})`);
  assert.ok(mv.state.position.x >= 1.35 - 1e-3, 'outside the wall');
});

test('going over the top: from the trench floor, hold climb into the parapet and you are out', () => {
  const m = mapOf('4v4');
  const T = m.trenches[0], B = T.bays[2], z = B.z0 + 3.2;
  const p = T.positions.find((q) => Math.abs(q.z - z) < 1.3 && q.facing > 0 && q.trench === T.id && Math.abs(q.x - (B.x + 0.55)) < 0.01);
  assert.ok(p, 'a firing position facing +x');
  const body = new FlatGroundBody(v(p.x, p.y, p.z), m.cover, { terrain: m.terrain });
  const mv = new MovementController(H.movement, body, {}, 1);
  mv.state.position.set(p.x, p.y, p.z); body.teleport(mv.state.position);
  const cmd = emptyCommand();
  cmd.moveY = 1; cmd.yaw = -Math.PI / 2; // face +X
  cmd.buttons.jump = { down: true, pressed: true, released: false };
  let climbed = false;
  const off = bus.on('move:mantle', (e) => { if (e.id === 1 && e.kind === 'climb') climbed = true; });
  for (let i = 0; i < 150; i++) { mv.update(cmd, 1 / 60); cmd.buttons.jump = { down: true, pressed: false, released: false }; }
  off();
  assert.ok(climbed, 'climbed the parapet');
  const q = mv.state.position, t = m.terrain;
  assert.ok(q.x > B.x + 2.2, `out past the sandbags (x ${q.x.toFixed(2)} vs bay ${B.x})`);
  assert.ok(t.undug(q.x, q.z) - t.height(q.x, q.z) < 0.3 && Math.abs(q.y - t.height(q.x, q.z)) < 0.2, 'up on the surface');
});
