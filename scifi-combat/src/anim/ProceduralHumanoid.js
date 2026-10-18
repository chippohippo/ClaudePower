// ProceduralHumanoid: a procedural, Helldivers 2-style character rig. Presentation only: it reads
// the simulation and never writes to it. Spec: docs/ANIMATION.md. Data: data/animation/humanoid.json.
//
// Every render frame it solves a full-body pose from the fighter's state:
//  * Lower body: world-space foot planting (FootPlanter) with distance-timed steps, so feet
//    never slide and cadence always matches speed. 2-bone IK legs with foot roll. The pelvis
//    drops whenever a planted foot would overstretch, so a planted foot is always reached.
//  * Body: leans into acceleration like an inverted pendulum (punchy starts, braced skids,
//    banked carves). Hips follow strafes while the chest stays on the aim. A compression spring
//    kicked by every heel strike and landing gives the heavy thud.
//  * Stances and committed moves are pose-parameter blends. Stand, crouch, prone and supine,
//    plus kneel, push-up and sit-up keys for transitions that follow the sim's stanceT progress
//    exactly (prone get-ups raise the chest before the hips). Slide, belly slide, dive (forward,
//    side, back), hop, mantle (hands planted on the ledge), knockdown (tumble, lying, front or
//    back get-up), bike seat, melee evades and death each have their own poses.
//  * Upper body: the rifle is shouldered whenever it can fire and at port arms while sprinting
//    or climbing. It comes up on exactly the sim's sprint-to-fire timer, so the gun is visibly
//    up the moment it can shoot. ADS cheek weld. Reload, vent and swap hand paths run on the
//    weapon's own timers. Flame-sword keyframes per attack phase: a held windup tell, an
//    accelerating strike and a committed follow-through.
//  * Ragdolls (blasts, critical hits, downs, deaths): the body is drawn straight from the sim's
//    physics particles (interpolated between ticks), blended in from the animated pose over
//    blend.ragdollIn and back out into whatever comes next (get-up, downed crawl) over
//    blend.ragdollOut, so nothing pops either way. Corpses stay where they fell.
//  * Downed: lying where the body came to rest, one hand pressed to the wound (the rifle slung),
//    the other arm pulling when it crawls; heavy breathing. Reviving: kneeling over the patient,
//    both hands on their chest.
//  * Additive layers that never touch the legs: recoil, hit flinch, breathing (heavy when out of stamina).
//  * Secondary motion: a verlet cape for follow-through.
//  * Events (LOD 0 only): anim:footstep on every heel strike, anim:impact when the body hits
//    the ground (dive landing, slide, prone drop, knockdown, ledge hand plants) and anim:cloth on
//    big motions. Camera bob and foley audio hang off these, so they're frame-synced to the pose.
//
// Output: `j` (joints), `F` (pelvis/chest/head frames), `prop` (gun or blade), `cape` (points),
// `planter.feet` (ankle, yaw, pitch). CrowdRenderer turns that into instances.

import { Vector3 } from 'three';
import { bus } from '../core/EventBus.js';
import { Spring } from '../core/Spring.js';
import { FootPlanter } from './FootPlanter.js';
import { MotionEvents, transitionPath } from './MotionEvents.js';
import { silhouetteScale, chestPoint } from '../movement/Hitboxes.js';
import { J } from '../physics/Ragdoll.js';
import {
  clamp, lerp, ease, easeOut, easeIn, smoothstep, table, angleDelta, lerpAngle, approach,
  forwardOf, rightOf, bodyFrame, makeFrame, frameToWorld, frameDir, twoBoneIK,
} from './ik.js';

const G = 9.8;
const TAU = Math.PI * 2;
const UP = new Vector3(0, 1, 0);
const _f = new Vector3();
const _r = new Vector3();
const _v = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _d = new Vector3();
const _pole = new Vector3();
const KEYS = ['loco', 'slide', 'belly', 'dive', 'air', 'mantle', 'knock', 'seated', 'dodge', 'roll', 'dead', 'downed'];
const JOINT_ARRAYS = ['hip', 'knee', 'ankle', 'shoulder', 'elbow', 'hand'];
const JOINT_POINTS = ['pelvis', 'neck', 'neckTop', 'head', 'chestC'];
const newJoints = () => ({
  pelvis: new Vector3(), neck: new Vector3(), neckTop: new Vector3(), head: new Vector3(), chestC: new Vector3(),
  hip: [new Vector3(), new Vector3()], knee: [new Vector3(), new Vector3()], ankle: [new Vector3(), new Vector3()],
  shoulder: [new Vector3(), new Vector3()], elbow: [new Vector3(), new Vector3()], hand: [new Vector3(), new Vector3()],
  footYaw: [0, 0], footPitch: [0, 0],
});
function copyJoints(dst, src) {
  for (const k of JOINT_POINTS) dst[k].copy(src[k]);
  for (const k of JOINT_ARRAYS) { dst[k][0].copy(src[k][0]); dst[k][1].copy(src[k][1]); }
  for (let i = 0; i < 2; i++) { dst.footYaw[i] = src.footYaw[i]; dst.footPitch[i] = src.footPitch[i]; }
  return dst;
}
/** dst = lerp(a, b, t) joint by joint (a moved by `shift` first, if given). */
function lerpJoints(dst, a, b, t, shift = null) {
  const sx = shift?.x ?? 0, sy = shift?.y ?? 0, sz = shift?.z ?? 0;
  const one = (o, p, q) => o.set(p.x + sx + (q.x - p.x - sx) * t, p.y + sy + (q.y - p.y - sy) * t, p.z + sz + (q.z - p.z - sz) * t);
  for (const k of JOINT_POINTS) one(dst[k], a[k], b[k]);
  for (const k of JOINT_ARRAYS) { one(dst[k][0], a[k][0], b[k][0]); one(dst[k][1], a[k][1], b[k][1]); }
  for (let i = 0; i < 2; i++) { dst.footYaw[i] = lerpAngle(a.footYaw[i], b.footYaw[i], t); dst.footPitch[i] = lerp(a.footPitch[i], b.footPitch[i], t); }
  return dst;
}
/** Frame (r, d, n) from a right-ish and an up-ish vector: d = up, r ⟂ d, n = d × r (front). */
function frameFromAxes(F, right, up) {
  F.d.copy(up).normalize();
  F.r.copy(right).addScaledVector(F.d, -right.dot(F.d));
  if (F.r.lengthSq() < 1e-8) F.r.set(1, 0, 0);
  F.r.normalize();
  F.n.crossVectors(F.d, F.r);
  return F;
}

/** One set of pose parameters. Poses are blended by normalized accumulation (order independent). */
class Pose {
  constructor() {
    this.pelvis = new Vector3();
    this.yawP = 0; this.pitchP = 0; this.spinP = 0; this.leanP = 0;
    this.yawC = 0; this.pitchC = 0; this.spinC = 0; this.leanC = 0;
    this.foot = [new Vector3(), new Vector3()];
    this.footPitch = [0, 0];
    this.footYaw = [0, 0];
    this.knee = [new Vector3(0, 0, -1), new Vector3(0, 0, -1)];
    this.hand = [new Vector3(), new Vector3()];
    this.handW = [0, 0];      // 1 = the pose places this hand (ground, ledge, handlebars)
    this.aimW = 1;            // how much the chest may twist toward the aim
    this.headW = 1;           // how much the head follows the look
    this.gunUp = 1;           // 0 forces the weapon down (climbing, getting up)
  }
  copy(o) {
    this.pelvis.copy(o.pelvis);
    this.yawP = o.yawP; this.pitchP = o.pitchP; this.spinP = o.spinP; this.leanP = o.leanP;
    this.yawC = o.yawC; this.pitchC = o.pitchC; this.spinC = o.spinC; this.leanC = o.leanC;
    for (let i = 0; i < 2; i++) {
      this.foot[i].copy(o.foot[i]); this.footPitch[i] = o.footPitch[i]; this.footYaw[i] = o.footYaw[i];
      this.knee[i].copy(o.knee[i]); this.hand[i].copy(o.hand[i]); this.handW[i] = o.handW[i];
    }
    this.aimW = o.aimW; this.headW = o.headW; this.gunUp = o.gunUp;
    return this;
  }
  /** this = lerp(this, o, t), with hands blended by their own weights. */
  mix(o, t) {
    this.pelvis.lerp(o.pelvis, t);
    this.yawP = lerpAngle(this.yawP, o.yawP, t); this.pitchP = lerp(this.pitchP, o.pitchP, t);
    this.spinP = lerp(this.spinP, o.spinP, t); this.leanP = lerp(this.leanP, o.leanP, t);
    this.yawC = lerpAngle(this.yawC, o.yawC, t); this.pitchC = lerp(this.pitchC, o.pitchC, t);
    this.spinC = lerp(this.spinC, o.spinC, t); this.leanC = lerp(this.leanC, o.leanC, t);
    for (let i = 0; i < 2; i++) {
      this.foot[i].lerp(o.foot[i], t);
      this.footPitch[i] = lerp(this.footPitch[i], o.footPitch[i], t);
      this.footYaw[i] = lerpAngle(this.footYaw[i], o.footYaw[i], t);
      this.knee[i].lerp(o.knee[i], t);
      const wa = this.handW[i] * (1 - t), wb = o.handW[i] * t, w = wa + wb;
      if (w > 1e-5) this.hand[i].multiplyScalar(wa / w).addScaledVector(o.hand[i], wb / w);
      this.handW[i] = w;
    }
    this.aimW = lerp(this.aimW, o.aimW, t); this.headW = lerp(this.headW, o.headW, t); this.gunUp = lerp(this.gunUp, o.gunUp, t);
    return this;
  }
}

const v3 = () => new Vector3();

/**
 * Pop absorber (inertialization). A pose channel that changes speed faster than its limit (a
 * state switching on with a different pose, a key that snaps, an input that flips) hands the
 * excess to an offset that springs back to zero, critically damped, over a few frames. Smooth
 * motion passes through untouched, however fast; only what would pop is carried.
 */
class PopAbsorber {
  /** lim[i]: max change of speed per second (units/s²); ang[i]: the channel is an angle. */
  constructor(lim, ang, omega) {
    const n = lim.length;
    this.lim = lim; this.ang = ang; this.w = omega; this.n = n;
    this.x = new Float64Array(n); this.prev = new Float64Array(n); this.vel = new Float64Array(n);
    this.off = new Float64Array(n); this.ov = new Float64Array(n);
    this.live = false;
  }
  reset() { this.live = false; }
  /** Filters this.x in place. */
  apply(dt) {
    const { x, prev, vel, off, ov, lim, ang, n } = this;
    if (!this.live || !(dt > 0)) {
      prev.set(x); vel.fill(0); off.fill(0); ov.fill(0); this.live = true;
      return;
    }
    const decay = Math.exp(-this.w * dt);
    for (let i = 0; i < n; i++) {
      const v = (ang[i] ? angleDelta(prev[i], x[i]) : x[i] - prev[i]) / dt, m = lim[i] * dt, dv = v - vel[i];
      if (dv > m) { off[i] -= (dv - m) * dt; vel[i] += m; } else if (dv < -m) { off[i] -= (dv + m) * dt; vel[i] -= m; } else vel[i] = v;
      prev[i] = x[i];
      // The offset returns as an exact critically damped spring (stable through any hitch).
      const c = ov[i] + this.w * off[i];
      off[i] = (off[i] + c * dt) * decay;
      ov[i] = (ov[i] - c * this.w * dt) * decay;
      x[i] += off[i];
    }
  }
}

export class ProceduralHumanoid {
  /**
   * @param {object} entity  fighter: movement, weapons, melee, health, vehicle, transform, mode
   * @param {object} cfg     data/animation/humanoid.json
   * @param {object} opts    { groundY(x, z) -> y | null, surfaceAt(x, y, z) -> 'dirt' | 'metal' | ... }
   */
  constructor(entity, cfg, { groundY = null, surfaceAt = null } = {}) {
    this.e = entity;
    this.id = entity.id;
    this.cfg = cfg;
    this.groundY = groundY;
    this.surfaceAt = surfaceAt;
    this.scale = 1;
    this.d = { ...cfg.dims };
    this.planter = new FootPlanter(this.d, (foot, kind) => this.#onPlant(foot, kind));
    this.planterLive = false;
    this.pose = new Pose(); this.pk = new Pose(); this.pa = new Pose(); this.pb = new Pose(); this.pc = new Pose();
    this.w = Object.fromEntries(KEYS.map((k) => [k, k === 'loco' ? 1 : 0]));
    this.fadeFrom = { ...this.w };
    this.fadeP = 1;
    this.cache = {};                    // last pose of each state: { pose, root }
    this.pq = new Pose();
    this.knockFrom = new Pose(); this.knockFromRoot = v3(); this.knockPhase = null; this.knockT = 9; this.knockGround = 0; this.knockHMax = 0;
    this.active = 'loco';
    this.j = {
      pelvis: v3(), neck: v3(), neckTop: v3(), head: v3(), chestC: v3(),
      hip: [v3(), v3()], knee: [v3(), v3()], ankle: [v3(), v3()],
      shoulder: [v3(), v3()], elbow: [v3(), v3()], hand: [v3(), v3()],
      footYaw: [0, 0], footPitch: [0, 0],
    };
    this.F = { pelvis: makeFrame(), chest: makeFrame(), head: makeFrame() };
    this.rollF = makeFrame();   // the ball a forward roll turns
    this.prop = { kind: null, base: v3(), dir: new Vector3(0, 0, -1), up: new Vector3(0, 1, 0), length: 0.8, glow: 0, twoHanded: false };
    this.handT = [v3(), v3()];
    this.cape = Array.from({ length: (cfg.cape?.links ?? 3) + 1 }, v3);
    this.capePrev = this.cape.map(v3);
    this.capeInit = false;
    const L = cfg.layers;
    this.rec = new Spring(L.recoil.omega, L.recoil.zeta);
    this.flX = new Spring(L.flinch.omega, L.flinch.zeta);
    this.flZ = new Spring(L.flinch.omega, L.flinch.zeta);
    this.comp = new Spring(L.comp.omega, L.comp.zeta);
    this.prevRoot = v3(); this.hasPrev = false;
    this.reachDrop = 0; this.reachV = 0;
    this.walkW = 0;
    // Locomotion signals, smoothed once per frame: the hips' turn toward a strafe (and which way
    // they face it), the lean into acceleration, the side-step and backpedal blend, the posture
    // speed. Inputs and the sim change in steps; the body follows them on springs.
    const B = cfg.body;
    this.lm = {
      hip: new Spring(B.hipOmega, 1), hemi: 0,
      lean: new Spring(B.leanOmega, B.leanZeta), bank: new Spring(B.leanOmega, B.leanZeta),
      lateral: 0, back: 0, speed: 0,
    };
    this.crawlW = 0;
    // Pelvis (x, y, z relative to the root) and the body's angles (yaws relative to the facing).
    const pl = B.popLimit;
    this.pops = new PopAbsorber(
      [pl.pelvis, pl.pelvis, pl.pelvis, pl.yaw, pl.yaw, pl.angle, pl.angle, pl.angle, pl.angle, pl.angle, pl.angle],
      [0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0], pl.omega);   // (pitches are angles: a roll turns the body right over)
    this.twistPop = new PopAbsorber([pl.yaw], [0], pl.omega);
    this.root = v3();
    this.yaw = 0;
    this.time = 0;
    this.lag = 0;
    this.travel = 0;
    this.crawl = 0; this.crawlStep = 0;
    this.raise = 1; this.raiseTarget = 1; this.raiseV = 0;
    // Sword keyframe state starts at the idle guard (never a zero vector, even on the first frame).
    const idleH = new Vector3().fromArray(cfg.sword.idle.h), idleB = new Vector3().fromArray(cfg.sword.idle.b).normalize();
    this.sword = {
      key: '', fromH: idleH.clone(), fromB: idleB.clone(), fromTw: 0, fromPitch: 0,
      startH: idleH.clone(), startB: idleB.clone(), v0H: v3(), v0B: v3(),
      prevH: idleH.clone(), prevB: idleB.clone(), velH: v3(), velB: v3(),
    };
    this.swordLocal = { h: idleH.clone(), b: idleB.clone(), tw: 0, pitch: 0 };
    this.aimYaw = null; this.aimPitch = 0; this.prevAimYaw = 0; this.prevAimPitch = 0;
    this.lod = 0; this.emit = true; this.visible = true;
    this.dead = false; this.deathBack = false; this.lastHitDir = v3();
    // Ragdoll: joints to blend from on the way in (carried with the body) and out (where it lay).
    this.limp = false; this.limpT = 0; this.unlimpT = 9;
    this.jFrom = newJoints(); this.jRag = newJoints(); this.jAnim = newJoints();
    this.limpPelvis0 = v3(); this.limpShift = v3();
    this.thudCd = 0; this.lastContact = true;
    this.onCorpse = null;               // AnimationSystem: keep the body where it fell after respawn
    // Sim moments the pose syncs to (impacts, cloth, transition plants), shared with the clip rig.
    const fs = cfg.footstep;
    this.motion = new MotionEvents(cfg, {
      impact: (kind, intensity, x) => {
        this.comp.kick(x?.heavy ? fs.heavyLandKick * (x.impact ? x.impact / 6 : 1) * (kind === 'diveLand' ? 0.6 : 1) : fs.landKick);
        this.#impact(kind, intensity);
      },
      cloth: (kind, intensity) => this.#cloth(kind, intensity),
      step: (foot, gait, stance, intensity, pos, x) => {
        if (x?.impact && !x.quiet) this.comp.kick(fs.landKick * x.impact / 6);
        this.#emitStep(foot, gait, stance, intensity, pos ?? this.root);
      },
    });
  }

  // ---------------------------------------------------------------- events in
  /** Routed by AnimationSystem: combat events about this fighter. */
  onEvent(type, ev) {
    const L = this.cfg.layers;
    if (type === 'weapon:recoil') { this.rec.kick(Math.min(2.5, ev.kick ?? 0.5) * L.recoil.kick); return; }
    if (type === 'hit') {
      // ev: { dir: Vector3 (travel direction of the hit, world), damage }
      const mag = clamp((ev.damage ?? 20) / 30, 0.3, 1.5) * L.flinch.kick;
      forwardOf(this.yaw, _f); rightOf(this.yaw, _r);
      this.flZ.kick((ev.dir.x * _f.x + ev.dir.z * _f.z) * mag);
      this.flX.kick((ev.dir.x * _r.x + ev.dir.z * _r.z) * mag);
      this.lastHitDir.copy(ev.dir);
      return;
    }
    if (type === 'nearMiss') {
      // A round cracking past: a smaller flinch away from it, and a duck.
      const mag = clamp(ev.k ?? 0.5, 0.25, 1) * L.flinch.kick * L.flinch.nearMiss;
      forwardOf(this.yaw, _f); rightOf(this.yaw, _r);
      this.flZ.kick((ev.dir.x * _f.x + ev.dir.z * _f.z) * mag);
      this.flX.kick((ev.dir.x * _r.x + ev.dir.z * _r.z) * mag);
      this.comp.kick(this.cfg.footstep.landKick * L.flinch.duck * (ev.k ?? 0.5));
      return;
    }
    if (type === 'death') {
      forwardOf(this.yaw, _f);
      this.dead = true;
      this.deathBack = this.lastHitDir.x * _f.x + this.lastHitDir.z * _f.z < 0; // shot from the front: fall back
    }
  }

  /** Forget history (teleports, coming back from the far LOD): the next update snaps to a clean pose. */
  resync() { this.hasPrev = false; }

  // ---------------------------------------------------------------- per frame
  /**
   * @param {number} dt
   * @param {Vector3} root   render-interpolated root (ground point under the capsule)
   * @param {object} ctx     { yaw: interpolated bodyYaw, aimYaw, aimPitch (interpolated weapon aim),
   *                           lag: sim timers' render lag in s, lod: 0 | 1, emit: bool }
   */
  update(dt, root, ctx = {}) {
    const e = this.e, s = e.movement.state, cfg = this.cfg;
    this.time += dt;
    this.dt = dt;
    this.lag = ctx.lag ?? 0;
    this.lod = ctx.lod ?? 0;
    this.emit = this.lod === 0 && ctx.emit !== false;
    const sc = silhouetteScale(e);
    if (sc !== this.scale) this.#setScale(sc);
    if (this.dead && !e.health?.dead) {
      // Respawned: the body stays where it fell (a corpse), the rig starts fresh at the spawn.
      if (this.limp) this.onCorpse?.(this);
      this.dead = false; this.hasPrev = false; this.limp = false; this.unlimpT = 9;
    }
    // Limp: the body is the sim's ragdoll (a corpse keeps lying as it fell).
    const rd = e.movement.ragdoll;
    if (s.mode === 'ragdoll' && rd) return this.#limpUpdate(dt, root, rd, ctx);
    if (this.limp) this.#unlimp(s);
    if (!this.hasPrev || root.distanceTo(this.prevRoot) > 3) this.#snap(root, ctx.yaw ?? s.bodyYaw);
    this.travel = Math.hypot(root.x - this.prevRoot.x, root.z - this.prevRoot.z);
    this.prevRoot.copy(root);
    this.root.copy(root);
    this.yaw = ctx.yaw ?? s.bodyYaw;
    this.aimYaw = ctx.aimYaw ?? e.weapons?.aimYaw ?? s.aimYaw;
    this.aimPitch = ctx.aimPitch ?? e.weapons?.aimPitch ?? 0;
    // Inside a hull: unseen. An open car's driver is seen, while it's the right way up.
    this.visible = !(e.vehicle && !e.vehicle.exposed && !(e.vehicle.shown && (e.vehicle.veh.car?.upright ?? 1) > 0.5));

    // ---- which state; crossfade on the incoming state's duration and curve (data: blend.fade)
    const key = this.#activeKey(s);
    if (key !== this.active) {
      this.active = key;
      for (const name of KEYS) this.fadeFrom[name] = this.w[name];
      this.fadeP = 0;
    }
    const [fadeT, curve] = cfg.blend.fade[key] ?? [0.12, 'smooth'];
    this.fadeP = Math.min(1, this.fadeP + dt / fadeT);
    const fk = curve === 'out' ? easeOut(this.fadeP) : curve === 'in' ? easeIn(this.fadeP) : ease(this.fadeP);
    for (const name of KEYS) this.w[name] = lerp(this.fadeFrom[name], name === key ? 1 : 0, fk);

    // ---- smoothed locomotion signals, foot planter and crawl phase (once per frame)
    this.#locoSignals(s, dt);
    this.motion.observe(s, { dead: key === 'dead', root });
    const proneOnly = s.stance === 'prone' && !s.stanceT;
    const wantPlanter = key === 'loco' && !proneOnly;
    if (wantPlanter && !this.planterLive) {
      this.planter.resetTo(this.j.ankle, this.yaw, root, this.#gaitCfg(s, 0), this.groundY);
      this.planterLive = true;
    } else if (!wantPlanter) this.planterLive = false;
    if (this.planterLive) this.planter.update(this.#gaitCfg(s, this.#crouchK(s)));
    // Crawl contacts only while actually crawling (a belly slide drags the body; the limbs don't crawl).
    if (s.mode === 'ground' && (s.stance === 'prone' || s.stanceT?.to === 'prone' || s.stanceT?.from === 'prone')) this.#crawlPhase(s);

    // ---- blend the poses of every state that still has weight
    const P = this.pose;
    let total = 0;
    for (const name of KEYS) {
      const wk = this.w[name];
      if (wk < 1e-3) continue;
      // The active state is solved fresh; states fading out replay their last pose, carried
      // rigidly with the body (their sim data may already be gone: s.dive, s.mantle, s.knock).
      let pk;
      if (name === key || !this.cache[name]) { pk = this.#poseFor(name, this.pk); this.#remember(name, pk); }
      else pk = this.#recall(name);
      if (total === 0) P.copy(pk); else P.mix(pk, wk / (total + wk));
      total += wk;
    }

    this.#reviveLean(P);
    this.#staggerLayer(P);
    this.#injuredLayer(P);
    this.#callIn(P);
    this.#absorbPops(P, dt);
    this.#layersAndFrames(P, dt);
    this.#upperBody(P, dt);
    this.#solveLimbs(P);
    // Coming out of a ragdoll: from where the body lay into the animated pose.
    if (this.unlimpT < cfg.blend.ragdollOut) {
      this.unlimpT += dt;
      const k = ease(clamp(this.unlimpT / cfg.blend.ragdollOut, 0, 1));
      copyJoints(this.jAnim, this.j);
      lerpJoints(this.j, this.jRag, this.jAnim, k);
      this.#framesFromJoints();
    }
    if (this.lod === 0 && cfg.cape?.enabled) this.#capeStep(dt);
    return this;
  }

  // ---------------------------------------------------------------- ragdoll
  #limpUpdate(dt, root, rd, ctx) {
    const cfg = this.cfg, j = this.j, alpha = ctx.alpha ?? 1;
    if (!this.limp) {
      // Going limp: blend from the pose we were in, carried along with the body.
      this.limp = true; this.limpT = 0;
      copyJoints(this.jFrom, j);
      // The animated pose was where the body went limp; carry it from there with the body.
      if (rd.origin) this.limpPelvis0.set(rd.origin.x, rd.origin.y, rd.origin.z); else rd.lerp(J.PELVIS, alpha, this.limpPelvis0);
      if (!this.hasPrev) this.limpT = cfg.blend.ragdollIn; // nothing animated to blend from
      this.thudCd = 0; this.lastContact = true;
      this.planterLive = false;          // no feet planted while limp
    }
    this.limpT += dt;
    this.root.copy(root); this.prevRoot.copy(root); this.hasPrev = true;
    this.#ragdollJoints(rd, alpha, j);
    if (this.limpT < cfg.blend.ragdollIn) {
      this.limpShift.subVectors(j.pelvis, this.limpPelvis0);
      copyJoints(this.jAnim, j);
      lerpJoints(j, this.jFrom, this.jAnim, ease(this.limpT / cfg.blend.ragdollIn), this.limpShift);
    }
    this.#framesFromJoints();
    // The weapon stays in the right hand, along the forearm.
    const pr = this.prop;
    if (pr.kind) {
      pr.base.copy(j.hand[1]);
      pr.dir.subVectors(j.hand[1], j.elbow[1]).normalize();
      pr.up.copy(this.F.chest.d).addScaledVector(pr.dir, -this.F.chest.d.dot(pr.dir)).normalize();
      pr.glow = 0;
    }
    // Thuds: the trunk hitting the ground hard (camera kick, body-impact foley).
    this.thudCd -= dt;
    const contact = !!(rd.contact[J.PELVIS] || rd.contact[J.CHEST] || rd.contact[J.HEAD]);
    if (contact && !this.lastContact && this.thudCd <= 0) {
      const vy = Math.abs((rd.y[J.CHEST] - rd.py[J.CHEST]) * 60) + Math.abs((rd.y[J.PELVIS] - rd.py[J.PELVIS]) * 60);
      const sp = Math.max(vy, Math.hypot(this.e.movement.state.velocity.x, this.e.movement.state.velocity.z));
      if (sp > 1.5) { this.#impact('ragdoll', clamp(sp / 8, 0.25, 1)); this.thudCd = 0.25; }
    }
    this.lastContact = contact;
    if (this.lod === 0 && cfg.cape?.enabled) this.#capeStep(dt);
    return this;
  }

  /** Leaving a ragdoll: remember where the body lay and start the next state clean (no stale crossfade). */
  #unlimp(s) {
    this.limp = false;
    copyJoints(this.jRag, this.j);
    this.unlimpT = 0;
    const key = this.#activeKey(s);
    for (const k of KEYS) { this.w[k] = k === key ? 1 : 0; this.fadeFrom[k] = this.w[k]; }
    this.fadeP = 1; this.active = key; this.cache = {}; this.knockPhase = null; this.knockT = 9;
    this.planterLive = false; this.motion.reset(); this.pops.reset(); this.twistPop.reset();
    this.prevRoot.copy(this.root); this.hasPrev = true;
  }

  /** Joints straight from the particles (interpolated between the last two ticks). */
  #ragdollJoints(rd, alpha, j) {
    rd.lerp(J.PELVIS, alpha, j.pelvis); rd.lerp(J.NECK, alpha, j.neck); rd.lerp(J.HEAD, alpha, j.head); rd.lerp(J.CHEST, alpha, j.chestC);
    j.neckTop.lerpVectors(j.neck, j.head, 0.48);
    const L = [J.HIP_L, J.KNEE_L, J.ANKLE_L, J.SHOULDER_L, J.ELBOW_L, J.HAND_L], R = [J.HIP_R, J.KNEE_R, J.ANKLE_R, J.SHOULDER_R, J.ELBOW_R, J.HAND_R];
    for (let i = 0; i < 2; i++) {
      const ids = i === 0 ? L : R;
      rd.lerp(ids[0], alpha, j.hip[i]); rd.lerp(ids[1], alpha, j.knee[i]); rd.lerp(ids[2], alpha, j.ankle[i]);
      rd.lerp(ids[3], alpha, j.shoulder[i]); rd.lerp(ids[4], alpha, j.elbow[i]); rd.lerp(ids[5], alpha, j.hand[i]);
    }
    // Boots: perpendicular to the shin, toes toward the body's front.
    frameFromAxes(this.F.pelvis, _a.subVectors(j.hip[1], j.hip[0]), _b.subVectors(j.chestC, j.pelvis));
    for (let i = 0; i < 2; i++) {
      _c.subVectors(j.ankle[i], j.knee[i]).normalize();
      _d.copy(this.F.pelvis.n).addScaledVector(_c, -this.F.pelvis.n.dot(_c));
      if (_d.lengthSq() < 1e-6) _d.copy(this.F.pelvis.n);
      _d.normalize();
      j.footYaw[i] = Math.atan2(-_d.x, -_d.z);
      j.footPitch[i] = Math.asin(clamp(_d.y, -1, 1));
    }
  }

  /** Pelvis, chest and head frames from the joints (ragdoll and its blends). */
  #framesFromJoints() {
    const j = this.j, F = this.F;
    frameFromAxes(F.pelvis, _a.subVectors(j.hip[1], j.hip[0]), _b.subVectors(j.chestC, j.pelvis));
    frameFromAxes(F.chest, _a.subVectors(j.shoulder[1], j.shoulder[0]), _b.subVectors(j.neck, j.chestC));
    frameFromAxes(F.head, _a.copy(F.chest.r), _b.subVectors(j.head, j.neckTop));
  }

  // ---------------------------------------------------------------- reviving
  /**
   * Rocked by a hit (s.stagger): the trunk thrown along the push and the arms flung out for
   * balance, the gun off target, easing back as the feet catch up (the planter steps after the
   * root). A buckle drops the hips onto the wounded knee; a stumble that ends in a fall (dying,
   * downed) hunches over, a hand to the gut.
   */
  #staggerLayer(P) {
    const s = this.e.movement.state, g = s.mode === 'stagger' ? s.stagger : null, dt = this.dt ?? 1 / 60;
    this.stagW = (this.stagW ?? 0) + ((g ? 1 : 0) - (this.stagW ?? 0)) * approach(g ? 20 : 6, dt);
    if (g) this.stag = { dx: g.dx, dz: g.dz, kind: g.kind, side: g.side, fall: !!g.fall, u: g.t / g.dur };
    const k = this.stagW, G = this.stag;
    if (k < 1e-3 || !G) return;
    const sc = this.scale;
    forwardOf(P.yawC, _f); rightOf(P.yawC, _r);
    const along = G.dx * _f.x + G.dz * _f.z, across = G.dx * _r.x + G.dz * _r.z;
    const jolt = Math.sin(Math.PI * Math.min(1, G.u * 1.25 + 0.2)) * k;   // thrown at once, easing back
    if (G.kind === 'buckle') {
      // The leg gives: hips down onto that knee, the trunk leaning off it.
      P.pelvis.y -= 0.34 * sc * jolt;
      P.leanP += G.side * 0.3 * jolt; P.leanC -= G.side * 0.22 * jolt; P.pitchC += 0.22 * jolt;
      P.aimW *= 1 - 0.5 * jolt;
      return;
    }
    // The chest goes with the push (back for a shot from the front), the hips after it.
    P.pitchC += along * 0.6 * jolt; P.pitchP += along * 0.22 * jolt;
    P.leanC += across * 0.45 * jolt; P.leanP += across * 0.15 * jolt;
    P.aimW *= 1 - 0.85 * jolt; P.gunUp *= 1 - 0.75 * jolt;
    // Arms flung out wide (against the push) to catch the balance.
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      _b.copy(P.pelvis).addScaledVector(_r, side * 0.46 * sc);
      _b.x -= G.dx * 0.18 * sc; _b.z -= G.dz * 0.18 * sc; _b.y += (0.78 + 0.12 * side * across) * sc;
      P.hand[i].lerp(_b, jolt * 0.85); P.handW[i] = Math.max(P.handW[i], jolt * 0.85);
    }
    if (G.fall) {
      // Going down: hunched over, the knees starting to go, a hand pressed to the gut.
      P.pitchC += 0.4 * k; P.pitchP += 0.15 * k; P.pelvis.y -= 0.14 * sc * G.u * k;
      _b.copy(P.pelvis).addScaledVector(_f, 0.17 * sc); _b.y += 0.12 * sc;
      P.hand[1].lerp(_b, k); P.handW[1] = Math.max(P.handW[1], k);
    }
  }

  /**
   * Back up injured (Health.injury, until a stim): hunched, a limp (the hips dip and the trunk
   * swings off the wounded leg while it carries the weight), and the free hand pressed to a trunk
   * wound while the gun's down.
   */
  #injuredLayer(P) {
    const e = this.e, s = e.movement.state, inj = e.health?.injury, dt = this.dt ?? 1 / 60;
    const on = inj && !s.downed && !e.vehicle && s.mode !== 'ragdoll' ? 1 : 0;
    this.injW = (this.injW ?? 0) + (on - (this.injW ?? 0)) * approach(3, dt);
    if (inj) this.injSite = inj.site;
    const k = this.injW;
    if (k < 1e-3) return;
    const sc = this.scale, site = this.injSite ?? 'gut';
    const side = site.endsWith('L') ? -1 : 1, leg = site === 'legL' || site === 'legR';
    P.pitchC += 0.16 * k;
    if (this.planterLive) {
      const f = this.planter.feet[side < 0 ? 0 : 1];
      this.limpLoad = (this.limpLoad ?? 0) + ((f.planted ? 1 : 0) - (this.limpLoad ?? 0)) * approach(14, dt);
      const dip = this.limpLoad * smoothstep(0.2, 1.2, s.speed) * k * (leg ? 1 : 0.6);
      P.pelvis.y -= 0.05 * sc * dip; P.leanC -= side * 0.14 * dip; P.leanP += side * 0.06 * dip;
    }
    const free = (1 - clamp(this.raise, 0, 1)) * k;
    if (free > 0.02 && (site === 'gut' || site === 'chest')) {
      forwardOf(P.yawC, _f);
      _b.copy(P.pelvis).addScaledVector(_f, 0.17 * sc); _b.y += (site === 'chest' ? 0.42 : 0.14) * sc;
      P.hand[0].lerp(_b, free); P.handW[0] = Math.max(P.handW[0], free);
    }
  }

  /** Kneeling over a downed teammate: bent forward, both hands on their chest, pressing. */
  #reviveLean(P) {
    const job = this.e.reviveJob;
    this.reviveW = (this.reviveW ?? 0) + ((job ? 1 : 0) - (this.reviveW ?? 0)) * approach(6, this.dt ?? 1 / 60);
    const k = this.reviveW;
    if (k < 1e-3) return;
    P.pitchC += 0.75 * k; P.pitchP += 0.25 * k; P.aimW *= 1 - k; P.gunUp *= 1 - k;
    // The hands leave the patient's chest as the lean eases off, not the moment the revive ends.
    const at = this.reviveAt ??= v3();
    if (job) chestPoint(job.patient, at);
    const press = job ? Math.max(0, Math.sin(this.time * 7)) * 0.04 * this.scale : 0;
    rightOf(this.yaw, _r);
    for (let i = 0; i < 2; i++) {
      _b.copy(at).addScaledVector(_r, (i === 0 ? -0.09 : 0.09) * this.scale);
      _b.y += 0.12 * this.scale - press;
      P.hand[i].lerp(_b, P.handW[i] > 0 ? k : 1); P.handW[i] = Math.max(P.handW[i], k);
    }
  }

  // ---------------------------------------------------------------- call-ins
  /**
   * Typing a call-in: the left wrist's pad comes up in front of the chest and the gun drops.
   * Holding a beacon: it's up by the right shoulder (the gun slung), ready to throw; the throw
   * snaps the hand forward and the gun comes back.
   */
  #callIn(P) {
    const S = this.e.stratagems;
    const st = S?.state ?? 'idle', dt = this.dt ?? 1 / 60;
    if (S && S.throws !== this.seenThrows) { if (this.seenThrows !== undefined) this.throwT = 0; this.seenThrows = S.throws; }
    if (this.throwT !== undefined) this.throwT += dt;
    const throwing = this.throwT !== undefined && this.throwT < 0.3;
    this.callW = (this.callW ?? 0) + ((st === 'typing' ? 1 : 0) - (this.callW ?? 0)) * approach(12, dt);
    this.beaconW = (this.beaconW ?? 0) + ((st === 'armed' || throwing ? 1 : 0) - (this.beaconW ?? 0)) * approach(14, dt);
    if (this.callW < 1e-3 && this.beaconW < 1e-3) return;
    const sc = this.scale, fx = -Math.sin(P.yawC), fz = -Math.cos(P.yawC);
    rightOf(P.yawC, _r);
    if (this.callW > 1e-3) {
      const k = this.callW;
      // The left forearm up across the chest, the pad toward the eyes, like checking a watch.
      _b.copy(P.pelvis).addScaledVector(_r, 0.08 * sc);
      _b.x += fx * 0.4 * sc; _b.z += fz * 0.4 * sc; _b.y += 0.5 * sc;
      P.hand[0].lerp(_b, P.handW[0] > 0 ? k : 1); P.handW[0] = Math.max(P.handW[0], k);
      P.gunUp *= 1 - k; P.aimW *= 1 - 0.6 * k;
    }
    if (this.beaconW > 1e-3) {
      const k = this.beaconW, u = throwing ? Math.sin(Math.min(1, this.throwT / 0.3) * Math.PI * 0.5) : 0;
      // Cocked behind the shoulder, then out in front at the release.
      const fwd = -0.1 + 0.6 * u, up = 0.8 - 0.12 * u;
      _b.copy(P.pelvis).addScaledVector(_r, (0.24 - 0.12 * u) * sc);
      _b.x += fx * fwd * sc; _b.z += fz * fwd * sc; _b.y += up * sc;
      P.hand[1].lerp(_b, P.handW[1] > 0 ? k : 1); P.handW[1] = Math.max(P.handW[1], k);
      P.gunUp *= 1 - k;
    }
  }

  #remember(name, pose) {
    const c = this.cache[name] ??= { pose: new Pose(), root: v3(), yaw: 0 };
    c.pose.copy(pose); c.root.copy(this.root); c.yaw = this.yaw;
  }

  /** A fading state's last pose, carried rigidly with the body: moved with the root, turned with its yaw. */
  #recall(name) {
    const c = this.cache[name], out = this.pq.copy(c.pose);
    const dy = angleDelta(c.yaw, this.yaw), r = this.root;
    if (Math.abs(dy) > 1e-5) {
      const cs = Math.cos(dy), sn = Math.sin(dy);
      const turn = (p) => { const x = p.x - c.root.x, z = p.z - c.root.z; p.x = c.root.x + x * cs + z * sn; p.z = c.root.z - x * sn + z * cs; };
      const spin = (v) => { const x = v.x, z = v.z; v.x = x * cs + z * sn; v.z = -x * sn + z * cs; };
      turn(out.pelvis);
      for (let i = 0; i < 2; i++) { turn(out.foot[i]); turn(out.hand[i]); spin(out.knee[i]); out.footYaw[i] += dy; }
      out.yawP += dy; out.yawC += dy;
    }
    _d.subVectors(r, c.root);
    out.pelvis.add(_d);
    for (let i = 0; i < 2; i++) { out.foot[i].add(_d); out.hand[i].add(_d); }
    return out;
  }

  // ---------------------------------------------------------------- state selection
  #activeKey(s) {
    const e = this.e;
    if (s.mode !== 'knockdown') this.knockPhase = null;
    if ((this.dead || e.health?.dead) && s.mode !== 'stagger') return 'dead';   // (a dying stumble is still on its feet)
    if (e.vehicle) return 'seated';
    if (s.downed) return 'downed';
    switch (s.mode) {
      case 'slide': return s.slide?.kind === 'belly' ? 'belly' : 'slide';
      case 'dive': return 'dive';
      case 'air': case 'wallrun': return 'air';
      case 'mantle': return s.mantle ? 'mantle' : 'loco';
      case 'knockdown': return s.knock ? 'knock' : 'loco';
      case 'dodge': return s.dodgeStyle === 'shoulderBash' ? 'loco' : 'dodge';
      case 'roll': return 'roll';
      default: return 'loco';
    }
  }

  #poseFor(name, out) {
    const root = this.root, yaw = this.yaw;
    switch (name) {
      case 'loco': return this.#stancePose(out);
      case 'slide': return this.#slidePose(out);
      case 'belly': return this.#bellyPose(out);
      case 'dive': return this.#divePose(out);
      case 'air': return this.#airPose(out);
      case 'mantle': return this.#mantlePose(out);
      case 'knock': return this.#knockPose(out);
      case 'downed': return this.#downedPose(out);
      case 'seated': return this.#seatedPose(out);
      case 'dodge': return this.#dodgePose(out);
      case 'roll': return this.#rollPose(out);
      case 'dead': { this.#keyPose(this.deathBack ? 'lyingBack' : 'lying', out, root, yaw); out.headW = 0; out.aimW = 0; out.gunUp = 0; return out; }
      default: return this.#restStance(out, 0);
    }
  }

  // ---------------------------------------------------------------- key poses
  /** Body-local key pose from data → world pose. mirror = -1 swaps left and right. */
  #keyPose(name, out, root, yaw, mirror = 1) {
    const k = this.cfg.poses[name], sc = this.scale;
    if (!k.feet) return this.#restStance(out, name === 'crouch' ? 1 : 0);
    forwardOf(yaw, _f); rightOf(yaw, _r);
    const local = (x, y, z, o) => o.set(root.x + (_r.x * x + _f.x * z) * sc, root.y + y * sc, root.z + (_r.z * x + _f.z * z) * sc);
    local(0, k.pelvisH, k.pelvisF ?? 0, out.pelvis);
    out.yawP = yaw; out.yawC = yaw;
    out.pitchP = k.pitchP; out.pitchC = k.pitchC;
    out.spinP = 0; out.spinC = 0;
    out.leanP = (k.lean ?? 0) * mirror; out.leanC = (k.lean ?? 0) * mirror;
    for (let i = 0; i < 2; i++) {
      const src = mirror < 0 ? 1 - i : i;
      const f = k.feet[src];
      local(f[0] * mirror, f[1], f[2], out.foot[i]);
      out.footPitch[i] = k.footPitch?.[src] ?? 0;
      out.footYaw[i] = yaw;
      const kn = k.knees?.[src] ?? [0, 0, 1];
      out.knee[i].set(_r.x * kn[0] * mirror + _f.x * kn[2], kn[1], _r.z * kn[0] * mirror + _f.z * kn[2]);
      if (k.hands) { const h = k.hands[src]; local(h[0] * mirror, h[1], h[2], out.hand[i]); out.handW[i] = k.handsW ?? 1; } else out.handW[i] = 0;
    }
    out.aimW = k.aimW ?? 1; out.headW = 1; out.gunUp = k.hands ? 0 : 1;
    return out;
  }

  /** Stand or crouch with the feet at rest under the hips (used where the planter isn't live). */
  #restStance(out, crouchK) {
    const P = this.cfg.poses, g = this.cfg.gait, sc = this.scale, root = this.root, yaw = this.yaw;
    forwardOf(yaw, _f); rightOf(yaw, _r);
    out.pelvis.set(root.x, root.y + lerp(P.stand.pelvisH, P.crouch.pelvisH, crouchK) * sc, root.z);
    out.yawP = yaw; out.yawC = yaw;
    out.pitchP = lerp(P.stand.pitchP, P.crouch.pitchP, crouchK); out.pitchC = lerp(P.stand.pitchC, P.crouch.pitchC, crouchK);
    out.spinP = out.spinC = out.leanP = out.leanC = 0;
    const width = lerp(g.stand.width, g.crouch.width, crouchK) * sc, stagger = lerp(g.stand.stagger, g.crouch.stagger, crouchK) * sc;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      out.foot[i].set(root.x + _r.x * side * width - _f.x * side * stagger, root.y + this.d.ankleH, root.z + _r.z * side * width - _f.z * side * stagger);
      out.footPitch[i] = 0; out.footYaw[i] = yaw;
      out.knee[i].copy(_f).addScaledVector(_r, side * (0.12 + 0.25 * crouchK)).add(_v.set(0, 0.1, 0));
      out.handW[i] = 0;
    }
    out.aimW = 1; out.headW = 1; out.gunUp = 1;
    return out;
  }

  // ---------------------------------------------------------------- locomotion (stand / crouch / prone)
  #crouchK(s) {
    const tr = s.stanceT;
    if (!tr) return s.stance === 'crouch' ? 1 : 0;
    const u = clamp((tr.t - this.lag) / tr.dur, 0, 1);
    const a = tr.from === 'crouch' ? 1 : 0, b = tr.to === 'crouch' ? 1 : 0;
    return lerp(a, b, ease(u));
  }

  /** Gait parameters for the planter at the current speed, blended between stand and crouch. */
  #gaitCfg(s, crouchK) {
    const gs = this.cfg.gait.stand, gc = this.cfg.gait.crouch, sc = this.scale;
    const sp = s.speed / sc;
    const T = (key) => lerp(table(gs[key], sp), table(gc[key], sp), crouchK);
    const pelvisH = lerp(this.cfg.poses.stand.pelvisH, this.cfg.poses.crouch.pelvisH, crouchK) * sc;
    const L = (this.d.thigh + this.d.shin);
    const c = this._gait ??= { vel: new Vector3() };
    c.dt = this.dt ?? 1 / 60;
    c.root = this.root;
    c.yaw = this.#hipYaw();
    c.vel.copy(s.velocity);
    c.travel = this.travel;
    c.speed = s.speed;
    // Side-steps and backpedals are shorter, quicker steps than running forward.
    c.stride = T('stride') * sc * (1 - 0.35 * this.lm.lateral) * (1 - 0.2 * this.lm.back);
    c.duty = T('duty');
    c.land = lerp(gs.land, gc.land, crouchK);
    c.heelRise = lerp(gs.heelRise, gc.heelRise, crouchK);
    c.lift = T('lift') * sc;
    c.width = lerp(gs.width, gc.width, crouchK) * sc;
    c.stagger = lerp(gs.stagger, gc.stagger, crouchK) * sc;
    c.toeOut = lerp(gs.toeOut, gc.toeOut, crouchK);
    // Overstretch limit for the planter's stretch guard: how far a planted ankle can get from its
    // hip before the pelvis would have to drop by more than 15% of its height.
    c.reach = Math.sqrt(Math.max(0.04, L * L - (pelvisH * 0.85 - this.d.ankleH) ** 2));
    c.groundY = this.groundY;
    c.crouchK = crouchK;
    c.maxAimSpeed = this.cfg.gait.maxAimSpeed;
    return c;
  }

  /** Hips turn partly toward a strafe (or its reverse when backpedalling); the chest stays on the aim. */
  #hipYaw() { return this.yaw + this.lm.hip.x; }

  /**
   * Once per frame, the signals the locomotion poses read, each on a spring or a smoothing rate:
   * input and sim changes come in steps (a strafe flipping to a backpedal, a stance change braking
   * the body in one tick), the body follows them over a few frames instead of snapping.
   */
  #locoSignals(s, dt) {
    const b = this.cfg.body, L = this.lm;
    // Hips: toward a strafe while moving forward of it, away from it while backpedalling. Which
    // way they face only flips past hipFlip (hysteresis), and they swivel there on a spring.
    let hip = 0;
    if (s.speed >= 0.5 && !s.sprinting) {
      const delta = angleDelta(this.yaw, Math.atan2(-s.velocity.x, -s.velocity.z)), a = Math.abs(delta);
      const [toBack, toFwd] = b.hipFlip;
      if (L.hemi === 0) L.hemi = a <= Math.PI / 2 ? 1 : -1;
      else if (L.hemi > 0 && a > toBack) L.hemi = -1;
      else if (L.hemi < 0 && a < toFwd) L.hemi = 1;
      const d = L.hemi > 0 ? delta : angleDelta(0, delta + Math.PI);
      hip = clamp(d * b.hipFollow, -b.maxHipYaw, b.maxHipYaw) * smoothstep(0.5, 2, s.speed);
    } else if (s.speed < 0.3) L.hemi = 0;
    L.hip.step(hip, dt);
    // Lean into acceleration like an inverted pendulum. The lean lags the push a little and
    // settles with a touch of overshoot: a braking stance change reads as weight, not a snap.
    forwardOf(this.yaw, _a); rightOf(this.yaw, _b);
    const af = s.accel.x * _a.x + s.accel.z * _a.z, ar = s.accel.x * _b.x + s.accel.z * _b.z;
    L.lean.step(clamp((af / G) * b.accelLean, -b.maxLean, b.maxLean), dt);
    L.bank.step(clamp((ar / G) * b.accelLean, -b.maxLean, b.maxLean) * smoothstep(1, 3, s.speed), dt);
    // Side-steps and backpedals take shorter steps; the blend follows the input direction smoothly.
    const vl = Math.hypot(s.velocity.x, s.velocity.z);
    if (vl > 0.3) {
      forwardOf(this.#hipYaw(), _a); rightOf(this.#hipYaw(), _b);
      const k = approach(b.gaitBlendRate, dt);
      L.lateral += (Math.abs(s.velocity.x * _b.x + s.velocity.z * _b.z) / vl - L.lateral) * k;
      L.back += (smoothstep(-0.1, -0.6, (s.velocity.x * _a.x + s.velocity.z * _a.z) / vl) - L.back) * k;
    }
    L.speed += (s.speed - L.speed) * approach(b.postureRate, dt);
    // Crawl limbs ease in and out with the crawl (a get-up never cuts them off mid-reach).
    this.crawlW += (smoothstep(0.04, 0.35, s.speed) - this.crawlW) * approach(10, dt);
  }

  /** Inertialization over the blended pose: whatever would pop springs out over a few frames. */
  #absorbPops(P, dt) {
    const A = this.pops, x = A.x, r = this.root, y = this.yaw;
    x[0] = P.pelvis.x - r.x; x[1] = P.pelvis.y - r.y; x[2] = P.pelvis.z - r.z;
    x[3] = angleDelta(y, P.yawP); x[4] = angleDelta(y, P.yawC);
    x[5] = P.pitchP; x[6] = P.pitchC; x[7] = P.spinP; x[8] = P.spinC; x[9] = P.leanP; x[10] = P.leanC;
    A.apply(dt);
    P.pelvis.set(r.x + x[0], r.y + x[1], r.z + x[2]);
    P.yawP = y + x[3]; P.yawC = y + x[4];
    P.pitchP = x[5]; P.pitchC = x[6]; P.spinP = x[7]; P.spinC = x[8]; P.leanP = x[9]; P.leanC = x[10];
  }

  /** Standing/crouched locomotion pose on the planter's feet. */
  #locoPose(out, crouchK) {
    const s = this.e.movement.state, cfg = this.cfg, P = cfg.poses, sc = this.scale;
    if (!this.planterLive) return this.#restStance(out, crouchK);
    const gs = cfg.gait.stand, gc = cfg.gait.crouch, sp = s.speed / sc, sq = this.lm.speed / sc;
    const T = (key) => lerp(table(gs[key], sp), table(gc[key], sp), crouchK);
    // Posture (running lean, drop, bob size) follows the smoothed speed: a braking tick can't jerk it.
    const TP = (key) => lerp(table(gs[key], sq), table(gc[key], sq), crouchK);
    const hipYaw = this.#hipYaw();
    forwardOf(hipYaw, _f); rightOf(hipYaw, _r);
    // Pelvis: stance height, running drop, and a bob locked to the steps (low at mid-stance when
    // running, high at mid-stance when walking).
    let h = lerp(P.stand.pelvisH, P.crouch.pelvisH, crouchK) * sc - TP('pelvisDrop') * sc;
    const pl = this.planter;
    this.walkW += ((pl.walking ? 1 : 0) - this.walkW) * approach(8, this.dt ?? 1 / 60);
    if (this.walkW > 1e-3) {
      const duty = T('duty');
      const run = smoothstep(0.52, 0.42, duty);
      h += TP('bob') * sc * Math.cos(TAU * (pl.clock - (1 - duty))) * (1 - 2 * run) * this.walkW;
    }
    out.pelvis.set(this.root.x, this.root.y + h, this.root.z);
    // Lean into acceleration (inverted pendulum, on springs) plus the running posture.
    const leanF = this.lm.lean.x, bank = this.lm.bank.x;
    const posture = TP('lean');
    out.yawP = hipYaw; out.yawC = this.yaw;
    out.pitchP = lerp(P.stand.pitchP, P.crouch.pitchP, crouchK) + (posture + leanF) * 0.35;
    out.pitchC = lerp(P.stand.pitchC, P.crouch.pitchC, crouchK) + posture + leanF;
    out.spinP = 0; out.spinC = 0;
    out.leanP = bank * 0.5; out.leanC = bank;
    // Shoulder bash: shoulder leads, head down.
    if (s.mode === 'dodge' && s.dodgeStyle === 'shoulderBash') { out.pitchC += 0.4; out.spinC += 0.55; }
    // In cover, in behind it: hunched low behind low cover, a shoulder leant to a wall (out of it to aim: upright).
    if (s.mode === 'cover' && s.cover) {
      const hid = 1 - smoothstep(0, 0.6, s.cover.out);
      if (s.cover.high) out.leanC += s.cover.side * 0.12 * hid; else out.pitchC += 0.28 * hid;
    }
    for (let i = 0; i < 2; i++) {
      const f = pl.feet[i], side = f.side;
      out.foot[i].copy(f.ankle);
      out.footPitch[i] = f.pitch;
      out.footYaw[i] = f.yaw;
      out.knee[i].copy(_f).addScaledVector(_r, side * (0.12 + 0.25 * crouchK)).add(_v.set(0, 0.1, 0));
      out.handW[i] = 0;
    }
    out.aimW = 1; out.headW = 1; out.gunUp = 1;
    return out;
  }

  /** Prone (face down) or supine (on the back, after a back dive): elbows-and-knees crawl. */
  #pronePose(out, supine) {
    const sc = this.scale;
    this.#keyPose(supine ? 'supine' : 'prone', out, this.root, this.yaw);
    const moving = this.crawlW;
    if (moving > 0) {
      const ph = this.crawl * TAU;
      forwardOf(this.yaw, _f); rightOf(this.yaw, _r);
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        const draw = Math.max(0, Math.sin(ph + i * Math.PI)) * moving;
        // Prone: the knee draws up and out to push. Supine: the heel digs in and pulls.
        const fwd = (supine ? -0.28 : 0.32) * draw * sc, out_ = side * 0.12 * draw * sc;
        out.foot[i].x += _f.x * fwd + _r.x * out_;
        out.foot[i].z += _f.z * fwd + _r.z * out_;
        out.foot[i].y += 0.04 * draw * sc;
      }
      out.spinP += 0.07 * Math.sin(ph) * moving;
      out.spinC -= 0.05 * Math.sin(ph) * moving;
      out.leanP += 0.04 * Math.sin(ph) * moving;
      out.pelvis.y += 0.02 * Math.abs(Math.sin(ph)) * moving * sc;
    }
    return out;
  }

  /**
   * Downed: lying as the body came to rest (front or back), the wounded crawl when moving. The
   * right hand presses the wound (slinging the rifle); the left reaches and pulls on the ground.
   */
  #downedPose(out) {
    const s = this.e.movement.state, sc = this.scale, sup = s.supine;
    this.#pronePose(out, sup);
    out.aimW = 0; out.gunUp = 0; out.headW = 0.25;
    forwardOf(this.yaw, _f); rightOf(this.yaw, _r);
    const head = sup ? -1 : 1;                       // supine bodies lie head-behind bodyYaw
    // Wound hand: on the belly (under it on the front, on top of it on the back).
    out.hand[1].copy(out.pelvis).addScaledVector(_f, 0.22 * head * sc).addScaledVector(_r, 0.06 * head * sc);
    out.hand[1].y += (sup ? 0.13 : -0.04) * sc;
    out.handW[1] = 1;
    // Free hand: reaches ahead and drags the body along while crawling; rests by the head when still.
    const moving = this.crawlW, reach = Math.max(0, Math.sin(this.crawl * TAU)) * moving;
    out.hand[0].copy(out.pelvis).addScaledVector(_f, (0.55 + 0.25 * reach) * head * sc).addScaledVector(_r, -0.28 * head * sc);
    out.hand[0].y = (this.groundY ? this.groundY(out.hand[0].x, out.hand[0].z) : this.root.y) + 0.05 * sc;
    out.handW[0] = 1;
    // Hurt: shallow, quick breaths and a curl toward the wound.
    const breath = Math.sin(this.time * 9) * 0.015 * sc;
    out.pelvis.y += breath * 0.5;
    out.spinC += 0.12 * head; out.leanC += 0.06 * Math.sin(this.time * 1.3);
    // Rolling over (onto the back to face what's coming, or onto the belly to crawl): the body
    // turns over its long axis, lifting off the ground half way.
    if (s.roll) {
      const u = clamp(s.roll.t / this.e.movement.t.downed.rollTime, 0, 1), turn = Math.sin(u * Math.PI);
      out.leanP += turn * 1.25; out.leanC += turn * 1.35; out.pelvis.y += turn * 0.1 * sc;
    }
    return out;
  }

  #crawlPhase(s) {
    if (s.speed < 0.05) return;
    const stride = table(this.cfg.gait.prone.stride, s.speed) * this.scale;
    const before = this.crawl;
    this.crawl += this.travel / Math.max(0.2, stride);
    // Each half cycle an elbow and the opposite knee dig in: a soft crawl contact.
    if (Math.floor(before * 2) !== Math.floor(this.crawl * 2) && s.stance === 'prone' && !s.stanceT) {
      const intensity = table(this.cfg.gait.prone.intensity, s.speed) * (this.cfg.footstep.stanceMul.prone ?? 1) * this.#armorMul();
      this.#emitStep(Math.floor(this.crawl * 2) % 2, 'crawl', 'prone', intensity, this.root);
    }
  }

  /** Locomotion + stance transitions. Transitions follow the sim's stanceT progress exactly. */
  #stancePose(out) {
    const s = this.e.movement.state;
    const tr = s.stanceT;
    if (!tr) {
      const name = s.stance === 'prone' ? (s.supine ? 'supine' : 'prone') : s.stance;
      return this.#namedPose(name, out, s.stance === 'crouch' ? 1 : 0);
    }
    const path = transitionPath(this.cfg, tr, s);
    const u = clamp((tr.t - this.lag) / tr.dur, 0, 1);
    const keys = path.keys;
    let i = 0;
    while (i < keys.length - 2 && u > keys[i + 1][0]) i++;
    const [u0, n0] = keys[i], [u1, n1] = keys[i + 1];
    const t = ease((u - u0) / Math.max(1e-4, u1 - u0));
    const ck = this.#crouchK(s);
    this.#namedPose(n0, this.pa, ck);
    this.#namedPose(n1, this.pb, ck);
    out.copy(this.pa).mix(this.pb, t);
    if (n0 === 'prone' || n0 === 'supine' || n1 === 'prone' || n1 === 'supine' || n0 === 'pushup' || n1 === 'pushup' || n0 === 'situp' || n1 === 'situp') out.gunUp = 0;
    return out;
  }

  #namedPose(name, out, crouchK) {
    switch (name) {
      case 'stand': return this.#locoPose(out, 0);
      case 'crouch': return this.#locoPose(out, 1);
      case 'prone': return this.#pronePose(out, false);
      case 'supine': return this.#pronePose(out, true);
      default: return this.#keyPose(name, out, this.root, this.yaw);
    }
  }

  // ---------------------------------------------------------------- committed moves
  #slidePose(out) {
    const s = this.e.movement.state;
    this.#keyPose('slide', out, this.root, this.yaw);
    // Lean into the steer; the ground rattles the body.
    out.leanC += clamp(-(s.bodyTurnRate ?? 0) * 0.12, -0.3, 0.3);
    out.leanP += clamp(-(s.bodyTurnRate ?? 0) * 0.06, -0.15, 0.15);
    out.pelvis.y += Math.sin(this.time * 71) * 0.004 * this.scale * Math.min(1, s.speed / 6);
    return out;
  }

  #bellyPose(out) {
    const s = this.e.movement.state;
    const from = s.slide?.from ?? 'forward';
    if (from === 'back') return this.#keyPose('bellyBack', out, this.root, this.yaw);
    if (from === 'left' || from === 'right') {
      // Landed on the side: roll onto the belly on the same timer the hitboxes use.
      const k = clamp((s.slide.t - this.lag) / (this.e.movement.t?.dive?.belly?.rollTime ?? 0.35), 0, 1);
      this.#keyPose('bellySide', out, this.root, this.yaw, from === 'left' ? -1 : 1);
      this.#keyPose('belly', this.pc, this.root, this.yaw);
      return out.mix(this.pc, ease(k));
    }
    return this.#keyPose('belly', out, this.root, this.yaw);
  }

  #divePose(out) {
    const s = this.e.movement.state, d = s.dive;
    if (!d) return this.#keyPose('dive', out, this.root, this.yaw);
    const t = Math.max(0, d.t - this.lag), launch = this.cfg.blend.diveLaunch;
    // Anticipation overlaps the motion: a spring-off key for the first ~90 ms while the body is
    // already travelling (no input delay), then the committed dive: superman forward, a lean
    // into side dives, falling back onto the shoulders for back dives.
    const mirror = d.kind === 'left' ? -1 : 1;
    if (d.kind === 'back') { this.#keyPose('diveBackLaunch', this.pc, this.root, this.yaw); this.#keyPose('diveBack', out, this.root, this.yaw); }
    else if (d.kind === 'left' || d.kind === 'right') { this.#keyPose('diveSideLaunch', this.pc, this.root, this.yaw, mirror); this.#keyPose('diveSide', out, this.root, this.yaw, mirror); }
    else { this.#keyPose('diveLaunch', this.pc, this.root, this.yaw); this.#keyPose('dive', out, this.root, this.yaw); }
    const k = ease(t / launch);
    if (k < 1) { this.pa.copy(this.pc).mix(out, k); out.copy(this.pa); }
    if (d.kind === 'forward') out.pitchC += 0.15 * smoothstep(0.12, 0.5, t);
    // Trailing legs flutter a little in the air.
    const fl = Math.sin(t * 19) * 0.035 * this.scale;
    out.foot[0].y += fl; out.foot[1].y -= fl;
    return out;
  }

  #airPose(out) {
    const s = this.e.movement.state, vy = s.velocity.y;
    // Push-off on the way up, tuck at the peak, legs reach for the ground on the way down.
    this.#keyPose('airTuck', out, this.root, this.yaw);
    const up = smoothstep(0.5, 3.5, vy), fall = smoothstep(-0.5, -5, vy);
    if (up > 0) { this.#keyPose('airUp', this.pc, this.root, this.yaw); out.mix(this.pc, up); }
    if (fall > 0) { this.#keyPose('airFall', this.pc, this.root, this.yaw); out.mix(this.pc, fall); }
    return out;
  }

  #mantlePose(out) {
    const s = this.e.movement.state, m = s.mantle, sc = this.scale;
    if (!m) return this.#restStance(out, 0);
    const u = clamp((s.modeTime - this.lag) / m.duration, 0, 1);
    const yaw = this.yaw;
    forwardOf(yaw, _f); rightOf(yaw, _r);
    const edge = m.edge ?? _c.set(m.from.x + _f.x * 0.5, m.from.y + m.height, m.from.z + _f.z * 0.5);
    if (m.kind === 'vault') {
      // One hand plants on the obstacle, the legs swing over to the side, momentum never stops.
      this.#keyPose('airTuck', out, this.root, yaw);
      const over = smoothstep(0.15, 0.4, u) * (1 - smoothstep(0.65, 0.95, u));
      out.foot[0].addScaledVector(_r, 0.45 * over * sc).y += 0.15 * over * sc;
      out.foot[1].addScaledVector(_r, 0.35 * over * sc).y += 0.1 * over * sc;
      out.pelvis.y -= 0.2 * sc * over;
      out.pitchC += 0.45 * over; out.leanC -= 0.3 * over;
      const hw = smoothstep(0.05, 0.2, u) * (1 - smoothstep(0.52, 0.8, u));
      out.hand[0].set(edge.x - _r.x * 0.12 * sc, edge.y + 0.02, edge.z - _r.z * 0.12 * sc); out.handW[0] = hw;
      out.handW[1] = 0;
      out.gunUp = 1 - hw;
    } else {
      // Climb: both hands plant on the lip, pull up (chest over the edge, a knee comes up), stand.
      this.#keyPose('airFall', out, this.root, yaw);
      const pull = smoothstep(0.2, 0.6, u), stand = smoothstep(0.62, 1, u);
      out.pitchC = lerp(lerp(0.25, 0.95, pull), 0.04, stand);
      out.pitchP = lerp(lerp(0.1, 0.6, pull), 0.05, stand);
      out.pelvis.y = this.root.y + lerp(lerp(0.78, 0.55, pull), this.cfg.poses.stand.pelvisH, stand) * sc;
      out.foot[1].addScaledVector(_f, 0.25 * pull * (1 - stand) * sc).y += 0.4 * pull * (1 - stand) * sc;
      // The raised knee comes up as it would stepping onto a ledge (its pole can't run along the folded leg).
      out.knee[1].copy(_f).addScaledVector(UP, 1.4 * pull * (1 - stand)).normalize();
      // Feet plant on top (world-fixed) as the body stands up.
      const top = m.to;
      // (each from where its ramp starts, so a foot never jumps onto the ledge)
      if (u > 0.62) { out.foot[1].lerp(_a.set(top.x + _r.x * 0.1 * sc - _f.x * 0.05, top.y + this.d.ankleH, top.z + _r.z * 0.1 * sc - _f.z * 0.05), smoothstep(0.62, 0.72, u)); }
      if (u > 0.8) { out.foot[0].lerp(_a.set(top.x - _r.x * 0.1 * sc + _f.x * 0.05, top.y + this.d.ankleH, top.z - _r.z * 0.1 * sc + _f.z * 0.05), smoothstep(0.8, 0.9, u)); }
      const hw = smoothstep(0.0, 0.18, u) * (1 - smoothstep(0.66, 0.86, u));
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        out.hand[i].set(edge.x + _r.x * side * 0.22 * sc - _f.x * 0.04, edge.y + 0.03, edge.z + _r.z * side * 0.22 * sc - _f.z * 0.04);
        out.handW[i] = hw;
      }
      out.gunUp = 1 - Math.max(hw, 1 - stand * 1.2);
    }
    out.headW = 0.6;
    return out;
  }

  #knockPose(out) {
    const s = this.e.movement.state, kn = s.knock, sc = this.scale;
    if (!kn) return this.#restStance(out, 0);
    if (kn.phase !== this.knockPhase) {
      // Sub-phase change (thrown → lying → get-up): crossfade from the last knock pose.
      if (this.knockPhase === null) { this.knockGround = this.root.y; this.knockHMax = 0; } else if (this.cache.knock) { this.knockFrom.copy(this.cache.knock.pose); this.knockFromRoot.copy(this.cache.knock.root); this.knockT = 0; }
      this.knockPhase = kn.phase;
    }
    this.knockT += this.dt ?? 1 / 60;
    if (kn.phase === 'getup') {
      const path = this.cfg.transitions[kn.supine ? 'getupBack' : 'getupFront'];
      const u = clamp((kn.t - this.lag) / (this.e.movement.t?.knockdown?.getUpTime ?? 0.85), 0, 1);
      let i = 0;
      while (i < path.keys.length - 2 && u > path.keys[i + 1][0]) i++;
      const [u0, n0] = path.keys[i], [u1, n1] = path.keys[i + 1];
      this.#namedPose(n0, this.pa, 0); this.#namedPose(n1, this.pb, 0);
      out.copy(this.pa).mix(this.pb, ease((u - u0) / Math.max(1e-4, u1 - u0)));
      out.gunUp = smoothstep(0.75, 1, u);
      out.headW = smoothstep(0.3, 0.9, u);
    } else {
      this.#keyPose(kn.supine ? 'lyingBack' : 'lying', out, this.root, this.yaw);
      if (kn.phase === 'air') {
        // Thrown: tumble and flail around the airborne capsule; the body settles toward the
        // lying pose as it nears the ground it was thrown from, so the slam lands continuously.
        // The body settles toward the lying pose over the last quarter second before the slam.
        // Time to impact comes from the ballistic arc (rising or falling), so it's continuous.
        const above = Math.max(0, this.root.y - this.knockGround), vy = s.velocity.y, g = this.e.movement.t?.gravity ?? 22;
        const tImpact = (vy + Math.sqrt(vy * vy + 2 * g * above)) / g;
        const t = kn.t, h = smoothstep(0, 0.25, tImpact);
        out.pelvis.y = this.root.y + lerp(this.cfg.poses.lying.pelvisH, lerp(0.72, 0.5, smoothstep(0, 0.3, t)), h) * sc;
        const spin = (kn.supine ? -1 : 1) * Math.min(1.1, t * 4.5) * h;
        out.pitchP += spin * 0.4; out.pitchC += spin * 0.5;
        const fl = Math.sin(t * 17), fl2 = Math.sin(t * 13 + 1);
        out.hand[0].y += (0.25 + fl * 0.15) * sc * h; out.hand[1].y += (0.25 - fl * 0.15) * sc * h;
        out.foot[0].y += (0.25 + fl2 * 0.12) * sc * h; out.foot[1].y += (0.25 - fl2 * 0.12) * sc * h;
      } else {
        out.pelvis.y += Math.sin(this.time * 3.1) * 0.006 * sc; // winded
      }
      out.headW = 0.15; out.aimW = 0; out.gunUp = 0;
    }
    const T = this.cfg.blend.knockPhase;
    if (this.knockT < T) {
      _d.subVectors(this.root, this.knockFromRoot);
      this.pq.copy(this.knockFrom);
      this.pq.pelvis.add(_d);
      for (let i = 0; i < 2; i++) { this.pq.foot[i].add(_d); this.pq.hand[i].add(_d); }
      const f = ease(this.knockT / T);
      this.pq.mix(out, f);
      out.copy(this.pq);
    }
    return out;
  }

  #seatedPose(out) {
    const e = this.e, v = e.vehicle;
    const yaw = v?.veh?.yaw ?? this.yaw;
    // Gun crews kneel at the gun, facing along the barrel, rifle slung; nobody sits on a field piece.
    if (v?.veh?.seats?.[v.seat]?.def?.pose === 'crew') {
      this.#keyPose('kneel', out, this.root, v.veh.gun?.yaw ?? yaw);
      out.aimW = 0.15; out.gunUp = 0; out.handW[0] = 0; out.handW[1] = 0;
      return out;
    }
    // A ring-mount gunner stands at his gun, both hands on it, turning with it.
    if (v?.veh?.seats?.[v.seat]?.def?.pose === 'stand') {
      this.#keyPose('stand', out, this.root, this.aimYaw ?? yaw);
      out.aimW = 1; out.gunUp = 1;
      return out;
    }
    this.#keyPose('seated', out, this.root, yaw);
    const driver = v?.veh?.seats?.[v.seat]?.def?.role === 'driver';
    if (!driver) { out.handW[0] = 0; out.handW[1] = 0; out.gunUp = 1; }
    out.aimW = driver ? 0.35 : 1;
    return out;
  }

  /**
   * A slide off a ledge come down into a forward roll: the body curls into a ball, goes over a
   * shoulder and across its back, and comes up crouched, carried on by the sim's speed. The ball
   * turns a full circle (θ) about the hips' axis; it's mixed with the crouch it comes from and
   * goes back into.
   */
  #rollPose(out) {
    const s = this.e.movement.state, R = s.landRoll, sc = this.scale, yaw = this.yaw, Q = this.cfg.roll;
    this.#restStance(out, 1);
    out.aimW = 0; out.headW = 0; out.gunUp = 0;
    if (!R) return out;
    const u = clamp((R.t - this.lag) / R.dur, 0, 1);
    const th = TAU * smoothstep(Q.over[0], Q.over[1], u);
    const w = smoothstep(0, Q.curl, u) * (1 - smoothstep(1 - Q.curl, 1, u));
    // The ball's middle: dropping onto the shoulder, rolling low, rising into the crouch.
    const hc = (Q.ball + Q.drop * (1 - smoothstep(0, 0.25, u)) + Q.rise * smoothstep(0.8, 1, u)) * sc;
    const B = bodyFrame(yaw, th, 0, 0, this.rollF);
    _c.set(this.root.x, this.root.y + hc, this.root.z);
    const at = (r, d, n, o) => frameToWorld(B, _c, r * sc, d * sc, n * sc, o);
    // Angles mixed the short way round from the crouch's (the ball's are a full turn on at the end).
    const near = (a, ref) => ref + angleDelta(ref, a);
    out.pelvis.lerp(at(0, Q.pelvis[0], Q.pelvis[1], _a), w);
    out.pitchP = lerp(out.pitchP, near(th + Q.pitchP, out.pitchP), w);
    out.pitchC = lerp(out.pitchC, near(th + Q.pitchC, out.pitchC), w);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      out.foot[i].lerp(at(side * Q.foot[0], Q.foot[1], Q.foot[2], _a), w);
      out.footPitch[i] = lerp(out.footPitch[i], near(th + Q.footPitch, 0), w);
      // Knees drawn up to the chest, hands on the shins.
      out.knee[i].lerp(_b.copy(B.n).addScaledVector(B.d, 0.4).addScaledVector(B.r, side * 0.15), w);
      at(side * Q.hand[0], Q.hand[1], Q.hand[2], out.hand[i]);
      out.handW[i] = w;
    }
    return out;
  }

  #dodgePose(out) {
    const s = this.e.movement.state;
    const dy = Math.atan2(-s.dodgeDir.x, -s.dodgeDir.z);
    this.#keyPose('dash', out, this.root, dy);
    out.yawC = this.yaw;
    return out;
  }

  // ---------------------------------------------------------------- layers, frames, head
  #layersAndFrames(P, dt) {
    const e = this.e, s = e.movement.state, L = this.cfg.layers, d = this.d, F = this.F, j = this.j, sc = this.scale;
    this.rec.step(0, dt); this.flX.step(0, dt); this.flZ.step(0, dt); this.comp.step(0, dt);
    // Sword attacks drive the chest twist and pitch; guns twist the chest toward the aim.
    const sword = e.mode === 'sword' && e.melee;
    if (sword) this.#swordState(dt);
    const raisedK = sword ? 1 : clamp(this.raise, 0, 1);
    // An aim right behind the body could twist the chest either way: it keeps the way it was
    // going until the aim is well past the back (no flip on a hair of yaw).
    let ad = angleDelta(P.yawC, this.aimYaw ?? P.yawC);
    if (Math.abs(ad) > Math.PI - 0.6 && Math.sign(ad) !== (this.twistSide ?? Math.sign(ad))) ad -= Math.sign(ad) * TAU;
    else if (Math.abs(ad) > 0.05) this.twistSide = Math.sign(ad);
    // The twist crossing over to the other side (an aim swinging through the back) swings the
    // chest across on the pop absorber; aim tracking itself passes straight through.
    const TW = this.twistPop;
    TW.x[0] = clamp(ad, -1.1, 1.1) * P.aimW * lerp(0.3, 1, raisedK);
    TW.apply(dt);
    P.yawC += TW.x[0] + (sword ? this.swordLocal.tw * P.aimW : 0);
    if (sword) P.pitchC += this.swordLocal.pitch * P.aimW;
    // Additive layers on the upper body only (the legs keep their plants).
    const breathRate = s.exhausted || s.lowStamina ? L.breath.rateLow : L.breath.rate;
    const breathAmp = (s.exhausted || s.lowStamina ? L.breath.ampLow : L.breath.amp) * sc;
    this.breathPh = (this.breathPh ?? 0) + breathRate * dt;
    const breath = Math.sin(this.breathPh * TAU) * breathAmp;
    P.pitchC += this.flZ.x * L.flinch.chest - this.rec.x * L.recoil.chest + this.comp.x * L.comp.chest + breath * 2;
    P.leanC += this.flX.x * L.flinch.chest;
    P.pelvis.y -= this.comp.x * L.comp.pelvis * sc;

    // Planted feet must always be reachable: drop the pelvis rather than let a foot slide.
    // The drop is instant when it grows and eases out when a foot lifts (no pop at toe-off).
    // Lying prone the feet are the pose's, on the ground, and count the same way, so a get-up
    // (when the planter comes on) starts from the drop the body already had. Out of locomotion
    // the drop eases away with the state's weight; it never cuts off.
    // The hips are measured where the skeleton puts them (off the pelvis frame), standing or lying.
    bodyFrame(P.yawP, P.pitchP, P.spinP, P.leanP, F.pelvis);
    const footPose = !this.planterLive && this.active === 'loco';
    if (this.planterLive || footPose) {
      const Lm = (d.thigh + d.shin) * 0.985, Fp = F.pelvis;
      // A swinging foot starts to count late in its swing, so the drop ramps in before touchdown.
      let need = 0;
      for (let i = 0; i < 2; i++) {
        const f = this.planter.feet[i], planted = footPose || f.planted;
        const wf = planted ? 1 : smoothstep(0.55, 1, f.u);
        if (wf <= 0) continue;
        const side = i === 0 ? -1 : 1;
        // Hip joint relative to the pelvis centre (as below: out along r, 3 cm down the spine).
        const ox = Fp.r.x * side * d.hipW - Fp.d.x * 0.03 * sc, oy = Fp.r.y * side * d.hipW - Fp.d.y * 0.03 * sc, oz = Fp.r.z * side * d.hipW - Fp.d.z * 0.03 * sc;
        // For a swinging foot, measure from where the hip will be when it lands.
        const lead = planted || !f.byDistance ? 0 : (1 - f.u) * f.swingDist, dir = this.planter.dir;
        const hx = P.pelvis.x + ox + dir.x * lead, hz = P.pelvis.z + oz + dir.z * lead;
        const ft = planted ? P.foot[i] : _c.set(f.target.x, f.target.y + d.ankleH, f.target.z);
        const hd = Math.hypot(ft.x - hx, ft.z - hz);
        const maxY = ft.y - oy + Math.sqrt(Math.max(0, Lm * Lm - hd * hd));
        // A soft knee: the pelvis slows into the limit over the last few cm, never stops dead on it.
        const over = P.pelvis.y - maxY, k = 0.05 * this.scale;
        need = Math.max(need, (over >= k ? over : over <= -k ? 0 : (over + k) * (over + k) / (4 * k)) * wf);
      }
      this.#reachStep(need, dt);
    } else this.#reachStep(0, dt);
    P.pelvis.y -= this.reachDrop * this.w.loco;

    bodyFrame(P.yawC, P.pitchC, P.spinC, P.leanC, F.chest);
    j.pelvis.copy(P.pelvis);
    // Spine: lower part follows the pelvis, upper part the chest.
    _v.copy(F.pelvis.d).multiplyScalar(0.35).addScaledVector(F.chest.d, 0.65).normalize();
    j.neck.copy(P.pelvis).addScaledVector(_v, d.spine).addScaledVector(F.chest.d, breath);
    j.chestC.copy(j.neck).addScaledVector(F.chest.d, -d.spine * 0.32);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      j.hip[i].copy(P.pelvis).addScaledVector(F.pelvis.r, side * d.hipW).addScaledVector(F.pelvis.d, -0.03 * sc);
      j.shoulder[i].copy(j.neck).addScaledVector(F.chest.r, side * d.shoulderW).addScaledVector(F.chest.d, -d.shoulderDrop + breath);
    }

    // Head: follows the look within limits relative to the chest; ADS tilts it onto the stock.
    const b = this.cfg.body;
    const lookYaw = s.yaw, lookPitch = e.weapons?.weaponPitch ?? this.aimPitch ?? 0;
    const hy = P.yawC + clamp(angleDelta(P.yawC, lookYaw), -b.headYawMax, b.headYawMax) * P.headW;
    const hp = clamp(-lookPitch * 0.85, P.pitchC - b.headPitchMax, P.pitchC + b.headPitchMax);
    const headPitch = lerp(P.pitchC, hp, P.headW) + this.flZ.x * L.flinch.head + this.rec.x * 0.02;
    const ads = sword ? 0 : (e.weapons?.ads ?? 0) * raisedK;
    bodyFrame(hy, headPitch, 0, P.leanC * 0.5 + this.flX.x * L.flinch.head + ads * 0.14, F.head);
    _v.copy(F.chest.d).multiplyScalar(0.6).addScaledVector(F.head.d, 0.4).normalize();
    j.neckTop.copy(j.neck).addScaledVector(_v, d.neck);
    j.head.copy(j.neckTop).addScaledVector(F.head.d, d.headR * 0.85).addScaledVector(F.head.n, 0.02 * sc);
  }

  /** The reach drop grows at once (a planted foot is never overstretched) and lets go on a critically damped spring. */
  #reachStep(need, dt) {
    if (need >= this.reachDrop) { this.reachDrop = need; this.reachV = 0; return; }
    const w = 16, n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n;
    for (let i = 0; i < n; i++) {
      this.reachV += (w * w * (need - this.reachDrop) - 2 * w * this.reachV) * h;
      this.reachDrop += this.reachV * h;
    }
    if (this.reachDrop < need) { this.reachDrop = need; this.reachV = 0; }
  }

  // ---------------------------------------------------------------- upper body
  #upperBody(P, dt) {
    const e = this.e;
    if (e.mode === 'sword' && e.melee) this.#swordHands(P);
    else if (e.weapons && !e.weapons.current && !e.isVehicle) this.#emptyHands(P, dt);
    else this.#gunHands(P, dt);
    // Pose overrides (ledge, ground, handlebars). A hand taken off the weapon slings it.
    for (let i = 0; i < 2; i++) if (P.handW[i] > 1e-3) this.handT[i].lerp(P.hand[i], P.handW[i]);
    const sling = P.handW[1];
    if (sling > 1e-3) {
      const F = this.F.chest, pr = this.prop;
      frameToWorld(F, this.j.neck, 0.12 * this.scale, -0.22 * this.scale, -0.2 * this.scale, _a);
      frameDir(F, -0.55, -0.72, -0.15, _b).normalize();
      pr.base.lerp(_a, sling);
      pr.dir.lerp(_b, sling).normalize();
      pr.up.lerp(F.n, sling).normalize();
    }
  }

  /**
   * The gun comes up and goes down on a critically damped spring: it starts from rest and lands
   * without a bump (a prone drop, a revive or a climb ending can't snap the arms up in a frame),
   * and it's quick enough to be up on the sim's sprint-to-fire timer (data: gun.raiseOmega).
   */
  #raiseStep(target, dt) {
    const [up, down] = this.cfg.gun.raiseOmega, w = target > this.raise ? up : down;
    const n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n;
    for (let i = 0; i < n; i++) {
      this.raiseV += (w * w * (target - this.raise) - 2 * w * this.raiseV) * h;
      this.raise += this.raiseV * h;
    }
  }

  #gunHands(P, dt) {
    const e = this.e, s = e.movement.state, g = this.cfg.gun, sc = this.scale, F = this.F.chest, neck = this.j.neck;
    const w = e.weapons, st = w?.current?.s;
    const pr = this.prop;
    pr.kind = st ? 'gun' : null;
    // Raise: exactly the sim's sprint-to-fire timer, so the gun is visibly up when it can shoot.
    const u = w && w.phaseDuration > 0 ? clamp((w.phaseTime - this.lag) / w.phaseDuration, 0, 1) : 1;
    let target = !s.weaponReady || s.sprinting ? 0 : w?.phase === 'sprintRecover' ? ease(u) : w?.phase === 'swapping' ? Math.abs(1 - 2 * u) : 1;
    target *= P.gunUp;
    if (target > 0.5 && this.raiseTarget <= 0.5) this.#cloth('raise', 0.25);
    this.raiseTarget = target;
    this.#raiseStep(target, dt);
    const raise = this.raise, ads = (w?.ads ?? 0) * raise;
    const lo = g.lowPocket, po = g.pocket, ad = g.adsPocket;
    const px = lerp(lerp(lo[0], po[0], raise), ad[0], ads), py = lerp(lerp(lo[1], po[1], raise), ad[1], ads), pz = lerp(lerp(lo[2], po[2], raise), ad[2], ads);
    const butt = frameToWorld(F, neck, px * sc, py * sc, pz * sc, pr.base);
    // Direction: the weapon's own aim (ergonomics drag and recoil included) when raised.
    const cy = Math.cos(this.aimYaw), sy = Math.sin(this.aimYaw), cp = Math.cos(this.aimPitch), sp = Math.sin(this.aimPitch);
    _a.set(-sy * cp, sp, -cy * cp);
    frameDir(F, g.lowDir[0], g.lowDir[1], g.lowDir[2], _b).normalize();
    const dir = pr.dir.copy(_b).lerp(_a, raise).normalize();
    // Sprint: port arms pump with the steps.
    if (raise < 0.95 && this.planter.walking && this.planterLive) {
      const ph = this.planter.clock * Math.PI;
      dir.addScaledVector(F.r, Math.sin(ph * 2) * 0.07 * (1 - raise)).normalize();
      butt.addScaledVector(F.d, Math.abs(Math.sin(ph * 2)) * 0.02 * sc * (1 - raise));
    }
    // The quick melee: the gun comes back and up, then the butt drives forward and returns.
    const m = e.melee;
    if (m?.attackId === 'bash' && (m.phase === 'windup' || m.phase === 'active' || m.phase === 'recovery')) {
      const a = m.attack, t = Math.max(0, m.phaseTime - this.lag);
      const ub = m.phase === 'windup' ? ease(clamp(t / a.windup, 0, 1)) : 1;
      const thrust = m.phase === 'windup' ? -0.16 * ub : m.phase === 'active' ? lerp(-0.16, 0.5, easeOut(clamp(t / a.active, 0, 1))) : lerp(0.5, 0, ease(clamp(t / a.recovery, 0, 1)));
      const tilt = m.phase === 'recovery' ? lerp(0.95, 0, ease(clamp(t / a.recovery, 0, 1))) : 0.95 * ub;
      _d.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
      butt.addScaledVector(_d, thrust * sc).addScaledVector(UP, 0.08 * ub * sc);
      dir.addScaledVector(UP, tilt).normalize();
    }
    // Gun frame.
    _r.crossVectors(dir, UP);
    if (_r.lengthSq() < 1e-6) _r.copy(F.r);
    _r.normalize();
    const U = pr.up.crossVectors(_r, dir).normalize();
    // Recoil: muzzle climbs, the stock drives back into the shoulder.
    const rk = this.rec.x;
    if (rk !== 0) {
      dir.addScaledVector(U, rk * this.cfg.layers.recoil.pitch).normalize();
      butt.addScaledVector(dir, -rk * this.cfg.layers.recoil.back * sc);
      U.crossVectors(_r, dir).normalize();
    }
    const L = this.#gunLength(st) * sc;
    pr.length = L;
    const phase = w?.phase;
    // Reload: roll the gun toward you, swap the mag with the left hand. Vent: muzzle up, hand on the vent.
    let leftDone = false;
    if (phase === 'reloading' || phase === 'venting' || phase === 'overheated') {
      const bump = Math.sin(Math.PI * u);
      if (phase === 'reloading') {
        _d.copy(U).applyAxisAngle(dir, 0.55 * bump); U.copy(_d);
        dir.addScaledVector(U, -0.22 * bump).normalize();
        const path = [[0, 'fore'], [0.22, 'well'], [0.45, 'pouch'], [0.68, 'well'], [0.88, 'fore'], [1, 'fore']];
        let i = 0;
        while (i < path.length - 2 && u > path[i + 1][0]) i++;
        this.#leftPoint(path[i][1], butt, dir, U, L, F, neck, _a);
        this.#leftPoint(path[i + 1][1], butt, dir, U, L, F, neck, _b);
        this.handT[0].copy(_a).lerp(_b, ease((u - path[i][0]) / (path[i + 1][0] - path[i][0])));
        leftDone = true;
      } else {
        dir.addScaledVector(UP, 0.45 * bump).normalize();
        this.handT[0].copy(butt).addScaledVector(dir, 0.42 * L).addScaledVector(U, 0.08 * sc);
        leftDone = true;
      }
    }
    this.handT[1].copy(butt).addScaledVector(dir, g.grip * sc).addScaledVector(U, -g.gripDrop * sc);
    if (!leftDone) this.handT[0].copy(butt).addScaledVector(dir, g.fore * L).addScaledVector(U, -g.foreDrop * sc);
    pr.glow = w?.current?.usesHeat ? (w.current.heat ?? 0) / (st?.ammo?.max ?? 100) : 0;
    pr.twoHanded = true;
  }

  /**
   * Nothing in his hands (the city's civilians until one picks a gun up): the arms hang and
   * swing against the legs as he walks, pump bent when he runs; cowering (e.cower: hiding from
   * the fighting), both hands clasped over the back of his head.
   */
  #emptyHands(P, dt) {
    const e = this.e, s = e.movement.state, sc = this.scale, F = this.F.chest, neck = this.j.neck, pr = this.prop;
    pr.kind = null; pr.glow = 0; pr.twoHanded = false;
    this.raiseTarget = 0;
    this.#raiseStep(0, dt);
    this.runK = (this.runK ?? 0) + ((s.sprinting ? 1 : 0) - (this.runK ?? 0)) * approach(8, dt);
    this.cowerK = (this.cowerK ?? 0) + ((e.cower ? 1 : 0) - (this.cowerK ?? 0)) * approach(7, dt);
    const rk = this.runK, ck = this.cowerK, walking = this.planter.walking && this.planterLive;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      // Swing: forward as the foot on the other side comes forward (its offset from its hip).
      let sw = 0;
      if (walking) {
        const f = this.planter.feet[1 - i], hip = this.j.hip[1 - i];
        sw = clamp(((f.pos.x - hip.x) * F.n.x + (f.pos.z - hip.z) * F.n.z) / (0.45 * sc), -1, 1);
      }
      const hx = side * lerp(0.21, 0.17, rk), hy = lerp(-0.6, -0.34, rk), hz = lerp(0.05, 0.12, rk) + sw * lerp(0.13, 0.22, rk);
      frameToWorld(F, neck, lerp(hx, side * 0.06, ck) * sc, lerp(hy, 0.15, ck) * sc, lerp(hz, -0.03, ck) * sc, this.handT[i]);
    }
  }

  #leftPoint(name, butt, dir, U, L, F, neck, out) {
    const g = this.cfg.gun, sc = this.scale;
    if (name === 'well') return out.copy(butt).addScaledVector(dir, g.magWell * L).addScaledVector(U, -0.13 * sc);
    if (name === 'pouch') return frameToWorld(F, neck, g.pouch[0] * sc, g.pouch[1] * sc, g.pouch[2] * sc, out);
    return out.copy(butt).addScaledVector(dir, g.fore * L).addScaledVector(U, -g.foreDrop * sc);
  }

  #gunLength(st) {
    const lens = this.cfg.gun.lengths;
    if (!st) return lens.default;
    if (st.id?.startsWith('super_')) return lens.super;
    return lens[st.archetype] ?? lens.default;
  }

  /** Sword keyframe state (chest-local hand and blade, twist, pitch) for the current melee phase. */
  #swordState() {
    const m = this.e.melee, sw = this.cfg.sword, s = this.e.movement.state, S = this.sword, out = this.swordLocal;
    const phase = m.phase;
    const kf = this.#attackKeys(m.attackId);
    const key = `${phase}:${m.attackId ?? ''}`;
    if (key !== S.key) {
      // Blend from wherever the blade is now: chained attacks flow without pops.
      S.key = key; S.fromH.copy(out.h); S.fromB.copy(out.b); S.fromTw = out.tw; S.fromPitch = out.pitch;
      // Where the blade is and how fast it's moving (capped): the follow-through starts from both.
      S.startH.copy(out.h); S.startB.copy(out.b);
      const cap = sw.followSpeed ?? 6, vh = S.velH.length(), vb = S.velB.length();
      S.v0H.copy(S.velH).multiplyScalar(vh > cap ? cap / vh : 1);
      S.v0B.copy(S.velB).multiplyScalar(vb > cap * 2 ? (cap * 2) / vb : 1);
      // A phase starts somewhere inside the last frame: carry the blade on by one frame's travel.
      const dt0 = this.dt ?? 1 / 60;
      S.startH.addScaledVector(S.v0H, dt0); S.startB.addScaledVector(S.v0B, dt0).normalize();
      if (phase === 'windup') this.#cloth('swing', m.attackId?.startsWith('heavy') ? 0.6 : 0.35);
    }
    const t = Math.max(0, m.phaseTime - this.lag);
    const set = (k, tw = 0, pitch = 0) => { _a.fromArray(k.h); _b.fromArray(k.b); return [tw ?? 0, pitch ?? 0]; };
    let tw = 0, pitch = 0, blend = 1;
    switch (phase) {
      case 'windup': {
        // The tell: pull back fast, then hold where the opponent can read it.
        [tw, pitch] = set(kf.wind, kf.wind.tw, kf.wind.pitch);
        blend = easeOut(t / Math.max(0.01, m.attack?.windup ?? 0.2) * 1.6);
        break;
      }
      case 'active': {
        // The strike accelerates through the arc.
        const arc = [kf.wind, ...kf.arc];
        const ua = easeIn(clamp(t / Math.max(0.01, m.attack?.active ?? 0.1), 0, 1)) * (arc.length - 1);
        const i = Math.min(arc.length - 2, Math.floor(ua)), f = ua - i;
        _a.fromArray(arc[i].h).lerp(_c.fromArray(arc[i + 1].h), f);
        _b.fromArray(arc[i].b).lerp(_c.fromArray(arc[i + 1].b), f);
        tw = lerp(kf.wind.tw ?? 0, kf.follow.tw ?? 0, ua / (arc.length - 1));
        pitch = lerp(kf.wind.pitch ?? 0, kf.follow.pitch ?? 0, ua / (arc.length - 1));
        blend = 1; S.fromH.copy(_a); S.fromB.copy(_b);
        break;
      }
      case 'recovery': {
        // Follow-through first (commitment: the blade carries the strike's speed and brakes, it
        // never stops dead at the end of the arc), then ease home.
        // It starts from wherever the strike left the blade.
        // A Hermite curve from there at the strike's speed onto the follow key: the blade carries
        // through a little past the strike and brakes.
        const rec = Math.max(0.01, m.attack?.recovery ?? 0.3), ur = clamp(t / rec, 0, 1);
        const home = s.sprinting ? sw.sprint : sw.idle;
        if (ur < 0.35) {
          const f = ur / 0.35, Tf = 0.35 * rec, f2 = f * f, f3 = f2 * f;
          const h00 = 2 * f3 - 3 * f2 + 1, h10 = (f3 - 2 * f2 + f) * Tf, h01 = 3 * f2 - 2 * f3;
          _a.copy(S.startH).multiplyScalar(h00).addScaledVector(S.v0H, h10).addScaledVector(_c.fromArray(kf.follow.h), h01);
          _b.copy(S.startB).multiplyScalar(h00).addScaledVector(S.v0B, h10).addScaledVector(_c.fromArray(kf.follow.b), h01);
          tw = kf.follow.tw ?? 0; pitch = kf.follow.pitch ?? 0;
        } else {
          const f = ease((ur - 0.35) / 0.65);
          _a.fromArray(kf.follow.h).lerp(_c.fromArray(home.h), f); _b.fromArray(kf.follow.b).lerp(_c.fromArray(home.b), f);
          tw = lerp(kf.follow.tw ?? 0, 0, f); pitch = lerp(kf.follow.pitch ?? 0, 0, f);
        }
        blend = 1; S.fromH.copy(_a); S.fromB.copy(_b);
        break;
      }
      case 'guard': case 'parryWhiff': set(sw.guard); blend = easeOut(t / 0.08); break;
      case 'stagger': set(sw.stagger); tw = 0.3; pitch = -0.25; blend = easeOut(t / 0.1); break;
      case 'guardBroken': set(sw.broken); tw = 0.4; pitch = -0.3; blend = easeOut(t / 0.1); break;
      case 'charging': [tw, pitch] = set(this.#attackKeys('heavy1').wind, this.#attackKeys('heavy1').wind.tw, this.#attackKeys('heavy1').wind.pitch); blend = easeOut(t / 0.15); break;
      default: set(s.sprinting ? sw.sprint : sw.idle); blend = easeOut(t / 0.18);
    }
    out.h.copy(S.fromH).lerp(_a, blend);
    out.b.copy(S.fromB).lerp(_b, blend).normalize();
    out.tw = lerp(S.fromTw, tw, blend);
    out.pitch = lerp(S.fromPitch, pitch, blend);
    const dt = this.dt ?? 1 / 60;
    if (dt > 0) { S.velH.subVectors(out.h, S.prevH).divideScalar(dt); S.velB.subVectors(out.b, S.prevB).divideScalar(dt); }
    S.prevH.copy(out.h); S.prevB.copy(out.b);
  }

  #attackKeys(id) {
    const sw = this.cfg.sword;
    if (!id) return sw.attacks.light1;
    if (sw.attacks[id]) return sw.attacks[id];
    for (const [frag, k] of Object.entries(sw.fallbacks)) if (id.toLowerCase().includes(frag)) return sw.attacks[k];
    return id.endsWith('2') ? sw.attacks.light2 : sw.attacks.light1;
  }

  #swordHands() {
    const m = this.e.melee, sw = this.cfg.sword, sc = this.scale, F = this.F.chest, neck = this.j.neck, out = this.swordLocal, pr = this.prop;
    frameToWorld(F, neck, out.h.x * sc, out.h.y * sc, out.h.z * sc, this.handT[1]);
    frameDir(F, out.b.x, out.b.y, out.b.z, pr.dir).normalize();
    pr.kind = 'blade';
    pr.base.copy(this.handT[1]);
    pr.length = sw.length * (m.w?.visual?.scale ?? 1) * sc;
    _r.crossVectors(pr.dir, F.d); if (_r.lengthSq() < 1e-6) _r.copy(F.r);
    pr.up.crossVectors(_r.normalize(), pr.dir).normalize();
    pr.glow = (m.heat ?? 0) / 100 + (m.phase === 'active' ? 0.8 : 0);
    const two = (m.w?.visual?.twoHanded || sw.twoHanded.includes(m.attackId)) && (m.phase === 'windup' || m.phase === 'active' || m.phase === 'recovery');   // spears and cleavers: both hands
    pr.twoHanded = two || m.phase === 'guard';
    // The off hand moves onto the grip (and back off it) over a few frames, never in one.
    this.twoW = (this.twoW ?? 0) + ((pr.twoHanded ? 1 : 0) - (this.twoW ?? 0)) * approach(22, this.dt ?? 1 / 60);
    frameToWorld(F, neck, (-0.24 - out.tw * 0.12) * sc, -0.36 * sc, (0.22 + out.tw * 0.05) * sc, this.handT[0]);
    if (this.twoW > 1e-3) this.handT[0].lerp(_a.copy(this.handT[1]).addScaledVector(pr.dir, -0.1 * sc), ease(this.twoW));
  }

  // ---------------------------------------------------------------- IK and secondary motion
  #solveLimbs(P) {
    const d = this.d, j = this.j, F = this.F.chest;
    for (let i = 0; i < 2; i++) {
      _pole.copy(P.knee[i]);
      if (_pole.lengthSq() < 1e-6) _pole.copy(F.n);
      _pole.normalize();
      // A pole running along the leg leaves the knee's side undecided: last frame's knee breaks the tie.
      _a.subVectors(P.foot[i], j.hip[i]).normalize();
      const along = Math.abs(_pole.dot(_a));
      if (along > 0.96 && this.kneeLive) {
        _b.subVectors(j.knee[i], j.hip[i]);
        _b.addScaledVector(_a, -_b.dot(_a));
        if (_b.lengthSq() > 1e-8) _pole.addScaledVector(_b.normalize(), (along - 0.96) * 25).normalize();
      }
      twoBoneIK(j.hip[i], P.foot[i], d.thigh, d.shin, _pole, j.knee[i], j.ankle[i]);
      j.footYaw[i] = P.footYaw[i];
      j.footPitch[i] = P.footPitch[i];
      // Elbows hang down and out (onto the ground when prone).
      const side = i === 0 ? -1 : 1;
      _pole.set(0, -0.75, 0).addScaledVector(F.r, side * 0.55).addScaledVector(F.n, -0.25).normalize();
      twoBoneIK(j.shoulder[i], this.handT[i], d.upperArm, d.foreArm, _pole, j.elbow[i], j.hand[i]);
    }
    this.kneeLive = true;
  }

  #capeStep(dt) {
    const c = this.cfg.cape, F = this.F.chest, sc = this.scale, pts = this.cape, prev = this.capePrev;
    const anchor = frameToWorld(F, this.j.neck, 0, -0.05 * sc, -0.15 * sc, _a);
    const link = c.linkLen * sc;
    if (!this.capeInit) {
      for (let i = 0; i < pts.length; i++) { pts[i].copy(anchor).y -= i * link; prev[i].copy(pts[i]); }
      this.capeInit = true;
    }
    pts[0].copy(anchor); prev[0].copy(anchor);
    const h = Math.min(dt, 1 / 30), g = c.gravity * h * h;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i], q = prev[i];
      _v.subVectors(p, q).multiplyScalar(c.damping);
      q.copy(p);
      p.add(_v); p.y -= g;
    }
    const back = frameToWorld(F, this.j.neck, 0, -0.25 * sc, 0, _b);
    const groundY = this.root.y + 0.03;
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], p = pts[i];
        _v.subVectors(p, a);
        const l = _v.length() || 1e-6;
        p.copy(a).addScaledVector(_v, link / l);
        // Stay behind the back and above the ground.
        const z = (p.x - back.x) * F.n.x + (p.y - back.y) * F.n.y + (p.z - back.z) * F.n.z;
        if (z > -0.14 * sc) p.addScaledVector(F.n, -0.14 * sc - z);
        if (p.y < groundY) p.y = groundY;
      }
    }
  }

  // ---------------------------------------------------------------- events out
  #onPlant(foot, kind) {
    const s = this.e.movement.state;
    const crouchK = this.#crouchK(s);
    const stance = crouchK > 0.5 ? 'crouch' : 'stand';
    const fs = this.cfg.footstep;
    let intensity;
    if (kind === 'settle') intensity = fs.settle;
    else intensity = lerp(table(this.cfg.gait.stand.intensity, s.speed / this.scale), table(this.cfg.gait.crouch.intensity, s.speed / this.scale), crouchK);
    intensity *= (fs.stanceMul[stance] ?? 1) * this.#armorMul() * Math.min(1.6, this.scale ** 1.5);
    this.comp.kick(intensity * fs.kick * (kind === 'settle' ? 0.3 : 1));
    const gait = kind === 'settle' ? 'shuffle' : stance === 'crouch' ? 'crouch' : s.gait === 'idle' ? 'walk' : s.gait;
    this.#emitStep(foot.index, gait, stance, intensity, foot.plant);
  }

  #emitStep(foot, gait, stance, intensity, p) {
    if (!this.emit) return;
    bus.emit('anim:footstep', {
      id: this.id, foot, gait, stance, intensity,
      surface: this.surfaceAt?.(p.x, p.y, p.z) ?? 'dirt',
      x: p.x, y: p.y, z: p.z, speed: this.e.movement.state.speed,
    });
  }

  #impact(kind, intensity) {
    if (!this.emit) return;
    const p = this.root;
    bus.emit('anim:impact', { id: this.id, kind, intensity, surface: this.surfaceAt?.(p.x, p.y, p.z) ?? 'dirt', x: p.x, y: p.y, z: p.z });
  }

  #cloth(kind, intensity) {
    if (!this.emit) return;
    bus.emit('anim:cloth', { id: this.id, kind, intensity, x: this.root.x, y: this.root.y, z: this.root.z });
  }

  #armorMul() { return this.cfg.footstep.armorMul[this.e.movement.armor ?? 'medium'] ?? 1; }

  // ---------------------------------------------------------------- housekeeping
  #setScale(sc) {
    this.scale = sc;
    for (const [k, v] of Object.entries(this.cfg.dims)) this.d[k] = v * sc;
    this.capeInit = false;
  }

  /** Teleport or first frame: snap everything to a clean standing pose at `root`. */
  #snap(root, yaw) {
    this.prevRoot.copy(root); this.root.copy(root);
    this.hasPrev = true;
    this.yaw = yaw;
    this.lm.hip.set(0); this.lm.lean.set(0); this.lm.bank.set(0); this.lm.hemi = 0;
    this.reachDrop = 0; this.reachV = 0;
    this.planter.reset(root, yaw, this.#gaitCfg(this.e.movement.state, 0));
    this.planterLive = false;
    for (const k of KEYS) { this.w[k] = k === 'loco' ? 1 : 0; this.fadeFrom[k] = this.w[k]; }
    this.fadeP = 1; this.active = 'loco'; this.cache = {}; this.knockPhase = null; this.knockT = 9;
    this.capeInit = false;
    this.motion.reset();
    this.rec.set(0); this.flX.set(0); this.flZ.set(0); this.comp.set(0);
    this.pops.reset(); this.twistPop.reset(); this.kneeLive = false;
    for (let i = 0; i < 2; i++) this.j.ankle[i].copy(this.planter.feet[i].ankle);
  }
}
