// Static collision world made of axis-aligned boxes in a uniform 2D spatial hash.
// Used for player movement (sweep + resolve), mantling probes and projectile raycasts.

const CELL = 16;

export class CollisionWorld {
  constructor(half) {
    this.half = half;
    this.boxes = []; // {min:[x,y,z], max:[x,y,z], kind, id}
    this.dims = Math.ceil((half * 2) / CELL) + 2;
    this.cells = new Map();
    this._stamp = 1;
    this._seen = new Uint32Array(0);
    // Dynamic blockers (e.g. dome shields). They block bullets but not movement.
    this.bulletBlockers = [];
    // Jump pads (Jolt ult). Read by the shared movement code so launches are predicted.
    this.pads = [];
    // Zipline cables (static map data) — read by movement for attach/ride.
    this.zips = [];
    // Heightfield terrain (shared/terrain.js); null = flat ground at y = 0.
    this.terrain = null;
  }

  key(cx, cz) {
    return cx * 4096 + cz;
  }

  addBox(min, max, kind = 'solid') {
    const b = { min, max, kind, id: this.boxes.length };
    this.boxes.push(b);
    const c0x = Math.floor((min[0] + this.half) / CELL), c1x = Math.floor((max[0] + this.half) / CELL);
    const c0z = Math.floor((min[2] + this.half) / CELL), c1z = Math.floor((max[2] + this.half) / CELL);
    for (let cx = c0x; cx <= c1x; cx++)
      for (let cz = c0z; cz <= c1z; cz++) {
        const k = this.key(cx, cz);
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(b);
      }
    return b;
  }

  finalize() {
    this._seen = new Uint32Array(this.boxes.length);
  }

  // Collect boxes overlapping XZ rect into out array (deduplicated).
  query(minX, minZ, maxX, maxZ, out) {
    out.length = 0;
    const stamp = ++this._stamp;
    const c0x = Math.floor((minX + this.half) / CELL), c1x = Math.floor((maxX + this.half) / CELL);
    const c0z = Math.floor((minZ + this.half) / CELL), c1z = Math.floor((maxZ + this.half) / CELL);
    for (let cx = c0x; cx <= c1x; cx++)
      for (let cz = c0z; cz <= c1z; cz++) {
        const arr = this.cells.get(this.key(cx, cz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const b = arr[i];
          if (this._seen[b.id] === stamp) continue;
          this._seen[b.id] = stamp;
          out.push(b);
        }
      }
    return out;
  }

  // Ground height (top of highest box below y+0.01) at point; 0 = terrain.
  terrainH(x, z) {
    return this.terrain ? this.terrain.height(x, z) : 0;
  }

  groundAt(x, z, y = 1e9, out = []) {
    this.query(x, z, x, z, out);
    let best = this.terrainH(x, z);
    for (const b of out) {
      if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2]) {
        if (b.max[1] <= y + 0.01 && b.max[1] > best) best = b.max[1];
      }
    }
    return best;
  }

  // Box whose top the point is standing on (within 0.15 m), or null for terrain.
  boxAt(x, y, z, out = []) {
    this.query(x, z, x, z, out);
    let best = null;
    for (const b of out) {
      if (x >= b.min[0] - 0.05 && x <= b.max[0] + 0.05 && z >= b.min[2] - 0.05 && z <= b.max[2] + 0.05 && Math.abs(b.max[1] - y) < 0.15) best = b;
    }
    return best;
  }

  // Does an AABB overlap any solid box?
  overlaps(minX, minY, minZ, maxX, maxY, maxZ, tmp = []) {
    if (minY < this.terrainH((minX + maxX) * 0.5, (minZ + maxZ) * 0.5) - 0.12) return true;
    this.query(minX, minZ, maxX, maxZ, tmp);
    for (const b of tmp) {
      if (maxX > b.min[0] && minX < b.max[0] && maxY > b.min[1] && minY < b.max[1] && maxZ > b.min[2] && minZ < b.max[2])
        return true;
    }
    return false;
  }

  // Ray vs world. Returns {t, nx, ny, nz, box} for nearest hit within maxT or null.
  raycast(ox, oy, oz, dx, dy, dz, maxT, tmp = [], includeBlockers = true) {
    const ex = ox + dx * maxT, ez = oz + dz * maxT;
    this.query(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez), tmp);
    let best = maxT, hit = null;
    // terrain
    if (this.terrain) {
      const t = this.terrain.raycast(ox, oy, oz, dx, dy, dz, best);
      if (t >= 0 && t < best) {
        const n = this.terrain.normal(ox + dx * t, oz + dz * t);
        best = t; hit = { t, nx: n.x, ny: n.y, nz: n.z, box: null, terrain: true };
      }
    } else if (dy < 0) {
      const t = -oy / dy;
      if (t >= 0 && t < best) { best = t; hit = { t, nx: 0, ny: 1, nz: 0, box: null }; }
    }
    for (const b of tmp) {
      const r = rayBox(ox, oy, oz, dx, dy, dz, b.min, b.max, best);
      if (r) { best = r.t; hit = r; r.box = b; }
    }
    if (includeBlockers) {
      for (const s of this.bulletBlockers) {
        if (s.type === 'wall') {
          // oriented energy wall: transform the ray into the wall's frame and slab-test
          const tx = -s.nz, tz = s.nx;
          const rx = ox - s.x, rz = oz - s.z;
          const la = rx * tx + rz * tz, lb = rx * s.nx + rz * s.nz;
          const da = dx * tx + dz * tz, db = dx * s.nx + dz * s.nz;
          const r = rayBox(la, oy, lb, da, dy, db, [-s.hw, s.y, -0.15], [s.hw, s.y + s.h, 0.15], best);
          if (r) { best = r.t; hit = { t: r.t, nx: s.nx, ny: 0, nz: s.nz, box: null, blocker: s }; }
          continue;
        }
        const t = raySphereShell(ox, oy, oz, dx, dy, dz, s.x, s.y, s.z, s.r, best);
        if (t !== null) { best = t; hit = { t, nx: 0, ny: 1, nz: 0, box: null, blocker: s }; }
      }
    }
    return hit;
  }
}

// Slab method. Returns {t, nx, ny, nz} or null.
export function rayBox(ox, oy, oz, dx, dy, dz, min, max, maxT) {
  let tmin = 0, tmax = maxT, nx = 0, ny = 0, nz = 0;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < min[a] || o[a] > max[a]) return null;
    } else {
      const inv = 1 / d[a];
      let t1 = (min[a] - o[a]) * inv, t2 = (max[a] - o[a]) * inv;
      let sign = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; sign = 1; }
      if (t1 > tmin) {
        tmin = t1;
        nx = a === 0 ? sign : 0; ny = a === 1 ? sign : 0; nz = a === 2 ? sign : 0;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  if (tmin <= 0) return null; // started inside
  return { t: tmin, nx, ny, nz };
}

// Ray against a sphere shell (dome): hits whether origin is inside or outside.
export function raySphereShell(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxT) {
  const lx = ox - cx, ly = oy - cy, lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t1 = -b - s, t2 = -b + s;
  // only hemisphere above ground: check hit point y >= cy
  for (const t of c > 0 ? [t1, t2] : [t2]) {
    if (t > 0.001 && t < maxT && oy + dy * t >= cy - 0.2) return t;
  }
  return null;
}

// Ray vs vertical capsule approximated as cylinder segments: returns {t, part} or null.
// Player body: legs [0, 0.45h], body [0.45h, 0.82h], head [0.82h, h]
export function rayPlayer(ox, oy, oz, dx, dy, dz, px, py, pz, height, radius, maxT) {
  // cylinder in XZ
  const lx = ox - px, lz = oz - pz;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return null;
  const b = lx * dx + lz * dz;
  const c = lx * lx + lz * lz - radius * radius;
  const disc = b * b - a * c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  let t = (-b - s) / a;
  const tExit = (-b + s) / a;
  if (t < 0) t = 0;
  if (t > maxT || tExit < 0) return null;
  // find vertical overlap of entry..exit
  for (let i = 0; i <= 6; i++) {
    const tt = t + ((tExit - t) * i) / 6;
    if (tt > maxT) break;
    const y = oy + dy * tt - py;
    if (y >= 0 && y <= height) {
      const r = y / height;
      const part = r > 0.82 ? 'head' : r > 0.45 ? 'body' : 'legs';
      return { t: tt, part };
    }
  }
  return null;
}
