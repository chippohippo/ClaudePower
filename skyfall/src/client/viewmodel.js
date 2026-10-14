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
import { assets, GUN_CLASS_LEN } from './assets.js';
import { buildProceduralGun, setGunAmmo } from './gunmodels.js';
import { FpArms } from './fparms.js';
export { setGunAmmo };

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
// "Looking Glass" reticle: green bar — chevron — bar
function glassReticle() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = '#3dff6a'; g.lineWidth = 5; g.lineCap = 'round';
  g.shadowColor = '#3dff6a'; g.shadowBlur = 6;
  g.beginPath(); g.moveTo(22, 58); g.lineTo(50, 58); g.moveTo(78, 58); g.lineTo(106, 58); g.stroke();
  g.lineWidth = 4;
  g.beginPath(); g.moveTo(56, 70); g.lineTo(64, 62); g.lineTo(72, 70); g.moveTo(64, 63); g.lineTo(64, 78); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const RETICLES = {};

// Barrel height of an imported gun: the mean height of the vertices in its front-most 4 cm.
function muzzleHeight(model, box) {
  const v = new THREE.Vector3();
  let sum = 0, n = 0;
  model.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      if (v.z < box.min.z + 0.04) { sum += v.y; n++; }
    }
  });
  return n ? sum / n : null;
}

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
  // imported model (public/assets): sized per class, rear of the gun at the grip, barrel along -Z.
  // Muzzle / sight heights come from the manifest or the model's bounds; optics still mount on top.
  const imp = assets.gun(id, GUN_CLASS_LEN[cls]);
  let imported = false;
  if (imp) {
    const model = imp.root, def = imp.def;
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    // with a known grip position the pistol grip sits at the origin (in the hand), else the rear does
    const shift = def.grip != null ? -(box.min.z + def.grip * size.z) : 0.14 - box.max.z; // grip / fore: fraction of the length from the muzzle
    model.position.z += shift;
    g.add(model);
    len = size.z;
    muzzleZ = def.muzzle ? def.muzzle[2] : box.min.z + shift;
    if (def.fore != null) g.userData.fore = Math.max(0.05, -(box.min.z + def.fore * size.z + shift));
    if (def.scopeY != null) g.userData.scopeY = box.min.y + def.scopeY * size.y;
    barrelY = def.muzzle ? def.muzzle[1] : muzzleHeight(model, box) ?? (box.min.y + box.max.y) / 2 + size.y * 0.15;
    topY = def.sightY ?? box.max.y;
    imported = true;
  } else {
    const built = buildProceduralGun(w, id, att, rc, tier);
    for (const c of [...built.group.children]) g.add(c);
    ({ len, muzzleZ, topY } = built);
    barrelY = built.barrelY;
    g.userData.fore = built.fore;
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

  // sights: optic if attached (or sniper default scope), otherwise iron sights
  let sightY;
  const optic = att.optic || (cls === 'Sniper' && g.userData.scopeY == null ? 'optic3' : null);
  if (optic === 'optic3') {
    cyl(0.038, 0.3, dark, 0, topY + 0.065, -0.12, 14);
    cyl(0.047, 0.05, body, 0, topY + 0.065, -0.29, 14);
    cyl(0.047, 0.05, body, 0, topY + 0.065, 0.03, 14);
    add(B(0.03, 0.05, 0.05), dark, 0, topY + 0.02, -0.12);
    sightY = topY + 0.065;
  } else if (cls !== 'Sniper') {
    // "Looking Glass" sight on every non-sniper gun (with or without a 1x/2x optic attached): a side
    // body with a battery tube, an open hook-shaped ring and a glowing green bar–chevron–bar reticle
    const k = cls === 'Pistol' ? 0.7 : 1;
    const R = 0.034 * k, by = topY + 0.012 * k, cy = by + 0.012 * k + R, z = -0.07 * k;
    add(B(0.03 * k, 0.018 * k, 0.07 * k), dark, 0, by, z + 0.01 * k); // mount on the rail
    add(B(0.02 * k, 0.022 * k, 0.04 * k), dark, -0.03 * k, by + 0.012 * k, z + 0.01 * k); // side body
    const bat = new THREE.CylinderGeometry(0.008 * k, 0.008 * k, 0.045 * k, 12); bat.rotateX(Math.PI / 2);
    add(bat, body, -0.036 * k, by + 0.026 * k, z); // battery tube
    const ringGeo = new THREE.TorusGeometry(R, 0.0022 * k, 6, 40, (265 / 180) * Math.PI);
    const ring = add(ringGeo, dark, 0, cy, z);
    ring.rotation.z = (-50 / 180) * Math.PI; // gap at the lower right, left end runs down into the body
    add(B(0.003 * k, 0.012 * k, 0.003 * k), rare, 0, by + 0.014 * k, z - 0.03 * k); // little front post
    RETICLES.glass = RETICLES.glass || glassReticle();
    const ret = new THREE.Mesh(new THREE.PlaneGeometry(R * 1.3, R * 1.3), new THREE.MeshBasicMaterial({ map: RETICLES.glass, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    ret.position.set(0, cy, z);
    g.add(ret);
    sightY = cy;
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
  } else if (imported) {
    sightY = g.userData.scopeY ?? topY; // the model's own scope, iron sights or top rail
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

// First-person arms: tactical sleeves, forearm guards and gloved hands with jointed fingers
// wrapped around the pistol grip (right) and the handguard (left). setFore(z) moves the left
// hand to the current gun's handguard.
function buildArms() {
  const g = new THREE.Group();
  const sleeve = new THREE.MeshStandardMaterial({ color: '#2f3329', roughness: 0.92 });
  const cuff = new THREE.MeshStandardMaterial({ color: '#2c3036', roughness: 0.7 });
  const glove = new THREE.MeshStandardMaterial({ color: '#23262b', roughness: 0.75 });
  const knuckle = new THREE.MeshStandardMaterial({ color: '#3d434c', roughness: 0.5, metalness: 0.2 });
  const plate = new THREE.MeshStandardMaterial({ color: '#6a717b', roughness: 0.35, metalness: 0.45 });
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // a capsule limb from a to b
  const limb = (a, b, r, mat, parent = g) => {
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len - r * 2), 4, 10), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
    parent.add(m);
    return m;
  };
  // hand: palm + 4 curled fingers + thumb, built around its own origin (grip contact point)
  const hand = (side) => {
    const h = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.075, 0.07), glove);
    palm.position.set(side * 0.022, -0.005, 0.0);
    h.add(palm);
    const kn = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.06, 0.05), knuckle);
    kn.position.set(side * 0.038, 0.0, -0.005);
    h.add(kn);
    for (let i = 0; i < 4; i++) {
      const y = 0.025 - i * 0.019;
      limb(V(side * 0.03, y, -0.03), V(side * 0.005, y, -0.05), 0.0085, glove, h);
      limb(V(side * 0.005, y, -0.05), V(-side * 0.02, y - 0.004, -0.04), 0.008, glove, h);
    }
    limb(V(side * 0.03, 0.035, 0.02), V(-side * 0.012, 0.045, -0.015), 0.009, glove, h); // thumb
    return h;
  };
  // right arm: shoulder off-screen bottom-right → wrist at the grip
  const rWrist = V(0.035, -0.09, 0.07);
  limb(V(0.16, -0.32, 0.42), rWrist, 0.05, sleeve);
  limb(V(0.1, -0.2, 0.24), rWrist.clone().add(V(0.005, 0.005, 0.02)), 0.042, cuff);
  const rp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.11), plate);
  rp.position.set(0.075, -0.12, 0.16); rp.rotation.x = -0.55;
  g.add(rp);
  const rh = hand(1);
  rh.position.set(0.0, -0.06, 0.02); rh.rotation.x = 0.35;
  g.add(rh);
  // left arm: rebuilt per gun so the hand sits on that gun's handguard
  const left = new THREE.Group();
  g.add(left);
  g.userData.setFore = (fz) => {
    left.clear();
    const hz = -Math.max(0.05, fz), wrist = V(-0.045, -0.075, hz + 0.06);
    limb(V(-0.22, -0.34, 0.1), wrist, 0.04, sleeve, left);
    limb(V(-0.12, -0.17, hz + 0.18), wrist.clone().add(V(0, 0, 0.02)), 0.036, cuff, left);
    const lh = hand(-1);
    lh.position.set(-0.012, -0.045, hz);
    lh.rotation.set(0.2, -0.35, -0.5);
    left.add(lh);
    g.userData.leftHand = lh;
  };
  g.userData.setFore(0.33);
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
      this.scene.environment = assets.hdri ? pm.fromEquirectangular(assets.hdri).texture : pm.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.85;
    }
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight('#dfe9ff', '#4a4235', 1.3));
    const d = new THREE.DirectionalLight('#fff1d6', 1.8);
    d.position.set(-1, 2, 1);
    this.scene.add(d);
    // cool rim from behind-right picks out gun edges and knuckles against bright skies
    const rim = new THREE.DirectionalLight('#cfe0ff', 1.1);
    rim.position.set(1.5, 0.6, -2);
    this.scene.add(rim);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.gunHolder = new THREE.Group();
    this.root.add(this.gunHolder);
    // imported first-person arms (manifest "arms") or the procedural pair
    const fa = assets.fpArms();
    if (fa) {
      this.arms = fa.root;
      this.armsMixer = new THREE.AnimationMixer(fa.model);
      const idle = fa.clips.find((c) => /idle/i.test(c.name)) || fa.clips[0];
      if (idle) this.armsMixer.clipAction(idle).play();
      if (STYLE.comic) addHulls(this.arms);
    } else {
      this.arms = buildArms();
      if (STYLE.comic) addHulls(toonify(this.arms));
    }
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

  // first-person arms from the local legend's body (replaces the procedural pair)
  setLegend(id) {
    if (this.legend === id) return;
    this.legend = id;
    const fa = FpArms.create(id);
    if (!fa) return;
    if (this.fp) this.root.remove(this.fp.root);
    if (this.arms) this.gunHolder.remove(this.arms);
    this.fp = fa;
    this.arms = new THREE.Group();          // keeps the setWeapon / visibility code paths happy
    this.root.add(fa.root);
  }

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
      if (this.arms.userData.setFore) {
        this.arms.userData.setFore(this.gun.userData.fore ?? (this.gun.userData.cls === 'Pistol' ? 0.02 : 0.33));
        if (STYLE.comic) addHulls(toonify(this.arms));
      }
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
    if (this.fp) this.fp.root.visible = !!id;
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
    if (this.armsMixer) this.armsMixer.update(dt);
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
    const hip = { x: 0.19, y: -0.205, z: -0.54 }, ads = { x: 0, y: -this.sightY, z: -0.57 };
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
    if (this.fp && this.gun) {
      // reload: the support hand leaves the handguard for the magazine well and back
      let left = null;
      if (this.reloadT > 0 && mag && mag.userData.base) {
        const p = 1 - Math.max(0, this.reloadT) / this.reloadDur;
        const w = p < 0.12 ? p / 0.12 : p > 0.8 ? Math.max(0, (1 - p) / 0.2) : 1;
        this.gunHolder.updateMatrixWorld(true);
        left = mag.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(-0.03, -0.09 - (p > 0.2 && p < 0.6 ? 0.18 * Math.sin((p - 0.2) / 0.4 * Math.PI) : 0), 0.04));
        left.w = w;
      }
      this.fp.update(this.gunHolder, this.gun.userData.fore ?? 0.33, this.gun.userData.cls === 'Pistol', left, 1 - this.lower * 0.5);
    }
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
