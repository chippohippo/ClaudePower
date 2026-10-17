// Houses: the city's buildings you can go into (City.js). Two to five storeys of rooms behind real
// doors and windows, stairs from floor to floor up to the roof, balconies on the street side.
// Deterministic per map seed; every piece is a cover box (it blocks, you stand on it, it stops
// bullets), drawn by CityRenderer (`render: 'city'`).
//
//  * Walls 0.3 m thick, built from full-height piers between the window bays and horizontal bands
//    (sills, lintels, the floor edges, the parapet) along each whole side: a window is the gap
//    between two piers and two bands, so you see, shoot and vault through it. Doors on the street
//    faces at ground level; some upper bays open onto a balcony instead.
//  * Floors: slabs you walk on and under, with the stairwell cut out of them.
//  * Stairs: 0.3 m steps (a fighter steps up 0.35 m), in two lanes along the back wall switching
//    back storey to storey, each step solid down to the floor it stands on. The last flight comes
//    out through a hatch in the roof.
//  * The roof: a slab behind a 1 m parapet (vault over it, or snipe from behind it).
//  * The ground floor's rooms and doorways in the shape the ruins use (Ruins.js): squads clear
//    them (TacticalMap), the nav grid threads the doorways, civilians hide in them.

const T = 0.3;            // wall thickness
export const STOREY = 3.6;
const SLAB = 0.25;        // floor slab thickness
const STEP = 0.3, TREAD = 0.5, NSTEP = Math.round(STOREY / STEP);
const LANE = 1.25;        // a stair lane's width
const DOOR = 1.5, WIN = 1.35;
const SILL = 1.0, HEAD = 2.4, DOOR_HEAD = 2.55;
const PARAPET = 1.0;

/** The run of one flight of stairs (and the landings it needs either end). */
export const FLIGHT = NSTEP * TREAD;

/**
 * Can a house of this footprint be built (stairs need a run and two lanes, rooms need space)?
 * @param {number} w  along X
 * @param {number} d  along Z
 */
export function houseFits(w, d) {
  const long = Math.max(w, d), short = Math.min(w, d);
  return long - 2 * T >= FLIGHT + 2.4 && short - 2 * T >= 2 * LANE + 3.2;
}

/**
 * @param {object} b  the map builder: { R, rand, boxRect }
 * @param {object} o  { id, x0, z0, x1, z1, base (the floor's height: the sidewalk slab's top),
 *                     storeys, street: faces that look out on a street (0 -x, 1 +x, 2 -z, 3 +z),
 *                     style, seed, doorsAt: [{ face, u, k }] (doorways wanted at storey k on a
 *                     face, in the bay nearest u: where a skybridge comes in; the bay used is
 *                     written back as .at { x, z, u }) }
 * @returns {object} { id, min, max, base, storeys, top, rooms, doors, floors, stair, windows,
 *                     balconies, parts: { wall, floor, stair, rail }, lights, roofHatch }
 */
export function buildHouse(b, { id, x0, z0, x1, z1, base, storeys, street = [], style = 0, seed = 0, doorsAt = [] }) {
  const parts = { wall: [], floor: [], stair: [], rail: [] };
  const group = { house: id };      // the cover index tests a ray against the whole house first (CoverIndex)
  const box = (a0, c0, a1, c1, y0, y1, kind, list) => {
    const bx = b.boxRect(a0, c0, a1, c1, 0, { bottom: y0, top: y1, kind, surface: 'concrete', render: 'city' });
    bx.house = id; bx.group = group;
    list.push(bx);
    return bx;
  };
  const yOf = (k) => base + k * STOREY;                     // floor k's walking surface
  const roofY = yOf(storeys), top = roofY + PARAPET;
  const W = x1 - x0, D = z1 - z0, alongX = W >= D;

  // ---- the stairwell: two lanes along the back wall (the long side furthest from a street)
  const backFace = alongX ? (street.includes(3) && !street.includes(2) ? 2 : 3) : (street.includes(1) && !street.includes(0) ? 0 : 1);
  const uMin = (alongX ? x0 : z0) + T, uMax = (alongX ? x1 : z1) - T;
  const s0 = uMin + 1.2;                                         // the low end of lane A's flight
  const wallIn = backFace === 3 ? z1 - T : backFace === 2 ? z0 + T : backFace === 1 ? x1 - T : x0 + T;
  const inward = backFace === 3 || backFace === 1 ? -1 : 1;
  const laneA = [wallIn, wallIn + inward * LANE].sort((p, q) => p - q);
  const laneB = [wallIn + inward * LANE, wallIn + inward * 2 * LANE].sort((p, q) => p - q);
  // A rectangle in (u along the stair, v across it) as x/z.
  const rectUV = (u0, u1, v0, v1) => (alongX ? [u0, v0, u1, v1] : [v0, u0, v1, u1]);
  const stair = { alongX, s0, run: FLIGHT, lanes: [laneA, laneB], flights: [] };
  // Flight k: lane A rising +u (k even), lane B rising -u (k odd).
  for (let k = 0; k < storeys; k++) {
    const lane = k % 2 ? laneB : laneA, up = k % 2 ? -1 : 1, y0 = yOf(k);
    const steps = [];
    for (let j = 1; j <= NSTEP; j++) {
      const ua = up > 0 ? s0 + (j - 1) * TREAD : s0 + FLIGHT - j * TREAD, ub = ua + TREAD;
      const [a0, c0, a1, c1] = rectUV(ua, ub, lane[0], lane[1]);
      steps.push(box(a0, c0, a1, c1, k === 0 ? y0 - 0.25 : y0 - 0.02, y0 + j * STEP, 'hstair', parts.stair));
    }
    const lo = up > 0 ? s0 - 0.6 : s0 + FLIGHT + 0.6, hi = up > 0 ? s0 + FLIGHT + 0.6 : s0 - 0.6;
    stair.flights.push({ k, lane, up, from: rectMid(rectUV(lo, lo, lane[0], lane[1])), to: rectMid(rectUV(hi, hi, lane[0], lane[1])), y0, y1: yOf(k + 1), steps });
  }
  // The hole flight k needs in the slab above it: from where a climber's head would meet the slab
  // (the sixth step, less a body's width: he stands on a step's edge) out to its landing.
  const holeFor = (k) => {
    const lane = k % 2 ? laneB : laneA;
    return k % 2 ? rectUV(s0 - 0.05, s0 + FLIGHT * 0.74, lane[0], lane[1]) : rectUV(s0 + FLIGHT * 0.26, s0 + FLIGHT + 0.05, lane[0], lane[1]);
  };

  // ---- floors (1..storeys-1) and the roof (storeys): the inside, less the hole below them
  const inner = [x0 + T, z0 + T, x1 - T, z1 - T];
  const floors = [];
  for (let k = 1; k <= storeys; k++) {
    const y = yOf(k), hole = holeFor(k - 1);
    for (const [a0, c0, a1, c1] of minusRect(inner, hole)) box(a0, c0, a1, c1, y - SLAB, y, k === storeys ? 'hroof' : 'hfloor', parts.floor);
    floors.push({ k, y, hole });
  }

  // ---- walls: piers between the bays, bands between the window rows
  const windows = [], balconies = [], doors = [];
  const sides = [
    { face: 2, axis: 'x', at: z0, a: x0, bnd: x1, n: [0, -1] }, { face: 3, axis: 'x', at: z1, a: x0, bnd: x1, n: [0, 1] },
    { face: 0, axis: 'z', at: x0, a: z0 + T, bnd: z1 - T, n: [-1, 0] }, { face: 1, axis: 'z', at: x1, a: z0 + T, bnd: z1 - T, n: [1, 0] },
  ];
  // Which bays are doors (ground floor, street faces) and balcony doors (upper floors).
  for (const sd of sides) {
    const len = sd.bnd - sd.a, nb = Math.max(1, Math.floor((len - 1.6) / 3.1)), bay = (len - 1.6) / nb;
    const onStreet = street.includes(sd.face), back = sd.face === backFace;
    const bays = [];
    for (let i = 0; i < nb; i++) {
      const c = sd.a + 0.8 + bay * (i + 0.5);
      bays.push({ i, c, open: [] });                         // open[k]: [sill, head] of storey k's opening, or null
    }
    // The stair lanes run along the back wall: no openings where the steps are.
    const blocked = (c) => back && c > s0 - 0.8 && c < s0 + FLIGHT + 0.8;
    const doorBays = onStreet ? pickSome(b, bays.filter((q) => !blocked(q.c)), b.rand() < 0.5 ? 1 : 2) : [];
    const balcBays = onStreet && storeys > 1 ? pickSome(b, bays, b.rand() < 0.55 ? 1 : 0) : [];
    // Doorways asked for (a skybridge's): the open bay nearest u on this face.
    const wanted = new Map();
    for (const dw of doorsAt) {
      if (dw.face !== sd.face || dw.k < 1 || dw.k >= storeys) continue;
      const q = bays.filter((c) => !blocked(c.c)).sort((p, r) => Math.abs(p.c - dw.u) - Math.abs(r.c - dw.u))[0];
      if (!q || Math.abs(q.c - dw.u) > 3) continue;
      wanted.set(q, dw.k);
      dw.at = sd.axis === 'x' ? { x: q.c, z: sd.at, u: q.c } : { x: sd.at, z: q.c, u: q.c };
    }
    for (const q of bays) {
      const balcK = balcBays.includes(q) && !wanted.has(q) ? 1 + Math.floor(b.rand() * (storeys - 1)) : -1;   // the storey its balcony is on
      for (let k = 0; k < storeys; k++) {
        if (blocked(q.c)) { q.open[k] = null; continue; }
        if (k === 0 && doorBays.includes(q)) q.open[k] = [0, DOOR_HEAD, DOOR];
        else if (k === balcK || wanted.get(q) === k) q.open[k] = [0, HEAD, DOOR];
        else q.open[k] = [k === 0 && onStreet ? 0.6 : SILL, HEAD, onStreet && k === 0 ? Math.min(bay - 0.7, 2.4) : WIN];
      }
    }
    // Piers: between the openings, full height (an opening's width is the widest it gets up the stack).
    const edges = [sd.a, sd.bnd];
    const cuts = [];
    for (const q of bays) {
      const w = Math.max(0, ...q.open.map((o) => (o ? o[2] : 0)));
      if (w > 0) cuts.push([q.c - w / 2, q.c + w / 2]);
    }
    let s = edges[0];
    const T0 = sd.at - (sd.n[0] + sd.n[1] > 0 ? T : 0), T1 = T0 + T;
    const wallBox = (u0, u1, y0, y1) => (sd.axis === 'x' ? box(u0, T0, u1, T1, y0, y1, 'hwall', parts.wall) : box(T0, u0, T1, u1, y0, y1, 'hwall', parts.wall));
    for (const [c0, c1] of cuts) { if (c0 > s + 0.05) wallBox(s, c0, base - 0.25, top); s = c1; }
    if (edges[1] > s + 0.05) wallBox(s, edges[1], base - 0.25, top);
    // Bands: below each storey's openings and above them, merged along the side where they agree.
    for (let k = 0; k <= storeys; k++) {
      // The band from storey k-1's heads up to storey k's sills (k = storeys: up to the parapet top).
      const y0 = (k === 0 ? base - 0.25 : yOf(k - 1)), spans = [];
      for (const q of bays) {
        const below = k === 0 ? null : q.open[k - 1], here = k < storeys ? q.open[k] : null;
        const w = Math.max(0, ...q.open.map((o) => (o ? o[2] : 0)));
        if (!w) continue;
        const lo = k === 0 ? base - 0.25 : below ? y0 + below[1] : y0, hi = k === storeys ? top : here ? yOf(k) + here[0] : yOf(k + 1);
        spans.push([q.c - w / 2, q.c + w / 2, lo, hi]);
      }
      // Merge neighbours with the same heights into one box.
      for (let i = 0; i < spans.length;) {
        let j = i;
        while (j + 1 < spans.length && Math.abs(spans[j + 1][2] - spans[i][2]) < 1e-6 && Math.abs(spans[j + 1][3] - spans[i][3]) < 1e-6) j++;
        if (spans[i][3] - spans[i][2] > 0.04) wallBox(spans[i][0], spans[j][1], spans[i][2], spans[i][3]);
        i = j + 1;
      }
    }
    // Record the openings (the renderer lights the rooms behind them; balconies go outside them).
    for (const q of bays) q.open.forEach((o, k) => {
      if (!o) return;
      const p = sd.axis === 'x' ? { x: q.c, z: sd.at } : { x: sd.at, z: q.c };
      const rec = { ...p, nx: sd.n[0], nz: sd.n[1], k, y0: yOf(k) + o[0], y1: yOf(k) + o[1], w: o[2], face: sd.face };
      if (k === 0 && o[0] === 0) doors.push({ x: p.x, z: p.z, nx: sd.n[0], nz: sd.n[1] });
      else if (k > 0 && o[0] === 0 && wanted.get(q) === k) { windows.push(rec); return; }   // a skybridge's door: no balcony
      else if (k > 0 && o[0] === 0) {
        // A balcony: a slab out over the sidewalk, a rail round it.
        const y = yOf(k), w = o[2] + 1.4, out = 1.3;
        const u0 = q.c - w / 2, u1 = q.c + w / 2, o0 = sd.at + (sd.n[0] + sd.n[1] > 0 ? 0 : -out), o1 = o0 + out;
        const slab = sd.axis === 'x' ? box(u0, o0, u1, o1, y - SLAB, y, 'balcony', parts.floor) : box(o0, u0, o1, u1, y - SLAB, y, 'balcony', parts.floor);
        const edge = sd.n[0] + sd.n[1] > 0 ? o1 - 0.06 : o0 + 0.06, r = [];
        if (sd.axis === 'x') { r.push(box(u0, edge - 0.04, u1, edge + 0.04, y, y + 1.0, 'hrail', parts.rail), box(u0, o0, u0 + 0.08, o1, y, y + 1.0, 'hrail', parts.rail), box(u1 - 0.08, o0, u1, o1, y, y + 1.0, 'hrail', parts.rail)); }
        else { r.push(box(edge - 0.04, u0, edge + 0.04, u1, y, y + 1.0, 'hrail', parts.rail), box(o0, u0, o1, u0 + 0.08, y, y + 1.0, 'hrail', parts.rail), box(o0, u1 - 0.08, o1, u1, y, y + 1.0, 'hrail', parts.rail)); }
        balconies.push({ ...rec, slab, rails: r });
      }
      windows.push(rec);
    });
  }

  // ---- the ground floor's rooms: split across the long axis by a wall with a doorway, short of the stairs
  const rooms = [];
  const lanesOut = inward > 0 ? laneB[1] : laneB[0];           // the stair lanes' inner edge
  const frontLo = alongX ? (inward > 0 ? lanesOut : z0 + T) : (inward > 0 ? lanesOut : x0 + T);
  const frontHi = alongX ? (inward > 0 ? z1 - T : lanesOut) : (inward > 0 ? x1 - T : lanesOut);
  const split = (uMin + uMax) / 2 + b.R(-1, 1);
  const len = uMax - uMin;
  if (len > 10 && frontHi - frontLo > 2.4) {
    const g = b.R(frontLo + 1.1, frontHi - 1.1);
    const pieces = [[frontLo, g - DOOR / 2], [g + DOOR / 2, frontHi]];
    for (const [v0, v1] of pieces) if (v1 - v0 > 0.2) {
      const [a0, c0, a1, c1] = rectUV(split - T / 2, split + T / 2, v0, v1);
      box(a0, c0, a1, c1, base - 0.25, yOf(1) - SLAB, 'hwall', parts.wall);
    }
    const door = alongX ? { x: split, z: g, nx: 1, nz: 0 } : { x: g, z: split, nx: 0, nz: 1 };
    const r0 = alongX ? { min: { x: x0 + T, z: z0 + T }, max: { x: split, z: z1 - T } } : { min: { x: x0 + T, z: z0 + T }, max: { x: x1 - T, z: split } };
    const r1 = alongX ? { min: { x: split, z: z0 + T }, max: { x: x1 - T, z: z1 - T } } : { min: { x: x0 + T, z: split }, max: { x: x1 - T, z: z1 - T } };
    rooms.push({ ...r0, doors: [door] }, { ...r1, doors: [{ ...door, nx: -door.nx, nz: -door.nz }] });
  } else rooms.push({ min: { x: x0 + T, z: z0 + T }, max: { x: x1 - T, z: z1 - T }, doors: [] });
  for (const d of doors) {
    const r = rooms.find((q) => d.x >= q.min.x - T - 0.01 && d.x <= q.max.x + T + 0.01 && d.z >= q.min.z - T - 0.01 && d.z <= q.max.z + T + 0.01) ?? rooms[0];
    r.doors.push(d);
  }
  // Ceiling lights: a panel in each room of each storey (the renderer's; what lights the windows).
  const lights = [];
  for (let k = 0; k < storeys; k++) {
    const y = yOf(k + 1) - SLAB - 0.02;
    for (const r of rooms) lights.push({ x: (r.min.x + r.max.x) / 2, z: (r.min.z + r.max.z) / 2, y, w: (r.max.x - r.min.x) * 0.35, d: (r.max.z - r.min.z) * 0.35, k });
  }
  const last = stair.flights[storeys - 1];
  return {
    id, min: { x: x0, z: z0 }, max: { x: x1, z: z1 }, base, storeys, top, roofY, style, seed,
    rooms, doors, floors, stair, windows, balconies, parts, lights,
    roofHatch: { x: last.to.x, z: last.to.z, y: roofY },
  };
}

/** Up to n of a list, picked at random. */
function pickSome(b, list, n) {
  const pool = list.slice(), out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(b.rand() * pool.length), 1)[0]);
  return out;
}

const rectMid = ([a0, c0, a1, c1]) => ({ x: (a0 + a1) / 2, z: (c0 + c1) / 2 });

/** A rectangle [x0, z0, x1, z1] less a hole in it: up to four rectangles. */
export function minusRect([x0, z0, x1, z1], [hx0, hz0, hx1, hz1]) {
  hx0 = Math.max(x0, hx0); hz0 = Math.max(z0, hz0); hx1 = Math.min(x1, hx1); hz1 = Math.min(z1, hz1);
  if (hx0 >= hx1 || hz0 >= hz1) return [[x0, z0, x1, z1]];
  const out = [];
  if (hz0 > z0 + 0.01) out.push([x0, z0, x1, hz0]);                 // the strip before the hole (full width)
  if (hz1 < z1 - 0.01) out.push([x0, hz1, x1, z1]);                 // after it
  if (hx0 > x0 + 0.01) out.push([x0, hz0, hx0, hz1]);               // beside it
  if (hx1 < x1 - 0.01) out.push([hx1, hz0, x1, hz1]);
  return out;
}
