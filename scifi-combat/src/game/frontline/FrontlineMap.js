// FrontlineMap: seeded generator for big Battlefront-style maps (~1000 x 400 m).
//
// Layout along X: Team 0 HQ | 5 contested sectors | Team 1 HQ, three lanes along Z.
//  * Sectors near the HQs hold 2 points, the middle three hold 3 (one per lane): 13 points.
//  * Every point gets a fortified position: a strongpoint in the middle, a broken ring of low
//    (vaultable) and high walls, and crates. Fights at points read as "take the position".
//  * Lines of battle: staggered trench walls cross the map at every sector boundary, so the
//    front literally has a line to push across, and long open stretches between them are deadly.
//  * Some sectors get large structures (sightline breakers and flanking routes).
//  * Terrain rolls between positions and is flattened under points and spawns.
// Everything is deterministic for a seed, so server and clients build the same map.

import { Vector3 } from 'three';
import { Terrain, mulberry32 } from '../../world/Terrain.js';
import { CoverIndex } from '../../world/CoverIndex.js';
import { NavGrid } from '../../world/NavGrid.js';

const v = (x, y, z) => new Vector3(x, y, z);

export const DEFAULT_LAYOUT = {
  minX: -500, minZ: -200, width: 1000, depth: 400,
  sectors: [
    { kind: 'hq', x0: -500, x1: -400 },
    { x0: -400, x1: -240, lanes: [-70, 70] },
    { x0: -240, x1: -80, lanes: [-110, 0, 110] },
    { x0: -80, x1: 80, lanes: [-110, 0, 110] },
    { x0: 80, x1: 240, lanes: [-110, 0, 110] },
    { x0: 240, x1: 400, lanes: [-70, 70] },
    { kind: 'hq', x0: 400, x1: 500 },
  ],
  pointRadius: 9,
};

/**
 * @returns {{ terrain, cover: CoverIndex, nav: NavGrid, sectors, points, hq, pads, bounds, structures }}
 */
export function generateFrontlineMap({ seed = 1, layout = DEFAULT_LAYOUT, terrainAmp = 7 } = {}) {
  const rand = mulberry32(seed * 7919 + 13);
  const R = (a, b) => a + (b - a) * rand();
  const L = layout;
  const terrain = Terrain.generate({ seed, minX: L.minX, minZ: L.minZ, width: L.width, depth: L.depth, res: 2, amp: terrainAmp });

  // ---- sectors, points, spawns
  const sectors = [], points = [];
  L.sectors.forEach((sd, i) => {
    const cx = (sd.x0 + sd.x1) / 2;
    const sector = { index: i, kind: sd.kind ?? 'line', x0: sd.x0, x1: sd.x1, center: v(cx, 0, 0), points: [], spawns: [[], []], rearSpawns: [[], []] };
    if (sector.kind === 'line') {
      for (const lz of sd.lanes) {
        const p = v(cx + R(-22, 22), 0, lz + R(-14, 14));
        const id = points.length;
        points.push({ id, sector: i, name: `${String.fromCharCode(65 + i - 1)}${sd.lanes.indexOf(lz) + 1}`, pos: p, radius: L.pointRadius });
        sector.points.push(id);
      }
    }
    sectors.push(sector);
  });
  // Spawns: each sector has, per team, a forward group near its edge toward the enemy (used
  // when the fight is in the next sector: a short run to the line) and a rear group (fallback
  // when the forward group is hot).
  for (const s of sectors) {
    const w = s.x1 - s.x0;
    for (const team of [0, 1]) {
      const fwd = team === 0 ? s.x1 - 22 : s.x0 + 22, back = team === 0 ? s.x0 + w * 0.18 : s.x1 - w * 0.18;
      for (const lz of [-120, -40, 40, 120]) {
        s.spawns[team].push(v(fwd + R(-5, 5), 0, lz + R(-10, 10)));
        s.rearSpawns[team].push(v(back + R(-6, 6), 0, lz + R(-10, 10)));
      }
    }
  }
  const hq = [v(L.minX + 50, 0, 0), v(L.minX + L.width - 50, 0, 0)];

  // ---- terrain: readable ground at points, spawns and HQs
  for (const p of points) p.pos.y = terrain.flatten(p.pos.x, p.pos.z, 22);
  const allSpawns = (s, team) => [...s.spawns[team], ...s.rearSpawns[team]];
  for (const s of sectors) for (const team of [0, 1]) for (const sp of allSpawns(s, team)) sp.y = terrain.flatten(sp.x, sp.z, 9);
  for (const h of hq) h.y = terrain.flatten(h.x, h.z, 40, null, 0.75);
  for (const s of sectors) for (const team of [0, 1]) for (const sp of allSpawns(s, team)) sp.y = terrain.height(sp.x, sp.z);
  for (const p of points) p.pos.y = terrain.height(p.pos.x, p.pos.z);

  // ---- cover
  const boxes = [];
  const box = (x, z, w, d, h, opts = {}) => {
    const g = Math.min(terrain.height(x - w / 2, z - d / 2), terrain.height(x + w / 2, z + d / 2), terrain.height(x, z)) - 0.3;
    const top = terrain.height(x, z) + h;
    const b = { min: v(x - w / 2, g, z - d / 2), max: v(x + w / 2, top, z + d / 2), surface: opts.surface ?? 'concrete', destructible: !!opts.destructible, kind: opts.kind ?? 'wall' };
    boxes.push(b);
    return b;
  };
  const spawnPts = sectors.flatMap((s) => [0, 1].flatMap((t) => allSpawns(s, t)));
  const clearOf = (x, z, r) => points.every((p) => Math.hypot(p.pos.x - x, p.pos.z - z) > r) && hq.every((h) => Math.hypot(h.x - x, h.z - z) > 45)
    && spawnPts.every((p) => Math.hypot(p.x - x, p.z - z) > 7);

  // Fortified positions at points.
  for (const p of points) {
    const { x, z } = p.pos;
    box(x + R(-2, 2), z + R(-2, 2), 3, 3, 2.6, { kind: 'strongpoint' });                    // central pillar: cover on the point itself
    const n = 7 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + R(-0.2, 0.2), r = p.radius + R(3, 9);
      const along = a + Math.PI / 2, len = R(3, 6), tall = rand() < 0.35;
      const cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
      // Walls run tangent to the ring: approximate with an axis-aligned box along the dominant axis.
      const horiz = Math.abs(Math.cos(along)) > Math.abs(Math.sin(along));
      box(cx, cz, horiz ? len : 0.6, horiz ? 0.6 : len, tall ? 2.4 : 1.0, { kind: tall ? 'wall' : 'lowwall', destructible: !tall && rand() < 0.5 });
    }
    for (let k = 0; k < 4; k++) {
      const a = R(0, Math.PI * 2), r = R(p.radius * 0.5, p.radius + 14);
      box(x + Math.cos(a) * r, z + Math.sin(a) * r, 1.4, 1.4, 1.3, { kind: 'crate', surface: 'wood', destructible: true });
    }
  }

  // Lines of battle: staggered trench walls along every sector boundary (gaps every ~25 m).
  for (let i = 1; i < sectors.length; i++) {
    const bx = sectors[i].x0;
    for (let z = L.minZ + 30; z < L.minZ + L.depth - 30; z += R(18, 30)) {
      const len = R(8, 16), x = bx + R(-6, 6);
      if (!clearOf(x, z, 26)) continue;
      box(x, z + len / 2, 0.8, len, rand() < 0.75 ? 1.05 : 2.2, { kind: 'trench', destructible: rand() < 0.25 });
    }
  }

  // Large structures in the line sectors (not on points or lanes' direct lines).
  const structures = [];
  for (const s of sectors) {
    if (s.kind !== 'line') continue;
    const count = 2 + Math.floor(rand() * 2);
    for (let k = 0; k < count; k++) {
      const x = R(s.x0 + 25, s.x1 - 25), z = R(L.minZ + 50, L.minZ + L.depth - 50);
      if (!clearOf(x, z, 34)) continue;
      const w = R(10, 18), d = R(8, 14);
      structures.push(box(x, z, w, d, R(5, 9), { kind: 'building' }));
    }
  }

  // Scatter: rocks and crates between positions.
  for (let k = 0; k < 520; k++) {
    const x = R(L.minX + 70, L.minX + L.width - 70), z = R(L.minZ + 30, L.minZ + L.depth - 30);
    if (!clearOf(x, z, 18)) continue;
    const rock = rand() < 0.6;
    box(x, z, rock ? R(1.5, 4) : 1.4, rock ? R(1.5, 4) : 1.4, rock ? R(0.8, 2.6) : 1.3, { kind: rock ? 'rock' : 'crate', surface: rock ? 'rock' : 'wood', destructible: !rock && rand() < 0.6 });
  }

  // HQ walls (protect the spawn from direct fire down the map).
  for (const [i, h] of hq.entries()) {
    const face = i === 0 ? 1 : -1;
    for (const lz of [-60, -20, 20, 60]) box(h.x + face * 28, h.z + lz, 1, 26, 3, { kind: 'wall' });
  }

  const cover = new CoverIndex(boxes, { cell: 8 });
  const nav = new NavGrid({ minX: L.minX, minZ: L.minZ, width: L.width, depth: L.depth, cell: 2 }, { cover, terrain, maxSlope: 38, vaultHeight: 1.1 });

  // Vehicle pads near each HQ: a tank and two bikes per team.
  const pads = [];
  for (const [team, h] of hq.entries()) {
    const f = team === 0 ? 1 : -1, yaw = team === 0 ? -Math.PI / 2 : Math.PI / 2;
    pads.push({ vehicle: team === 0 ? 'solari_lancer_tank' : 'void_crawler_tank', team, at: v(h.x + f * 12, h.y, h.z - 30), yaw, respawn: 45 });
    pads.push({ vehicle: team === 0 ? 'solari_hoverbike' : 'void_skiff', team, at: v(h.x + f * 12, h.y, h.z + 30), yaw, respawn: 20 });
    pads.push({ vehicle: team === 0 ? 'solari_hoverbike' : 'void_skiff', team, at: v(h.x + f * 12, h.y, h.z + 40), yaw, respawn: 20 });
  }
  for (const pad of pads) pad.at.y = terrain.height(pad.at.x, pad.at.z);

  return { seed, terrain, cover, nav, sectors, points, hq, pads, structures, bounds: { minX: L.minX, minZ: L.minZ, maxX: L.minX + L.width, maxZ: L.minZ + L.depth } };
}
