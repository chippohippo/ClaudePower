// Seeded procedural map: named POIs packed with multi-storey buildings (doors, windows, stairs,
// climbable roofs), container yards, rock formations for movement tech, trees, supply bins,
// respawn beacons and loot spawn points. Client and server build identical maps from the seed.

import { makeRng } from './util.js';
import { CollisionWorld } from './physics.js';
import { MAP_HALF } from './constants.js';
import { Terrain } from './terrain.js';

const POI_NAMES = [
  'Rusthaven', 'Signal Peak', 'The Forge', 'Glass Basin', 'Overpass', 'Drillsite', 'Boneyard',
  'Cinder Labs', 'Harbor 9', 'Skyrail', 'Hollow Market', 'Relay Station', 'Sunken Yard', 'Kiln Works',
];

const FLOOR_H = 3.6;
const WALL_T = 0.4;

export function buildMap(seed) {
  const rng = makeRng(seed);
  const world = new CollisionWorld(MAP_HALF + 80);
  const boxes = [];
  const lootPoints = [];
  const bins = [];
  const beacons = [];
  const trees = [];
  const pois = [];
  const buildings = [];
  const zips = [];

  // every structure is built relative to baseY (the terrain height it stands on)
  let baseY = 0;
  let terrain = null;
  const sinkBase = (x0, z0, x1, z1, sink = 0.4) => {
    let m = 1e9;
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [(x0 + x1) / 2, (z0 + z1) / 2]]) m = Math.min(m, terrain.height(x, z));
    return m - sink;
  };
  const add = (x0, y0, z0, x1, y1, z1, kind, color) => {
    y0 += baseY; y1 += baseY;
    const min = [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)];
    const max = [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)];
    const b = world.addBox(min, max, kind);
    b.color = color;
    boxes.push(b);
    return b;
  };

  const blocked = []; // circles {x,z,r} used to avoid overlaps

  const isFree = (x, z, r) => {
    if (Math.abs(x) > MAP_HALF - r - 10 || Math.abs(z) > MAP_HALF - r - 10) return false;
    for (const c of blocked) if (Math.hypot(c.x - x, c.z - z) < c.r + r) return false;
    return true;
  };

  // A wall running along `axis` ('x' or 'z') with rectangular openings cut out.
  function wall(axis, a0, a1, fixed, y0, h, openings, color) {
    const cuts = [a0, a1];
    for (const o of openings) cuts.push(o.a, o.b);
    cuts.sort((p, q) => p - q);
    for (let i = 0; i < cuts.length - 1; i++) {
      const s0 = cuts[i], s1 = cuts[i + 1];
      if (s1 - s0 < 0.01) continue;
      const mid = (s0 + s1) / 2;
      const op = openings.find((o) => mid > o.a && mid < o.b);
      const segs = op ? [[y0, y0 + op.y0], [y0 + op.y1, y0 + h]] : [[y0, y0 + h]];
      for (const [ya, yb] of segs) {
        if (yb - ya < 0.05) continue;
        if (axis === 'x') add(s0, ya, fixed - WALL_T / 2, s1, yb, fixed + WALL_T / 2, 'wall', color);
        else add(fixed - WALL_T / 2, ya, s0, fixed + WALL_T / 2, yb, s1, 'wall', color);
      }
    }
  }

  function makeOpenings(len, floor) {
    const ops = [];
    const n = Math.max(1, Math.floor(len / 6));
    const slots = [];
    for (let i = 0; i < n; i++) slots.push(((i + 0.5) / n) * len);
    for (const c of slots) {
      const door = floor === 0 && rng() < 0.45;
      const w = door ? 1.8 : rng.range(1.4, 2.6);
      if (c - w / 2 < 0.8 || c + w / 2 > len - 0.8) continue;
      if (door) ops.push({ a: c - w / 2, b: c + w / 2, y0: 0, y1: 2.5 });
      else if (rng() < 0.75) ops.push({ a: c - w / 2, b: c + w / 2, y0: 1.0, y1: 2.4 });
    }
    // guarantee at least one door on ground floor walls that are long enough
    if (floor === 0 && !ops.some((o) => o.y0 === 0) && len > 4) {
      const c = len / 2;
      const i = ops.findIndex((o) => Math.abs((o.a + o.b) / 2 - c) < 2);
      if (i >= 0) ops.splice(i, 1);
      ops.push({ a: c - 0.9, b: c + 0.9, y0: 0, y1: 2.5 });
    }
    return ops;
  }

  function building(cx, cz, w, d, floors, tier, palette) {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const color = palette;
    // stairwell along the inside of the +x wall
    const stairW = 1.6, stairRun = 12 * 0.42;
    const sx0 = x1 - WALL_T / 2 - stairW, sx1 = x1 - WALL_T / 2;
    const sz0 = z0 + 1.2, sz1 = sz0 + stairRun;
    for (let f = 0; f < floors; f++) {
      const y = f * FLOOR_H;
      const sideX = (a) => makeOpenings(a, f).map((o) => ({ ...o, a: o.a + x0, b: o.b + x0 }));
      const sideZ = (a) => makeOpenings(a, f).map((o) => ({ ...o, a: o.a + z0, b: o.b + z0 }));
      wall('x', x0, x1, z0, y, FLOOR_H, sideX(w), color);
      wall('x', x0, x1, z1, y, FLOOR_H, sideX(w), color);
      wall('z', z0 + WALL_T / 2, z1 - WALL_T / 2, x0, y, FLOOR_H, sideZ(d), color);
      // stair wall side has fewer openings to keep stairs intact
      wall('z', z0 + WALL_T / 2, z1 - WALL_T / 2, x1, y, FLOOR_H, f === 0 ? sideZ(d).filter((o) => o.a > sz1 + 0.5) : [], color);
      if (f < floors - 1 && d > stairRun + 3) {
        // stairs: 12 steps rising 0.3 each
        for (let i = 0; i < 12; i++) {
          add(sx0, y, sz0 + i * 0.42, sx1, y + 0.3 * (i + 1), sz0 + (i + 1) * 0.42, 'stair', '#6b6f78');
        }
      }
      // floor slab above (with stair hole), or roof
      const top = y + FLOOR_H;
      const slabColor = f === floors - 1 ? '#5a5e66' : '#7a7468';
      const kind = f === floors - 1 ? 'roof' : 'floor';
      if (f < floors - 1 && d > stairRun + 3) {
        add(x0, top, z0, sx0, top + 0.3, z1, kind, slabColor);
        add(sx0, top, sz1, x1, top + 0.3, z1, kind, slabColor);
      } else {
        add(x0, top, z0, x1, top + 0.3, z1, kind, slabColor);
      }
      // loot on this floor
      const nLoot = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < nLoot; i++) {
        lootPoints.push({ x: rng.range(x0 + 1, sx0 - 0.6), y: baseY + y + 0.05, z: rng.range(z0 + 1, z1 - 1), tier });
      }
      // interior partition: splits big floors into rooms with a doorway and a mantle-able window
      if (w > 12) {
        const px = (x0 + sx0) / 2 + rng.range(-1, 1);
        const span = z1 - z0 - WALL_T;
        const dz = rng.range(1.5, span - 3);
        const ops = [{ a: z0 + WALL_T / 2 + dz, b: z0 + WALL_T / 2 + dz + 1.6, y0: 0, y1: 2.5 }];
        if (span > 9) { const wz = dz > span / 2 ? dz - 3.5 : dz + 3; ops.push({ a: z0 + WALL_T / 2 + wz, b: z0 + WALL_T / 2 + wz + 1.6, y0: 1.0, y1: 2.3 }); }
        wall('z', z0 + WALL_T / 2, z1 - WALL_T / 2, px, y, FLOOR_H, ops, color);
      }
      // interior cover crate
      if (rng() < 0.5 && w > 8) {
        const ccx = rng.range(x0 + 2, sx0 - 2), ccz = rng.range(z0 + 2, z1 - 2);
        add(ccx - 0.6, y, ccz - 0.6, ccx + 0.6, y + 1.1, ccz + 0.6, 'crate', '#8b6b43');
      }
    }
    // roof loot sometimes (rewards climbing)
    if (rng() < 0.35) lootPoints.push({ x: cx - 1, y: baseY + floors * FLOOR_H + 0.35, z: cz, tier: tier + 1 });
    buildings.push({ cx, cz, x0, x1, z0, z1, roof: baseY + floors * FLOOR_H + 0.3, floors });
    // balcony on the first upper floor: reach it by mantling out of a window or climbing up
    if (floors >= 2 && rng() < 0.45) {
      const by = FLOOR_H;
      add(x0 + 1, by, z0 - 2.2, x1 - 1, by + 0.25, z0 - WALL_T / 2, 'floor', '#7a7468');
      add(x0 + 1, by + 0.25, z0 - 2.2, x1 - 1, by + 1.15, z0 - 2.0, 'wall', color);
      if (rng() < 0.6) lootPoints.push({ x: (x0 + x1) / 2, y: baseY + by + 0.3, z: z0 - 1.2, tier });
    }
    // parapet
    if (rng() < 0.5) {
      const ty = floors * FLOOR_H + 0.3;
      add(x0, ty, z0 - 0.15, x1, ty + 0.9, z0 + 0.15, 'wall', color);
      add(x0, ty, z1 - 0.15, x1, ty + 0.9, z1 + 0.15, 'wall', color);
    }
  }

  function containerStack(cx, cz, rot) {
    const colors = ['#b5452f', '#2f6db5', '#c79a2c', '#3a8a5a', '#7d3fb5'];
    const L = 6.1, W = 2.45, H = 2.6;
    const n = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const y = i * H;
      const ox = rot ? 0 : rng.range(-0.4, 0.4), oz = rot ? rng.range(-0.4, 0.4) : 0;
      if (rot) add(cx - W / 2 + ox, y, cz - L / 2 + oz, cx + W / 2 + ox, y + H, cz + L / 2 + oz, 'container', rng.pick(colors));
      else add(cx - L / 2 + ox, y, cz - W / 2 + oz, cx + L / 2 + ox, y + H, cz + W / 2 + oz, 'container', rng.pick(colors));
    }
  }

  function rockFormation(cx, cz, scale) {
    // terraced rocks: great for mantles, climbs and wall bounces
    const n = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const w = rng.range(2, 6) * scale, d = rng.range(2, 6) * scale, h = rng.pick([1.2, 2.2, 3.4, 4.6, 6]) * scale;
      const ox = rng.range(-5, 5) * scale, oz = rng.range(-5, 5) * scale;
      add(cx + ox - w / 2, 0, cz + oz - d / 2, cx + ox + w / 2, h, cz + oz + d / 2, 'rock', '#7c7466');
    }
  }

  function tree(x, z) {
    const h = rng.range(7, 13);
    baseY = terrain.height(x, z) - 0.3;
    add(x - 0.3, 0, z - 0.3, x + 0.3, h * 0.6, z + 0.3, 'tree', '#5b4330');
    trees.push({ x, z, h, y: baseY });
  }

  // --- POIs ---
  const poiCount = 12;
  let tries = 0;
  while (pois.length < poiCount && tries++ < 2000) {
    const x = rng.range(-MAP_HALF + 140, MAP_HALF - 140), z = rng.range(-MAP_HALF + 140, MAP_HALF - 140);
    if (pois.some((p) => Math.hypot(p.x - x, p.z - z) < 300)) continue;
    const r = rng.range(70, 105);
    pois.push({ name: POI_NAMES[pois.length], x, z, r, tier: 0 });
  }
  // hot zones: two POIs get top-tier loot
  const order = pois.map((p, i) => i).sort(() => rng() - 0.5);
  pois[order[0]].tier = 2;
  pois[order[1]].tier = 2;
  for (let i = 2; i < 6 && i < pois.length; i++) pois[order[i]].tier = 1;

  // terrain with flattened pads under every POI
  terrain = new Terrain(seed).build(pois.map((p) => ({ x: p.x, z: p.z, r: p.r * 1.05 })));
  world.terrain = terrain;

  const palettes = ['#9b8f7a', '#8a929c', '#a07c62', '#7f8b77', '#a3978b', '#6f7f8f'];
  for (const p of pois) {
    const palette = rng.pick(palettes);
    const style = rng.int(0, 2);
    const nb = 7 + Math.floor(rng() * 6) + (p.tier === 2 ? 3 : 0);
    let placed = 0, t = 0;
    while (placed < nb && t++ < 300) {
      const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * p.r * 0.85;
      const bx = p.x + Math.cos(a) * rr, bz = p.z + Math.sin(a) * rr;
      const w = rng.range(9, 20), d = rng.range(10, 18);
      const rad = Math.hypot(w, d) / 2 + 3;
      if (!isFree(bx, bz, rad)) continue;
      blocked.push({ x: bx, z: bz, r: rad });
      const floors = rng() < 0.15 + p.tier * 0.15 ? 3 : rng() < 0.55 ? 2 : 1;
      baseY = terrain.height(bx, bz);
      building(bx, bz, w, d, floors, p.tier, palette);
      placed++;
    }
    // container yard or rock garden flavour
    const extras = 4 + Math.floor(rng() * 5);
    for (let i = 0; i < extras; i++) {
      const a = rng() * Math.PI * 2, rr = rng.range(0.2, 1.0) * p.r;
      const ex = p.x + Math.cos(a) * rr, ez = p.z + Math.sin(a) * rr;
      if (!isFree(ex, ez, 5)) continue;
      blocked.push({ x: ex, z: ez, r: 5 });
      baseY = sinkBase(ex - 6, ez - 6, ex + 6, ez + 6, 0.1);
      if (style === 0 || rng() < 0.4) containerStack(ex, ez, rng() < 0.5);
      else rockFormation(ex, ez, 0.8);
      const lx = ex + 4.5, lz = ez + rng.range(-2, 2);
      lootPoints.push({ x: lx, y: terrain.height(lx, lz) + 0.05, z: lz, tier: p.tier });
    }
    // low cover walls and barriers: crouch cover that creates third-party angles
    const ncover = 5 + Math.floor(rng() * 5);
    for (let i = 0; i < ncover; i++) {
      const a = rng() * Math.PI * 2, rr = rng.range(0.15, 0.95) * p.r;
      const cx2 = p.x + Math.cos(a) * rr, cz2 = p.z + Math.sin(a) * rr;
      const len = rng.range(2.5, 5);
      if (!isFree(cx2, cz2, len / 2 + 0.5)) continue;
      blocked.push({ x: cx2, z: cz2, r: len / 2 + 0.5 });
      baseY = terrain.height(cx2, cz2);
      const h = rng() < 0.7 ? 1.1 : 1.6;
      if (rng() < 0.5) add(cx2 - len / 2, 0, cz2 - 0.3, cx2 + len / 2, h, cz2 + 0.3, 'rock', '#8a8478');
      else add(cx2 - 0.3, 0, cz2 - len / 2, cx2 + 0.3, h, cz2 + len / 2, 'rock', '#8a8478');
    }
    // supply bins
    const nbins = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < nbins; i++) {
      const a = rng() * Math.PI * 2, rr = rng.range(0.1, 0.9) * p.r;
      const bx = p.x + Math.cos(a) * rr, bz = p.z + Math.sin(a) * rr;
      if (!isFree(bx, bz, 1.5)) continue;
      blocked.push({ x: bx, z: bz, r: 1.5 });
      baseY = terrain.height(bx, bz);
      add(bx - 0.75, 0, bz - 0.45, bx + 0.75, 0.85, bz + 0.45, 'bin', '#2c3440');
      bins.push({ x: bx, y: baseY + 0.85, z: bz, tier: p.tier });
    }
    // respawn beacon near the edge of the POI
    {
      const a = rng() * Math.PI * 2;
      const bx = p.x + Math.cos(a) * (p.r + 12), bz = p.z + Math.sin(a) * (p.r + 12);
      if (isFree(bx, bz, 2.5)) {
        blocked.push({ x: bx, z: bz, r: 2.5 });
        baseY = terrain.height(bx, bz) - 0.2;
        add(bx - 0.5, 0, bz - 0.5, bx + 0.5, 2.6, bz + 0.5, 'beacon', '#1c6dd0');
        beacons.push({ x: bx, y: baseY + 0.2, z: bz });
      }
    }
  }

  // --- wilderness: rock formations, trees, crates, ridges ---
  for (let i = 0; i < 160; i++) {
    const x = rng.range(-MAP_HALF + 30, MAP_HALF - 30), z = rng.range(-MAP_HALF + 30, MAP_HALF - 30);
    if (!isFree(x, z, 10)) continue;
    blocked.push({ x, z, r: 10 });
    const sc = rng.range(0.8, 1.6);
    baseY = sinkBase(x - 8 * sc, z - 8 * sc, x + 8 * sc, z + 8 * sc, 0.5);
    rockFormation(x, z, sc);
    if (rng() < 0.5) { const lx = x + rng.range(-8, 8), lz = z + rng.range(-8, 8); lootPoints.push({ x: lx, y: world.groundAt(lx, lz) + 0.05, z: lz, tier: 0 }); }
  }
  for (let i = 0; i < 700; i++) {
    const x = rng.range(-MAP_HALF + 10, MAP_HALF - 10), z = rng.range(-MAP_HALF + 10, MAP_HALF - 10);
    if (!isFree(x, z, 1.5)) continue;
    tree(x, z);
  }
  for (let i = 0; i < 120; i++) {
    const x = rng.range(-MAP_HALF + 20, MAP_HALF - 20), z = rng.range(-MAP_HALF + 20, MAP_HALF - 20);
    if (!isFree(x, z, 3)) continue;
    blocked.push({ x, z, r: 3 });
    const s = rng.range(1, 1.6);
    baseY = sinkBase(x - s / 2, z - s / 2, x + s / 2, z + s / 2, 0.15);
    add(x - s / 2, 0, z - s / 2, x + s / 2, s, z + s / 2, 'crate', '#8b6b43');
    if (rng() < 0.6) lootPoints.push({ x: x + s, y: terrain.height(x + s, z) + 0.05, z, tier: 0 });
  }
  // a few long walls / ridges as rotation cover
  for (let i = 0; i < 40; i++) {
    const x = rng.range(-MAP_HALF + 40, MAP_HALF - 40), z = rng.range(-MAP_HALF + 40, MAP_HALF - 40);
    if (!isFree(x, z, 14)) continue;
    blocked.push({ x, z, r: 14 });
    const len = rng.range(10, 24), h = rng.range(1.2, 2.6) + 0.6;
    baseY = sinkBase(x - len / 2, z - len / 2, x + len / 2, z + len / 2, 0.6);
    if (rng() < 0.5) add(x - len / 2, 0, z - 0.6, x + len / 2, h, z + 0.6, 'rock', '#867c6c');
    else add(x - 0.6, 0, z - len / 2, x + 0.6, h, z + len / 2, 'rock', '#867c6c');
  }

  world.finalize();

  // --- ziplines ---------------------------------------------------------------
  const tmp = [];
  const clear = (ax, ay, az, bx, by, bz) => {
    const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
    // check the cable and the hanging body below it
    for (const off of [0, -1.0, -1.8]) {
      const h = world.raycast(ax, ay + off, az, dx / L, dy / L, dz / L, L, tmp, false);
      if (h && h.t > 1.5 && h.t < L - 1.5) return false;
    }
    return true;
  };
  for (const p of pois) {
    const bs = buildings.filter((b) => Math.hypot(b.cx - p.x, b.cz - p.z) < p.r * 1.1).sort((a, b) => b.roof - a.roof);
    // vertical zipline up the side of the tallest building
    const tall = bs[0];
    if (tall && tall.floors >= 2) {
      const zx = tall.x0 - 0.9, zz = tall.cz;
      const gy = terrain.height(zx, zz);
      zips.push({ ax: zx, ay: gy + 2.2, az: zz, bx: zx, by: tall.roof + 2.3, bz: zz, top: { x: tall.x0 + 1.4, y: tall.roof + 0.05, z: tall.cz } });
    }
    // roof-to-roof line between two buildings
    let made = 0;
    for (let i = 0; i < bs.length && made < 2; i++) {
      for (let j = i + 1; j < bs.length && made < 2; j++) {
        const a = bs[i], b = bs[j];
        const d = Math.hypot(a.cx - b.cx, a.cz - b.cz);
        if (d < 22 || d > 75 || a.roof < 3.5 || b.roof < 3.5) continue;
        const ay = a.roof + 2.4, by = b.roof + 2.4;
        if (!clear(a.cx, ay, a.cz, b.cx, by, b.cz)) continue;
        zips.push({ ax: a.cx, ay, az: a.cz, bx: b.cx, by, bz: b.cz, roofA: a.roof, roofB: b.roof });
        made++;
      }
    }
  }
  // long wilderness lines between hilltops (rotation routes)
  for (let k = 0, tries = 0; k < 10 && tries < 400; tries++) {
    const ax = rng.range(-MAP_HALF + 60, MAP_HALF - 60), az = rng.range(-MAP_HALF + 60, MAP_HALF - 60);
    const a = rng() * Math.PI * 2, len = rng.range(70, 160);
    const bx = ax + Math.cos(a) * len, bz = az + Math.sin(a) * len;
    if (Math.abs(bx) > MAP_HALF - 40 || Math.abs(bz) > MAP_HALF - 40) continue;
    const ha = terrain.height(ax, az), hb = terrain.height(bx, bz);
    if (Math.max(ha, hb) < terrain.minH + 12 || !isFree(ax, az, 4) || !isFree(bx, bz, 4)) continue;
    const ay = ha + 5.5, by = hb + 5.5;
    if (!clear(ax, ay, az, bx, by, bz)) continue;
    zips.push({ ax, ay, az, bx, by, bz, poles: true });
    k++;
  }
  world.zips = zips;
  return { seed, world, terrain, boxes, pois, lootPoints, bins, beacons, trees, zips };
}
