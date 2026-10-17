// CrowdRenderer: draws every fighter, 4 to 400 of them, in the trooper kit (TrooperKit,
// docs/ART_DIRECTION.md) with a few dozen instanced draws.
//
//  * Bones, not boxes: each drawn rig gets a slot (a row of a float texture holding its 18
//    bone matrices: pelvis, abdomen, chest, head, arms, legs, feet, gun, three cape links).
//    Every kit mesh is rigidly skinned to those bones (TrooperMaterial), so one body mesh of a
//    weight draws every trooper wearing it in a single call.
//  * The kit by role (look.kit: body weight, helmet, role gear) and weapon archetype; paint by
//    faction (look.team: the two armies, the city's civilians and gangs), a stencilled number per
//    trooper (look.number; a civilian's colours, a raider's gang), status glow (look.status:
//    i-frames blue, vulnerable red, Scorch orange, transform auras).
//  * Rim light (look.rim, else by faction): the armies' colours; a civilian a neutral one (red
//    while he fights you: the caller sets look.rim = crowd.rimHostile); a gang's raiders red.
//  * LOD: near rigs inside `nearDist` draw the near kit (every pouch, strap and stencil); the
//    rest of the rigs draw the mid kit (silhouette and paint); far fighters are one ~200-triangle
//    impostor posed by stance (upright, crouched or lying).
//  * Per-fighter frustum culling on the CPU (a crowd-wide bounding sphere would never cull).
//  * Glow boxes for flame blades and heat-glowing barrels (unlit, bloom).
// The rig math lives in ProceduralHumanoid; this file only turns joints into bone matrices.

import * as THREE from 'three';
import { buildKit, impostorGeometry, BONE, NBONES, REF, GUN_LENGTH } from './TrooperKit.js';
import { trooperMaterials } from './TrooperMaterial.js';

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _X = new THREE.Vector3(1, 0, 0);
const _col = new THREE.Color();
const _black = new THREE.Color(0, 0, 0), _noRim = { r: 0, g: 0, b: 0, w: 3 };
const _sphere = new THREE.Sphere();
const _pv = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

/** The look when nothing else is known (palette.json factions, Solari then Void). */
export const DEFAULT_PALETTE = {
  factions: {
    solari: { armor: '#d6a01e', armorShade: '#9c720f', black: '#1b1b1e', suit: '#232326', gear: '#3a362e', webbing: '#2c2a25', stencil: '#efe7d2', stripe: '#141416', cape: '#7a1c14', capeTrim: '#d6a01e', visor: '#ffba3f', visorGlass: '#1d1712', lamp: '#ffe4a6', metal: '#3d3f44' },
    void: { armor: '#5a3591', armorShade: '#3b2263', black: '#19171d', suit: '#211f26', gear: '#36323d', webbing: '#28252d', stencil: '#d2bff3', stripe: '#131117', cape: '#1f1629', capeTrim: '#9a76de', visor: '#b98cff', visorGlass: '#140f1d', lamp: '#e3d4ff', metal: '#37353d' },
  },
  materials: { rubber: '#151515' },
  vfx: { dust: '#b9976a' },
};
/** Kit per class role (data/art/troopers.json has the authored table). */
export const DEFAULT_KIT = { body: 'medium', helmet: 'medium', gear: 'standard', cape: true };

let KIT = null;   // the kit geometry, built once per page

class Part {
  /** One kit mesh: an instanced draw of `geometry` for up to `capacity` troopers. */
  constructor(scene, geometry, materials, capacity, shadows) {
    const g = new THREE.InstancedBufferGeometry();
    for (const k of ['position', 'normal', 'aUv', 'aMat']) g.setAttribute(k, geometry.attributes[k]);
    this.iA = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iE = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iR = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iA', this.iA); g.setAttribute('iE', this.iE); g.setAttribute('iR', this.iR);
    g.instanceCount = 0;
    this.mesh = new THREE.Mesh(g, materials.material);
    this.mesh.customDepthMaterial = materials.depth;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadows; this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    this.capacity = capacity; this.count = 0;
    scene.add(this.mesh);
  }
  put(slot, team, number, tint, em, rim = _noRim) {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this.iA.setXYZW(i, slot, team, number, tint);
    this.iE.setXYZ(i, em.r, em.g, em.b);
    this.iR.setXYZW(i, rim.r, rim.g, rim.b, rim.w ?? 3);
  }
  end() {
    const g = this.mesh.geometry;
    g.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    if (this.count) {
      this.iA.clearUpdateRanges(); this.iA.addUpdateRange(0, this.count * 4); this.iA.needsUpdate = true;
      this.iE.clearUpdateRanges(); this.iE.addUpdateRange(0, this.count * 3); this.iE.needsUpdate = true;
      this.iR.clearUpdateRanges(); this.iR.addUpdateRange(0, this.count * 4); this.iR.needsUpdate = true;
    }
    this.count = 0;
  }
}

class GlowBatch {
  /** Unlit boxes (blade flames, hot barrels): instance matrix and color. */
  constructor(scene, capacity) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }), capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _col.set(1, 1, 1));
    this.mesh.frustumCulled = false;
    this.capacity = capacity; this.count = 0;
    scene.add(this.mesh);
  }
  put(m, color) { if (this.count < this.capacity) { const i = this.count++; this.mesh.setMatrixAt(i, m); this.mesh.setColorAt(i, color); } }
  end() { this.mesh.count = this.count; this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; this.count = 0; }
}

export class CrowdRenderer {
  /**
   * @param {THREE.Scene} scene
   * @param {object} o { max: fighters (rigs and impostors, corpses included), palette (palette.json),
   *                     nearDist: m within which rigs draw the near kit, shadows }
   */
  constructor(scene, { max = 160, palette = DEFAULT_PALETTE, nearDist = 20, shadows = true } = {}) {
    KIT ??= buildKit();
    this.kit = KIT;
    this.max = max; this.nearDist = nearDist;
    this.bones = new THREE.DataTexture(new Float32Array(NBONES * 4 * max * 4), NBONES * 4, max, THREE.RGBAFormat, THREE.FloatType);
    this.bones.magFilter = this.bones.minFilter = THREE.NearestFilter;
    this.mats = trooperMaterials(palette, this.bones);
    // Rim light by faction (palette factions.*.rim, ui.rim: strength and sharpness; civilians
    // ui.rim.civilian, the gangs ui.rim.hostile); a look's `rim` overrides it.
    const R = palette.ui?.rim ?? {}, k = R.strength ?? 1.6, rim = (c) => Object.assign(new THREE.Color(c).multiplyScalar(k), { w: R.power ?? 3 });
    this.rimHostile = rim(R.hostile ?? '#ff3a2a');
    this.rims = [rim(palette.factions?.solari?.rim ?? '#ffb43a'), rim(palette.factions?.void?.rim ?? '#b07cff'), rim(R.civilian ?? '#e6e2da'), this.rimHostile];
    // The kit's meshes, each at both levels: parts[group][name][level].
    this.parts = {};
    const part = (geo) => new Part(scene, geo, this.mats, max, shadows);
    for (const group of ['body', 'helmet', 'gear', 'weapon']) {
      this.parts[group] = {};
      for (const [name, levels] of Object.entries(KIT[group])) this.parts[group][name] = levels.map(part);
    }
    this.parts.cape = KIT.cape.map(part);
    this.impostor = part(impostorGeometry());
    this.impostor.mesh.castShadow = false;
    this.glow = new GlowBatch(scene, max * 2);
    this.all = [this.impostor, this.parts.cape[0], this.parts.cape[1]];
    for (const group of ['body', 'helmet', 'gear', 'weapon']) for (const levels of Object.values(this.parts[group])) this.all.push(...levels);
    this.frustum = new THREE.Frustum();
    this.camera = null;
    this.slots = 0;
    this.drawn = 0;
    this.stats = { near: 0, mid: 0, far: 0, slots: 0 };
  }

  begin(camera) {
    this.camera = camera;
    if (camera) {
      camera.updateMatrixWorld();
      _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(_pv);
    }
    this.slots = 0;
    this.drawn = 0;
    this.stats.near = this.stats.mid = this.stats.far = 0;
  }

  end() {
    for (const p of this.all) p.end();
    this.glow.end();
    this.stats.slots = this.slots;
    if (this.slots) this.bones.needsUpdate = true;
  }

  #visible(center, radius) {
    if (!this.camera) return true;
    _sphere.center.copy(center); _sphere.radius = radius;
    return this.frustum.intersectsSphere(_sphere);
  }

  /** Write a bone matrix (columns x, y, z, origin) into the slot's row. */
  #bone(slot, bone, x, y, z, o) {
    const d = this.bones.image.data, i = (slot * NBONES * 4 + bone * 4) * 4;
    d[i] = x.x; d[i + 1] = x.y; d[i + 2] = x.z; d[i + 3] = 0;
    d[i + 4] = y.x; d[i + 5] = y.y; d[i + 6] = y.z; d[i + 7] = 0;
    d[i + 8] = z.x; d[i + 9] = z.y; d[i + 10] = z.z; d[i + 11] = 0;
    d[i + 12] = o.x; d[i + 13] = o.y; d[i + 14] = o.z; d[i + 15] = 1;
  }

  /** A body frame (r, d, n) as a bone: +X right, +Y up, +Z back. */
  #frame(slot, bone, F, o, sc) {
    _x.copy(F.r).multiplyScalar(sc); _y.copy(F.d).multiplyScalar(sc); _z.copy(F.n).multiplyScalar(-sc);
    this.#bone(slot, bone, _x, _y, _z, o);
  }

  /**
   * A segment from joint a to joint b, modeled `ref` long: +Y along it (stretched to the real
   * length), +X the parent's right squared to the segment (stable through any swing but a
   * straight-out-sideways one), +Z = x × y (the knee's and the elbow pad's side).
   */
  #limb(slot, bone, a, b, ref, right, sc) {
    _t.subVectors(b, a);
    const len = _t.length();
    if (len < 1e-5) { _t.set(0, -1, 0); } else _t.divideScalar(len);
    _x.copy(right).addScaledVector(_t, -right.dot(_t));
    if (_x.lengthSq() < 1e-4) _x.crossVectors(_t, Math.abs(_t.y) < 0.9 ? UP : _X);
    _x.normalize();
    _z.crossVectors(_x, _t).normalize().multiplyScalar(sc);
    _y.copy(_t).multiplyScalar(Math.max(len, 1e-4) / ref);
    this.#bone(slot, bone, _x.multiplyScalar(sc), _y, _z, a);
  }

  /** Kit and paint for a look (role kit, faction, stencil number, status glow, highlight). */
  #style(look) {
    const kit = look.kit ?? DEFAULT_KIT;
    return {
      kit, team: look.team >= 1 && look.team <= 3 ? look.team : 0, number: look.number ?? 0,
      tint: look.highlight ? 1.12 : 1, em: look.status ?? _black, rim: look.rim ?? this.rims[look.team] ?? this.rims[0],
    };
  }

  /**
   * @param {ProceduralHumanoid} h  (or a corpse snapshot: j, F, scale, prop, capeInit)
   * @param {object} look  { team, kit, number, status: THREE.Color | null, flame: THREE.Color | null, highlight }
   * @param {number} lod   0 near, 1 mid
   */
  drawRig(h, look, lod = 0) {
    const j = h.j, F = h.F, sc = h.scale;
    if (!this.#visible(j.pelvis, 1.6 * sc + (h.prop?.length ?? 1))) return;
    if (this.slots >= this.max) return;
    const slot = this.slots++;
    this.drawn++;
    const st = this.#style(look);
    const near = lod === 0 && (!this.camera || this.camera.position.distanceTo(j.pelvis) < this.nearDist) ? 1 : 0;
    near ? this.stats.near++ : this.stats.mid++;

    // Bones.
    this.#frame(slot, BONE.pelvis, F.pelvis, j.pelvis, sc);
    this.#limb(slot, BONE.abdomen, j.pelvis, j.chestC, REF.abdomen * sc, F.chest.r, sc);
    this.#frame(slot, BONE.chest, F.chest, j.chestC, sc);
    this.#frame(slot, BONE.head, F.head, j.head, sc);
    for (let i = 0; i < 2; i++) {
      this.#limb(slot, BONE.upperArmL + i, j.shoulder[i], j.elbow[i], REF.upperArm * sc, F.chest.r, sc);
      this.#limb(slot, BONE.foreArmL + i, j.elbow[i], j.hand[i], REF.foreArm * sc, F.chest.r, sc);
      this.#limb(slot, BONE.thighL + i, j.hip[i], j.knee[i], REF.thigh * sc, F.pelvis.r, sc);
      this.#limb(slot, BONE.shinL + i, j.knee[i], j.ankle[i], REF.shin * sc, F.pelvis.r, sc);
      // Feet: yaw and pitch from the planter (toe up at heel strike, heel up at push-off).
      const yaw = j.footYaw[i], pitch = j.footPitch[i];
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      _z.set(-fx * cp, -sp, -fz * cp).multiplyScalar(sc);     // +Z toward the heel
      _y.set(-fx * sp, cp, -fz * sp).multiplyScalar(sc);      // the sole's normal
      _x.crossVectors(_y, _z).divideScalar(sc);
      this.#bone(slot, BONE.footL + i, _x, _y, _z, j.ankle[i]);
    }

    const pal = this.parts;
    const put = (p) => p.put(slot, st.team, st.number, st.tint, st.em, st.rim);
    put(pal.body[st.kit.body]?.[near] ?? pal.body.medium[near]);
    put(pal.helmet[st.kit.helmet]?.[near] ?? pal.helmet.medium[near]);
    if (st.kit.gear && pal.gear[st.kit.gear]) put(pal.gear[st.kit.gear][near]);

    // Weapon.
    const pr = h.prop;
    if (pr?.kind === 'gun') {
      const ws = h.e?.weapons?.current?.s;
      const arch = ws?.id?.startsWith('super_') ? 'super' : GUN_LENGTH[ws?.archetype] ? ws.archetype : 'assaultRifle';
      _x.crossVectors(pr.dir, pr.up).normalize().multiplyScalar(sc);
      _y.copy(pr.up).multiplyScalar(sc);
      _z.copy(pr.dir).multiplyScalar(-pr.length / GUN_LENGTH[arch]);
      this.#bone(slot, BONE.gun, _x, _y, _z, pr.base);
      put(pal.weapon[arch][near]);
      if (pr.glow > 0.02) {
        // Heat weapons glow along the barrel shroud as they heat up.
        _col.copy(look.flame ?? _col.set(st.team ? '#b98cff' : '#ffba3f')).multiplyScalar(0.4 + pr.glow * 2.5);
        _x.crossVectors(pr.dir, pr.up).normalize();
        this.#glowBox(_c.copy(pr.base).addScaledVector(pr.dir, pr.length * 0.7).addScaledVector(pr.up, 0.045 * sc), _x, pr.up, 0.04 * sc, 0.012 * sc, pr.length * 0.3, _col);
      }
    } else if (pr?.kind === 'blade') {
      _x.crossVectors(pr.dir, pr.up).normalize();
      _col.copy(look.flame ?? _col.set(st.team ? '#b98cff' : '#ffba3f')).multiplyScalar(1 + Math.min(3, pr.glow * 2));
      this.#glowBox(_c.copy(pr.base).addScaledVector(pr.dir, pr.length * 0.5 + 0.05 * sc), _x, pr.up, 0.014 * sc, 0.06 * sc, pr.length, _col);
      this.#glowBox(_c.copy(pr.base).addScaledVector(pr.dir, -0.05 * sc), _x, pr.up, 0.035 * sc, 0.035 * sc, 0.2 * sc, _col.set(0.02, 0.02, 0.025));
    }

    // Cape: three links between the verlet points.
    if (st.kit.cape !== false && h.capeInit && h.cape) {
      const pts = h.cape, C = F.chest;
      for (let i = 0; i < 3 && i < pts.length - 1; i++) {
        _t.subVectors(pts[i + 1], pts[i]);
        const len = _t.length();
        if (len < 1e-5) _t.set(0, -1, 0); else _t.divideScalar(len);
        _x.copy(C.r).addScaledVector(_t, -C.r.dot(_t));
        if (_x.lengthSq() < 1e-6) _x.copy(C.r);
        _x.normalize();
        _z.crossVectors(_x, _t).normalize().multiplyScalar(sc);
        _y.copy(_t).multiplyScalar(Math.max(len, 1e-4) / REF.cape);
        this.#bone(slot, BONE.cape0 + i, _x.multiplyScalar(sc), _y, _z, pts[i]);
      }
      put(pal.cape[near]);
    }
  }

  #glowBox(center, ax, ay, sx, sy, sz, color) {
    _z.crossVectors(ax, ay).normalize().multiplyScalar(sz);
    _m.makeBasis(_x.copy(ax).multiplyScalar(sx), _y.copy(ay).multiplyScalar(sy), _z);
    _m.setPosition(center);
    this.glow.put(_m, color);
  }

  /**
   * Far LOD: one small trooper, upright, crouched or lying along the body axis.
   * @param {Vector3} root  ground point
   * @param {object} pose   { yaw, height (m, standing 1.8), lying: bool, scale }
   */
  drawImpostor(root, pose, look) {
    if (!this.#visible(_c.copy(root).setY(root.y + 0.9), 1.4)) return;
    if (this.slots >= this.max) return;
    const slot = this.slots++;
    this.drawn++; this.stats.far++;
    const st = this.#style(look);
    const sc = pose.scale ?? 1;
    const fx = -Math.sin(pose.yaw), fz = -Math.cos(pose.yaw);
    if (pose.lying) {
      // Lying along the body axis: the figure's up becomes forward, its back faces the sky.
      _x.set(-fz, 0, fx).multiplyScalar(sc);
      _y.set(fx, 0, fz).multiplyScalar(sc);
      _z.set(0, 1, 0).multiplyScalar(sc);
      _c.copy(root).addScaledVector(_t.set(fx, 0, fz), -0.88 * sc);
      _c.y += 0.15 * sc;
    } else {
      _x.set(-fz, 0, fx).multiplyScalar(sc);
      _y.set(0, (pose.height / 1.8) * sc, 0);
      _z.set(-fx, 0, -fz).multiplyScalar(sc);
      _c.copy(root);
    }
    this.#bone(slot, 0, _x, _y, _z, _c);
    this.impostor.put(slot, st.team, st.number, st.tint, st.em, st.rim);
  }
}
