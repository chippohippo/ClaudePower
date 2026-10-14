// Procedural pose layer for realistic humanoid rigs (Mixamo, Quaternius UBC, Ready Player Me …).
// Runs after the animation mixer, in world space, so it works whatever the bones' local axes are:
//   - legs turn toward the movement direction while the chest keeps facing the aim (strafing)
//   - pelvis drop + upper-body lean for crouch / slide / downed (the numbers in shared/hitbox.js,
//     so the model sits inside its hitbox) with two-bone leg IK keeping the feet planted
//   - aim pitch bends the spine; both hands hold the gun (two-bone arm IK onto grip and handguard),
//     sprint lowers it, reload / heal move the support hand, firing kicks it
//   - skydive spreads the arms, ziplines raise them, downed crawls on hands and knees
// Every pose is optional: a pack clip for that state (crawl, slide, reload …) wins when one exists.

import * as THREE from 'three';
import { BODY, bodyPose } from '../shared/hitbox.js';

const clean = (n) => String(n || '').replace(/^mixamorig[:_]?/i, '').toLowerCase();
const RX = {
  handL: /^(left.?hand|hand[._]?l)$/, handR: /^(right.?hand|hand[._]?r)$/,
  footL: /^(left.?foot|foot[._]?l)$/, footR: /^(right.?foot|foot[._]?r)$/,
  head: /^head$/,
};

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3(), _p = new THREE.Vector3();
const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
const _k1 = new THREE.Vector3(), _k2 = new THREE.Vector3(), _k3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

// Rotate a bone by a world-space rotation (pre-multiplied). Descendants are not refreshed here: every
// world-space read (getWorldPosition / getWorldQuaternion) updates its own ancestor chain, which is
// far cheaper than re-walking a Mixamo hand's 20 finger bones after each rotation.
function rotateWorld(bone, q) {
  bone.parent.getWorldQuaternion(_q2);
  bone.getWorldQuaternion(_q3);
  _q3.premultiply(q);
  bone.quaternion.copy(_q2.invert().multiply(_q3));
}

// Turn a bone so the direction from it to `tip` points along `dir` (world).
function aimBone(bone, tipWorld, dirWorld) {
  bone.getWorldPosition(_p);
  _u.subVectors(tipWorld, _p);
  if (_u.lengthSq() < 1e-10 || dirWorld.lengthSq() < 1e-10) return;
  _q.setFromUnitVectors(_u.normalize(), _v.copy(dirWorld).normalize());
  rotateWorld(bone, _q);
}

// Two-bone IK: upper → lower → end reaches `target`, bending toward `pole` (world positions).
export function solveTwoBone(upper, lower, end, target, pole) {
  upper.getWorldPosition(_a); lower.getWorldPosition(_b); end.getWorldPosition(_c);
  const l1 = _a.distanceTo(_b), l2 = _b.distanceTo(_c);
  if (l1 < 1e-5 || l2 < 1e-5) return;
  _t.subVectors(target, _a);
  const d = Math.min(Math.max(_t.length(), Math.abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4);
  const dir = _t.normalize();
  // bend plane from the pole
  _w.subVectors(pole, _a);
  _w.addScaledVector(dir, -_w.dot(dir));
  if (_w.lengthSq() < 1e-8) { _k1.subVectors(_b, _a); _w.copy(_k1).addScaledVector(dir, -_k1.dot(dir)); }
  _w.normalize();
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const off = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  // knee / elbow direction from the upper joint, then the end along the target line
  _k1.copy(dir).multiplyScalar(along).addScaledVector(_w, off);
  _k3.copy(_a).addScaledVector(dir, d);
  aimBone(upper, lower.getWorldPosition(_k2), _k1);
  lower.getWorldPosition(_b);
  aimBone(lower, end.getWorldPosition(_k2), _k3.sub(_b));
}

export class HumanoidRig {
  constructor(model) {
    const bones = [];
    model.traverse((o) => { if (o.isBone) bones.push(o); });
    const find = (re) => bones.find((b) => re.test(clean(b.name))) || null;
    const chain = (end) => (end && end.parent && end.parent.parent ? { upper: end.parent.parent, lower: end.parent, end } : null);
    this.armL = chain(find(RX.handL)); this.armR = chain(find(RX.handR));
    this.legL = chain(find(RX.footL)); this.legR = chain(find(RX.footR));
    this.head = find(RX.head);
    this.ok = !!(this.armL && this.armR && this.legL && this.legR && this.head);
    if (!this.ok) return;
    this.hips = this.legL.upper.parent;
    // spine bones from the hips up to the neck (exclusive of the head)
    this.spine = [];
    for (let b = this.head.parent; b && b !== this.hips; b = b.parent) this.spine.unshift(b);
    if (!this.spine.length) { this.ok = false; return; }
    this.chest = this.spine[this.spine.length - 2] || this.spine[this.spine.length - 1];
    this.touched = [this.hips, ...this.spine, this.head, ...[this.armL, this.armR, this.legL, this.legR].flatMap((c) => [c.upper, c.lower, c.end])];
    this.rest = this.touched.map((b) => ({ p: b.position.clone(), q: b.quaternion.clone() }));
  }

  // back to the bind pose before the mixer runs, so bones without tracks don't accumulate layers
  restore() { this.touched.forEach((b, i) => { b.position.copy(this.rest[i].p); b.quaternion.copy(this.rest[i].q); }); }
}

// Per-avatar procedural state (smoothed values) + the layer itself.
export class PoseLayer {
  constructor(rig, frame) {
    this.rig = rig;
    this.frame = frame;          // Object3D whose local space is the body frame (x right, y up, -z fwd)
    this.twist = 0;
    this.drop = 0; this.lean = 0;
    this.sprint = 0;
    this.gun = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), visible: false };
  }

  // body-frame point → world
  W(x, y, z, out = new THREE.Vector3()) { return this.frame.localToWorld(out.set(x, y, z)); }

  apply(dt, o) {
    const R = this.rig, f = this.frame;
    f.updateWorldMatrix(true, false);
    const k = Math.min(1, dt * 10);
    const fwdW = this.W(0, 0, -1, new THREE.Vector3()).sub(this.W(0, 0, 0, new THREE.Vector3()));
    const rightW = this.W(1, 0, 0, new THREE.Vector3()).sub(this.W(0, 0, 0, new THREE.Vector3()));
    const upW = this.W(0, 1, 0, new THREE.Vector3()).sub(this.W(0, 0, 0, new THREE.Vector3()));

    // 1. legs toward the movement direction, chest back to the aim
    let tw = 0;
    if (o.moving && !o.downed && !o.skydive && !o.zip && !o.slide) {
      const ang = Math.atan2(o.side, o.fwd);                       // 0 forward, +π/2 right
      tw = Math.abs(ang) <= 1.95 ? THREE.MathUtils.clamp(ang, -1.15, 1.15) * 0.85 : THREE.MathUtils.euclideanModulo(ang + Math.PI, Math.PI * 2) - Math.PI;
      if (Math.abs(ang) > 1.95) tw *= 0.6;
    }
    this.twist += (tw - this.twist) * k;
    if (Math.abs(this.twist) > 1e-3) {
      _q.setFromAxisAngle(upW, -this.twist);
      rotateWorld(R.hips, _q);
      _q.setFromAxisAngle(upW, this.twist);
      rotateWorld(R.spine[0], _q);
    }

    // 2. crouch / slide / downed: pelvis drop + upper-body lean (shared with the hitbox)
    const P = bodyPose(o.downed ? 'downed' : o.slide ? 'slide' : 'stand', o.crouch);
    this.drop += (P.drop - this.drop) * k;
    this.lean += (P.lean - this.lean) * k;
    // feet planted where the clip put them (before the drop), or posed explicitly
    const feet = [R.legL, R.legR].map((L) => L.end.getWorldPosition(new THREE.Vector3()));
    const posed = o.downed || o.slide;
    if (posed) P.ankles.forEach((a, i) => this.W(a[0] * o.size, a[1], a[2], feet[i]));
    else if (o.tuck) feet.forEach((p) => p.addScaledVector(upW, o.tuck));
    if (this.drop > 1e-3) {
      // the model's own hip height (Mixamo ≈ 1.0 m) vs the hitbox pelvis: deep poses aim for the hitbox
      const hipY = f.worldToLocal(R.hips.getWorldPosition(_p)).y;
      const extra = (hipY - BODY.pelvisY) * Math.min(1, this.drop / 0.35);
      R.hips.getWorldPosition(_p).addScaledVector(upW, -this.drop - extra);
      R.hips.position.copy(R.hips.parent.worldToLocal(_p));
    }
    if (Math.abs(this.lean) > 1e-3) { _q.setFromAxisAngle(rightW, -this.lean * 0.6); rotateWorld(R.spine[0], _q); _q.setFromAxisAngle(rightW, -this.lean * 0.4); rotateWorld(R.spine[1] || R.spine[0], _q); }
    if (this.drop > 1e-3 || posed || o.tuck) {
      for (let i = 0; i < 2; i++) {
        const L = i ? R.legR : R.legL;
        // keep feet on the ground plane of the body frame
        const gp = this.frame.worldToLocal(feet[i].clone());
        if (gp.y < BODY.ankleY * 0.8) { gp.y = BODY.ankleY * 0.8; this.frame.localToWorld(gp); feet[i].copy(gp); }
        const pole = L.lower.getWorldPosition(new THREE.Vector3()).addScaledVector(fwdW, 0.6).addScaledVector(rightW, (i ? 1 : -1) * 0.1);
        if (o.downed) pole.addScaledVector(upW, -0.4);
        solveTwoBone(L.upper, L.lower, L.end, feet[i], pole);
      }
    }

    // 3. aim pitch through the spine (the rest goes into the gun)
    const pitch = THREE.MathUtils.clamp(o.pitch, -1.1, 1.1);
    const spinePitch = o.downed || o.skydive ? 0 : pitch * 0.5 + o.kick * 0.1;
    if (Math.abs(spinePitch) > 1e-3) {
      const top = R.spine.slice(1);
      for (const b of top.length ? top : R.spine) { _q.setFromAxisAngle(rightW, spinePitch / (top.length || R.spine.length)); rotateWorld(b, _q); }
    }

    // 4. arms
    const w = o.size;
    const g = this.gun;
    g.visible = o.armed && !o.downed && !o.skydive && !o.zip;
    if (o.skydive) {
      const spread = 0.5 + 0.5 * (o.dive || 0);
      this._arm(R.armL, this.W(-0.72, 1.42 - spread * 0.1, 0.12), this.W(-0.4, 1.2, 0.5));
      this._arm(R.armR, this.W(0.72, 1.42 - spread * 0.1, 0.12), this.W(0.4, 1.2, 0.5));
      return;
    }
    if (o.zip) {
      const Z = BODY.zipHand;
      this._arm(R.armL, this.W(-Z[0], Z[1], Z[2]), this.W(-0.5, 1.6, 0.2));
      this._arm(R.armR, this.W(Z[0], Z[1], Z[2]), this.W(0.5, 1.6, 0.2));
      return;
    }
    if (o.downed) {
      const cyc = o.moving ? Math.sin(o.time * 6) * 0.12 : 0;
      const H = BODY.downHand;
      this._arm(R.armL, this.W(-H[0] * w, H[1], H[2] + cyc), this.W(-0.6, 0.5, -0.1));
      this._arm(R.armR, this.W(H[0] * w, H[1], H[2] - cyc), this.W(0.6, 0.5, -0.1));
      return;
    }
    // gun frame: right shoulder pivot, remaining pitch, sprint low-ready
    this.sprint += ((o.sprint ? 1 : 0) - this.sprint) * Math.min(1, dt * 6);
    const shoulder = R.armR.upper.getWorldPosition(new THREE.Vector3());
    const sh = this.frame.worldToLocal(shoulder.clone());
    const gunPitch = (o.healing ? -0.9 : pitch - spinePitch + 0.0) - this.sprint * 0.55;
    const gunYaw = this.sprint * 0.45;
    const e = new THREE.Euler(gunPitch, gunYaw, -this.sprint * 0.25, 'YXZ');
    const pistol = o.cls === 'Pistol';
    // grip below and in front of the shoulder (BODY.handR relative to the shoulder), kicked back
    const off = new THREE.Vector3(BODY.handR[0] - BODY.shoulderX, BODY.handR[1] - BODY.shoulderY, BODY.handR[2] - o.kick * 0.06);
    if (pistol) off.set(-0.12, -0.08, -0.42 - o.kick * 0.05);
    off.applyEuler(e);
    const grip = sh.clone().add(off);
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(e);
    const fore = pistol ? grip.clone().add(new THREE.Vector3(-0.05, -0.02, 0.02)) : grip.clone().addScaledVector(dir, o.fore || 0.28).add(new THREE.Vector3(0, -0.03, 0));
    if (o.reload > 0) {
      // support hand down to the magazine and back
      const r = Math.sin(Math.min(1, o.reload) * Math.PI);
      fore.lerp(grip.clone().addScaledVector(dir, 0.1).add(new THREE.Vector3(-0.04, -0.16, 0)), r);
    }
    if (o.healing) fore.set(-0.06, 1.28, -0.2);
    this._arm(R.armR, this.frame.localToWorld(grip.clone()), this.W(sh.x + 0.4, sh.y - 0.55, sh.z + 0.25));
    this._arm(R.armL, this.frame.localToWorld(fore.clone()), this.W(-0.45, sh.y - 0.6, sh.z + 0.05));
    // gun world transform for the avatar to copy
    this.frame.localToWorld(g.pos.copy(grip));
    this.frame.getWorldQuaternion(g.quat).multiply(_q.setFromEuler(e));
  }

  _arm(chain, target, pole) { solveTwoBone(chain.upper, chain.lower, chain.end, target, pole); }
}
