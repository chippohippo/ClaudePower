// WireField: barbed-wire belts (WW1). Wire doesn't stop bullets or sight, but soldiers in it are
// slowed to `slow` and can't sprint (MovementController's sprint needs full speed), and bots route
// through the gaps (NavGrid cost zones). Blasts cut it: cut() removes the belts a blast reaches.
// A coarse grid makes slowAt() O(1) for 128 soldiers every tick.

export class WireField {
  /** @param {{ min: { x, z }, max: { x, z } }[]} belts  @param {object} o { slow, cell } */
  constructor(belts = [], { slow = 0.45, cell = 8 } = {}) {
    this.belts = belts.map((b, i) => ({ ...b, id: i, cut: false }));
    this.slow = slow; this.cell = cell;
    this.grid = new Map();
    for (const b of this.belts) this.#each(b, (k) => { let a = this.grid.get(k); if (!a) this.grid.set(k, (a = [])); a.push(b); });
  }

  #each(b, fn) {
    const c = this.cell;
    for (let ix = Math.floor(b.min.x / c); ix <= Math.floor(b.max.x / c); ix++) for (let iz = Math.floor(b.min.z / c); iz <= Math.floor(b.max.z / c); iz++) fn(ix * 73856093 ^ iz * 19349663);
  }

  /** Speed multiplier at a ground point (1 outside wire). */
  slowAt(x, z) {
    const list = this.grid.get(Math.floor(x / this.cell) * 73856093 ^ Math.floor(z / this.cell) * 19349663);
    if (list) for (const b of list) if (!b.cut && x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z) return this.slow;
    return 1;
  }

  /** Blasts cut the wire they reach; returns the belts removed. */
  cut(p, r) {
    const out = [];
    for (const b of this.belts) {
      if (b.cut) continue;
      const dx = Math.max(b.min.x - p.x, 0, p.x - b.max.x), dz = Math.max(b.min.z - p.z, 0, p.z - b.max.z);
      if (dx * dx + dz * dz <= r * r) { b.cut = true; out.push(b); }
    }
    return out;
  }
}
