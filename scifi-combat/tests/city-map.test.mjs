// The night city (`theme: 'city'`, City.js): the same front as the trench maps, fought through a
// city. A city per match size; streets that stay open (no wreck or barricade closes one, every
// point is reachable from both HQs); buildings that never stand on a point, a spawn or an HQ;
// lamps on the sidewalks and wrecks in the streets; a park with its fountain on the middle point;
// a barricade line across the streets where a trench line would be; the renderer dresses it all;
// and a match runs in it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Vector3 } from 'three';
import { bus } from '../src/core/EventBus.js';
import { generateFrontlineMap } from '../src/game/frontline/FrontlineMap.js';
import { CITY_NAMES } from '../src/game/frontline/City.js';
import { MAP_SIZES } from '../src/game/frontline/MapSizes.js';
import { FrontlineSession } from '../src/game/FrontlineSession.js';
import { CityRenderer } from '../src/render/CityRenderer.js';
import { data as H } from './harness.mjs';

const SIZES = Object.keys(MAP_SIZES);
const built = new Map();
const cityOf = (size) => {
  if (!built.has(size)) { const t0 = performance.now(); built.set(size, { m: generateFrontlineMap({ seed: 7, size, theme: 'city' }), ms: performance.now() - t0 }); }
  return built.get(size).m;
};
const inside = (B, x, z, pad = 0) => x > B.min.x - pad && x < B.max.x + pad && z > B.min.z - pad && z < B.max.z + pad;
const towers = (m) => m.cover.list.filter((b) => b.kind === 'tower');

test('a city per match size: streets, blocks, buildings, wrecks, lamps, neon and a park, more of it the bigger the match', () => {
  let prev = null;
  for (const size of SIZES) {
    const m = cityOf(size), C = m.city;
    assert.equal(m.theme, 'city'); assert.equal(m.name, CITY_NAMES[size]);
    assert.equal(m.trenches.length, 0, `${size}: no trenches in a city`);
    assert.ok(C.avenues.length >= 3 && C.cross.length >= 4, `${size}: a street grid (${C.avenues.length} avenues, ${C.cross.length} cross streets)`);
    assert.ok(C.buildings.length >= 12 && C.wrecks.length >= 12 && C.lamps.length >= 20 && C.signs.length >= 5, `${size}: ${C.buildings.length} buildings, ${C.wrecks.length} wrecks, ${C.lamps.length} lamps, ${C.signs.length} signs`);
    assert.ok(C.trees.length >= 10 && C.fountain, `${size}: a park with trees and a fountain`);
    assert.ok(C.wrecks.some((w) => w.burned) && C.wrecks.some((w) => w.roof) && C.wrecks.some((w) => !w.burned && !w.roof), `${size}: wrecks burned out, on their roofs, and just shot up`);
    assert.ok(C.lamps.some((l) => l.state === 'out') && C.lamps.filter((l) => l.state === 'on').length > C.lamps.length * 0.6, `${size}: most lamps work, a few are out`);
    assert.ok(m.points.length >= 3 && m.hq.length === 2, `${size}: the front's points and HQs`);
    if (prev) assert.ok(C.buildings.length > prev.buildings.length && C.lamps.length > prev.lamps.length, `${size}: a bigger city than the last size`);
    prev = C;
  }
  const big = built.get('200v200');
  assert.ok(big.ms < 4000, `the biggest city builds in ${big.ms.toFixed(0)} ms`);
});

test('the same seed builds the same city, another seed another one', () => {
  const sig = (m) => m.cover.list.map((b) => `${b.min.x.toFixed(2)},${b.min.z.toFixed(2)},${b.max.y.toFixed(2)},${b.kind}`).join('|');
  const a = generateFrontlineMap({ seed: 11, size: '12v12', theme: 'city' }), b = generateFrontlineMap({ seed: 11, size: '12v12', theme: 'city' });
  assert.equal(sig(a), sig(b));
  assert.deepEqual(a.city.lamps.map((l) => l.state), b.city.lamps.map((l) => l.state));
  assert.notEqual(sig(a), sig(generateFrontlineMap({ seed: 12, size: '12v12', theme: 'city' })));
  assert.notEqual(sig(a), sig(generateFrontlineMap({ seed: 11, size: '12v12' })), 'the trench map is another map');
});

test('the plazas stay open: no building on a point, a spawn or an HQ', () => {
  for (const size of SIZES) {
    const m = cityOf(size), T = towers(m);
    for (const p of m.points) for (const B of T) {
      const dx = Math.max(B.min.x - p.pos.x, 0, p.pos.x - B.max.x), dz = Math.max(B.min.z - p.pos.z, 0, p.pos.z - B.max.z);
      assert.ok(Math.hypot(dx, dz) > p.radius, `${size}: a building on ${p.name}`);
    }
    for (const s of m.sectors.filter((x) => x.kind === 'line')) for (const team of [0, 1]) for (const sp of [...s.spawns[team], ...s.rearSpawns[team]]) {
      assert.ok(!T.some((B) => inside(B, sp.x, sp.z, 1)), `${size}: spawn at ${sp.x.toFixed(0)},${sp.z.toFixed(0)} in a building`);
    }
    for (const h of m.hq) assert.ok(!T.some((B) => inside(B, h.x, h.z, 6)) && !m.nav.blocked(h.x, h.z), `${size}: HQ open`);
  }
});

test('the streets stay open: every point, every street reachable from both HQs, and the way across is never a maze', () => {
  for (const size of SIZES) {
    const m = cityOf(size), nav = m.nav, C = m.city;
    for (const [team, h] of m.hq.entries()) {
      const f = nav.field(`city-hq${team}`, h.x, h.z, 6, { reach: Infinity });
      for (const p of m.points) assert.ok(Number.isFinite(nav.distance(f, p.pos.x, p.pos.z)), `${size}: ${p.name} reachable from HQ ${team}`);
      // Every stretch of street: no wreck, crater or barricade line shuts one off.
      const shut = C.segs.filter((s) => {
        const mid = (s.from + s.to) / 2, x = s.axis === 'x' ? mid : s.at, z = s.axis === 'x' ? s.at : mid;
        const near = [[x, z], [x + 3, z], [x - 3, z], [x, z + 3], [x, z - 3]].filter(([a, c]) => !nav.blocked(a, c));
        return near.length && !near.some(([a, c]) => Number.isFinite(nav.distance(f, a, c)));
      });
      assert.equal(shut.length, 0, `${size}: ${shut.length} streets cut off from HQ ${team}`);
      const other = m.hq[1 - team], straight = Math.hypot(other.x - h.x, other.z - h.z);
      assert.ok(nav.distance(f, other.x, other.z) < straight * 1.5, `${size}: HQ to HQ by the streets is ${(nav.distance(f, other.x, other.z) / straight).toFixed(2)}x the straight line`);
    }
  }
});

test('lamps stand on the sidewalks, wrecks in the street, the park in the middle with its fountain on the point', () => {
  for (const size of SIZES) {
    const m = cityOf(size), C = m.city;
    const P = C.park, inPark = (x, z) => x > P.x0 && x < P.x1 && z > P.z0 && z < P.z1;
    for (const l of C.lamps) {
      const walk = C.blocks.find((k) => inside(k.slab, l.x, l.z));
      assert.ok(walk || inPark(l.x, l.z), `${size}: lamp at ${l.x.toFixed(0)},${l.z.toFixed(0)} on a sidewalk (or in the park)`);
      assert.ok(Math.abs(l.y - (walk ? walk.slab.max.y : m.terrain.height(l.x, l.z))) < 0.01, `${size}: the lamp stands on it`);
    }
    assert.ok(C.lamps.some((l) => inPark(l.x, l.z)), `${size}: lamps along the park's paths`);
    for (const w of C.wrecks) {
      const x = (w.box.min.x + w.box.max.x) / 2, z = (w.box.min.z + w.box.max.z) / 2;
      assert.ok(!C.blocks.some((k) => inside(k.slab, x, z)), `${size}: wreck at ${x.toFixed(0)},${z.toFixed(0)} in the street`);
      assert.ok(m.points.every((p) => Math.hypot(p.pos.x - x, p.pos.z - z) > p.radius), `${size}: no wreck on a point`);
    }
    // The park: the middle of the map, streets round it (no block, no street, no wreck in it).
    const mid = m.sectors[Math.floor((m.sectors.length - 1) / 2)], mx = (mid.x0 + mid.x1) / 2;
    assert.ok(P.x0 < mx && P.x1 > mx && P.x1 - P.x0 > (mid.x1 - mid.x0) * 0.6 && P.z0 < 0 && P.z1 > 0, `${size}: the park fills the middle sector`);
    assert.ok(!C.blocks.some((k) => k.x1 > P.x0 + 0.01 && k.x0 < P.x1 - 0.01 && k.z1 > P.z0 + 0.01 && k.z0 < P.z1 - 0.01), `${size}: no block in the park`);
    assert.ok(!C.segs.some((s) => (s.axis === 'x' ? inPark((s.from + s.to) / 2, s.at) : inPark(s.at, (s.from + s.to) / 2))), `${size}: no street through the park`);
    const parkPoints = m.points.filter((p) => inPark(p.pos.x, p.pos.z));
    if (parkPoints.length) assert.ok(parkPoints.some((p) => Math.hypot(C.fountain.x - p.pos.x, C.fountain.z - p.pos.z) < 0.01), `${size}: the fountain on the park's point`);
    assert.equal(C.paint((P.x0 + P.x1) / 2, 0), 'path');
    assert.ok([...Array(40)].some((_, k) => C.paint(P.x0 + 3 + k * (P.x1 - P.x0 - 6) / 40, P.z0 + 7) === 'grass'), `${size}: grass`);
    assert.equal(C.paint(C.cross[0], C.avenues[0]), 'asphalt');
    assert.ok(C.trees.every((t) => inPark(t.x, t.z)), `${size}: the trees are the park's`);
    assert.ok(C.props.filter((p) => p.kind === 'bench').length >= 3, `${size}: benches along the paths`);
  }
});

test('where the trench lines would be, a barricade line across the streets, wired in front', () => {
  for (const size of SIZES) {
    const m = cityOf(size), C = m.city, S = m.sectors;
    for (let i = 1; i < S.length - 2; i++) {
      if (S[i].kind !== 'line' || S[i + 1].kind !== 'line') continue;
      // On every avenue, at the boundary or as near it as the stretch between crossings allows.
      const bx = S[i].x1;
      for (const av of C.avenues) {
        if (!C.segs.some((s) => s.axis === 'x' && s.at === av && s.from < bx + 30 && s.to > bx - 30)) continue;
        const at = C.barricades.filter((b) => Math.abs((b.box.min.x + b.box.max.x) / 2 - bx) < 31 && Math.abs((b.box.min.z + b.box.max.z) / 2 - av) < 8);
        assert.ok(at.length >= 1, `${size}: a barricade across the avenue at z=${av.toFixed(0)} near x=${bx.toFixed(0)}`);
        const x = (at[0].box.min.x + at[0].box.max.x) / 2;
        assert.ok(!C.crossings.some((c) => Math.abs(c.x - x) < 8 && c.z === av), `${size}: not in an intersection`);
      }
      assert.ok(m.wire.some((w) => Math.abs((w.min.x + w.max.x) / 2 - bx) < 42), `${size}: wire in front of the line at x=${bx.toFixed(0)}`);
    }
  }
});

test('the renderer dresses the city: one instance per building and lamp; the real lights go to the lamps and fires nearest the action', () => {
  const m = cityOf('32v32'), C = m.city, scene = new Scene();
  const planet = { city: { lights: 6 } };
  const R = new CityRenderer(scene, m, { planet });
  assert.ok(R.buildingMesh.count > C.buildings.length, 'the buildings and a skyline beyond the edge');
  assert.equal(R.lampInfo.length, C.lamps.length);
  assert.equal(R.burning.length, C.wrecks.filter((w) => w.burning).length, 'a fire for every burning wreck');
  const lamp = C.lamps.find((l) => l.state === 'on');
  const focus = new Vector3(lamp.x, 0, lamp.z), cam = { position: focus.clone().setY(2) };
  for (let i = 0; i < 20; i++) R.update(1 / 60, cam, focus);
  assert.equal(R.lights.length, 6);
  assert.ok(R.lights.every((l) => l.intensity > 0), 'every lamp light on a lamp');
  const near = Math.min(...R.lights.map((l) => Math.hypot(l.position.x - lamp.x, l.position.z - lamp.z)));
  assert.ok(near < 3, `a real light on the lamp the action is under (${near.toFixed(1)} m)`);
  assert.ok(R.lights.every((l) => l.target.position.y < l.position.y - 5), 'shining down');
  assert.ok(R.fireLights.filter((l) => l.intensity > 0).length === Math.min(R.fireLights.length, R.burning.length), 'the nearest fires burn with real light');
  R.dispose();
  assert.equal(scene.children.filter((o) => o.isLight).length, 0, 'disposed: the lights are gone');
});

test('a match in the city: both sides fight up the streets, nobody ends up inside a building', () => {
  const data = {
    movement: H.movement, weaponFiles: [H.ballistic, H.energy], attachments: H.attachments, recoil: H.recoil, statuses: H.statuses,
    meleeWeapons: H.melee, kits: H.kits, classes: H.classes, damageMatrix: H.matrix, supers: H.supers, vehicleDefs: H.vehicles,
    personalities: H.ai.personalities, difficulty: H.ai.difficulty.veteran, down: H.down,
  };
  const s = new FrontlineSession(data, { players: 24, seed: 5, map: 'city' });
  assert.equal(s.map.theme, 'city'); assert.equal(s.map.name, 'Midtown');
  const ev = { hit: 0, death: 0 };
  const offs = [bus.on('weapon:hit', () => ev.hit++), bus.on('entity:death', () => ev.death++)];
  const T = towers(s.map);
  let total = 0, inWall = 0;
  const steps = 60 * 50;
  for (let i = 0; i < steps; i++) {
    s.step(1 / 60); total += s.stats.simMs;
    if (i % 60) continue;
    for (const f of s.fighters) {
      if (f.health.dead || f.vehicle) continue;
      const p = f.movement.state.position;
      if (T.some((B) => inside(B, p.x, p.z, -0.3) && p.y < B.max.y - 0.5)) inWall++;
    }
  }
  offs.forEach((f) => f());
  for (const f of s.fighters) { const p = f.movement.state.position; assert.ok(Number.isFinite(p.x + p.y + p.z), 'finite positions'); }
  assert.equal(inWall, 0, 'nobody inside a building');
  assert.ok(ev.hit > 30, `a real fight (${ev.hit} hits, ${ev.death} deaths)`);
  const avg = total / steps;
  assert.ok(avg < 8, `${avg.toFixed(2)} ms per tick`);
  s.dispose();
});
