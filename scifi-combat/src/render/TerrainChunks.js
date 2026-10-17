// TerrainChunks: the 1 m heightfield drawn as 128 m chunks with distance LOD, so a 1.4 km map
// costs ~150k triangles and trench floors and craters are still drawn at full detail where you are.
//  * LOD by distance from the camera to the chunk: every sample near, every 2nd mid, every 8th
//    far (data: `lods`). Each chunk keeps only its current geometry; at most `budget` chunks
//    rebuild per frame (a teleport never hitches), with hysteresis so borders don't flicker.
//  * Skirts: every chunk edge drops a strip `skirt` metres down, hiding cracks between LODs.
//  * Vertex colors from a ground palette (palette.json): dust on the flats, earth on slopes, rock
//    on the steep, mud wherever the ground was dug (trench floors, craters, foxholes:
//    terrain.dug), and black scorch and grey ash where `scorch(x, z)` says shells burned it.
//  * invalidate(region): runtime digging (fortification) rebuilds just the chunks it touches.

import * as THREE from 'three';

const DEFAULT_GROUND = { dust: '#4a5a3a', earth: '#6b5a44', rock: '#6d6f73', mud: '#3f3326', scorch: '#2b231e', ash: '#6f6862' };

export class TerrainChunks {
  /**
   * @param {THREE.Scene} scene
   * @param {Terrain} terrain
   * @param {object} o { material, chunk (m), lods: [{ step, dist }], skirt, budget, colorScale, ground: palette colors, scorch: (x, z) -> 0..1,
   *   paint: (x, z) -> a ground palette key the ground there is instead (a city's asphalt, its park's grass) }
   */
  constructor(scene, terrain, { material, chunk = 128, lods = [{ step: 1, dist: 140 }, { step: 2, dist: 340 }, { step: 8, dist: Infinity }], skirt = 2, budget = 2, colorScale = 1, ground = DEFAULT_GROUND, scorch = null, paint = null } = {}) {
    this.t = terrain; this.material = material; this.lods = lods; this.skirt = skirt; this.budget = budget; this.colorScale = colorScale;
    this.pal = Object.fromEntries(Object.entries({ ...DEFAULT_GROUND, ...ground }).map(([k, v]) => [k, new THREE.Color(v)]));
    this.scorch = scorch;
    this.paint = paint;
    this.size = chunk;
    const per = Math.round(chunk / terrain.res);
    this.per = per;
    this.cx = Math.ceil((terrain.nx - 1) / per); this.cz = Math.ceil((terrain.nz - 1) / per);
    this.group = new THREE.Group();
    scene.add(this.group);
    this.chunks = [];
    for (let j = 0; j < this.cz; j++) for (let i = 0; i < this.cx; i++) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
      mesh.receiveShadow = true;
      mesh.visible = false;
      this.group.add(mesh);
      const x0 = terrain.minX + i * chunk, z0 = terrain.minZ + j * chunk;
      this.chunks.push({ i, j, x0, z0, x1: Math.min(terrain.minX + terrain.width, x0 + chunk), z1: Math.min(terrain.minZ + terrain.depth, z0 + chunk), mesh, lod: -1, want: -1, dirty: true });
    }
    this.triangles = 0;
  }

  /** Pick LODs for the camera and rebuild up to `budget` chunks (everything, the first time). */
  update(camPos, { all = false } = {}) {
    const queue = [];
    for (const c of this.chunks) {
      const dx = Math.max(c.x0 - camPos.x, 0, camPos.x - c.x1), dz = Math.max(c.z0 - camPos.z, 0, camPos.z - c.z1);
      const d = Math.hypot(dx, dz);
      let lod = this.lods.findIndex((l) => d < l.dist);
      // Hysteresis: only go coarser once 15 m past the threshold.
      if (c.lod >= 0 && lod > c.lod && d < this.lods[c.lod].dist + 15) lod = c.lod;
      c.want = lod;
      if (c.dirty || c.lod !== lod) queue.push(c);
    }
    // Nearest chunks first: the ground under you is never the one waiting.
    queue.sort((a, b) => a.want - b.want);
    const n = all ? queue.length : Math.min(this.budget, queue.length);
    for (let k = 0; k < n; k++) this.#build(queue[k], queue[k].want);
    this.triangles = 0;
    for (const c of this.chunks) this.triangles += c.tris ?? 0;
  }

  /** Ground changed in [minX, minZ, maxX, maxZ]: rebuild those chunks (at their current LOD). */
  invalidate([minX, minZ, maxX, maxZ]) {
    for (const c of this.chunks) if (!(c.x1 < minX - 1 || c.x0 > maxX + 1 || c.z1 < minZ - 1 || c.z0 > maxZ + 1)) c.dirty = true;
  }

  #build(c, lod) {
    const t = this.t, step = this.lods[lod].step, res = t.res;
    const i0 = c.i * this.per, j0 = c.j * this.per;
    const i1 = Math.min(t.nx - 1, i0 + this.per), j1 = Math.min(t.nz - 1, j0 + this.per);
    const xs = [], zs = [];
    for (let i = i0; i < i1; i += step) xs.push(i);
    xs.push(i1);
    for (let j = j0; j < j1; j += step) zs.push(j);
    zs.push(j1);
    const W = xs.length, H = zs.length;
    const nGrid = W * H, nSkirt = 2 * (W + H);
    const pos = new Float32Array((nGrid + nSkirt) * 3), nor = new Float32Array((nGrid + nSkirt) * 3);
    const col = new Float32Array((nGrid + nSkirt) * 3), uv = new Float32Array((nGrid + nSkirt) * 2);
    const n = new THREE.Vector3(), cc = new THREE.Color();
    const put = (k, ix, iz, drop) => {
      const x = t.minX + ix * res, z = t.minZ + iz * res, h = t.h[iz * t.nx + ix];
      pos[k * 3] = x; pos[k * 3 + 1] = h - drop; pos[k * 3 + 2] = z;
      t.normal(x, z, n);
      nor[k * 3] = n.x; nor[k * 3 + 1] = n.y; nor[k * 3 + 2] = n.z;
      const slope = (Math.acos(Math.min(1, n.y)) * 180) / Math.PI, G = this.pal;
      cc.copy(G.dust).lerp(G.earth, Math.min(1, Math.max(0, (slope - 6) / 14))).lerp(G.rock, Math.min(1, Math.max(0, (slope - 24) / 12)));
      // Broad patches: dust drifts in the hollows, earth shows on the rises.
      const patch = Math.sin(x * 0.031 + Math.sin(z * 0.017) * 2.0) * Math.sin(z * 0.027 + Math.sin(x * 0.021) * 1.7);
      cc.lerp(G.earth, Math.max(0, patch) * 0.35);
      // Painted ground (a city's streets, its park): that colour, with the same broad patches.
      const key = this.paint?.(x, z);
      if (key && G[key]) cc.copy(G[key]).multiplyScalar(1 + patch * 0.12);
      const dug = t.dug[iz * t.nx + ix];
      if (dug > 0.05) cc.lerp(G.mud, Math.min(1, dug / 0.45));
      if (this.scorch) {
        const sc = this.scorch(x, z);
        if (sc > 0.01) cc.lerp(G.ash, Math.min(1, sc * 1.6) * 0.5).lerp(G.scorch, Math.min(0.8, Math.max(0, sc - 0.35) * 1.3));
      }
      cc.multiplyScalar((0.9 + Math.sin(x * 0.13) * Math.sin(z * 0.11) * 0.06 + h / 40) * this.colorScale);
      col[k * 3] = cc.r; col[k * 3 + 1] = cc.g; col[k * 3 + 2] = cc.b;
      uv[k * 2] = x / 6; uv[k * 2 + 1] = z / 6;
    };
    for (let b = 0; b < H; b++) for (let a = 0; a < W; a++) put(b * W + a, xs[a], zs[b], 0);
    // Skirt rings: the four edges again, `skirt` lower.
    let k = nGrid;
    const edge = [];
    for (let a = 0; a < W; a++) { put(k, xs[a], zs[0], this.skirt); edge.push([0 * W + a, k++]); }
    const top = edge.length;
    for (let a = 0; a < W; a++) { put(k, xs[a], zs[H - 1], this.skirt); edge.push([(H - 1) * W + a, k++]); }
    const left = edge.length;
    for (let b = 0; b < H; b++) { put(k, xs[0], zs[b], this.skirt); edge.push([b * W, k++]); }
    const right = edge.length;
    for (let b = 0; b < H; b++) { put(k, xs[W - 1], zs[b], this.skirt); edge.push([b * W + W - 1, k++]); }
    const idx = [];
    for (let b = 0; b < H - 1; b++) for (let a = 0; a < W - 1; a++) {
      const p = b * W + a, q = p + 1, r = p + W, s = r + 1;
      idx.push(p, r, q, q, r, s);
    }
    // Skirt quads (both windings: the camera may see either side).
    const strip = (from, to) => { for (let e = from; e < to - 1; e++) { const [g0, s0] = edge[e], [g1, s1] = edge[e + 1]; idx.push(g0, s0, g1, g1, s0, s1, g0, g1, s0, g1, s1, s0); } };
    strip(0, top); strip(top, left); strip(left, right); strip(right, edge.length);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(nGrid + nSkirt > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    c.mesh.geometry.dispose();
    c.mesh.geometry = geo;
    c.mesh.visible = true;
    c.lod = lod; c.dirty = false; c.tris = idx.length / 3;
  }

  dispose() { for (const c of this.chunks) c.mesh.geometry.dispose(); this.group.removeFromParent(); }
}
