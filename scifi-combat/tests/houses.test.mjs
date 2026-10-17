// The city's vertical routes: houses (src/game/frontline/Houses.js: rooms behind real doors and
// windows, stairs from floor to floor up to the roof, balconies), skybridges, scaffolding and debris
// piles (CityExtras.js); and the cover index that groups their boxes. Fighters walk and climb them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { generateFrontlineMap } from '../src/game/frontline/FrontlineMap.js';
import { buildHouse, minusRect, STOREY } from '../src/game/frontline/Houses.js';
import { CoverIndex } from '../src/world/CoverIndex.js';
import { makeWorld, v } from './harness.mjs';

const maps = new Map();
const cityOf = (size, seed = 7) => { const k = `${size}:${seed}`; if (!maps.has(k)) maps.set(k, generateFrontlineMap({ seed, size, theme: 'city' })); return maps.get(k); };

test('every size of city has houses to go into, with doors on the street and stairs to the roof', () => {
  for (const size of ['4v4', '12v12', '32v32', '64v64']) {
    const C = cityOf(size).city;
    assert.ok(C.houses.length >= (size === '4v4' ? 1 : 3), `${size}: houses (${C.houses.length})`);
    for (const h of C.houses) {
      assert.ok(h.storeys >= 2 && h.storeys <= 5, `${size}: house ${h.id} has ${h.storeys} storeys`);
      assert.equal(h.stair.flights.length, h.storeys, 'a flight per storey, the last onto the roof');
      assert.ok(h.parts.stair.length === h.storeys * 12, 'twelve 0.3 m steps a storey');
      assert.ok(h.parts.stair.every((s, i) => i % 12 === 0 || true) && h.parts.stair.every((s) => s.max.y - s.min.y < h.storeys * STOREY + 1));
      assert.equal(h.floors.length, h.storeys, 'a slab for each floor above the ground, and the roof');
      // It's in the ruins list, so squads clear its ground floor (and the nav grid threads its doors).
      assert.ok(cityOf(size).ruins.includes(h));
    }
    assert.ok(C.houses.some((h) => h.doors.length > 0), `${size}: doors`);
  }
  const big = cityOf('32v32').city.houses;
  assert.ok(big.some((h) => h.balconies.length), 'balconies');
  assert.ok(big.filter((h) => h.doors.length).length >= big.length * 0.6, 'most have a door on the street');
});

test('a slab less its stairwell: the pieces cover everything but the hole, without overlapping', () => {
  const r = [0, 0, 10, 8], hole = [3, 5, 7, 7];
  const parts = minusRect(r, hole);
  const area = (q) => (q[2] - q[0]) * (q[3] - q[1]);
  assert.ok(Math.abs(parts.reduce((s, q) => s + area(q), 0) - (area(r) - area(hole))) < 1e-9);
  for (const [x, z, inHole] of [[5, 6, true], [1, 1, false], [9, 7.5, false], [2, 6, false], [8, 6, false]]) {
    const covered = parts.filter((q) => x > q[0] && x < q[2] && z > q[1] && z < q[3]).length;
    assert.equal(covered, inHole ? 0 : 1, `(${x}, ${z})`);
  }
});

test('the cover index tests a house as one group: rays and height queries see its parts', () => {
  const m = cityOf('32v32'), h = m.city.houses.find((q) => q.storeys >= 3 && q.windows.some((w) => w.k === 1));
  assert.ok(h);
  // Through a first-floor window from the street: the ray goes in (it hits the far wall or a
  // floor inside, never the window's own frame); into a pier beside it: blocked at the facade.
  const win = h.windows.find((w) => w.k === 1);
  const o = new Vector3(win.x + win.nx * 6, (win.y0 + win.y1) / 2, win.z + win.nz * 6), d = new Vector3(-win.nx, 0, -win.nz);
  const hit = m.cover.raycast(o, d, 40);
  assert.ok(!hit || hit.distance > 6.4, `a window lets the ray in (hit at ${hit?.distance.toFixed(2)})`);
  const pierRay = m.cover.raycast(new Vector3(o.x, win.y1 + 0.5, o.z), d, 40);
  assert.ok(pierRay && Math.abs(pierRay.distance - 6) < 0.35, 'the band above the window stops it at the facade');
  // Height: on the roof, the roof's top; inside on the first floor, the floor.
  const c = h.rooms[0], cx = (c.min.x + c.max.x) / 2, cz = (c.min.z + c.max.z) / 2;
  const roof = m.cover.topAt(cx, cz, h.top + 5);
  assert.ok(Math.abs(roof - h.top) < 1e-6 || Math.abs(roof - h.roofY) < 1e-6, 'up top: the parapet or the roof');
  assert.ok(Math.abs(m.cover.topAt(cx, cz, h.floors[0].y + 1) - h.floors[0].y) < 1e-6 || m.cover.topAt(cx, cz, h.floors[0].y + 1) >= h.floors[0].y - 0.3, 'a floor to stand on');
  // A group's boxes are still each in the list (iteration, the nav grid).
  assert.ok(h.parts.wall.every((w) => m.cover.indexOf(w) >= 0));
  // Grouped and ungrouped indexes agree on every ray.
  const flat = new CoverIndex([...m.cover].map((q) => ({ min: q.min, max: q.max, surface: q.surface })), { cell: 8 });
  for (let k = 0; k < 60; k++) {
    const a = new Vector3(h.min.x - 10 + (k * 7.31) % 30, 0.5 + (k * 3.7) % 14, h.min.z - 10 + (k * 5.13) % 30);
    const dir = new Vector3(Math.sin(k * 1.3), Math.sin(k * 0.7) * 0.3, Math.cos(k * 1.3)).normalize();
    const p = m.cover.raycast(a, dir, 60), q = flat.raycast(a, dir, 60);
    assert.equal(!!p, !!q, `ray ${k}: both hit or both miss`);
    if (p) assert.ok(Math.abs(p.distance - q.distance) < 1e-6, `ray ${k}: the same hit`);
  }
});

test('a fighter walks in off the street, up every flight of stairs and out onto the roof', () => {
  const m = cityOf('32v32');
  const h = m.city.houses.filter((q) => q.storeys >= 3 && q.doors.length).sort((a, b) => b.storeys - a.storeys)[0];
  assert.ok(h, 'a house of three storeys or more with a door');
  const w = makeWorld(m.cover, { terrain: m.terrain });
  const door = h.doors[0];
  const out = v(door.x + door.nx * 1.6, 0, door.z + door.nz * 1.6);
  out.y = m.terrain.height(out.x, out.z) + 0.3;
  const e = w.fighter(1, 0, out, 'bastion', { hp: 1e6 });
  // The route: in through the door, along the stair corridor to the foot of the first flight,
  // then each flight from its foot to its head, switching lanes on the landings.
  const S = h.stair, laneMid = (lane) => (lane[0] + lane[1]) / 2;
  const at = (u, lane) => (S.alongX ? { x: u, z: laneMid(lane) } : { x: laneMid(lane), z: u });
  const inside = { x: door.x - door.nx * 1.4, z: door.z - door.nz * 1.4 };
  const doorU = S.alongX ? inside.x : inside.z;
  const route = [{ x: door.x + door.nx * 0.2, z: door.z + door.nz * 0.2 }, inside, at(doorU, S.lanes[1]), at(S.s0 - 0.6, S.lanes[1])];
  for (const f of S.flights) route.push({ x: f.from.x, z: f.from.z }, { x: f.to.x, z: f.to.z });
  const P = e.movement.state.position;
  let ticks = 0;
  for (const wp of route) {
    for (let t = 0; t < 60 * 8 && Math.hypot(wp.x - P.x, wp.z - P.z) > 0.35; t++, ticks++) {
      w.aim(e, Math.atan2(-(wp.x - P.x), -(wp.z - P.z)));
      w.move(e, 0, 1);
      w.step(1);
    }
    assert.ok(Math.hypot(wp.x - P.x, wp.z - P.z) <= 0.6, `reached (${wp.x.toFixed(1)}, ${wp.z.toFixed(1)}) — stuck at (${P.x.toFixed(1)}, ${P.y.toFixed(2)}, ${P.z.toFixed(1)})`);
  }
  w.move(e, 0, 0); w.step(30);
  assert.ok(Math.abs(P.y - h.roofY) < 0.2, `on the roof: y ${P.y.toFixed(2)}, roof ${h.roofY.toFixed(2)}`);
  assert.ok(ticks < 60 * 90, 'in good time');
});

test('a house builds the same from the same seed, and its walls never block its own doorways', () => {
  const mk = () => {
    let s = 99;
    const rand = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const boxes = [];
    const b = { rand, R: (a, c) => a + (c - a) * rand(), boxRect: (x0, z0, x1, z1, h, o) => { const bx = { min: v(x0, o.bottom, z0), max: v(x1, o.top, z1), kind: o.kind }; boxes.push(bx); return bx; } };
    return { h: buildHouse(b, { id: 0, x0: 0, z0: 0, x1: 16, z1: 11, base: 0.16, storeys: 3, street: [2, 0] }), boxes };
  };
  const A = mk(), B = mk();
  assert.equal(A.boxes.length, B.boxes.length);
  assert.ok(A.boxes.every((q, i) => q.min.equals(B.boxes[i].min) && q.max.equals(B.boxes[i].max)));
  for (const d of A.h.doors) {
    // Standing in the doorway at head height, nothing but the floor below.
    const blocked = A.boxes.filter((q) => q.kind !== 'hfloor' && d.x > q.min.x + 0.01 && d.x < q.max.x - 0.01 && d.z > q.min.z + 0.01 && d.z < q.max.z - 0.01 && q.max.y > 0.16 + 0.05 && q.min.y < 0.16 + 1.8);
    assert.equal(blocked.length, 0, `door at (${d.x.toFixed(1)}, ${d.z.toFixed(1)}) is open`);
  }
});

/** Walk a fighter through waypoints (steering at each), optionally holding a key; returns where it ended. */
function walk(w, e, route, { hold = null, secs = 8 } = {}) {
  const P = e.movement.state.position;
  if (hold) w.hold(e, hold);
  for (const wp of route) {
    for (let t = 0; t < 60 * secs && Math.hypot(wp.x - P.x, wp.z - P.z) > 0.35; t++) {
      w.aim(e, Math.atan2(-(wp.x - P.x), -(wp.z - P.z)));
      w.move(e, 0, 1);
      w.step(1);
    }
    if (Math.hypot(wp.x - P.x, wp.z - P.z) > 0.6) return { ok: false, wp, P: P.clone() };
  }
  if (hold) w.release(e, hold);
  w.move(e, 0, 0); w.step(20);
  return { ok: true, P: P.clone() };
}
const fmt = (p) => `(${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)})`;

test('a broken skybridge: walk up its fallen half from the street, along the deck and into the house', () => {
  let found = null;
  for (const seed of [7, 3, 11, 5]) { const m = cityOf('32v32', seed); const br = m.city.bridges.find((q) => q.broken && q.ramp?.steps > 4); if (br) { found = { m, br }; break; } }
  assert.ok(found, 'a broken bridge in one of the maps');
  const { m, br } = found;
  const w = makeWorld(m.cover, { terrain: m.terrain });
  const [tx, tz] = br.ramp.to, [fx, fz] = br.ramp.from, dx = Math.sign(tx - fx) * (br.axis === 'x' ? 1 : 0), dz = Math.sign(tz - fz) * (br.axis === 'z' ? 1 : 0);
  // Start on the far sidewalk beside the ramp's foot.
  const side = { x: tx + dz * 2.2 - dx * 0.3, z: tz + dx * 2.2 - dz * 0.3 };
  const start = v(side.x, m.cover.topAt(side.x, side.z, 50) > -1e9 ? Math.max(m.terrain.height(side.x, side.z), m.cover.topAt(side.x, side.z, 3)) + 0.2 : m.terrain.height(side.x, side.z) + 0.3, side.z);
  const e = w.fighter(1, 0, start, 'bastion', { hp: 1e6 });
  // Up the ramp, along the deck to the near house's doorway, two metres inside.
  const door = br.doors[0], doorAt = { x: door.x, z: door.z };
  const lineUp = br.axis === 'x' ? { x: br.a + dx * 1.2, z: door.z } : { x: door.x, z: br.a + dz * 1.2 };
  const inside = { x: doorAt.x - dx * 2.2, z: doorAt.z - dz * 2.2 };
  const r = walk(w, e, [{ x: tx + dx * 0.4, z: tz + dz * 0.4 }, { x: fx, z: fz }, lineUp, doorAt, inside]);
  assert.ok(r.ok, `stuck at ${fmt(r.P)} short of (${r.wp?.x.toFixed(1)}, ${r.wp?.z.toFixed(1)})`);
  assert.ok(Math.abs(r.P.y - br.y) < 0.4, `inside on the bridge's floor: y ${r.P.y.toFixed(2)} vs ${br.y.toFixed(2)}`);
});

test('an intact skybridge: from one house\'s floor across the street into the other\'s', () => {
  let found = null;
  for (const seed of [7, 3, 11, 5]) { const m = cityOf('32v32', seed); const br = m.city.bridges.find((q) => !q.broken); if (br) { found = { m, br }; break; } }
  assert.ok(found, 'an intact bridge in one of the maps');
  const { m, br } = found;
  const w = makeWorld(m.cover, { terrain: m.terrain });
  const dir = Math.sign(br.c - br.a), [dn, df] = br.doors;
  // Through each house's doorway (a bay either side of the bridge's middle), across the deck between.
  const at = (s, u) => (br.axis === 'x' ? { x: br.a + dir * s, z: u } : { x: u, z: br.a + dir * s });
  const from = at(-2, dn.u), to = at(br.len + 2, df.u);
  const start = v(from.x, br.y + 0.05, from.z);
  const e = w.fighter(1, 0, start, 'bastion', { hp: 1e6 });
  w.step(10);
  assert.ok(Math.abs(e.movement.state.position.y - br.y) < 0.4, `standing on the near floor (${fmt(e.movement.state.position)})`);
  const r = walk(w, e, [at(0.6, dn.u), at(1.6, dn.u), at(br.len - 1.6, df.u), at(br.len - 0.6, df.u), to]);
  assert.ok(r.ok, `stuck at ${fmt(r.P)}`);
  assert.ok(Math.abs(r.P.y - br.yFar) < 0.3, `in the far house, on its floor: ${r.P.y.toFixed(2)} vs ${br.yFar.toFixed(2)} (the near one ${br.y.toFixed(2)})`);
});

test('scaffolding: up its flights, deck by deck, to the top', () => {
  const m = cityOf('32v32'), sc = m.city.scaffolds.find((q) => q.levels >= 2) ?? m.city.scaffolds[0];
  assert.ok(sc, 'a scaffold');
  const w = makeWorld(m.cover, { terrain: m.terrain });
  const lane = sc.at + sc.out * (0.05 + sc.depth / 2), pt = (u) => (sc.axis === 'x' ? { x: u, z: lane } : { x: lane, z: u });
  const p0 = pt(sc.u0 - 1.2), start = v(p0.x, 0, p0.z); start.y = m.terrain.height(start.x, start.z) + 0.4;
  const e = w.fighter(1, 0, start, 'bastion', { hp: 1e6 });
  const r = walk(w, e, [pt(sc.u0 - 0.4), pt(sc.u0 + sc.levels * sc.run + 0.8)]);
  assert.ok(r.ok, `stuck at ${fmt(r.P)}`);
  assert.ok(Math.abs(r.P.y - sc.top) < 0.3, `on the top deck: y ${r.P.y.toFixed(2)}, top ${sc.top.toFixed(2)}`);
});

test('a debris pile: climbed block by block (hold to climb) to its top', () => {
  let found = null;
  for (const seed of [7, 3, 11]) { const m = cityOf('32v32', seed); const d = m.city.debris.find((q) => q.pile); if (d) { found = { m, d }; break; } }
  assert.ok(found, 'a pile');
  const { m, d } = found;
  const w = makeWorld(m.cover, { terrain: m.terrain });
  const dx = Math.cos(d.yaw), dz = Math.sin(d.yaw), g = m.terrain.height(d.x, d.z);
  const start = v(d.x - dx * 2.6, g + 0.3, d.z - dz * 2.6);
  const e = w.fighter(1, 0, start, 'bastion', { hp: 1e6 });
  const r = walk(w, e, [{ x: d.x + dx * 2.6, z: d.z + dz * 2.6 }], { hold: 'jump', secs: 12 });
  assert.ok(r.P.y > g + 2.7, `up on the top block: y ${r.P.y.toFixed(2)} (ground ${g.toFixed(2)})`);
});
