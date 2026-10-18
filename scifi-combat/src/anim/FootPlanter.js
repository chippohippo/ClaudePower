// FootPlanter: world-space foot planting for standing and crouched locomotion.
//
// A planted foot never moves in world space, so feet can't slide. How steps are timed:
//  * The step clock advances by distance travelled / half a stride, so cadence always matches
//    ground speed. Animation rate scales with movement speed by construction, not by tuning.
//  * Each step lifts the trailing foot and swings it to a landing point predicted from the
//    velocity: under the hip halfway through its stance. The prediction updates every frame, so
//    turns, strafes and speed changes steer the swing while it's in the air. The swing heads for
//    the prediction at a speed a foot can move (maxAimSpeed), so a prediction that jumps (a sprint
//    reversal, a sudden stop) steers the foot instead of teleporting it.
//  * Swing progress is distance-based too (a swing lasts (1 - duty) of a stride of body travel),
//    so a foot lands where the body needs it, even mid-acceleration.
//  * Running duty factors are below 0.5, which gives a real flight phase (the heavy HD2 sprint
//    bound); walking and crouching have double support.
//  * Heel strike calls `onPlant`. The rig turns that into `anim:footstep`, which camera bob,
//    footstep audio and dust all hang off, so they are frame-synced to the visible plant.
//  * Standing still, settle steps put the feet back under the hips when the body turns in place.
//  * Planted feet roll: heel strike (toe up, pivoting on the heel), flat, then heel rise
//    (pivoting on the toe) before lift-off. The swing starts from the rolled foot (the ankle eases
//    off the toe pivot), and a stop lets the roll settle flat instead of snapping it.

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
  aim: new Vector3(), aimed: false,     // where the swing is heading: follows target at a foot's speed
  u: 0, swingDist: 1, swingTime: 0.2, lift: 0.1, clear: 0, settle: false, byDistance: false,
  stanceTravel: 0, stanceLen: 1,        // body travel since the plant (drives the foot roll)
  roll: 1,                              // +1 walking forward over the foot, -1 backward, ~0 side-stepping
  pos: new Vector3(),                   // current ground-contact point (moves only while swinging)
  liftOff: new Vector3(), liftPitch: 0, // ankle offset and pitch at toe-off (the swing starts from them)
  rollW: 0,                             // foot roll weight: eases in walking, out standing
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
      f.stanceTravel = 0.4; f.stanceLen = 1; f.rollW = 0;
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
   *                     lift, heelRise, width, stagger, toeOut, reach, groundY(x, z, nearY) | null,
   *                     offBody(point, dir) | null: moves a landing off anyone lying there,
   *                     lying(x0, z0, x1, z1) | null: how high to lift to clear a body lying across a swing }
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
      const du = byDistance ? c.travel / f.swingDist : c.dt / f.swingTime;
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
      // Not on a man lying there: the landing goes on past him, or short of him (BodyContacts).
      if (c.offBody) c.offBody(f.target, _fwd);
      f.target.y = this.#ground(f.target.x, f.target.z, c.root.y, c.groundY);
      f.u = Math.min(1, f.u + this.#steer(f, c, du));
      // What lies across this swing (a body), to lift the foot over it: eased in early in the
      // swing, never snapped on (or off) mid-stride.
      if (c.lying) {
        const want = f.u < 0.6 ? c.lying(f.from.x, f.from.z, f.aim.x, f.aim.z) : f.clear;
        f.clear += (want - f.clear) * Math.min(1, c.dt * 14);
      }
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
        this.#takeOff(worst);
        worst.planted = false; worst.u = 0; worst.settle = true; worst.aimed = false;
        worst.from.copy(worst.plant); worst.fromYaw = worst.yaw;
        worst.swingTime = 0.2; worst.lift = 0.05;
      }
    }
    this.#outputs(c.root, c.dt);
  }

  /** Where the rolled foot's ankle sits off its flat position at toe-off: the swing eases out of it. */
  #takeOff(f) {
    f.liftOff.set(f.ankle.x - f.plant.x, f.ankle.y - f.plant.y - this.dims.ankleH, f.ankle.z - f.plant.z);
    f.liftPitch = f.pitch;
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
    this.#takeOff(f);
    f.planted = false; f.u = 0; f.settle = false; f.aimed = false;
    f.from.copy(f.plant); f.fromYaw = f.yaw;
    f.swingDist = Math.max(0.15, (1 - c.duty) * c.stride);
    f.swingTime = f.swingDist / Math.max(c.speed, 0.5);
    f.lift = c.lift; f.clear = 0;
  }

  /**
   * The swing's aim follows the predicted landing at most at a foot's speed (m/s). While it's
   * still catching up, the swing is held short of touchdown, so the foot lands where it's needed.
   */
  #steer(f, c, du) {
    if (!f.aimed) { f.aim.copy(f.target); f.aimed = true; }
    const dx = f.target.x - f.aim.x, dz = f.target.z - f.aim.z, d = Math.hypot(dx, dz);
    const speed = (c.maxAimSpeed ?? 6) * (1 + 0.25 * c.speed), max = speed * c.dt;
    if (d > max) { f.aim.x += (dx / d) * max; f.aim.z += (dz / d) * max; } else { f.aim.x = f.target.x; f.aim.z = f.target.z; }
    f.aim.y = d > max ? this.#ground(f.aim.x, f.aim.z, c.root.y, c.groundY) : f.target.y;
    // Time the aim still needs to arrive; the swing can't finish sooner (it slows, never reverses).
    const left = Math.max(0, d - max) / speed;
    return left > 0 ? Math.min(du, Math.max(0, 1 - f.u) * c.dt / (left + c.dt)) : du;
  }

  #land(f, c, travelDir) {
    f.planted = true;
    f.plant.copy(f.aim);
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
    const g = groundY?.(x, z, rootY);
    return g === null || g === undefined || Math.abs(g - rootY) > 0.4 ? rootY : g;
  }

  /** Contact point, ankle target and foot pitch for each foot. */
  #outputs(root, dt = 0) {
    const { ankleH, heel, toe } = this.dims;
    for (const f of this.feet) {
      f.rollW += ((this.walking ? 1 : 0) - f.rollW) * (dt > 0 ? 1 - Math.exp(-10 * dt) : 0);
      if (f.planted) {
        f.pos.copy(f.plant);
        // Foot roll: heel strike (pivot on the heel), flat, heel rise (pivot on the toe). Mirrored
        // when backpedalling, flat when side-stepping. Stopping lets it settle flat.
        const p = f.stanceTravel / f.stanceLen;
        const roll = f.roll * f.rollW;
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
        // Up a step (a kerb, a stair, a sandbag lip) the foot gets to the new level early and lifts
        // higher by about the step, clearing its edge; down one it stays up until late; across
        // someone lying there it clears him.
        const rise = f.aim.y - f.from.y;
        const lvl = rise > 0.03 ? smoothstep(0, 0.6, f.u) : rise < -0.03 ? smoothstep(0.3, 1, f.u) : e;
        const h = (f.lift + Math.max(0, rise) * 0.6 + f.clear) * Math.sin(Math.PI * Math.pow(f.u, 0.7));
        f.pos.set(lerp(f.from.x, f.aim.x, e), f.from.y + rise * lvl + h, lerp(f.from.z, f.aim.z, e));
        f.yaw = lerpAngle(f.fromYaw, f.targetYaw, e);
        // Out of the toe-off: the ankle leaves the toe pivot and the pitch blends into the swing's.
        const k = 1 - smoothstep(0, 0.35, f.u);
        const pitch = f.u < 0.3 ? lerp(-0.5, 0, f.u / 0.3) : lerp(0, 0.2, clamp((f.u - 0.3) / 0.7, 0, 1));
        f.pitch = lerp(pitch, f.liftPitch, k);
        f.ankle.set(f.pos.x + f.liftOff.x * k, f.pos.y + ankleH + f.liftOff.y * k, f.pos.z + f.liftOff.z * k);
      }
    }
    return root;
  }
}
