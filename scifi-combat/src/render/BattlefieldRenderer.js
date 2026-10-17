// BattlefieldRenderer: the static and semi-static world of a frontline map, cheap enough for
// 1.4 km maps and 128 fighters.
//  * Terrain: TerrainChunks (128 m chunks, distance LOD, mud where the ground was dug), with a
//    tiling detail texture so speed reads from the ground rushing past (motion perception needs
//    ground texture; a flat color makes a sprint feel like floating). Runtime digging rebuilds
//    just the chunks it touched. With `art` (docs/ART_DIRECTION.md): scorched ground from the
//    planet palette (ArtTextures), and a ScorchField that blackens every crater and blast.
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
import { sandbagTexture, concreteTexture, woodTexture, rockTexture, metalTexture, triplanar } from './CoverTextures.js';
import { groundDetailTexture, groundMaterial } from './ArtTextures.js';
import { ScorchField } from './ScorchField.js';
import { SandbagTops } from './SandbagTops.js';
import { snowCover } from './SnowCover.js';

const TEAM = [new THREE.Color('#ffcf6b'), new THREE.Color('#b994ff')];
const NEUTRAL = new THREE.Color('#d8dde6');
const DETAIL_MEAN = 0.78; // the ground detail texture's average, divided back out of the vertex colors
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export class BattlefieldRenderer {
  /**
   * @param {object} o { localTeam, anisotropy, fortCapacity, art: { planet, palette } (palette.json:
   *   the art-directed look: scorched ground with burn marks, palette-colored cover with relief) }
   */
  constructor(scene, map, { localTeam = 0, anisotropy = 4, fortCapacity = 900, art = null } = {}) {
    this.scene = scene; this.map = map; this.localTeam = localTeam; this.anisotropy = anisotropy; this.art = art;
    this.glow = art?.planet.markerGlow ?? 1;   // the point beacons and the line's curtain: fainter on a night map, where they're all that glows
    this.off = [];
    this.#terrain();
    this.#cover(fortCapacity);
    this.#duckboards();
    this.#wire();
    this.#objectives();
    this.#lines();
    this.off.push(
      bus.on('world:coverDestroyed', (e) => this.#hide(e.cover)),
      bus.on('world:coverAdded', (e) => this.#add(e.cover)),
      bus.on('world:wireCut', (e) => this.#cutWire(e.belts)),
    );
  }

  dispose() { this.off.forEach((f) => f()); this.chunks.dispose(); }

  #terrain() {
    if (!this.art) {
      const detail = groundDetail();
      detail.anisotropy = this.anisotropy;
      this.groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.95 });
      this.chunks = new TerrainChunks(this.scene, this.map.terrain, { material: this.groundMat, colorScale: 1 / DETAIL_MEAN });
      return;
    }
    // Scorched ground: the planet's palette, the detail tile, and a burn field. The map's old
    // shell holes start with ash rims (a few still black); every shell and grenade that bursts
    // adds its own mark (the chunks it touches rebuild, as they do for the craters it digs).
    const t = this.map.terrain;
    this.scorch = new ScorchField({ minX: t.minX, minZ: t.minZ, width: t.width, depth: t.depth });
    let s = 0x2545f491;
    for (const c of this.map.craters ?? []) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const k = s / 4294967296;
      this.scorch.stamp(c.x, c.z, c.r * 1.25, k < 0.15 ? 0.9 : 0.28 + k * 0.2);
    }
    const T = this.art.planet.terrain;   // how much of the detail tile shows (snow lies smoother than dust)
    this.groundMat = groundMaterial(groundDetailTexture(), { relief: T?.relief ?? 1, grain: T?.grain ?? 1 });
    this.chunks = new TerrainChunks(this.scene, t, { material: this.groundMat, ground: this.art.planet.ground, scorch: (x, z) => this.scorch.at(x, z), paint: this.map.city?.paint ?? null });
    if (this.map.city) this.chunks.group.renderOrder = -2;   // the ground first: the city's lamp pools add their light over it and nothing else (CityRenderer)
    const burn = (p, r, k) => { if (r > 0.2) this.chunks.invalidate(this.scorch.stamp(p.x ?? p[0], p.z ?? p[2], r, k)); };
    this.off.push(
      bus.on('artillery:impact', (e) => burn(e.point, Math.max(1.6, e.crater || e.radius * 0.45) * 1.35, 1)),
      bus.on('projectile:explode', (e) => { if (!e.artillery) burn(e.point, (e.radius ?? 0) * 0.6, 0.85); }),
    );
  }

  #cover(fortCapacity) {
    // World-space surface detail: sandbags read as courses of bags, walls as cast concrete, crates
    // as planks (CoverTextures), at their real size on every box.
    const aniso = (t) => { t.anisotropy = this.anisotropy; return t; };
    // The art-directed look takes its colors from the palette and lights the textures' relief.
    const M = this.art?.palette.materials, G = this.art?.planet.ground, b = this.art ? 1 : 0;
    const snow = this.art?.planet.snow;   // (lying on the tops: SnowCover)
    this.kinds = {
      concrete: triplanar(new THREE.MeshStandardMaterial({ color: M?.concrete ?? '#7d828c', roughness: 0.92 }), aniso(concreteTexture()), 0.25, 0.7 * b),
      sandbag: triplanar(new THREE.MeshStandardMaterial({ color: M?.sandbag ?? '#8f8061', roughness: 1 }), aniso(sandbagTexture()), 1, 1.2 * b),
      wood: triplanar(new THREE.MeshStandardMaterial({ color: M?.timber ?? '#6e5233', roughness: 0.9 }), aniso(woodTexture()), 0.6, 0.8 * b),
      rock: triplanar(new THREE.MeshStandardMaterial({ color: G?.rock ?? '#5e5b57', roughness: 1 }), aniso(rockTexture()), 0.3, 1 * b),
      metal: triplanar(new THREE.MeshStandardMaterial({ color: M?.steel ?? '#5a6170', roughness: 0.6, metalness: 0.4 }), aniso(metalTexture()), 0.25, 0.5 * b),
    };
    for (const m of Object.values(this.kinds)) snowCover(m, snow);
    const groups = new Map(Object.keys(this.kinds).map((k) => [k, []]));
    // (a city's buildings, sidewalks, lamps, wrecks and street furniture are CityRenderer's)
    for (const b of this.map.cover) if (b.render !== 'city') groups.get(this.#kindOf(b)).push(b);
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
    // Real bags along the top of every parapet (the art-directed look).
    if (this.art) {
      this.sandbags = new SandbagTops(this.scene, groups.get('sandbag'), { color: this.art.palette.materials.sandbag, capacity: fortCapacity * 6 });
      snowCover(this.sandbags.mat, snow);
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
  #add(box) {
    const kind = this.#kindOf(box);
    this.#place(this.coverMeshes.get(kind), box);
    if (kind === 'sandbag') this.sandbags?.add(box);
  }

  /**
   * Duckboards: the slatted timber walkways laid along every trench floor (render only: 4 cm of
   * wood doesn't change how anyone moves). One plank-textured slab per 2 m, following the floor.
   */
  #duckboards() {
    const t = this.map.terrain, slabs = [];
    for (const T of this.map.trenches ?? []) {
      for (const [x0, z0, x1, z1, kind] of T.corridors) {
        if (kind === 'dugout') continue;
        const alongZ = z1 - z0 >= x1 - x0, len = alongZ ? z1 - z0 : x1 - x0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        for (let a = 0.6; a < len - 0.6; a += 2) {
          const l = Math.min(2, len - 0.6 - a), m = a + l / 2;
          const x = alongZ ? cx : x0 + m, z = alongZ ? z0 + m : cz;
          slabs.push({ x, y: t.height(x, z) + 0.02, z, sx: alongZ ? 0.7 : l - 0.05, sz: alongZ ? l - 0.05 : 0.7 });
        }
      }
    }
    if (!slabs.length) return;
    const mat = triplanar(new THREE.MeshStandardMaterial({ color: this.art?.palette.materials.timber ?? '#5a4630', roughness: 0.95 }), woodTexture(), 2.5, this.art ? 0.6 : 0);
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.04, 1), mat, slabs.length);
    slabs.forEach((b, i) => mesh.setMatrixAt(i, _m.compose(_p.set(b.x, b.y, b.z), _q.identity(), _s.set(b.sx, 1, b.sz))));
    mesh.receiveShadow = true; mesh.frustumCulled = false;
    this.duckboards = mesh;
    this.scene.add(mesh);
  }

  // ---------------------------------------------------------------- wire
  /**
   * Barbed-wire belts as the Western Front strung them: two rows of pickets with aprons of wire
   * pegged out to the ground on both sides, and a concertina coil rolled along between them.
   */
  #wire() {
    const belts = this.map.wire ?? [];
    const t = this.map.terrain;
    const postGeo = new THREE.BoxGeometry(0.06, 1.1, 0.06).translate(0, 0.45, 0);
    const posts = [];
    const strand = [];
    this.wireRanges = [];       // per belt: [first post, post count, first strand vertex, strand vertex count]
    const seg = (x0, y0, z0, x1, y1, z1) => strand.push(x0, y0, z0, x1, y1, z1);
    const h = (x, z) => t.height(x, z);
    for (const w of belts) {
      const p0 = posts.length, s0 = strand.length / 3;
      const cx = (w.min.x + w.max.x) / 2;
      const rows = [w.min.x + 0.15, w.max.x - 0.15];
      const zs = [];
      for (let z = w.min.z; z <= w.max.z + 0.01; z += 2.5) zs.push(Math.min(z, w.max.z));
      for (const z of zs) for (const x of rows) posts.push([x, h(x, z), z]);
      for (const [r, x] of rows.entries()) {
        const out = r === 0 ? -1 : 1;
        for (let k = 0; k < zs.length; k++) {
          const z = zs[k], y = h(x, z);
          // Apron: from the picket's top down to a peg 1.3 m out, and a half-height stay.
          seg(x, y + 1.0, z, x + out * 1.3, h(x + out * 1.3, z) + 0.05, z);
          seg(x, y + 0.55, z, x + out * 0.7, h(x + out * 0.7, z) + 0.05, z);
          if (k + 1 < zs.length) {
            const z2 = zs[k + 1], y2 = h(x, z2);
            for (const hh of [0.3, 0.7, 1.0]) seg(x, y + hh, z, x, y2 + hh, z2);
            seg(x, y + 1.0, z, x, y2 + 0.3, z2);   // the criss-cross between pickets
            // Apron strands running along, pegged out.
            seg(x + out * 1.3, h(x + out * 1.3, z) + 0.05, z, x + out * 1.3, h(x + out * 1.3, z2) + 0.05, z2);
          }
        }
      }
      // Concertina: a coil 0.9 m across, 12 segments a turn, 0.38 m a turn.
      const turns = (w.max.z - w.min.z) / 0.38, n = Math.max(12, Math.round(turns * 12));
      let px = cx, py = h(cx, w.min.z) + 0.48, pz = w.min.z;
      for (let i = 1; i <= n; i++) {
        const u = i / n, a = (i / 12) * Math.PI * 2, z = w.min.z + (w.max.z - w.min.z) * u;
        const x = cx + Math.cos(a) * 0.45, y = h(cx, z) + 0.48 + Math.sin(a) * 0.42;
        seg(px, py, pz, x, y, z);
        px = x; py = y; pz = z;
      }
      this.wireRanges.push([p0, posts.length - p0, s0, strand.length / 3 - s0]);
    }
    this.posts = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: '#4b3d2c', roughness: 1 }), Math.max(1, posts.length));
    posts.forEach(([x, y, z], i) => this.posts.setMatrixAt(i, _m.makeTranslation(x, y, z)));
    this.posts.count = posts.length;
    this.posts.castShadow = true; this.posts.frustumCulled = false;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(strand), 3));
    this.strands = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: '#2a2622', transparent: true, opacity: 0.9 }));
    this.strands.frustumCulled = false;
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
    this.sandbags?.hide(box);
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
      // Fading up its height: strong where the point is, a quarter of that 60 m up in the sky.
      const bg = new THREE.CylinderGeometry(0.35, 0.9, 60, 12, 1, true).translate(0, 30, 0), bp = bg.attributes.position, fade = new Float32Array(bp.count * 4);
      for (let i = 0; i < bp.count; i++) fade.set([1, 1, 1, 1 - 0.75 * bp.getY(i) / 60], i * 4);
      bg.setAttribute('color', new THREE.BufferAttribute(fade, 4));
      const beacon = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, opacity: 0.3, depthWrite: false, vertexColors: true }));
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
    if (camPos) { this.chunks.update(camPos, { all: !this.chunksReady }); this.sandbags?.update(camPos); }
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
      v.beacon.material.opacity = (0.28 + (p.capturing >= 0 ? 0.2 * (0.5 + 0.5 * Math.sin(time * 8)) : 0)) * this.glow;
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
      c.material.opacity = (0.06 + 0.025 * Math.sin(time * 2 + team)) * this.glow;
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
