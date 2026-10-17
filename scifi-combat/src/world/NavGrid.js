// NavGrid: walkability over a big map plus per-goal flow fields, for bot macro navigation.
//
// One Dijkstra from each goal (a capture point, a spawn, a squad rally) gives every cell the
// direction of its cheapest route to that goal, so 400 bots can share one field per objective
// instead of running 400 path searches. Fields are cached and kept true as the battlefield changes:
// when cover is built or blown away, each field whose search reached that far repairs itself in
// place (only the cells whose routes ran through the change are solved again), sliced across ticks
// by a work budget. Locally, bots still steer, take cover and fight; the field only answers "which
// way is the objective from here, around the walls".
//
// Cells: steep terrain (> maxSlope) and cover taller than vaultHeight are blocked; vaultable
// cover is passable at extra cost (bots vault it with the hold-to-climb input), and cost zones
// (barbed wire) are passable but expensive, so routes go through the gaps.
//
// Big maps (64v64 and up): fields are built in the background (want()), reach REACH metres of
// route around their goal (beyond that, callers use A* or a straight line), and the ones nobody
// has asked for in a while are evicted.

import { Vector3 } from 'three';

const IDLE = 600;            // maintain() calls (~10 s) after which an unused field stops being repaired (until it's asked for again)
const SOFT = 0.3;            // share of maintain()'s budget for repairs that only shorten routes
const BIG = 150000;          // cells: past this a map is big (see above)
const REACH = 900;           // m of route a big map's field covers around its goal
const MAX_FIELDS = 24;       // fields a big map keeps
const MAX_CHANGES = 8000;    // changed cells a field collects before rebuilding it is cheaper than repairing it
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
const LEN = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
const OPP = [1, 0, 3, 2, 7, 6, 5, 4];          // the step back
const KOF = [7, 3, 5, 1, -1, 0, 6, 2, 4];      // the step for (dx, dz): KOF[(dz + 1) * 3 + dx + 1]
const CORNERS = [[0, 2], [0, 3], [1, 2], [1, 3]];   // pairs of orthogonal steps: a cell is the corner of the diagonal between them

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
    this.fields = new Map();
    this.stale = new Set();                           // keys of fields with changes to repair
    this.job = null;                                  // the build or repair maintain() is part-way through
    this.clock = 0;                                   // maintain() calls: fields remember when they were last asked for
    this.pending = new Map();                         // big maps: fields asked for with want(), built in maintain()
    this.syncHeap = new MinHeap(this.nx * this.nz);   // shared search heaps: no 1.6 MB of garbage per solve
    this.jobHeap = new MinHeap(this.nx * this.nz);
    this.queue = null;                                // a repair's cut-off cells, and their stamps (made on the first repair)
    this.mark = null; this.gen = 0;
    this.pool = [];                                   // big maps: the arrays of evicted fields, for the next build
    this.stats = { builds: 0, repairs: 0, cells: 0 };
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
   * Recompute walkability in a world rectangle (cover destroyed or added, ground dug) and queue
   * repairs for the fields that care: the ones whose search reached this far, and only for the
   * cells that changed (a crater on open ground costs nothing). Cells that got dearer or blocked
   * (an old route may lead into them) are repaired first, on the full budget; cells that only got
   * cheaper (a shell blew a gap in a parapet, wire was cut) leave every old route walkable, just
   * not the shortest, so they are repaired on a share of it (SOFT).
   */
  updateRegion(minX, minZ, maxX, maxZ) {
    const c = this.cell, nx = this.nx;
    const x0 = Math.max(0, Math.floor((minX - this.minX) / c) - 1), z0 = Math.max(0, Math.floor((minZ - this.minZ) / c) - 1);
    const x1 = Math.min(this.nx - 1, Math.floor((maxX - this.minX) / c) + 1), z1 = Math.min(this.nz - 1, Math.floor((maxZ - this.minZ) / c) + 1);
    if (x0 > x1 || z0 > z1) return;   // off the map
    const w = x1 - x0 + 1, before = new Float32Array(w * (z1 - z0 + 1));
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) before[(iz - z0) * w + ix - x0] = this.cost[iz * nx + ix];
    this.#rebuild(x0, z0, x1, z1);
    let worse = null, better = null;
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      const i = iz * nx + ix, was = before[(iz - z0) * w + ix - x0], now = this.cost[i];
      if (now > was) (worse ??= []).push(i);
      else if (now < was) (better ??= []).push(i);
    }
    if (!worse && !better) return;
    const hits = (b) => b[0] <= x1 && b[2] >= x0 && b[1] <= z1 && b[3] >= z0;
    let any = false;
    for (const [key, f] of this.fields) if (hits(f.box)) { this.#note(f, worse, better); this.stale.add(key); any = true; }
    // A build in progress read some of these cells before they changed: its field is repaired once installed.
    const job = this.job;
    if (job && !job.repair && hits(job.box)) this.#note(job, worse, better);
    if (job && worse && any && !job.hard) job.hard = true;   // a slow repair in progress finishes quickly: this one can't wait
  }

  /** Queue changed cells for a field's next repair (or a rebuild, past MAX_CHANGES). */
  #note(f, worse, better) {
    if (f.rebuild) return;
    if (worse) for (const i of worse) f.worse.push(i);
    if (better) for (const i of better) f.better.push(i);
    if (f.worse.length + f.better.length > MAX_CHANGES) { f.rebuild = true; f.worse.length = 0; f.better.length = 0; }
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
   * @param {object} o  { reach: metres of route the field covers (default: all of a small map,
   *                      REACH on a big one), from: {x, z} — or only the trip from there (a box
   *                      around both ends, with room to go around what's in between) }
   */
  want(key, gx, gz, radius = 4, o = {}) {
    if (!this.big) return this.field(key, gx, gz, radius, o);
    const f = this.fields.get(key);
    if (f && f.gx === gx && f.gz === gz) return this.#use(key, f);
    if (!this.pending.has(key) && this.job?.key !== key) this.pending.set(key, { gx, gz, radius, reach: o.reach ?? REACH, from: o.from ? { x: o.from.x, z: o.from.z } : null });
    return null;
  }

  /**
   * Flow field toward a goal disc, cached by key. A new key is solved at once; a cached field
   * keeps serving while the changes around it are repaired in maintain().
   * @returns {{ dist: Float32Array, dir: Int8Array, key, gx, gz, radius, reach, box }}
   */
  field(key, gx, gz, radius = 4, o = {}) {
    let f = this.fields.get(key);
    if (f && f.gx === gx && f.gz === gz) return this.#use(key, f);
    const job = this.#begin(gx, gz, radius, o.reach ?? (this.big ? REACH : Infinity), o.from ? { x: o.from.x, z: o.from.z } : null, this.syncHeap);
    this.#advance(job, Infinity);
    f = this.#finish(job, key);
    f.used = this.clock;
    this.fields.set(key, f);
    return f;
  }

  #use(key, f) {
    // An idle field fell out of the repair queue: asked for again, it goes back in.
    if (f.used !== this.clock && (f.rebuild || f.worse.length || f.better.length)) this.stale.add(key);
    f.used = this.clock;
    return f;
  }

  /**
   * Repairs and builds fields in slices (call every tick): at most `cells` search nodes per call,
   * resuming on the next one. A field keeps serving meanwhile (the cells being re-solved send
   * their callers to A* for a moment). The budget counts work, not wall-clock time, so the sim
   * stays deterministic (server, clients and replays agree on the tick a route changes). 4000
   * cells is ~0.8 ms; a full 1 km field (100k cells) is built in a few dozen ticks instead of one
   * ~20 ms hitch, and the usual repair (a parapet blown open, sandbags stacked) takes one tick.
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
          if (!f || !(f.rebuild || f.worse.length || f.better.length) || this.clock - (f.used ?? -1) > IDLE) { this.stale.delete(k); continue; }
          const pri = (f.rebuild || f.worse.length ? 1e12 : 0) + (f.used ?? 0);
          if (pri > best) { best = pri; key = k; }
        }
        if (best < 1e12 && this.pending.size) {
          // A field someone asked for (want()) comes before routes that only got better.
          const [k, g] = this.pending.entries().next().value;
          this.pending.delete(k);
          this.job = this.#begin(g.gx, g.gz, g.radius, g.reach, g.from, this.jobHeap);
          this.job.key = k; this.job.hard = true; this.job.fresh = true;
        } else {
          if (key === undefined) return;
          this.stale.delete(key);
          const f = this.fields.get(key);
          if (f.rebuild) { this.job = this.#begin(f.gx, f.gz, f.radius, f.reach, f.from, this.jobHeap); this.job.key = key; this.job.hard = true; }
          else this.job = this.#repairJob(key, f);
        }
      }
      const job = this.job, allow = job.hard ? budget : Math.min(budget, soft);
      const left = job.repair ? this.#repair(job, allow) : this.#advance(job, allow);
      if (left < 0) { this.stats.cells += allow; return; } // out of budget: resume next call
      this.stats.cells += allow - left;
      budget -= allow - left; soft -= allow - left;
      this.job = null;
      if (!job.repair) {
        // Install unless field() re-solved this key for a moved goal in the meantime. Cells that
        // changed while it was being built come with it, to be repaired next.
        const cur = this.fields.get(job.key);
        if (job.fresh || (cur && cur.gx === job.gx && cur.gz === job.gz)) {
          const f = this.#finish(job, job.key);
          f.used = cur?.used ?? this.clock;
          this.fields.set(job.key, f);
          if (cur && this.big) this.#recycle(cur);
          if (f.rebuild || f.worse.length || f.better.length) this.stale.add(job.key);
          if (job.fresh) this.#evict();
        }
      }
      if (budget <= 0) return;
    }
  }

  /** Big maps keep at most MAX_FIELDS fields: the one unused longest goes (it comes back on demand). */
  #evict() {
    if (!this.big || this.fields.size <= MAX_FIELDS) return;
    let oldest = null, ou = Infinity;
    for (const [k, f] of this.fields) if ((f.used ?? 0) < ou && this.clock - (f.used ?? 0) > IDLE) { ou = f.used ?? 0; oldest = k; }
    if (oldest === null) return;
    this.#recycle(this.fields.get(oldest));
    this.fields.delete(oldest); this.stale.delete(oldest);
  }

  /** A big map's field arrays are 3 MB: a dropped field's go to the next build instead of the GC. */
  #recycle(f) { if (this.pool.length < 3) this.pool.push({ dist: f.dist, dir: f.dir }); }

  /** Starts a Dijkstra from the goal disc: seeds the goal cells, nothing expanded yet. */
  #begin(gx, gz, radius, reach, from, heap) {
    const n = this.nx * this.nz, nx = this.nx, nz = this.nz, cost = this.cost;
    const a = this.pool.pop();
    const dist = a ? a.dist.fill(Infinity) : new Float32Array(n).fill(Infinity);
    const dir = a ? a.dir.fill(-1) : new Int8Array(n).fill(-1);
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
    // The search stays in `box` (cells), and changes outside it don't concern the field. A trip
    // (`from`): both ends, with a margin to go around what's in between. Otherwise route costs
    // are in cells (x terrain cost) and every step costs at least one: nothing more than `cap`
    // cells from the goal disc is reached.
    let cap = reach / c, box;
    if (from) {
      const m = Math.max(120, 0.3 * Math.hypot(from.x - gx, from.z - gz)) / c;
      const fx = (from.x - this.minX) / c, fz = (from.z - this.minZ) / c;
      box = [Math.max(0, Math.floor(Math.min(x0, fx) - m)), Math.max(0, Math.floor(Math.min(z0, fz) - m)), Math.min(nx - 1, Math.ceil(Math.max(x1, fx) + m)), Math.min(nz - 1, Math.ceil(Math.max(z1, fz) + m))];
      cap = Infinity;
    } else {
      const span = Number.isFinite(cap) ? Math.ceil(cap) + 2 : Infinity;
      box = [Math.max(0, x0 - span), Math.max(0, z0 - span), Math.min(nx - 1, x1 + span), Math.min(nz - 1, z1 + span)];
    }
    this.stats.builds++;
    return { gx, gz, radius, reach, from, cap, box, dist, dir, heap, key: null, worse: [], better: [] };
  }

  /** Expands up to `budget` cells: returns the unused budget when the search completes, -1 if it ran out first. */
  #advance(job, budget) {
    const nx = this.nx, cost = this.cost, { dist, dir, heap, cap } = job, [bx0, bz0, bx1, bz1] = job.box;
    while (heap.size) {
      if (budget-- <= 0) return -1;
      const i = heap.pop(), di = dist[i];
      if (heap.lastKey !== di) continue;              // stale entry (the cell got a better route, or was cut off by a repair)
      if (di > cap) { heap.size = 0; break; }         // the rest is beyond the field's reach
      const ix = i % nx, iz = (i - ix) / nx;
      for (let k = 0; k < 8; k++) {
        const jx = ix + DX[k], jz = iz + DZ[k];
        if (jx < bx0 || jz < bz0 || jx > bx1 || jz > bz1) continue;
        const j = jz * nx + jx;
        if (cost[j] === Infinity) continue;
        // No diagonal corner cutting past blocked (or costlier) cells.
        if (k >= 4) { const top = Math.max(cost[i], cost[j]); if (cost[iz * nx + jx] > top || cost[jz * nx + ix] > top) continue; }
        const nd = di + LEN[k] * 0.5 * (cost[i] + cost[j]);
        if (nd < dist[j]) { dist[j] = nd; dir[j] = OPP[k]; heap.push(j, nd); }
      }
    }
    return Math.max(0, budget);
  }

  // dir[j] stores the neighbour index pointing back toward i (the step toward the goal).
  #finish(job, key) {
    const { dist, dir, gx, gz, radius, reach, from, cap, box, worse, better } = job;
    return { dist, dir, key, gx, gz, radius, reach, from, cap, box, worse, better, rebuild: !!job.rebuild, used: 0 };
  }

  // ---------------------------------------------------------------- repair
  // A field is repaired in place, in four slices of work:
  //  0. every cell that got dearer loses its route (and so does any cell whose route took a
  //     diagonal it now blocks);
  //  1. so does everything routed through them: the subtree of the route tree under those cells
  //     (followed backwards: the neighbours whose step points at a cut cell);
  //  2. each cut cell on the edge of that region takes the best route its neighbours that kept
  //     theirs offer (seeding from other cut cells would start the search from poor guesses);
  //  3. the neighbours of cells that got cheaper offer their routes again (a gap blown in a wall);
  // and a Dijkstra from all of those settles the rest. Cells that kept their routes had the
  // shortest one before and still do (costs elsewhere only went up), so the search stays inside
  // the cut-off region, plus wherever a cheaper cell shortens routes: work in proportion to what
  // changed, where a rebuild would solve the whole field again.

  #repairJob(key, f) {
    const job = { repair: true, key, f, dist: f.dist, dir: f.dir, heap: this.jobHeap, cap: f.cap, box: f.box, worse: f.worse, better: f.better, hard: f.worse.length > 0, phase: 0, k: 0, qh: 0, qt: 0, gen: ++this.gen };
    f.worse = []; f.better = [];
    this.jobHeap.size = 0;
    this.queue ??= new Int32Array(this.nx * this.nz);
    this.mark ??= new Uint32Array(this.nx * this.nz);
    this.stats.repairs++;
    return job;
  }

  #repair(job, budget) {
    if (this.fields.get(job.key) !== job.f) return budget;   // replaced meanwhile (its goal moved)
    const nx = this.nx, nz = this.nz, cost = this.cost, { dist, dir, heap, f, gen } = job, Q = this.queue, M = this.mark;
    const cut = (j) => { if (dir[j] >= 0 || dist[j] !== Infinity) { dist[j] = Infinity; dir[j] = -1; M[j] = gen; Q[job.qt++] = j; } };
    if (job.phase === 0) {
      for (; job.k < job.worse.length; job.k++) {
        if (budget-- <= 0) return -1;
        const c = job.worse[job.k], cx = c % nx, cz = (c - cx) / nx;
        if (dist[c] === 0 && cost[c] !== Infinity) {
          // A goal cell that got dearer stays a goal; the routes that leave it cost more now.
          for (let k = 0; k < 8; k++) {
            const jx = cx + DX[k], jz = cz + DZ[k];
            if (jx >= 0 && jz >= 0 && jx < nx && jz < nz && dir[jz * nx + jx] === OPP[k]) cut(jz * nx + jx);
          }
          heap.push(c, 0);
        } else if (dist[c] !== Infinity) cut(c);
        // Diagonals between its neighbours that it now blocks (no corner cutting past dearer cells).
        for (const [p, q] of CORNERS) {
          const ax = cx + DX[p], az = cz + DZ[p], bx = cx + DX[q], bz = cz + DZ[q];
          if (ax < 0 || az < 0 || ax >= nx || az >= nz || bx < 0 || bz < 0 || bx >= nx || bz >= nz) continue;
          const a = az * nx + ax, b = bz * nx + bx;
          if (cost[c] <= Math.max(cost[a], cost[b])) continue;
          if (dir[a] === KOF[(bz - az + 1) * 3 + bx - ax + 1]) cut(a);
          if (dir[b] === KOF[(az - bz + 1) * 3 + ax - bx + 1]) cut(b);
        }
      }
      job.phase = 1;
    }
    if (job.phase === 1) {
      while (job.qh < job.qt) {
        if (budget-- <= 0) return -1;
        const u = Q[job.qh++], ux = u % nx, uz = (u - ux) / nx;
        for (let k = 0; k < 8; k++) {
          const jx = ux + DX[k], jz = uz + DZ[k];
          if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
          const j = jz * nx + jx;
          if (dir[j] === OPP[k]) { dist[j] = Infinity; dir[j] = -1; M[j] = gen; Q[job.qt++] = j; }
        }
      }
      job.phase = 2; job.k = 0;
    }
    if (job.phase === 2) {
      for (; job.k < job.qt; job.k++) {
        if (budget-- <= 0) return -1;
        const u = Q[job.k];
        if (cost[u] === Infinity || dist[u] === 0) continue;
        const ux = u % nx, uz = (u - ux) / nx;
        let best = Infinity, bk = -1;
        for (let k = 0; k < 8; k++) {
          const jx = ux + DX[k], jz = uz + DZ[k];
          if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
          const j = jz * nx + jx;
          if (M[j] === gen || dist[j] === Infinity || cost[j] === Infinity) continue;   // only from cells that kept their routes
          if (k >= 4) { const top = Math.max(cost[u], cost[j]); if (cost[uz * nx + jx] > top || cost[jz * nx + ux] > top) continue; }
          const nd = dist[j] + LEN[k] * 0.5 * (cost[u] + cost[j]);
          if (nd < best) { best = nd; bk = k; }
        }
        if (bk >= 0 && best < dist[u]) { dist[u] = best; dir[u] = bk; heap.push(u, best); }
      }
      job.phase = 3; job.k = 0;
    }
    if (job.phase === 3) {
      const c = this.cell, r = Math.max(f.radius, c * 0.75);
      for (; job.k < job.better.length; job.k++) {
        if (budget-- <= 0) return -1;
        const b = job.better[job.k], bx = b % nx, bz = (b - bx) / nx;
        if (cost[b] === Infinity) continue;
        // A goal cell that opened up (or got cheaper) is a goal again.
        if (Math.hypot(this.minX + (bx + 0.5) * c - f.gx, this.minZ + (bz + 0.5) * c - f.gz) <= r) { dist[b] = 0; dir[b] = -1; }
        if (dist[b] !== Infinity) heap.push(b, dist[b]);
        for (let k = 0; k < 8; k++) {
          const jx = bx + DX[k], jz = bz + DZ[k];
          if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
          const j = jz * nx + jx;
          if (dist[j] !== Infinity) heap.push(j, dist[j]);
        }
      }
      job.phase = 4;
    }
    return this.#advance(job, budget);
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
