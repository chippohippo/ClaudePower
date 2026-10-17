// CoverIndex: a uniform XZ grid over static and destructible cover boxes, for big maps.
//
// It stands in for the plain cover array everywhere: iteration, `length`, `push`, `indexOf`
// and `splice` work, so CombatWorld, the movement bodies and the tests can use either. What
// big maps need on top:
//  * queryAABB(minX, minZ, maxX, maxZ, cb): only the boxes in the cells touched (movement
//    bodies, vehicles, splash, cover destruction).
//  * raycast(o, d, max): a DDA walk over the cells along the ray, testing each box once
//    (stamp dedup), stopping as soon as the nearest hit is closer than the next cell boundary.
// Boxes are { min: Vector3, max: Vector3, destructible?, surface? }.

import { Vector3 } from 'three';

// A small integer (< 2^30) for cells within ±16384 of the origin: V8 keeps it unboxed, where a
// bigger key would allocate a heap number on every lookup.
const KEY = (ix, iz) => ((ix + 16384) << 15) | (iz + 16384);

export class CoverIndex {
  constructor(boxes = [], { cell = 8 } = {}) {
    this.cell = cell;
    this.cells = new Map();
    this.list = [];
    this.stamp = 0;
    for (const b of boxes) this.add(b);
  }

  get length() { return this.list.length; }
  [Symbol.iterator]() { return this.list[Symbol.iterator](); }
  indexOf(b) { return this.list.indexOf(b); }
  push(...boxes) { for (const b of boxes) this.add(b); return this.list.length; }
  splice(i, n = 1) { const out = this.list.slice(i, i + n); for (const b of out) this.remove(b); return out; }
  filter(fn) { return this.list.filter(fn); }
  some(fn) { return this.list.some(fn); }

  #range(minX, minZ, maxX, maxZ) {
    const c = this.cell;
    // A corrupt query (NaN, or a body flung to infinity) must never turn into a billion-cell loop.
    if (!Number.isFinite(minX + minZ + maxX + maxZ) || maxX - minX > 4096 || maxZ - minZ > 4096) return [1, 1, 0, 0];
    return [Math.floor(minX / c), Math.floor(minZ / c), Math.floor(maxX / c), Math.floor(maxZ / c)];
  }

  add(b) {
    b._stamp = 0;
    this.list.push(b);
    const [x0, z0, x1, z1] = this.#range(b.min.x, b.min.z, b.max.x, b.max.z);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const k = KEY(ix, iz);
      let cell = this.cells.get(k);
      if (!cell) this.cells.set(k, (cell = []));
      cell.push(b);
    }
    return b;
  }

  remove(b) {
    const i = this.list.indexOf(b);
    if (i < 0) return false;
    this.list.splice(i, 1);
    const [x0, z0, x1, z1] = this.#range(b.min.x, b.min.z, b.max.x, b.max.z);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const cell = this.cells.get(KEY(ix, iz));
      const j = cell ? cell.indexOf(b) : -1;
      if (j >= 0) cell.splice(j, 1);
    }
    return true;
  }

  /** Calls cb(box) once for every box overlapping the XZ rectangle. */
  queryAABB(minX, minZ, maxX, maxZ, cb) {
    const s = ++this.stamp;
    const [x0, z0, x1, z1] = this.#range(minX, minZ, maxX, maxZ);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const cell = this.cells.get(KEY(ix, iz));
      if (!cell) continue;
      for (const b of cell) {
        if (b._stamp === s) continue;
        b._stamp = s;
        if (b.max.x >= minX && b.min.x <= maxX && b.max.z >= minZ && b.min.z <= maxZ) cb(b);
      }
    }
  }

  /** The highest box top at or below `below` over the point (x, z), or -Infinity. One cell, no callback. */
  topAt(x, z, below) {
    const cell = this.cells.get(KEY(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    let top = -Infinity;
    if (cell) for (let i = 0; i < cell.length; i++) {
      const b = cell[i];
      if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z && b.max.y <= below && b.max.y > top) top = b.max.y;
    }
    return top;
  }

  /**
   * Nearest box hit along a ray (d normalized).
   * @returns {{ distance, point: Vector3, normal: Vector3, cover }} | null
   */
  raycast(o, d, max, filter = null) {
    const c = this.cell, s = ++this.stamp;
    let ix = Math.floor(o.x / c), iz = Math.floor(o.z / c);
    const stepX = d.x > 0 ? 1 : -1, stepZ = d.z > 0 ? 1 : -1;
    const dx = Math.abs(d.x) < 1e-9 ? 1e-9 : d.x, dz = Math.abs(d.z) < 1e-9 ? 1e-9 : d.z;
    let tMaxX = ((ix + (stepX > 0 ? 1 : 0)) * c - o.x) / dx;
    let tMaxZ = ((iz + (stepZ > 0 ? 1 : 0)) * c - o.z) / dz;
    const tDX = Math.abs(c / dx), tDZ = Math.abs(c / dz);
    let best = null, bestT = max, axis = 1, sign = 1, t = 0;
    for (let guard = 0; guard < 4096; guard++) {
      const cell = this.cells.get(KEY(ix, iz));
      if (cell) for (let i = 0; i < cell.length; i++) {
        const b = cell[i];
        if (b._stamp === s) continue;
        b._stamp = s;
        if (filter && !filter(b)) continue;
        const h = slab(o, d, b, bestT);
        if (h >= 0) { bestT = h; best = b; axis = _hit.axis; sign = _hit.sign; }
      }
      // The nearest hit so far is before the next cell: nothing further can beat it.
      const next = Math.min(tMaxX, tMaxZ);
      if (best && bestT <= next) break;
      t = next;
      if (t > bestT || t > max) break;
      if (tMaxX < tMaxZ) { ix += stepX; tMaxX += tDX; } else { iz += stepZ; tMaxZ += tDZ; }
    }
    if (!best) return null;
    const normal = new Vector3(); normal.setComponent(axis, sign);
    return { distance: bestT, point: new Vector3().copy(o).addScaledVector(d, bestT), normal, cover: best, surface: best.surface ?? 'metal' };
  }
}

/** Slab test. Returns { t, axis, sign } of the entry face, or null. A ray starting inside reports t = 0. */
export function rayBox(o, d, b, maxDist) {
  const t = slab(o, d, b, maxDist);
  return t < 0 ? null : { t, axis: _hit.axis, sign: _hit.sign };
}

// The slab test itself, unrolled and allocation-free (it runs for every box along every ray):
// returns the entry distance or -1, and leaves the entry face in _hit.
const _hit = { axis: 1, sign: 1 };
function slab(o, d, b, maxDist) {
  let tmin = 0, tmax = maxDist, axis = 1, sign = 1, t1, t2, sg;
  if (Math.abs(d.x) < 1e-12) { if (o.x < b.min.x || o.x > b.max.x) return -1; }
  else {
    t1 = (b.min.x - o.x) / d.x; t2 = (b.max.x - o.x) / d.x; sg = -1;
    if (t1 > t2) { const k = t1; t1 = t2; t2 = k; sg = 1; }
    if (t1 > tmin) { tmin = t1; axis = 0; sign = sg; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (Math.abs(d.y) < 1e-12) { if (o.y < b.min.y || o.y > b.max.y) return -1; }
  else {
    t1 = (b.min.y - o.y) / d.y; t2 = (b.max.y - o.y) / d.y; sg = -1;
    if (t1 > t2) { const k = t1; t1 = t2; t2 = k; sg = 1; }
    if (t1 > tmin) { tmin = t1; axis = 1; sign = sg; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (Math.abs(d.z) < 1e-12) { if (o.z < b.min.z || o.z > b.max.z) return -1; }
  else {
    t1 = (b.min.z - o.z) / d.z; t2 = (b.max.z - o.z) / d.z; sg = -1;
    if (t1 > t2) { const k = t1; t1 = t2; t2 = k; sg = 1; }
    if (t1 > tmin) { tmin = t1; axis = 2; sign = sg; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  _hit.axis = axis; _hit.sign = sign;
  return tmin;
}
