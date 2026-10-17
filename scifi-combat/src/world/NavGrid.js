// NavGrid: walkability over a big map plus per-goal flow fields, for bot macro navigation.
//
// One Dijkstra from each goal (a capture point, a spawn, a squad rally) gives every cell the
// direction of its cheapest route to that goal, so 128 bots can share one field per objective
// instead of running 128 path searches. Fields are cached and rebuilt lazily when cover is
// destroyed (version stamps). Locally, bots still steer, take cover and fight; the field only
// answers "which way is the objective from here, around the walls".
//
// Cells: steep terrain (> maxSlope) and cover taller than vaultHeight are blocked; vaultable
// cover is passable at extra cost (bots vault it with the hold-to-climb input).

import { Vector3 } from 'three';

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
const LEN = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

export class NavGrid {
  /**
   * @param {object} bounds { minX, minZ, width, depth, cell }
   * @param {object} opts   { cover (array | CoverIndex), terrain, maxSlope, vaultHeight, agentRadius }
   */
  constructor({ minX, minZ, width, depth, cell = 2 }, { cover = [], terrain = null, maxSlope = 38, vaultHeight = 1.0, agentRadius = 0.45 } = {}) {
    this.minX = minX; this.minZ = minZ; this.cell = cell;
    this.nx = Math.ceil(width / cell); this.nz = Math.ceil(depth / cell);
    this.cover = cover; this.terrain = terrain;
    this.maxSlope = maxSlope; this.vaultHeight = vaultHeight; this.agentRadius = agentRadius;
    this.cost = new Float32Array(this.nx * this.nz);
    this.version = 0;
    this.fields = new Map();
    this.#rebuild(0, 0, this.nx - 1, this.nz - 1);
  }

  index(x, z) {
    const ix = Math.floor((x - this.minX) / this.cell), iz = Math.floor((z - this.minZ) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return -1;
    return iz * this.nx + ix;
  }
  centerOf(i, out = new Vector3()) {
    const ix = i % this.nx, iz = (i - ix) / this.nx;
    return out.set(this.minX + (ix + 0.5) * this.cell, 0, this.minZ + (iz + 0.5) * this.cell);
  }
  blocked(x, z) { const i = this.index(x, z); return i < 0 || this.cost[i] === Infinity; }

  /** Recompute walkability in a world rectangle (cover destroyed or added) and invalidate fields. */
  updateRegion(minX, minZ, maxX, maxZ) {
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((minX - this.minX) / c) - 1), z0 = Math.max(0, Math.floor((minZ - this.minZ) / c) - 1);
    const x1 = Math.min(this.nx - 1, Math.floor((maxX - this.minX) / c) + 1), z1 = Math.min(this.nz - 1, Math.floor((maxZ - this.minZ) / c) + 1);
    this.#rebuild(x0, z0, x1, z1);
    this.version++;
  }

  #rebuild(x0, z0, x1, z1) {
    const c = this.cell, t = this.terrain;
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      const x = this.minX + (ix + 0.5) * c, z = this.minZ + (iz + 0.5) * c;
      this.cost[iz * this.nx + ix] = t && t.slopeDeg(x, z) > this.maxSlope ? Infinity : 1;
    }
    // Cover: footprints grown by the agent radius. Tall boxes block, vaultable ones cost extra.
    const r = this.agentRadius;
    const minX = this.minX + x0 * c, minZ = this.minZ + z0 * c, maxX = this.minX + (x1 + 1) * c, maxZ = this.minZ + (z1 + 1) * c;
    const visit = (b) => {
      const ground = t ? t.height((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2) : 0;
      const h = b.max.y - Math.max(ground, b.min.y);
      if (h <= 0.35) return;
      const bx0 = Math.max(x0, Math.floor((b.min.x - r - this.minX) / c)), bx1 = Math.min(x1, Math.floor((b.max.x + r - this.minX) / c));
      const bz0 = Math.max(z0, Math.floor((b.min.z - r - this.minZ) / c)), bz1 = Math.min(z1, Math.floor((b.max.z + r - this.minZ) / c));
      for (let iz = bz0; iz <= bz1; iz++) for (let ix = bx0; ix <= bx1; ix++) {
        const i = iz * this.nx + ix;
        this.cost[i] = h > this.vaultHeight ? Infinity : Math.max(this.cost[i], 4);
      }
    };
    if (this.cover?.queryAABB) this.cover.queryAABB(minX - r, minZ - r, maxX + r, maxZ + r, visit);
    else for (const b of this.cover ?? []) if (b.max.x >= minX - r && b.min.x <= maxX + r && b.max.z >= minZ - r && b.min.z <= maxZ + r) visit(b);
  }

  /**
   * Flow field toward a goal disc (cached by key; rebuilt when walkability changed).
   * @returns {{ dist: Float32Array, dir: Int8Array, version, key }}
   */
  field(key, gx, gz, radius = 4) {
    let f = this.fields.get(key);
    if (f && f.version === this.version && f.gx === gx && f.gz === gz) return f;
    f = this.#dijkstra(gx, gz, radius);
    f.key = key; f.gx = gx; f.gz = gz;
    this.fields.set(key, f);
    return f;
  }

  #dijkstra(gx, gz, radius) {
    const n = this.nx * this.nz, nx = this.nx, nz = this.nz, cost = this.cost;
    const dist = new Float32Array(n).fill(Infinity);
    const dir = new Int8Array(n).fill(-1);
    const heap = new MinHeap(n);
    const c = this.cell, r = Math.max(radius, c * 0.75);
    const x0 = Math.max(0, Math.floor((gx - r - this.minX) / c)), x1 = Math.min(nx - 1, Math.floor((gx + r - this.minX) / c));
    const z0 = Math.max(0, Math.floor((gz - r - this.minZ) / c)), z1 = Math.min(nz - 1, Math.floor((gz + r - this.minZ) / c));
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      const i = iz * nx + ix;
      if (cost[i] === Infinity) continue;
      if (Math.hypot(this.minX + (ix + 0.5) * c - gx, this.minZ + (iz + 0.5) * c - gz) > r) continue;
      dist[i] = 0; heap.push(i, 0);
    }
    while (heap.size) {
      const i = heap.pop(), di = dist[i];
      if (heap.lastKey > di) continue; // stale entry
      const ix = i % nx, iz = (i - ix) / nx;
      for (let k = 0; k < 8; k++) {
        const jx = ix + DX[k], jz = iz + DZ[k];
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
        const j = jz * nx + jx;
        if (cost[j] === Infinity) continue;
        // No diagonal corner cutting past blocked cells.
        if (k >= 4 && (cost[iz * nx + jx] === Infinity || cost[jz * nx + ix] === Infinity)) continue;
        const nd = di + LEN[k] * 0.5 * (cost[i] + cost[j]);
        if (nd < dist[j]) { dist[j] = nd; dir[j] = k ^ 1 ^ (k >= 4 ? 2 : 0); heap.push(j, nd); }
      }
    }
    // dir[j] stores the neighbour index pointing back toward i (the step toward the goal).
    return { dist, dir, version: this.version };
  }

  /**
   * Direction toward the field's goal at a world position (blended over the 4 nearest cells,
   * so agents curve smoothly around corners). Returns false when unreachable or at the goal.
   */
  sample(f, x, z, out) {
    const c = this.cell;
    const fx = (x - this.minX) / c - 0.5, fz = (z - this.minZ) / c - 0.5;
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    let sx = 0, sz = 0, any = false, atGoal = false;
    for (let k = 0; k < 4; k++) {
      const cx = ix + (k & 1), cz = iz + (k >> 1);
      if (cx < 0 || cz < 0 || cx >= this.nx || cz >= this.nz) continue;
      const i = cz * this.nx + cx;
      const w = ((k & 1) ? tx : 1 - tx) * ((k >> 1) ? tz : 1 - tz);
      if (f.dist[i] === 0) { atGoal = true; continue; }
      const d = f.dir[i];
      if (d < 0 || w <= 0) continue;
      const l = LEN[d];
      sx += (DX[d] / l) * w; sz += (DZ[d] / l) * w; any = true;
    }
    if (!any) return false;
    const len = Math.hypot(sx, sz);
    if (len < 1e-6) return atGoal ? false : false;
    out.set(sx / len, 0, sz / len);
    return true;
  }

  /** Route length (m) from a position to the field's goal, or Infinity. */
  distance(f, x, z) { const i = this.index(x, z); return i < 0 ? Infinity : f.dist[i] * this.cell; }

  /** Follows the field from a point (tests, debug drawing). */
  trace(f, x, z, maxSteps = 2000) {
    const pts = [];
    let i = this.index(x, z);
    for (let s = 0; s < maxSteps && i >= 0; s++) {
      pts.push(this.centerOf(i));
      if (f.dist[i] === 0) return { pts, reached: true };
      const d = f.dir[i];
      if (d < 0) break;
      const ix = (i % this.nx) + DX[d], iz = Math.floor(i / this.nx) + DZ[d];
      i = iz * this.nx + ix;
    }
    return { pts, reached: false };
  }
}

/** Binary min-heap of cell indices keyed by float distance (duplicates allowed, stale ones skipped). */
class MinHeap {
  constructor(cap) { this.idx = new Int32Array(cap * 2 + 16); this.key = new Float32Array(cap * 2 + 16); this.size = 0; this.lastKey = 0; }
  push(i, k) {
    if (this.size >= this.idx.length) { const ni = new Int32Array(this.idx.length * 2), nk = new Float32Array(this.key.length * 2); ni.set(this.idx); nk.set(this.key); this.idx = ni; this.key = nk; }
    let p = this.size++;
    while (p > 0) {
      const q = (p - 1) >> 1;
      if (this.key[q] <= k) break;
      this.idx[p] = this.idx[q]; this.key[p] = this.key[q]; p = q;
    }
    this.idx[p] = i; this.key[p] = k;
  }
  pop() {
    const top = this.idx[0]; this.lastKey = this.key[0];
    const n = --this.size;
    if (n > 0) {
      const i = this.idx[n], k = this.key[n];
      let p = 0;
      for (;;) {
        let c = 2 * p + 1;
        if (c >= n) break;
        if (c + 1 < n && this.key[c + 1] < this.key[c]) c++;
        if (this.key[c] >= k) break;
        this.idx[p] = this.idx[c]; this.key[p] = this.key[c]; p = c;
      }
      this.idx[p] = i; this.key[p] = k;
    }
    return top;
  }
}
