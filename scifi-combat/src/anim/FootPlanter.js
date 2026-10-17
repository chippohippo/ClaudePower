// FootPlanter: world-space foot planting for standing and crouched locomotion.
//
// A planted foot never moves in world space, so feet can't slide. How steps are timed:
//  * The step clock advances by distance travelled / half a stride, so cadence always matches
//    ground speed. Animation rate scales with movement speed by construction, not by tuning.
//  * Each step lifts the trailing foot and swings it to a landing point predicted from the
//    velocity: under the hip halfway through its stance. The prediction updates every frame, so
//    turns, strafes and speed changes steer the swing while it's in the air.
//  * Swing progress is distance-based too (a swing lasts (1 - duty) of a stride of body travel),
//    so a foot lands where the body needs it, even mid-acceleration.
//  * Running duty factors are below 0.5, which gives a real flight phase (the heavy HD2 sprint
//    bound); walking and crouching have double support.
//  * Heel strike calls `onPlant`. The rig turns that into `anim:footstep`, which camera bob,
//    footstep audio and dust all hang off, so they are frame-synced to the visible plant.
//  * Standing still, settle steps put the feet back under the hips when the body turns in place.
//  * Planted feet roll: heel strike (toe up, pivoting on the heel), flat, then heel rise
//    (pivoting on the toe) before lift-off.

import { Vector3 } from 'three';
import { clamp, ease, smoothstep, lerp, lerpAngle, angleDelta, forwardOf, rightOf } from './ik.js';

const _fwd = new Vector3();
const _right = new Vector3();
const _v = new Vector3();
const _rest = new Vector3();
const _r2 = new Vector3();
const _f2 = new Vector3();

const mkFoot = (side, index) => ({
  side, index,                          // side: -1 left, +1 right
  planted: true,
  plant: new Vector3(), yaw: 0,         // ground point under the ankle while planted, and foot yaw
  from: new Vector3(), fromYaw: 0,      // swing start
  target: new Vector3(), targetYaw: 0,  // predicted landing (re-predicted every frame)
  u: 0, swingDist: 1, swingTime: 0.2, lift: 0.1, settle: false, byDistance: false,
  stanceTravel: 0, stanceLen: 1,        // body travel since the plant (drives the foot roll)
  roll: 1,                              // +1 walking forward over the foot, -1 backward, ~0 side-stepping
  pos: new Vector3(),                   // current ground-contact point (moves only while swinging)
  ankle: new Vector3(), pitch: 0,       // outputs: ankle target and foot pitch (+ = toe up)
});

export class FootPlanter {
  /**
   * @param {object} dims    { ankleH, heel, toe } (scaled by the rig)
   * @param {function} onPlant (foot, kind: 'step' | 'settle') at heel strike
   */
  constructor(dims, onPlant = () => {}) {
    this.dims = dims;
    this.onPlant = onPlant;
    this.feet = [mkFoot(-1, 0), mkFoot(1, 1)];
    this.clock = 0;          // 0..1 per step
    this.walking = false;
    this.initialized = false;
    this.cfg = null;
    this.dir = new Vector3(0, 0, -1);   // travel direction this frame
  }

  get swinging() { return !this.feet[0].planted || !this.feet[1].planted; }

  /** Plants both feet at their rest positions around `root`. */
  reset(root, yaw, cfg) {
    this.cfg = cfg ?? this.cfg;
    for (const f of this.feet) {
      this.#restPos(f, root, yaw, f.plant);
      f.yaw = yaw - f.side * this.cfg.toeOut;
      f.planted = true; f.u = 0; f.settle = false;
      f.stanceTravel = 0.4; f.stanceLen = 1;
      f.pos.copy(f.plant);
    }
    this.walking = false; this.clock = 0;
    this.initialized = true;
    this.#outputs(root);
  }

  /** Re-plants the feet where special poses left them (no snapping when locomotion resumes). */
  resetTo(ankles, yaw, root, cfg, groundY) {
    this.reset(root, yaw, cfg);
    for (const f of this.feet) {
      const a = ankles[f.index];
      if (!a || Math.hypot(a.x - root.x, a.z - root.z) > 0.9) continue;
      f.plant.set(a.x, this.#ground(a.x, a.z, root.y, groundY), a.z);
      f.pos.copy(f.plant);
    }
    this.#outputs(root);
  }

  /**
   * @param {object} c { dt, root (ground point under the pelvis), yaw (lateral axis), vel (world),
   *                     travel (horizontal metres moved this frame), speed, stride, duty, land,
   *                     lift, heelRise, width, stagger, toeOut, reach, groundY(x, z) | null }
   */
  update(c) {
    this.cfg = c;
    if (!this.initialized) this.reset(c.root, c.yaw, c);
    const moving = this.walking ? c.speed > 0.25 : c.speed > 0.45;   // hysteresis
    const vx = c.vel.x, vz = c.vel.z, vl = Math.hypot(vx, vz);
    if (vl > 0.05) _fwd.set(vx / vl, 0, vz / vl); else forwardOf(c.yaw, _fwd);
    this.dir.copy(_fwd);
    rightOf(c.yaw, _right);

    if (moving) {
      if (!this.walking) { this.walking = true; this.clock = 1; }   // start: step immediately
      else this.clock += c.travel / Math.max(0.2, c.stride * 0.5);
      // Stretch guard: a planted foot past its reach steps now (hard accelerations, reversals,
      // landing at a sprint). It restarts the step clock, so the rhythm re-forms around it.
      let forced = null, worst = c.reach;
      for (const f of this.feet) {
        if (!f.planted) continue;
        const hx = c.root.x + _right.x * f.side * c.width, hz = c.root.z + _right.z * f.side * c.width;
        const d = Math.hypot(f.ankle.x - hx, f.ankle.z - hz);
        if (d > worst) { worst = d; forced = f; }
      }
      if (forced || this.clock >= 1) {
        this.clock = forced ? 0 : this.clock % 1;
        // The step goes to whichever planted foot trails furthest behind: alternation can't
        // fall out of phase, whatever happened before (landings, mantles, re-plants).
        const f = forced ?? this.#trailing(c.root);
        if (f) this.#liftoff(f, c);
      }
    }

    for (const f of this.feet) {
      if (f.planted) { f.stanceTravel += c.travel; continue; }
      const byDistance = moving && !f.settle;
      f.byDistance = byDistance;
      f.u = Math.min(1, f.u + (byDistance ? c.travel / f.swingDist : c.dt / f.swingTime));
      if (byDistance) {
        // Land ahead of where the hip will be, by `land` of the coming stance. Real runners land
        // short (about 40%) and push off long behind on the toes.
        const ahead = (1 - f.u) * f.swingDist + c.duty * c.stride * (c.land ?? 0.5);
        f.target.set(c.root.x + _fwd.x * ahead + _right.x * f.side * c.width, 0, c.root.z + _fwd.z * ahead + _right.z * f.side * c.width);
        f.targetYaw = c.yaw - f.side * c.toeOut * 0.5;
      } else {
        this.#restPos(f, c.root, c.yaw, f.target);
        f.targetYaw = c.yaw - f.side * c.toeOut;
      }
      f.target.y = this.#ground(f.target.x, f.target.z, c.root.y, c.groundY);
      if (f.u >= 1) this.#land(f, c, _fwd);
    }

    if (!moving && !this.swinging) {
      this.walking = false;
      // Settle: one foot at a time steps back under the hip (turning in place, after a stop).
      let worst = null, worstErr = 0;
      for (const f of this.feet) {
        this.#restPos(f, c.root, c.yaw, _rest);
        const err = Math.hypot(f.plant.x - _rest.x, f.plant.z - _rest.z) + Math.abs(angleDelta(c.yaw - f.side * c.toeOut, f.yaw)) * 0.22;
        if (err > worstErr) { worstErr = err; worst = f; }
      }
      if (worst && worstErr > 0.13) {
        worst.planted = false; worst.u = 0; worst.settle = true;
        worst.from.copy(worst.plant); worst.fromYaw = worst.yaw;
        worst.swingTime = 0.2; worst.lift = 0.05;
      }
    }
    this.#outputs(c.root);
  }

  #trailing(root) {
    let best = null, bestAlong = Infinity;
    for (const f of this.feet) {
      if (!f.planted) continue;
      const along = (f.ankle.x - root.x) * _fwd.x + (f.ankle.z - root.z) * _fwd.z;
      if (along < bestAlong) { bestAlong = along; best = f; }
    }
    return best;
  }

  #liftoff(f, c) {
    f.planted = false; f.u = 0; f.settle = false;
    f.from.copy(f.plant); f.fromYaw = f.yaw;
    f.swingDist = Math.max(0.15, (1 - c.duty) * c.stride);
    f.swingTime = f.swingDist / Math.max(c.speed, 0.5);
    f.lift = c.lift;
  }

  #land(f, c, travelDir) {
    f.planted = true;
    f.plant.copy(f.target);
    f.yaw = f.targetYaw;
    // Roll direction: forward walking strikes the heel and pushes off the toe; backpedalling is
    // the mirror image (toe strike, heel push-off); side-steps stay flat.
    f.roll = f.settle ? 0 : clamp(-(Math.sin(f.yaw) * travelDir.x + Math.cos(f.yaw) * travelDir.z), -1, 1);
    f.stanceTravel = 0;
    f.stanceLen = Math.max(0.2, c.duty * c.stride);
    f.pos.copy(f.plant);
    this.onPlant(f, f.settle ? 'settle' : 'step');
    f.settle = false;
  }

  #restPos(f, root, yaw, out) {
    const c = this.cfg;
    rightOf(yaw, _r2); forwardOf(yaw, _f2);
    return out.set(
      root.x + _r2.x * f.side * c.width - _f2.x * f.side * c.stagger,
      root.y,
      root.z + _r2.z * f.side * c.width - _f2.z * f.side * c.stagger,
    );
  }

  #ground(x, z, rootY, groundY) {
    const g = groundY?.(x, z);
    return g === null || g === undefined || Math.abs(g - rootY) > 0.4 ? rootY : g;
  }

  /** Contact point, ankle target and foot pitch for each foot. */
  #outputs(root) {
    const { ankleH, heel, toe } = this.dims;
    for (const f of this.feet) {
      if (f.planted) {
        f.pos.copy(f.plant);
        // Foot roll: heel strike (pivot on the heel), flat, heel rise (pivot on the toe). Mirrored
        // when backpedalling, flat when side-stepping.
        const p = this.walking ? f.stanceTravel / f.stanceLen : 0.4;
        const roll = this.walking ? f.roll : 0;
        f.pitch = (p < 0.12 ? lerp(0.18, 0, p / 0.12) : -(this.cfg.heelRise ?? 0.9) * smoothstep(0.55, 1.0, p)) * roll;
        forwardOf(f.yaw, _v);
        const ca = Math.cos(f.pitch), sa = Math.sin(f.pitch);
        if (f.pitch > 0) {
          // rotate the heel→ankle vector (heel forward, ankleH up) about the heel
          const fx = heel * ca - ankleH * sa, fy = heel * sa + ankleH * ca;
          f.ankle.set(f.plant.x - _v.x * heel + _v.x * fx, f.plant.y + fy, f.plant.z - _v.z * heel + _v.z * fx);
        } else if (f.pitch < 0) {
          const fx = -toe * ca - ankleH * sa, fy = -toe * sa + ankleH * ca;
          f.ankle.set(f.plant.x + _v.x * toe + _v.x * fx, f.plant.y + fy, f.plant.z + _v.z * toe + _v.z * fx);
        } else f.ankle.set(f.plant.x, f.plant.y + ankleH, f.plant.z);
      } else {
        const e = ease(f.u);
        // Lift peaks early and the foot comes down fast at the end: a heavy plant, not a tiptoe.
        const h = f.lift * Math.sin(Math.PI * Math.pow(f.u, 0.7));
        f.pos.set(lerp(f.from.x, f.target.x, e), lerp(f.from.y, f.target.y, e) + h, lerp(f.from.z, f.target.z, e));
        f.yaw = lerpAngle(f.fromYaw, f.targetYaw, e);
        f.pitch = f.u < 0.3 ? lerp(-0.5, 0, f.u / 0.3) : lerp(0, 0.2, clamp((f.u - 0.3) / 0.7, 0, 1));
        f.ankle.set(f.pos.x, f.pos.y + ankleH, f.pos.z);
      }
    }
    return root;
  }
}
