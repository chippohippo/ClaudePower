// Seeded heightfield terrain shared by client, server and worker. Rolling hills and ridges give
// slopes to slide down (sliding accelerates downhill), sightline breaks for rotations and high
// ground to fight over. POIs sit on flattened pads so buildings stay level.

import { makeRng } from './util.js';
import { MAP_HALF } from './constants.js';

export const TERRAIN = {
  extent: 1000,       // terrain covers [-extent, extent]; beyond that it is flat at edgeHeight
  cell: 4,            // grid resolution in meters
  hillAmp: 22,        // big rolling hills
  hillScale: 260,
  ridgeAmp: 9,        // sharper ridges
  ridgeScale: 120,
  bumpAmp: 1.6,       // small undulation for texture
  bumpScale: 28,
  edgeHeight: 0,
  padBlend: 1.7,      // POI pad fades into hills between r and r * padBlend
};

function valueNoise(rng) {
  const P = 256, perm = new Uint16Array(P * 2), vals = new Float32Array(P);
  for (let i = 0; i < P; i++) { perm[i] = i; vals[i] = rng(); }
  for (let i = P - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < P; i++) perm[P + i] = perm[i];
  const s = (t) => t * t * (3 - 2 * t);
  return (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const a = vals[perm[(xi & 255) + perm[zi & 255]]], b = vals[perm[((xi + 1) & 255) + perm[zi & 255]]];
    const c = vals[perm[(xi & 255) + perm[(zi + 1) & 255]]], d = vals[perm[((xi + 1) & 255) + perm[(zi + 1) & 255]]];
    const u = s(xf), v = s(zf);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  };
}

export class Terrain {
  constructor(seed) {
    const T = TERRAIN;
    const rng = makeRng(seed ^ 0x7e44a1);
    this.n1 = valueNoise(rng);
    this.n2 = valueNoise(rng);
    this.n3 = valueNoise(rng);
    this.size = Math.round((T.extent * 2) / T.cell) + 1;
    this.h = new Float32Array(this.size * this.size);
    this.pads = [];
    this.maxH = 0;
    this.minH = 0;
  }

  // raw procedural height (before POI flattening)
  _raw(x, z) {
    const T = TERRAIN;
    let h = (this.n1(x / T.hillScale, z / T.hillScale) * 2 - 1) * T.hillAmp;
    h += (this.n1(x / (T.hillScale * 0.5) + 31, z / (T.hillScale * 0.5) + 17) * 2 - 1) * T.hillAmp * 0.35;
    const r = 1 - Math.abs(this.n2(x / T.ridgeScale, z / T.ridgeScale) * 2 - 1);
    h += (r * r) * T.ridgeAmp;
    h += (this.n3(x / T.bumpScale, z / T.bumpScale) * 2 - 1) * T.bumpAmp;
    // fade to flat at the map edge
    const e = Math.max(Math.abs(x), Math.abs(z));
    const k = Math.min(1, Math.max(0, (MAP_HALF + 60 - e) / 120));
    return T.edgeHeight + (h + T.hillAmp * 0.6) * k;
  }

  // Build the grid. pads: [{x, z, r}] areas to flatten (POIs).
  build(pads) {
    const T = TERRAIN, n = this.size;
    this.pads = pads.map((p) => ({ ...p, y: this._raw(p.x, p.z) }));
    let mx = -1e9, mn = 1e9;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -T.extent + i * T.cell, z = -T.extent + j * T.cell;
        let h = this._raw(x, z);
        for (const p of this.pads) {
          const d = Math.hypot(x - p.x, z - p.z);
          if (d < p.r * T.padBlend) {
            const t = Math.max(0, (d - p.r) / (p.r * (T.padBlend - 1)));
            const s = t * t * (3 - 2 * t);
            h = p.y + (h - p.y) * s;
          }
        }
        this.h[j * n + i] = h;
        if (h > mx) mx = h;
        if (h < mn) mn = h;
      }
    }
    this.maxH = mx;
    this.minH = mn;
    return this;
  }

  height(x, z) {
    const T = TERRAIN, n = this.size;
    let fx = (x + T.extent) / T.cell, fz = (z + T.extent) / T.cell;
    if (fx < 0) fx = 0; else if (fx > n - 1.001) fx = n - 1.001;
    if (fz < 0) fz = 0; else if (fz > n - 1.001) fz = n - 1.001;
    const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j;
    const k = j * n + i, h = this.h;
    return (h[k] * (1 - u) + h[k + 1] * u) * (1 - v) + (h[k + n] * (1 - u) + h[k + n + 1] * u) * v;
  }

  // unit surface normal
  normal(x, z, out = { x: 0, y: 1, z: 0 }) {
    const e = TERRAIN.cell * 0.5;
    const dx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    const dz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    const l = Math.hypot(dx, 1, dz);
    out.x = -dx / l; out.y = 1 / l; out.z = -dz / l;
    return out;
  }

  padHeight(x, z) {
    for (const p of this.pads) if (Math.hypot(x - p.x, z - p.z) < p.r) return p.y;
    return null;
  }

  // Ray march against the heightfield. Returns t or -1.
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    if (dy >= 0 && oy > this.maxH + 0.1) return -1;
    // skip when the whole segment is above the highest terrain
    if (Math.min(oy, oy + dy * maxT) > this.maxH + 0.1) return -1;
    const step = 1.5;
    let prevT = 0, prevD = oy - this.height(ox, oz);
    if (prevD < 0) return -1; // started underground: ignore
    for (let t = step; ; t += step) {
      const tt = Math.min(t, maxT);
      const x = ox + dx * tt, y = oy + dy * tt, z = oz + dz * tt;
      const d = y - this.height(x, z);
      if (d < 0) {
        let a = prevT, b = tt;
        for (let k = 0; k < 6; k++) {
          const m = (a + b) * 0.5;
          if (oy + dy * m - this.height(ox + dx * m, oz + dz * m) < 0) b = m; else a = m;
        }
        return a;
      }
      prevT = tt; prevD = d;
      if (tt >= maxT) return -1;
    }
  }
}
