// First-person weapon viewmodel (v2), rendered in its own pass so it never clips into walls.
//
// Guns are assembled per class from parts: receiver, barrel/shroud, handguard, magazine (grows
// with extended-mag level), stock (bulks up with stock level), muzzle brake (barrel stabilizer),
// iron sights or an optic (holo with glowing reticle, or a tube scope). The optic's sight line
// decides the ADS position, so you really look down the sights.
//
// Animation stack: time-based eased ADS, inertial mouse sway, strafe roll, jump lift / landing
// dip, slide tilt, sprint pose, recoil spring + visual climb, pump/bolt cycling, magazine-out /
// magazine-in reloads, switch drop/raise, ejected brass and a layered muzzle flash.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { WEAPONS } from '../shared/weapons.js';
import { RARITY } from '../shared/items.js';
import { STYLE, toonify, addHulls } from './comic.js';

const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const smooth = (t) => t * t * (3 - 2 * t);

function reticleTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = g.fillStyle = '#ff3030';
  g.lineWidth = 3;
  if (kind === 'dot') { g.beginPath(); g.arc(32, 32, 4, 0, Math.PI * 2); g.fill(); }
  else {
    g.beginPath(); g.arc(32, 32, 16, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(32, 32, 3, 0, Math.PI * 2); g.fill();
    g.fillRect(31, 2, 2, 10); g.fillRect(31, 52, 2, 10); g.fillRect(2, 31, 10, 2); g.fillRect(52, 31, 10, 2);
  }
  return new THREE.CanvasTexture(c);
}
const RETICLES = {};

export function buildGun(id, tier = 0, att = null) {
  const w = WEAPONS[id];
  att = att || { mag: 0, barrel: 0, stock: 0, optic: null };
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: '#30353d', roughness: 0.4, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: '#17191d', roughness: 0.45, metalness: 0.5 });
  const tint = new THREE.MeshStandardMaterial({ color: w.tint, roughness: 0.45, metalness: 0.25 });
  const rc = RARITY[tier] || RARITY[0];
  const rare = new THREE.MeshStandardMaterial({ color: rc, emissive: rc, emissiveIntensity: tier > 0 ? 0.6 : 0.1 });
  const add = (geo, mat, x, y, z, rx = 0, name) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; if (name) m.name = name; g.add(m); return m; };
  const cyl = (r, len, mat, x, y, z, seg = 10) => { const geo = new THREE.CylinderGeometry(r, r, len, seg); geo.rotateX(Math.PI / 2); return add(geo, mat, x, y, z); };
  const cls = w.cls;
  let muzzleZ, barrelY = 0.02, topY = 0.07, len;

  // receiver + barrel per class
  if (cls === 'Pistol') {
    len = 0.3;
    add(B(0.07, 0.1, len), body, 0, 0.03, -0.1);
    add(B(0.072, 0.03, len * 0.95), tint, 0, 0.085, -0.1);
    add(B(0.06, 0.16, 0.08), dark, 0, -0.08, 0, 0.25, 'mag');
    cyl(0.018, 0.08, dark, 0, 0.04, -0.29);
    if (id === 'viper') { cyl(0.045, 0.08, dark, 0, 0.025, -0.06, 8); add(B(0.05, 0.05, 0.16), body, 0, 0.04, -0.25); }
    muzzleZ = -0.34; topY = 0.1; barrelY = 0.04;
  } else if (cls === 'Shotgun') {
    len = 0.55;
    add(B(0.09, 0.12, len), body, 0, 0, -0.2);
    cyl(0.03, 0.55, dark, 0, 0.035, -0.62);
    const pump = add(B(0.085, 0.07, 0.24), tint, 0, -0.045, -0.56, 0, 'pump');
    pump.userData.base = pump.position.z;
    add(B(0.07, 0.15, 0.28), dark, 0, -0.04, 0.22, 0.18, 'stock');
    add(B(0.06, 0.13, 0.07), dark, 0, -0.11, 0.0, 0.3);
    muzzleZ = -0.92;
  } else if (cls === 'Sniper' || cls === 'Marksman') {
    len = 0.65;
    add(B(0.08, 0.12, len), body, 0, 0, -0.2);
    cyl(0.022, cls === 'Sniper' ? 0.8 : 0.5, dark, 0, 0.02, cls === 'Sniper' ? -0.88 : -0.72);
    add(B(0.075, 0.07, 0.4), tint, 0, -0.03, -0.42);
    add(B(0.07, 0.14, 0.32), tint, 0, -0.02, 0.28, 0, 'stock');
    add(B(0.06, 0.13, 0.07), dark, 0, -0.11, 0.0, 0.3);
    add(B(0.055, 0.12, 0.08), dark, 0, -0.11, -0.2, -0.1, 'mag');
    if (cls === 'Sniper') { const bolt = add(B(0.03, 0.03, 0.06), body, 0.06, 0.04, 0.02, 0, 'bolt'); bolt.userData.base = 0.02; }
    muzzleZ = cls === 'Sniper' ? -1.3 : -1.0;
  } else {
    len = cls === 'SMG' ? 0.42 : cls === 'LMG' ? 0.72 : 0.56;
    add(B(0.085, 0.13, len), body, 0, 0, -0.15);
    add(B(0.09, 0.05, len * 0.62), tint, 0, 0.075, -0.2);
    const guard = add(B(0.08, 0.09, 0.26), dark, 0, 0.0, -0.15 - len / 2 - 0.08);
    guard.name = 'guard';
    cyl(0.02, 0.24, dark, 0, 0.02, -0.15 - len / 2 - 0.3);
    add(B(0.06, 0.13, 0.07), dark, 0, -0.11, 0.02, 0.3);
    const magH = (cls === 'LMG' ? 0.11 : 0.18) * (1 + (att.mag || 0) * 0.14);
    const mag = add(B(cls === 'LMG' ? 0.13 : 0.06, magH, cls === 'LMG' ? 0.13 : 0.08), cls === 'LMG' ? tint : dark, 0, -0.07 - magH / 2, -0.2, cls === 'LMG' ? 0 : -0.15, 'mag');
    mag.userData.base = mag.position.clone();
    add(B(0.07, 0.11, 0.24), body, 0, -0.02, 0.22, 0, 'stock');
    if (w.sound.zap) { // energy coils
      for (let i = 0; i < 3; i++) cyl(0.05, 0.02, new THREE.MeshStandardMaterial({ color: '#b7e34b', emissive: '#b7e34b', emissiveIntensity: 1.5 }), 0, 0.0, -0.35 - i * 0.06, 12);
    }
    muzzleZ = -0.15 - len / 2 - 0.43;
    topY = 0.1; // sights sit above the tinted top rail
  }
  // stock upgrades bulk up the stock
  const stock = g.getObjectByName('stock');
  if (stock && att.stock) { stock.scale.set(1 + att.stock * 0.05, 1 + att.stock * 0.07, 1 + att.stock * 0.06); stock.material = tint; }
  // barrel stabilizer: muzzle brake
  if (att.barrel) {
    const mb = cyl(0.034, 0.07 + att.barrel * 0.025, rare, 0, barrelY, muzzleZ - 0.03, 8);
    mb.name = 'brake';
    muzzleZ -= 0.08 + att.barrel * 0.025;
  }
  // rarity stripes
  add(B(0.092, 0.015, 0.14), rare, 0, -0.035, -0.06);
  add(B(0.092, 0.015, 0.06), rare, 0, 0.012, -0.32);

  // sights: optic if attached (or sniper default scope), otherwise iron sights
  let sightY;
  const optic = att.optic || (cls === 'Sniper' ? 'optic3' : null);
  if (optic === 'optic3') {
    cyl(0.038, 0.3, dark, 0, topY + 0.065, -0.12, 14);
    cyl(0.047, 0.05, body, 0, topY + 0.065, -0.29, 14);
    cyl(0.047, 0.05, body, 0, topY + 0.065, 0.03, 14);
    add(B(0.03, 0.05, 0.05), dark, 0, topY + 0.02, -0.12);
    sightY = topY + 0.065;
  } else if (optic) {
    // holographic sight: frame + glowing reticle on a glass pane
    const big = optic === 'optic2';
    const fh = big ? 0.075 : 0.06, fw = big ? 0.08 : 0.065;
    add(B(fw, 0.012, 0.09), dark, 0, topY + 0.006, -0.06);
    add(B(0.01, fh, 0.03), dark, -fw / 2, topY + fh / 2, -0.09);
    add(B(0.01, fh, 0.03), dark, fw / 2, topY + fh / 2, -0.09);
    add(B(fw, 0.01, 0.03), dark, 0, topY + fh, -0.09);
    const key = big ? 'ring' : 'dot';
    RETICLES[key] = RETICLES[key] || reticleTexture(key);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(fw * 0.9, fh * 0.9), new THREE.MeshBasicMaterial({ map: RETICLES[key], transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
    glass.position.set(0, topY + fh / 2, -0.09);
    g.add(glass);
    sightY = topY + fh / 2;
  } else {
    // iron sights: rear notch (two ears) + front post
    add(B(0.05, 0.012, 0.03), dark, 0, topY + 0.006, 0.02);
    add(B(0.012, 0.03, 0.02), dark, -0.016, topY + 0.027, 0.02);
    add(B(0.012, 0.03, 0.02), dark, 0.016, topY + 0.027, 0.02);
    const fz = Math.max(muzzleZ + 0.12, -0.6);
    add(B(0.02, topY + 0.02 - barrelY, 0.02), dark, 0, (topY + 0.02 + barrelY) / 2, fz); // front sight riser
    add(B(0.008, 0.02, 0.01), rare, 0, topY + 0.03, fz);
    sightY = topY + 0.033;
  }
  g.userData.muzzleZ = muzzleZ;
  g.userData.muzzleY = barrelY;
  g.userData.sightY = sightY;
  g.userData.cls = cls;
  return g;
}

function buildArms() {
  const g = new THREE.Group();
  const sleeve = new THREE.MeshStandardMaterial({ color: '#3a414b', roughness: 0.8 });
  const glove = new THREE.MeshStandardMaterial({ color: '#1e2126', roughness: 0.6 });
  const pad = new THREE.MeshStandardMaterial({ color: '#7d8590', roughness: 0.4, metalness: 0.3 });
  const r = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.38, 3, 8), sleeve);
  r.rotation.x = Math.PI / 2 - 0.65; r.position.set(0.07, -0.2, 0.24);
  g.add(r);
  const rh = new THREE.Mesh(B(0.08, 0.1, 0.1), glove); rh.position.set(0.02, -0.08, 0.05); g.add(rh);
  const rp = new THREE.Mesh(B(0.07, 0.04, 0.12), pad); rp.position.set(0.07, -0.08, 0.2); rp.rotation.x = -0.3; g.add(rp);
  const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.42, 3, 8), sleeve);
  l.rotation.set(Math.PI / 2 - 0.55, -0.7, 0); l.position.set(-0.16, -0.18, -0.14);
  g.add(l);
  const lh = new THREE.Mesh(B(0.08, 0.08, 0.1), glove); lh.position.set(-0.03, -0.06, -0.33); g.add(lh);
  g.userData.leftHand = lh;
  return g;
}

function flashTexture(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.translate(64, 64);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, 64);
  grd.addColorStop(0, 'rgba(255,255,240,1)');
  grd.addColorStop(0.2, color);
  grd.addColorStop(1, 'rgba(255,100,10,0)');
  g.fillStyle = grd;
  // star-shaped flash
  g.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, r = i % 2 ? 22 : 64;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.fill();
  return new THREE.CanvasTexture(c);
}

export class ViewModel {
  constructor(renderer) {
    this.scene = new THREE.Scene();
    if (renderer) {
      const pm = new THREE.PMREMGenerator(renderer);
      this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.6;
    }
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight('#dfe9ff', '#4a4235', 1.3));
    const d = new THREE.DirectionalLight('#fff1d6', 1.8);
    d.position.set(-1, 2, 1);
    this.scene.add(d);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.gunHolder = new THREE.Group();
    this.root.add(this.gunHolder);
    this.arms = buildArms();
    if (STYLE.comic) addHulls(toonify(this.arms));
    this.gunHolder.add(this.arms);
    this.gun = null;
    this.gunKey = null;
    // layered muzzle flash: a star sprite facing the camera + a side "cross" plane
    this.flashTexWarm = flashTexture('rgba(255,200,90,0.95)');
    this.flashTexEnergy = flashTexture('rgba(190,255,110,0.95)');
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTexWarm, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.visible = false;
    this.gunHolder.add(this.flash);
    this.flashSide = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.42), new THREE.MeshBasicMaterial({ map: this.flashTexWarm, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide }));
    this.flashSide.rotation.x = Math.PI / 2;
    this.flashSide.visible = false;
    this.gunHolder.add(this.flashSide);
    this.flashLight = new THREE.PointLight('#ffb050', 0, 3);
    this.gunHolder.add(this.flashLight);
    // ejected brass
    this.brass = [];
    const brassMat = new THREE.MeshStandardMaterial({ color: '#c99a3a', metalness: 0.9, roughness: 0.3 });
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.028, 6), brassMat);
      m.visible = false;
      this.root.add(m);
      this.brass.push({ m, v: new THREE.Vector3(), t: 0 });
    }
    this.brassI = 0;
    this.adsP = 0;
    this.ads = 0;
    this.kick = { z: 0, rx: 0, vz: 0, vrx: 0, ry: 0, vry: 0, roll: 0, vroll: 0 };
    this.sway = { x: 0, y: 0, vx: 0, vy: 0 };
    this.bobT = 0;
    this.sprint = 0;
    this.slide = 0;
    this.air = 0;
    this.lower = 1;
    this.roll = 0;
    this.lift = 0;
    this.land = 0;
    this.flashT = 0;
    this.reloadT = 0;
    this.reloadDur = 1;
    this.actionT = 0;
    this.sightY = 0.09;
  }

  buildGunForShowcase(id, tier, att) { return buildGun(id, tier, att); }

  setWeapon(id, tier, att) {
    const key = id ? `${id}:${tier}:${att ? `${att.mag}${att.barrel}${att.stock}${att.optic}` : ''}` : null;
    if (key === this.gunKey) return;
    const sameGun = this.gunKey && id && this.gunKey.startsWith(id + ':');
    if (this.gun) this.gunHolder.remove(this.gun);
    this.gunKey = key;
    this.gun = id ? buildGun(id, tier, att) : null;
    if (this.gun) {
      if (STYLE.comic) addHulls(toonify(this.gun));
      this.gunHolder.add(this.gun);
      const mz = this.gun.userData.muzzleZ, my = this.gun.userData.muzzleY;
      this.flash.position.set(0, my, mz - 0.05);
      this.flashSide.position.set(0, my, mz - 0.18);
      this.flashLight.position.set(0, my, mz);
      this.sightY = this.gun.userData.sightY;
      const energy = WEAPONS[id].sound.zap;
      this.flash.material.map = this.flashSide.material.map = energy ? this.flashTexEnergy : this.flashTexWarm;
      this.flashLight.color.set(energy ? '#b7ff6a' : '#ffb050');
      if (!sameGun) this.lower = 1; // draw animation (attachment swaps don't re-draw)
    }
    this.arms.visible = !!id;
  }

  fire(strength = 1) {
    this.kick.vz += 1.7 * strength;
    this.kick.vrx += 10 * strength;
    this.kick.vry += (Math.random() - 0.5) * 3.5 * strength;
    this.kick.vroll += (Math.random() - 0.5) * 4 * strength;
    this.flashT = 0.045;
    const s = (0.32 + Math.random() * 0.18) * Math.min(1.6, 0.8 + strength * 0.35);
    this.flash.scale.set(s, s, s);
    this.flash.material.rotation = Math.random() * Math.PI;
    this.flashSide.scale.set(1, 0.7 + strength * 0.3, 1);
    this.actionT = 0.5;
    if (this.gun && this.gun.userData.cls !== 'Shotgun' && this.gun.userData.cls !== 'Sniper') this._eject();
  }

  _eject() {
    const b = this.brass[this.brassI];
    this.brassI = (this.brassI + 1) % this.brass.length;
    b.m.visible = true;
    b.t = 0.6;
    this.gunHolder.updateMatrixWorld(true);
    b.m.position.set(0.05, 0.05, -0.1).applyMatrix4(this.gunHolder.matrixWorld);
    b.v.set(1.2 + Math.random() * 0.6, 1.4 + Math.random() * 0.6, 0.3 + Math.random() * 0.3);
    b.m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
  }

  startReload(dur) { this.reloadT = dur; this.reloadDur = dur; }
  cancelReload() { this.reloadT = 0; }

  update(dt, st) {
    // st: {ads, adsTime, sprint, speed, onGround, slide, mouseDX, mouseDY, healing, switching, downed,
    //      aspect, hidden, scoped, vSide, vy, landImpulse}
    // ADS: time-based with an eased curve, so every gun has a fixed, learnable ADS time
    const rate = dt / Math.max(0.05, st.adsTime || 0.2);
    this.adsP = Math.max(0, Math.min(1, this.adsP + (st.ads ? rate : -rate * 1.25)));
    this.ads = smooth(this.adsP);
    this.sprint += ((st.sprint ? 1 : 0) - this.sprint) * Math.min(1, dt * 9);
    this.slide += ((st.slide ? 1 : 0) - this.slide) * Math.min(1, dt * 10);
    this.air += ((!st.onGround && !st.slide ? 1 : 0) - this.air) * Math.min(1, dt * 6);
    this.lower += ((st.healing || st.switching || st.downed ? 1 : 0) - this.lower) * Math.min(1, dt * 9);
    const adsDamp = 1 - this.ads * 0.85;
    // inertial sway: spring toward the mouse-delta target, overshoots a little
    const S = this.sway;
    const tx = -st.mouseDX * 0.0011 * adsDamp, ty = st.mouseDY * 0.0011 * adsDamp;
    // springs are integrated in fixed 1/240 s substeps so they stay stable at any frame rate
    const steps = Math.min(48, Math.ceil(dt * 240)), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      S.vx += ((tx - S.x) * 160 - S.vx * 18) * h; S.x += S.vx * h;
      S.vy += ((ty - S.y) * 160 - S.vy * 18) * h; S.y += S.vy * h;
    }
    S.x = Math.max(-0.06, Math.min(0.06, S.x)); S.y = Math.max(-0.06, Math.min(0.06, S.y));
    // strafe roll and vertical motion
    this.roll += ((st.vSide || 0) * -0.012 * adsDamp - this.roll) * Math.min(1, dt * 8);
    this.lift += (Math.max(-1, Math.min(1, (st.vy || 0) / 8)) * 0.025 * adsDamp - this.lift) * Math.min(1, dt * 8);
    if (st.landImpulse) this.land = Math.min(0.06, this.land + st.landImpulse * 0.004);
    this.land *= Math.exp(-dt * 10);
    // footstep bob
    if (st.onGround && !st.slide) this.bobT += dt * st.speed * 1.55;
    const bobAmt = Math.min(1, st.speed / 7) * (1 - this.ads * 0.92) * (st.onGround && !st.slide ? 1 : 0);
    const bx = Math.sin(this.bobT) * 0.02 * bobAmt, by = -Math.abs(Math.cos(this.bobT)) * 0.018 * bobAmt;
    // recoil springs
    const K = this.kick, stiff = 240, damp = 21;
    for (let i = 0; i < steps; i++) {
      K.vz += (-stiff * K.z - damp * K.vz) * h; K.z += K.vz * h;
      K.vrx += (-stiff * K.rx - damp * K.vrx) * h; K.rx += K.vrx * h;
      K.vry += (-stiff * K.ry - damp * K.vry) * h; K.ry += K.vry * h;
      K.vroll += (-stiff * K.roll - damp * K.vroll) * h; K.roll += K.vroll * h;
    }
    // hip → ADS: ADS puts the sight line on the screen centre
    const hip = { x: 0.2, y: -0.215, z: -0.62 }, ads = { x: 0, y: -this.sightY, z: -0.57 };
    let x = hip.x + (ads.x - hip.x) * this.ads, y = hip.y + (ads.y - hip.y) * this.ads, z = hip.z + (ads.z - hip.z) * this.ads;
    x += bx + S.x; y += by + S.y;
    y += this.lift - this.land;
    y -= this.sprint * 0.045; x += this.sprint * 0.035;
    y -= this.slide * 0.03 * adsDamp; x -= this.slide * 0.03 * adsDamp; z += this.slide * 0.04 * adsDamp;
    y += this.air * 0.012 * Math.sin(performance.now() * 0.004) * adsDamp;
    y -= this.lower * 0.38;
    z += K.z * 0.055 * (1 - this.ads * 0.45);
    let rx = K.rx * 0.014 * (1 - this.ads * 0.55), ry = K.ry * 0.01, rz = K.roll * 0.01 + this.roll;
    rx += -this.sprint * 0.35; ry += this.sprint * 0.55; rz += this.sprint * 0.25;
    rz += this.slide * 0.38 * adsDamp;
    rx += this.lower * 0.6;
    // reload: tilt, dip and a real magazine out/in
    const mag = this.gun && this.gun.getObjectByName('mag');
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      const p = 1 - Math.max(0, this.reloadT) / this.reloadDur;
      const e = Math.sin(Math.min(1, p) * Math.PI);
      rz += e * 0.55; rx += e * 0.22; y -= e * 0.06;
      if (mag && mag.userData.base) {
        const out = p > 0.15 && p < 0.62 ? Math.min(1, (p - 0.15) / 0.08) * (p < 0.55 ? 1 : (0.62 - p) / 0.07) : 0;
        mag.position.y = mag.userData.base.y - out * 0.35;
        mag.visible = !(p > 0.25 && p < 0.45);
      }
    } else if (mag && mag.userData.base) { mag.position.copy(mag.userData.base); mag.visible = true; }
    // pump / bolt cycling after a shot
    this.actionT = Math.max(0, this.actionT - dt);
    const pump = this.gun && this.gun.getObjectByName('pump');
    if (pump) { const a = this.actionT > 0 && this.actionT < 0.35 ? Math.sin(((0.35 - this.actionT) / 0.35) * Math.PI) : 0; pump.position.z = pump.userData.base + a * 0.1; }
    const bolt = this.gun && this.gun.getObjectByName('bolt');
    if (bolt) { const a = this.actionT > 0 && this.actionT < 0.4 ? Math.sin(((0.4 - this.actionT) / 0.4) * Math.PI) : 0; bolt.position.z = bolt.userData.base + a * 0.08; rz += a * 0.15; }
    this.gunHolder.position.set(x, y, z);
    this.gunHolder.rotation.set(rx + S.y * 2.2, ry + S.x * 2.2, rz);
    // flash
    this.flashT -= dt;
    const fl = this.flashT > 0;
    this.flash.visible = fl;
    this.flashSide.visible = fl && this.ads < 0.5;
    this.flashLight.intensity = fl ? 7 : 0;
    // brass
    for (const b of this.brass) {
      if (b.t <= 0) continue;
      b.t -= dt;
      b.v.y -= 9 * dt;
      b.m.position.addScaledVector(b.v, dt);
      b.m.rotation.x += dt * 20; b.m.rotation.z += dt * 14;
      if (b.t <= 0) b.m.visible = false;
    }
    this.camera.aspect = st.aspect;
    this.camera.fov = 58 - this.ads * 12;
    this.camera.updateProjectionMatrix();
    this.root.visible = !!this.gun && !st.hidden && !(st.scoped && this.ads > 0.92);
  }
}
