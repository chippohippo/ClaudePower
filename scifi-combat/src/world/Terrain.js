// Terrain: a heightfield for big maps. Bilinear height, normals from central differences, and a
// ray march with bisection refinement. FlatGroundBody (movement), CombatWorld (bullets, splash,
// ground height for vehicles and deployables) and the renderer all read the same samples.
//
// generate() makes rolling, readable battlefield ground from seeded value noise: broad hills
// for long sightlines, a little mid-frequency roughness, and flattened pads where the map puts
// capture points and spawns (fights happen on readable, walkable ground). carveRect() and
// carveDisc() dig trenches, shell craters and foxholes (at map build and at runtime); every
// change is recorded in `dirty` so the renderer and nav can update just that region.

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
    this.dug = new Float32Array(this.nx * this.nz);   // how deep each sample was dug (trench floors and craters read as mud)
    this.surface = 'dirt';
    this.maxHeight = 0;
    this.dirty = [];                                  // [minX, minZ, maxX, maxZ] regions changed since the last takeDirty()
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
    const step = Math.max(this.res * 0.5, 0.75);
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
      if (this.h[i] > this.maxHeight) this.maxHeight = this.h[i];
    }
    this.dirty.push([x - r, z - r, x + r, z + r]);
    return target;
  }

  /**
   * Grade the ground to level rectangles (a city's blocks): flat at its own `y` under each one, and
   * between them (the streets) a blend of the levels nearby weighted by 1 / distance^power (power 1:
   * straight across a street from one block's level to the other's), so the ground meets every
   * rectangle's edge at that rectangle's level. More than `near` metres from any of them it eases
   * back to the ground as it was, by `far`.
   * @param {Array<{x0, z0, x1, z1, y}>} rects
   */
  grade(rects, { near = 16, far = 30, power = 1 } = {}) {
    const C = 32, cells = new Map(), key = (i, j) => i * 100003 + j;
    for (const r of rects) {
      for (let i = Math.floor((r.x0 - far) / C); i <= Math.floor((r.x1 + far) / C); i++) {
        for (let j = Math.floor((r.z0 - far) / C); j <= Math.floor((r.z1 + far) / C); j++) {
          const k = key(i, j);
          (cells.get(k) ?? cells.set(k, []).get(k)).push(r);
        }
      }
    }
    for (let iz = 0; iz < this.nz; iz++) for (let ix = 0; ix < this.nx; ix++) {
      const x = this.minX + ix * this.res, z = this.minZ + iz * this.res;
      const list = cells.get(key(Math.floor(x / C), Math.floor(z / C)));
      if (!list) continue;
      let ws = 0, ys = 0, dmin = Infinity;
      for (const r of list) {
        const d = Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));
        if (d >= far) continue;
        if (d === 0) { ws = 1; ys = r.y; dmin = 0; break; }
        const w = 1 / d ** power;
        ws += w; ys += w * r.y; dmin = Math.min(dmin, d);
      }
      if (!ws) continue;
      const i = iz * this.nx + ix, k = dmin <= near ? 1 : 1 - (dmin - near) / (far - near), t = k * k * (3 - 2 * k);
      this.h[i] += (ys / ws - this.h[i]) * t;
      if (this.h[i] > this.maxHeight) this.maxHeight = this.h[i];
    }
    this.dirty.push([this.minX, this.minZ, this.minX + this.width, this.minZ + this.depth]);
  }

  /**
   * Dig a rectangle `depth` metres into the ground as it lies (the floor follows the terrain),
   * with walls that slope out over `edge` metres: trench floors and their exits.
   * Digging the same place twice doesn't dig deeper than `depth`.
   */
  carveRect(minX, minZ, maxX, maxZ, depth, edge = 0.5) {
    this.#carve(minX - edge, minZ - edge, maxX + edge, maxZ + edge, (px, pz) => {
      const dx = Math.max(minX - px, 0, px - maxX), dz = Math.max(minZ - pz, 0, pz - maxZ);
      const d = Math.hypot(dx, dz);
      if (d >= edge) return 0;
      const k = d <= 0 ? 1 : 1 - d / edge;
      return depth * k * k * (3 - 2 * k);
    });
  }

  /**
   * A bowl `depth` deep and `r` wide, with a thrown-up lip of `rim` metres around it: shell
   * craters and foxholes.
   */
  carveDisc(x, z, r, depth, rim = 0) {
    this.#carve(x - r * 1.35, z - r * 1.35, x + r * 1.35, z + r * 1.35, (px, pz) => {
      const d = Math.hypot(px - x, pz - z) / r;
      if (d < 1) return depth * (1 - d * d) - rim * d * d * d;
      if (d < 1.35) { const u = (d - 1) / 0.35; return -rim * (1 - u) * (1 - u); }
      return 0;
    });
  }

  /**
   * Dig a corridor `depth` below the lowest ground across its width, so its floor is level from
   * wall to wall while still following the ground along its length (`axis`, 'x' or 'z': the long
   * direction). Trench bays and saps on a hillside get a level floor instead of a tilted one.
   * Samples on the rectangle's edges are dug too (corridor edges sit on samples).
   */
  carveLevel(minX, minZ, maxX, maxZ, depth, axis = maxX - minX >= maxZ - minZ ? 'x' : 'z') {
    const r = this.res, e = 1e-6;
    const x0 = Math.max(0, Math.ceil((minX - this.minX) / r - e)), x1 = Math.min(this.nx - 1, Math.floor((maxX - this.minX) / r + e));
    const z0 = Math.max(0, Math.ceil((minZ - this.minZ) / r - e)), z1 = Math.min(this.nz - 1, Math.floor((maxZ - this.minZ) / r + e));
    if (x0 > x1 || z0 > z1) return;
    const orig = (i) => this.h[i] + this.dug[i];   // ground before any digging
    const along = axis === 'x' ? [x0, x1] : [z0, z1], across = axis === 'x' ? [z0, z1] : [x0, x1];
    const at = (a, c) => (axis === 'x' ? c * this.nx + a : a * this.nx + c);
    for (let a = along[0]; a <= along[1]; a++) {
      let low = Infinity;
      for (let c = across[0]; c <= across[1]; c++) low = Math.min(low, orig(at(a, c)));
      const floor = low - depth;
      for (let c = across[0]; c <= across[1]; c++) {
        const i = at(a, c), cut = orig(i) - floor;
        if (cut <= this.dug[i]) continue;
        this.h[i] = floor; this.dug[i] = cut;
      }
    }
    this.dirty.push([minX, minZ, maxX, maxZ]);
  }

  /** Dig the sample nearest (x, z) down to height y (never raises it, never undoes a deeper cut). */
  digTo(x, z, y) {
    const ix = Math.round((x - this.minX) / this.res), iz = Math.round((z - this.minZ) / this.res);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return;
    const i = iz * this.nx + ix, cut = this.h[i] + this.dug[i] - y;
    if (cut <= this.dug[i]) return;
    this.h[i] = y; this.dug[i] = cut;
    this.dirty.push([x - this.res, z - this.res, x + this.res, z + this.res]);
  }

  /** Ground height at the sample nearest (x, z) before any digging. */
  undug(x, z) {
    const ix = Math.max(0, Math.min(this.nx - 1, Math.round((x - this.minX) / this.res))), iz = Math.max(0, Math.min(this.nz - 1, Math.round((z - this.minZ) / this.res)));
    const i = iz * this.nx + ix;
    return this.h[i] + this.dug[i];
  }

  /** cut(px, pz) -> metres to remove (negative raises). Keeps the deepest cut per sample. */
  #carve(x0w, z0w, x1w, z1w, cut) {
    const r = this.res;
    const x0 = Math.max(0, Math.floor((x0w - this.minX) / r)), x1 = Math.min(this.nx - 1, Math.ceil((x1w - this.minX) / r));
    const z0 = Math.max(0, Math.floor((z0w - this.minZ) / r)), z1 = Math.min(this.nz - 1, Math.ceil((z1w - this.minZ) / r));
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      const c = cut(this.minX + ix * r, this.minZ + iz * r);
      if (c === 0) continue;
      const i = iz * this.nx + ix, had = this.dug[i];
      if (c > 0) { if (c <= had) continue; this.h[i] -= c - Math.max(0, had); this.dug[i] = c; }
      else { if (had !== 0) continue; this.h[i] -= c; this.dug[i] = c; if (this.h[i] > this.maxHeight) this.maxHeight = this.h[i]; }
    }
    this.dirty.push([x0w, z0w, x1w, z1w]);
  }

  /** Regions changed since the last call (renderer and nav rebuild just these). */
  takeDirty() { const d = this.dirty; this.dirty = []; return d; }

  #bounds() { let m = -Infinity; for (let i = 0; i < this.h.length; i++) if (this.h[i] > m) m = this.h[i]; this.maxHeight = m; }

  /**
   * Seeded rolling ground. amp = hill height (m); the map edges rise into berms `berm` metres wide.
   */
  static generate({ seed = 1, amp = 9, rough = 0.8, berm = 30, ...dims } = {}) {
    const t = new Terrain(dims);
    const rand = mulberry32(seed);
    const octaves = [[220, amp], [90, amp * 0.35], [28, rough], [9, rough * 0.25]].map(([wl, a]) => ({ wl, a, ox: rand() * 1000, oz: rand() * 1000 }));
    const O0 = octaves[0], O1 = octaves[1], O2 = octaves[2], O3 = octaves[3];
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
      let h = noise((x + O0.ox) / O0.wl, (z + O0.oz) / O0.wl, 0) * O0.a + noise((x + O1.ox) / O1.wl, (z + O1.oz) / O1.wl, 1) * O1.a
        + noise((x + O2.ox) / O2.wl, (z + O2.oz) / O2.wl, 2) * O2.a + noise((x + O3.ox) / O3.wl, (z + O3.oz) / O3.wl, 3) * O3.a;
      // Berms along the long edges keep the fight inside the map.
      const edge = Math.min(z - t.minZ, t.minZ + t.depth - z, (x - t.minX) * 0.5, (t.minX + t.width - x) * 0.5);
      if (edge < berm) h += (1 - edge / berm) ** 2 * 14;
      t.h[iz * t.nx + ix] = h;
    }
    t.#bounds();
    return t;
  }
}
const _n = new Vector3();
