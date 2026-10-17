// DropViews: the guns lying on the ground (WeaponDrops: dropped by the fallen, a cache hidden in
// a civilian's shelter). Each is its archetype's gun from the trooper kit in its army's paint,
// lying on its side where it fell, with a faint pulsing glint on the ground round it so a
// civilian's eye (and yours) can find it in the rubble. Rebuilt from the list every frame (a few
// dozen at most).

import * as THREE from 'three';
import { GUN_LENGTH } from '../render/TrooperKit.js';
import { paintMaterial } from '../render/TrooperMaterial.js';

const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _t = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class DropViews {
  /**
   * @param {THREE.Scene} scene
   * @param {CombatWorld} world  (world.drops: WeaponDrops; null until the city's people arrive)
   * @param {object} o { kit: the trooper kit (CrowdRenderer.kit), palette, max, glint: colour }
   */
  constructor(scene, world, { kit, palette, max = 64, glint = '#ffd98a' } = {}) {
    this.world = world; this.max = max; this.time = 0;
    this.mats = [0, 1].map((team) => paintMaterial(palette, { team, number: 0 }));
    this.meshes = {};
    for (const arch of Object.keys(GUN_LENGTH)) {
      const geo = kit.weapon[arch]?.[0];
      if (!geo) continue;
      this.meshes[arch] = this.mats.map((mat) => {
        const m = new THREE.InstancedMesh(geo, mat, max);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
        scene.add(m);
        return m;
      });
    }
    const ring = new THREE.RingGeometry(0.5, 0.62, 28).rotateX(-Math.PI / 2);
    this.glint = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ color: glint, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), max);
    this.glint.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.glint.count = 0; this.glint.frustumCulled = false; this.glint.renderOrder = 3;
    scene.add(this.glint);
  }

  update(dt) {
    this.time += dt;
    const list = this.world.drops?.list ?? [];
    for (const pair of Object.values(this.meshes)) for (const m of pair) m.count = 0;
    let g = 0;
    for (const d of list) {
      const arch = this.meshes[d.spec.archetype] ? d.spec.archetype : 'assaultRifle', team = /^void/.test(d.spec.id ?? '') ? 1 : 0;
      const mesh = this.meshes[arch]?.[team];
      if (!mesh || mesh.count >= this.max) continue;
      // On its side (its up turned flat), centred on where it lies, turned its own way.
      const len = GUN_LENGTH[arch] ?? 0.8;
      _t.makeTranslation(0, 0, len / 2);
      _r.makeRotationZ(Math.PI / 2);
      _m.makeRotationY(d.yaw).multiply(_r).multiply(_t);
      _m.setPosition(d.pos.x, d.pos.y + 0.035, d.pos.z);
      mesh.setMatrixAt(mesh.count++, _m);
      // The glint: a slow pulse, each its own phase.
      const k = 0.85 + 0.25 * Math.sin(this.time * 2.6 + d.id * 1.7);
      _m.compose(_p.set(d.pos.x, d.pos.y + 0.03, d.pos.z), _q.setFromAxisAngle(UP, d.yaw), _s.set(k, 1, k));
      this.glint.setMatrixAt(g++, _m);
    }
    for (const pair of Object.values(this.meshes)) for (const m of pair) if (m.count) m.instanceMatrix.needsUpdate = true;
    this.glint.count = g;
    if (g) this.glint.instanceMatrix.needsUpdate = true;
  }
}
