// EntityGrid: a uniform XZ hash of fighters, rebuilt once per sim tick (cheap: one push per
// fighter, cell arrays reused). It turns the "every fighter against every query" loops (splash,
// zones, AI perception, bullets) into "fighters in the touched cells" for battles of up to 400.
//
// With the map's bounds the cells are a flat array (a 90 m perception query looks at ~250 cells,
// nearly all empty: an array read each instead of a hash lookup); whatever is off the map goes in
// the nearest edge cell, and queries are clamped the same way, so nothing is ever missed.
// Without bounds (small test worlds) cells are hashed.

import { hyp } from '../core/geom.js';

// A small integer (< 2^30) for cells within ±16384 of the origin: V8 keeps it unboxed, where a
// bigger key would allocate a heap number on every lookup.
const KEY = (ix, iz) => ((ix + 16384) << 15) | (iz + 16384);

export class EntityGrid {
  /** @param {object} o { cell (m), bounds: { minX, minZ, width, depth } } */
  constructor({ cell = 12, bounds = null } = {}) {
    this.cell = cell;
    this.cells = new Map();
    this.used = [];        // cells touched by the last rebuild (cleared on the next one)
    this.count = 0;
    this.flat = null;
    if (bounds) {
      this.x0 = Math.floor(bounds.minX / cell); this.z0 = Math.floor(bounds.minZ / cell);
      this.nxc = Math.floor((bounds.minX + bounds.width) / cell) - this.x0 + 1;
      this.nzc = Math.floor((bounds.minZ + bounds.depth) / cell) - this.z0 + 1;
      this.flat = new Array(this.nxc * this.nzc).fill(null);
      this.stamp = new Uint32Array(this.nxc * this.nzc);   // ray queries visit each cell once
      this.q = 0;
    }
  }

  /** The key of the cell holding (ix, iz): a flat index (clamped onto the map) or a hash. */
  #slot(ix, iz) {
    if (!this.flat) return KEY(ix, iz);
    const x = ix - this.x0, z = iz - this.z0;
    return (x < 0 ? 0 : x >= this.nxc ? this.nxc - 1 : x) * this.nzc + (z < 0 ? 0 : z >= this.nzc ? this.nzc - 1 : z);
  }

  #cell(k) { return this.flat ? this.flat[k] : this.cells.get(k); }

  /** @param {Iterable} list  entities with movement.state.position (or posOf) */
  rebuild(list, posOf = (e) => e.movement.state.position) {
    for (const c of this.used) c.length = 0;
    this.used.length = 0;
    this.count = 0;
    const c = this.cell;
    for (const e of list) {
      const p = posOf(e);
      const k = this.#slot(Math.floor(p.x / c), Math.floor(p.z / c));
      let cell = this.#cell(k);
      if (!cell) { cell = []; if (this.flat) this.flat[k] = cell; else this.cells.set(k, cell); }
      if (cell.length === 0) this.used.push(cell);
      cell.push(e);
      this.count++;
    }
  }

  /** cb(e) for every entity whose cell overlaps the circle (callers do the exact distance test). */
  queryCircle(x, z, r, cb) {
    const c = this.cell;
    if (!Number.isFinite(x + z + r) || r > 4096) return;   // never a runaway loop on a corrupt query
    let x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c), z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    const F = this.flat;
    if (F) {
      const nx = this.nxc, nz = this.nzc;
      x0 = Math.max(0, Math.min(nx - 1, x0 - this.x0)); x1 = Math.max(0, Math.min(nx - 1, x1 - this.x0));
      z0 = Math.max(0, Math.min(nz - 1, z0 - this.z0)); z1 = Math.max(0, Math.min(nz - 1, z1 - this.z0));
      for (let ix = x0; ix <= x1; ix++) {
        const row = ix * nz;
        for (let iz = z0; iz <= z1; iz++) {
          const cell = F[row + iz];
          if (cell) for (let i = 0; i < cell.length; i++) cb(cell[i]);
        }
      }
      return;
    }
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const cell = this.cells.get(KEY(ix, iz));
      if (cell) for (let i = 0; i < cell.length; i++) cb(cell[i]);
    }
  }

  /**
   * cb(e) once for every entity in the cells a ray's corridor touches: the ray (d normalized,
   * `max` long) widened by `pad` metres to each side and at both ends. Used to pre-filter
   * hitscan targets. The corridor's cells are the ones crossed by three parallel lines (its
   * middle and its two edges), walked cell by cell; that misses none while pad <= cell.
   */
  queryRay(o, d, max, pad, cb) {
    const hl = hyp(d.x, d.z);
    if (hl < 1e-6) { this.queryCircle(o.x, o.z, pad, cb); return; }    // straight up or down
    const seen = this.flat ? null : (this._seen ??= new Set());
    if (seen) seen.clear(); else if (++this.q === 0xffffffff) { this.stamp.fill(0); this.q = 1; }
    const ux = d.x / hl, uz = d.z / hl, run = Math.min(max, 4000) * hl + 2 * pad;
    for (let s = -1; s <= 1; s++) this.#walk(o.x - uz * s * pad - ux * pad, o.z + ux * s * pad - uz * pad, ux, uz, run, seen, cb);
  }

  /** Grid DDA: the cells a segment from (x, z) along unit (ux, uz) crosses, each once per query. */
  #walk(x, z, ux, uz, len, seen, cb) {
    const c = this.cell;
    let ix = Math.floor(x / c), iz = Math.floor(z / c);
    const sx = ux > 0 ? 1 : -1, sz = uz > 0 ? 1 : -1;
    const tdx = ux !== 0 ? c / Math.abs(ux) : Infinity, tdz = uz !== 0 ? c / Math.abs(uz) : Infinity;
    let tx = ux !== 0 ? (sx > 0 ? (ix + 1) * c - x : x - ix * c) / Math.abs(ux) : Infinity;
    let tz = uz !== 0 ? (sz > 0 ? (iz + 1) * c - z : z - iz * c) / Math.abs(uz) : Infinity;
    for (let guard = 0; guard < 1024; guard++) {
      const k = this.#slot(ix, iz);
      let fresh;
      if (seen) { fresh = !seen.has(k); if (fresh) seen.add(k); }
      else { fresh = this.stamp[k] !== this.q; this.stamp[k] = this.q; }
      if (fresh) {
        const cell = this.#cell(k);
        if (cell) for (let i = 0; i < cell.length; i++) cb(cell[i]);
      }
      if (Math.min(tx, tz) > len) return;
      if (tx < tz) { tx += tdx; ix += sx; } else { tz += tdz; iz += sz; }
    }
  }
}
