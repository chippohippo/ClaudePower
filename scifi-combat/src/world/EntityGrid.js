// EntityGrid: a uniform XZ hash of fighters, rebuilt once per sim tick (cheap: one push per
// fighter, cell arrays reused). It turns the "every fighter against every query" loops (splash,
// zones, AI perception, bullets) into "fighters in the touched cells" for 64-128 player battles.

const KEY = (ix, iz) => (ix + 32768) * 65536 + (iz + 32768);

export class EntityGrid {
  constructor({ cell = 12 } = {}) {
    this.cell = cell;
    this.cells = new Map();
    this.used = [];        // cells touched by the last rebuild (cleared on the next one)
    this.count = 0;
  }

  /** @param {Iterable} list  entities with movement.state.position (or posOf) */
  rebuild(list, posOf = (e) => e.movement.state.position) {
    for (const c of this.used) c.length = 0;
    this.used.length = 0;
    this.count = 0;
    const c = this.cell;
    for (const e of list) {
      const p = posOf(e);
      const k = KEY(Math.floor(p.x / c), Math.floor(p.z / c));
      let cell = this.cells.get(k);
      if (!cell) this.cells.set(k, (cell = []));
      if (cell.length === 0) this.used.push(cell);
      cell.push(e);
      this.count++;
    }
  }

  /** cb(e) for every entity whose cell overlaps the circle (callers do the exact distance test). */
  queryCircle(x, z, r, cb) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c), z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const cell = this.cells.get(KEY(ix, iz));
      if (cell) for (let i = 0; i < cell.length; i++) cb(cell[i]);
    }
  }

  /**
   * Walks the cells along a ray (d normalized, XZ DDA) widened by `pad` metres on each side,
   * calling cb(e) for every entity in them once. Used to pre-filter hitscan targets.
   */
  queryRay(o, d, max, pad, cb) {
    const c = this.cell, seen = this._seen ??= new Set();
    seen.clear();
    const visit = (ix, iz) => {
      const cell = this.cells.get(KEY(ix, iz));
      if (cell) for (const e of cell) if (!seen.has(e)) { seen.add(e); cb(e); }
    };
    const hx = Math.abs(d.x), hz = Math.abs(d.z);
    if (hx < 1e-6 && hz < 1e-6) { this.queryCircle(o.x, o.z, pad, (e) => { if (!seen.has(e)) { seen.add(e); cb(e); } }); return; }
    // Sample along the ray every half cell and visit the 3x3 neighbourhood: cheap and exact
    // enough for pads smaller than a cell.
    const step = c * 0.5, n = Math.ceil(Math.min(max, 2000) / step) + 1;
    let lastK = null;
    for (let i = 0; i <= n; i++) {
      const t = Math.min(max, i * step);
      const ix = Math.floor((o.x + d.x * t) / c), iz = Math.floor((o.z + d.z * t) / c);
      const k = KEY(ix, iz);
      if (k === lastK) continue;
      lastK = k;
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) visit(ix + ox, iz + oz);
      if (t >= max) break;
    }
  }
}
