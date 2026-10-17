// Terrain: a heightfield for big maps. Bilinear height, normals from central differences, and a
// ray march with bisection refinement. FlatGroundBody (movement), CombatWorld (bullets, splash,
// ground height for vehicles and deployables) and the renderer all read the same samples.
//
// generate() makes rolling, readable battlefield ground from seeded value noise: broad hills
// for long sightlines, a little mid-frequency roughness, and flattened pads where the map puts
// capture points and spawns (fights happen on readable, walkable ground).

import { Vector3 } from 'three';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Terrain {
  /**
   * @param {object} o { minX, minZ, width, depth, res (m per sample) }
   */
  constructor({ minX = -500, minZ = -200, width = 1000, depth = 400, res = 2 } = {}) {
    this.minX = minX; this.minZ = minZ; this.width = width; this.depth = depth; this.res = res;
    this.nx = Math.round(width / res) + 1;
    this.nz = Math.round(depth / res) + 1;
    this.h = new Float32Array(this.nx * this.nz);
    this.surface = 'dirt';
  }

  #at(ix, iz) {
    ix = ix < 0 ? 0 : ix >= this.nx ? this.nx - 1 : ix;
    iz = iz < 0 ? 0 : iz >= this.nz ? this.nz - 1 : iz;
    return this.h[iz * this.nx + ix];
  }

  height(x, z) {
    const fx = (x - this.minX) / this.res, fz = (z - this.minZ) / this.res;
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const a = this.#at(ix, iz), b = this.#at(ix + 1, iz), c = this.#at(ix, iz + 1), d = this.#at(ix + 1, iz + 1);
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  normal(x, z, out = new Vector3()) {
    const e = this.res * 0.5;
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  /** Steepness in degrees at (x, z). */
  slopeDeg(x, z) { const n = this.normal(x, z, _n); return (Math.acos(Math.min(1, n.y)) * 180) / Math.PI; }

  /**
   * Ray march: steps of half a sample, then bisects the crossing.
   * @returns {{ hit: true, distance, point, normal, surface }} | null
   */
  raycast(o, d, maxDist) {
    const step = this.res * 0.5;
    let t0 = 0, prev = o.y - this.height(o.x, o.z);
    if (prev < 0) return { hit: true, distance: 0, point: o.clone(), normal: this.normal(o.x, o.z), surface: this.surface };
    for (let t = step; t <= maxDist + step; t += step) {
      const tt = Math.min(t, maxDist);
      const x = o.x + d.x * tt, y = o.y + d.y * tt, z = o.z + d.z * tt;
      const gap = y - this.height(x, z);
      if (gap <= 0) {
        let lo = t0, hi = tt;
        for (let i = 0; i < 12; i++) {
          const m = (lo + hi) * 0.5;
          if (o.y + d.y * m - this.height(o.x + d.x * m, o.z + d.z * m) > 0) lo = m; else hi = m;
        }
        const p = new Vector3(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi);
        return { hit: true, distance: hi, point: p, normal: this.normal(p.x, p.z), surface: this.surface };
      }
      // Early out: rising ray far above everything we know about.
      if (d.y > 0 && gap > this.maxHeight + 1) return null;
      t0 = tt; prev = gap;
      if (tt >= maxDist) break;
    }
    return null;
  }

  /** Blend the ground toward `y` within radius r (fully flat inside r * inner). */
  flatten(x, z, r, y = null, inner = 0.6) {
    const target = y ?? this.height(x, z);
    const x0 = Math.max(0, Math.floor((x - r - this.minX) / this.res)), x1 = Math.min(this.nx - 1, Math.ceil((x + r - this.minX) / this.res));
    const z0 = Math.max(0, Math.floor((z - r - this.minZ) / this.res)), z1 = Math.min(this.nz - 1, Math.ceil((z + r - this.minZ) / this.res));
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      const px = this.minX + ix * this.res, pz = this.minZ + iz * this.res;
      const d = Math.hypot(px - x, pz - z) / r;
      if (d >= 1) continue;
      const k = d <= inner ? 1 : 1 - (d - inner) / (1 - inner);
      const s = k * k * (3 - 2 * k);
      const i = iz * this.nx + ix;
      this.h[i] += (target - this.h[i]) * s;
    }
    this.#bounds();
    return target;
  }

  #bounds() { let m = -Infinity; for (let i = 0; i < this.h.length; i++) if (this.h[i] > m) m = this.h[i]; this.maxHeight = m; }

  /**
   * Seeded rolling ground. amp = hill height (m); the map edges rise into berms.
   */
  static generate({ seed = 1, amp = 9, rough = 0.8, ...dims } = {}) {
    const t = new Terrain(dims);
    const rand = mulberry32(seed);
    const octaves = [[220, amp], [90, amp * 0.35], [28, rough], [9, rough * 0.25]].map(([wl, a]) => ({ wl, a, ox: rand() * 1000, oz: rand() * 1000 }));
    // Integer lattice hash → [0, 1): deterministic per seed, no allocation.
    const hash = (i, j, o) => {
      let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(o + 1, 1442695041) + Math.imul(seed, 1274126177)) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    };
    const noise = (x, z, o) => {
      const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
      const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
      const a = hash(ix, iz, o), b = hash(ix + 1, iz, o), c = hash(ix, iz + 1, o), d = hash(ix + 1, iz + 1, o);
      return ((a * (1 - sx) + b * sx) * (1 - sz) + (c * (1 - sx) + d * sx) * sz) * 2 - 1;
    };
    for (let iz = 0; iz < t.nz; iz++) for (let ix = 0; ix < t.nx; ix++) {
      const x = t.minX + ix * t.res, z = t.minZ + iz * t.res;
      let h = 0;
      octaves.forEach((oc, k) => { h += noise((x + oc.ox) / oc.wl, (z + oc.oz) / oc.wl, k) * oc.a; });
      // Berms along the long edges keep the fight inside the map.
      const edge = Math.min(z - t.minZ, t.minZ + t.depth - z, (x - t.minX) * 0.5, (t.minX + t.width - x) * 0.5);
      if (edge < 30) h += (1 - edge / 30) ** 2 * 14;
      t.h[iz * t.nx + ix] = h;
    }
    t.#bounds();
    return t;
  }
}
const _n = new Vector3();
