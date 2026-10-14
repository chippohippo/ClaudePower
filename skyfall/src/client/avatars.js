// Third-person character models (v2). Stylised, chunky silhouettes that stay readable at range:
// a tapered armoured torso, capsule limbs, a helmet with an emissive visor, and a legend-specific
// silhouette kit (fins, hood, med-pack, pauldrons, sensor dish, gas tanks, beret, jetpack) so
// every legend is identifiable from its outline alone.
//
// Animation is procedural: run cycle with arm counter-swing, strafing, crouch, slide, airborne,
// skydive, mantle, a knockdown stagger into a crawl, healing, idle breathing and an
// ability-cast gesture. Phase ghosting and wall-hack reveal overlays are included.

import * as THREE from 'three';
import { LEGENDS } from '../shared/legends.js';
import { WEAPONS } from '../shared/weapons.js';
import { SHIELD_COLORS } from '../shared/constants.js';
import { STYLE, toonify } from './comic.js';

const SQUAD_ACCENT = '#38e8ff';

function taper(wTop, wBot, h, d) {
  const g = new THREE.CylinderGeometry(1, 1, h, 4, 1);
  g.rotateY(Math.PI / 4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), k = y > 0 ? wTop : wBot;
    p.setX(i, (p.getX(i) * (k / 2)) / 0.7071);
    p.setZ(i, (p.getZ(i) * (d / 2)) / 0.7071);
  }
  g.computeVertexNormals();
  return g;
}

const GEO = {
  torso: taper(0.62, 0.46, 0.6, 0.36),
  pelvis: new THREE.BoxGeometry(0.44, 0.22, 0.28),
  helmet: new THREE.IcosahedronGeometry(0.19, 1),
  visor: new THREE.BoxGeometry(0.3, 0.09, 0.07),
  upperArm: new THREE.CapsuleGeometry(0.075, 0.26, 3, 6),
  foreArm: new THREE.CapsuleGeometry(0.07, 0.24, 3, 6),
  thigh: new THREE.CapsuleGeometry(0.1, 0.34, 3, 6),
  shin: new THREE.CapsuleGeometry(0.085, 0.36, 3, 6),
  boot: new THREE.BoxGeometry(0.15, 0.1, 0.26),
  belt: new THREE.BoxGeometry(0.47, 0.05, 0.3),
  pack: new THREE.BoxGeometry(0.36, 0.4, 0.16),
  gunBody: new THREE.BoxGeometry(0.07, 0.13, 0.5),
  gunBarrel: new THREE.CylinderGeometry(0.022, 0.022, 0.32, 6),
};
GEO.upperArm.translate(0, -0.17, 0);
GEO.foreArm.translate(0, -0.16, 0);
GEO.thigh.translate(0, -0.21, 0);
GEO.shin.translate(0, -0.22, 0);
GEO.gunBarrel.rotateX(Math.PI / 2);

const mats = {};
const mat = (key, make) => mats[key] || (mats[key] = make());
const dark = () => mat('dark', () => new THREE.MeshStandardMaterial({ color: '#3d434d', roughness: 0.75, metalness: 0.05 }));
const armor = () => mat('armor', () => new THREE.MeshStandardMaterial({ color: '#8b939e', roughness: 0.4, metalness: 0.25 }));
const gunMat = () => mat('gun', () => new THREE.MeshStandardMaterial({ color: '#1b1e24', roughness: 0.35, metalness: 0.7 }));
const legendMat = (id) => mat('lg' + id, () => new THREE.MeshStandardMaterial({ color: LEGENDS[id].color, roughness: 0.5, metalness: 0.15 }));
const glowMat = (c) => mat('glow' + c, () => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.6, roughness: 0.4 }));
const phaseMat = new THREE.MeshBasicMaterial({ color: '#b48bff', transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
const revealMat = new THREE.MeshBasicMaterial({ color: '#ff2a2a', transparent: true, opacity: 0.55, depthTest: false, depthWrite: false });

function nameTag(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px Rajdhani, Arial';
  g.textAlign = 'center';
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(0,0,0,0.7)';
  g.strokeText(text, 128, 42);
  g.fillStyle = color;
  g.fillText(text, 128, 42);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(2.4, 0.6, 1);
  s.renderOrder = 10;
  return s;
}

// Legend silhouette kits: added to torso/head so the outline alone says who it is.
function legendKit(id, torso, head, mk) {
  const L = LEGENDS[id], lm = legendMat(id), glow = glowMat(L.color);
  switch (id) {
    case 'jolt': // mohawk fins + stim injector
      for (let i = 0; i < 3; i++) { const f = mk(new THREE.ConeGeometry(0.06, 0.28 - i * 0.04, 4), glow, head); f.position.set(0, 0.2, -0.08 + i * 0.09); f.rotation.x = 0.5; }
      mk(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 6), glow, torso).position.set(0.22, 0.05, -0.2);
      break;
    case 'phantom': { // hood + tattered back plate
      const hood = mk(new THREE.ConeGeometry(0.3, 0.6, 6, 1, true), lm, head);
      hood.position.set(0, 0.12, 0.06); hood.rotation.x = -0.3;
      const cape = mk(new THREE.BoxGeometry(0.5, 0.7, 0.03), lm, torso);
      cape.position.set(0, -0.18, 0.21); cape.rotation.x = 0.12;
      break;
    }
    case 'halo': { // medic pack with a glowing cross + halo ring
      const p = mk(new THREE.BoxGeometry(0.42, 0.46, 0.2), mat('white', () => new THREE.MeshStandardMaterial({ color: '#e8eef0', roughness: 0.5 })), torso);
      p.position.set(0, 0.02, 0.26);
      mk(new THREE.BoxGeometry(0.06, 0.22, 0.02), glow, p).position.set(0, 0, 0.11);
      mk(new THREE.BoxGeometry(0.22, 0.06, 0.02), glow, p).position.set(0, 0, 0.11);
      const ring = mk(new THREE.TorusGeometry(0.17, 0.018, 6, 20), glow, head);
      ring.position.y = 0.27; ring.rotation.x = Math.PI / 2;
      break;
    }
    case 'bastion': // huge pauldrons + chest plate
      for (const sx of [-1, 1]) { const pd = mk(new THREE.SphereGeometry(0.2, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), lm, torso); pd.position.set(sx * 0.38, 0.27, 0); pd.scale.set(1.2, 0.9, 1.1); }
      mk(new THREE.BoxGeometry(0.5, 0.32, 0.06), armor(), torso).position.set(0, 0.06, -0.2);
      break;
    case 'echo': { // sensor dish on the back + single big eye
      const mast = mk(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 5), dark(), torso);
      mast.position.set(0.12, 0.45, 0.22);
      const dish = mk(new THREE.ConeGeometry(0.16, 0.08, 10, 1, true), glow, mast);
      dish.position.y = 0.27; dish.rotation.x = Math.PI;
      mk(new THREE.SphereGeometry(0.06, 8, 6), glow, head).position.set(0, 0.02, -0.18);
      break;
    }
    case 'miasma': // twin gas tanks + respirator
      for (const sx of [-1, 1]) { const t = mk(new THREE.CapsuleGeometry(0.08, 0.32, 3, 8), glow, torso); t.position.set(sx * 0.12, 0.02, 0.26); }
      mk(new THREE.CylinderGeometry(0.07, 0.09, 0.1, 8), dark(), head).position.set(0, -0.08, -0.17);
      break;
    case 'volt': { // beret + shoulder stripes
      const b = mk(new THREE.CylinderGeometry(0.2, 0.19, 0.06, 12), lm, head);
      b.position.set(0.02, 0.16, 0); b.rotation.z = -0.2;
      for (const sx of [-1, 1]) mk(new THREE.BoxGeometry(0.06, 0.04, 0.3), glow, torso).position.set(sx * 0.3, 0.27, 0);
      break;
    }
    case 'kodiak': { // riot shield on the off-arm, slab pauldrons, visor crest
      for (const sx of [-1, 1]) { const pd = mk(new THREE.BoxGeometry(0.26, 0.14, 0.34), armor(), torso); pd.position.set(sx * 0.4, 0.3, 0); pd.rotation.z = -sx * 0.25; }
      const crest = mk(new THREE.BoxGeometry(0.05, 0.1, 0.32), glow, head); crest.position.set(0, 0.17, 0);
      const shield = mk(new THREE.BoxGeometry(0.06, 0.62, 0.42), lm, torso); shield.position.set(-0.48, -0.05, -0.12);
      mk(new THREE.BoxGeometry(0.02, 0.5, 0.06), glow, shield).position.set(-0.035, 0, 0);
      break;
    }
    case 'spectre': { // jetpack with thrusters + wing fins
      const pack = mk(new THREE.BoxGeometry(0.36, 0.44, 0.18), armor(), torso);
      pack.position.set(0, 0.02, 0.27);
      for (const sx of [-1, 1]) {
        const th = mk(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 8), dark(), pack);
        th.position.set(sx * 0.13, -0.28, 0.02);
        const fl = mk(new THREE.ConeGeometry(0.05, 0.14, 8), glow, th);
        fl.position.y = -0.2; fl.rotation.x = Math.PI;
        const wing = mk(new THREE.BoxGeometry(0.34, 0.03, 0.14), lm, pack);
        wing.position.set(sx * 0.32, 0.12, 0); wing.rotation.z = sx * 0.35;
      }
      break;
    }
  }
}

export class Avatar {
  constructor(scene, meta, isMate) {
    this.meta = meta;
    const root = (this.root = new THREE.Group());
    const body = (this.body = new THREE.Group());
    root.add(body);
    const lm = legendMat(meta.legend);
    const mk = (geo, m, parent = body) => { const o = new THREE.Mesh(geo, m); o.castShadow = true; parent.add(o); return o; };
    const accent = glowMat(isMate ? SQUAD_ACCENT : LEGENDS[meta.legend].color);

    this.pelvis = mk(GEO.pelvis, dark());
    this.pelvis.position.y = 0.92;
    mk(GEO.belt, accent, this.pelvis).position.y = 0.07;
    this.torso = mk(GEO.torso, lm);
    this.torso.position.y = 1.32;
    mk(new THREE.BoxGeometry(0.3, 0.2, 0.05), armor(), this.torso).position.set(0, 0.12, -0.19); // chest plate
    this.head = mk(GEO.helmet, armor(), this.torso);
    this.head.position.y = 0.46;
    this.head.scale.set(1, 1.05, 1.08);
    mk(GEO.visor, glowMat(LEGENDS[meta.legend].color), this.head).position.set(0, 0.02, -0.165);
    if (!['halo', 'spectre', 'miasma'].includes(meta.legend)) mk(GEO.pack, dark(), this.torso).position.set(0, 0.0, 0.24);
    // arms: shoulder -> elbow
    const arm = (sx) => {
      const sh = new THREE.Group();
      sh.position.set(sx * 0.36, 0.22, 0);
      this.torso.add(sh);
      mk(GEO.upperArm, lm, sh);
      const el = new THREE.Group();
      el.position.y = -0.34;
      sh.add(el);
      mk(GEO.foreArm, dark(), el);
      return { sh, el };
    };
    this.armL = arm(-1);
    this.armR = arm(1);
    const leg = (sx) => {
      const hip = new THREE.Group();
      hip.position.set(sx * 0.13, 0.86, 0);
      body.add(hip);
      mk(GEO.thigh, dark(), hip);
      const knee = new THREE.Group();
      knee.position.y = -0.42;
      hip.add(knee);
      mk(GEO.shin, armor(), knee);
      mk(GEO.boot, dark(), knee).position.set(0, -0.44, -0.04);
      return { hip, knee };
    };
    this.legL = leg(-1);
    this.legR = leg(1);
    // weapon held in the right hand
    this.gun = new THREE.Group();
    mk(GEO.gunBody, gunMat(), this.gun);
    this.gunBarrel = mk(GEO.gunBarrel, gunMat(), this.gun);
    this.gunBarrel.position.z = -0.38;
    this.gunTint = mk(new THREE.BoxGeometry(0.075, 0.04, 0.3), mat('tint', () => new THREE.MeshStandardMaterial({ color: '#f2a03d' })).clone(), this.gun);
    this.gunTint.position.set(0, 0.08, -0.05);
    this.gun.position.set(0.18, 0.08, -0.42);
    this.torso.add(this.gun);
    legendKit(meta.legend, this.torso, this.head, mk);
    if (STYLE.comic) toonify(body);

    this.meshes = [];
    body.traverse((o) => { if (o.isMesh) this.meshes.push(o); });
    this.baseMats = this.meshes.map((m) => m.material);
    this.reveal = new THREE.Group();
    for (const m of this.meshes) {
      const r = new THREE.Mesh(m.geometry, revealMat);
      r.renderOrder = 20;
      r.matrixAutoUpdate = false;
      r.userData.src = m;
      this.reveal.add(r);
    }
    this.reveal.visible = false;
    scene.add(this.reveal);
    if (isMate) {
      this.tag = nameTag(meta.name, LEGENDS[meta.legend].color);
      this.tag.position.y = 2.4;
      root.add(this.tag);
    }
    this.walk = Math.random() * 6;
    this.castT = 9;
    this.knockT = 9;
    this.ghost = false;
    this.weaponId = null;
    scene.add(root);
    this.scene = scene;
  }

  setGhost(on) {
    if (on === this.ghost) return;
    this.ghost = on;
    this.meshes.forEach((m, i) => { m.material = on ? phaseMat : this.baseMats[i]; m.castShadow = !on; });
  }

  cast() { this.castT = 0; }

  update(dt, s, time) {
    const root = this.root, body = this.body;
    root.position.set(s.x, s.y, s.z);
    root.rotation.y = s.yaw;
    const fl = s.fl;
    const downed = fl & 1, slide = fl & 2, air = fl & 4, phase = fl & 8, skydive = fl & 32, healing = fl & 64, mantle = fl & 512, zip = fl & 4096;
    this.setGhost(!!phase);
    const speed = Math.hypot(s.vx, s.vz);
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw), rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
    const fwd = s.vx * fx + s.vz * fz, side = s.vx * rx + s.vz * rz;
    this.walk += dt * speed * 1.55 * (fwd < -0.5 ? -1 : 1);
    const run = Math.min(1, speed / 6.5);
    const sw = Math.sin(this.walk) * Math.min(1, speed / 4);
    const crouch = s.crouch || 0;

    // reset pose
    body.rotation.set(0, 0, 0);
    body.position.set(0, 0, 0);
    const T = this.torso, AL = this.armL, AR = this.armR, LL = this.legL, LR = this.legR;
    T.rotation.set(s.pitch * 0.3, 0, 0);
    T.position.set(0, 1.32 - crouch * 0.48 + Math.abs(Math.cos(this.walk)) * 0.04 * run, crouch * 0.1);
    this.pelvis.position.y = 0.92 - crouch * 0.45;
    // breathing when idle
    if (speed < 0.5) T.position.y += Math.sin(time * 2.2) * 0.008;
    // strafe lean
    body.rotation.z = -side * 0.025;
    body.rotation.x = run * 0.12 * Math.sign(fwd || 1);
    // legs: hip swing + knee bend on the back-swing
    for (const [L, ph] of [[LL, 0], [LR, Math.PI]]) {
      const a = Math.sin(this.walk + ph) * Math.min(1, speed / 4);
      L.hip.position.y = 0.86 - crouch * 0.45;
      L.hip.rotation.set(a * 0.85 - crouch * 0.9, 0, 0);
      L.knee.rotation.set(Math.max(0, -Math.cos(this.walk + ph)) * 1.1 * run + crouch * 1.6, 0, 0);
    }
    // arms hold the weapon; slight counter swing
    const aim = -1.25 - s.pitch * 0.85;
    AR.sh.rotation.set(aim, 0, -0.15); AR.el.rotation.set(-0.35, 0, 0);
    AL.sh.rotation.set(aim + 0.15 + sw * 0.05, 0.5, 0.35); AL.el.rotation.set(-0.7, 0, 0);
    this.gun.rotation.set(s.pitch * 0.85, 0, 0);
    this.gun.position.set(0.18, 0.08 + s.pitch * 0.18, -0.42);

    if (slide) {
      body.rotation.x = 0.45; body.position.y = -0.38;
      LL.hip.rotation.x = -1.35; LL.knee.rotation.x = 0.2;
      LR.hip.rotation.x = -0.6; LR.knee.rotation.x = 1.7;
      AL.sh.rotation.set(-0.6, 0, 0.9);
    } else if (skydive) {
      body.rotation.x = -1.25; body.position.y = 1.0;
      LL.hip.rotation.x = 0.3; LR.hip.rotation.x = 0.5; LL.knee.rotation.x = 0.6; LR.knee.rotation.x = 0.4;
      AL.sh.rotation.set(-0.3, 0, 1.3); AR.sh.rotation.set(-0.3, 0, -1.3); AL.el.rotation.x = AR.el.rotation.x = -0.2;
    } else if (zip) {
      AL.sh.rotation.set(-3.0, 0, 0.1); AR.sh.rotation.set(-3.0, 0, -0.1); AL.el.rotation.x = AR.el.rotation.x = 0;
      LL.hip.rotation.x = -0.4; LR.hip.rotation.x = -0.2; LL.knee.rotation.x = 0.6; LR.knee.rotation.x = 0.4;
    } else if (air && !mantle) {
      LL.hip.rotation.x = -0.7; LL.knee.rotation.x = 1.0;
      LR.hip.rotation.x = 0.25; LR.knee.rotation.x = 0.5;
    }
    if (mantle) {
      AL.sh.rotation.set(-2.9, 0, 0.2); AR.sh.rotation.set(-2.9, 0, -0.2); AL.el.rotation.x = AR.el.rotation.x = -0.5;
      LL.hip.rotation.x = -1.2; LL.knee.rotation.x = 1.4;
    }
    // ability cast gesture: off-hand thrust forward
    this.castT += dt;
    if (this.castT < 0.5) { const k = Math.sin((this.castT / 0.5) * Math.PI); AL.sh.rotation.set(-1.6 * k + (1 - k) * AL.sh.rotation.x, 0, 0.1); AL.el.rotation.x = -0.1; }
    // knockdown: stagger then collapse into a crawl
    this.knockT += dt;
    if (downed) {
      const k = Math.min(1, this.knockT / 0.45), e = k * k * (3 - 2 * k);
      body.rotation.x = -1.35 * e + Math.sin(k * Math.PI) * 0.25;
      body.rotation.z = Math.sin(k * Math.PI) * 0.3;
      body.position.y = 0.35 * e; body.position.z = 0.6 * e;
      LL.hip.rotation.x = sw * 0.4; LR.hip.rotation.x = -sw * 0.4;
      LL.knee.rotation.x = LR.knee.rotation.x = 0.3;
      AL.sh.rotation.set(-2.6 + sw * 0.5, 0, 0.2); AR.sh.rotation.set(-2.6 - sw * 0.5, 0, -0.2);
    }
    if (healing) { AL.sh.rotation.set(-1.0, 0.4, 0.5); AL.el.rotation.x = -1.4; this.gun.rotation.x = -0.7; }
    this.gun.visible = !!s.weapon && !downed && !skydive && !zip;
    if (s.weapon && s.weapon !== this.weaponId && WEAPONS[s.weapon]) {
      this.weaponId = s.weapon;
      const w = WEAPONS[s.weapon];
      const len = w.cls === 'Pistol' ? 0.5 : w.cls === 'Sniper' ? 1.3 : w.cls === 'SMG' ? 0.8 : 1;
      this.gun.scale.set(1, 1, len);
      this.gunTint.material.color.set(w.tint);
    }
    this.reveal.visible = !!s.revealed;
    if (s.revealed) {
      root.updateMatrixWorld(true);
      for (const r of this.reveal.children) r.matrix.copy(r.userData.src.matrixWorld);
    }
  }

  dispose() {
    this.scene.remove(this.root);
    this.scene.remove(this.reveal);
  }
}

export { SHIELD_COLORS };
