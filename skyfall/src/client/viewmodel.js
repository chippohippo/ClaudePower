// First-person weapon viewmodel rendered in its own pass (never clips into walls).
// Procedural animation stack: ADS blend, sway (mouse delta), bob (footsteps), sprint pose,
// slide tilt, recoil kick with spring recovery, reload / weapon switch / heal poses, muzzle flash.

import * as THREE from 'three';
import { WEAPONS } from '../shared/weapons.js';
import { RARITY } from '../shared/items.js';

const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);

function buildGun(id, tier) {
  const w = WEAPONS[id];
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: '#2a2e35', roughness: 0.45, metalness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: '#16181c', roughness: 0.5, metalness: 0.4 });
  const tint = new THREE.MeshStandardMaterial({ color: w.tint, roughness: 0.5, metalness: 0.2 });
  const rare = new THREE.MeshStandardMaterial({ color: RARITY[tier] || RARITY[0], emissive: RARITY[tier] || '#000', emissiveIntensity: tier > 0 ? 0.35 : 0 });
  const add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; g.add(m); return m; };
  const cls = w.cls;
  let barrelLen = 0.5, muzzleZ = -0.6;
  if (cls === 'Pistol') {
    add(B(0.07, 0.11, 0.32), body, 0, 0.03, -0.1);
    add(B(0.06, 0.16, 0.08), dark, 0, -0.08, 0.0, 0.25);
    add(B(0.04, 0.04, 0.12), dark, 0, 0.04, -0.3);
    add(B(0.072, 0.02, 0.2), tint, 0, 0.09, -0.12);
    if (id === 'viper') add(B(0.09, 0.09, 0.09), dark, 0, 0.02, -0.08);
    muzzleZ = -0.36;
  } else if (cls === 'Shotgun') {
    add(B(0.09, 0.12, 0.55), body, 0, 0, -0.2);
    add(B(0.06, 0.06, 0.55), dark, 0, 0.04, -0.6);
    add(B(0.08, 0.06, 0.3), tint, 0, -0.06, -0.55);
    add(B(0.07, 0.15, 0.28), dark, 0, -0.05, 0.22, 0.2);
    add(B(0.06, 0.13, 0.07), dark, 0, -0.11, 0.0, 0.3);
    muzzleZ = -0.9;
  } else if (cls === 'Sniper' || cls === 'Marksman') {
    add(B(0.08, 0.12, 0.65), body, 0, 0, -0.2);
    add(B(0.04, 0.04, cls === 'Sniper' ? 0.75 : 0.5), dark, 0, 0.02, cls === 'Sniper' ? -0.85 : -0.72);
    add(B(0.07, 0.14, 0.3), tint, 0, -0.02, 0.28);
    add(B(0.06, 0.13, 0.07), dark, 0, -0.11, 0.0, 0.3);
    add(B(0.06, 0.12, 0.08), dark, 0, -0.11, -0.2);
    const scope = add(new THREE.CylinderGeometry(0.035, 0.04, 0.32, 10), dark, 0, 0.11, -0.15);
    scope.rotation.x = Math.PI / 2;
    muzzleZ = cls === 'Sniper' ? -1.25 : -1.0;
  } else {
    // AR / SMG / LMG
    const len = cls === 'SMG' ? 0.42 : cls === 'LMG' ? 0.7 : 0.55;
    add(B(0.085, 0.13, len), body, 0, 0, -0.15);
    add(B(0.04, 0.04, 0.3), dark, 0, 0.02, -0.15 - len / 2 - 0.12);
    add(B(0.09, 0.05, len * 0.6), tint, 0, 0.08, -0.2);
    add(B(0.06, 0.13, 0.07), dark, 0, -0.11, 0.02, 0.3);
    const mag = add(B(0.06, cls === 'LMG' ? 0.12 : 0.2, 0.08), dark, 0, cls === 'LMG' ? -0.1 : -0.15, -0.2, -0.15);
    mag.name = 'mag';
    add(B(0.07, 0.11, 0.24), body, 0, -0.02, 0.22);
    if (cls === 'LMG') add(B(0.14, 0.14, 0.14), tint, 0, -0.1, -0.2);
    muzzleZ = -0.15 - len / 2 - 0.3;
  }
  // rarity stripe
  add(B(0.092, 0.015, 0.12), rare, 0, -0.035, -0.05);
  // iron sight / red dot frame
  add(B(0.05, 0.03, 0.04), dark, 0, 0.1, 0.02);
  g.userData.muzzleZ = muzzleZ;
  return g;
}

function buildArms() {
  const g = new THREE.Group();
  const sleeve = new THREE.MeshStandardMaterial({ color: '#30353d', roughness: 0.8 });
  const glove = new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.7 });
  const r = new THREE.Mesh(B(0.09, 0.09, 0.45), sleeve);
  r.position.set(0.05, -0.12, 0.28);
  r.rotation.x = 0.3;
  g.add(r);
  const rh = new THREE.Mesh(B(0.08, 0.1, 0.1), glove);
  rh.position.set(0.02, -0.08, 0.05);
  g.add(rh);
  const l = new THREE.Mesh(B(0.09, 0.09, 0.5), sleeve);
  l.position.set(-0.12, -0.12, -0.12);
  l.rotation.set(0.25, -0.5, 0);
  g.add(l);
  const lh = new THREE.Mesh(B(0.08, 0.08, 0.1), glove);
  lh.position.set(-0.03, -0.06, -0.33);
  g.add(lh);
  return g;
}

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight('#dfe9ff', '#4a4235', 1.4));
    const d = new THREE.DirectionalLight('#fff1d6', 1.6);
    d.position.set(-1, 2, 1);
    this.scene.add(d);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.gunHolder = new THREE.Group();
    this.root.add(this.gunHolder);
    this.arms = buildArms();
    this.gunHolder.add(this.arms);
    this.gun = null;
    this.gunId = null;
    // muzzle flash
    const fc = document.createElement('canvas');
    fc.width = fc.height = 64;
    const g = fc.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,230,1)');
    grd.addColorStop(0.25, 'rgba(255,210,120,0.9)');
    grd.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const flashTex = new THREE.CanvasTexture(fc);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.visible = false;
    this.gunHolder.add(this.flash);
    this.flashLight = new THREE.PointLight('#ffb050', 0, 3);
    this.gunHolder.add(this.flashLight);
    // state
    this.ads = 0;
    this.kick = { z: 0, rx: 0, vz: 0, vrx: 0, ry: 0, vry: 0 };
    this.sway = { x: 0, y: 0 };
    this.bobT = 0;
    this.sprint = 0;
    this.slide = 0;
    this.lower = 0;
    this.flashT = 0;
    this.reloadT = 0;
    this.reloadDur = 1;
    this.healT = 0;
  }

  setWeapon(id, tier) {
    const key = id ? id + ':' + tier : null;
    if (key === this.gunId) return;
    if (this.gun) this.gunHolder.remove(this.gun);
    this.gunId = key;
    this.gun = id ? buildGun(id, tier) : null;
    if (this.gun) {
      this.gunHolder.add(this.gun);
      this.flash.position.set(0, 0.02, this.gun.userData.muzzleZ);
      this.flashLight.position.copy(this.flash.position);
      this.lower = 1;
    }
    this.arms.visible = !!id;
  }

  fire(strength = 1) {
    this.kick.vz += 1.6 * strength;
    this.kick.vrx += 9 * strength;
    this.kick.vry += (Math.random() - 0.5) * 3 * strength;
    this.flashT = 0.05;
    this.flash.material.rotation = Math.random() * Math.PI;
    const s = 0.35 + Math.random() * 0.2;
    this.flash.scale.set(s, s, s);
  }

  startReload(dur) { this.reloadT = dur; this.reloadDur = dur; }
  cancelReload() { this.reloadT = 0; }

  update(dt, st) {
    // st: {ads, adsSpeed, sprint, speed, onGround, slide, mouseDX, mouseDY, healing, switching, aspect, fov}
    const k = 1 - Math.exp(-dt / Math.max(0.03, st.adsTime * 0.45));
    this.ads += ((st.ads ? 1 : 0) - this.ads) * k;
    this.sprint += ((st.sprint ? 1 : 0) - this.sprint) * Math.min(1, dt * 9);
    this.slide += ((st.slide ? 1 : 0) - this.slide) * Math.min(1, dt * 10);
    this.lower += ((st.healing || st.switching || st.downed ? 1 : 0) - this.lower) * Math.min(1, dt * 10);
    // sway
    const adsDamp = 1 - this.ads * 0.85;
    this.sway.x += (-st.mouseDX * 0.0009 * adsDamp - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (st.mouseDY * 0.0009 * adsDamp - this.sway.y) * Math.min(1, dt * 10);
    // bob
    if (st.onGround && !st.slide) this.bobT += dt * st.speed * 1.55;
    const bobAmt = Math.min(1, st.speed / 7) * (1 - this.ads * 0.9) * (st.onGround && !st.slide ? 1 : 0);
    const bx = Math.sin(this.bobT) * 0.018 * bobAmt, by = -Math.abs(Math.cos(this.bobT)) * 0.016 * bobAmt;
    // recoil springs
    const K = this.kick, stiff = 220, damp = 22;
    K.vz += (-stiff * K.z - damp * K.vz) * dt; K.z += K.vz * dt;
    K.vrx += (-stiff * K.rx - damp * K.vrx) * dt; K.rx += K.vrx * dt;
    K.vry += (-stiff * K.ry - damp * K.vry) * dt; K.ry += K.vry * dt;
    // positions
    const hip = { x: 0.2, y: -0.215, z: -0.62 }, ads = { x: 0, y: -0.102, z: -0.5 };
    let x = hip.x + (ads.x - hip.x) * this.ads, y = hip.y + (ads.y - hip.y) * this.ads, z = hip.z + (ads.z - hip.z) * this.ads;
    x += bx + this.sway.x; y += by + this.sway.y;
    y -= this.sprint * 0.04; x += this.sprint * 0.03;
    y -= this.lower * 0.35;
    z += K.z * (0.05 * (1 - this.ads * 0.5));
    let rx = K.rx * 0.012 * (1 - this.ads * 0.6), ry = K.ry * 0.01, rz = 0;
    rx += -this.sprint * 0.35; ry += this.sprint * 0.55; rz += this.sprint * 0.25;
    rz += this.slide * 0.35;
    // reload animation: tilt + dip
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      const p = 1 - Math.max(0, this.reloadT) / this.reloadDur;
      const e = Math.sin(Math.min(1, p) * Math.PI);
      rz += e * 0.6; rx += e * 0.25; y -= e * 0.06;
      const mag = this.gun && this.gun.getObjectByName('mag');
      if (mag) mag.position.y = -0.15 - (p > 0.2 && p < 0.6 ? 0.3 : 0);
    }
    this.gunHolder.position.set(x, y, z);
    this.gunHolder.rotation.set(rx + this.sway.y * 2, ry + this.sway.x * 2, rz);
    // flash
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    this.flashLight.intensity = this.flashT > 0 ? 6 : 0;
    this.camera.aspect = st.aspect;
    this.camera.fov = 58 - this.ads * 12;
    this.camera.updateProjectionMatrix();
    this.root.visible = !!this.gun && !st.hidden && !(st.scoped && this.ads > 0.92);
  }
}
