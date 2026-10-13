// Ground-level navigation for bots: a 1 m occupancy grid rasterised from the map's boxes
// (door gaps stay open, walls/windows/crates block) and a windowed A* (8-connected, octile
// heuristic, binary heap) with line-of-sight string pulling. Paths are only requested when a bot's
// direct steering is obstructed, and a per-tick budget keeps the cost bounded.

import { MAP_HALF } from '../shared/constants.js';

const CELL = 1;
const WIN = 96; // A* search window (cells) centred between start and goal
const MAX_EXPANSIONS = 5000;

export class NavGrid {
  constructor(map) {
    this.half = MAP_HALF + 40;
    this.n = Math.ceil((this.half * 2) / CELL);
    this.blocked = new Uint8Array(this.n * this.n);
    const T = map.terrain, pad = 0.35;
    for (const b of map.boxes) {
      const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
      const g = T ? T.height(cx, cz) : 0;
      // blocks walking if it overlaps the body band above local ground and can't be stepped onto
      if (b.min[1] > g + 1.7 || b.max[1] < g + 0.5) continue;
      // mark cells whose centre lies inside the box grown by the body radius
      const i0 = Math.ceil((b.min[0] - pad + this.half) / CELL - 0.5), i1 = Math.floor((b.max[0] + pad + this.half) / CELL - 0.5);
      const j0 = Math.ceil((b.min[2] - pad + this.half) / CELL - 0.5), j1 = Math.floor((b.max[2] + pad + this.half) / CELL - 0.5);
      for (let j = Math.max(0, j0); j <= Math.min(this.n - 1, j1); j++)
        for (let i = Math.max(0, i0); i <= Math.min(this.n - 1, i1); i++) this.blocked[j * this.n + i] = 1;
    }
    const W = WIN;
    this.g = new Float32Array(W * W);
    this.parent = new Int32Array(W * W);
    this.stamp = new Uint32Array(W * W);
    this.closed = new Uint32Array(W * W);
    this.gen = 1;
    this.heap = [];
  }

  ix(x) { return Math.max(0, Math.min(this.n - 1, Math.floor((x + this.half) / CELL))); }
  wx(i) { return -this.half + (i + 0.5) * CELL; }
  isBlocked(i, j) { return i < 0 || j < 0 || i >= this.n || j >= this.n || this.blocked[j * this.n + i] === 1; }

  // Bresenham walkability between two cells
  lineClear(i0, j0, i1, j1) {
    let dx = Math.abs(i1 - i0), dy = Math.abs(j1 - j0), sx = i0 < i1 ? 1 : -1, sy = j0 < j1 ? 1 : -1, err = dx - dy;
    for (let k = 0; k < 400; k++) {
      if (this.isBlocked(i0, j0)) return false;
      if (i0 === i1 && j0 === j1) return true;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; i0 += sx; }
      if (e2 < dx) { err += dx; j0 += sy; }
    }
    return false;
  }

  nearestFree(i, j, r = 4) {
    if (!this.isBlocked(i, j)) return [i, j];
    for (let d = 1; d <= r; d++)
      for (let a = -d; a <= d; a++)
        for (const [ii, jj] of [[i + a, j - d], [i + a, j + d], [i - d, j + a], [i + d, j + a]])
          if (!this.isBlocked(ii, jj)) return [ii, jj];
    return null;
  }

  // Returns [{x, z}, ...] waypoints (excluding start) or null.
  findPath(sx, sz, gx, gz) {
    let s = this.nearestFree(this.ix(sx), this.ix(sz));
    let t = this.nearestFree(this.ix(gx), this.ix(gz));
    if (!s || !t) return null;
    const W = WIN;
    // window centred between start and goal; clamp the goal into it
    const ox = Math.round((s[0] + t[0]) / 2 - W / 2), oz = Math.round((s[1] + t[1]) / 2 - W / 2);
    const inW = (i, j) => i >= ox && j >= oz && i < ox + W && j < oz + W;
    if (!inW(s[0], s[1])) return null;
    if (!inW(t[0], t[1])) {
      t = [Math.max(ox + 1, Math.min(ox + W - 2, t[0])), Math.max(oz + 1, Math.min(oz + W - 2, t[1]))];
      t = this.nearestFree(t[0], t[1], 6);
      if (!t || !inW(t[0], t[1])) return null;
    }
    if (this.lineClear(s[0], s[1], t[0], t[1])) return [{ x: this.wx(t[0]), z: this.wx(t[1]) }];
    const gen = ++this.gen;
    const heap = this.heap;
    heap.length = 0;
    const key = (i, j) => (j - oz) * W + (i - ox);
    const h = (i, j) => { const dx = Math.abs(i - t[0]), dz = Math.abs(j - t[1]); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    const push = (f, k) => {
      heap.push([f, k]);
      let c = heap.length - 1;
      while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let c = 0;
        for (;;) {
          const l = c * 2 + 1, r = l + 1;
          let m = c;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === c) break;
          [heap[m], heap[c]] = [heap[c], heap[m]];
          c = m;
        }
      }
      return top;
    };
    const sk = key(s[0], s[1]), tk = key(t[0], t[1]);
    this.g[sk] = 0; this.stamp[sk] = gen; this.parent[sk] = -1;
    push(h(s[0], s[1]), sk);
    let found = false, exp = 0;
    while (heap.length && exp < MAX_EXPANSIONS) {
      const [, k] = pop();
      if (this.closed[k] === gen) continue;
      this.closed[k] = gen;
      exp++;
      if (k === tk) { found = true; break; }
      const ci = (k % W) + ox, cj = Math.floor(k / W) + oz;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di, nj = cj + dj;
          if (!inW(ni, nj) || this.isBlocked(ni, nj)) continue;
          if (di && dj && (this.isBlocked(ci + di, cj) || this.isBlocked(ci, cj + dj))) continue; // no corner cutting
          const nk = key(ni, nj);
          if (this.closed[nk] === gen) continue;
          const ng = this.g[k] + (di && dj ? 1.414 : 1);
          if (this.stamp[nk] !== gen || ng < this.g[nk]) {
            this.stamp[nk] = gen; this.g[nk] = ng; this.parent[nk] = k;
            push(ng + h(ni, nj), nk);
          }
        }
    }
    if (!found) return null;
    // rebuild and string-pull
    const cells = [];
    for (let k = tk; k !== -1; k = this.parent[k]) cells.push([(k % W) + ox, Math.floor(k / W) + oz]);
    cells.reverse();
    const out = [];
    let a = cells[0];
    for (let i = 2; i < cells.length; i++) {
      if (!this.lineClear(a[0], a[1], cells[i][0], cells[i][1])) { a = cells[i - 1]; out.push({ x: this.wx(a[0]), z: this.wx(a[1]) }); }
    }
    out.push({ x: this.wx(t[0]), z: this.wx(t[1]) });
    return out;
  }
}
