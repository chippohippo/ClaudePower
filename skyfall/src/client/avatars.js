// Third-person character models for other players: chunky, readable silhouettes in each legend's
// colour, procedural animation (run cycle, crouch, slide, airborne, skydive, downed crawl, healing),
// phase-shift ghosting, reveal highlights (visible through walls) and squadmate name tags.

import * as THREE from 'three';
import { LEGENDS } from '../shared/legends.js';
import { WEAPONS } from '../shared/weapons.js';
import { SHIELD_COLORS } from '../shared/constants.js';

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const GEO = {
  torso: box(0.56, 0.62, 0.32),
  pelvis: box(0.44, 0.2, 0.28),
  head: box(0.3, 0.32, 0.3),
  visor: box(0.24, 0.08, 0.04),
  arm: box(0.15, 0.55, 0.15),
  leg: box(0.19, 0.78, 0.2),
  gun: box(0.08, 0.14, 0.7),
  pack: box(0.4, 0.42, 0.18),
};
GEO.arm.translate(0, -0.25, 0);
GEO.leg.translate(0, -0.37, 0);

const darkMat = new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.7 });
const gunMat = new THREE.MeshStandardMaterial({ color: '#1d2026', roughness: 0.4, metalness: 0.6 });
const visorMat = new THREE.MeshBasicMaterial({ color: '#7ff7ff' });
const legendMats = {};
function legendMat(id) {
  if (!legendMats[id]) legendMats[id] = new THREE.MeshStandardMaterial({ color: LEGENDS[id].color, roughness: 0.55, metalness: 0.1 });
  return legendMats[id];
}
const phaseMat = new THREE.MeshBasicMaterial({ color: '#b48bff', transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending });
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
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(2.4, 0.6, 1);
  s.renderOrder = 10;
  return s;
}

export class Avatar {
  constructor(scene, meta, isMate) {
    this.meta = meta;
    const root = (this.root = new THREE.Group());
    const body = (this.body = new THREE.Group());
    root.add(body);
    const lm = legendMat(meta.legend);
    const mk = (geo, mat, parent = body) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    this.pelvis = mk(GEO.pelvis, darkMat);
    this.pelvis.position.y = 0.92;
    this.torso = mk(GEO.torso, lm);
    this.torso.position.y = 1.3;
    this.pack = mk(GEO.pack, darkMat, this.torso);
    this.pack.position.set(0, 0.02, 0.24);
    this.head = mk(GEO.head, lm, this.torso);
    this.head.position.y = 0.5;
    const visor = mk(GEO.visor, visorMat, this.head);
    visor.position.set(0, 0.02, -0.16);
    this.armL = mk(GEO.arm, darkMat, this.torso);
    this.armL.position.set(-0.36, 0.25, 0);
    this.armR = mk(GEO.arm, darkMat, this.torso);
    this.armR.position.set(0.36, 0.25, 0);
    this.legL = mk(GEO.leg, darkMat);
    this.legL.position.set(-0.13, 0.85, 0);
    this.legR = mk(GEO.leg, darkMat);
    this.legR.position.set(0.13, 0.85, 0);
    this.gun = mk(GEO.gun, gunMat, this.torso);
    this.gun.position.set(0.2, 0.05, -0.45);
    this.meshes = [];
    body.traverse((o) => { if (o.isMesh) this.meshes.push(o); });
    this.baseMats = this.meshes.map((m) => m.material);
    // reveal overlay (drawn through walls)
    this.reveal = new THREE.Group();
    for (const m of this.meshes) {
      const r = new THREE.Mesh(m.geometry, revealMat);
      r.renderOrder = 20;
      r.matrixAutoUpdate = false;
      this.reveal.add(r);
      r.userData.src = m;
    }
    this.reveal.visible = false;
    scene.add(this.reveal);
    if (isMate) {
      this.tag = nameTag(meta.name, LEGENDS[meta.legend].color);
      this.tag.position.y = 2.35;
      root.add(this.tag);
    }
    // shield glow ring shown briefly when hit
    this.hitGlow = 0;
    this.phase = 0;
    this.walk = 0;
    scene.add(root);
    this.scene = scene;
    this.ghost = false;
  }

  setGhost(on) {
    if (on === this.ghost) return;
    this.ghost = on;
    this.meshes.forEach((m, i) => { m.material = on ? phaseMat : this.baseMats[i]; m.castShadow = !on; });
  }

  update(dt, s, time) {
    // s: {x,y,z,yaw,pitch,fl,crouch,vx,vz,weapon,revealed}
    const root = this.root;
    root.position.set(s.x, s.y, s.z);
    root.rotation.y = s.yaw;
    const fl = s.fl;
    const downed = fl & 1, slide = fl & 2, air = fl & 4, phase = fl & 8, skydive = fl & 32, healing = fl & 64, mantle = fl & 512;
    this.setGhost(!!phase);
    const speed = Math.hypot(s.vx, s.vz);
    // local velocity for strafing legs
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    const fwd = s.vx * fx + s.vz * fz;
    this.walk += dt * (speed * 1.6) * (fwd < -0.5 ? -1 : 1);
    const sw = Math.sin(this.walk) * Math.min(1, speed / 5);
    const body = this.body;
    body.rotation.set(0, 0, 0);
    body.position.set(0, 0, 0);
    this.torso.rotation.set(0, 0, 0);
    this.legL.rotation.set(sw * 0.9, 0, 0);
    this.legR.rotation.set(-sw * 0.9, 0, 0);
    this.armL.rotation.set(-1.2 - s.pitch * 0.8, 0, 0.35);
    this.armR.rotation.set(-1.3 - s.pitch * 0.8, 0, -0.1);
    this.gun.rotation.set(s.pitch * 0.9, 0, 0);
    this.gun.position.set(0.2, 0.05 + s.pitch * 0.2, -0.45);
    this.torso.rotation.x = s.pitch * 0.35;
    const crouch = s.crouch || 0;
    this.pelvis.position.y = 0.92 - crouch * 0.45;
    this.torso.position.y = 1.3 - crouch * 0.5;
    this.torso.position.z = crouch * 0.1;
    this.legL.position.y = this.legR.position.y = 0.85 - crouch * 0.45;
    if (crouch > 0.3 && !slide) {
      this.legL.rotation.x += -0.9 * crouch;
      this.legR.rotation.x += -0.9 * crouch;
    }
    if (slide) {
      body.rotation.x = 0.35;
      body.position.y = -0.3;
      this.legL.rotation.x = -1.2; this.legR.rotation.x = -0.9;
    } else if (skydive) {
      body.rotation.x = -1.2;
      body.position.y = 1.0;
      this.legL.rotation.x = 0.3; this.legR.rotation.x = 0.5;
      this.armL.rotation.set(-0.3, 0, 1.2); this.armR.rotation.set(-0.3, 0, -1.2);
    } else if (air && !mantle) {
      this.legL.rotation.x = -0.6; this.legR.rotation.x = 0.3;
    }
    if (mantle) {
      this.armL.rotation.set(-2.8, 0, 0.2); this.armR.rotation.set(-2.8, 0, -0.2);
    }
    if (downed) {
      body.rotation.x = -1.35;
      body.position.y = 0.35;
      body.position.z = 0.6;
      this.legL.rotation.x = sw * 0.4; this.legR.rotation.x = -sw * 0.4;
      this.armL.rotation.set(-2.6 + sw * 0.5, 0, 0.2); this.armR.rotation.set(-2.6 - sw * 0.5, 0, -0.2);
    }
    if (healing) { this.armL.rotation.set(-0.8, 0, 0.6); this.gun.rotation.x = -0.6; }
    this.gun.visible = !!s.weapon && !downed && !skydive;
    if (s.weapon && WEAPONS[s.weapon]) {
      const len = WEAPONS[s.weapon].cls === 'Pistol' ? 0.35 : WEAPONS[s.weapon].cls === 'Sniper' ? 1.1 : 0.75;
      this.gun.scale.z = len / 0.7;
    }
    // reveal overlay
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
