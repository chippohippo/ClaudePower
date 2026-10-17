// BattlefieldRenderer: the static and semi-static world of a frontline map, cheap enough for
// 1 km maps and 128 fighters.
//  * Terrain: one mesh from the heightfield samples, vertex-colored by slope and height, with a
//    tiling detail texture so speed reads from the ground rushing past (motion perception needs
//    ground texture; a flat color makes a sprint feel like floating).
//  * Cover: one InstancedMesh per material (concrete, wood, rock, buildings); destroyed cover
//    is hidden by zeroing its instance (no rebuilds, no garbage).
//  * Objectives: a ground ring per point in the owner's color, a progress arc while it's being
//    taken, and a light beacon over capturable points so the fight is visible from afar.
//  * The line of battle: a glowing curtain along each team's front, so you can see where the
//    front is and watch it move.

import * as THREE from 'three';
import { bus } from '../core/EventBus.js';

const TEAM = [new THREE.Color('#ffcf6b'), new THREE.Color('#b994ff')];
const NEUTRAL = new THREE.Color('#d8dde6');
const DETAIL_MEAN = 0.78; // the ground detail texture's average, divided back out of the vertex colors
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export class BattlefieldRenderer {
  constructor(scene, map, { localTeam = 0, anisotropy = 4 } = {}) {
    this.scene = scene; this.map = map; this.localTeam = localTeam; this.anisotropy = anisotropy;
    this.#terrain();
    this.#cover();
    this.#objectives();
    this.#lines();
    this.off = [bus.on('world:coverDestroyed', (e) => this.#hide(e.cover))];
  }

  dispose() { this.off.forEach((f) => f()); }

  #terrain() {
    // Rendered at 4 m (a quarter of the sim's samples): 50k triangles for a 1 km map.
    const t = this.map.terrain, step = 2;
    const geo = new THREE.PlaneGeometry(t.width, t.depth, Math.round((t.nx - 1) / step), Math.round((t.nz - 1) / step));
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3);
    const grass = new THREE.Color('#4a5a3a'), dirt = new THREE.Color('#6b5a44'), rock = new THREE.Color('#6d6f73'), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + t.minX + t.width / 2, z = pos.getZ(i) + t.minZ + t.depth / 2;
      const h = t.height(x, z);
      pos.setXYZ(i, x, h, z);
      const slope = t.slopeDeg(x, z);
      c.copy(grass).lerp(dirt, Math.min(1, Math.max(0, (slope - 6) / 14))).lerp(rock, Math.min(1, Math.max(0, (slope - 22) / 12)));
      c.multiplyScalar((0.9 + Math.sin(x * 0.13) * Math.sin(z * 0.11) * 0.06 + (h / 40)) / DETAIL_MEAN);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const detail = groundDetail();
    detail.repeat.set(t.width / 6, t.depth / 6); // one tile per 6 m
    detail.anisotropy = this.anisotropy;
    this.ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.95 }));
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
  }

  #cover() {
    const kinds = {
      concrete: new THREE.MeshStandardMaterial({ color: '#7d828c', roughness: 0.9 }),
      wood: new THREE.MeshStandardMaterial({ color: '#8a6a3f', roughness: 0.85 }),
      rock: new THREE.MeshStandardMaterial({ color: '#5e5b57', roughness: 1 }),
      metal: new THREE.MeshStandardMaterial({ color: '#5a6170', roughness: 0.6, metalness: 0.4 }),
    };
    const groups = new Map();
    for (const b of this.map.cover) {
      const k = b.kind === 'building' ? 'metal' : kinds[b.surface] ? b.surface : 'concrete';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(b);
    }
    this.coverMeshes = [];
    this.coverSlot = new Map();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    for (const [k, list] of groups) {
      const mesh = new THREE.InstancedMesh(geo, kinds[k], list.length);
      list.forEach((b, i) => {
        _s.subVectors(b.max, b.min);
        _p.copy(b.min).addScaledVector(_s, 0.5);
        mesh.setMatrixAt(i, _m.compose(_p, _q.identity(), _s));
        this.coverSlot.set(b, { mesh, i });
      });
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
      this.coverMeshes.push(mesh);
    }
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

  /** @param {FrontlineMode} mode */
  update(mode, time) {
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
