// BattlefieldRenderer: the static and semi-static world of a frontline map, cheap enough for
// 1.4 km maps and 128 fighters.
//  * Terrain: TerrainChunks (128 m chunks, distance LOD, mud where the ground was dug), with a
//    tiling detail texture so speed reads from the ground rushing past (motion perception needs
//    ground texture; a flat color makes a sprint feel like floating). Runtime digging rebuilds
//    just the chunks it touched.
//  * Cover: one InstancedMesh per material (sandbags, concrete, timber, rock, blockhouses), with
//    room for the fortifications squads build during the match; destroyed cover is hidden by
//    zeroing its instance (no rebuilds, no garbage).
//  * Barbed wire: instanced posts plus one line set for every strand; cut wire disappears.
//  * Objectives: a ground ring per point in the owner's color, a progress arc while it's being
//    taken, and a light beacon over capturable points so the fight is visible from afar.
//  * The line of battle: a glowing curtain along each team's front, so you can see where the
//    front is and watch it move.

import * as THREE from 'three';
import { bus } from '../core/EventBus.js';
import { TerrainChunks } from './TerrainChunks.js';

const TEAM = [new THREE.Color('#ffcf6b'), new THREE.Color('#b994ff')];
const NEUTRAL = new THREE.Color('#d8dde6');
const DETAIL_MEAN = 0.78; // the ground detail texture's average, divided back out of the vertex colors
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export class BattlefieldRenderer {
  constructor(scene, map, { localTeam = 0, anisotropy = 4, fortCapacity = 900 } = {}) {
    this.scene = scene; this.map = map; this.localTeam = localTeam; this.anisotropy = anisotropy;
    this.#terrain();
    this.#cover(fortCapacity);
    this.#wire();
    this.#objectives();
    this.#lines();
    this.off = [
      bus.on('world:coverDestroyed', (e) => this.#hide(e.cover)),
      bus.on('world:coverAdded', (e) => this.#add(e.cover)),
      bus.on('world:wireCut', (e) => this.#cutWire(e.belts)),
    ];
  }

  dispose() { this.off.forEach((f) => f()); this.chunks.dispose(); }

  #terrain() {
    const detail = groundDetail();
    detail.anisotropy = this.anisotropy;
    this.groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.95 });
    this.chunks = new TerrainChunks(this.scene, this.map.terrain, { material: this.groundMat, colorScale: 1 / DETAIL_MEAN });
  }

  #cover(fortCapacity) {
    this.kinds = {
      concrete: new THREE.MeshStandardMaterial({ color: '#7d828c', roughness: 0.9 }),
      sandbag: new THREE.MeshStandardMaterial({ color: '#8f8061', roughness: 1 }),
      wood: new THREE.MeshStandardMaterial({ color: '#6e5233', roughness: 0.9 }),
      rock: new THREE.MeshStandardMaterial({ color: '#5e5b57', roughness: 1 }),
      metal: new THREE.MeshStandardMaterial({ color: '#5a6170', roughness: 0.6, metalness: 0.4 }),
    };
    const groups = new Map(Object.keys(this.kinds).map((k) => [k, []]));
    for (const b of this.map.cover) groups.get(this.#kindOf(b)).push(b);
    this.coverMeshes = new Map();
    this.coverSlot = new Map();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    for (const [k, list] of groups) {
      // Sandbags get headroom for the fortifications squads dig during the match.
      const cap = list.length + (k === 'sandbag' ? fortCapacity : 16);
      const mesh = new THREE.InstancedMesh(geo, this.kinds[k], cap);
      mesh.count = 0;
      this.coverMeshes.set(k, mesh);
      for (const b of list) this.#place(mesh, b);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false; // instances span the whole map
      this.scene.add(mesh);
    }
  }

  #kindOf(b) { return b.kind === 'building' ? 'metal' : this.kinds[b.surface] ? b.surface : 'concrete'; }

  #place(mesh, b) {
    if (mesh.count >= mesh.instanceMatrix.count) return false;
    const i = mesh.count++;
    _s.subVectors(b.max, b.min);
    _p.copy(b.min).addScaledVector(_s, 0.5);
    mesh.setMatrixAt(i, _m.compose(_p, _q.identity(), _s));
    this.coverSlot.set(b, { mesh, i });
    mesh.instanceMatrix.needsUpdate = true;
    return true;
  }

  /** Cover added during the match (fortifications). */
  #add(box) { this.#place(this.coverMeshes.get(this.#kindOf(box)), box); }

  // ---------------------------------------------------------------- wire
  #wire() {
    const belts = this.map.wire ?? [];
    const t = this.map.terrain;
    const postGeo = new THREE.BoxGeometry(0.07, 1.25, 0.07).translate(0, 0.5, 0);
    const posts = [];
    const strand = [];
    this.wireRanges = [];       // per belt: [first post, post count, first strand vertex, strand vertex count]
    for (const w of belts) {
      const p0 = posts.length, s0 = strand.length / 3;
      const pts = [];
      for (let z = w.min.z; z <= w.max.z + 0.01; z += 2.5) for (const x of [w.min.x, w.max.x]) pts.push([x, t.height(x, z), z]);
      for (const p of pts) posts.push(p);
      // Strands at three heights along both rows, plus the criss-cross between them.
      for (let k = 0; k + 2 < pts.length; k += 2) {
        const a = pts[k], b = pts[k + 1], c = pts[k + 2], d = pts[k + 3] ?? c;
        for (const hgt of [0.25, 0.6, 0.95]) {
          strand.push(a[0], a[1] + hgt, a[2], c[0], c[1] + hgt, c[2], b[0], b[1] + hgt, b[2], d[0], d[1] + hgt, d[2]);
        }
        strand.push(a[0], a[1] + 0.9, a[2], d[0], d[1] + 0.2, d[2], b[0], b[1] + 0.9, b[2], c[0], c[1] + 0.2, c[2]);
      }
      this.wireRanges.push([p0, posts.length - p0, s0, strand.length / 3 - s0]);
    }
    this.posts = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: '#4b3d2c', roughness: 1 }), Math.max(1, posts.length));
    posts.forEach(([x, y, z], i) => this.posts.setMatrixAt(i, _m.makeTranslation(x, y, z)));
    this.posts.count = posts.length;
    this.posts.castShadow = true; this.posts.frustumCulled = false;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(strand), 3));
    this.strands = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: '#2f2f2f', transparent: true, opacity: 0.85 }));
    this.scene.add(this.posts, this.strands);
  }

  #cutWire(ids) {
    const pos = this.strands.geometry.attributes.position;
    for (const id of ids) {
      const r = this.wireRanges[id];
      if (!r) continue;
      for (let k = 0; k < r[1]; k++) this.posts.setMatrixAt(r[0] + k, _m.makeScale(0, 0, 0));
      for (let k = 0; k < r[3]; k++) pos.setY(r[2] + k, -1000);   // strands drop out of the world
    }
    this.posts.instanceMatrix.needsUpdate = true;
    pos.needsUpdate = true;
  }

  #hide(box) {
    const slot = this.coverSlot.get(box);
    if (!slot) return;
    slot.mesh.setMatrixAt(slot.i, _m.makeScale(0, 0, 0));
    slot.mesh.instanceMatrix.needsUpdate = true;
  }

  #objectives() {
    this.pointViews = this.map.points.map((p) => {
      const g = new THREE.Group();
      g.position.copy(p.pos);
      const ring = new THREE.Mesh(new THREE.RingGeometry(p.radius - 0.35, p.radius, 64), new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.15;
      const fill = new THREE.Mesh(new THREE.CircleGeometry(p.radius - 0.4, 64), new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, opacity: 0.08, depthWrite: false }));
      fill.rotation.x = -Math.PI / 2; fill.position.y = 0.12;
      const arc = new THREE.Mesh(new THREE.RingGeometry(p.radius + 0.2, p.radius + 1.1, 64, 1, 0, Math.PI * 2), new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
      arc.rotation.x = -Math.PI / 2; arc.position.y = 0.16;
      // Normal blending: additive washes out to white against a bright sky and loses the team color.
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.9, 60, 12, 1, true).translate(0, 30, 0), new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, opacity: 0.3, depthWrite: false }));
      g.add(fill, ring, arc, beacon);
      this.scene.add(g);
      return { g, ring, fill, arc, beacon, lastProgress: null };
    });
  }

  #lines() {
    // One curtain per team at the edge of its front sector (where its territory ends).
    this.curtains = [0, 1].map((team) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(this.map.bounds.maxZ - this.map.bounds.minZ, 6, 80, 1),
        new THREE.MeshBasicMaterial({ color: TEAM[team], transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: true }));
      m.rotation.y = Math.PI / 2;
      this.scene.add(m);
      return m;
    });
  }

  /** @param {FrontlineMode} mode  @param {THREE.Vector3} camPos */
  update(mode, time, camPos = null) {
    // Ground: LOD around the camera, and chunks the sim dug since the last frame.
    for (const r of this.map.terrain.takeDirty()) this.chunks.invalidate(r);
    if (camPos) this.chunks.update(camPos, { all: !this.chunksReady });
    this.chunksReady = true;
    for (const [i, v] of this.pointViews.entries()) {
      const p = mode.points[i];
      const col = p.owner >= 0 ? TEAM[p.owner] : NEUTRAL;
      const live = mode.capturable(p);
      v.ring.material.color.copy(col); v.fill.material.color.copy(col);
      v.ring.material.opacity = live ? 0.9 : 0.35;
      v.fill.material.opacity = live ? (p.contested ? 0.18 + 0.1 * Math.sin(time * 10) : 0.1) : 0.04;
      v.beacon.visible = live;
      v.beacon.material.color.copy(col);
      v.beacon.material.opacity = 0.28 + (p.capturing >= 0 ? 0.2 * (0.5 + 0.5 * Math.sin(time * 8)) : 0);
      // Progress arc: how far the point is toward the side currently capturing it.
      const prog = Math.abs(p.progress);
      if (v.lastProgress === null || Math.abs(v.lastProgress - p.progress) > 0.01) {
        v.arc.geometry.dispose();
        v.arc.geometry = new THREE.RingGeometry(p.radius + 0.2, p.radius + 1.1, 48, 1, Math.PI / 2, Math.max(0.001, prog) * Math.PI * 2);
        v.lastProgress = p.progress;
      }
      v.arc.material.color.copy(p.progress > 0 ? TEAM[0] : p.progress < 0 ? TEAM[1] : NEUTRAL);
      v.arc.visible = live && prog > 0.01 && prog < 0.999;
    }
    // Front curtains sit at the far edge of each team's front sector.
    for (const team of [0, 1]) {
      const s = this.map.sectors[mode.front[team]];
      const x = team === 0 ? s.x1 : s.x0;
      const c = this.curtains[team];
      c.position.set(x, 0, (this.map.bounds.minZ + this.map.bounds.maxZ) / 2);
      // Drape it over the terrain: sample heights along the curtain.
      // The plane has one height segment: the first row of vertices is the top edge.
      const pos = c.geometry.attributes.position, half = pos.count / 2;
      for (let i = 0; i < pos.count; i++) {
        const wz = c.position.z - pos.getX(i);
        pos.setY(i, this.map.terrain.height(x, wz) + (i < half ? 5 : -0.5));
      }
      pos.needsUpdate = true;
      c.position.y = 0;
      c.material.opacity = 0.06 + 0.025 * Math.sin(time * 2 + team);
    }
  }
}

/**
 * A tileable grayscale detail texture (periodic value noise, four octaves plus grain), centered
 * on 1 so it modulates the vertex colors without shifting their average much. Generated as a
 * DataTexture: no canvas, no image to ship.
 */
function groundDetail(size = 256) {
  const lattice = (period, seed) => {
    const v = new Float32Array(period * period);
    let s = seed;
    for (let i = 0; i < v.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; v[i] = s / 4294967296; }
    return (x, y) => {
      const fx = (x / size) * period, fy = (y / size) * period;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (i, j) => v[((j % period) * period) + (i % period)];
      const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
      return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    };
  };
  const octaves = [[lattice(4, 11), 0.4], [lattice(8, 23), 0.3], [lattice(16, 37), 0.2], [lattice(32, 51), 0.1]];
  const data = new Uint8Array(size * size * 4);
  let g = 7;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let n = 0;
      for (const [f, w] of octaves) n += f(x, y) * w;
      g = (g * 1664525 + 1013904223) >>> 0;
      const grain = (g / 4294967296 - 0.5) * 0.08;
      const v = Math.max(0, Math.min(1, DETAIL_MEAN + (n - 0.5) * 0.5 + grain)); // ~0.6-0.95
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(v * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex; // linear (no color space): it is a multiplier, not a color
}
