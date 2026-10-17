// SandbagTops: the top course of every sandbag parapet as real bags (render only). A box with
// a straight top edge reads as brickwork however good its texture; a row of stuffed bags along
// the top gives the wall its lumpy silhouette and its top a surface you'd lie a rifle on.
//  * One bag mesh (ModelKit: a pillow with tied ends, a slumped top, creases), instanced.
//  * Static parapets are bucketed into 64 m cells, frustum-culled by three, drawn with the full
//    bag up to `near`, a 36-triangle bag beyond (the two meshes share their instances) and not
//    at all beyond `far`; parapets dug during the match go into one dynamic mesh.
//  * Destroyed cover hides its bags (zeroed instances: no rebuilds).

import * as THREE from 'three';
import { rbox, merge } from './ModelKit.js';

const CELL = 64;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();

/** One sandbag, 0.6 m long, 0.33 m across, 0.17 m high, lying along X (lo: 36 triangles for distance). */
export function bagGeometry(lo = false) {
  const p = rbox(0.6, 0.17, 0.33, { e1: 0.6, e2: 0.3, ws: lo ? 6 : 12, hs: lo ? 3 : 6 });
  p.warp((v) => {
    const t = Math.min(1, Math.abs(v.x) / 0.3);                       // 0 in the middle, 1 at the ends
    const pinch = 1 - 0.4 * Math.max(0, t - 0.7) / 0.3;               // tied ends
    v.y *= pinch * (1 + 0.1 * (1 - t * t));                            // a fat belly
    v.z *= pinch;
    if (v.y > 0) v.y -= 0.022 * (1 - t * t) * (1 - Math.abs(v.z) / 0.165); // the top slumps
    v.y += Math.sin(v.x * 23 + v.z * 9) * 0.004 + Math.sin(v.x * 51 - v.z * 17) * 0.002;   // creases
  });
  return merge([p]);
}

export class SandbagTops {
  /**
   * @param {THREE.Scene} scene
   * @param {object[]} boxes  the map's sandbag cover ({ min, max })
   * @param {object} o { color, capacity (bags for parapets dug in the match), far (m) }
   */
  constructor(scene, boxes, { color = '#a68e66', capacity = 4000, near = 60, far = 150 } = {}) {
    this.scene = scene; this.near = near; this.far = far;
    this.geo = bagGeometry();
    this.loGeo = bagGeometry(true);
    this.mat = new THREE.MeshStandardMaterial({ color, roughness: 1 });
    this.slots = new Map();       // box -> { mesh, start, count }
    const cells = new Map();
    for (const b of boxes) {
      const bags = layBags(b);
      if (!bags.length) continue;
      const k = `${Math.floor((b.min.x + b.max.x) / 2 / CELL)},${Math.floor((b.min.z + b.max.z) / 2 / CELL)}`;
      if (!cells.has(k)) cells.set(k, { list: [], boxes: [] });
      const c = cells.get(k);
      c.boxes.push([b, c.list.length, bags.length]);
      c.list.push(...bags);
    }
    this.cells = [];
    for (const c of cells.values()) {
      const mesh = this.#mesh(c.list.length);
      c.list.forEach((bag, i) => { mesh.setMatrixAt(i, bag.m); mesh.setColorAt(i, bag.c); });
      mesh.count = c.list.length;
      mesh.computeBoundingSphere();
      for (const [b, start, count] of c.boxes) this.slots.set(b, { mesh, start, count });
      // The distant version shares the instances.
      const lo = new THREE.InstancedMesh(this.loGeo, this.mat, 1);
      Object.assign(lo, { instanceMatrix: mesh.instanceMatrix, instanceColor: mesh.instanceColor, count: mesh.count, boundingSphere: mesh.boundingSphere });
      lo.castShadow = lo.receiveShadow = true;
      this.scene.add(lo);
      this.cells.push({ hi: mesh, lo });
    }
    this.dynamic = this.#mesh(capacity);
    this.dynamic.count = 0;
    this.dynamic.frustumCulled = false;
    this.bags = this.cells.reduce((n, c) => n + c.hi.count, 0);
  }

  #mesh(n) {
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, Math.max(1, n));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.setColorAt(0, _c.set(1, 1, 1));
    this.scene.add(mesh);
    return mesh;
  }

  /** A parapet dug during the match. */
  add(box) {
    const bags = layBags(box), d = this.dynamic;
    if (!bags.length || d.count + bags.length > d.instanceMatrix.count) return;
    const start = d.count;
    for (const bag of bags) { d.setMatrixAt(d.count, bag.m); d.setColorAt(d.count, bag.c); d.count++; }
    d.instanceMatrix.needsUpdate = true; d.instanceColor.needsUpdate = true;
    this.slots.set(box, { mesh: d, start, count: bags.length });
  }

  /** Cover blown away: its bags go too. */
  hide(box) {
    const s = this.slots.get(box);
    if (!s) return;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < s.count; i++) s.mesh.setMatrixAt(s.start + i, _m);
    s.mesh.instanceMatrix.needsUpdate = true;
    this.slots.delete(box);
  }

  /** Full bags near, simple ones further out, none beyond `far` (deep in the fog). */
  update(camPos) {
    for (const { hi, lo } of this.cells) {
      const c = hi.boundingSphere.center, d = Math.max(0, Math.hypot(c.x - camPos.x, c.z - camPos.z) - hi.boundingSphere.radius);
      hi.visible = d < this.near;
      lo.visible = !hi.visible && d < this.far;
    }
  }
}

/**
 * Bags along the top of a box: rows across its depth, bags along its length (a little each way
 * in size, yaw and shade), sitting into the top so the box's own top face hides under them.
 */
function layBags(b) {
  const sx = b.max.x - b.min.x, sz = b.max.z - b.min.z, h = b.max.y - b.min.y;
  if (h < 0.25) return [];
  const alongX = sx >= sz, len = alongX ? sx : sz, depth = alongX ? sz : sx;
  const rows = Math.max(1, Math.min(4, Math.round(depth / 0.36))), n = Math.max(1, Math.round(len / 0.58));
  const bl = len / n, rw = depth / rows, cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
  const out = [];
  let s = (Math.floor(cx * 13.7) * 73856093) ^ (Math.floor(cz * 7.3) * 19349663);
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? bl * 0.5 : 0, across = -depth / 2 + (r + 0.5) * rw;
    for (let i = 0; i < n + (off ? 1 : 0); i++) {
      let a0 = -len / 2 + i * bl - off, a1 = a0 + bl;
      a0 = Math.max(a0, -len / 2); a1 = Math.min(a1, len / 2);
      if (a1 - a0 < bl * 0.45) continue;                                  // no slivers at the ends
      const a = (a0 + a1) / 2, l = (a1 - a0) * (1.03 + rnd() * 0.06);
      const x = alongX ? cx + a : cx + across, z = alongX ? cz + across : cz + a;
      _p.set(x + (rnd() - 0.5) * 0.04, b.max.y - 0.035 + (rnd() - 0.5) * 0.02, z + (rnd() - 0.5) * 0.04);
      _q.setFromEuler(_e.set((rnd() - 0.5) * 0.06, (alongX ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.06));
      _s.set(l / 0.6, 0.9 + rnd() * 0.2, Math.min(1.25, (rw / 0.33) * 1.06));
      const k = rnd(), tint = k < 0.12 ? 0.74 : k > 0.9 ? 1.12 : 0.9 + rnd() * 0.16;
      out.push({ m: new THREE.Matrix4().compose(_p, _q, _s), c: new THREE.Color(tint, tint * (0.98 + rnd() * 0.04), tint * (0.94 + rnd() * 0.08)) });
    }
  }
  return out;
}
