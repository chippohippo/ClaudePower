// ScorchField: where the ground has been burned (render only). A 1 m grid of 0..1 over the map:
// the map's old shell craters start with ash rims, and every shell, rocket and grenade that bursts
// adds a ragged black mark. TerrainChunks reads it into the ground's vertex colors.

const hash = (i, j) => {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export class ScorchField {
  /** @param {object} bounds { minX, minZ, width, depth } */
  constructor({ minX, minZ, width, depth }, cell = 1) {
    this.minX = minX; this.minZ = minZ; this.cell = cell;
    this.nx = Math.ceil(width / cell) + 1; this.nz = Math.ceil(depth / cell) + 1;
    this.v = new Uint8Array(this.nx * this.nz);
  }

  /** 0..1 at a point. */
  at(x, z) {
    const ix = Math.round((x - this.minX) / this.cell), iz = Math.round((z - this.minZ) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return 0;
    return this.v[iz * this.nx + ix] / 255;
  }

  /**
   * Burn a ragged disc: strongest in the middle, fading out with a broken edge (blast streaks).
   * @returns {number[]} the touched rectangle [minX, minZ, maxX, maxZ]
   */
  stamp(x, z, r, strength = 1) {
    const c = this.cell, R = r * 1.35;
    const x0 = Math.max(0, Math.floor((x - R - this.minX) / c)), x1 = Math.min(this.nx - 1, Math.ceil((x + R - this.minX) / c));
    const z0 = Math.max(0, Math.floor((z - R - this.minZ) / c)), z1 = Math.min(this.nz - 1, Math.ceil((z + R - this.minZ) / c));
    const seed = Math.floor(x * 7.3 + z * 3.1);
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      const px = this.minX + ix * c, pz = this.minZ + iz * c, dx = px - x, dz = pz - z;
      const a = Math.atan2(dz, dx), streak = 0.75 + 0.35 * Math.sin(a * 5 + seed) * Math.sin(a * 3 - seed * 0.7);
      const d = Math.hypot(dx, dz) / (r * streak);
      if (d >= 1.35) continue;
      const k = (d < 0.5 ? 1 : Math.max(0, 1 - (d - 0.5) / 0.85)) * (0.8 + 0.2 * hash(ix, iz)) * strength;
      const i = iz * this.nx + ix, nv = Math.min(255, Math.round(Math.max(this.v[i] / 255, k) * 255));
      this.v[i] = nv;
    }
    return [x - R, z - R, x + R, z + R];
  }
}
