// CityExtras: the city's vertical routes and clutter (City.js): scaffolding up the towers' fronts,
// skybridges between houses across the streets (some broken, one end fallen into the street as a
// ramp), market stalls in the empty lots, and debris in the streets. Deterministic per map seed;
// every piece is a cover box drawn by CityRenderer (`render: 'city'`).
//
// What a fighter can do with them (MovementController's rules): step up 0.35 m, so stairs and
// ramps are 0.3 m steps; climb a ledge up to 2.3 m with a face to climb, so debris piles go up in
// blocks a climb apart; stand on any top and walk under anything above head height, so decks,
// canopies and bridges are slabs.

import { STOREY } from './Houses.js';

const STEP = 0.3, TREAD = 0.5;

/** A box with absolute bottom and top, tagged for the renderer and grouped for the cover index. */
function piece(b, list, group, x0, z0, x1, z1, y0, y1, kind, surface = 'concrete') {
  const bx = b.boxRect(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), 0, { bottom: y0, top: y1, kind, surface, render: 'city' });
  if (group) bx.group = group;
  list.push(bx);
  return bx;
}

/**
 * Scaffolding along a facade: a deck at every level (2.4 m: eight 0.3 m steps), reached by flights
 * of stairs climbing one after another along it, each standing on the deck below and coming out
 * on the next. Over the sidewalk: you walk under the decks.
 * @param {object} o { axis: 'x' | 'z' (the facade runs along it), at (the facade line), out (+1/-1:
 *                    the street side), u0, u1 (its run along the facade), base (the sidewalk's
 *                    top), levels }
 */
export function buildScaffold(b, { axis, at, out, u0, u1, base, levels }) {
  const parts = { deck: [], stair: [] }, group = { scaffold: true };
  const D = 1.6, H = 8 * STEP, run = 8 * TREAD;
  levels = Math.max(1, Math.min(levels, Math.floor((u1 - u0 - 1.5) / run)));
  const v0 = at + out * 0.05, v1 = at + out * (0.05 + D);
  const rect = (a, c) => (axis === 'x' ? [a, v0, c, v1] : [v0, a, v1, c]);
  for (let i = 1; i <= levels; i++) {
    // Flight i: from level i-1 up to level i, rising along +u; deck i beyond its head.
    const y0 = base + (i - 1) * H, f0 = u0 + (i - 1) * run;
    for (let j = 1; j <= 8; j++) {
      const [x0, z0, x1, z1] = rect(f0 + (j - 1) * TREAD, f0 + j * TREAD);
      piece(b, parts.stair, group, x0, z0, x1, z1, i === 1 ? y0 - 0.25 : y0 - 0.02, y0 + j * STEP, 'sstair', 'metal');
    }
    const y = base + i * H, [x0, z0, x1, z1] = rect(f0 + run, u1);
    piece(b, parts.deck, group, x0, z0, x1, z1, y - 0.12, y, 'deck', 'metal');
  }
  return { axis, at, out, u0, u1, base, levels, depth: D, run, parts, top: base + levels * H };
}

/**
 * A skybridge between two houses' doorways at storey k, across a street. Intact: a deck from door
 * to door (in 0.3 m steps where the two floors aren't level). Broken: the far half fell into the
 * street; the deck ends in a ramp of rubble steps down to the ground by the far house (walk up it
 * into the near house).
 * @param {object} o { axis: 'x' | 'z' (the bridge runs along it), a, c (its ends: the two facade
 *                    lines; a's house is the near one), u (where along the street), width, y (the
 *                    near floor), yFar (the far floor), ground(x, z) (the walking surface: the
 *                    street, or the sidewalk slab), broken }
 */
export function buildBridge(b, { axis, a, c, u, width = 2.6, y, yFar = y, ground, broken = false }) {
  const parts = { deck: [], rail: [], ramp: [] }, group = { bridge: true };
  const dir = Math.sign(c - a), len = Math.abs(c - a), w0 = u - width / 2, w1 = u + width / 2;
  const at = (s, v) => (axis === 'x' ? [a + dir * s, v] : [v, a + dir * s]);
  const box = (s0, s1, v0, v1, y0, y1, kind, list) => {
    const [x0, z0] = at(s0, v0), [x1, z1] = at(s1, v1);
    return piece(b, list, group, x0, z0, x1, z1, y0, y1, kind);
  };
  let deckLen = len, ramp = null;
  if (broken) {
    // A ramp of 0.3 m steps from the far house's sidewalk up to what's left of the deck.
    const far = at(len - 0.4, u), gFar = ground(far[0], far[1]);
    const n = Math.max(1, Math.ceil((y - gFar) / STEP));
    deckLen = Math.max(2, len - n * TREAD - 0.3);
    const steps = [];
    for (let j = 0; j < n; j++) {
      const s0 = deckLen + j * TREAD, top = y - (j + 1) * STEP, [gx, gz] = at(s0 + TREAD / 2, u), g = ground(gx, gz);
      if (top < g + 0.05 || s0 + TREAD > len) break;
      steps.push(box(s0, s0 + TREAD, w0 + 0.2, w1 - 0.2, Math.min(g, gFar) - 0.4, top, 'ramp', parts.ramp));
    }
    ramp = { from: at(deckLen, u), to: at(deckLen + steps.length * TREAD, u), y0: y, y1: gFar, steps: steps.length };
    box(0, deckLen, w0, w1, y - 0.3, y, 'bridge', parts.deck);
  } else {
    // Door to door, stepping (0.3 m at most) from one floor to the other where they differ.
    const m = Math.max(1, Math.ceil(Math.abs(yFar - y) / STEP) + (Math.abs(yFar - y) > 0.01 ? 1 : 0));
    for (let i = 0; i < m; i++) {
      const yy = y + ((yFar - y) * i) / Math.max(1, m - 1);
      box((len * i) / m, (len * (i + 1)) / m, w0, w1, Math.min(y, yFar) - 0.3, yy, 'bridge', parts.deck);
    }
  }
  // Rails along both sides (a vault over them is a long drop).
  const top = Math.max(y, broken ? y : yFar);
  box(0, deckLen, w0, w0 + 0.08, top, top + 1.05, 'brail', parts.rail);
  box(0, deckLen, w1 - 0.08, w1, top, top + 1.05, 'brail', parts.rail);
  return { axis, a, c, u, width, y, yFar, len, deckLen, broken, ramp, parts };
}

/**
 * A market in a lot: stalls in two rows either side of an aisle down its length, each a counter,
 * a back shelf and a canopy (walk under it; climb onto the counter, then the canopy), crates.
 * @param {object} o { x0, z0, x1, z1, base }
 */
export function buildMarket(b, { x0, z0, x1, z1, base }) {
  const parts = { counter: [], canopy: [], crate: [] }, stalls = [];
  const alongX = x1 - x0 >= z1 - z0, L = alongX ? x1 - x0 : z1 - z0, Wd = alongX ? z1 - z0 : x1 - x0;
  const SW = 2.6, SD = 1.7, AISLE = 2.8;
  const rows = Wd >= SD * 2 + AISLE ? 2 : 1;
  const n = Math.max(1, Math.floor((L - 1) / SW));
  const s0 = (alongX ? x0 : z0) + (L - n * SW) / 2;
  const rect = (a0, a1, c0, c1) => (alongX ? [a0, c0, a1, c1] : [c0, a0, c1, a1]);
  const mid = alongX ? (z0 + z1) / 2 : (x0 + x1) / 2;
  for (let r = 0; r < rows; r++) {
    // Row r's back edge and which way it faces (toward the aisle).
    const face = rows === 2 ? (r === 0 ? 1 : -1) : 1;
    const back = rows === 2 ? (r === 0 ? mid - AISLE / 2 - SD : mid + AISLE / 2 + SD) : mid - SD / 2;
    for (let i = 0; i < n; i++) {
      if (b.rand() < 0.12) continue;                                   // a gap in the row
      const a0 = s0 + i * SW + 0.15, a1 = a0 + SW - 0.3;
      const c = (v) => back + face * v;
      const [sx0, sz0, sx1, sz1] = rect(a0, a1, Math.min(c(0), c(0.45)), Math.max(c(0), c(0.45)));
      piece(b, parts.counter, null, sx0, sz0, sx1, sz1, base - 0.25, base + 1.9, 'stall', 'wood');             // the back shelf
      const [cx0, cz0, cx1, cz1] = rect(a0, a1, Math.min(c(1.15), c(1.7)), Math.max(c(1.15), c(1.7)));
      piece(b, parts.counter, null, cx0, cz0, cx1, cz1, base - 0.25, base + 1.0, 'stall', 'wood');             // the counter
      const [px0, pz0, px1, pz1] = rect(a0 - 0.1, a1 + 0.1, Math.min(c(-0.1), c(2.0)), Math.max(c(-0.1), c(2.0)));
      const canopy = piece(b, parts.canopy, null, px0, pz0, px1, pz1, base + 2.4, base + 2.5, 'canopy', 'wood');
      stalls.push({ x: (cx0 + cx1) / 2, z: (cz0 + cz1) / 2, face: alongX ? [0, face] : [face, 0], canopy, color: Math.floor(b.rand() * 6), sign: Math.floor(b.rand() * 8) });
      if (b.rand() < 0.4) {
        const [kx0, kz0, kx1, kz1] = rect(a0 + 0.3, a0 + 0.9, Math.min(c(1.9), c(2.5)), Math.max(c(1.9), c(2.5)));
        piece(b, parts.crate, null, kx0, kz0, kx1, kz1, base - 0.25, base + 0.6, 'crate', 'wood');
      }
    }
  }
  return { x0, z0, x1, z1, base, alongX, stalls, parts };
}

/**
 * Debris: a chunk of concrete (vault it, crouch behind it), or a pile in steps a climb apart (up
 * onto it, and from its top to whatever it leans on).
 */
export function buildDebris(b, { x, z, ground, pile = false, yaw = 0 }) {
  const parts = [];
  const g = ground(x, z);
  if (!pile) {
    const w = b.R(0.8, 1.6), d = b.R(0.6, 1.2), h = b.R(0.5, 1.1);
    piece(b, parts, null, x - w / 2, z - d / 2, x + w / 2, z + d / 2, g - 0.25, g + h, 'debris', 'concrete');
    return { x, z, pile, yaw, parts };
  }
  // A pile: three blocks stepping up 1.1 m, 2.1 m, 2.9 m along a direction.
  const dx = Math.cos(yaw), dz = Math.sin(yaw);
  [[0, 1.1, 1.6], [1.3, 2.1, 1.4], [2.5, 2.9, 1.2]].forEach(([o, h, s]) => {
    const cx = x + dx * o, cz = z + dz * o;
    piece(b, parts, null, cx - s / 2, cz - s / 2, cx + s / 2, cz + s / 2, g - 0.25, g + h, 'debris', 'concrete');
  });
  return { x, z, pile, yaw, parts };
}

export { STOREY };
