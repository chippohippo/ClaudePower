// NavGrid: walkability over a big map plus per-goal flow fields, for bot macro navigation.
//
// One Dijkstra from each goal (a capture point, a spawn, a squad rally) gives every cell the
// direction of its cheapest route to that goal, so 128 bots can share one field per objective
// instead of running 128 path searches. Fields are cached; when cover is destroyed they go stale
// (version stamps) and maintain() rebuilds them as resumable Dijkstra runs sliced across ticks,
// while the stale field keeps serving. Locally, bots still steer, take cover and fight; the field only
// answers "which way is the objective from here, around the walls".
//
// Cells: steep terrain (> maxSlope) and cover taller than vaultHeight are blocked; vaultable
// cover is passable at extra cost (bots vault it with the hold-to-climb input), and cost zones
// (barbed wire) are passable but expensive, so routes go through the gaps.

import { Vector3 } from 'three';

const IDLE = 600;            // maintain() calls (~10 s) after which an unused stale field stops being refreshed
const SOFT = 0.3;            // share of maintain()'s budget for fields whose routes only got better
const BIG = 150000;          // cells (a 64v64 map and up): past this, fields are built in the background (want()) and evicted when idle
const MAX_FIELDS = 24;       // fields a big map keeps
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
const LEN = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

export class NavGrid {
  /**
   * @param {object} bounds { minX, minZ, width, depth, cell }
   * @param {object} opts   { cover (array | CoverIndex), terrain, maxSlope, vaultHeight, agentRadius, zones: [{ minX, minZ, maxX, maxZ, cost }],
   *                          portals: [{ x, z, nx, nz }] doorways (routes thread through their centres) }
   */
  constructor({ minX, minZ, width, depth, cell = 2 }, { cover = [], terrain = null, maxSlope = 38, vaultHeight = 1.0, agentRadius = 0.45, zones = [], portals = [] } = {}) {
    this.minX = minX; this.minZ = minZ; this.cell = cell;
    this.nx = Math.ceil(width / cell); this.nz = Math.ceil(depth / cell);
    this.cover = cover; this.terrain = terrain;
    this.maxSlope = maxSlope; this.vaultHeight = vaultHeight; this.agentRadius = agentRadius;
    this.zones = zones;
    // Doorways (narrower than a cell): their cells stay open and routes pass through the door's
    // centre. portal[cell] = index + 1 into `portals`.
    this.portals = portals;
    this.portal = new Uint16Array(this.nx * this.nz);
    this.cost = new Float32Array(this.nx * this.nz);
    this.version = 0;
    this.fields = new Map();
    this.stale = new Set();
    this.job = null;                                  // the rebuild maintain() is part-way through
    this.clock = 0;                                   // maintain() calls: fields remember when they were last asked for
    this.pending = new Map();                         // big maps: fields asked for with want(), built in maintain()
    this.soft = 0;                                    // bumped when cells only got cheaper (see updateRegion)
    this.syncHeap = new MinHeap(this.nx * this.nz);   // shared search heaps: no 1.6 MB of garbage per solve
    this.jobHeap = new MinHeap(this.nx * this.nz);
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

  /**
   * Recompute walkability in a world rectangle (cover destroyed or added, ground dug) and
   * invalidate the flow fields, but only when it matters:
   *  * a cell got worse (blocked, or costlier): fields refresh first, on the full budget (an old
   *    route may lead into it);
   *  * cells only got better (a shell blew a gap in a parapet, wire was cut): the old fields are
   *    still good, just not the shortest, so they refresh on a small share of the budget (SOFT).
   *    A barrage then costs a trickle instead of rebuilding every field all the time;
   *  * nothing changed (a crater on open ground): nothing to do.
   */
  updateRegion(minX, minZ, maxX, maxZ) {
    const c = this.cell, nx = this.nx;
    const x0 = Math.max(0, Math.floor((minX - this.minX) / c) - 1), z0 = Math.max(0, Math.floor((minZ - this.minZ) / c) - 1);
    const x1 = Math.min(this.nx - 1, Math.floor((maxX - this.minX) / c) + 1), z1 = Math.min(this.nz - 1, Math.floor((maxZ - this.minZ) / c) + 1);
    const w = x1 - x0 + 1, before = new Float32Array(w * (z1 - z0 + 1));
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) before[(iz - z0) * w + ix - x0] = this.cost[iz * nx + ix];
    this.#rebuild(x0, z0, x1, z1);
    let better = false;
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      const was = before[(iz - z0) * w + ix - x0], now = this.cost[iz * nx + ix];
      if (now > was) {
        this.version++;
        if (this.job && !this.job.hard) { this.stale.add(this.job.key); this.job = null; }   // drop a slow refresh in progress
        return;
      }
      if (now < was) better = true;
    }
    if (better) this.soft++;
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
      // Trench parapets are climbable (going over the top, at a cost that keeps routes from
      // walking along their tops) and aren't grown: the floor beside them stays its own column.
      const parapet = b.kind === 'parapet', g = parapet ? -0.01 : r;
      const bx0 = Math.max(x0, Math.floor((b.min.x - g - this.minX) / c)), bx1 = Math.min(x1, Math.floor((b.max.x + g - this.minX) / c));
      const bz0 = Math.max(z0, Math.floor((b.min.z - g - this.minZ) / c)), bz1 = Math.min(z1, Math.floor((b.max.z + g - this.minZ) / c));
      for (let iz = bz0; iz <= bz1; iz++) for (let ix = bx0; ix <= bx1; ix++) {
        const i = iz * this.nx + ix;
        this.cost[i] = h > this.vaultHeight && !parapet ? Infinity : Math.max(this.cost[i], parapet ? 10 : 4);
      }
    };
    if (this.cover?.queryAABB) this.cover.queryAABB(minX - r, minZ - r, maxX + r, maxZ + r, visit);
    else for (const b of this.cover ?? []) if (b.max.x >= minX - r && b.min.x <= maxX + r && b.max.z >= minZ - r && b.min.z <= maxZ + r) visit(b);
    for (const [k, d] of this.portals.entries()) {
      if (d.x < minX - c || d.x > maxX + c || d.z < minZ - c || d.z > maxZ + c) continue;
      // The cells the doorway's opening passes through (across the wall, ±1 m), open at a small cost.
      for (const s of [-1, 0, 1]) {
        const i = this.index(d.x + d.nx * s, d.z + d.nz * s);
        if (i < 0) continue;
        const ix = i % this.nx, iz = (i - ix) / this.nx;
        if (ix < x0 || ix > x1 || iz < z0 || iz > z1) continue;
        this.cost[i] = this.cost[i] === Infinity ? 1.5 : Math.max(this.cost[i], 1.5);
        this.portal[i] = k + 1;
      }
    }
    for (const z of this.zones) {
      if (z.maxX < minX || z.minX > maxX || z.maxZ < minZ || z.minZ > maxZ) continue;
      const zx0 = Math.max(x0, Math.floor((z.minX - this.minX) / c)), zx1 = Math.min(x1, Math.floor((z.maxX - this.minX) / c));
      const zz0 = Math.max(z0, Math.floor((z.minZ - this.minZ) / c)), zz1 = Math.min(z1, Math.floor((z.maxZ - this.minZ) / c));
      for (let iz = zz0; iz <= zz1; iz++) for (let ix = zx0; ix <= zx1; ix++) {
        const i = iz * this.nx + ix;
        if (this.cost[i] !== Infinity) this.cost[i] = Math.max(this.cost[i], z.cost);
      }
    }
  }

  /** Remove the cost zones overlapping a rectangle (wire cut by a blast) and rebuild there. */
  removeZones(minX, minZ, maxX, maxZ) {
    const hit = this.zones.filter((z) => !(z.maxX < minX || z.minX > maxX || z.maxZ < minZ || z.minZ > maxZ));
    if (!hit.length) return [];
    this.zones = this.zones.filter((z) => !hit.includes(z));
    for (const z of hit) this.updateRegion(z.minX, z.minZ, z.maxX, z.maxZ);
    return hit;
  }

  /** A map big enough that solving a field on demand would hitch (and caching all of them would not fit). */
  get big() { return this.nx * this.nz > BIG; }

  /**
   * The flow field for a goal, the way callers that can wait should ask for it. On small maps
   * it is field() (solved at once). On big maps a missing field is queued and built in
   * maintain(), on its budget, and want() returns null until it's ready: the caller falls back
   * to an A* route or a straight line for those few seconds.
   */
  want(key, gx, gz, radius = 4) {
    if (!this.big) return this.field(key, gx, gz, radius);
    const f = this.fields.get(key);
    if (f && f.gx === gx && f.gz === gz) {
      f.used = this.clock;
      if (f.version !== this.version || f.soft !== this.soft) this.stale.add(key);
      return f;
    }
    if (!this.pending.has(key) && this.job?.key !== key) this.pending.set(key, { gx, gz, radius });
    return null;
  }

  /**
   * Flow field toward a goal disc, cached by key. A new key is solved at once; a cached field
   * whose walkability changed keeps serving and is queued for maintain().
   * @returns {{ dist: Float32Array, dir: Int8Array, version, key }}
   */
  field(key, gx, gz, radius = 4) {
    let f = this.fields.get(key);
    if (f && f.gx === gx && f.gz === gz) {
      f.used = this.clock;
      if (f.soft !== this.soft) this.stale.add(key);
      // A stale field stays usable: destroyed cover only opens new routes, so the old ones are
      // still walkable. maintain() refreshes stale fields on a time budget (no hitch per blast).
      if (f.version !== this.version) this.stale.add(key);
      return f;
    }
    const job = this.#begin(gx, gz, radius, this.syncHeap);
    this.#advance(job, Infinity);
    f = this.#finish(job, key);
    f.used = this.clock;
    this.fields.set(key, f);
    return f;
  }

  /**
   * Refresh stale fields in slices (call every tick): a rebuild expands at most `cells` search
   * nodes per call and resumes on the next one, while the stale field keeps serving. The budget
   * counts work, not wall-clock time, so the sim stays deterministic (server, clients and replays
   * agree on the tick a field flips). 4000 cells is ~0.7 ms; a full 1 km field (100k cells)
   * finishes in a few dozen ticks instead of costing one ~20 ms hitch.
   */
  maintain(cells = 4000) {
    let budget = cells, soft = Math.min(cells, Math.ceil(cells * SOFT));
    this.clock++;
    for (;;) {
      if (!this.job) {
        // Fields whose routes got worse go first, then the one asked for most recently. One nobody
        // has used for a while (a gun's route after it arrived, a truck's while it's parked) is
        // dropped from the queue and comes back as soon as someone asks for it again.
        let key, best = -Infinity;
        for (const k of this.stale) {
          const f = this.fields.get(k);
          if (!f || (f.version === this.version && f.soft === this.soft) || this.clock - (f.used ?? -1) > IDLE) { this.stale.delete(k); continue; }
          const pri = (f.version !== this.version ? 1e12 : 0) + (f.used ?? 0);
          if (pri > best) { best = pri; key = k; }
        }
        if (best < 1e12 && this.pending.size) {
          // A field someone asked for (want()) comes before routes that only got better.
          const [k, g] = this.pending.entries().next().value;
          this.pending.delete(k);
          this.job = this.#begin(g.gx, g.gz, g.radius, this.jobHeap);
          this.job.key = k; this.job.hard = true; this.job.fresh = true;
        } else {
          if (key === undefined) return;
          this.stale.delete(key);
          const old = this.fields.get(key);
          this.job = this.#begin(old.gx, old.gz, old.radius, this.jobHeap);
          this.job.key = key;
          this.job.hard = old.version !== this.version;
        }
      }
      const allow = this.job.hard ? budget : Math.min(budget, soft);
      const left = this.#advance(this.job, allow);
      if (left < 0) return; // out of budget: resume next call
      budget -= allow - left; soft -= allow - left;
      const job = this.job, cur = this.fields.get(job.key);
      this.job = null;
      // Install unless field() re-solved this key for a moved goal in the meantime. Walkability
      // that changed mid-search leaves the result older than `version`: it is simply queued again.
      if (job.fresh || (cur && cur.gx === job.gx && cur.gz === job.gz)) {
        const f = this.#finish(job, job.key);
        f.used = cur?.used ?? this.clock;
        this.fields.set(job.key, f);
        if (job.fresh) this.#evict();
      }
      if (budget <= 0) return;
    }
  }

  /** Big maps keep at most MAX_FIELDS fields: the one unused longest goes (it comes back on demand). */
  #evict() {
    if (!this.big || this.fields.size <= MAX_FIELDS) return;
    let oldest = null, ou = Infinity;
    for (const [k, f] of this.fields) if ((f.used ?? 0) < ou && this.clock - (f.used ?? 0) > IDLE) { ou = f.used ?? 0; oldest = k; }
    if (oldest !== null) { this.fields.delete(oldest); this.stale.delete(oldest); }
  }

  /** Starts a Dijkstra from the goal disc: seeds the goal cells, nothing expanded yet. */
  #begin(gx, gz, radius, heap) {
    const n = this.nx * this.nz, nx = this.nx, nz = this.nz, cost = this.cost;
    const dist = new Float32Array(n).fill(Infinity);
    const dir = new Int8Array(n).fill(-1);
    heap.size = 0;
    const c = this.cell, r = Math.max(radius, c * 0.75);
    const x0 = Math.max(0, Math.floor((gx - r - this.minX) / c)), x1 = Math.min(nx - 1, Math.floor((gx + r - this.minX) / c));
    const z0 = Math.max(0, Math.floor((gz - r - this.minZ) / c)), z1 = Math.min(nz - 1, Math.floor((gz + r - this.minZ) / c));
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      const i = iz * nx + ix;
      if (cost[i] === Infinity) continue;
      if (Math.hypot(this.minX + (ix + 0.5) * c - gx, this.minZ + (iz + 0.5) * c - gz) > r) continue;
      dist[i] = 0; heap.push(i, 0);
    }
    return { gx, gz, radius, dist, dir, heap, version: this.version, soft: this.soft, key: null };
  }

  /** Expands up to `budget` cells: returns the unused budget when the search completes, -1 if it ran out first. */
  #advance(job, budget) {
    const nx = this.nx, nz = this.nz, cost = this.cost, { dist, dir, heap } = job;
    while (heap.size) {
      if (budget-- <= 0) return -1;
      const i = heap.pop(), di = dist[i];
      if (heap.lastKey > di) continue; // stale entry
      const ix = i % nx, iz = (i - ix) / nx;
      for (let k = 0; k < 8; k++) {
        const jx = ix + DX[k], jz = iz + DZ[k];
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
        const j = jz * nx + jx;
        if (cost[j] === Infinity) continue;
        // No diagonal corner cutting past blocked (or costlier) cells.
        if (k >= 4) { const top = Math.max(cost[i], cost[j]); if (cost[iz * nx + jx] > top || cost[jz * nx + ix] > top) continue; }
        const nd = di + LEN[k] * 0.5 * (cost[i] + cost[j]);
        if (nd < dist[j]) { dist[j] = nd; dir[j] = k ^ 1 ^ (k >= 4 ? 2 : 0); heap.push(j, nd); }
      }
    }
    return Math.max(0, budget);
  }

  // dir[j] stores the neighbour index pointing back toward i (the step toward the goal).
  #finish(job, key) {
    return { dist: job.dist, dir: job.dir, version: job.version, soft: job.soft, key, gx: job.gx, gz: job.gz, radius: job.radius };
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
    if (len < 1e-6) return false;
    out.set(sx / len, 0, sz / len);
    return true;
  }

  /** Route length (m) from a position to the field's goal, or Infinity (blocked cells use the best neighbour). */
  distance(f, x, z) {
    const i = this.index(x, z);
    if (i < 0) return Infinity;
    if (this.cost[i] !== Infinity) return f.dist[i] * this.cell;
    let best = Infinity;
    const ix = i % this.nx, iz = (i - ix) / this.nx;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= this.nx || jz >= this.nz) continue;
      best = Math.min(best, f.dist[jz * this.nx + jx] + Math.hypot(dx, dz));
    }
    return best * this.cell;
  }

  /**
   * A* route between two points, for squad moves (cover to cover, a doorway, a formation slot):
   * world-space waypoints, string-pulled so soldiers walk straight across open ground and only
   * turn at corners. The search gives up after `maxExpand` cells and returns the route to the
   * reachable cell nearest the goal (`reached: false`: walk on and ask again). Shortcuts never
   * take a costlier cell (wire, a parapet) than the route itself crossed there.
   * @returns {{ pts: number[], reached: boolean } | null}  pts = [x0, z0, x1, z1, ...] (start excluded)
   */
  path(sx, sz, gx, gz, { maxExpand = 3000 } = {}) {
    const nx = this.nx, nz = this.nz, cost = this.cost;
    if (!this.astar) {
      const n = nx * nz;
      this.astar = { g: new Float32Array(n), from: new Int32Array(n), seen: new Uint32Array(n), closed: new Uint32Array(n), gen: 0, heap: new MinHeap(8192) };
    }
    const A = this.astar, heap = A.heap;
    const gen = ++A.gen;
    const s = this.#nearestOpen(this.index(sx, sz)), goal = this.#nearestOpen(this.index(gx, gz));
    if (s < 0 || goal < 0) return null;
    const gix = goal % nx, giz = (goal - gix) / nx;
    const h = (i) => { const ix = i % nx, iz = (i - ix) / nx, dx = Math.abs(ix - gix), dz = Math.abs(iz - giz); return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz); };
    heap.size = 0;
    A.g[s] = 0; A.from[s] = -1; A.seen[s] = gen;
    heap.push(s, h(s));
    let best = s, bestH = h(s), expanded = 0, reached = false;
    while (heap.size) {
      const i = heap.pop();
      if (A.closed[i] === gen) continue;
      A.closed[i] = gen;
      if (i === goal) { best = i; reached = true; break; }
      const hi = h(i);
      if (hi < bestH) { bestH = hi; best = i; }
      if (++expanded > maxExpand) break;
      const ix = i % nx, iz = (i - ix) / nx, gi = A.g[i];
      for (let k = 0; k < 8; k++) {
        const jx = ix + DX[k], jz = iz + DZ[k];
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
        const j = jz * nx + jx;
        if (cost[j] === Infinity || A.closed[j] === gen) continue;
        // Diagonals never cut a corner past a costlier cell (a parapet's end, a wall's corner).
        if (k >= 4) { const top = Math.max(cost[i], cost[j]); if (cost[iz * nx + jx] > top || cost[jz * nx + ix] > top) continue; }
        const ng = gi + LEN[k] * 0.5 * (cost[i] + cost[j]);
        if (A.seen[j] !== gen || ng < A.g[j]) { A.seen[j] = gen; A.g[j] = ng; A.from[j] = i; heap.push(j, ng + h(j)); }
      }
    }
    const cells = [];
    for (let i = best; i >= 0 && cells.length < 4096; i = A.from[i]) cells.push(i);
    cells.reverse();
    // String-pull: keep a waypoint only where the straight line from the last one stops being clear.
    const pts = [], c = this.cell, cx = (i) => this.minX + ((i % nx) + 0.5) * c, cz = (i) => this.minZ + (Math.floor(i / nx) + 0.5) * c;
    let ax = sx, az = sz, run = cost[cells[0]], anchor = 0;
    for (let k = 1; k < cells.length; k++) {
      const door = this.portal[cells[k]];
      if (door && this.portal[cells[k - 1]] !== door) {
        // Into a doorway: straight to the threshold, through the door's centre, out the far side.
        const d = this.portals[door - 1], side = Math.sign((d.x - ax) * d.nx + (d.z - az) * d.nz) || 1;
        if (k - 1 > anchor) pts.push(cx(cells[k - 1]), cz(cells[k - 1]));
        pts.push(d.x - d.nx * side * 0.8, d.z - d.nz * side * 0.8, d.x + d.nx * side * 0.8, d.z + d.nz * side * 0.8);
        ax = d.x + d.nx * side * 0.8; az = d.z + d.nz * side * 0.8;
        while (k + 1 < cells.length && this.portal[cells[k + 1]] === door) k++;
        anchor = k; run = cost[cells[k]];
        continue;
      }
      run = Math.max(run, cost[cells[k]]);
      if (k - anchor < 40 && this.lineClear(ax, az, cx(cells[k]), cz(cells[k]), run)) continue;
      const w = cells[k - 1];
      ax = cx(w); az = cz(w); pts.push(ax, az);
      anchor = k - 1; run = Math.max(cost[w], cost[cells[k]]);
    }
    if (reached) pts.push(gx, gz); else if (cells.length > 1) pts.push(cx(best), cz(best));
    return { pts, reached };
  }

  /** Is the straight segment walkable through cells no costlier than `maxCost`? (grid DDA) */
  lineClear(x0, z0, x1, z1, maxCost = 1) {
    const c = this.cell, nx = this.nx, nz = this.nz;
    let ix = Math.floor((x0 - this.minX) / c), iz = Math.floor((z0 - this.minZ) / c);
    const ex = Math.floor((x1 - this.minX) / c), ez = Math.floor((z1 - this.minZ) / c);
    const dx = x1 - x0, dz = z1 - z0;
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(c / dx) : Infinity, tdz = dz !== 0 ? Math.abs(c / dz) : Infinity;
    let tx = dx !== 0 ? ((sx > 0 ? this.minX + (ix + 1) * c - x0 : x0 - (this.minX + ix * c)) / Math.abs(dx)) : Infinity;
    let tz = dz !== 0 ? ((sz > 0 ? this.minZ + (iz + 1) * c - z0 : z0 - (this.minZ + iz * c)) / Math.abs(dz)) : Infinity;
    for (let guard = 0; guard < 4096; guard++) {
      if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return false;
      const k = this.cost[iz * nx + ix];
      if (k === Infinity || k > maxCost) return false;
      if ((ix === ex && iz === ez) || Math.min(tx, tz) > 1) return true;   // reached the end cell (or passed the end on a cell corner)
      if (tx < tz) { tx += tdx; ix += sx; } else { tz += tdz; iz += sz; }
    }
    return false;
  }

  #nearestOpen(i) {
    if (i < 0) return -1;
    if (this.cost[i] !== Infinity) return i;
    const ix = i % this.nx, iz = (i - ix) / this.nx;
    let best = -1, bd = Infinity;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= this.nx || jz >= this.nz) continue;
      const j = jz * this.nx + jx, d = dx * dx + dz * dz;
      if (this.cost[j] !== Infinity && d < bd) { bd = d; best = j; }
    }
    return best;
  }

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
