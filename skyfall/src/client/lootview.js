// Ground loot rendering: a pooled set of meshes assigned to the nearest items each refresh, with
// rarity-coloured glow discs and gentle bob/spin so loot reads instantly in a hot drop.

import * as THREE from 'three';
import { RARITY, itemRarity, itemName } from '../shared/items.js';
import { buildGun } from './viewmodel.js';
import { AMMO } from '../shared/weapons.js';
import { SHIELD_COLORS } from '../shared/constants.js';
import { STYLE, toonify } from './comic.js';

const POOL = 140;
const GEOS = {
  w: new THREE.BoxGeometry(0.12, 0.16, 0.8),
  a: new THREE.BoxGeometry(0.28, 0.2, 0.2),
  c: new THREE.CylinderGeometry(0.1, 0.1, 0.3, 8),
  g: new THREE.SphereGeometry(0.11, 10, 8),
  armor: new THREE.BoxGeometry(0.42, 0.45, 0.2),
  helmet: new THREE.SphereGeometry(0.17, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.6),
  pack: new THREE.BoxGeometry(0.36, 0.4, 0.2),
  kd: new THREE.CylinderGeometry(0.26, 0.26, 0.05, 6),
  x: new THREE.BoxGeometry(0.16, 0.08, 0.2),
};
const discGeo = new THREE.CircleGeometry(0.45, 20);
discGeo.rotateX(-Math.PI / 2);
// weapons get a light beam in their rarity colour so they read from across a POI
const beamGeo = new THREE.CylinderGeometry(0.035, 0.09, 3.2, 8, 1, true);
beamGeo.translate(0, 1.6, 0);

// real gun models on the floor (one cached template per gun + rarity, cloned per slot)
const GUNS = new Map();
function gunModel(id, tier) {
  const k = id + ':' + tier;
  if (!GUNS.has(k)) {
    const g = buildGun(id, tier);
    const box = new THREE.Box3().setFromObject(g);
    const c = box.getCenter(new THREE.Vector3());
    for (const ch of g.children) ch.position.sub(c);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    GUNS.set(k, g);
  }
  return GUNS.get(k).clone();
}

// name labels ("TALON AR", "LIGHT AMMO ×60") as sprites, cached per text + colour
const LABELS = new Map();
function labelMat(text, color) {
  const k = text + color;
  if (!LABELS.has(k)) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 96;
    const x = c.getContext('2d');
    x.font = '600 44px Rajdhani, "Segoe UI", sans-serif';
    const w = Math.min(500, x.measureText(text).width + 44);
    x.fillStyle = 'rgba(12,14,18,0.72)'; x.fillRect((512 - w) / 2, 14, w, 68);
    x.fillStyle = color; x.fillRect((512 - w) / 2, 14, 6, 68);
    x.fillStyle = '#f2f4f7'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 256 + 3, 50);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    LABELS.set(k, new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  }
  return LABELS.get(k);
}

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
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
      const label = new THREE.Sprite(labelMat(' ', '#fff'));
      label.scale.set(1.5, 0.28, 1); label.position.y = 0.95; label.renderOrder = 10;
      g.add(mesh, disc, beam, label);
      g.visible = false;
      g.userData = { mesh, disc, beam, label, gun: null, id: 0 };
      scene.add(g);
      this.pool.push(g);
    }
    this.refreshT = 0;
    this.highlight = 0;
  }

  _mat(color, emissive = 0) {
    const k = color + emissive;
    if (!this.mats.has(k)) {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3, emissive: color, emissiveIntensity: emissive });
      this.mats.set(k, STYLE.comic ? new THREE.MeshToonMaterial({ color, emissive: color, emissiveIntensity: emissive * 0.8 }) : m);
    }
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
          // weapons: the actual gun model + rarity beam instead of a placeholder box
          if (g.userData.gun) { g.remove(g.userData.gun); g.userData.gun = null; }
          g.userData.mesh.visible = t !== 'w';
          g.userData.beam.visible = t === 'w';
          if (t === 'w') {
            g.userData.gun = gunModel(sub, it.tier || 0);
            g.add(g.userData.gun);
            g.userData.beam.material.color.set(RARITY[rar]);
          }
          const name = (itemName(it.item, it.tier) + (it.n > 1 ? ` ×${it.n}` : '')).toUpperCase();
          g.userData.label.material = labelMat(name, RARITY[rar]);
          g.position.set(it.x, it.y, it.z);
          g.userData.phase = (it.id * 1.7) % 6;
        }
      }
    }
    for (const g of this.pool) {
      if (!g.visible) continue;
      const m = g.userData.gun || g.userData.mesh;
      m.position.y = 0.3 + Math.sin(time * 2 + g.userData.phase) * 0.05;
      m.rotation.y = time * 0.8 + g.userData.phase;
      const hi = g.userData.id === this.highlight;
      g.userData.disc.material.opacity = hi ? 0.9 : 0.3;
      // names show up close, and always on the item you're aiming at
      const d2 = (g.position.x - cx) ** 2 + (g.position.z - cz) ** 2;
      g.userData.label.visible = hi || d2 < 9 * 9;
      g.userData.label.scale.set(hi ? 1.9 : 1.4, hi ? 0.36 : 0.26, 1);
    }
  }
}
