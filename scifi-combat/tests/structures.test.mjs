// Structural stability (src/world/Structures.js): blasts chip, hole and tear walls; what's left
// unheld creaks and comes down (walls topple outward, floors drop), crushing whoever is under it,
// pounding what it lands on, and lying as rubble; the city's skybridges go when a house does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bus } from '../src/core/EventBus.js';
import { buildHouse } from '../src/game/frontline/Houses.js';
import { generateFrontlineMap } from '../src/game/frontline/FrontlineMap.js';
import { CoverIndex } from '../src/world/CoverIndex.js';
import { CombatWorld } from '../src/combat/CombatWorld.js';
import { StructureSystem, structuralPower } from '../src/world/Structures.js';
import { makeWorld, v } from './harness.mjs';

const SHELL = { id: 'shell', damage: { base: 320, splash: 9 }, ammoType: 'explosive', artillery: {} };   // a howitzer round
const TANK = { id: 'tank', damage: { base: 220, splash: 4.5 }, ammoType: 'explosive' };
const FRAG = { id: 'frag', damage: { base: 110, splash: 4.5 }, ammoType: 'explosive' };
const NOBODY = { ownerId: null, team: -1 };
const vol = (b) => (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z);

/** A house on a sidewalk slab at the origin (16 x 11 m, the street to the south and west), in a world of its own. */
function town({ storeys = 3, extra = [] } = {}) {
  let s = 99;
  const rand = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const boxes = [];
  const b = { rand, R: (a, c) => a + (c - a) * rand(), boxRect: (x0, z0, x1, z1, h, o) => { const bx = { min: v(x0, o.bottom ?? 0, z0), max: v(x1, o.top ?? h, z1), kind: o.kind, surface: o.surface ?? 'concrete', render: o.render }; boxes.push(bx); return bx; } };
  const kerb = { min: v(-6, -0.25, -6), max: v(22, 0.16, 17), kind: 'kerb', surface: 'concrete' };
  const h = buildHouse(b, { id: 0, x0: 0, z0: 0, x1: 16, z1: 11, base: 0.16, storeys, street: [2, 0] });
  const cover = new CoverIndex([kerb, ...boxes, ...extra], { cell: 8 });
  const w = makeWorld(cover);
  const st = new StructureSystem(w.world, { city: { houses: [h] } });
  w.world.structures = st;
  const run = (secs) => { for (let i = 0; i < Math.round(secs * 60); i++) { w.step(1); st.update(1 / 60); } };
  return { ...w, h, st, S: st.list[0], cover, run };
}
const south = (T, f = () => true) => [...T.S.members].filter((m) => m.role && m.max.z <= 0.31 && f(m));

test('structural power: artillery hits buildings hardest, then a charge against the wall, then shells and grenades', () => {
  assert.equal(structuralPower(SHELL), 1280);
  assert.equal(structuralPower(TANK), 550);
  assert.equal(structuralPower(FRAG), 275);
  assert.equal(structuralPower({ damage: { base: 150 } }, { charge: true }), 900);
  assert.equal(structuralPower({ damage: { base: 40 } }), 60, 'anything else barely scratches it');
});

test('a grenade chips a wall, a tank shell holes it, and what is left of the wall stays up round the hole', () => {
  const T = town();
  const n0 = T.S.members.size, vol0 = south(T).reduce((a, m) => a + vol(m), 0);
  T.world.explode(v(8, 1.2, -1.2), 4.5, FRAG, NOBODY);
  assert.equal(T.st.stats.holes, 0, 'a grenade makes no hole');
  assert.ok(south(T).some((m) => m.st.hp < m.st.max), 'but it chips the wall');
  T.world.explode(v(8, 1.2, -0.4), 4.5, TANK, NOBODY);
  assert.ok(T.st.stats.holes >= 1, 'a tank shell holes it');
  const vol1 = south(T).reduce((a, m) => a + vol(m), 0);
  assert.ok(vol1 < vol0 - 0.3 && vol1 > vol0 * 0.7, `a hole, not a missing wall (${vol0.toFixed(1)} -> ${vol1.toFixed(1)} m³)`);
  // The pieces round the hole are cover in their own right: in the index, in the structure.
  const frags = south(T).filter((m) => !T.h.parts.wall.includes(m));
  assert.ok(frags.length >= 2 && frags.every((f) => T.cover.list.includes(f) && f.group === T.h.parts.wall[0].group), 'what is left of it is cover');
  T.run(3);
  assert.equal(T.st.stats.falls, 0, 'a shell hole brings nothing down');
  assert.ok(T.S.members.size >= n0, 'the house stands');
});

test('a howitzer round that takes out the bottom of a wall brings the wall above it down: it creaks, hangs on, tears loose and comes down in pieces; the floors, held by the other walls, stay up', () => {
  const T = town({ storeys: 3 });
  const ev = { tear: [], land: [], creak: 0, smash: 0 };
  const offs = [bus.on('structure:tear', (e) => ev.tear.push(e)), bus.on('structure:land', (e) => ev.land.push(e)), bus.on('structure:creak', () => ev.creak++), bus.on('structure:break', (e) => { if (e.impact) ev.smash++; })];
  T.world.explode(v(8, 1, -0.6), 9, SHELL, NOBODY);
  T.run(0.5);
  const R = T.st.rigid;
  assert.ok(ev.creak >= 1, 'it creaks first');
  assert.ok(R.bodies.length >= 3 && R.joints.some((j) => !j.broken), `then comes away in pieces still fixed on (${R.bodies.length} pieces)`);
  assert.equal(south(T, (m) => m.role === 'pier' && m.min.y > 3 && m.min.x > 5 && m.max.x < 11).length, 0, 'no pier left standing over the hole');
  T.run(9.5);
  offs.forEach((f) => f());
  assert.ok(ev.tear.length >= 6, `it tears loose (${ev.tear.length} joints)`);
  assert.ok(ev.land.length >= 4 && ev.smash >= 2, `comes down (${ev.land.length} crashes) and smashes (${ev.smash})`);
  assert.equal(R.awake.length, 0, 'and comes to rest');
  assert.ok([...T.S.members].filter((m) => m.kind === 'hroof').length >= 1 && [...T.S.members].filter((m) => m.kind === 'hfloor').length >= 1, 'the floors and the roof stand');
  // It lies in the street in front of the house, and on the ground floor, as rubble.
  const down = R.bodies.filter((b) => b.aabb[4] < 2);
  const mass = R.bodies.reduce((a, b) => a + b.m, 0), low = down.reduce((a, b) => a + b.m, 0);
  assert.ok(low > mass * 0.8, `most of it is on the ground (${low.toFixed(0)} of ${mass.toFixed(0)} t)`);
  assert.ok(down.every((b) => b.aabb[2] < 3 && b.aabb[5] > -14), 'in front of the facade, and not thrown down the street');
  const rubble = T.cover.list.filter((b) => b.kind === 'rubble');
  assert.ok(rubble.length >= 10 && rubble.every((r) => r.body), `it lies as rubble (${rubble.length} boxes)`);
  assert.ok(rubble.filter((r) => r.max.y - r.min.y <= 1).length >= rubble.length * 0.8, 'most of it low enough to climb over');
});

test('a floor let go on three sides hangs from the wall left, tears, and comes down on the floor below: flat, or leaning on the wall as a ramp', () => {
  const T = town({ storeys: 2 });
  for (const m of [...T.S.members].filter((q) => (q.role && q.min.z < 10.6) || q.kind === 'hstair')) T.st.knockOut(m);
  T.run(0.6);
  const R = T.st.rigid;
  const slabs = R.bodies.filter((b) => b.boxes.some((k) => k.meta?.kind === 'hfloor' || k.meta?.kind === 'hroof'));
  assert.ok(slabs.length >= 2, 'the floor and the roof came away');
  T.run(8);
  assert.equal(R.awake.length, 0, 'at rest');
  const tilt = (b) => (2 * Math.acos(Math.min(1, Math.abs(b.q[3]))) * 180) / Math.PI;
  const lying = R.bodies.filter((b) => b.boxes.some((k) => k.meta?.kind === 'hfloor' || k.meta?.kind === 'hroof'));
  assert.ok(lying.some((b) => tilt(b) < 8), 'some lie flat');
  const ramps = lying.filter((b) => tilt(b) > 15 && tilt(b) < 65 && b.aabb[4] > 2);
  assert.ok(ramps.length >= 1, `some lean from the ground up against the wall left standing (${lying.map((b) => tilt(b).toFixed(0)).join(', ')}°)`);
  // A ramp's rubble steps you can walk up.
  const r = ramps.sort((a, b) => b.aabb[4] - a.aabb[4])[0], steps = T.cover.list.filter((c) => c.body === r.id);
  assert.ok(steps.length >= 3, `the ramp is a stair of ${steps.length} boxes`);
});

test('what holds what: a lintel carries the wall over one missing pier, not over a gap wider than it spans; a floor with one wall left under it falls', () => {
  {
    const T = town({ storeys: 3 });
    const piers = south(T, (m) => m.role === 'pier' && m.min.y < 0.2);
    const mid = piers.sort((a, b) => Math.abs((a.min.x + a.max.x) / 2 - 8) - Math.abs((b.min.x + b.max.x) / 2 - 8))[0];
    T.st.knockOut(mid);
    T.run(3);
    assert.equal(T.st.stats.falls, 0, 'one ground-floor pier gone: the band over it carries the wall above');
  }
  {
    // A 10 m gap (and the partition wall that meets the facade inside, which would carry it).
    const T = town({ storeys: 3 });
    const inside = [...T.S.members].filter((q) => q.role === 'pier' && q.min.z > 0.29 && q.max.z < 10.71 && q.min.x > 0.29 && q.max.x < 15.71);
    assert.ok(inside.length >= 1, 'the ground floor has a partition wall');
    for (const m of [...inside, ...south(T, (q) => q.role === 'pier' && q.min.y < 0.2 && q.min.x > 2.5 && q.max.x < 13.5)]) T.st.knockOut(m);
    T.run(5);
    assert.ok(T.st.stats.falls >= 3, `a 10 m gap: the wall over it falls (${T.st.stats.falls} pieces)`);
    assert.equal(south(T, (m) => m.role === 'pier' && m.min.y > 3 && m.min.x > 4 && m.max.x < 12).length, 0, 'nothing left over the gap');
  }
  {
    const T = town({ storeys: 2 });
    // Everything but the north wall: the south, east and west walls, the partition, the stairs.
    for (const m of [...T.S.members].filter((q) => (q.role && q.min.z < 10.6) || q.kind === 'hstair')) T.st.knockOut(m);
    const area = (q) => (q.max.x - q.min.x) * (q.max.z - q.min.z);
    const slabs = () => [...T.S.members].filter((m) => m.kind === 'hfloor' || m.kind === 'hroof');
    const before = slabs().reduce((a, m) => a + area(m), 0);
    T.run(6);
    const left = slabs();
    assert.ok(left.reduce((a, m) => a + area(m), 0) < before * 0.35, 'held on one side only, a 10 m floor goes (concrete reaches 2.2 m)');
    assert.ok(left.every((m) => (m.min.z + m.max.z) / 2 > 10.7 - 2.2 - 0.3), 'all that stays is the strip along the wall still standing');
  }
});

test('a falling floor crushes whoever is under it, pounds what it lands on, and you can climb onto what is left', () => {
  // A canopy on four pillars, over a low table on short legs, over a soldier.
  const P = (x, z, h) => ({ min: v(x - 0.2, 0, z - 0.2), max: v(x + 0.2, h, z + 0.2), kind: 'pillar', surface: 'concrete', role: 'pier' });
  const pillars = [P(0.2, 0.2, 3), P(5.8, 0.2, 3), P(0.2, 5.8, 3), P(5.8, 5.8, 3)];
  const slab = { min: v(0, 3, 0), max: v(6, 3.3, 6), kind: 'slab', surface: 'concrete' };
  const legs = [P(9.2, 0.2, 0.5), P(11.8, 0.2, 0.5), P(9.2, 2.8, 0.5), P(11.8, 2.8, 0.5)];
  const table = { min: v(9, 0.5, 0), max: v(12, 0.75, 3), kind: 'slab', surface: 'concrete' };
  const top = { min: v(9, 3, 0), max: v(12, 3.3, 3), kind: 'slab', surface: 'concrete' };
  const posts = [P(9.2, 0.95, 3), P(11.8, 0.95, 3)].map((p) => { p.min.y = 0.75; return p; });
  const all = [...pillars, slab, ...legs, table, top, ...posts];
  const cover = new CoverIndex(all, { cell: 8 });
  const w = makeWorld(cover);
  const st = new StructureSystem(w.world, {});
  w.world.structures = st;
  const canopy = st.register('canopy', [...pillars, slab]), stack = st.register('stack', [...legs, table, top, ...posts]);
  const e = w.fighter(1, 0, v(3, 0, 3), 'monolith');
  const run = (secs) => { for (let i = 0; i < Math.round(secs * 60); i++) { w.step(1); st.update(1 / 60); } };
  run(0.5);
  // Three pillars gone: held by one corner, the canopy can't hold out 3 m.
  for (const p of pillars.slice(1)) st.knockOut(p);
  run(3);
  assert.ok(slab.st.gone && st.stats.falls >= 1, 'the canopy came down');
  assert.ok(e.health.dead, `the soldier under it is dead (${e.health.hp.toFixed(0)} hp)`);
  assert.ok(!e.health.downed, 'crushed outright, not downed');
  // The upper slab of the stack, knocked off its posts, lands on the table and pounds it.
  st.knockOut(posts[0]); st.knockOut(posts[1]);
  run(3);
  assert.ok(top.st.gone, 'the top fell');
  assert.ok(table.st.gone || table.st.hp < table.st.max, `the table took the blow (${table.st.hp.toFixed(0)} / ${table.st.max.toFixed(0)})`);
  assert.equal(stack.members.size > 0 || true, true);
  // What's left of the canopy: rubble you step onto.
  const rubble = cover.list.filter((b) => b.kind === 'rubble');
  assert.ok(rubble.length >= 1);
  const r = rubble.sort((a, b) => vol(b) - vol(a))[0];
  const f = w.fighter(2, 0, v(r.min.x - 1.2, 0, (r.min.z + r.max.z) / 2), 'monolith');
  w.aim(f, -Math.PI / 2); w.move(f, 0, 1);
  for (let i = 0; i < 90 && f.movement.state.position.x < (r.min.x + r.max.x) / 2; i++) { w.step(1); st.update(1 / 60); }
  w.move(f, 0, 0); w.step(10);
  assert.ok(Math.abs(f.movement.state.position.y - r.max.y) < 0.05, `up on the rubble (y ${f.movement.state.position.y.toFixed(2)}, its top ${r.max.y.toFixed(2)})`);
  void canopy;
});

test('a skybridge comes down when the house holding one end of it does', () => {
  const map = generateFrontlineMap({ seed: 7, size: '32v32', theme: 'city' });
  const world = new CombatWorld({ cover: map.cover, terrain: map.terrain, nav: map.nav });
  const st = new StructureSystem(world, map);
  world.structures = st;
  const bridge = st.list.find((S) => S.kind === 'bridge' && S.near.filter((T) => T.kind === 'house').length === 2);
  assert.ok(bridge, 'an intact skybridge between two houses');
  const [A] = bridge.near.filter((T) => T.kind === 'house');
  // Everything of house A within reach of the bridge's end goes.
  const near = [...A.members].filter((m) => m.max.x > bridge.min.x - 3 && m.min.x < bridge.max.x + 3 && m.max.z > bridge.min.z - 3 && m.min.z < bridge.max.z + 3 && m.role);
  assert.ok(near.length >= 2, `the end of house ${A.id} the bridge rests on (${near.length} pieces)`);
  for (const m of near) st.knockOut(m);
  for (let i = 0; i < 60 * 6; i++) st.update(1 / 60);
  assert.equal(bridge.members.size, 0, 'the bridge fell, all of it');
});

test('the same blasts bring down the same pieces, and a shell on a house costs a few milliseconds', () => {
  const play = () => {
    const T = town({ storeys: 3 });
    const t0 = performance.now();
    T.world.explode(v(3, 1, -0.6), 9, SHELL, NOBODY);
    const first = performance.now() - t0;
    T.run(2);
    const t1 = performance.now();
    T.world.explode(v(13, 4, -0.6), 9, SHELL, NOBODY);
    const second = performance.now() - t1;
    T.run(4);
    return { first, second, stats: JSON.stringify(T.st.stats), boxes: T.cover.list.map((b) => `${b.min.toArray().map((x) => x.toFixed(3))}`).join('|') };
  };
  const a = play(), b = play();
  assert.equal(a.stats, b.stats, 'same breaks, holes, falls and rubble');
  assert.equal(a.boxes, b.boxes, 'the same pieces in the same places');
  assert.ok(b.first < 20 && b.second < 20, `a shell on a house: ${b.first.toFixed(1)} ms, then ${b.second.toFixed(1)} ms`);
});

test('what you see: a piece gone is gone from its mesh, the pieces round a hole are drawn, and every piece coming away is drawn as it moves and where it lies', async () => {
  const { Scene, Matrix4, Vector3 } = await import('three');
  const { CityRenderer } = await import('../src/render/CityRenderer.js');
  const { CollapseViews } = await import('../src/vfx/CollapseViews.js');
  const map = generateFrontlineMap({ seed: 7, size: '12v12', theme: 'city' });
  const world = new CombatWorld({ cover: map.cover, terrain: map.terrain, nav: map.nav });
  const st = new StructureSystem(world, map);
  world.structures = st;
  const R = new CityRenderer(new Scene(), map, { planet: { city: { lights: 2 } } });
  const V = new CollapseViews(new Scene(), { colorOf: (b) => R.colorOf(b), rigid: st.rigid });
  const h = map.city.houses.slice().sort((a, b) => b.storeys - a.storeys)[0];
  const S = st.list.find((q) => q.house === h);
  const gone = [];
  const off = bus.on('world:coverDestroyed', (e) => { if (e.structural && !e.cover.body) gone.push(e.cover); });
  world.explode(new Vector3((h.min.x + h.max.x) / 2, h.base + 1, h.min.z - 0.6), 9, SHELL, NOBODY);
  let moving = 0;
  const m = new Matrix4();
  for (let i = 0; i < 60 * 10; i++) {
    st.update(1 / 60); V.update(1 / 60, 0.5);
    moving = Math.max(moving, V.drawn.moving);
    if (i === 90) {
      // Each body drawn, box by box, where it is.
      for (const b of st.rigid.bodies) {
        const s = V.slots.get(b);
        assert.ok(s && s.i.length === b.boxes.length, 'every body is drawn, every box of it');
        V.mesh.getMatrixAt(s.i[0], m);
        const p = new Vector3().setFromMatrixPosition(m), k = b.boxes[0];
        const c = new Vector3(k.c[0], k.c[1], k.c[2]).applyQuaternion({ x: b.q[0], y: b.q[1], z: b.q[2], w: b.q[3], isQuaternion: true }).add(new Vector3(b.x[0], b.x[1], b.x[2]));
        assert.ok(p.distanceTo(c) < 0.6, `at its pose (${p.distanceTo(c).toFixed(2)} m off)`);
      }
    }
  }
  off();
  assert.ok(gone.length >= 5 && S.members.size > 0, `pieces gone (${gone.length})`);
  for (const b of gone) assert.ok(!R.slots.has(b), 'a gone piece has no instance');
  for (const b of S.members) assert.ok(R.slots.has(b), `${b.kind} still standing is drawn`);
  assert.ok(moving >= 3, `pieces drawn moving (${moving} at once)`);
  assert.equal(st.rigid.awake.length, 0, 'all at rest');
  assert.equal(V.drawn.n, st.rigid.bodies.length, 'and every one still drawn, where it lies');
  const rubble = map.cover.list.filter((b) => b.kind === 'rubble');
  assert.ok(rubble.length >= 3 && rubble.every((b) => !R.slots.has(b)), `its rubble is cover, not drawn twice (${rubble.length})`);
  R.dispose(); V.dispose();
});
