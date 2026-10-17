// FrontlineMap: seeded generator for the frontline battlefields, one built for each match size
// (MapSizes.js: 4v4 Outpost 260 m up to 64v64 Frontline 1.4 km). Deterministic per seed, so the
// server and every client build the same map.
//
// Layout along X: Team 0 HQ | line sectors | Team 1 HQ, capture points on lanes along Z.
//  * Terrain (1 m samples): rolling ground at the size's amplitude, flattened under points,
//    spawns and HQs, and cratered across no-man's-land (the neutral middle most of all).
//  * WW1 trench lines (Trenches.js) along every boundary between line sectors: zigzag fire bays
//    behind sandbag parapets, communication trenches and dugouts, exits for going over the top,
//    and wire belts in front of them (slow to cross, bots path around them).
//  * Fortified points: a strongpoint and a broken ring of walls around every capture point.
//  * Villages (Ruins.js): ruined buildings with rooms and doorways around chosen sectors' points.
//  * Blockhouses, scatter (rocks, crates), HQ walls, and a motor pool per line sector and team
//    where that team's vehicle pads stand while the sector is its front.
//  * Forward bases (sizes with `support`): per line sector and team, a supply depot and an
//    artillery park in the rear of the sector (the team uses the ones in its front sector), and a
//    supply dump at each HQ where the trucks load. Field guns start in the park of the team's
//    starting front sector (howitzers and rockets in the front row, AT guns behind), trucks at
//    the HQ dump.
// All terrain changes come first, then every box is placed on the finished ground.

import { Vector3 } from 'three';
import { Terrain, mulberry32 } from '../../world/Terrain.js';
import { CoverIndex } from '../../world/CoverIndex.js';
import { NavGrid } from '../../world/NavGrid.js';
import { mapSizeFor } from './MapSizes.js';
import { buildTrenchLine } from './Trenches.js';
import { buildRuin } from './Ruins.js';

const v = (x, y, z) => new Vector3(x, y, z);
const alignOdd = (x, origin) => { const r = Math.round(x); return (r - origin) % 2 === 0 ? r + 1 : r; };
const VEHICLES = {
  tank: ['solari_lancer_tank', 'void_crawler_tank'], hoverbike: ['solari_hoverbike', 'void_skiff'],
  howitzer: ['solari_field_gun', 'void_field_gun'], rockets: ['solari_rocket_battery', 'void_rocket_battery'],
  at: ['solari_at_gun', 'void_at_gun'], truck: ['solari_supply_truck', 'void_supply_truck'],
};
const RESPAWN = { tank: 45, hoverbike: 20, howitzer: 60, rockets: 60, at: 40, truck: 25 };
const GUN_GAP = 13;          // metres between guns in a park row
const PARK_ROWS = 12;        // metres between a park's front row (field guns) and back row (AT guns)

/**
 * Where gun `i` of `n` in a park's row goes: row 0 (field guns, facing the enemy) or row 1 (AT
 * guns, PARK_ROWS behind). `slot` packs (row, i) into one number for the pad.
 */
export function parkSlot(pk, team, row, i, n) {
  const back = row ? (team === 0 ? -PARK_ROWS : PARK_ROWS) : 0;
  return { slot: row * 100 + i, at: v(pk.x + back, 0, pk.z + (i - (n - 1) / 2) * GUN_GAP) };
}

/** Every doorway of every ruin once (interior doors are listed by both rooms). */
function doorways(ruins) {
  const out = [];
  for (const r of ruins) for (const room of r.rooms) for (const d of room.doors) {
    if (!out.some((q) => Math.abs(q.x - d.x) < 0.01 && Math.abs(q.z - d.z) < 0.01)) out.push({ x: d.x, z: d.z, nx: d.nx, nz: d.nz });
  }
  return out;
}

/**
 * @param {object} o { seed, size: '4v4' | '12v12' | '32v32' | '64v64', layout (a MapSizes-style profile) }
 * @returns {{ size, name, terrain, cover: CoverIndex, nav: NavGrid, sectors (with .pool[team], .depot[team], .park[team]), points, hq, hqDepot, pads, padGap, trenches, ruins, wire, craters, structures, support, bounds }}
 */
export function generateFrontlineMap({ seed = 1, size = '32v32', layout = null } = {}) {
  const P = layout ?? mapSizeFor(size);
  const rand = mulberry32(seed * 7919 + 13);
  const R = (a, b) => a + (b - a) * rand();
  const maxX = P.minX + P.width, maxZ = P.minZ + P.depth;
  // Berms rise along the map edges (narrower on small maps, so the fight still has room).
  const berm = Math.min(30, P.depth * 0.12);
  const terrain = Terrain.generate({ seed, minX: P.minX, minZ: P.minZ, width: P.width, depth: P.depth, res: 1, amp: P.terrainAmp, berm });
  const boxes = [];
  const b = {
    terrain, rand, R, boxes,
    /** Axis-aligned box on the ground: `h` above the ground at its centre (or opts.top / opts.bottom absolute). */
    boxRect(x0, z0, x1, z1, h, opts = {}) {
      const g0 = terrain.height(x0, z0), g1 = terrain.height(x1, z0), g2 = terrain.height(x0, z1), g3 = terrain.height(x1, z1);
      const gm = terrain.height((x0 + x1) / 2, (z0 + z1) / 2);
      const box = {
        min: v(x0, opts.bottom ?? Math.min(g0, g1, g2, g3, gm) - 0.25, z0), max: v(x1, opts.top ?? gm + h, z1),
        surface: opts.surface ?? 'concrete', destructible: !!opts.destructible, kind: opts.kind ?? 'wall',
      };
      if (opts.trench !== undefined) box.trench = opts.trench;
      boxes.push(box);
      return box;
    },
  };
  const boxC = (x, z, w, d, h, opts) => b.boxRect(x - w / 2, z - d / 2, x + w / 2, z + d / 2, h, opts);

  // ---- sectors, points, spawns
  const sectors = [], points = [];
  const lineSectors = P.sectors.filter((s) => s.kind === 'line').length;
  P.sectors.forEach((sd, i) => {
    const cx = (sd.x0 + sd.x1) / 2, sw = sd.x1 - sd.x0;
    const sector = { index: i, kind: sd.kind, x0: sd.x0, x1: sd.x1, center: v(cx, 0, 0), points: [], spawns: [[], []], rearSpawns: [[], []] };
    if (sd.kind === 'line') {
      sd.lanes.forEach((lz, li) => {
        const jx = Math.min(22, sw * 0.14), jz = Math.min(14, P.depth * 0.05);
        const p = v(cx + R(-jx, jx), 0, lz + R(-jz, jz));
        const id = points.length;
        points.push({ id, sector: i, name: `${String.fromCharCode(64 + i)}${li + 1}`, pos: p, radius: P.pointRadius });
        sector.points.push(id);
      });
    }
    sectors.push(sector);
  });
  // Each sector has, per team, a forward spawn group near its edge toward the enemy (a short run
  // to the line) and a rear group (fallback when the forward one is hot).
  const lanesZ = [-0.3, -0.1, 0.1, 0.3].map((f) => f * P.depth);
  for (const s of sectors) {
    const w = s.x1 - s.x0, inset = Math.min(22, w * 0.18);
    for (const team of [0, 1]) {
      const fwd = team === 0 ? s.x1 - inset : s.x0 + inset, back = team === 0 ? s.x0 + w * 0.18 : s.x1 - w * 0.18;
      for (const lz of lanesZ) {
        s.spawns[team].push(v(fwd + R(-3, 3), 0, lz + R(-6, 6)));
        s.rearSpawns[team].push(v(back + R(-4, 4), 0, lz + R(-6, 6)));
      }
    }
  }
  const hqSec = [sectors[0], sectors[sectors.length - 1]];
  const hq = [v((hqSec[0].x0 + hqSec[0].x1) / 2, 0, 0), v((hqSec[1].x0 + hqSec[1].x1) / 2, 0, 0)];
  const hqR = Math.min(40, (hqSec[0].x1 - hqSec[0].x0) * 0.6);

  // Motor pools: each line sector has, per team, a cleared and levelled patch toward that team's
  // side where its vehicle pads stand while the sector is its front (the pool moves up with the
  // line, so tanks and bikes respawn where the fighting is, not at a far-off HQ).
  const S = P.support ?? null;
  const nPads = P.pads.reduce((a, [, c]) => a + c, 0), padGap = 9;
  for (const s of sectors) {
    s.pool = [null, null];
    if (s.kind !== 'line' || !nPads) continue;
    const w = s.x1 - s.x0, inset = Math.max(12, Math.min(30, w * 0.2));
    for (const team of [0, 1]) s.pool[team] = v(team === 0 ? s.x0 + inset : s.x1 - inset, 0, 0);
  }

  // ---- terrain: readable ground at points, spawns, HQs and motor pools
  const allSpawns = (s, team) => [...s.spawns[team], ...s.rearSpawns[team]];
  const parkGuns = S ? S.guns.filter(([k]) => k !== 'at').reduce((a, [, c]) => a + c, 0) : 0;
  const parkAT = S ? S.guns.filter(([k]) => k === 'at').reduce((a, [, c]) => a + c, 0) : 0;
  for (const p of points) terrain.flatten(p.pos.x, p.pos.z, P.pointRadius * 2.4);
  for (const s of sectors) for (const team of [0, 1]) for (const sp of allSpawns(s, team)) terrain.flatten(sp.x, sp.z, 8);
  for (const h of hq) terrain.flatten(h.x, h.z, hqR, null, 0.75);
  const poolHalf = ((nPads - 1) / 2) * padGap + 7;
  for (const s of sectors) for (const team of [0, 1]) {
    const c = s.pool?.[team];
    if (!c) continue;
    for (let z = -poolHalf; z <= poolHalf; z += 6) terrain.flatten(c.x, c.z + z, 10, terrain.height(c.x, c.z), 0.7);
  }

  // Trench lines sit on every boundary between two line sectors.
  const trenchX = [];
  for (let i = 1; i < sectors.length - 2; i++) if (sectors[i].kind === 'line' && sectors[i + 1].kind === 'line') trenchX.push(sectors[i].x1);
  const spawnPts = sectors.flatMap((s) => [0, 1].flatMap((t) => allSpawns(s, t)));
  const ruinsAt = [];   // occupied ground nothing else is built on (ruins, motor pools, trench works)
  for (const s of sectors) for (const c of s.pool ?? []) if (c) ruinsAt.push({ x0: c.x - 9, z0: c.z - poolHalf, x1: c.x + 9, z1: c.z + poolHalf });
  // Is a square of half-size r at (x, z) clear of points, HQs, spawns, trench lines and ruins?
  const clearOf = (x, z, r, { trench = 0 } = {}) => points.every((p) => Math.hypot(p.pos.x - x, p.pos.z - z) > r + p.radius)
    && hq.every((h) => Math.hypot(h.x - x, h.z - z) > hqR + 4) && spawnPts.every((p) => Math.hypot(p.x - x, p.z - z) > r + 4)
    && trenchX.every((tx) => Math.abs(tx - x) > trench) && ruinsAt.every((q) => x + r < q.x0 - 2 || x - r > q.x1 + 2 || z + r < q.z0 - 2 || z - r > q.z1 + 2)
    && z > P.minZ + 10 && z < maxZ - 10 && x > P.minX + 6 && x < maxX - 6;
  // Trench works (communication trenches, dugouts) keep out of spawns, points, HQs and ruins.
  const workClear = (x0, z0, x1, z1) => {
    const near = (px, pz, r) => px > x0 - r && px < x1 + r && pz > z0 - r && pz < z1 + r;
    return !points.some((p) => near(p.pos.x, p.pos.z, p.radius + 10)) && !spawnPts.some((p) => near(p.x, p.z, 7))
      && !hq.some((h) => near(h.x, h.z, hqR + 4)) && !ruinsAt.some((q) => !(x1 < q.x0 - 5 || x0 > q.x1 + 5 || z1 < q.z0 - 5 || z0 > q.z1 + 5))
      && z0 > P.minZ + berm && z1 < maxZ - berm;
  };

  // ---- forward bases: a supply depot and an artillery park per line sector and team, in the
  // rear of the sector (team 0's rear is west), clear of points, spawns, pools and each other;
  // and a supply dump beside each HQ.
  const hqDepot = [null, null];
  if (S) {
    const rearX = (sec, team, f) => (team === 0 ? sec.x0 + (sec.x1 - sec.x0) * f : sec.x1 - (sec.x1 - sec.x0) * f);
    const fits = (x, z, len, r) => { for (let k = -len / 2; k <= len / 2 + 1e-6; k += Math.max(1, Math.min(6, len / 2 || 1))) if (!clearOf(x, z + k, r)) return false; return true; };
    // Tight sectors (12v12) get a second, wider pass with a slightly smaller footprint.
    const find = (sec, team, len, r, sides) => {
      for (const [rr, fs, cs] of [[r, [0.22, 0.3, 0.16, 0.38], [0.2, 0.27, 0.13, 0.33, 0.07]], [r * 0.8, [0.22, 0.3, 0.38, 0.46, 0.14], [0.2, 0.27, 0.34, 0.13, 0.4, 0.07, 0]]]) {
        for (const f of fs) for (const c of cs) for (const side of sides) {
          const x = rearX(sec, team, f), z = side * c * P.depth;
          if (Math.abs(z) + len / 2 + rr > P.depth / 2 - berm - 4) continue;
          if (fits(x, z, len, rr)) return v(x, 0, z);
        }
      }
      return null;
    };
    const parkLen = Math.max(0, Math.max(parkGuns, parkAT) - 1) * GUN_GAP;
    for (const sec of sectors) {
      sec.depot = [null, null]; sec.park = [null, null];
      if (sec.kind !== 'line') continue;
      for (const team of [0, 1]) {
        const d = find(sec, team, 0, 13, team === 0 ? [1, -1] : [-1, 1]);
        if (d) { sec.depot[team] = d; ruinsAt.push({ x0: d.x - 14, z0: d.z - 14, x1: d.x + 14, z1: d.z + 14 }); }
        if (!parkGuns && !parkAT) continue;
        // Searched as one strip around the middle of the two rows; the front row faces the enemy.
        // Same side as the depot first: ammo has less far to go.
        const mid = find(sec, team, parkLen, 9 + PARK_ROWS / 2, d ? [Math.sign(d.z) || 1, -Math.sign(d.z) || -1] : [-1, 1]);
        if (mid) {
          const fwd = team === 0 ? 1 : -1;
          sec.park[team] = v(mid.x + fwd * PARK_ROWS / 2, 0, mid.z);
          ruinsAt.push({ x0: mid.x - 16, z0: mid.z - parkLen / 2 - 10, x1: mid.x + 16, z1: mid.z + parkLen / 2 + 10 });
        }
      }
    }
    for (const team of [0, 1]) {
      const h = hq[team], dz = Math.min(28, hqR * 0.7);
      hqDepot[team] = v(h.x, 0, h.z + dz);
    }
    for (const sec of sectors) for (const team of [0, 1]) {
      const d = sec.depot?.[team], pk = sec.park?.[team];
      if (d) terrain.flatten(d.x, d.z, 15, terrain.height(d.x, d.z), 0.7);
      const back = team === 0 ? -PARK_ROWS : PARK_ROWS;
      if (pk) for (let k = -parkLen / 2; k <= parkLen / 2 + 1e-6; k += 6) for (const dx of [0, back / 2, back]) terrain.flatten(pk.x + dx, pk.z + k, 10, terrain.height(pk.x, pk.z), 0.7);
    }
  }

  // Villages are laid out first (their footprints keep craters and scatter away).
  const villagePlans = [];
  for (const si of P.villages) {
    const sec = sectors[si];
    if (!sec || sec.kind !== 'line') continue;
    for (const pid of sec.points) {
      const p = points[pid], n = Math.round(R(P.ruinsPerVillage[0], P.ruinsPerVillage[1] + 0.99));
      for (let k = 0, tries = 0; k < n && tries < n * 12; tries++) {
        const a = R(0, Math.PI * 2), r = R(p.radius + 9, p.radius + 34);
        const w0 = R(8, 13), d0 = R(7, 10), [w, d] = rand() < 0.5 ? [w0, d0] : [d0, w0];
        const x = p.pos.x + Math.cos(a) * r, z = p.pos.z + Math.sin(a) * r;
        const rect = { x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 };
        if (x < sec.x0 + 6 || x > sec.x1 - 6 || !clearOf(x, z, Math.max(w, d) * 0.5 + 3, { trench: 14 + Math.max(w, d) / 2 })) continue;
        ruinsAt.push(rect); villagePlans.push({ x, z, w, d }); k++;
        terrain.flatten(x, z, Math.max(w, d) * 0.75, null, 0.8);
      }
    }
  }

  // Shell craters across the line sectors, twice as dense in the neutral middle (no-man's-land).
  const craters = [];
  const mid = Math.floor((sectors.length - 1) / 2);
  for (const s of sectors) {
    if (s.kind !== 'line') continue;
    const ha = ((s.x1 - s.x0) * P.depth) / 10000, n = Math.round(ha * P.craters * (s.index === mid ? 2 : 1));
    for (let k = 0; k < n; k++) {
      const x = R(s.x0 + 4, s.x1 - 4), z = R(P.minZ + 14, maxZ - 14), r = R(1.4, 3.4);
      if (!clearOf(x, z, r + 6, { trench: r + 9 })) continue;
      terrain.carveDisc(x, z, r, r * R(0.3, 0.42), 0.22);
      craters.push({ x, z, r });
    }
  }

  // ---- WW1 trench lines (dig, then sandbag)
  // Lines sit on the 2 m nav grid: the 2 m floor is one column of nav cells (x - minX odd, so
  // x ± 1 are cell edges) and every traverse one row (z0 - minZ odd).
  const tz0 = P.minZ + Math.ceil(berm) + 3, trenchZ0 = (tz0 - P.minZ) % 2 === 0 ? tz0 + 1 : tz0;
  const trenches = trenchX.map((tx, i) => buildTrenchLine(b, {
    id: i, x: alignOdd(tx - P.trenches.jog / 2, P.minX), z0: trenchZ0, z1: maxZ - Math.ceil(berm) - 3, clear: workClear,
    bay: P.trenches.bay, jog: P.trenches.jog, comms: P.trenches.comms, dugouts: P.trenches.dugouts, exits: P.trenches.exits,
  }));
  // Communication trenches, dugouts and exits are occupied ground from here on: nothing is built
  // on them, and no wire is strung across them.
  const works = [];
  for (const T of trenches) {
    for (const [a, c, e, f, kind] of T.corridors) if (kind === 'comm' || kind === 'dugout') works.push({ x0: a - 2, z0: c - 2, x1: e + 2, z1: f + 2 });
    for (const e of T.exits) works.push({ x0: e.x - 2.5, z0: e.z - 2.5, x1: e.x + 2.5, z1: e.z + 2.5 });
  }
  ruinsAt.push(...works);
  const onWorks = (x0, z0, x1, z1) => works.some((q) => !(x1 < q.x0 || x0 > q.x1 || z1 < q.z0 || z0 > q.z1));
  // Wire belts in front of both sides of every trench line, with gaps to cross through.
  const wire = [];
  for (const T of trenches) {
    for (const side of [-1, 1]) {
      const wx = T.x + P.trenches.jog / 2 + side * R(11, 14);
      for (let z = T.z0 + R(0, 6); z < T.z1 - 6;) {
        const len = R(7, 13), ze = Math.min(T.z1, z + len);
        if (rand() < P.trenches.wire && clearOf(wx, z + len / 2, 2) && !onWorks(wx - 0.8, z, wx + 0.8, ze)) wire.push({ min: { x: wx - 0.8, z }, max: { x: wx + 0.8, z: ze } });
        z += len + R(4, 8);
      }
    }
  }

  // ---- fortified positions at points
  for (const p of points) {
    const { x, z } = p.pos, rr = p.radius;
    boxC(x + R(-1.5, 1.5), z + R(-1.5, 1.5), 3, 3, 2.6, { kind: 'strongpoint' });   // cover on the point itself
    const n = 7 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + R(-0.2, 0.2), r = rr + R(3, 8);
      const along = a + Math.PI / 2, len = R(3, 6), tall = rand() < 0.35;
      const cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
      const horiz = Math.abs(Math.cos(along)) > Math.abs(Math.sin(along));
      if (ruinsAt.some((q) => cx > q.x0 - 1 && cx < q.x1 + 1 && cz > q.z0 - 1 && cz < q.z1 + 1)) continue;
      if (spawnPts.some((q) => Math.hypot(q.x - cx, q.z - cz) < len / 2 + 3.5)) continue;   // never wall in a spawn
      boxC(cx, cz, horiz ? len : 0.6, horiz ? 0.6 : len, tall ? 2.4 : 1.0, { kind: tall ? 'wall' : 'lowwall', destructible: !tall && rand() < 0.5, surface: tall ? 'concrete' : 'sandbag' });
    }
    for (let k = 0; k < 3; k++) {
      const a = R(0, Math.PI * 2), r = R(rr * 0.5, rr + 10), cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
      if (spawnPts.some((q) => Math.hypot(q.x - cx, q.z - cz) < 3.5)) continue;
      if (ruinsAt.some((q) => cx > q.x0 - 1 && cx < q.x1 + 1 && cz > q.z0 - 1 && cz < q.z1 + 1)) continue;
      boxC(cx, cz, 1.4, 1.4, 1.3, { kind: 'crate', surface: 'wood', destructible: true });
    }
  }

  // ---- villages: ruined buildings with rooms
  const ruins = villagePlans.map((r, i) => buildRuin(b, { id: i, ...r }));

  // ---- blockhouses (sightline breakers and flanking routes)
  const structures = [];
  for (const s of sectors) {
    if (s.kind !== 'line') continue;
    for (let k = 0, tries = 0; k < P.structures && tries < 20; tries++) {
      const x = R(s.x0 + 20, s.x1 - 20), z = R(P.minZ + 40, maxZ - 40), w = R(9, 15), d = R(7, 12);
      if (!clearOf(x, z, Math.max(w, d) * 0.5 + 8, { trench: Math.max(w, d) / 2 + 12 })) continue;
      structures.push(boxC(x, z, w, d, R(4, 7), { kind: 'building' }));
      ruinsAt.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 });
      k++;
    }
  }

  // ---- scatter: rocks and crates
  const scatter = Math.round(((P.width - 2 * hqR) * P.depth / 10000) * P.scatterPerHa);
  for (let k = 0; k < scatter; k++) {
    const x = R(P.minX + hqR * 1.6, maxX - hqR * 1.6), z = R(P.minZ + 14, maxZ - 14);
    if (!clearOf(x, z, 10, { trench: 10 }) || wire.some((w) => x > w.min.x - 2 && x < w.max.x + 2 && z > w.min.z - 2 && z < w.max.z + 2)) continue;
    const rock = rand() < 0.6;
    boxC(x, z, rock ? R(1.5, 3.5) : 1.4, rock ? R(1.5, 3.5) : 1.4, rock ? R(0.8, 2.4) : 1.3, { kind: rock ? 'rock' : 'crate', surface: rock ? 'rock' : 'wood', destructible: !rock && rand() < 0.6 });
  }

  // ---- supply dumps: crate stacks along the sides of every depot site, open front and back for
  // the trucks (destructible: shells scatter them)
  if (S) {
    const dump = (c, n) => {
      for (const side of [-1, 1]) for (let k = 0; k < n; k++) {
        const x = c.x + (k - (n - 1) / 2) * 3.2 + R(-0.4, 0.4), z = c.z + side * R(9, 10.5);
        boxC(x, z, R(1.5, 2.2), R(1.4, 1.9), R(1.1, 1.8), { kind: 'supply', surface: 'wood', destructible: true });
      }
    };
    for (const sec of sectors) for (const d of sec.depot ?? []) if (d) dump(d, 4);
    for (const d of hqDepot) if (d) dump(d, 5);
  }

  // ---- HQ walls (protect the spawn from direct fire down the map)
  for (const [i, h] of hq.entries()) {
    const face = i === 0 ? 1 : -1;
    for (const f of [-0.3, -0.1, 0.1, 0.3]) boxC(h.x + face * hqR * 0.7, h.z + f * P.depth, 1, P.depth * 0.13, 3, { kind: 'wall' });
  }

  const cover = new CoverIndex(boxes, { cell: 8 });
  const nav = new NavGrid({ minX: P.minX, minZ: P.minZ, width: P.width, depth: P.depth, cell: 2 }, {
    cover, terrain, maxSlope: 38, vaultHeight: 1.1,
    zones: wire.map((w) => ({ minX: w.min.x, minZ: w.min.z, maxX: w.max.x, maxZ: w.max.z, cost: 8 })),
    portals: doorways(ruins),
  });

  // ---- vehicle pads, in the motor pool of each team's starting front sector
  const pads = [];
  const startFront = [Math.floor((sectors.length - 1) / 2) - 1, Math.floor((sectors.length - 1) / 2) + 1];
  for (const team of [0, 1]) {
    const yaw = team === 0 ? -Math.PI / 2 : Math.PI / 2;
    const c = sectors[startFront[team]]?.pool?.[team] ?? hq[team];
    let slot = 0;
    for (const [kind, n] of P.pads) for (let k = 0; k < n; k++, slot++) {
      pads.push({ vehicle: VEHICLES[kind][team], kind, group: 'pool', team, slot, at: v(c.x, 0, c.z + (slot - (nPads - 1) / 2) * padGap), yaw, respawn: RESPAWN[kind] });
    }
    if (!S) continue;
    const pk = sectors[startFront[team]]?.park?.[team] ?? hqDepot[team];
    let gs = 0, as = 0;
    for (const [kind, n] of S.guns) for (let k = 0; k < n; k++) {
      const at = kind === 'at';
      const row = at ? parkSlot(pk, team, 1, as++, parkAT) : parkSlot(pk, team, 0, gs++, parkGuns);
      pads.push({ vehicle: VEHICLES[kind][team], kind, group: 'park', team, slot: row.slot, at: row.at, yaw, respawn: RESPAWN[kind] });
    }
    for (let k = 0; k < S.trucks; k++) {
      const d = hqDepot[team];
      pads.push({ vehicle: VEHICLES.truck[team], kind: 'truck', group: 'hq', team, slot: k, at: v(d.x + (team === 0 ? -1 : 1) * 16, 0, d.z + (k - (S.trucks - 1) / 2) * 8), yaw, respawn: RESPAWN.truck });
    }
  }

  // Final heights for everything that stands on the ground.
  for (const p of points) p.pos.y = terrain.height(p.pos.x, p.pos.z);
  for (const s of sectors) for (const team of [0, 1]) for (const sp of allSpawns(s, team)) sp.y = terrain.height(sp.x, sp.z);
  for (const h of hq) h.y = terrain.height(h.x, h.z);
  for (const pad of pads) pad.at.y = terrain.height(pad.at.x, pad.at.z);
  for (const s of sectors) for (const c of s.pool ?? []) if (c) c.y = terrain.height(c.x, c.z);
  for (const s of sectors) for (const c of [...(s.depot ?? []), ...(s.park ?? [])]) if (c) c.y = terrain.height(c.x, c.z);
  for (const d of hqDepot) if (d) d.y = terrain.height(d.x, d.z);
  terrain.takeDirty(); // the renderer builds the finished ground; only later changes are news

  return {
    seed, size: P.id ?? size, name: P.name, terrain, cover, nav, sectors, points, hq, hqDepot, pads, padGap, gunGap: GUN_GAP,
    parkCounts: [parkGuns, parkAT],
    trenches, ruins, wire, craters, structures, support: S,
    bounds: { minX: P.minX, minZ: P.minZ, maxX, maxZ },
  };
}
