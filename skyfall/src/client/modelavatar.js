// Character avatar built from an imported rigged model (Quaternius / Mixamo / Kenney style GLB or
// FBX, see assets.js). Same interface as the procedural Avatar in avatars.js, so the game, FX and
// HUD don't care which one they get:
//   root, reveal, tag, kd, dead, knockT, fireKick, cast(), setGhost(), update(dt, s, time, dist),
//   ragdollClone(), dispose()
// Animation: one AnimationMixer per avatar; game movement flags pick a state (idle / walk / run /
// crouch / slide / jump / skydive / zip / downed / heal) that crossfades to the matching clip, with
// walk/run playback speed locked to ground speed. Realistic humanoid rigs (client/humanoid.js) get a
// procedural layer on top: two-handed gun hold by arm IK, strafing hip twist, crouch / slide / downed
// poses matching the Apex-style hitboxes (shared/hitbox.js), skydive and zipline arms. Other rigs
// keep the simpler layer: aim pitch bends the spine, firing kicks it, the gun follows the hand.

import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { LEGENDS } from '../shared/legends.js';
import { WEAPONS } from '../shared/weapons.js';
import { assets, GUN_CLASS_LEN } from './assets.js';
import { PAL, teamRim } from './palette.js';
import { Avatar, phaseMat, kdMat, kdGeo, revealMat, nameTag, gunMat } from './avatars.js';
import { HumanoidRig, PoseLayer } from './humanoid.js';
import { legendSize, BODY } from '../shared/hitbox.js';

const TINT_NAMES = /main|body|cloth|shirt|suit|armou?r|outfit|jacket|torso|top|uniform|primary/i;
const HAND_R = /(right.?hand|hand[._]?r$|hand_r|^handr|mixamorig:?righthand)/i;
const SPINE = /(spine.?2|chest|upperchest|spine1|spine)/i;
const tintCache = new Map();
const _gp = new THREE.Vector3(), _gq = new THREE.Quaternion();

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
  if (def.outfit) return; // dressed in legend colours already (outfits.js)
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


// Transition clips (played once, then back to the state machine). Their root motion is removed: the
// simulation already moves the body, so only the pose remains.
const ONCE = { mantle: 1, jumpStart: 1, land: 1, roll: 1, slideIn: 1, getUp: 1 };
const LOCO = { walk: 1, run: 1, sprint: 1, crouch: 1 };
// clip ground speed (m/s) at timeScale 1, measured with tools/dev/clipspeed.html on the UAL clips
const NOMINAL = { walk: 1.4, run: 4.0, sprint: 5.9, crouch: 1.1, strafeL: 4.5, strafeR: 4.5, walkBack: 2.6 };
const FALLBACK = { sprint: ['run', 'walk'], run: ['walk'], crouchIdle: ['crouch', 'idle'], crouch: ['walk'], zip: ['jump'], mantle: ['jump'], revive: ['crouchIdle', 'idle'], idlePistol: ['idle'], dive: ['skydive'] };
// blend times: snappy into the air and slides, smooth between locomotion speeds, slow settles
function fadeFor(from, to) {
  if (to === 'jump' || to === 'slide' || to === 'shoot') return 0.1;
  if (LOCO[from] && LOCO[to]) return 0.25;
  if (from === 'land' || from === 'mantle' || from === 'jumpStart') return 0.18;
  if (to === 'idle' || to === 'crouchIdle') return 0.3;
  if (to === 'downed' || to === 'death') return 0.15;
  return 0.2;
}

const HIPS = /hips|pelvis/i;
const UPPER = /spine|chest|neck|head|clavicle|shoulder|upperarm|lowerarm|forearm|arm|hand|thumb|index|middle|ring|pinky/i;
const upperCache = new Map();
function upperBody(clip) {
  let c = upperCache.get(clip);
  if (!c) upperCache.set(clip, (c = new THREE.AnimationClip(clip.name + '_upper', clip.duration, clip.tracks.filter((t) => UPPER.test(t.name) && !/position$/.test(t.name)))));
  return c;
}
function inPlace(clip) {
  const tracks = clip.tracks.map((t) => {
    if (!/\.position$/.test(t.name) || !HIPS.test(t.name)) return t;
    // remove the straight-line drift from first to last key, keep the bob
    const v = t.values.slice(), n = v.length / 3, T = t.times, d = T[n - 1] - T[0] || 1;
    for (let i = 0; i < n; i++) {
      const k = (T[i] - T[0]) / d;
      for (let c = 0; c < 3; c++) if (c !== 1 || /climb|mantle/i.test(clip.name)) v[i * 3 + c] -= (t.values[(n - 1) * 3 + c] - t.values[c]) * k;
    }
    // and keep the hips over the feet horizontally
    for (let i = 0; i < n; i++) { v[i * 3] = t.values[0] + (v[i * 3] - t.values[0]) * 0.3; v[i * 3 + 2] = t.values[2] + (v[i * 3 + 2] - t.values[2]) * 0.3; }
    return new THREE.VectorKeyframeTrack(t.name, T, v);
  });
  return new THREE.AnimationClip(clip.name + '_ip', clip.duration, tracks);
}

// Additive reaction from spine, neck and head tracks only (legs keep running).
const additiveCache = new Map();
function upperAdditive(clip) {
  let c = additiveCache.get(clip);
  if (c) return c;
  const tracks = clip.tracks.filter((t) => /spine|chest|neck|head/i.test(t.name) && /quaternion$/.test(t.name));
  c = THREE.AnimationUtils.makeClipAdditive(new THREE.AnimationClip(clip.name + '_add', clip.duration, tracks.map((t) => t.clone())));
  additiveCache.set(clip, c);
  return c;
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
    // Apex-style size class: tanks broader, DPS slimmer (matches the hitbox width)
    this.size = legendSize(meta.legend);
    modelRoot.scale.set(this.size, 1, this.size);
    tintModel(model, meta.legend, def);
    teamRim(this.body, isMate ? 'ally' : 'enemy');

    // animation
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const [st, c] of Object.entries(clips)) {
      if (st === 'hit' || st === 'knock' || st === 'cast') continue; // layered on top, below
      const clip = ONCE[st] ? inPlace(c) : c;
      const a = this.mixer.clipAction(clip);
      if (st === 'death' || ONCE[st] || (st === 'downed' && !/crawl/i.test(c.name))) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions[st] = a;
    }
    // hit reactions: upper body only, added on top of whatever the legs are doing
    this.react = {};
    for (const st of ['hit', 'knock']) {
      if (!clips[st]) continue;
      const a = this.mixer.clipAction(upperAdditive(clips[st]));
      a.setLoop(THREE.LoopOnce, 1); a.blendMode = THREE.AdditiveAnimationBlendMode;
      this.react[st] = a;
    }
    // ability / grenade throw: upper body only, over whatever the legs are doing
    if (clips.cast) {
      const a = this.mixer.clipAction(upperBody(clips.cast));
      a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false;
      this.castAction = a;
    }
    this.state = null;
    this.once = null;            // transition clip playing over the state machine: { st, t, dur }
    this.wasAir = false; this.airT = 0; this.wasDowned = false; this.lastKnock = 9;
    this.lodAcc = 0;
    // realistic humanoid → procedural pose layer (gun IK, aim, strafe twist). Crouch clips play when
    // the pack has them; the layer still pins the pelvis to the crouch hitbox height.
    this.rig = new HumanoidRig(model);
    this.layer = this.rig.ok ? new PoseLayer(this.rig, this.body) : null;
    this.reloadT = 0;

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
    const A = this.actions;
    const want = A[st] ? st : FALLBACK[st] ? FALLBACK[st].find((f) => A[f]) : A.idle ? 'idle' : null;
    if (!want || want === this.state) return;
    const next = A[want], prev = this.state && A[this.state];
    next.reset();
    next.enabled = true;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    // matching locomotion cycles (walk ↔ jog ↔ sprint) keep their foot phase across the blend
    if (prev && LOCO[want] && LOCO[this.state]) next.time = (prev.time / prev.getClip().duration) * next.getClip().duration;
    next.play();
    if (prev) prev.crossFadeTo(next, fade, false);
    this.state = want;
  }

  // short transition clip (jump take-off, landing, mantle …) that owns the body until it ends
  _playOnce(st, speed = 1, maxDur = 9) {
    const a = this.actions[st];
    if (!a) return false;
    const dur = Math.min(maxDur, a.getClip().duration / speed);
    this.once = { st, t: 0, dur };
    this.state = null; // force the crossfade even when re-triggered
    this._setState(st, 0.08);
    a.setEffectiveTimeScale(speed);
    return true;
  }

  _react(st, w = 1) {
    const a = this.react[st] || this.react.hit;
    if (!a) return;
    a.reset(); a.setEffectiveWeight(w); a.play();
  }

  setGhost(on) {
    if (on === this.ghost) return;
    this.ghost = on;
    this.meshes.forEach((m, i) => { m.material = on ? phaseMat : this.baseMats[i]; m.castShadow = !on; });
  }

  cast() {
    this.castT = 0;
    const a = this.castAction;
    if (a) { a.reset(); a.setEffectiveTimeScale(1.5); a.setEffectiveWeight(3); a.play(); }
  }

  _setWeapon(id) {
    this.weaponId = id;
    this.gun.clear();
    if (!id) return;
    const w = WEAPONS[id];
    this.foreLen = null;
    const g = assets.gun(id, GUN_CLASS_LEN[w.cls] || 0.8);
    if (g) {
      // pistol grip in the hand (same fractions the viewmodel uses), support hand on the handguard
      const m = g.root, def = g.def;
      m.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3());
      const shift = def.grip != null ? -(box.min.z + def.grip * size.z) : 0.14 - box.max.z;
      m.position.z += shift;
      m.position.y -= box.min.y * 0.35;
      if (def.fore != null) this.foreLen = Math.max(0.08, -(box.min.z + def.fore * size.z + shift));
      this.gun.add(m);
      return;
    }
    // procedural fallback sized by class
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
    const fwd = s.vx * fx + s.vz * fz, side = s.vx * -fz + s.vz * fx;
    this.knockT += dt;
    this.castT += dt;
    this.fireKick = Math.max(0, (this.fireKick || 0) - dt * 9);
    if (this.fireKick > 0.3) this.firedT = 0.35; else this.firedT = Math.max(0, (this.firedT || 0) - dt);

    const dive = skydive ? Math.max(0, Math.min(1, (-(s.pitch || 0) - 0.2) / 1.0)) : 0;
    const L = this.layer, A = this.actions;
    const crouched = (s.crouch || 0) > 0.5, reviving = fl & 1024;
    // edge-triggered transitions
    const inAir = air && !mantle && !skydive && !zip;
    if (inAir) this.airT += dt;
    if (!downed && !skydive && !zip) {
      if (mantle && (!this.once || this.once.st !== 'mantle')) this._playOnce('mantle', 1.6, 0.6);
      else if (inAir && !this.wasAir && !slide && !this.once && A.jumpStart) this._playOnce('jumpStart', 2.2, 0.35);
      else if (!air && this.wasAir && this.airT > 0.35 && !slide) {
        if (speed < 2.5 && A.land) this._playOnce('land', 1.6, 0.4);
        else this.once = null;
      }
    }
    if (downed && !this.wasDowned) { this.once = null; this._react('knock', 1); }
    else if (!downed && this.wasDowned && !(fl & 16)) this._playOnce('getUp', 1.6, 1.1);
    if (this.knockT < this.lastKnock && !downed) this._react('hit', 0.8);
    this.lastKnock = this.knockT;
    if (!air) this.airT = 0;
    this.wasAir = air && !mantle; this.wasDowned = !!downed;
    if (this.once) {
      this.once.t += dt;
      const o = this.once;
      // a take-off is cut short by landing; a landing by moving off; anything by being knocked
      if (o.t >= o.dur || downed || skydive || zip || (o.st === 'jumpStart' && !air) || (o.st === 'land' && (speed > 3 || air)) || (o.st === 'mantle' && !mantle && o.t > 0.15)) this.once = null;
    }
    let st = 'idle';
    if (this.once) st = this.once.st;
    else if (downed) st = 'downed';
    else if (skydive) st = dive > 0.45 ? 'dive' : 'skydive';
    else if (zip) st = 'zip';
    else if (slide) st = 'slide';
    else if (air && !mantle) st = 'jump';
    else if (reviving) st = 'revive';
    else if (crouched) st = speed > 0.6 ? 'crouch' : 'crouchIdle';
    else if (speed > 0.6 && Math.abs(side) > Math.abs(fwd) * 1.2 && A.strafeL && A.strafeR) st = side > 0 ? 'strafeR' : 'strafeL';
    else if (speed > 0.6 && fwd < -0.5 && A.walkBack) st = 'walkBack';
    else if (speed > 6.0 && fwd > 0 && !this.firedT) st = 'sprint';
    else if (speed > 2.2) st = 'run';
    else if (speed > 0.6) st = 'walk';
    else if (this.firedT > 0 && A.shoot) st = 'shoot';
    else if (fl & 128 && A.reload) st = 'reload';
    else if (healing && A.heal) st = 'heal';
    else if (s.weapon && WEAPONS[s.weapon] && WEAPONS[s.weapon].cls === 'Pistol') st = 'idlePistol';
    if (!this.once) this._setState(st, fadeFor(this.state, st));
    // lock locomotion playback to ground speed (backwards only when there's no walk-back clip)
    const a = A[this.state];
    if (a && !this.once) {
      const nominal = NOMINAL[this.state] || 0;
      a.timeScale = nominal ? THREE.MathUtils.clamp(speed / nominal, 0.5, 1.9) * (LOCO[this.state] && fwd < -0.5 ? -1 : 1) : 1;
    }
    // animation LOD: the further away, the lower the update rate (pose holds in between)
    this.lodAcc += dt;
    const step = dist > 300 ? 0.25 : dist > 160 ? 1 / 7 : dist > 80 ? 1 / 15 : dist > 20 ? 1 / 30 : 0;
    let ticked = false, tickDt = 0;
    if (this.lodAcc >= step) {
      if (L) this.rig.restore();
      this.mixer.update(this.lodAcc);
      tickDt = this.lodAcc;
      this.lodAcc = 0;
      ticked = true;
      if (this.spine) this.spinePose.copy(this.spine.quaternion); // clip pose before our layers
    }

    // freefall: lean the whole body forward like an Apex skydive (most packs only have an upright
    // jump/fall clip); steeper when diving
    const lean = !skydive ? 0 : this.state === 'dive' ? 0.1 + dive * 0.5 : 1.05 + dive * 0.45; // the dive clip is already horizontal
    this.body.rotation.x += (-lean - this.body.rotation.x) * Math.min(1, dt * 6);
    this.body.position.y += ((skydive ? 1.0 : 0) - this.body.position.y) * Math.min(1, dt * 6);

    if (s.weapon !== this.weaponId) this._setWeapon(s.weapon && WEAPONS[s.weapon] ? s.weapon : null);
    if (L) {
      this.reloadT = fl & 128 ? this.reloadT + dt : 0;
      if (ticked) {
        const w = s.weapon && WEAPONS[s.weapon];
        L.apply(tickDt || dt, {
          moving: speed > 0.6, fwd, side, pitch: s.pitch || 0, crouch: reviving && !A.revive ? 1 : s.crouch || 0, size: this.size, time,
          clipLean: /crouch/i.test(this.state || '') ? 0.35 : 1,
          freeArms: (this.once && (this.once.st === 'mantle' || this.once.st === 'getUp')) || (!!skydive && !!A.skydive) || (!!healing && !!A.heal) || (!!reviving && !!A.revive) || (this.castAction && this.castT < 0.55),
          downed: !!downed && !(A.downed && /crawl/i.test(A.downed.getClip().name)),
          slide: !!slide && !A.slide, skydive: !!skydive && !A.skydive, dive, zip: !!zip,
          tuck: air && !mantle && !skydive && !zip && !A.jump ? BODY.tuck : 0,
          armed: !!w, cls: w ? w.cls : null, fore: w ? this.foreLen ?? ({ SMG: 0.22, Shotgun: 0.32, Sniper: 0.38, Marksman: 0.36, LMG: 0.36 }[w.cls] || 0.28) : 0.28,
          kick: this.fireKick, sprint: speed > 6.0 && !this.firedT && !crouched && !air,
          reload: fl & 128 && !A.reload ? (this.reloadT % 1.6) / 1.6 : 0, healing: !!healing && !A.heal,
        });
      }
      this.gun.visible = L.gun.visible;
      if (this.gun.visible) {
        root.updateWorldMatrix(true, false);
        this.gun.position.copy(root.worldToLocal(_gp.copy(L.gun.pos)));
        this.gun.quaternion.copy(root.getWorldQuaternion(_gq).invert().multiply(L.gun.quat));
      }
    }
    // procedural layers on top of the clip: aim pitch through the spine, fire kick
    if (!L && this.spine && !downed && !skydive) {
      const pitch = THREE.MathUtils.clamp(s.pitch || 0, -1.1, 1.1) * 0.6 + this.fireKick * 0.12;
      this.spine.quaternion.copy(this.spinePose);
      this.spine.rotateX(-pitch);
    }

    // gun: at the right hand, pointing where the player aims. The hand position (relative to the
    // character) only changes when the animation ticks, and only the hand's parent chain is updated
    if (!L) this.gun.visible = !!s.weapon && !downed && !skydive && !zip;
    if (!L && this.gun.visible) {
      if (this.hand && (ticked || !this.handLocal)) {
        root.updateWorldMatrix(false, false);
        this.handLocal = root.worldToLocal(this.hand.getWorldPosition(this.handLocal || new THREE.Vector3()));
      }
      if (this.handLocal) this.gun.position.copy(this.handLocal); else this.gun.position.set(0.2, 1.3, -0.3);
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
    // play the pack's death clip on the copy (it holds the last frame)
    const clip = this.actions.death && this.actions.death.getClip();
    if (clip) {
      const mixer = new THREE.AnimationMixer(c);
      const a = mixer.clipAction(clip);
      a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.play();
      c.userData.mixer = mixer;
    }
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
