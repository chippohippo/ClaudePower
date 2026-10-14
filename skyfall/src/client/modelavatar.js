// Character avatar built from an imported rigged model (Quaternius / Mixamo / Kenney style GLB or
// FBX, see assets.js). Same interface as the procedural Avatar in avatars.js, so the game, FX and
// HUD don't care which one they get:
//   root, reveal, tag, kd, dead, knockT, fireKick, cast(), setGhost(), update(dt, s, time, dist),
//   ragdollClone(), dispose()
// Animation: one AnimationMixer per avatar; game movement flags pick a state (idle / walk / run /
// crouch / slide / jump / skydive / zip / downed / heal) that crossfades to the matching clip, with
// walk/run playback speed locked to ground speed. Aim pitch bends the spine, firing kicks it.

import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { LEGENDS } from '../shared/legends.js';
import { WEAPONS } from '../shared/weapons.js';
import { assets } from './assets.js';
import { PAL, teamRim } from './palette.js';
import { Avatar, phaseMat, kdMat, kdGeo, revealMat, nameTag, gunMat } from './avatars.js';

const TINT_NAMES = /main|body|cloth|shirt|suit|armou?r|outfit|jacket|torso|top|uniform|primary/i;
const HAND_R = /(right.?hand|hand[._]?r$|hand_r|^handr|mixamorig:?righthand)/i;
const SPINE = /(spine.?2|chest|upperchest|spine1|spine)/i;
const tintCache = new Map();

// Bone lookup that survives loader renaming (GLTFLoader strips ".", ":" etc. from node names, so
// Quaternius "Hand.R" arrives as "HandR"): exact name, then sanitised name, then the pattern.
function findBone(model, name, re) {
  const clean = (n) => THREE.PropertyBinding.sanitizeNodeName(n || '').toLowerCase();
  const bones = [];
  model.traverse((o) => { if (o.isBone) bones.push(o); });
  if (name) {
    const hit = bones.find((b) => b.name === name) || bones.find((b) => clean(b.name) === clean(name));
    if (hit) return hit;
  }
  return bones.find((b) => re.test(b.name)) || null;
}

// Legend colour on the outfit materials (cached per legend so clones share materials).
function tintModel(model, legend, def) {
  const col = new THREE.Color(LEGENDS[legend].color);
  const names = def.tint ? new RegExp(def.tint.join('|'), 'i') : TINT_NAMES;
  const mats = [];
  model.traverse((o) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.push(m)); });
  const pick = mats.some((m) => names.test(m.name || '')) ? (m) => names.test(m.name || '') : (m, i) => i === 0;
  model.traverse((o) => {
    if (!o.isMesh) return;
    const swap = (m, i) => {
      if (!m || !pick(m, mats.indexOf(m))) return m;
      const key = m.uuid + legend;
      let t = tintCache.get(key);
      if (!t) {
        t = m.clone();
        t.color = t.color.clone().lerp(col, def.tintAmount ?? 0.7);
        tintCache.set(key, t);
      }
      return t;
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
}

export class ModelAvatar {
  constructor(scene, meta, isMate, built) {
    this.meta = meta;
    this.scene = scene;
    const { root: modelRoot, model, clips, def } = built;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.body.add(modelRoot);
    this.model = model;
    tintModel(model, meta.legend, def);
    teamRim(this.body, isMate ? 'ally' : 'enemy');

    // animation
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const [st, clip] of Object.entries(clips)) {
      const a = this.mixer.clipAction(clip);
      if (st === 'death' || (st === 'downed' && !/crawl/i.test(clip.name))) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions[st] = a;
    }
    this.state = null;
    this.lodAcc = 0;

    // bones for procedural layers
    this.hand = findBone(model, def.handBone, HAND_R);
    this.spine = findBone(model, def.spineBone, SPINE);
    this.spinePose = this.spine ? this.spine.quaternion.clone() : null;

    // third-person gun follows the right hand
    this.gun = new THREE.Group();
    this.root.add(this.gun);
    this.weaponId = null;

    this.meshes = [];
    this.body.traverse((o) => { if (o.isMesh) this.meshes.push(o); });
    this.baseMats = this.meshes.map((m) => m.material);
    this.ghost = false;

    // reveal (Bloodhound-style scans): skinned copies bound to the same skeleton
    this.reveal = new THREE.Group();
    for (const m of this.meshes) {
      const r = m.isSkinnedMesh ? new THREE.SkinnedMesh(m.geometry, revealMat) : new THREE.Mesh(m.geometry, revealMat);
      if (m.isSkinnedMesh) r.bind(m.skeleton, m.bindMatrix);
      r.renderOrder = 20;
      r.matrixAutoUpdate = false;
      r.frustumCulled = false;
      r.userData.src = m;
      this.reveal.add(r);
    }
    this.reveal.visible = false;
    scene.add(this.reveal);

    this.kd = new THREE.Mesh(kdGeo, kdMat);
    this.kd.visible = false;
    this.root.add(this.kd);
    if (isMate) {
      this.tag = nameTag(meta.name, LEGENDS[meta.legend].color);
      this.tag.position.y = 2.6;
      this.root.add(this.tag);
    }
    this.castT = 9;
    this.knockT = 9;
    this.fireKick = 0;
    scene.add(this.root);
    this._setState('idle', 0);
  }

  _setState(st, fade = 0.2) {
    const want = this.actions[st] ? st : st === 'run' && this.actions.walk ? 'walk' : st === 'zip' && this.actions.jump ? 'jump' : this.actions.idle ? 'idle' : null;
    if (!want || want === this.state) return;
    const next = this.actions[want], prev = this.state && this.actions[this.state];
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (prev) prev.crossFadeTo(next, fade, false);
    this.state = want;
  }

  setGhost(on) {
    if (on === this.ghost) return;
    this.ghost = on;
    this.meshes.forEach((m, i) => { m.material = on ? phaseMat : this.baseMats[i]; m.castShadow = !on; });
  }

  cast() { this.castT = 0; }

  _setWeapon(id) {
    this.weaponId = id;
    this.gun.clear();
    if (!id) return;
    const g = assets.gun(id);
    if (g) { this.gun.add(g.root); return; }
    // procedural fallback sized by class
    const w = WEAPONS[id];
    const len = w.cls === 'Pistol' ? 0.3 : w.cls === 'Sniper' ? 1.1 : w.cls === 'SMG' ? 0.55 : 0.8;
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.13, len), gunMat());
    m.position.z = -len / 2 + 0.1;
    this.gun.add(m);
  }

  update(dt, s, time, dist = 0) {
    if (revealMat.userData.c !== PAL.enemy) { revealMat.userData.c = PAL.enemy; revealMat.color.set(PAL.enemy); }
    const root = this.root;
    root.position.set(s.x, s.y, s.z);
    root.rotation.y = s.yaw;
    const fl = s.fl;
    const downed = fl & 1, slide = fl & 2, air = fl & 4, phase = fl & 8, skydive = fl & 32, healing = fl & 64, mantle = fl & 512, zip = fl & 4096;
    this.setGhost(!!phase);
    const speed = Math.hypot(s.vx, s.vz);
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    const fwd = s.vx * fx + s.vz * fz;
    this.knockT += dt;
    this.castT += dt;

    let st = 'idle';
    if (downed) st = 'downed';
    else if (skydive) st = 'skydive';
    else if (zip) st = 'zip';
    else if (slide) st = 'slide';
    else if (air && !mantle) st = 'jump';
    else if ((s.crouch || 0) > 0.5) st = 'crouch';
    else if (speed > 4.8) st = 'run';
    else if (speed > 0.6) st = 'walk';
    else if (healing && this.actions.heal) st = 'heal';
    this._setState(st, st === 'jump' || st === 'slide' ? 0.12 : 0.22);
    // lock locomotion playback to ground speed; play backwards when back-pedalling
    const a = this.actions[this.state];
    if (a) {
      const nominal = this.state === 'run' ? 6.5 : this.state === 'walk' ? 3.0 : this.state === 'crouch' ? 2.2 : 0;
      a.timeScale = nominal ? Math.max(0.4, speed / nominal) * (fwd < -0.5 ? -1 : 1) : 1;
    }
    // animation LOD: far characters tick at a lower rate
    this.lodAcc += dt;
    const step = dist > 140 ? 0.1 : dist > 60 ? 0.05 : 0;
    if (this.lodAcc >= step) {
      this.mixer.update(this.lodAcc);
      this.lodAcc = 0;
      if (this.spine) this.spinePose.copy(this.spine.quaternion); // clip pose before our layers
    }

    // procedural layers on top of the clip: aim pitch through the spine, fire kick
    this.fireKick = Math.max(0, (this.fireKick || 0) - dt * 9);
    if (this.spine && !downed && !skydive) {
      const pitch = THREE.MathUtils.clamp(s.pitch || 0, -1.1, 1.1) * 0.6 + this.fireKick * 0.12;
      this.spine.quaternion.copy(this.spinePose);
      this.spine.rotateX(-pitch);
    }

    // gun: at the right hand, pointing where the player aims
    if (s.weapon !== this.weaponId) this._setWeapon(s.weapon && WEAPONS[s.weapon] ? s.weapon : null);
    this.gun.visible = !!s.weapon && !downed && !skydive && !zip;
    if (this.gun.visible) {
      root.updateMatrixWorld(true);
      if (this.hand) {
        const p = this.hand.getWorldPosition(new THREE.Vector3());
        root.worldToLocal(p);
        this.gun.position.copy(p);
      } else this.gun.position.set(0.2, 1.3, -0.3);
      this.gun.position.z -= this.fireKick * 0.06;
      this.gun.rotation.set(THREE.MathUtils.clamp(s.pitch || 0, -1.1, 1.1) * 0.8, 0, 0);
    }
    this.kd.visible = !!(fl & 8192);
    this.reveal.visible = !!s.revealed;
    if (s.revealed) {
      root.updateMatrixWorld(true);
      for (const r of this.reveal.children) r.matrix.copy(r.userData.src.matrixWorld);
    }
  }

  // frozen copy of the current pose for the death tumble (skeleton cloned so it stays posed)
  ragdollClone() {
    this.root.updateMatrixWorld(true);
    const c = SkeletonUtils.clone(this.root);
    c.remove(...c.children.filter((o) => o.isSprite));
    return c;
  }

  dispose() {
    this.mixer.stopAllAction();
    this.scene.remove(this.root);
    this.scene.remove(this.reveal);
  }
}

// Imported character when the asset library has one for this legend (or a default), else the
// procedural avatar.
export function createAvatar(scene, meta, isMate) {
  const built = assets.character(meta.legend);
  return built ? new ModelAvatar(scene, meta, isMate, built) : new Avatar(scene, meta, isMate);
}
