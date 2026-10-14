// First-person arms cut from the player's own legend body (outfits.js), so the sleeves, gloves and
// bracers in first person are the ones teammates see. The body hangs off-screen around the camera
// (scaled up a little, like every FPS viewmodel, so the hands reach the gun), the suit shader drops
// everything but the arms, two-bone IK puts the wrists on the grip and handguard, and the hands are
// turned and the fingers curled around them.

import * as THREE from 'three';
import { assets } from './assets.js';
import { solveTwoBone, rotateWorld } from './humanoid.js';
import { fpSuitMaterial } from './outfits.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _gq = new THREE.Quaternion();
const ARM = /^(clavicle|upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)/i;
const FINGERS = ['index', 'middle', 'ring', 'pinky'];

export class FpArms {
  static create(legend) {
    const c = assets.character(legend);
    if (!c || !c.def.outfit) return null;
    return new FpArms(c);
  }

  constructor(c) {
    this.root = new THREE.Group();
    this.root.add(c.root);
    const model = c.model;
    const B = {};
    model.traverse((o) => { if (o.isBone) B[o.name.toLowerCase()] = o; });
    this.B = B;
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false; o.frustumCulled = false;
      if (o.isSkinnedMesh) {
        if (o.geometry.attributes.aRest) o.material = fpSuitMaterial(o.material);
        else o.visible = false;                         // hair, eyes, eyebrows
      } else if (o.userData.gear) {
        // only gear on the forearms / hands (bracers, elbow pads, gloves)
        let p = o.parent; while (p && !p.isBone) p = p.parent;
        o.visible = !!p && /^(lowerarm|hand)/i.test(p.name);
      }
    });
    this.arms = ['r', 'l'].map((s) => ({ upper: B['upperarm_' + s], lower: B['lowerarm_' + s], hand: B['hand_' + s], s }));
    this.ok = this.arms.every((a) => a.upper && a.lower && a.hand);
    this.touched = [];
    model.traverse((o) => { if (o.isBone && ARM.test(o.name)) this.touched.push(o); });
    this.rest = this.touched.map((b) => b.quaternion.clone());
    // place the body: mid-shoulder point just below and behind the camera, facing -Z. Viewmodel guns
    // sit further out than a real shoulder-mounted rifle, so the arm bones are lengthened (hands keep
    // their real size) and the shoulders brought forward; only the forearms and hands are on screen.
    for (const s of ['l', 'r']) {
      B['lowerarm_' + s].position.multiplyScalar(1.3);
      B['hand_' + s].position.multiplyScalar(1.3);
    }
    c.root.updateMatrixWorld(true);
    const mid = B.upperarm_r.getWorldPosition(new THREE.Vector3()).add(B.upperarm_l.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
    c.root.position.sub(mid).add(new THREE.Vector3(0.04, -0.27, -0.42));
    this.body = c.root;
  }

  // gun: the gun holder (grip at its origin, barrel along -Z); fore: handguard distance from the
  // grip; left: optional world-space override for the support hand (reloads)
  update(gun, fore, pistol, left = null, curl = 1) {
    if (!this.ok) return;
    this.touched.forEach((b, i) => b.quaternion.copy(this.rest[i]));
    this.root.updateMatrixWorld(true);
    gun.updateMatrixWorld(true);
    gun.getWorldQuaternion(_gq);
    const G = (x, y, z) => gun.localToWorld(new THREE.Vector3(x, y, z));
    const D = (x, y, z) => new THREE.Vector3(x, y, z).normalize().applyQuaternion(_gq);
    const [R, L] = this.arms;
    // right hand on the pistol grip: wrist behind and below it, fingers wrapping from the right
    solveTwoBone(R.upper, R.lower, R.hand, G(0.022, -0.045, 0.085), G(0.45, -0.55, 0.35));
    this._orient(R, D(-0.25, -0.35, -1), D(0, -1, 0.35), 0.95 * curl, 1);
    // support hand under the handguard (or cupping the pistol hand)
    const lw = pistol ? G(-0.035, -0.06, 0.05) : G(-0.045, -0.075, -fore + 0.05);
    if (left) lw.lerp(left, left.w ?? 1);
    solveTwoBone(L.upper, L.lower, L.hand, lw, G(-0.6, -0.7, 0.2));
    if (pistol) this._orient(L, D(0.75, -0.1, -0.65), D(0, -1, 0.25), 1.25 * curl, -1);
    else this._orient(L, D(0.65, 0.65, -0.4), D(0, 0.1, 1), 1.05 * curl, -1);
  }

  // turn the hand so its fingers point along `fdir` with the knuckle line along `across`, then curl
  _orient(A, fdir, across, curl, side) {
    const B = this.B, s = A.s;
    const mid = B['middle_01_' + s], idx = B['index_01_' + s], pin = B['pinky_01_' + s];
    if (!mid || !idx || !pin) return;
    A.hand.getWorldPosition(_a);
    mid.getWorldPosition(_b);
    _q.setFromUnitVectors(_b.sub(_a).normalize(), fdir);
    rotateWorld(A.hand, _q);
    pin.getWorldPosition(_b); idx.getWorldPosition(_c);
    const cur = _b.sub(_c).projectOnPlane(fdir).normalize(), want = across.clone().projectOnPlane(fdir).normalize();
    if (cur.lengthSq() > 1e-6 && want.lengthSq() > 1e-6) { _q.setFromUnitVectors(cur, want); rotateWorld(A.hand, _q); }
    // curl every finger joint about the knuckle line (positive = toward the palm)
    const axis = across.clone().normalize().multiplyScalar(-side);
    for (const f of FINGERS) for (let j = 1; j <= 3; j++) {
      const b = B[`${f}_0${j}_${s}`];
      if (!b) continue;
      _q.setFromAxisAngle(axis, curl * (j === 1 ? 0.9 : 0.75));
      rotateWorld(b, _q);
    }
    const t = B['thumb_02_' + s];
    if (t) { _q.setFromAxisAngle(fdir, side * 0.5 * curl); rotateWorld(t, _q); }
  }
}
