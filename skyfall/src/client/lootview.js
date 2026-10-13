// Ground loot rendering: a pooled set of meshes assigned to the nearest items each refresh, with
// rarity-coloured glow discs and gentle bob/spin so loot reads instantly in a hot drop.

import * as THREE from 'three';
import { RARITY, itemRarity } from '../shared/items.js';
import { AMMO } from '../shared/weapons.js';
import { SHIELD_COLORS } from '../shared/constants.js';

const POOL = 140;
const GEOS = {
  w: new THREE.BoxGeometry(0.12, 0.16, 0.8),
  a: new THREE.BoxGeometry(0.28, 0.2, 0.2),
  c: new THREE.CylinderGeometry(0.1, 0.1, 0.3, 8),
  g: new THREE.SphereGeometry(0.11, 10, 8),
  armor: new THREE.BoxGeometry(0.42, 0.45, 0.2),
  helmet: new THREE.SphereGeometry(0.17, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.6),
  pack: new THREE.BoxGeometry(0.36, 0.4, 0.2),
  x: new THREE.BoxGeometry(0.16, 0.08, 0.2),
};
const discGeo = new THREE.CircleGeometry(0.45, 20);
discGeo.rotateX(-Math.PI / 2);

export class LootView {
  constructor(scene) {
    this.scene = scene;
    this.items = new Map();
    this.pool = [];
    this.mats = new Map();
    for (let i = 0; i < POOL; i++) {
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(GEOS.w, this._mat('#fff'));
      mesh.castShadow = true;
      const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      disc.position.y = 0.03;
      g.add(mesh, disc);
      g.visible = false;
      g.userData = { mesh, disc, id: 0 };
      scene.add(g);
      this.pool.push(g);
    }
    this.refreshT = 0;
    this.highlight = 0;
  }

  _mat(color, emissive = 0) {
    const k = color + emissive;
    if (!this.mats.has(k)) this.mats.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3, emissive: color, emissiveIntensity: emissive }));
    return this.mats.get(k);
  }

  set(list) { this.items.clear(); for (const it of list) this.items.set(it.id, it); this.refreshT = 0; }
  add(list) { for (const it of list) this.items.set(it.id, it); this.refreshT = 0; }
  remove(ids) { for (const id of ids) this.items.delete(id); this.refreshT = 0; }

  update(dt, time, cx, cz) {
    this.refreshT -= dt;
    if (this.refreshT <= 0) {
      this.refreshT = 0.3;
      const near = [];
      for (const it of this.items.values()) {
        const d = (it.x - cx) ** 2 + (it.z - cz) ** 2;
        if (d < 55 * 55) near.push([d, it]);
      }
      near.sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < POOL; i++) {
        const g = this.pool[i];
        const it = near[i] && near[i][1];
        if (!it) { g.visible = false; g.userData.id = 0; continue; }
        g.visible = true;
        if (g.userData.id !== it.id) {
          g.userData.id = it.id;
          const [t, sub] = it.item.split(':');
          const key = t === 'w' || t === 'a' || t === 'c' || t === 'g' || t === 'x' ? t : it.item;
          g.userData.mesh.geometry = GEOS[key] || GEOS.x;
          const rar = itemRarity(it.item, it.tier);
          let col = RARITY[rar];
          if (t === 'a') col = AMMO[sub].color;
          if (it.item === 'armor') col = SHIELD_COLORS[it.tier];
          if (t === 'c') col = sub.includes('cell') || sub === 'battery' ? '#3fa9ff' : sub === 'phoenix' ? '#ff9f1c' : '#ff5a5a';
          g.userData.mesh.material = this._mat(col, 0.25);
          g.userData.disc.material.color.set(RARITY[rar]);
          g.position.set(it.x, it.y, it.z);
          g.userData.phase = (it.id * 1.7) % 6;
        }
      }
    }
    for (const g of this.pool) {
      if (!g.visible) continue;
      const m = g.userData.mesh;
      m.position.y = 0.3 + Math.sin(time * 2 + g.userData.phase) * 0.05;
      m.rotation.y = time * 0.8 + g.userData.phase;
      g.userData.disc.material.opacity = g.userData.id === this.highlight ? 0.9 : 0.3;
    }
  }
}
