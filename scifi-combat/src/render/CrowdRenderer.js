// CrowdRenderer: draws every fighter in a handful of instanced draw calls (64-128 players).
//
//  * One InstancedMesh per part shape: armor boxes (torso, pelvis, pack, pads, feet, hands, gun,
//    cape), tapered limbs, helmets, glowing parts (visors, flame blades) and far impostors.
//    That's about five draw calls for the whole crowd, plus shadows.
//  * Per-instance color (team armor, dark gear) and per-instance emissive (status glow: i-frames
//    blue, vulnerable red, Scorch orange, transform auras), via a small shader patch.
//  * LOD: near rigs draw every part; mid rigs drop hands, pads, magazine and cape; far fighters
//    are a single capsule impostor posed by stance (upright, crouched or lying).
//  * Per-fighter frustum culling on the CPU (a crowd-wide bounding sphere would never cull).
// The rig math lives in ProceduralHumanoid; this file only turns joints into matrices.

import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _X = new THREE.Vector3(1, 0, 0);
const _col = new THREE.Color();
const _black = new THREE.Color(0, 0, 0);
const _sphere = new THREE.Sphere();
const _pv = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

export const TEAM_LOOKS = [
  { armor: '#c9a24a', suit: '#4a4234', accent: '#eadcb0', cape: '#8f2a1c', visor: '#ffcf6b', gear: '#5a5448' },
  { armor: '#55437a', suit: '#2e2a3d', accent: '#9a7fe0', cape: '#2c1f4d', visor: '#b994ff', gear: '#4a4658' },
];

/** Adds `attribute vec3 instanceEmissive` to a standard material (status glow per instance). */
function withInstanceEmissive(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 instanceEmissive;\nvarying vec3 vInstanceEmissive;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstanceEmissive = instanceEmissive;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vInstanceEmissive;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vInstanceEmissive;');
  };
  material.customProgramCacheKey = () => 'instanceEmissive';
  return material;
}

class Batch {
  constructor(scene, geometry, material, capacity, { shadows = true, emissive = true } = {}) {
    if (emissive) geometry.setAttribute('instanceEmissive', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _col.set(1, 1, 1));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadows;
    this.mesh.receiveShadow = shadows;
    this.em = emissive ? geometry.getAttribute('instanceEmissive') : null;
    this.capacity = capacity;
    this.count = 0;
    scene.add(this.mesh);
  }
  put(matrix, color, emissive = _black) {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this.mesh.setMatrixAt(i, matrix);
    this.mesh.setColorAt(i, color);
    if (this.em) this.em.setXYZ(i, emissive.r, emissive.g, emissive.b);
  }
  end() {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (this.em) this.em.needsUpdate = true;
    this.count = 0;
  }
}

export class CrowdRenderer {
  /**
   * @param {THREE.Scene} scene
   * @param {object} opts { max: fighters, looks: per-team palette }
   */
  constructor(scene, { max = 160, looks = TEAM_LOOKS } = {}) {
    this.looks = looks.map((l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, new THREE.Color(v)])));
    this.gunmetal = new THREE.Color('#1b1c1f');
    const std = (opts) => withInstanceEmissive(new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.25, ...opts }));
    const limbGeo = new THREE.CylinderGeometry(0.8, 1, 1, 8, 1).translate(0, 0.5, 0);
    const capsule = new THREE.CapsuleGeometry(0.33, 1.1, 3, 8).translate(0, 0.88, 0);
    this.box = new Batch(scene, new THREE.BoxGeometry(1, 1, 1), std({}), max * 18);
    this.limb = new Batch(scene, limbGeo, std({ roughness: 0.7 }), max * 8);
    this.head = new Batch(scene, new THREE.SphereGeometry(1, 12, 8), std({ roughness: 0.4, metalness: 0.4 }), max);
    this.glow = new Batch(scene, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }), max * 2, { shadows: false, emissive: false });
    this.impostor = new Batch(scene, capsule, std({}), max, { shadows: false });
    this.frustum = new THREE.Frustum();
    this.camera = null;
    this.drawn = 0;
  }

  begin(camera) {
    this.camera = camera;
    if (camera) {
      camera.updateMatrixWorld();
      _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(_pv);
    }
    this.drawn = 0;
  }

  end() { this.box.end(); this.limb.end(); this.head.end(); this.glow.end(); this.impostor.end(); }

  #visible(center, radius) {
    if (!this.camera) return true;
    _sphere.center.copy(center); _sphere.radius = radius;
    return this.frustum.intersectsSphere(_sphere);
  }

  /**
   * Box from a center, two orthonormal axes and full extents. The third axis is ax × ay, so the
   * basis is always right-handed (instanced meshes can't flip winding per instance).
   */
  #box(batch, center, ax, ay, sx, sy, sz, color, em) {
    _bz.crossVectors(ax, ay).normalize().multiplyScalar(sz);
    _bx.copy(ax).multiplyScalar(sx);
    _by.copy(ay).multiplyScalar(sy);
    _m.makeBasis(_bx, _by, _bz);
    _m.setPosition(center);
    batch.put(_m, color, em);
  }

  /** Tapered limb from joint a to joint b. */
  #limb(a, b, r, color, em, ref) {
    _y.subVectors(b, a);
    const len = _y.length();
    if (len < 1e-5) return;
    _t.copy(_y).divideScalar(len);
    _x.crossVectors(_t, ref);
    if (_x.lengthSq() < 1e-6) _x.crossVectors(_t, Math.abs(_t.y) < 0.9 ? UP : _X);
    _x.normalize();
    _z.crossVectors(_x, _t).normalize();
    _m.makeBasis(_x.multiplyScalar(r), _y, _z.multiplyScalar(r));
    _m.setPosition(a);
    this.limb.put(_m, color, em);
  }

  /**
   * @param {ProceduralHumanoid} h
   * @param {object} look  { team, status: THREE.Color | null, flame: THREE.Color | null, highlight }
   * @param {number} lod   0 near, 1 mid
   */
  drawRig(h, look, lod = 0) {
    const j = h.j, F = h.F, sc = h.scale, pal = this.looks[look.team] ?? this.looks[0];
    if (!this.#visible(j.pelvis, 1.6 * sc + (h.prop.length ?? 1))) return;
    this.drawn++;
    const em = look.status ?? _black;
    const armor = look.highlight ? _col.copy(pal.armor).multiplyScalar(1.18) : pal.armor;
    const P = F.pelvis, C = F.chest, H = F.head;

    // Torso: pelvis, abdomen (spans to the chest), chest plate, pack.
    this.#box(this.box, _c.copy(j.pelvis).addScaledVector(P.d, -0.02 * sc), P.r, P.d, 0.34 * sc, 0.2 * sc, 0.22 * sc, pal.suit, em);
    _t.subVectors(j.chestC, j.pelvis);
    const abLen = _t.length();
    _t.divideScalar(abLen || 1);
    _x.copy(C.r).addScaledVector(_t, -C.r.dot(_t)).normalize();
    this.#box(this.box, _c.lerpVectors(j.pelvis, j.chestC, 0.5), _x, _t, 0.3 * sc, abLen + 0.04 * sc, 0.2 * sc, pal.suit, em);
    this.#box(this.box, _c.copy(j.chestC).addScaledVector(C.n, 0.02 * sc), C.r, C.d, 0.44 * sc, 0.36 * sc, 0.28 * sc, armor, em);
    this.#box(this.box, _c.copy(j.chestC).addScaledVector(C.n, -0.2 * sc).addScaledVector(C.d, -0.02 * sc), C.r, C.d, 0.34 * sc, 0.38 * sc, 0.16 * sc, pal.gear, em);

    // Head and visor (the visor is the team read at range, so mid LOD keeps it).
    _m.makeBasis(_x.copy(H.r).multiplyScalar(0.135 * sc), _y.copy(H.d).multiplyScalar(0.15 * sc), _z.copy(H.n).multiplyScalar(-0.155 * sc));
    _m.setPosition(j.head);
    this.head.put(_m, armor, em);
    this.#box(this.glow, _c.copy(j.head).addScaledVector(H.n, 0.14 * sc).addScaledVector(H.d, 0.005 * sc), H.r, H.d, 0.2 * sc, 0.06 * sc, 0.045 * sc, pal.visor);

    // Limbs.
    for (let i = 0; i < 2; i++) {
      this.#limb(j.shoulder[i], j.elbow[i], 0.062 * sc, pal.suit, em, C.n);
      this.#limb(j.elbow[i], j.hand[i], 0.052 * sc, armor, em, C.n);
      this.#limb(j.hip[i], j.knee[i], 0.085 * sc, pal.suit, em, P.n);
      this.#limb(j.knee[i], j.ankle[i], 0.068 * sc, armor, em, P.n);
      // Boots: yaw and pitch from the planter (toe up at heel strike, heel up at push-off).
      const yaw = j.footYaw[i], pitch = j.footPitch[i];
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      _z.set(fx * cp, sp, fz * cp);                 // toe direction
      _y.set(-fx * sp, cp, -fz * sp);               // sole normal
      _x.crossVectors(_y, _z).normalize();
      _c.copy(j.ankle[i]).addScaledVector(_z, (h.d.toe - h.d.heel) * 0.5).addScaledVector(_y, -h.d.ankleH * 0.55);
      _m.makeBasis(_x.multiplyScalar(0.11 * sc), _y.multiplyScalar(0.09 * sc), _z.multiplyScalar(h.d.toe + h.d.heel + 0.03 * sc));
      _m.setPosition(_c);
      this.box.put(_m, pal.gear, em);
      if (lod === 0) {
        // Hands and shoulder pads.
        _t.subVectors(j.hand[i], j.elbow[i]).normalize();
        _x.copy(C.r).addScaledVector(_t, -C.r.dot(_t)).normalize();
        this.#box(this.box, j.hand[i], _x, _t, 0.08 * sc, 0.1 * sc, 0.06 * sc, pal.gear, em);
        const side = i === 0 ? -1 : 1;
        this.#box(this.box, _c.copy(j.shoulder[i]).addScaledVector(C.d, 0.03 * sc).addScaledVector(C.r, side * 0.03 * sc), C.r, C.d, 0.17 * sc, 0.11 * sc, 0.2 * sc, pal.accent, em);
      }
    }

    // Weapon.
    const pr = h.prop;
    if (pr.kind === 'gun') {
      _x.crossVectors(pr.dir, pr.up).normalize();
      this.#box(this.box, _c.copy(pr.base).addScaledVector(pr.dir, pr.length * 0.5), _x, pr.up, 0.065 * sc, 0.12 * sc, pr.length, this.gunmetal);
      if (lod === 0) {
        _c.copy(pr.base).addScaledVector(pr.dir, pr.length * 0.36).addScaledVector(pr.up, -0.1 * sc);
        this.#box(this.box, _c, _x, pr.up, 0.05 * sc, 0.14 * sc, 0.08 * sc, this.gunmetal);
      }
      if (pr.glow > 0.02) {
        // Heat weapons glow along the barrel shroud as they heat up.
        _col.copy(pal.visor).multiplyScalar(0.4 + pr.glow * 2.5);
        this.#box(this.glow, _c.copy(pr.base).addScaledVector(pr.dir, pr.length * 0.7).addScaledVector(pr.up, 0.065 * sc), _x, pr.up, 0.04 * sc, 0.012 * sc, pr.length * 0.3, _col);
      }
    } else if (pr.kind === 'blade') {
      _x.crossVectors(pr.dir, pr.up).normalize();
      this.#box(this.box, _c.copy(pr.base).addScaledVector(pr.dir, -0.05 * sc), _x, pr.up, 0.035 * sc, 0.035 * sc, 0.2 * sc, this.gunmetal);
      _col.copy(look.flame ?? pal.visor).multiplyScalar(1 + Math.min(3, pr.glow * 2));
      this.#box(this.glow, _c.copy(pr.base).addScaledVector(pr.dir, pr.length * 0.5 + 0.05 * sc), _x, pr.up, 0.014 * sc, 0.06 * sc, pr.length, _col);
    }

    // Cape: thin panels between the verlet points.
    if (lod === 0 && h.capeInit) {
      const pts = h.cape;
      for (let i = 0; i < pts.length - 1; i++) {
        _y.subVectors(pts[i], pts[i + 1]);
        const len = _y.length();
        if (len < 1e-4) continue;
        _y.divideScalar(len);
        _x.copy(C.r).addScaledVector(_y, -C.r.dot(_y)).normalize();
        const wdt = (0.34 - i * 0.03) * sc;
        this.#box(this.box, _c.lerpVectors(pts[i], pts[i + 1], 0.5), _x, _y, wdt, len + 0.02 * sc, 0.02 * sc, pal.cape, em);
      }
    }
  }

  /**
   * Far LOD: one capsule, upright or lying along the body axis.
   * @param {Vector3} root  ground point
   * @param {object} pose   { yaw, height (m, standing 1.8), lying: bool }
   */
  drawImpostor(root, pose, look) {
    const pal = this.looks[look.team] ?? this.looks[0];
    if (!this.#visible(_c.copy(root).setY(root.y + 0.9), 1.4)) return;
    this.drawn++;
    const sc = pose.scale ?? 1;
    const yaw = pose.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (pose.lying) {
      // Capsule axis along the body: x = right, y = forward (the capsule's long axis), z = up.
      _x.set(-fz, 0, fx);
      _y.set(fx, 0, fz).multiplyScalar(sc);
      _z.set(0, 0.6 * sc, 0);
      _m.makeBasis(_x.multiplyScalar(sc), _y, _z);
      _c.copy(root).addScaledVector(_t.set(fx, 0, fz), -0.88 * sc);
      _c.y += 0.2 * sc;
      _m.setPosition(_c);
    } else {
      _m.makeBasis(_x.set(-fz, 0, fx).multiplyScalar(sc), _y.set(0, (pose.height / 1.8) * sc, 0), _z.set(fx, 0, fz).multiplyScalar(-sc));
      _m.setPosition(root);
    }
    this.impostor.put(_m, look.highlight ? _col.copy(pal.armor).multiplyScalar(1.18) : pal.armor, look.status ?? _black);
  }
}
