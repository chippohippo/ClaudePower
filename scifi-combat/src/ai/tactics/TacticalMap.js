// TacticalMap: where a soldier should stand in a fight. Static knowledge of a frontline map
// for the squad AI, built once per match (and kept up to date as cover is blown apart or dug):
//
//  * cover spots beside every piece of cover (crates, rocks, walls, ruins, strongpoints,
//    blockhouses): 0.6 m out from a face, with the direction the cover protects from and how
//    tall it is. Half cover (0.9-1.45 m): crouch behind it, stand to fire over it. Full cover:
//    hide behind it; spots near a corner can lean out past it to fire (`peek`).
//  * trench firing positions: half cover toward the parapet they face, and the rear parapet
//    covers their backs (a trench protects both ways).
//  * shell craters: prone cover from every direction.
//  * positions dug during the match (Fortify) add their own spots: the pit, then its sandbags.
//
// Queries go through a uniform grid; spots are reserved per soldier so two never pick the same
// one. Destroyed cover takes its spots with it.

import { bus } from '../../core/EventBus.js';

const OUT = 0.6;         // how far out from a cover face a soldier stands
const MIN_COVER = 0.85;  // lower than this isn't worth hiding behind (except prone in a crater)
const HALF_MAX = 1.45;   // up to here you can fire over it standing (muzzle 1.6 m)

export class TacticalMap {
  /**
   * @param {object} map  generateFrontlineMap() output (cover, terrain, nav, trenches, craters, ruins)
   * @param {object} o    { cell }
   */
  constructor(map, { cell = 16 } = {}) {
    this.map = map; this.cell = cell;
    this.minX = map.bounds.minX; this.minZ = map.bounds.minZ;
    this.nx = Math.ceil((map.bounds.maxX - this.minX) / cell); this.nz = Math.ceil((map.bounds.maxZ - this.minZ) / cell);
    this.grid = Array.from({ length: this.nx * this.nz }, () => []);
    this.byBox = new Map();
    this.count = 0;
    for (const b of map.cover.list ?? map.cover) this.addBox(b);
    for (const T of map.trenches ?? []) for (const p of T.positions) this.#add({ x: p.x, y: p.y, z: p.z, kind: 'trench', nx: -p.facing, nz: 0, h: 1.25, fire: 'over', both: true, trench: T.id });
    for (const c of map.craters ?? []) {
      const y = map.terrain.height(c.x, c.z);
      this.#add({ x: c.x, y, z: c.z, kind: 'crater', nx: 0, nz: 0, h: 0.35, fire: 'prone', all: true, r: c.r });
    }
    // Ruin rooms: per-team clearing state lives here, so squads share it.
    this.rooms = [];
    for (const ruin of map.ruins ?? []) for (const room of ruin.rooms) this.rooms.push({ ruin, room, cleared: [-1e9, -1e9], hot: [-1e9, -1e9] });
    this.off = [
      bus.on('world:coverDestroyed', (e) => this.removeBox(e.cover)),
      bus.on('world:coverAdded', (e) => this.addBox(e.cover)),
    ];
  }

  dispose() { this.off.forEach((f) => f()); }

  #cellOf(x, z) {
    const ix = Math.floor((x - this.minX) / this.cell), iz = Math.floor((z - this.minZ) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return -1;
    return iz * this.nx + ix;
  }

  #add(s) {
    const c = this.#cellOf(s.x, s.z);
    if (c < 0) return null;
    s.holder = 0; s.until = 0; s.alive = true; s.cell = c; s.id = this.count++;
    this.grid[c].push(s);
    return s;
  }

  /** Spots around a cover box (skipping trench sandbags and roofs: trenches bring their own). */
  addBox(b) {
    if (b.kind === 'parapet' || b.kind === 'roof' || this.byBox.has(b)) return;
    const t = this.map.terrain, list = [];
    const faces = [
      [b.min.x, b.min.z, b.min.x, b.max.z, -1, 0], [b.max.x, b.min.z, b.max.x, b.max.z, 1, 0],
      [b.min.x, b.min.z, b.max.x, b.min.z, 0, -1], [b.min.x, b.max.z, b.max.x, b.max.z, 0, 1],
    ];
    for (const [x0, z0, x1, z1, fnx, fnz] of faces) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.5) continue;
      const n = Math.max(1, Math.round(len / 2.5));
      for (let k = 0; k < n; k++) {
        const u = n === 1 ? 0.5 : (0.35 + (k / (n - 1)) * (len - 0.7)) / len;
        const x = x0 + (x1 - x0) * u + fnx * OUT, z = z0 + (z1 - z0) * u + fnz * OUT;
        const y = t ? t.height(x, z) : 0;
        const h = b.max.y - y;
        // (Nothing to hide behind under a piece up in the air: an upper storey's wall over a blown-out ground floor.)
        if (h < MIN_COVER || b.min.y - y > 1 || this.#inside(x, z)) continue;
        const s = { x, y, z, kind: b.kind === 'ruin' ? 'ruin' : 'box', nx: fnx, nz: fnz, h, fire: h <= HALF_MAX ? 'over' : 'hide', box: b };
        // Full cover near a corner: lean out past it to fire.
        if (s.fire === 'hide') {
          const along = u * len, tx = (x1 - x0) / len, tz = (z1 - z0) / len;
          if (along < 1.4) { s.fire = 'around'; s.peek = { x: x - tx * (along + 0.7), z: z - tz * (along + 0.7) }; }
          else if (len - along < 1.4) { s.fire = 'around'; s.peek = { x: x + tx * (len - along + 0.7), z: z + tz * (len - along + 0.7) }; }
        }
        const added = this.#add(s);
        if (added) list.push(added);
      }
    }
    this.byBox.set(b, list);
  }

  /** A dug position (Fortify): prone cover in its pit, crouch cover once it has sandbags. */
  addFort(site) {
    return this.#add({ x: site.x, y: site.y, z: site.z, kind: 'fort', nx: -site.face, nz: 0, h: 0.6, fire: 'prone', all: true, fort: site });
  }

  /** Is a standing soldier at (x, z) inside some cover box (or within 0.3 m of one)? */
  #inside(x, z) {
    let hit = false;
    this.map.cover.queryAABB(x - 0.3, z - 0.3, x + 0.3, z + 0.3, (o) => {
      if (!hit && o.kind !== 'roof' && x > o.min.x - 0.3 && x < o.max.x + 0.3 && z > o.min.z - 0.3 && z < o.max.z + 0.3) hit = true;
    });
    return hit;
  }

  removeBox(b) {
    const list = this.byBox.get(b);
    if (!list) return;
    for (const s of list) { s.alive = false; const g = this.grid[s.cell]; const i = g.indexOf(s); if (i >= 0) g.splice(i, 1); }
    this.byBox.delete(b);
  }

  /** Every live spot within r of (x, z). */
  query(x, z, r, cb) {
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((x - r - this.minX) / c)), x1 = Math.min(this.nx - 1, Math.floor((x + r - this.minX) / c));
    const z0 = Math.max(0, Math.floor((z - r - this.minZ) / c)), z1 = Math.min(this.nz - 1, Math.floor((z + r - this.minZ) / c));
    const r2 = r * r;
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      for (const s of this.grid[iz * this.nx + ix]) { const dx = s.x - x, dz = s.z - z; if (dx * dx + dz * dz <= r2) cb(s); }
    }
  }

  /** Lowest-scoring free spot within r (score(spot) -> number, Infinity to reject). */
  best(x, z, r, score, who, now) {
    let best = null, bs = Infinity;
    this.query(x, z, r, (s) => {
      if (!this.free(s, who, now)) return;
      const v = score(s);
      if (v < bs) { bs = v; best = s; }
    });
    return best;
  }

  free(s, who, now) { return s.alive && (!s.holder || s.holder === who || s.until < now); }

  reserve(s, who, now, hold = 4) {
    if (!s) return;
    s.holder = who; s.until = now + hold;
  }

  /**
   * How well a spot covers a soldier from a threat at (tx, tz): 0 = exposed, 1 = covered while
   * low (crouched behind half cover, prone in a crater), 2 = covered standing (full cover).
   */
  covers(s, tx, tz) {
    const dx = tx - s.x, dz = tz - s.z, d = Math.hypot(dx, dz) || 1;
    if (s.all) return 1;
    if (s.both) return Math.abs(dx) > 0.45 * d ? 1 : 0;
    // The cover lies on the -n side of the spot: it protects from threats beyond it.
    const along = -(dx * s.nx + dz * s.nz) / d;
    if (along < 0.45) return 0;
    return s.h > HALF_MAX ? 2 : 1;
  }

  /** Rooms of ruins within r of (x, z) (sweep-and-clear targets). */
  roomsNear(x, z, r) {
    const out = [];
    for (const R of this.rooms) {
      const { min, max } = R.room;
      const dx = Math.max(min.x - x, 0, x - max.x), dz = Math.max(min.z - z, 0, z - max.z);
      if (dx * dx + dz * dz <= r * r) out.push(R);
    }
    return out;
  }

  /** The room containing a point, if any. */
  roomAt(x, z) {
    for (const R of this.rooms) { const { min, max } = R.room; if (x > min.x && x < max.x && z > min.z && z < max.z) return R; }
    return null;
  }
}
