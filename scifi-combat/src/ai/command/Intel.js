// Intel: what a team knows about the enemy (one per team: world.intel[team]). The commander's map,
// the artillery's observed fire and the strategist all read it, and nobody on the team knows more.
//
//  * Contacts: every enemy a soldier of ours has in sight is a contact: where and when he was last
//    seen, and who saw him. The bots report what their sight rays find as they pick targets, a
//    scout on watch sweeps a wider circle, and whoever shoots one of ours gives himself away. A
//    contact not seen again goes stale (a last known position) and is forgotten after `memory` s,
//    or when he dies.
//  * Watched ground: the map in 24 m cells, each marked with the last time a soldier of ours was
//    near enough to see it (`sight` m; a scout on watch, his own range). Where we've looked lately
//    and seen nobody, there's nobody; where we haven't, anything could be.
// Simulation (deterministic): updated twice a second.

const CELL = 24;
const EVERY = 0.5;

export class Intel {
  /**
   * @param {number} team
   * @param {object} o { bounds: { minX, maxX, minZ, maxZ } (the map), memory: s a contact is kept, sight: m a soldier watches }
   */
  constructor(team, { bounds, memory = 45, sight = 60 } = {}) {
    this.team = team; this.memory = memory; this.sight = sight;
    this.contacts = new Map();            // enemy id -> { e, x, y, z, t, by, scout }
    this.watchers = new Map();            // scout on watch -> range (m)
    const b = bounds ?? { minX: -500, maxX: 500, minZ: -500, maxZ: 500 };
    this.x0 = b.minX - CELL; this.z0 = b.minZ - CELL;
    this.nx = Math.ceil((b.maxX - b.minX) / CELL) + 3; this.nz = Math.ceil((b.maxZ - b.minZ) / CELL) + 3;
    this.cells = new Float64Array(this.nx * this.nz).fill(-1e9);   // last time each cell was watched
    this.time = 0; this.next = 0;
  }

  /** Enemy e is in sight of one of ours (`by`: who; `scout`: a scout on watch). */
  spot(e, by = null, scout = false) {
    if (!e?.movement || e.health?.dead) return;
    let c = this.contacts.get(e.id);
    if (!c) this.contacts.set(e.id, (c = { e, x: 0, y: 0, z: 0, t: 0, first: this.time, by, scout }));
    const p = e.movement.state.position;
    c.x = p.x; c.y = p.y; c.z = p.z; c.t = this.time; c.by = by; c.scout = scout;
  }

  /** A scout keeps watch out to `range` m (until `unwatch`). */
  watch(e, range) { this.watchers.set(e, range); }
  unwatch(e) { this.watchers.delete(e); }

  /** @param {Iterable} fighters every fighter (ours mark the ground they can see) */
  update(dt, fighters) {
    this.time += dt;
    this.next -= dt;
    if (this.next > 0) return;
    this.next = EVERY;
    for (const [id, c] of this.contacts) if (c.e.health?.dead || c.e.removed || this.time - c.t > this.memory) this.contacts.delete(id);
    for (const f of fighters) {
      if (f.team !== this.team || f.health?.dead || f.offField) continue;
      const p = f.movement.state.position;
      this.#mark(p.x, p.z, this.sight);
    }
    for (const [e, r] of this.watchers) {
      if (e.health?.dead) { this.watchers.delete(e); continue; }
      const p = e.movement.state.position;
      this.#mark(p.x, p.z, r);
    }
  }

  #mark(x, z, r) {
    const i0 = Math.max(0, Math.floor((x - r - this.x0) / CELL)), i1 = Math.min(this.nx - 1, Math.floor((x + r - this.x0) / CELL));
    const j0 = Math.max(0, Math.floor((z - r - this.z0) / CELL)), j1 = Math.min(this.nz - 1, Math.floor((z + r - this.z0) / CELL));
    const r2 = (r + CELL * 0.5) ** 2, t = this.time;
    for (let j = j0; j <= j1; j++) {
      const cz = this.z0 + (j + 0.5) * CELL - z;
      for (let i = i0; i <= i1; i++) {
        const cx = this.x0 + (i + 0.5) * CELL - x;
        if (cx * cx + cz * cz <= r2) this.cells[j * this.nx + i] = t;
      }
    }
  }

  /** When the ground at (x, z) was last watched (-Infinity: never). */
  watched(x, z) {
    const i = Math.floor((x - this.x0) / CELL), j = Math.floor((z - this.z0) / CELL);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -Infinity;
    return this.cells[j * this.nx + i];
  }

  /** How long since the ground within r of (x, z) was all watched (its least recently watched cell): Infinity if never. */
  staleness(x, z, r) {
    let oldest = Infinity;
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) oldest = Math.min(oldest, this.watched(x + dx, z + dz));
    return this.time - oldest;
  }

  /** Contacts within r of (x, z) seen in the last `within` s (cb per contact if given; returns how many). */
  near(x, z, r, within = Infinity, cb = null) {
    let n = 0;
    const r2 = r * r;
    for (const c of this.contacts.values()) {
      if (this.time - c.t > within) continue;
      const dx = c.x - x, dz = c.z - z;
      if (dx * dx + dz * dz > r2) continue;
      n++;
      cb?.(c);
    }
    return n;
  }

  /** Is enemy e in sight right now (seen in the last `within` s)? */
  sees(e, within = 1.5) { const c = this.contacts.get(e.id); return !!c && this.time - c.t <= within; }

  /** Fresh contacts in clusters (cells of `size` m): [{ x, z, n, t }] where at least `min` stand together. */
  clusters(within = 4, size = 18, min = 2, filter = null) {
    const cells = new Map();
    for (const c of this.contacts.values()) {
      if (this.time - c.t > within || (filter && !filter(c))) continue;
      const k = `${Math.floor(c.x / size)},${Math.floor(c.z / size)}`;
      const g = cells.get(k) ?? { x: 0, z: 0, n: 0, t: -1e9 };
      g.x += c.x; g.z += c.z; g.n++; g.t = Math.max(g.t, c.t);
      cells.set(k, g);
    }
    const out = [];
    for (const g of cells.values()) if (g.n >= min) out.push({ x: g.x / g.n, z: g.z / g.n, n: g.n, t: g.t });
    return out;
  }
}
