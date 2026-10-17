// Trenches: WW1 trench systems for the frontline maps (built once per map, deterministic).
//
// A trench line runs across the map along Z at a sector boundary:
//  * the fire trench is a crenellated zigzag (Greek-key): bays along Z joined by short traverses
//    along X, so a shell or an enfilading gun only ever covers one bay;
//  * communication trenches run back from it on both sides (each side is someone's rear), with
//    a dugout (a deep, roofed shelter) off some bays;
//  * the floor is dug `depth` into the ground and sandbags line the lip `parapet` high. With the
//    defaults the parapet stands 1.25 m above the floor: a soldier standing on the floor fires
//    over it with head and shoulders exposed (the muzzle is at 1.6 m), crouched is fully
//    covered (1.15 m), and leaving the trench is a climb: going over the top. Gaps in the
//    sandbags are exits, each with a ramp dug up to the surface.
//
// Grid alignment is what makes the trench readable at 1 m terrain resolution: every corridor
// edge sits on a terrain sample, so the floor is flat right up to the wall, and the ground rises
// back to the surface in the one sample interval under the 1 m sandbag ring (hidden inside the
// boxes, so the walls are vertical and there's no ditch outside). The caller aligns the line to
// the nav grid too (MapSizes trench widths and bay lengths are even), so the floor is its own
// column of nav cells, the parapet the next, and an exit a free cell through it.
//
// The parapet ring is drawn on a 0.5 m mask (floor = 1, sandbags = 2, exit = 3) and merged into
// as few axis-aligned boxes as possible (each at most `maxRun` long so its top follows the
// ground). Output for the AI: firing positions along every bay on both sides (the side facing
// the enemy is the one to man), the exits (where a squad goes over the top together), bays and
// dugouts.

const CELL = 0.5;

/**
 * @param {object} b  map builder: { terrain, rand, R, boxRect(x0, z0, x1, z1, h, opts) }
 * @param {object} o  { id, x, z0, z1, bay, jog, width, depth, parapet, comms, dugouts, exits, clear(x0, z0, x1, z1) }
 *                     x, z0, bay, jog, width: whole metres (x - width/2 and z0 on the nav grid);
 *                     clear: may a communication trench or dugout be dug there?
 * @returns {object}  { id, x, z0, z1, corridors, positions, exits, dugouts, bays, width, depth, parapet }
 */
export function buildTrenchLine(b, o) {
  const { id, x, z0, z1, bay = 10, jog = 4, width = 2, depth = 0.75, parapet = 0.5, comms = 2, dugouts = 2, exits = 24, clear = () => true } = o;
  const t = b.terrain, hw = width / 2, ring = 1;
  const even = (v) => 2 * Math.round(v / 2);
  const corridors = [];        // [x0, z0, x1, z1, kind]  (whole metres)
  const bays = [];             // { x, z0, z1 } fire bays (positions are made along these)
  // Fire trench: bays alternate between x and x + jog, joined by traverses.
  let k = 0;
  for (let z = z0; z < z1 - 2; z += bay, k++) {
    const bx = x + (k % 2) * jog, ze = Math.min(z1, z + bay);
    corridors.push([bx - hw, z - hw, bx + hw, ze + hw, 'bay']);
    bays.push({ x: bx, z0: z, z1: ze });
    if (ze < z1 - 2) {
      const nx = x + ((k + 1) % 2) * jog;
      corridors.push([Math.min(bx, nx) - hw, ze - hw, Math.max(bx, nx) + hw, ze + hw, 'traverse']);
    }
  }
  // Communication trenches, back toward each side's rear, with one jog halfway. Their junctions
  // keep the nav alignment (z - z0 even). Each one is routed clear of spawns, points and ruins
  // (`clear`): the first of a few lengths and bays that fits, or none on that side.
  const commList = [], commBays = new Set();
  const fits = (rects) => rects.every(([a, c, e2, f]) => clear(a, c, e2, f));
  for (let c = 0; c < comms; c++) {
    const home = Math.min(bays.length - 1, Math.floor((c + 0.5) / comms * bays.length));
    for (const side of [-1, 1]) {
      const off = even(b.R(-4, 4)), want = even(b.R(26, 38));
      let made = null;
      for (const shift of [0, 1, -1, 2, -2]) {
        const bi = home + shift, B = bays[bi];
        if (!B || B.z1 - B.z0 < bay) continue;
        const zc = B.z0 + even(bay / 2);
        for (const len of [want, want - 8, want - 14, 14]) {
          if (len < 12) continue;
          const half = even(len / 2), xa = B.x + side * hw, xm = B.x + side * half, xe = B.x + side * len;
          const rects = [
            [Math.min(xa, xm), zc - hw, Math.max(xa, xm), zc + hw, 'comm'],
            [xm - hw, Math.min(zc, zc + off) - hw, xm + hw, Math.max(zc, zc + off) + hw, 'comm'],
            [Math.min(xm, xe), zc + off - hw, Math.max(xm, xe), zc + off + hw, 'comm'],
          ];
          if (fits(rects)) { made = { rects, bi, end: { x: xe, z: zc + off } }; break; }
        }
        if (made) break;
      }
      if (!made) continue;
      corridors.push(...made.rects);
      commBays.add(made.bi);
      commList.push({ side, end: made.end });
    }
  }
  // Dugouts: a 3 x 4 m shelter dug deeper off the side wall of a bay (sides alternate, never a
  // bay with a communication trench), roofed with timber laid on its sandbags.
  const dug = [];
  const free = bays.map((B, i) => i).filter((i) => !commBays.has(i) && bays[i].z1 - bays[i].z0 >= 8);
  for (let d = 0; d < dugouts && free.length; d++) {
    const B = bays[free[Math.floor((d + 0.3) / dugouts * free.length) % free.length]];
    const side = d % 2 ? 1 : -1, zc = Math.round((B.z0 + B.z1) / 2 + b.R(-1, 1));
    const xa = B.x + side * hw, xb = B.x + side * (hw + 3);
    const rect = [Math.min(xa, xb), zc - 2, Math.max(xa, xb), zc + 2, 'dugout'];
    if (!clear(rect[0] - 1, rect[1] - 1, rect[2] + 1, rect[3] + 1)) continue;
    corridors.push(rect);
    dug.push({ side, rect, bay: B });
  }

  // ---- mask: 1 = dug floor, 4 = dugout floor (deeper), 2 = sandbag ring, 3 = exit (ring cut away)
  let mx0 = Infinity, mz0 = Infinity, mx1 = -Infinity, mz1 = -Infinity;
  for (const [a, c, e, f] of corridors) { mx0 = Math.min(mx0, a); mz0 = Math.min(mz0, c); mx1 = Math.max(mx1, e); mz1 = Math.max(mz1, f); }
  mx0 = Math.floor(mx0) - ring - 1; mz0 = Math.floor(mz0) - ring - 1; mx1 = Math.ceil(mx1) + ring + 1; mz1 = Math.ceil(mz1) + ring + 1;
  const W = Math.round((mx1 - mx0) / CELL), H = Math.round((mz1 - mz0) / CELL);
  const m = new Uint8Array(W * H);
  const ci = (wx) => Math.round((wx - mx0) / CELL), cj = (wz) => Math.round((wz - mz0) / CELL);
  const fill = (x0, z0c, x1, z1c, from, to) => {
    let n = 0;
    for (let j = Math.max(0, cj(z0c)); j < Math.min(H, cj(z1c)); j++) for (let i = Math.max(0, ci(x0)); i < Math.min(W, ci(x1)); i++) {
      if (from === null || m[j * W + i] === from) { m[j * W + i] = to; n++; }
    }
    return n;
  };
  const anyIn = (x0, z0c, x1, z1c) => {
    for (let j = Math.max(0, cj(z0c)); j < Math.min(H, cj(z1c)); j++) for (let i = Math.max(0, ci(x0)); i < Math.min(W, ci(x1)); i++) if (m[j * W + i] !== 0) return true;
    return false;
  };
  for (const [a, c, e, f, kind] of corridors) if (kind !== 'dugout') fill(a, c, e, f, null, 1);
  for (const [a, c, e, f, kind] of corridors) if (kind === 'dugout') fill(a, c, e, f, 0, 4);
  const isFloor = (v) => v === 1 || v === 4;
  const rc = Math.round(ring / CELL);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (m[j * W + i] !== 0) continue;
    let near = false;
    for (let dj = -rc; dj <= rc && !near; dj++) for (let di = -rc; di <= rc; di++) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < W && jj < H && isFloor(m[jj * W + ii])) { near = true; break; }
    }
    if (near) m[j * W + i] = 2;
  }
  // Exits: 2 m gaps through the parapet every `exits` metres on alternating sides of the fire
  // trench (from a nav cell edge, so the gap is a free nav cell), and at the far end of every
  // communication trench. Each gets a ramp dug up to the surface. A gap that would open onto a
  // dugout or a junction (no sandbags there to cut) isn't an exit.
  const exitList = [], ramps = [];
  let e = 0;
  for (const B of bays) {
    for (let z = B.z0 + 2 + hw; z + 2 < B.z1 - hw; z += even(exits), e++) {
      const side = e % 2 ? 1 : -1, face = B.x + side * hw;
      // The way out must lead somewhere open: no other trench's sandbags or floor just outside.
      const out0 = face + side * ring, out1 = face + side * (ring + 2);
      if (anyIn(Math.min(out0, out1), z - 0.5, Math.max(out0, out1), z + 2.5)) continue;
      if (fill(Math.min(face, face + side * ring), z, Math.max(face, face + side * ring), z + 2, 2, 3) < 4 * rc) continue;
      ramps.push({ x: face, z0: z, z1: z + 2, side });
      exitList.push({ x: face + side * (ring + 1.8), z: z + 1, side, floor: { x: face - side * 0.5, z: z + 1 }, trench: id });
    }
  }
  for (const c of commList) {
    const { x: ex, z: ez } = c.end;
    if (!fill(Math.min(ex, ex + c.side * ring), ez - hw, Math.max(ex, ex + c.side * ring), ez + hw, 2, 3)) continue;
    ramps.push({ x: ex, z0: ez - hw, z1: ez + hw, side: c.side });
    exitList.push({ x: ex + c.side * (ring + 1.8), z: ez, side: c.side, floor: { x: ex - c.side * 0.5, z: ez }, trench: id, comm: true });
  }

  // ---- dig: floors level from wall to wall (dugouts deeper), then the exit ramps at half depth.
  // Corridor edges are on terrain samples and the samples on an edge are dug: the floor is flat
  // right up to the sandbags.
  for (const [a, c, e2, f, kind] of corridors) t.carveLevel(a, c, e2, f, kind === 'dugout' ? depth + 0.5 : depth);
  // Exit ramps: two samples out from the floor's edge (`x`), climbing a third of the way to the
  // ground each, so even a deep stretch of trench on a hillside has a walkable way out.
  for (const r of ramps) for (let z = r.z0; z <= r.z1 + 1e-6; z += t.res) {
    const s = r.side * t.res, floor = t.height(r.x, z), rise = t.undug(r.x + 3 * s, z) - floor;
    t.digTo(r.x + s, z, floor + rise / 3);
    t.digTo(r.x + 2 * s, z, floor + (rise * 2) / 3);
  }

  // ---- merge the ring into boxes: runs along rows, then identical runs stacked across rows.
  // Each sandbag cell's reference is the floor it borders, on average (a dugout's as if it were a
  // bay's), and its top stands depth + parapet above that: the same height over the floor beside
  // it whatever the lie of the land. A box only spans cells within 0.1 m of level, so on a slope
  // the parapet steps with the floor instead of standing tall over its low end.
  const maxRun = Math.round(4 / CELL), level = 0.1;
  const lip = new Float32Array(W * H), floorAt = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const v = m[j * W + i];
    if (isFloor(v)) floorAt[j * W + i] = t.height(mx0 + (i + 0.5) * CELL, mz0 + (j + 0.5) * CELL) + (v === 4 ? 0.5 : 0);
  }
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (m[j * W + i] !== 2) continue;
    let sum = 0, n = 0;
    for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < W && jj < H && isFloor(m[jj * W + ii])) { sum += floorAt[jj * W + ii]; n++; }
    }
    lip[j * W + i] = (n ? sum / n : t.height(mx0 + (i + 0.5) * CELL, mz0 + (j + 0.5) * CELL) - depth) + depth;
  }
  const open = new Map();   // key "i0:i1" -> { i0, i1, j0, j1, lo, hi }
  const rects = [];
  for (let j = 0; j <= H; j++) {
    const runs = [];
    if (j < H) {
      let i = 0;
      while (i < W) {
        if (m[j * W + i] !== 2) { i++; continue; }
        const i0 = i;
        let lo = lip[j * W + i], hi = lo;
        while (i < W && m[j * W + i] === 2 && i - i0 < maxRun) {
          const y = lip[j * W + i];
          if (Math.max(hi, y) - Math.min(lo, y) > level) break;
          lo = Math.min(lo, y); hi = Math.max(hi, y); i++;
        }
        runs.push({ key: `${i0}:${i - 1}`, lo, hi });
      }
    }
    const now = new Map(runs.map((r) => [r.key, r]));
    for (const [key, r] of open) {
      const n = now.get(key);
      if (!n || r.j1 - r.j0 + 1 >= maxRun || Math.max(r.hi, n.hi) - Math.min(r.lo, n.lo) > level) { rects.push(r); open.delete(key); }
    }
    for (const run of runs) {
      const r = open.get(run.key);
      if (r) { r.j1 = j; r.lo = Math.min(r.lo, run.lo); r.hi = Math.max(r.hi, run.hi); }
      else { const [i0, i1] = run.key.split(':').map(Number); open.set(run.key, { i0, i1, j0: j, j1: j, lo: run.lo, hi: run.hi }); }
    }
  }
  const boxes = rects.map((r) => ({ x0: mx0 + r.i0 * CELL, x1: mx0 + (r.i1 + 1) * CELL, zA: mz0 + r.j0 * CELL, zB: mz0 + (r.j1 + 1) * CELL, lip: (r.lo + r.hi) / 2 }));
  // Dugout roofs rest on the sandbags around them.
  const roofs = dug.map((d) => {
    const [a, c, e2, f] = d.rect;
    let top = -Infinity;
    for (const q of boxes) if (q.x1 >= a - ring && q.x0 <= e2 + ring && q.zB >= c - ring && q.zA <= f + ring) top = Math.max(top, q.lip + parapet);
    return { d, lip: top - parapet };
  });

  // ---- sandbags, then the dugout roofs (timber on the sandbags, overhanging the ring)
  for (const q of boxes) b.boxRect(q.x0, q.zA, q.x1, q.zB, 0, { top: q.lip + parapet, surface: 'sandbag', kind: 'parapet', destructible: true, trench: id });
  for (const { d, lip } of roofs) {
    const [a, c, e2, f] = d.rect;
    const inner = d.side > 0 ? a : e2;                       // the edge open to the bay
    const x0 = d.side > 0 ? inner : a - ring, x1 = d.side > 0 ? e2 + ring : inner;
    b.boxRect(x0, c - ring, x1, f + ring, 0, { bottom: lip + parapet, top: lip + parapet + 0.3, surface: 'wood', kind: 'roof', trench: id });
  }

  // ---- firing positions along every bay, both sides (a soldier on the floor against the
  // sandbags): only where the sandbags right in front can be fired over standing (muzzle 1.6 m)
  // and hide a crouched soldier (1.15 m).
  const positions = [];
  for (const B of bays) {
    for (let z = B.z0 + hw + 0.6; z < B.z1 - hw - 0.4; z += 2.5) {
      for (const side of [-1, 1]) {
        const px = B.x + side * (hw - 0.45), y = t.height(px, z), fx = B.x + side * (hw + 0.3);
        const wall = boxes.find((q) => fx > q.x0 && fx < q.x1 && z > q.zA && z < q.zB);
        if (!wall || wall.lip + parapet - y > 1.46 || wall.lip + parapet - y < 1.16) continue;
        positions.push({ x: px, y, z, facing: side, trench: id });
      }
    }
  }
  return { id, x, z0, z1, corridors, positions, exits: exitList, dugouts: dug, bays, width, depth, parapet };
}

/** Dig the corridor of a short trench or foxhole line at runtime (fortification); no boxes. */
export function digTrenchSegment(terrain, x0, z0, x1, z1, width = 2, depth = 0.6) {
  const hw = width / 2;
  terrain.carveRect(Math.min(x0, x1) - hw, Math.min(z0, z1) - hw, Math.max(x0, x1) + hw, Math.max(z0, z1) + hw, depth, 0.35);
}
