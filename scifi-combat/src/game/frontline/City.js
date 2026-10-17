// City: the night city warfront (`?map=city`). The same front as the trench maps (sectors, points,
// spawns, motor pools, depots, HQs: FrontlineMap lays those out first), built as a city fought
// over block by block instead of trench country. Deterministic per seed.
//
//  * A street grid: avenues along X (the way the front advances), cross streets along Z, blocks
//    between them raised on a sidewalk slab (a kerb you drive up, and trip a sliding car on).
//  * Blocks of buildings: solid towers (cover you can't get through; the windows are the
//    renderer's), shelled shells with rooms and doorways (squads clear them), collapsed lots of
//    rubble, and empty lots. Points, spawns, motor pools, depots and HQs stay open: plazas.
//  * The park: the middle sector is a city park of grass and paths, trees, hedges, benches,
//    low walls and a fountain on the point.
//  * The war: damaged vehicles left in the streets (cars, vans, buses, trucks; some burned out,
//    some on their roofs), shell craters in the asphalt, rubble and debris, and at every sector
//    boundary a barricade line across the streets (jersey barriers, sandbag nests, container
//    roadblocks, concertina wire) where the trench line would be.
//  * Street lights along every street (poles are cover; a few are out, a few flicker), and neon
//    signs on the facades: what the renderer lights the night with.
// Returns what the renderer needs to dress it (CityRenderer) and the sim keeps (`map.city`).

/** Each size's city. */
export const CITY_NAMES = { '4v4': 'Overpass', '12v12': 'Midtown', '32v32': 'Neon District', '64v64': 'Aurora City', '200v200': 'The Sprawl' };

const AV = 14;          // an avenue, kerb to kerb (along X)
const ST = 11;          // a cross street (along Z)
const KERB = 0.16;      // sidewalk height
const WALK = 3.2;       // sidewalk width (lots start this far in from the kerb)
export const WRECKS = {
  // footprint (along the vehicle, across it, height) and how often
  sedan: { l: 4.5, w: 1.9, h: 1.45, p: 0.58 },
  hover: { l: 4.9, w: 2.1, h: 1.3, p: 0.14 },
  van: { l: 5.4, w: 2.15, h: 2.3, p: 0.13 },
  truck: { l: 8.2, w: 2.5, h: 3.2, p: 0.08 },
  bus: { l: 11.5, w: 2.6, h: 3.1, p: 0.07 },
};

/**
 * @param {object} b    the map builder (FrontlineMap): { terrain, rand, R, boxRect }
 * @param {object} ctx  { P (the size profile), sectors, points, hq, hqR, clearOf, ruinsAt, maxX, maxZ, mid (the park's sector) }
 * @returns {object} city: { streets, blocks, park, buildings, ruins (plans), lamps, wrecks, signs, trees, props, crossings, barricades, wire, craters, paint(x, z) }
 */
export function buildCity(b, ctx) {
  const { P, sectors, points, hq, hqR, spawnPts, ruinsAt, maxX, maxZ } = ctx;
  const { R, rand, terrain } = b;
  // Open ground the city keeps clear: the points (their plazas), HQs, spawns, and what the front
  // laid out before it (motor pools, depots, artillery parks).
  const reserved = ruinsAt.slice();
  const clearOf = (x, z, r) => points.every((p) => Math.hypot(p.pos.x - x, p.pos.z - z) > r + p.radius + 2)
    && hq.every((h) => Math.hypot(h.x - x, h.z - z) > hqR + 4) && spawnPts.every((q) => Math.hypot(q.x - x, q.z - z) > r + 4)
    && reserved.every((q) => x + r < q.x0 - 1 || x - r > q.x1 + 1 || z + r < q.z0 - 1 || z - r > q.z1 + 1);
  const lots = [];   // ground the buildings stand on
  const inLot = (x, z, r) => lots.some((q) => x + r > q.x0 && x - r < q.x1 && z + r > q.z0 && z - r < q.z1);
  const takeLot = (x0, z0, x1, z1) => { const q = { x0, z0, x1, z1 }; lots.push(q); ruinsAt.push(q); };
  const pick = (o) => { let k = rand(), last = null; for (const [key, v] of Object.entries(o)) { last = key; if ((k -= v.p) <= 0) return key; } return last; };

  // ---- the grid: avenues every ~sp m across the depth (one down the middle), cross streets every
  // 42-58 m along the front.
  const sp = Math.max(40, Math.min(72, P.depth / 4.5));
  const avenues = [0];
  for (let z = sp; z < P.depth / 2 - 18; z += sp) avenues.push(z, -z);
  avenues.sort((a, c) => a - c);
  const cross = [];
  for (let x = P.minX + R(22, 34); x < maxX - 20; x += R(42, 58)) cross.push(x);
  const streets = [
    ...avenues.map((z) => ({ axis: 'x', at: z, w: AV, from: P.minX, to: maxX })),
    ...cross.map((x) => ({ axis: 'z', at: x, w: ST, from: P.minZ, to: maxZ })),
  ];

  // ---- the park: the middle sector's blocks, from the cross streets nearest its edges and out to
  // the avenues nearest ~60% of the depth, so streets run round it; the ones that ran through it
  // are its paths. (Without streets to snap to: the middle sector itself, the blocks cut back.)
  const ps = sectors[ctx.mid], parkD = Math.min(P.depth * 0.62, 230);
  const nearest = (list, x) => list.reduce((a, c) => (a === null || Math.abs(c - x) < Math.abs(a - x) ? c : a), null);
  const cx0 = nearest(cross, ps.x0 + 5), cx1 = nearest(cross, ps.x1 - 5), az = nearest(avenues.filter((z) => z > 0), parkD / 2);
  const park = cx0 !== null && cx1 - cx0 > 60 ? { x0: cx0 + ST / 2, x1: cx1 - ST / 2 } : { x0: ps.x0 + 5, x1: ps.x1 - 5 };
  park.z1 = az !== null ? az - AV / 2 : parkD / 2; park.z0 = -park.z1;
  const inPark = (x, z, m = 0) => x > park.x0 - m && x < park.x1 + m && z > park.z0 - m && z < park.z1 + m;
  const avIn = avenues.filter((z) => inPark(park.x0 + 1, z)), crossIn = cross.filter((x) => inPark(x, 0));
  const pcx = (park.x0 + park.x1) / 2, midPath = !crossIn.some((x) => Math.abs(x - pcx) < 15);

  // ---- blocks between the streets (and the map's edges)
  const zs = [P.minZ, ...avenues, maxZ], xs = [P.minX, ...cross, maxX];
  const blocks = [];
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) {
    let x0 = xs[i] + (i > 0 ? ST / 2 : 0), x1 = xs[i + 1] - (i < xs.length - 2 ? ST / 2 : 0);
    let z0 = zs[j] + (j > 0 ? AV / 2 : 0), z1 = zs[j + 1] - (j < zs.length - 2 ? AV / 2 : 0);
    // A block the park covers is park; one it clips is cut back to the biggest piece beyond it.
    if (x1 > park.x0 && x0 < park.x1 && z1 > park.z0 && z0 < park.z1) {
      const rest = [[x0, z0, park.x0, z1], [park.x1, z0, x1, z1], [x0, z0, x1, park.z0], [x0, park.z1, x1, z1]]
        .filter(([a, b, c, d]) => c - a >= 8 && d - b >= 8).sort((p, q) => (q[2] - q[0]) * (q[3] - q[1]) - (p[2] - p[0]) * (p[3] - p[1]));
      if (!rest.length) continue;
      [x0, z0, x1, z1] = rest[0];
    }
    if (x1 - x0 < 8 || z1 - z0 < 8) continue;
    blocks.push({ x0, z0, x1, z1, edge: i === 0 || j === 0 || i === xs.length - 2 || j === zs.length - 2 });
  }

  // ---- the ground: flat city streets, the park gently rolling
  for (const blk of blocks) terrain.flatten((blk.x0 + blk.x1) / 2, (blk.z0 + blk.z1) / 2, Math.max(blk.x1 - blk.x0, blk.z1 - blk.z0) * 0.62, null, 0.35);

  // Sidewalk slabs: the whole block raised a kerb's height (buildings stand on it).
  for (const blk of blocks) {
    blk.slab = b.boxRect(blk.x0, blk.z0, blk.x1, blk.z1, KERB, { kind: 'kerb', surface: 'concrete', render: 'city' });
    blk.top = blk.slab.max.y;
  }

  // ---- buildings: lots along each block's street faces, a court in the middle of deep blocks
  const buildings = [], ruinPlans = [], rubble = [];
  const tall = P.players >= 64 ? 1 : 0.8;
  for (const blk of blocks) {
    const w = blk.x1 - blk.x0 - WALK * 2, d = blk.z1 - blk.z0 - WALK * 2;
    if (w < 6 || d < 6) continue;
    const nx = Math.max(1, Math.round(w / R(13, 21))), nz = d > 34 ? 2 : 1;
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const lw = w / nx, ld = d / nz;
      // An alley between some lots; deep blocks keep a courtyard between their rows.
      const gx = rand() < 0.3 ? R(2.5, 4) : 0.6, gz = nz > 1 ? R(3, 7) : 0;
      const lx0 = blk.x0 + WALK + ix * lw + (ix ? gx / 2 : 0), lx1 = blk.x0 + WALK + (ix + 1) * lw - (ix < nx - 1 ? gx / 2 : 0);
      const lz0 = blk.z0 + WALK + iz * ld + (iz ? gz / 2 : 0), lz1 = blk.z0 + WALK + (iz + 1) * ld - (iz < nz - 1 ? gz / 2 : 0);
      const cx = (lx0 + lx1) / 2, cz = (lz0 + lz1) / 2, hw = (lx1 - lx0) / 2, hd = (lz1 - lz0) / 2;
      if (hw < 3 || hd < 3) continue;
      // Keep the plazas open: points, spawns, pools, depots, HQs.
      if (!clearOf(cx, cz, Math.max(hw, hd) + 2)) continue;
      const roll = rand();
      if (!blk.edge && roll < 0.2 && hw > 3.8 && hd > 3.8) {
        // A shelled shell: rooms and doorways (squads clear them), on the street side of its lot,
        // rubble behind it.
        const w = Math.min(hw * 2, 16), d = Math.min(hd * 2, 14);
        const rz = iz === 0 && nz > 1 ? lz0 + d / 2 : iz === nz - 1 && nz > 1 ? lz1 - d / 2 : cz;
        ruinPlans.push({ x: cx, z: rz, w, d });
        if (hd * 2 - d > 5) rubble.push({ x: cx, z: rz < cz ? (lz1 + rz + d / 2) / 2 : (lz0 + rz - d / 2) / 2, hw: hw * 0.7, hd: (hd * 2 - d) / 2 - 1 });
        takeLot(lx0, lz0, lx1, lz1);
      } else if (!blk.edge && roll < 0.3) {
        rubble.push({ x: cx, z: cz, hw, hd });                                    // a collapsed lot
        takeLot(lx0, lz0, lx1, lz1);
      } else if (!blk.edge && roll < 0.36) {
        // An empty lot: a fence line along the street, maybe a wreck parked inside.
      } else {
        // A building: mostly 3-8 storeys, a few towers; the map's edge is a wall of them.
        const storeys = blk.edge ? Math.round(R(6, 14)) : rand() < 0.12 * tall ? Math.round(R(12, 22)) : Math.round(R(3, 8));
        const h = storeys * 3.6 + R(0.5, 2.5);
        const box = b.boxRect(lx0, lz0, lx1, lz1, h, { kind: 'tower', surface: 'concrete', render: 'city', top: blk.top + h });
        buildings.push({ box, storeys, style: Math.floor(rand() * 4), seed: Math.floor(rand() * 1e6), damaged: rand() < 0.35, lit: R(0.08, 0.45) });
        takeLot(lx0, lz0, lx1, lz1);
      }
    }
  }

  // ---- streets: what the war left in them
  const onStreet = (x, z) => blocks.every((k) => x < k.x0 - 0.5 || x > k.x1 + 0.5 || z < k.z0 - 0.5 || z > k.z1 + 0.5) && !inPark(x, z, 2);
  const segs = [];   // street segments between intersections: { axis, at, from, to }
  for (const s of streets) {
    const stops = s.axis === 'x' ? xs : zs;
    for (let k = 0; k < stops.length - 1; k++) {
      const a = stops[k] + (k > 0 ? (s.axis === 'x' ? ST : AV) / 2 : 0), c = stops[k + 1] - (k < stops.length - 2 ? (s.axis === 'x' ? ST : AV) / 2 : 0);
      if (c - a > 6 && !(s.axis === 'x' ? inPark((a + c) / 2, s.at) : inPark(s.at, (a + c) / 2))) segs.push({ axis: s.axis, at: s.at, w: s.w, from: a, to: c });
    }
  }

  // Wrecks: along the lanes or slewed across them, never closing a street (one at a time across
  // it), never on a point or a spawn.
  const wrecks = [];
  const box2 = (x, z, along, l, w, h) => (along === 'x' ? b.boxRect(x - l / 2, z - w / 2, x + l / 2, z + w / 2, h, { kind: 'wreck', surface: 'metal', render: 'city' }) : b.boxRect(x - w / 2, z - l / 2, x + w / 2, z + l / 2, h, { kind: 'wreck', surface: 'metal', render: 'city' }));
  for (const s of segs) {
    const len = s.to - s.from, n = Math.floor(len / 22 * R(0.5, 1.4) + (rand() < 0.4 ? 1 : 0));
    let pos = s.from + R(4, 9);
    for (let k = 0; k < n && pos < s.to - 4; k++) {
      const type = pick(WRECKS), W = WRECKS[type];
      const across = rand() < 0.18 && W.l < s.w - 3;
      const along = across ? (s.axis === 'x' ? 'z' : 'x') : s.axis;
      const lane = across ? R(-s.w / 2 + W.l / 2 + 1.5, s.w / 2 - W.l / 2 - 1.5) : (rand() < 0.5 ? -1 : 1) * R(s.w * 0.12, s.w / 2 - W.w / 2 - 0.4);
      const c = pos + (across ? W.w / 2 : W.l / 2);
      const x = s.axis === 'x' ? c : s.at + lane, z = s.axis === 'x' ? s.at + lane : c;
      pos = c + (across ? W.w / 2 : W.l / 2) + R(6, 18);
      if (!clearOf(x, z, W.l / 2 + 1.5)) continue;
      const box = box2(x, z, along, W.l, W.w, W.h);
      const state = rand();
      wrecks.push({ box, type, along, yaw: (along === 'x' ? Math.PI / 2 : 0) + (rand() < 0.5 ? Math.PI : 0) + R(-0.1, 0.1),   // (models face -Z)
        roof: state < 0.1, burned: state >= 0.1 && state < 0.45, burning: state >= 0.1 && state < 0.17, color: Math.floor(rand() * 8), seed: Math.floor(rand() * 1e6) });
    }
  }

  // At least one on its roof (a small map might roll none).
  if (wrecks.length && !wrecks.some((w) => w.roof)) Object.assign(wrecks.find((w) => !w.burning) ?? wrecks[0], { roof: true, burned: false, burning: false });

  // Street lights: every 24-30 m along every street, alternating sides, on the sidewalk (the other
  // side where this one has none: along the park); a few out, a few failing. More along the
  // park's paths.
  const lamps = [];
  const walkAt = (x, z) => blocks.find((k) => x > k.x0 + 0.2 && x < k.x1 - 0.2 && z > k.z0 + 0.2 && z < k.z1 - 0.2);
  const lamp = (x, z, y, nx, nz) => {
    const pole = b.boxRect(x - 0.15, z - 0.15, x + 0.15, z + 0.15, 7.6, { kind: 'pole', surface: 'metal', render: 'city' });
    const r = rand();
    lamps.push({ x, z, y, nx, nz, state: r < 0.14 ? 'out' : r < 0.2 ? 'flicker' : 'on', warm: rand() < 0.35, pole });
  };
  for (const s of segs) {
    let side = rand() < 0.5 ? -1 : 1;
    for (let t = s.from + R(5, 12); t < s.to - 4; t += R(24, 30)) {
      side = -side;
      const off = s.w / 2 + 0.7;   // on the sidewalk, just in from the kerb
      const at = (sd) => (s.axis === 'x' ? [t, s.at + sd * off] : [s.at + sd * off, t]);
      let [x, z] = at(side), blk = walkAt(x, z);
      if (!blk) { side = -side; [x, z] = at(side); blk = walkAt(x, z); }
      if (!blk || !clearOf(x, z, 1.5)) continue;
      lamp(x, z, blk.top, s.axis === 'x' ? 0 : -side, s.axis === 'x' ? -side : 0);
    }
  }
  for (const a of avIn) for (let x = park.x0 + R(8, 14), side = 1; x < park.x1 - 8; x += R(22, 30), side = -side) {
    const z = a + side * 3.2;
    if (clearOf(x, z, 1.5)) lamp(x, z, terrain.height(x, z), 0, -side);
  }

  // Crosswalks at intersections (paint).
  const crossings = [];
  for (const z of avenues) for (const x of cross) if (!inPark(x, z, -1)) crossings.push({ x, z });

  // Shell craters in the asphalt (more toward the middle of the map).
  const craters = [];
  const nCr = Math.round((P.width * P.depth) / 10000 * P.craters * 0.55);
  for (let k = 0; k < nCr; k++) {
    const x = R(P.minX + 20, maxX - 20), z = R(P.minZ + 12, maxZ - 12), r = R(1.3, 2.8);
    if (!onStreet(x, z) || !onStreet(x + r, z) || !onStreet(x - r, z) || !onStreet(x, z + r) || !onStreet(x, z - r) || !clearOf(x, z, r + 4)) continue;
    terrain.carveDisc(x, z, r, r * R(0.22, 0.32), 0.12);
    craters.push({ x, z, r });
  }

  // Collapsed lots: a heap of the building (the ground raised) and slabs of it lying about.
  for (const q of rubble) {
    terrain.carveDisc(q.x, q.z, Math.min(q.hw, q.hd) * 1.1, -R(1.2, 2.6), 0);   // (a negative cut raises)
    const n = Math.round(R(3, 6));
    for (let k = 0; k < n; k++) {
      const x = q.x + R(-q.hw * 0.7, q.hw * 0.7), z = q.z + R(-q.hd * 0.7, q.hd * 0.7), s = R(1.2, 3.2);
      b.boxRect(x - s / 2, z - s * 0.4, x + s / 2, z + s * 0.4, R(0.8, 2.2), { kind: 'rock', surface: 'rock' });
    }
  }

  // ---- barricades: where the trench lines would be (every boundary between line sectors), a line
  // across every street: jersey barriers with gaps, sandbag nests, a container roadblock now and
  // then, concertina wire in front.
  const barricades = [], wire = [], props = [];
  for (let i = 1; i < sectors.length - 2; i++) {
    if (sectors[i].kind !== 'line' || sectors[i + 1].kind !== 'line') continue;
    const line = sectors[i].x1;
    for (const av of avenues) {
      // On each avenue the line crosses: at the boundary, or as near it as the stretch between two
      // crossings allows (never in an intersection, where it would close nothing).
      let s = null, bx = 0;
      for (const q of segs) {
        if (q.axis !== 'x' || q.at !== av) continue;
        const x = Math.max(q.from + 3, Math.min(q.to - 3, line));
        if (!s || Math.abs(x - line) < Math.abs(bx - line)) { s = q; bx = x; }
      }
      if (!s || Math.abs(bx - line) > 30) continue;
      const z0 = s.at - s.w / 2 + 0.6, z1 = s.at + s.w / 2 - 0.6;
      if (rand() < 0.25) {
        // A container roadblock with a gap at one side.
        const gap = rand() < 0.5 ? z0 + 2.6 : z1 - 2.6;
        const [a, c] = gap < s.at ? [gap + 1.3, z1] : [z0, gap - 1.3];
        const box = b.boxRect(bx - 1.25, a, bx + 1.25, c, 2.6, { kind: 'container', surface: 'metal', render: 'city' });
        barricades.push({ box, kind: 'container', color: Math.floor(rand() * 5) });
      } else {
        for (let z = z0; z < z1 - 1;) {
          const len = Math.min(z1 - z, R(2.2, 3.4));
          if (rand() < 0.72) { const box = b.boxRect(bx - 0.35, z, bx + 0.35, z + len, 1.05, { kind: 'barrier', surface: 'concrete', render: 'city' }); barricades.push({ box, kind: 'jersey' }); }
          z += len + (rand() < 0.3 ? R(1.6, 2.4) : 0.15);
        }
      }
      // Sandbag nests either side of the line, facing each way.
      for (const side of [-1, 1]) if (rand() < 0.6) {
        const nz = R(z0 + 1.5, z1 - 1.5), nx = bx + side * R(3, 5);
        if (clearOf(nx, nz, 2.5)) for (const [ax, az, aw, ad] of [[0, -1.2, 2.6, 0.7], [side * 1.0, 0, 0.7, 1.8], [0, 1.2, 2.6, 0.7]]) b.boxRect(nx + ax - aw / 2, nz + az - ad / 2, nx + ax + aw / 2, nz + az + ad / 2, 0.95, { kind: 'lowwall', surface: 'sandbag', destructible: true });
      }
      // Wire in front of both sides, with gaps; tank traps.
      for (const side of [-1, 1]) {
        const wx = bx + side * R(8, 11);
        for (let z = z0; z < z1 - 1;) { const len = Math.min(z1 - z, R(3, 6)); if (rand() < 0.6) wire.push({ min: { x: wx - 0.7, z }, max: { x: wx + 0.7, z: z + len } }); z += len + R(2, 4); }
        for (let k = 0; k < 2; k++) { const tz = R(z0 + 1, z1 - 1), tx = bx + side * R(4, 7); if (clearOf(tx, tz, 1.5)) { const box = b.boxRect(tx - 0.6, tz - 0.6, tx + 0.6, tz + 0.6, 1.2, { kind: 'trap', surface: 'metal', render: 'city' }); props.push({ box, kind: 'hedgehog', yaw: R(0, Math.PI) }); } }
      }
    }
  }

  // ---- debris and street furniture: rubble chunks, dumpsters, planters, crates
  const nDeb = Math.round((P.width * P.depth) / 10000 * (P.scatterPerHa ?? 10) * 1.1);
  for (let k = 0; k < nDeb; k++) {
    const x = R(P.minX + 10, maxX - 10), z = R(P.minZ + 6, maxZ - 6);
    if (!clearOf(x, z, 4) || inLot(x, z, 1.5) || inPark(x, z, 3) || wire.some((w) => x > w.min.x - 2 && x < w.max.x + 2 && z > w.min.z - 2 && z < w.max.z + 2)) continue;
    const r = rand();
    if (r < 0.45) { const s = R(0.8, 2.2); b.boxRect(x - s / 2, z - s * 0.45, x + s / 2, z + s * 0.45, R(0.5, 1.4), { kind: 'rock', surface: 'rock' }); }
    else if (r < 0.65) { const box = b.boxRect(x - 0.9, z - 0.65, x + 0.9, z + 0.65, 1.25, { kind: 'dumpster', surface: 'metal', render: 'city' }); props.push({ box, kind: 'dumpster', yaw: rand() < 0.5 ? 0 : Math.PI / 2 }); }
    else if (r < 0.82) { const box = b.boxRect(x - 0.6, z - 0.6, x + 0.6, z + 0.6, 0.85, { kind: 'planter', surface: 'concrete', render: 'city' }); props.push({ box, kind: 'planter' }); }
    else b.boxRect(x - 0.7, z - 0.7, x + 0.7, z + 0.7, 1.3, { kind: 'crate', surface: 'wood', destructible: true });
  }

  // ---- the park: grass and paths, trees, hedges, benches, low walls round it, a fountain on its
  // point (or its middle)
  // Paths where the streets ran (and down the middle, and two diagonals), gates in the low walls
  // round it where they come in.
  const trees = [];
  const pathAt = (x, z) => avIn.some((a) => Math.abs(z - a) < 2.4) || crossIn.some((c) => Math.abs(x - c) < 2.4) || (midPath && Math.abs(x - pcx) < 2.4) || Math.abs(Math.abs(z) - Math.abs(x - pcx) * 0.8) < 1.8;
  const gatesX = midPath ? [...crossIn, pcx] : crossIn;
  for (const [x0, z0, x1, z1] of [[park.x0, park.z0, park.x1, park.z0 + 0.5], [park.x0, park.z1 - 0.5, park.x1, park.z1], [park.x0, park.z0, park.x0 + 0.5, park.z1], [park.x1 - 0.5, park.z0, park.x1, park.z1]]) {
    const alongX = x1 - x0 > z1 - z0;
    for (let t = alongX ? x0 : z0; t < (alongX ? x1 : z1) - 0.5;) {
      const len = R(4, 7), e = Math.min(alongX ? x1 : z1, t + len);
      const gate = (alongX ? gatesX : avIn).some((g) => g > t - 4 && g < e + 4);
      const mx = alongX ? (t + e) / 2 : (x0 + x1) / 2, mz = alongX ? (z0 + z1) / 2 : (t + e) / 2;
      if (!gate && rand() < 0.8 && clearOf(mx, mz, len / 2 + 1)) b.boxRect(alongX ? t : x0, alongX ? z0 : t, alongX ? e : x1, alongX ? z1 : e, 0.85, { kind: 'lowwall', surface: 'concrete' });
      t = e + (rand() < 0.25 ? R(1.5, 3) : 0.1);
    }
  }
  const area = (park.x1 - park.x0) * (park.z1 - park.z0);
  for (let k = 0, n = Math.round(area / 110); k < n; k++) {
    const x = R(park.x0 + 3, park.x1 - 3), z = R(park.z0 + 3, park.z1 - 3);
    if (pathAt(x, z) || !clearOf(x, z, 2.5) || trees.some((t) => Math.hypot(t.x - x, t.z - z) < 5)) continue;
    const s = R(0.8, 1.25);
    b.boxRect(x - 0.3 * s, z - 0.3 * s, x + 0.3 * s, z + 0.3 * s, 3.2 * s, { kind: 'tree', surface: 'wood', render: 'city' });
    trees.push({ x, z, s, seed: Math.floor(rand() * 1e6), burned: rand() < 0.15 });
  }
  for (let k = 0, n = Math.round(area / 900); k < n; k++) {
    const x = R(park.x0 + 6, park.x1 - 6), z = R(park.z0 + 6, park.z1 - 6), len = R(4, 9), alongX = rand() < 0.5;
    if (pathAt(x, z) || !clearOf(x, z, len / 2 + 2)) continue;
    const box = alongX ? b.boxRect(x - len / 2, z - 0.55, x + len / 2, z + 0.55, 1.1, { kind: 'hedge', surface: 'wood', render: 'city' }) : b.boxRect(x - 0.55, z - len / 2, x + 0.55, z + len / 2, 1.1, { kind: 'hedge', surface: 'wood', render: 'city' });
    props.push({ box, kind: 'hedge' });
  }
  // Benches along the paths, facing them (models face -Z).
  const bench = (x, z, alongX, yaw) => {
    if (!clearOf(x, z, 2) || trees.some((t) => Math.hypot(t.x - x, t.z - z) < 1.5)) return;
    const box = alongX ? b.boxRect(x - 0.9, z - 0.3, x + 0.9, z + 0.3, 0.5, { kind: 'bench', surface: 'wood', render: 'city' }) : b.boxRect(x - 0.3, z - 0.9, x + 0.3, z + 0.9, 0.5, { kind: 'bench', surface: 'wood', render: 'city' });
    props.push({ box, kind: 'bench', yaw });
  };
  for (const a of avIn) for (let x = park.x0 + R(6, 12); x < park.x1 - 6; x += R(14, 24)) { const side = rand() < 0.5 ? -1 : 1; bench(x, a + side * 3.6, true, side > 0 ? 0 : Math.PI); }
  for (const c of midPath ? [...crossIn, pcx] : crossIn) for (let z = park.z0 + R(6, 12); z < park.z1 - 6; z += R(14, 24)) { const side = rand() < 0.5 ? -1 : 1; bench(c + side * 3.6, z, false, side > 0 ? Math.PI / 2 : -Math.PI / 2); }
  // The fountain: on the park's point nearest its middle, if it has one (the point stays open: a
  // ring wall round it).
  const pp = points.filter((p) => inPark(p.pos.x, p.pos.z)).sort((p, q) => Math.hypot(p.pos.x - pcx, p.pos.z) - Math.hypot(q.pos.x - pcx, q.pos.z))[0] ?? { pos: { x: pcx, z: 0 }, radius: 6 };
  const fountain = { x: pp.pos.x, z: pp.pos.z, r: Math.max(3.5, (pp.radius ?? 6) * 0.5) };
  props.push({ kind: 'fountain', x: fountain.x, z: fountain.z, r: fountain.r });

  // ---- neon: signs on the street faces of the buildings (renderer only)
  const signs = [];
  for (const bd of buildings) {
    if (rand() > 0.42) continue;
    const B = bd.box, n = rand() < 0.3 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const face = Math.floor(rand() * 4), vertical = rand() < 0.45;
      const fw = face < 2 ? B.max.z - B.min.z : B.max.x - B.min.x;   // (a ±x face runs along z)
      const sw = vertical ? R(1.1, 1.6) : Math.min(fw * 0.8, R(3, 7)), sh = vertical ? R(4, 9) : R(1.2, 2.2);
      const u = R(-fw / 2 + sw / 2 + 0.5, fw / 2 - sw / 2 - 0.5), y = B.min.y + R(3.8, Math.min(B.max.y - B.min.y - 1, 16)) ;
      if (fw < sw + 1.2 || y + sh / 2 > B.max.y) continue;
      signs.push({ building: bd, face, u, y, w: sw, h: sh, vertical, design: Math.floor(rand() * 8), color: Math.floor(rand() * 5), state: rand() < 0.12 ? 'out' : rand() < 0.12 ? 'flicker' : 'on' });
    }
  }

  // ---- what the ground is painted (the renderer's terrain colors): asphalt, park grass, paths
  const paint = (x, z) => {
    if (inPark(x, z)) return pathAt(x, z) ? 'path' : 'grass';
    for (const q of rubble) if (Math.abs(x - q.x) < q.hw * 1.2 && Math.abs(z - q.z) < q.hd * 1.2) return 'rubble';
    return 'asphalt';
  };

  return { streets, segs, avenues, cross, blocks, park, buildings, ruinPlans, rubble, lamps, wrecks, signs, trees, props, crossings, barricades, wire, craters, fountain, paint, kerb: KERB };
}
