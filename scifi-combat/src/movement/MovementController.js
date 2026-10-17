// MovementController: Helldivers 2-fidelity locomotion (spec and calibration: docs/MOVEMENT.md).
//
// Pure simulation: it consumes one Command per fixed tick, mutates `this.state` and emits `move:*`
// events. No rendering or DOM. The same code runs on the server, in client prediction and for bots.
//
// How it gets the HD2 feel. If a change makes any of these lighter or floatier, it's wrong:
//  * Input is honored on the same tick. All weight comes from acceleration curves, turn rates and
//    committed states, never from input delay.
//  * Body facing is separate from velocity. While jogging, the body stays on your aim and you
//    strafe (third-person shooter). While sprinting, the body turns at 270 deg/s and the velocity
//    follows it, so sprint turns are wide, heavy arcs, and reversing a sprint is a plant-and-pivot skid.
//  * Speed has a curve: 0 to jog is near-instant, jog to sprint is a long ramp, and letting go of
//    a sprint skids about a metre.
//  * Stance changes take real time and limit movement while they play (getting up from prone is a commitment).
//  * The dive is a committed, low, fast leap with i-frames. It lands on the belly, belly-slides,
//    and leaves you prone, where you can shoot immediately or get up fast.
//  * The slide (sprint + crouch) is committed for 0.45 s, carries far on a friction curve that
//    ramps up, and can be steered at 80 deg/s.
//  * No coyote time and no jump buffer: HD2 has no such leniency.
//  * Heavy landings stumble you and big falls knock you down with a real get-up. Blasts, critical
//    hits, downs and deaths throw you as a full ragdoll (physics/Ragdoll.js): no control until the
//    body comes to rest where it landed, then a get-up (or the downed crawl, or a corpse).
//
// Physics adapter (`body`): move(delta) -> { delta, grounded, groundNormal }, setHeight(h),
// teleport(p), probe(origin, dir, dist) -> { distance, point, normal } | null.

import { Vector3 } from 'three';
import { bus } from '../core/EventBus.js';
import { Ragdoll, J } from '../physics/Ragdoll.js';

export const MoveState = Object.freeze({
  GROUND: 'ground', AIR: 'air', SLIDE: 'slide', DIVE: 'dive', DODGE: 'dodge', MANTLE: 'mantle',
  LAND: 'land', KNOCKDOWN: 'knockdown', WALLRUN: 'wallrun', VEHICLE: 'vehicle', RAGDOLL: 'ragdoll',
});
export const Stance = Object.freeze({ STAND: 'stand', CROUCH: 'crouch', PRONE: 'prone' });
export const Gait = Object.freeze({ IDLE: 'idle', WALK: 'walk', JOG: 'jog', SPRINT: 'sprint' });

const DEG = Math.PI / 180;
const UP = new Vector3(0, 1, 0);
const DOWN = new Vector3(0, -1, 0);
const NO_BOXES = Object.freeze([]);
const _wish = new Vector3();
const _fwd = new Vector3();
const _right = new Vector3();
const _delta = new Vector3();
const _tmp = new Vector3();
const _dir = new Vector3();

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
/** Yaw (radians) whose forward vector is (x, z). Forward at yaw 0 is -Z. */
export const yawOf = (x, z) => Math.atan2(-x, -z);
export const angleDelta = (a, b) => ((((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
const turnToward = (yaw, target, maxStep) => yaw + clamp(angleDelta(yaw, target), -maxStep, maxStep);
const forwardOf = (yaw, out) => out.set(-Math.sin(yaw), 0, -Math.cos(yaw));

export class MovementController {
  /**
   * @param {object} tuning  data/movement.json
   * @param {object} body    physics adapter
   * @param {object} mods    class modifiers { speedMul, accelMul, staminaMul, staminaRegenMul, armor,
   *                         canSprint, canDodge, canWallRun, jumpMul, dodgeStyle }
   */
  constructor(tuning, body, mods = {}, entityId = 0) {
    this.t = tuning;
    this.body = body;
    this.id = entityId;
    this.mods = { speedMul: 1, accelMul: 1, staminaMul: 1, canWallRun: true, dodgeStyle: 'dive', ...mods };
    if (this.mods.dodgeStyle === 'roll') this.mods.dodgeStyle = 'dive'; // legacy name for the HD2 dive
    // Armor class (HD2): explicit, or inferred from the class speed modifier.
    const armor = this.mods.armor ?? (this.mods.speedMul >= 1.08 ? 'light' : this.mods.speedMul <= 0.86 ? 'heavy' : 'medium');
    this.armor = armor;
    this.staminaRegenMul = this.mods.staminaRegenMul ?? tuning.armor?.[armor]?.staminaRegenMul ?? 1;
    /**
     * Optional callbacks wired by the entity factory: fallDamage(amount), vital() -> 'alive' |
     * 'downed' | 'dead' (what a ragdoll becomes when it comes to rest), scale() -> silhouette scale.
     */
    this.hooks = { fallDamage: null, vital: null, scale: null };
    this.ragdoll = null;          // physics/Ragdoll, created on the first throw and reused

    this.state = {
      mode: MoveState.GROUND,
      stance: Stance.STAND,
      stanceT: null,            // { from, to, t, dur } while a stance transition plays
      stanceQueued: null,
      position: new Vector3(),
      velocity: new Vector3(),
      yaw: 0,                   // camera / look yaw (from the command)
      bodyYaw: 0,               // where the body faces (animation, sprint direction)
      aimYaw: 0,                // weapon aim yaw: the look yaw, clamped to the body's arc while prone
      grounded: true,
      groundNormal: UP.clone(),
      stamina: tuning.stamina.max,
      staminaRegenTimer: 0,
      exhausted: false,
      lowStamina: false,
      modeTime: 0,
      time: 0,
      timeSinceGrounded: 0,
      invulnerable: false,
      sprinting: false,
      pivoting: false,
      gait: Gait.IDLE,
      speed: 0,
      accel: new Vector3(),     // smoothed horizontal acceleration (animation lean)
      bodyTurnRate: 0,          // rad/s (animation bank)
      crouchPress: null,        // { t, from, promoted } while the crouch key is held
      slide: null,              // { kind: 'feet' | 'belly', t }
      dive: null,               // { dirYaw, t, kind: 'forward' | 'left' | 'right' | 'back' }
      supine: false,            // lying on the back (after a back dive or a backward knockdown)
      dodgeDir: new Vector3(),
      dodgeStyle: null,
      mantle: null,
      knock: null,              // { phase: 'air' | 'ground' | 'getup', t, rest, supine }
      downed: false,            // at 0 HP but not dead: the wounded crawl (Health drives this)
      lastDiveLand: -99,
      wallRunsLeft: tuning.wallRun.perAirtime,
      wallNormal: new Vector3(),
      // Per-tick flags other components read in the same tick (movement updates first).
      diveStarted: false,
      knockStarted: false,
      weaponReady: true,        // false while mantling, knocked down, getting up or down from prone, sprinting
      busy: false,              // no ability casts (dive, mantle, knockdown, prone transitions, vehicle)
      // Locks set by other systems (melee recovery stops sprint; heavy attacks root you).
      locks: { sprint: 0, move: 0, jump: 0 },
      speedScale: 1,            // guarding 0.55, ADS ~0.65, casting slows, statuses
      forced: null,             // { x, z, time }: ability dashes that input acceleration must not fight
    };
  }

  // ---------------------------------------------------------------- public API
  /**
   * External impulse (launch pads, knock-backs, explosions, hits), a velocity change in m/s.
   * At or above the knockdown threshold (or with opts.ragdoll) it throws the soldier as a full
   * ragdoll, unless opts.knockdown === false (launch pads). A body that is already limp just
   * takes the push. opts: { at (world point it comes from), focus (0 uniform .. 1 local), cause }.
   */
  impulse(x, y, z, opts = {}) {
    const s = this.state;
    if (s.mode === MoveState.VEHICLE) return;
    if (s.mode === MoveState.RAGDOLL) { this.ragdoll.applyImpulse(x, y, z, opts.at ?? this.#pushPoint(x, z), opts.focus ?? this.t.ragdoll.blastFocus); return; }
    const k = this.t.knockdown;
    const mag = Math.hypot(x, y, z);
    const threshold = k.threshold * (s.stance === Stance.PRONE ? k.proneResist : 1);
    if (opts.ragdoll || (opts.knockdown !== false && mag >= threshold)) { this.startRagdoll(x, y, z, opts); return; }
    s.velocity.x += x; s.velocity.y += y; s.velocity.z += z;
    if (y > 0.5) {
      s.velocity.y = Math.max(s.velocity.y, y);
      s.grounded = false; s.timeSinceGrounded = 99;
      if (s.mode === MoveState.GROUND || s.mode === MoveState.LAND || s.mode === MoveState.SLIDE) this.#setMode(MoveState.AIR);
    }
  }

  /** Ragdoll-lite: thrown, tumble, slide, rest, get up. Re-knocking while down adds to the throw. */
  /** Old name for a throw: every knockdown by force is a full ragdoll now. */
  knockdown(x, y, z, cause = 'impulse') { return this.startRagdoll(x, y, z, { cause }); }

  /**
   * Go limp: the body becomes a ragdoll in the shape it was in, moving as it was, plus the push
   * (m/s). Casts and swings are interrupted (knockStarted); no control until it comes to rest.
   * @returns {boolean} false in a vehicle
   */
  startRagdoll(x = 0, y = 0, z = 0, { at = null, focus = null, cause = 'impulse' } = {}) {
    const s = this.state, R = this.t.ragdoll;
    if (s.mode === MoveState.VEHICLE) return false;
    if (s.mode !== MoveState.RAGDOLL) {
      const lying = s.stance === Stance.PRONE || s.mode === MoveState.DIVE || (s.mode === MoveState.SLIDE && s.slide?.kind === 'belly')
        || (s.mode === MoveState.KNOCKDOWN && s.knock?.phase !== 'getup');
      const supine = s.mode === MoveState.KNOCKDOWN ? !!s.knock?.supine : s.supine || (s.mode === MoveState.SLIDE && s.slide?.from === 'back') || s.dive?.kind === 'back';
      const pose = lying ? (supine ? 'supine' : 'prone') : s.stance === Stance.CROUCH || s.mode === MoveState.SLIDE ? 'crouch' : 'stand';
      (this.ragdoll ??= new Ragdoll(R)).init(pose, s.position, s.bodyYaw, this.hooks.scale?.() ?? 1, s.velocity, this.body);
      s.sprinting = false; s.stanceT = null; s.stanceQueued = null; s.crouchPress = null;
      s.slide = null; s.dive = null; s.mantle = null; s.knock = null; s.forced = null;
      this.#setInvulnerable(false);
      this.#setMode(MoveState.RAGDOLL);
      s.knockStarted = true;
      s.grounded = false; s.timeSinceGrounded = 99;
      this.body.setHeight(this.t.heights.prone);
      const mag = Math.hypot(x, y, z);
      bus.emit('move:ragdoll', { id: this.id, cause, impulse: mag });
      bus.emit('move:knockdown', { id: this.id, cause, impulse: mag }); // camera, audio and AI listen for this
    }
    this.ragdoll.applyImpulse(x, y, z, at ?? this.#pushPoint(x, z), focus ?? R.blastFocus);
    return true;
  }

  /**
   * Where a push with no stated origin comes from: low and behind (blasts, rams and shoves come
   * up from the ground), so the legs go first and the body tumbles instead of sliding upright.
   */
  #pushPoint(x, z) {
    const l = Math.hypot(x, z), p = this.state.position;
    if (l < 0.5) return null;
    return { x: p.x - (x / l) * 0.8, y: p.y + 0.1, z: p.z - (z / l) * 0.8 };
  }

  /** Dead bodies keep falling until they rest (no command; called instead of update()). */
  simulateCorpse(dt) {
    if (this.state.mode === MoveState.RAGDOLL && !this.ragdoll.asleep) { this.#ragdollTick(dt); this.#post(dt, this.state.velocity.x, this.state.velocity.z, this.state.bodyYaw); }
  }

  /** Respawn or teleport: standing still at `pos`, every transient state cleared. */
  reset(pos, yaw = this.state.bodyYaw) {
    const s = this.state;
    s.position.copy(pos); this.body.teleport(pos); s.velocity.set(0, 0, 0);
    s.mode = MoveState.GROUND; s.modeTime = 0; s.stance = Stance.STAND;
    s.stanceT = null; s.stanceQueued = null; s.crouchPress = null; s.slide = null; s.dive = null; s.mantle = null; s.knock = null; s.forced = null;
    s.supine = false; s.downed = false; s.sprinting = false; s.pivoting = false;
    s.yaw = s.bodyYaw = s.aimYaw = yaw;
    s.stamina = this.t.stamina.max; s.exhausted = false; s.staminaRegenTimer = 0;
    s.grounded = true; s.timeSinceGrounded = 0;
    for (const k in s.locks) s.locks[k] = 0;
    this.#setInvulnerable(false);
    this.body.setHeight(this.t.heights.stand);
  }

  /** Called by VehicleSystem: the body is now carried by a vehicle seat. */
  enterVehicle() {
    const s = this.state;
    s.mode = MoveState.VEHICLE; s.modeTime = 0;
    s.velocity.set(0, 0, 0);
    s.slide = null; s.dive = null; s.knock = null; s.stanceT = null; s.mantle = null;
    s.stance = Stance.STAND; this.body.setHeight(this.t.heights.stand);
    this.#setInvulnerable(false);
    s.sprinting = false; s.forced = null;
  }

  /** Hop out at `pos`, carrying some of the vehicle's velocity. Lands in AIR so ejects arc naturally. */
  exitVehicle(pos, vel) {
    const s = this.state;
    s.position.copy(pos);
    this.body.teleport?.(pos);
    s.velocity.copy(vel);
    s.grounded = false; s.timeSinceGrounded = 99;
    s.mode = MoveState.AIR; s.modeTime = 0;
    s.bodyYaw = s.yaw;
    if (s.stance !== Stance.STAND) { s.stance = Stance.STAND; this.body.setHeight(this.t.heights.stand); }
  }

  canAct() { const m = this.state.mode; return m !== MoveState.MANTLE && m !== MoveState.VEHICLE && m !== MoveState.KNOCKDOWN && m !== MoveState.RAGDOLL && !this.state.downed; }
  isSliding() { return this.state.mode === MoveState.SLIDE; }
  spendStamina(amount) {
    const s = this.state;
    const cost = amount * this.mods.staminaMul;
    if (cost <= 0) return true;
    if (s.stamina < cost) return false;
    s.stamina -= cost;
    s.staminaRegenTimer = this.t.stamina.regenDelay;
    return true;
  }

  // ---------------------------------------------------------------- tick
  update(cmd, dt) {
    const s = this.state;
    const b = cmd.buttons;
    s.diveStarted = false; s.knockStarted = false;
    s.yaw = cmd.yaw;
    s.modeTime += dt;
    s.time += dt;
    for (const k in s.locks) s.locks[k] = Math.max(0, s.locks[k] - dt);
    const prevVx = s.velocity.x, prevVz = s.velocity.z, prevBodyYaw = s.bodyYaw;

    // Camera-relative wish direction on the ground plane.
    forwardOf(s.yaw, _fwd);
    _right.set(-_fwd.z, 0, _fwd.x);
    _wish.copy(_fwd).multiplyScalar(cmd.moveY ?? 0).addScaledVector(_right, cmd.moveX ?? 0);
    let wishMag = Math.min(1, _wish.length());
    if (wishMag > 1e-4) _wish.divideScalar(Math.max(1e-4, _wish.length())); else wishMag = 0;
    if (s.locks.move > 0) wishMag = 0;

    this.#updateStamina(dt);

    if (s.mode === MoveState.VEHICLE) { this.#post(dt, prevVx, prevVz, prevBodyYaw); return; }

    if (s.forced && s.forced.time > 0) {
      // Forced motion (ability dashes) overrides input acceleration but not gravity.
      s.forced.time -= dt;
      s.velocity.x = s.forced.x; s.velocity.z = s.forced.z;
      if (!s.grounded) s.velocity.y -= this.t.gravity * dt;
      s.bodyYaw = turnToward(s.bodyYaw, yawOf(s.forced.x, s.forced.z), this.t.turnRates.dive * DEG * dt);
      if (s.forced.time <= 0) { s.forced = null; s.velocity.multiplyScalar(0.35); }
    } else {
      switch (s.mode) {
        case MoveState.GROUND:
        case MoveState.LAND:      this.#ground(cmd, dt, wishMag); break;
        case MoveState.AIR:       this.#air(cmd, dt, wishMag); break;
        case MoveState.SLIDE:     this.#slide(cmd, dt, wishMag); break;
        case MoveState.DIVE:      this.#dive(cmd, dt, wishMag); break;
        case MoveState.DODGE:     this.#dodge(cmd, dt); break;
        case MoveState.KNOCKDOWN: this.#knockdown(cmd, dt); break;
        case MoveState.WALLRUN:   this.#wallRun(cmd, dt); break;
        case MoveState.MANTLE:    this.#mantle(dt); this.#post(dt, prevVx, prevVz, prevBodyYaw); return; // root motion
        case MoveState.RAGDOLL:   this.#ragdollTick(dt); this.#post(dt, prevVx, prevVz, prevBodyYaw); return; // the body moves the root
      }
    }
    if (s.mode === MoveState.MANTLE) { this.#post(dt, prevVx, prevVz, prevBodyYaw); return; } // a mantle just started

    // Integrate through the physics adapter (collide-and-slide, steps, slopes).
    s.velocity.y = Math.max(s.velocity.y, -this.t.terminalVelocity);
    _delta.copy(s.velocity).multiplyScalar(dt);
    // Stay glued to the ground while grounded (crests, steps down); a hop or dive this tick has
    // already cleared `grounded`, so it leaves the ground normally.
    const res = this.body.move(_delta, s.grounded && s.mode !== MoveState.AIR && s.mode !== MoveState.DIVE);
    s.position.add(res.delta);
    if (dt > 0) {
      // Velocity into surfaces we hit is removed: no sticky walls, no ceiling hang.
      const rx = res.delta.x / dt, rz = res.delta.z / dt, ry = res.delta.y / dt;
      if (Math.abs(rx - s.velocity.x) > 0.01) s.velocity.x = rx;
      if (Math.abs(rz - s.velocity.z) > 0.01) s.velocity.z = rz;
      if (s.velocity.y > 0 && ry < s.velocity.y - 0.01) s.velocity.y = ry;
    }
    this.#updateGrounded(res, dt);
    this.#post(dt, prevVx, prevVz, prevBodyYaw);
  }

  // ---------------------------------------------------------------- ground: idle / walk / jog / sprint / crouch / prone
  #ground(cmd, dt, wishMag) {
    const s = this.state, t = this.t, b = cmd.buttons;
    if (s.downed) return this.#downedCrawl(dt, wishMag);
    const landing = s.mode === MoveState.LAND;
    if (landing && s.modeTime >= t.landing.heavyRecovery) this.#setMode(MoveState.GROUND);
    this.#tickStance(dt);

    // Dive or evade interrupts almost everything (HD2: always available on your feet or crouched).
    if (b.dodge?.pressed && !landing && this.#canEvade()) return this.#startEvade(wishMag);

    // Climb or vault: hold the climb key and it climbs when you reach the ledge (HD2 hold-to-climb).
    // Space only hops (the Battlefront addition) when there's nothing climbable just ahead.
    const canClimb = !landing && s.stance !== Stance.PRONE && !s.stanceT;
    if (b.jump?.down && canClimb && this.#tryMantle(wishMag, true)) return;
    if (t.mantle.autoVaultWhileSprinting && s.sprinting && this.#tryMantle(wishMag, false)) return;
    if (b.jump?.pressed) {
      if (s.stance === Stance.PRONE || s.stanceT?.to === Stance.PRONE) { this.#requestStance(Stance.STAND); }
      else if (canClimb && this.#findLedge(wishMag, true, t.mantle.probeDistance + this.#hspeed() * 0.35)) { /* keep holding: the climb triggers at the ledge */ }
      else if (!landing && t.jump.enabled && s.locks.jump <= 0 && !(s.stanceT && (s.stanceT.from === Stance.PRONE))) return this.#hop();
    }

    // Stance input (crouch tap/hold, prone key) and sprint + crouch = slide.
    if (this.#stanceInput(cmd, dt)) return;

    // Sprint: any direction (the body turns to run that way); stands you up; needs stamina.
    const wantSprint = !!b.sprint?.down && wishMag > 0.3;
    if (wantSprint && !landing && s.stance !== Stance.STAND && !s.stanceT) this.#requestStance(Stance.STAND);
    const canSprint = wantSprint && !landing && s.stance === Stance.STAND && !s.stanceT && !s.exhausted
      && s.locks.sprint <= 0 && s.speedScale >= 0.999 && this.mods.canSprint !== false;
    if (canSprint !== s.sprinting) {
      s.sprinting = canSprint;
      if (!canSprint) s.pivoting = false;
      bus.emit('move:sprint', { id: this.id, on: canSprint });
    }

    if (s.sprinting) this.#sprintMove(dt);
    else this.#strafeMove(dt, wishMag, landing);

    // Keep velocity on the ground plane so slopes and ramps never launch you.
    const n = s.groundNormal;
    const vn = s.velocity.dot(n);
    s.velocity.addScaledVector(n, -vn);
    s.velocity.y -= 2 * dt;
    // Too-steep ground: you lose footing and slip downhill.
    if (n.y < Math.cos(t.slopes.maxWalkDeg * DEG)) {
      _tmp.set(0, -t.gravity, 0).addScaledVector(n, t.gravity * n.y);
      s.velocity.addScaledVector(_tmp, dt);
    }
  }

  /**
   * Downed: a slow wounded crawl (data: downed), nothing else. On the belly it crawls where you
   * steer; on the back it scoots, slower. The body turns slowly toward the way it's going.
   */
  #downedCrawl(dt, wishMag) {
    const s = this.state, d = this.t.downed;
    s.sprinting = false; s.stanceT = null; s.stanceQueued = null; s.stance = Stance.PRONE;
    const target = d.crawlSpeed * (s.supine ? d.supineMul : 1) * wishMag * Math.min(1, s.speedScale ?? 1);
    const dvx = _wish.x * target - s.velocity.x, dvz = _wish.z * target - s.velocity.z, dvl = Math.hypot(dvx, dvz);
    if (dvl > 1e-5) { const step = Math.min(dvl, d.accel * dt); s.velocity.x += (dvx / dvl) * step; s.velocity.z += (dvz / dvl) * step; }
    if (wishMag > 0.1) {
      // Belly: head first toward the wish. Back: the head leads too, and it lies behind bodyYaw.
      const want = yawOf(_wish.x, _wish.z) + (s.supine ? Math.PI : 0);
      s.bodyYaw = turnToward(s.bodyYaw, want, d.turnRate * DEG * dt);
    }
    const n = s.groundNormal, vn = s.velocity.dot(n);
    s.velocity.addScaledVector(n, -vn);
    s.velocity.y -= 2 * dt;
  }

  /** Reviving someone: get down to a crouch (no-op if already low or mid-transition). */
  kneel() { const s = this.state; if (s.mode === MoveState.GROUND && s.stance === Stance.STAND && !s.stanceT && !s.downed) this.#requestStance(Stance.CROUCH); }

  /** Revived (Health): the HD2 get-up from wherever you lie (a body still falling gets up when it rests). */
  getUpFromDown() {
    const s = this.state;
    s.downed = false;
    if (s.mode === MoveState.RAGDOLL) return;
    s.knock = { phase: 'getup', t: 0, rest: 0, supine: s.supine };
    s.stanceT = null; s.stance = Stance.PRONE; s.velocity.set(0, 0, 0);
    this.body.setHeight(this.t.heights.prone);
    this.#setMode(MoveState.KNOCKDOWN);
    bus.emit('move:getup', { id: this.id, duration: this.t.knockdown.getUpTime });
  }

  /** Sprint: the velocity follows the body, and the body turns at the sprint turn rate (carving). */
  #sprintMove(dt) {
    const s = this.state, t = this.t;
    const desiredYaw = yawOf(_wish.x, _wish.z);
    const delta = angleDelta(s.bodyYaw, desiredYaw);
    const sp = this.#hspeed();
    // Plant and pivot: past the pivot angle you skid along the old direction while the body swings
    // around, and the pivot holds until the body is within 25 deg of the new heading.
    if ((Math.abs(delta) > t.sprint.pivotAngle * DEG && sp > t.speeds.jog * 0.6) || (s.pivoting && Math.abs(delta) > 25 * DEG)) {
      if (!s.pivoting) { s.pivoting = true; bus.emit('move:skid', { id: this.id, kind: 'pivot', speed: sp }); }
      const k = Math.max(0, sp - t.sprint.pivotDecel * dt) / (sp || 1);
      s.velocity.x *= k; s.velocity.z *= k;
      s.bodyYaw = turnToward(s.bodyYaw, desiredYaw, t.sprint.pivotTurnRate * DEG * dt);
      return;
    }
    s.pivoting = false;
    const before = s.bodyYaw;
    s.bodyYaw = turnToward(s.bodyYaw, desiredYaw, t.turnRates.sprint * DEG * dt);
    const turned = Math.abs(angleDelta(before, s.bodyYaw));
    forwardOf(s.bodyYaw, _dir);
    // Tight carves bleed speed; the sprint ramp is long and heavy.
    let speed = sp * (1 - t.sprint.carveSpeedLoss * turned);
    speed = this.#approachSpeed(speed, this.#speedFor(t.speeds.sprint), dt);
    s.velocity.x = _dir.x * speed; s.velocity.z = _dir.z * speed;
  }

  /** Jog, walk, crouch and prone: camera-relative strafing with the body kept on the aim. */
  #strafeMove(dt, wishMag, landing) {
    const s = this.state, t = this.t;
    let base = s.stance === Stance.PRONE ? t.speeds.prone : s.stance === Stance.CROUCH ? t.speeds.crouch
      : wishMag < t.speeds.analogWalkBelow ? t.speeds.walk : t.speeds.jog;
    if (s.stanceT) {
      const tr = s.stanceT;
      base = Math.min(this.#stanceSpeed(tr.from), this.#stanceSpeed(tr.to)) * t.stance.transitionMoveMul;
      // Getting up from prone is a commitment: no movement for the first half.
      if (tr.from === Stance.PRONE && tr.t < tr.dur * t.stance.proneGetUpLockFrac) base = 0;
    }
    if (landing) base *= t.landing.heavySpeedMul;
    // Analog: past the walk threshold you get the full stance speed; below it, a proportional walk.
    const analog = wishMag >= t.speeds.analogWalkBelow ? 1 : wishMag > 0 ? Math.max(0.35, wishMag / t.speeds.analogWalkBelow) : 0;
    const target = this.#speedFor(base) * analog;
    const sp = this.#hspeed();
    const dvx = _wish.x * target - s.velocity.x, dvz = _wish.z * target - s.velocity.z;
    const dvl = Math.hypot(dvx, dvz);
    if (dvl > 1e-5) {
      // Speeding up below jog: near-instant. Slowing from above jog: the heavy sprint skid.
      const slowing = target < sp - 0.05;
      const rate = (slowing ? (sp > t.speeds.jog + 0.2 ? t.accel.sprintStop : t.accel.stop) : t.accel.toJog) * this.mods.accelMul;
      const step = Math.min(dvl, rate * dt);
      s.velocity.x += (dvx / dvl) * step;
      s.velocity.z += (dvz / dvl) * step;
      if (slowing && sp > t.speeds.jog + 0.5 && !this._skidding) { this._skidding = true; bus.emit('move:skid', { id: this.id, kind: 'stop', speed: sp }); }
    }
    if (sp < t.speeds.jog) this._skidding = false;
    // The body stays on the aim (third-person shooter); prone turns slowly and deliberately.
    const rate = s.stance === Stance.PRONE ? t.turnRates.prone : s.stance === Stance.CROUCH ? t.turnRates.crouch : landing ? t.turnRates.land : t.turnRates.jog;
    s.bodyYaw = turnToward(s.bodyYaw, s.yaw, rate * DEG * dt);
  }

  #stanceSpeed(stance) { const sp = this.t.speeds; return stance === Stance.PRONE ? sp.prone : stance === Stance.CROUCH ? sp.crouch : sp.jog; }

  /** Applies armor speed, external scaling (ADS, guard, statuses) and the slope factor. */
  #speedFor(base) {
    const s = this.state;
    let k = this.mods.speedMul * s.speedScale;
    const n = s.groundNormal;
    if (s.grounded && n.y < 0.999 && this.#hspeed() > 0.5) {
      // Climb ratio along the direction of travel: uphill slows you, downhill speeds you up a little.
      const vx = s.velocity.x, vz = s.velocity.z, l = Math.hypot(vx, vz);
      const climb = -(vx * n.x + vz * n.z) / l / Math.max(0.2, n.y);
      k *= 1 - this.t.slopes.uphillPenalty * clamp(climb, 0, 1) + this.t.slopes.downhillBonus * clamp(-climb, 0, 1);
    }
    return base * k;
  }

  /** Speed approach with HD2's curve: fast to jog, slow from jog to sprint, skid when slowing. */
  #approachSpeed(speed, target, dt) {
    const t = this.t;
    if (speed < target) {
      const rate = (speed < t.speeds.jog * this.mods.speedMul ? t.accel.toJog : t.accel.jogToSprint) * this.mods.accelMul;
      return Math.min(target, speed + rate * dt);
    }
    const rate = speed > t.speeds.jog + 0.2 ? t.accel.sprintStop : t.accel.stop;
    return Math.max(target, speed - rate * dt);
  }

  // ---------------------------------------------------------------- stance
  /** Crouch: tap toggles, holding goes prone (HD2 controller layout). Prone key toggles prone. */
  #stanceInput(cmd, dt) {
    const s = this.state, b = cmd.buttons, st = this.t.stance;
    if (b.prone?.pressed) {
      const proneNow = s.stance === Stance.PRONE && !s.stanceT;
      this.#requestStance(proneNow ? Stance.CROUCH : Stance.PRONE);
      return false;
    }
    if (b.crouch?.pressed) {
      // Sprint + crouch = the committed slide.
      if (s.sprinting && this.#hspeed() >= this.t.slide.minEntrySpeed * this.mods.speedMul * 0.9 && s.stance === Stance.STAND) {
        this.#startSlide('feet');
        return true;
      }
      const from = s.stanceT?.to ?? s.stance;
      s.crouchPress = { t: 0, from, promoted: false };
      if (from === Stance.STAND) this.#requestStance(Stance.CROUCH);
      else if (from === Stance.PRONE) this.#requestStance(Stance.CROUCH);
    }
    const cp = s.crouchPress;
    if (cp) {
      if (b.crouch?.down) {
        cp.t += dt;
        if (!cp.promoted && cp.t >= st.proneHold && cp.from !== Stance.PRONE) { cp.promoted = true; this.#requestStance(Stance.PRONE); }
      } else {
        if (cp.from === Stance.CROUCH && !cp.promoted && cp.t < st.proneHold) this.#requestStance(Stance.STAND);
        s.crouchPress = null;
      }
    }
    return false;
  }

  #requestStance(target, { force = false } = {}) {
    const s = this.state, st = this.t.stance, h = this.t.heights;
    if (s.stanceT) {
      if (s.stanceT.to !== target) s.stanceQueued = target; // queue behind the current transition
      return;
    }
    if (s.stance === target) return;
    // Headroom check before rising (you can't stand up under a low overhang).
    if (h[target] > h[s.stance] && !force) {
      const p = _tmp.copy(s.position); p.y += h[s.stance] - 0.05;
      if (this.body.probe(p, UP, h[target] - h[s.stance] + 0.05)) { bus.emit('move:stanceBlocked', { id: this.id, target }); return; }
    }
    const key = `${s.stance}To${target[0].toUpperCase()}${target.slice(1)}`;
    let dur = st[key] ?? 0.3;
    if (s.stance === Stance.PRONE && target === Stance.STAND && s.time - s.lastDiveLand < st.fastGetUpWindow) dur = st.fastGetUp;
    s.stanceT = { from: s.stance, to: target, t: 0, dur };
    s.sprinting = false;
    if (h[target] < h[s.stance]) this.body.setHeight(h[target]); // shrink now, grow when done
    bus.emit('move:stance', { id: this.id, from: s.stance, to: target, duration: dur });
  }

  #tickStance(dt) {
    const s = this.state, tr = s.stanceT;
    if (!tr) return;
    tr.t += dt;
    if (tr.t < tr.dur) return;
    s.stance = tr.to;
    s.stanceT = null;
    if (s.stance !== Stance.PRONE) s.supine = false;
    this.body.setHeight(this.t.heights[s.stance]);
    bus.emit('move:stanceDone', { id: this.id, stance: s.stance });
    if (s.stanceQueued) { const q = s.stanceQueued; s.stanceQueued = null; if (q !== s.stance) this.#requestStance(q); }
  }

  // ---------------------------------------------------------------- dive and evades
  #canEvade() {
    const s = this.state;
    if (this.mods.canDodge === false) return false;
    if (s.stance === Stance.PRONE || (s.stanceT && (s.stanceT.from === Stance.PRONE || s.stanceT.to === Stance.PRONE))) return false;
    return true;
  }

  #startEvade(wishMag) {
    const style = this.mods.dodgeStyle;
    if (style !== 'dive') return this.#startDodge(style, wishMag);
    const s = this.state, d = this.t.dive;
    if (!this.spendStamina(d.staminaCost)) return;
    const dir = wishMag > 0.15 ? _dir.copy(_wish) : forwardOf(s.yaw, _dir);
    const along = s.velocity.x * dir.x + s.velocity.z * dir.z;
    const hs = Math.min(d.maxSpeed * this.mods.speedMul, Math.max(along, d.minSpeed) + d.boost);
    s.velocity.set(dir.x * hs, d.upVelocity, dir.z * hs);
    // Directional dive: out of a sprint (or with no input) you dive the way you face. Otherwise
    // the body stays on your aim and you dive sideways or backward (you land on your back after
    // a back dive and can keep shooting).
    const dirYaw = yawOf(dir.x, dir.z);
    const rel = angleDelta(s.yaw, dirYaw);
    const kind = s.sprinting || wishMag <= 0.15 || Math.abs(rel) < d.sideAngle * DEG ? 'forward'
      : Math.abs(rel) < d.backAngle * DEG ? (rel > 0 ? 'left' : 'right') : 'back';
    s.dive = { dirYaw, t: 0, kind };
    s.supine = false;
    s.sprinting = false; s.stanceT = null; s.stanceQueued = null; s.crouchPress = null; s.slide = null;
    s.grounded = false;
    this.body.setHeight(this.t.heights.dive);
    this.#setMode(MoveState.DIVE);
    s.diveStarted = true;
    bus.emit('move:dive', { id: this.id, dir: dir.toArray(), speed: hs });
  }

  #dive(cmd, dt, wishMag) {
    const s = this.state, d = this.t.dive;
    s.dive.t += dt;
    s.velocity.y -= d.gravity * dt;
    // Committed arc with only a little directional influence.
    if (wishMag > 0) { s.velocity.x += _wish.x * d.airControl * dt; s.velocity.z += _wish.z * d.airControl * dt; }
    this.#setInvulnerable(s.dive.t >= d.iframeStart && s.dive.t <= d.iframeEnd);
    if (s.dive.kind === 'forward') s.bodyYaw = turnToward(s.bodyYaw, s.dive.dirYaw, this.t.turnRates.dive * DEG * dt);
    else s.bodyYaw = turnToward(s.bodyYaw, s.yaw, this.t.turnRates.jog * DEG * dt);
  }

  /** Ground evades for melee classes (flameStep, ashStep) and the heavy shoulder bash. */
  #startDodge(style, wishMag) {
    const s = this.state, e = this.t.evade[style] ?? this.t.evade.flameStep;
    if (!this.spendStamina(e.staminaCost)) return;
    s.dodgeDir.copy(wishMag > 0.15 ? _wish : forwardOf(s.yaw, _tmp).negate()).setY(0).normalize();
    s.dodgeStyle = style;
    s.sprinting = false;
    this.#setMode(MoveState.DODGE);
    s.diveStarted = true; // evades interrupt actions the same way a dive does
    bus.emit('move:dodge', { id: this.id, dir: s.dodgeDir.toArray(), style });
  }

  #dodge(cmd, dt) {
    const s = this.state, e = this.t.evade[s.dodgeStyle] ?? this.t.evade.flameStep;
    const k = 1 - s.modeTime / e.duration;
    const speed = e.speed * Math.max(0, k * k * 1.4);
    s.velocity.x = s.dodgeDir.x * speed; s.velocity.z = s.dodgeDir.z * speed;
    s.velocity.y -= this.t.gravity * dt;
    this.#setInvulnerable(s.modeTime >= e.iframeStart && s.modeTime <= e.iframeEnd);
    s.bodyYaw = turnToward(s.bodyYaw, s.yaw, this.t.turnRates.jog * DEG * dt);
    if (s.modeTime >= e.duration || (s.modeTime >= e.cancelableAfter && cmd.buttons.sprint?.pressed)) {
      this.#setInvulnerable(false);
      this.#setMode(s.grounded ? MoveState.GROUND : MoveState.AIR);
    }
  }

  // ---------------------------------------------------------------- slide (feet-first) and belly slide (post-dive)
  #startSlide(kind, speedKeep = 1) {
    const s = this.state, t = this.t;
    const sp = this.#hspeed();
    let target = sp * speedKeep;
    if (kind === 'feet') target = Math.min(sp * t.slide.entryBoost, t.slide.maxEntrySpeed * this.mods.speedMul);
    const k = sp > 1e-4 ? target / sp : 0;
    s.velocity.x *= k; s.velocity.z *= k;
    s.slide = { kind, t: 0 };
    s.sprinting = false; s.crouchPress = null; s.stanceT = null;
    this.body.setHeight(kind === 'feet' ? t.heights.slide : t.heights.prone);
    this.#setMode(MoveState.SLIDE);
    bus.emit('move:slide', { id: this.id, kind, speed: target });
  }

  #slide(cmd, dt, wishMag) {
    const s = this.state, t = this.t, b = cmd.buttons;
    const kind = s.slide.kind;
    const cfg = kind === 'feet' ? t.slide : t.dive.belly;
    s.slide.t += dt;
    // Gravity along the surface: downhill slides accelerate, uphill slides bleed out fast.
    const n = s.groundNormal;
    _tmp.set(0, -t.gravity * cfg.slopeGravity, 0);
    _tmp.addScaledVector(n, -_tmp.dot(n));
    s.velocity.addScaledVector(_tmp, dt);
    // Friction on a decay curve: low at entry (the slide carries), high at the end (it stops decisively).
    const fr = kind === 'feet' ? lerp(cfg.frictionStart, cfg.frictionEnd, Math.min(1, s.slide.t / cfg.frictionRampTime)) : cfg.friction;
    const sp = this.#hspeed();
    const newSp = Math.max(0, sp - fr * dt);
    if (sp > 1e-4) { const k = newSp / sp; s.velocity.x *= k; s.velocity.z *= k; }
    // Steering authority: the velocity direction turns toward the stick at the steer rate.
    if (wishMag > 0.2 && newSp > 0.5) {
      const vy0 = yawOf(s.velocity.x, s.velocity.z);
      const ny = turnToward(vy0, yawOf(_wish.x, _wish.z), cfg.steerRate * DEG * dt);
      forwardOf(ny, _dir);
      s.velocity.x = _dir.x * newSp; s.velocity.z = _dir.z * newSp;
    }
    const keepAim = kind === 'belly' && s.slide.from && s.slide.from !== 'forward';
    if (keepAim) s.bodyYaw = turnToward(s.bodyYaw, s.yaw, t.turnRates.prone * DEG * dt);
    else if (newSp > 0.3) s.bodyYaw = turnToward(s.bodyYaw, yawOf(s.velocity.x, s.velocity.z), (kind === 'feet' ? t.turnRates.slide : t.turnRates.belly) * DEG * dt);
    s.velocity.y -= 2 * dt; // stay glued to the ground

    if (kind === 'feet') {
      if (b.jump?.pressed && s.slide.t >= cfg.jumpAfter && t.jump.enabled) {
        s.velocity.x *= cfg.jumpCarry; s.velocity.z *= cfg.jumpCarry;
        s.slide = null; s.stance = Stance.STAND;
        return this.#hop();
      }
      if (b.dodge?.pressed && this.mods.dodgeStyle === 'dive') { s.slide = null; s.stance = Stance.STAND; return this.#startEvade(wishMag); }
      if (s.slide.t >= cfg.minDuration && (newSp < cfg.exitSpeed * this.mods.speedMul || s.slide.t >= cfg.maxDuration)) {
        // Exit: stay crouched if crouch is held, otherwise rise out of the slide.
        s.slide = null;
        s.stance = Stance.CROUCH;
        this.body.setHeight(t.heights.crouch);
        this.#setMode(MoveState.GROUND);
        if (!b.crouch?.down) this.#requestStance(Stance.STAND);
        bus.emit('move:slideEnd', { id: this.id, kind });
      }
    } else {
      // Belly slide: ends prone. Sprint or jump while slowing gets you straight up (fast get-up).
      const getUp = (b.sprint?.pressed || b.jump?.pressed) && newSp < 3.5;
      if (newSp < cfg.exitSpeed || getUp) {
        s.slide = null;
        s.stance = Stance.PRONE;
        this.body.setHeight(t.heights.prone);
        this.#setMode(MoveState.GROUND);
        bus.emit('move:slideEnd', { id: this.id, kind });
        if (getUp) this.#requestStance(Stance.STAND);
      }
    }
  }

  // ---------------------------------------------------------------- air, hop, landing
  #hop() {
    const s = this.state;
    if (s.stance !== Stance.STAND) { s.stance = Stance.STAND; s.stanceT = null; this.body.setHeight(this.t.heights.stand); }
    s.velocity.y = this.t.jump.velocity * (this.mods.jumpMul ?? 1);
    s.grounded = false; s.timeSinceGrounded = 99;
    this.#setMode(MoveState.AIR);
    bus.emit('move:jump', { id: this.id });
  }

  #air(cmd, dt, wishMag) {
    const s = this.state, t = this.t, b = cmd.buttons;
    // Grab a ledge in front while holding climb (Battlefront genre; HD2 climbs from the ground).
    if (b.jump?.down && s.velocity.y < 2 && this.#tryMantle(wishMag, true)) return;
    if (t.wallRun.enabled && this.#tryWallRun(cmd)) return;
    // Directional influence that respects momentum: steer, but never accelerate past your speed.
    if (wishMag > 0) {
      const cap = Math.max(this.#hspeed(), t.speeds.jog * this.mods.speedMul);
      s.velocity.x += _wish.x * t.accel.air * dt; s.velocity.z += _wish.z * t.accel.air * dt;
      const h = this.#hspeed();
      if (h > cap) { s.velocity.x *= cap / h; s.velocity.z *= cap / h; }
    }
    s.velocity.y -= t.gravity * dt;
    s.bodyYaw = turnToward(s.bodyYaw, s.sprinting ? s.bodyYaw : s.yaw, t.turnRates.air * DEG * dt);
  }

  #updateGrounded(res, dt) {
    const s = this.state;
    const wasGrounded = s.grounded;
    const impact = -s.velocity.y;
    // Moving away from the surface (a hop, a launch), not just up a slope, is what leaves the ground.
    s.grounded = res.grounded && s.velocity.dot(res.groundNormal) <= 0.05;
    if (s.grounded) {
      s.groundNormal.copy(res.groundNormal);
      s.timeSinceGrounded = 0;
      s.wallRunsLeft = this.t.wallRun.perAirtime;
      if (!wasGrounded) this.#onLand(impact);
      if (s.velocity.y < 0) s.velocity.y = 0;
    } else {
      s.timeSinceGrounded += dt;
      if (s.mode === MoveState.GROUND || s.mode === MoveState.LAND) this.#setMode(MoveState.AIR);
      else if (s.mode === MoveState.SLIDE && s.timeSinceGrounded > 0.08) {
        // Off a ledge mid-slide: feet slides become a fall, belly slides become a dive.
        if (s.slide.kind === 'belly') { s.dive = { dirYaw: s.slide.dirYaw ?? s.bodyYaw, t: this.t.dive.iframeEnd, kind: s.slide.from ?? 'forward' }; s.slide = null; this.#setMode(MoveState.DIVE); }
        else { s.slide = null; s.stance = Stance.STAND; this.body.setHeight(this.t.heights.stand); this.#setMode(MoveState.AIR); }
      }
    }
  }

  #onLand(impact) {
    const s = this.state, L = this.t.landing;
    switch (s.mode) {
      case MoveState.DIVE:
        this.#setInvulnerable(false);
        const dv = s.dive;
        s.stance = Stance.PRONE; s.dive = null; s.lastDiveLand = s.time;
        s.supine = dv.kind === 'back';
        bus.emit('move:diveLand', { id: this.id, impact, speed: this.#hspeed(), kind: dv.kind });
        this.#startSlide('belly', this.t.dive.landSpeedKeep);
        s.slide.from = dv.kind; s.slide.dirYaw = dv.dirYaw;
        return;
      case MoveState.KNOCKDOWN:
        if (impact >= L.knockdownAt) this.hooks.fallDamage?.((impact - L.knockdownAt) * L.fallDamagePerMs);
        s.knock.phase = 'ground'; s.knock.rest = 0;
        bus.emit('move:knockLand', { id: this.id, impact });
        return;
      case MoveState.SLIDE:
      case MoveState.DODGE:
      case MoveState.MANTLE:
        return;
      default:
        if (impact >= L.knockdownAt) {
          this.hooks.fallDamage?.((impact - L.knockdownAt) * L.fallDamagePerMs);
          s.knock = { phase: 'ground', t: 0, rest: 0, supine: false };
          s.sprinting = false;
          this.body.setHeight(this.t.heights.prone);
          this.#setMode(MoveState.KNOCKDOWN);
          s.knockStarted = true;
          bus.emit('move:knockdown', { id: this.id, cause: 'fall', impulse: impact });
          bus.emit('move:land', { id: this.id, impact, heavy: true, knockdown: true });
        } else if (impact >= L.heavyAt) {
          s.sprinting = false;
          this.#setMode(MoveState.LAND);
          bus.emit('move:land', { id: this.id, impact, heavy: true });
        } else {
          if (s.mode !== MoveState.GROUND) this.#setMode(MoveState.GROUND);
          if (impact > 1) bus.emit('move:land', { id: this.id, impact, heavy: false });
        }
    }
  }

  // ---------------------------------------------------------------- knockdown (ragdoll-lite)
  #knockdown(cmd, dt) {
    const s = this.state, k = s.knock, cfg = this.t.knockdown;
    k.t += dt;
    if (k.phase !== 'air' && !s.grounded && s.timeSinceGrounded > 0.1) k.phase = 'air'; // shoved off a ledge while down
    if (k.phase === 'air') {
      s.velocity.y -= this.t.gravity * dt;
    } else if (k.phase === 'ground') {
      const sp = this.#hspeed();
      const ns = Math.max(0, sp - cfg.groundFriction * dt);
      if (sp > 1e-4) { s.velocity.x *= ns / sp; s.velocity.z *= ns / sp; }
      s.velocity.y -= 2 * dt;
      if (ns < 0.3) {
        k.rest += dt;
        if (k.rest >= cfg.restTime) { k.phase = 'getup'; k.t = 0; bus.emit('move:getup', { id: this.id, duration: cfg.getUpTime }); }
      }
    } else {
      s.velocity.x = 0; s.velocity.z = 0; s.velocity.y -= 2 * dt;
      if (k.t >= cfg.getUpTime) {
        s.knock = null;
        s.supine = false;
        s.stance = Stance.STAND;
        this.body.setHeight(this.t.heights.stand);
        this.#setMode(MoveState.GROUND);
        bus.emit('move:getupDone', { id: this.id });
      }
    }
  }

  // ---------------------------------------------------------------- ragdoll
  /** The root rides the body: under the pelvis, at the lowest point of the body. */
  #ragdollTick(dt) {
    const s = this.state, rd = this.ragdoll;
    rd.step(dt, this.body);
    rd.get(J.PELVIS, _tmp);
    s.position.set(_tmp.x, rd.lowest(), _tmp.z);
    this.body.teleport(s.position);
    rd.velocity(J.PELVIS, s.velocity, dt);
    s.grounded = rd.grounded;
    s.timeSinceGrounded = rd.grounded ? 0 : s.timeSinceGrounded + dt;
    s.bodyYaw = rd.headYaw();
    if (rd.asleep) this.#ragdollRest();
  }

  /** Came to rest: a corpse stays limp; the downed start crawling; the living get up (HD2). */
  #ragdollRest() {
    const s = this.state, rd = this.ragdoll, vital = this.hooks.vital?.() ?? 'alive';
    const up = rd.faceUp();
    s.supine = up;
    s.bodyYaw = rd.headYaw() + (up ? Math.PI : 0);   // supine bodies lie head-behind (the rig's convention)
    s.velocity.set(0, 0, 0);
    if (vital === 'dead') return;
    s.stance = Stance.PRONE;
    this.body.setHeight(this.t.heights.prone);
    if (vital === 'downed') {
      s.downed = true;
      this.#setMode(MoveState.GROUND);
      bus.emit('move:ragdollRest', { id: this.id, downed: true, supine: up });
      return;
    }
    s.knock = { phase: 'getup', t: 0, rest: 0, supine: up };
    this.#setMode(MoveState.KNOCKDOWN);
    bus.emit('move:ragdollRest', { id: this.id, downed: false, supine: up });
    bus.emit('move:getup', { id: this.id, duration: this.t.knockdown.getUpTime });
  }

  // ---------------------------------------------------------------- mantle / vault
  #tryMantle(wishMag, explicit) {
    const ledge = this.#findLedge(wishMag, explicit, this.t.mantle.probeDistance);
    if (!ledge) return false;
    this.#startMantle(ledge);
    return true;
  }

  /** Knee probe plus top-down probes find a vaultable or climbable ledge (no side effects). */
  #findLedge(wishMag, explicit, probeDistance) {
    const s = this.state, m = this.t.mantle;
    const fwd = wishMag > 0.2 ? new Vector3().copy(_wish) : forwardOf(s.yaw, new Vector3());
    const base = s.position;
    const knee = this.body.probe(_tmp.set(base.x, base.y + 0.5, base.z), fwd, probeDistance);
    if (!knee) return null;
    // Probe the top just past the face (8 cm), so thin walls and railings are found too.
    const over = new Vector3(base.x + fwd.x * (knee.distance + 0.08), base.y + m.climbMaxHeight + 0.2, base.z + fwd.z * (knee.distance + 0.08));
    const top = this.body.probe(over, new Vector3(0, -1, 0), m.climbMaxHeight + 0.2);
    if (!top || top.normal.y < 0.7) return null;
    const height = top.point.y - base.y;
    if (height < this.t.stepHeight) return null;
    // Thin obstacle (no raised surface 0.8 m past the edge) = vault over it; otherwise climb on top.
    const behindTop = new Vector3(top.point.x + fwd.x * 0.8, base.y + m.climbMaxHeight + 0.2, top.point.z + fwd.z * 0.8);
    const behindHit = this.body.probe(behindTop, new Vector3(0, -1, 0), m.climbMaxHeight + 0.2);
    const thin = !behindHit || behindHit.point.y < base.y + 0.3;
    const kind = height <= m.vaultMaxHeight && thin ? 'vault' : height <= m.climbMaxHeight && explicit ? 'climb' : null;
    if (!kind) return null;
    // Vaults carry you as far as your momentum would (never less than clearing the obstacle).
    const travel = Math.max(knee.distance + 0.08 + 0.7, this.#hspeed() * m.vaultDuration * m.vaultMomentumKeep);
    const to = kind === 'vault'
      ? new Vector3(base.x + fwd.x * travel, base.y, base.z + fwd.z * travel)
      : new Vector3(top.point.x + fwd.x * 0.35, top.point.y, top.point.z + fwd.z * 0.35);
    const keep = Math.max(this.#hspeed() * m.vaultMomentumKeep, m.vaultMinExitSpeed);
    return {
      kind, from: base.clone(), to, height, edge: top.point.clone(),
      duration: kind === 'vault' ? m.vaultDuration : m.climbDuration,
      exitVelocity: new Vector3(fwd.x * keep, 0, fwd.z * keep),
    };
  }

  #startMantle(ledge) {
    const s = this.state;
    s.mantle = ledge;
    s.bodyYaw = yawOf(ledge.exitVelocity.x, ledge.exitVelocity.z);
    s.sprinting = false; s.stanceT = null; s.crouchPress = null;
    if (s.stance !== Stance.STAND) { s.stance = Stance.STAND; this.body.setHeight(this.t.heights.stand); }
    this.#setMode(MoveState.MANTLE);
    bus.emit('move:mantle', { id: this.id, kind: ledge.kind, height: ledge.height, duration: ledge.duration });
  }

  #mantle(dt) {
    const s = this.state, m = s.mantle;
    // Climb: rise (hands on the ledge), then push over. Vault: forward motion never stops
    // (momentum carries through) with a hop arc over the obstacle.
    const u = Math.min(1, s.modeTime / m.duration);
    const up = Math.min(1, u / 0.6);
    const fwd = m.kind === 'vault' ? u : Math.max(0, (u - 0.3) / 0.7);
    const ease = m.kind === 'vault' ? (x) => x : (x) => 1 - (1 - x) * (1 - x);
    const lift = m.kind === 'vault' ? Math.sin(Math.PI * Math.min(1, u * 1.15)) * (m.height + 0.1) : 0;
    s.position.set(
      m.from.x + (m.to.x - m.from.x) * ease(fwd),
      m.kind === 'vault' ? m.from.y + lift : m.from.y + (m.to.y - m.from.y) * ease(up),
      m.from.z + (m.to.z - m.from.z) * ease(fwd),
    );
    this.body.teleport?.(s.position);
    if (u >= 1) {
      s.velocity.copy(m.kind === 'vault' ? m.exitVelocity : _tmp.set(0, 0, 0));
      s.mantle = null;
      this.#setMode(MoveState.GROUND);
      s.grounded = true;
      bus.emit('move:mantleEnd', { id: this.id, kind: m.kind });
    }
  }

  // ---------------------------------------------------------------- wall run (disabled by default: HD2 has none)
  #tryWallRun(cmd) {
    const s = this.state, w = this.t.wallRun;
    if (!this.mods.canWallRun || s.wallRunsLeft <= 0) return false;
    if (this.#hspeed() < w.minSpeed || cmd.moveY <= 0.5 || !cmd.buttons.sprint?.down) return false;
    forwardOf(s.bodyYaw, _fwd);
    _right.set(-_fwd.z, 0, _fwd.x);
    for (const side of [_right, _tmp.copy(_right).negate()]) {
      const hit = this.body.probe(_delta.set(s.position.x, s.position.y + 1, s.position.z), side, 0.7);
      if (hit && Math.abs(hit.normal.y) < 0.2) {
        s.wallNormal.copy(hit.normal);
        const along = new Vector3().crossVectors(UP, hit.normal);
        if (along.dot(s.velocity) < 0) along.negate();
        const sp = this.#hspeed();
        s.velocity.set(along.x * sp, Math.max(s.velocity.y, 1.5), along.z * sp);
        s.wallRunsLeft--;
        this.#setMode(MoveState.WALLRUN);
        bus.emit('move:wallRun', { id: this.id });
        return true;
      }
    }
    return false;
  }

  #wallRun(cmd, dt) {
    const s = this.state, w = this.t.wallRun;
    s.velocity.y -= this.t.gravity * w.gravityMul * dt;
    const stillWall = this.body.probe(_delta.set(s.position.x, s.position.y + 1, s.position.z), _tmp.copy(s.wallNormal).negate(), 0.8);
    if (cmd.buttons.jump?.pressed) {
      s.velocity.addScaledVector(s.wallNormal, w.jumpOffForce * 0.8);
      s.velocity.y = this.t.jump.velocity * 0.9;
      bus.emit('move:wallJump', { id: this.id });
      return this.#setMode(MoveState.AIR);
    }
    if (!stillWall || s.modeTime > w.maxDuration || this.#hspeed() < w.minSpeed * 0.7 || cmd.moveY <= 0) this.#setMode(MoveState.AIR);
  }

  // ---------------------------------------------------------------- bookkeeping
  #post(dt, prevVx, prevVz, prevBodyYaw) {
    const s = this.state, t = this.t;
    s.speed = this.#hspeed();
    if (dt > 0) {
      // Smoothed horizontal acceleration and body turn rate feed animation lean and bank.
      const ax = (s.velocity.x - prevVx) / dt, az = (s.velocity.z - prevVz) / dt;
      const k = 1 - Math.exp(-dt * 12);
      s.accel.x += (ax - s.accel.x) * k; s.accel.z += (az - s.accel.z) * k;
      s.bodyTurnRate += (angleDelta(prevBodyYaw, s.bodyYaw) / dt - s.bodyTurnRate) * k;
    }
    s.gait = s.speed < 0.3 ? Gait.IDLE : s.sprinting && s.speed > t.speeds.jog * 0.9 ? Gait.SPRINT : s.speed < (t.speeds.walk + t.speeds.jog) * 0.5 ? Gait.WALK : Gait.JOG;
    // Weapon aim: prone (and belly slides) clamp the gun to an arc around the body (HD2's slow prone turning).
    const prone = (s.mode === MoveState.GROUND && s.stance === Stance.PRONE) || (s.mode === MoveState.SLIDE && s.slide?.kind === 'belly');
    const arc = t.stance.proneAimArc * DEG;
    s.aimYaw = prone ? s.bodyYaw + clamp(angleDelta(s.bodyYaw, s.yaw), -arc, arc) : s.yaw;
    const proneTransition = s.stanceT && (s.stanceT.from === Stance.PRONE || s.stanceT.to === Stance.PRONE);
    const limp = s.mode === MoveState.RAGDOLL || s.mode === MoveState.KNOCKDOWN;
    s.weaponReady = !(limp || s.mode === MoveState.MANTLE || s.mode === MoveState.VEHICLE || proneTransition || s.sprinting || s.downed);
    s.busy = limp || s.mode === MoveState.MANTLE || s.mode === MoveState.DIVE || s.mode === MoveState.VEHICLE || !!proneTransition || s.downed;
    const low = s.stamina < t.stamina.lowAt;
    if (low !== s.lowStamina) { s.lowStamina = low; bus.emit('move:lowStamina', { id: this.id, on: low }); }
  }

  #updateStamina(dt) {
    const s = this.state, st = this.t.stamina;
    if (s.sprinting) {
      s.stamina = Math.max(0, s.stamina - this.t.sprint.drainPerSec * this.mods.staminaMul * dt);
      s.staminaRegenTimer = st.regenDelay;
      if (s.stamina <= 0 && !s.exhausted) { s.exhausted = true; bus.emit('move:exhausted', { id: this.id, on: true }); }
    } else if (s.staminaRegenTimer > 0) {
      s.staminaRegenTimer -= dt;
    } else {
      s.stamina = Math.min(st.max, s.stamina + st.regenPerSec * this.staminaRegenMul * dt);
    }
    if (s.exhausted && s.stamina >= this.t.sprint.minStaminaToStart) { s.exhausted = false; bus.emit('move:exhausted', { id: this.id, on: false }); }
  }

  #setInvulnerable(on) {
    const s = this.state;
    if (on === s.invulnerable) return;
    s.invulnerable = on;
    bus.emit('move:iframes', { id: this.id, on });
  }

  #hspeed() { return Math.hypot(this.state.velocity.x, this.state.velocity.z); }

  #setMode(mode) {
    const s = this.state;
    s.mode = mode;
    s.modeTime = 0;
  }

  // ---------------------------------------------------------------- netcode
  /** Compact snapshot for reconciliation (only what affects future simulation). */
  serialize() {
    const s = this.state;
    const v3 = (v) => (v ? v.toArray() : null);
    return {
      mode: s.mode, stance: s.stance, modeTime: s.modeTime, time: s.time,
      p: s.position.toArray(), v: s.velocity.toArray(), bodyYaw: s.bodyYaw,
      stamina: s.stamina, regen: s.staminaRegenTimer, exhausted: s.exhausted,
      tsg: s.timeSinceGrounded, grounded: s.grounded, wr: s.wallRunsLeft,
      stanceT: s.stanceT && { ...s.stanceT }, stanceQueued: s.stanceQueued, crouchPress: s.crouchPress && { ...s.crouchPress },
      slide: s.slide && { ...s.slide }, dive: s.dive && { ...s.dive }, knock: s.knock && { ...s.knock },
      dodgeDir: s.dodgeDir.toArray(), dodgeStyle: s.dodgeStyle, lastDiveLand: s.lastDiveLand, supine: s.supine,
      mantle: s.mantle && { ...s.mantle, from: v3(s.mantle.from), to: v3(s.mantle.to), edge: v3(s.mantle.edge), exitVelocity: v3(s.mantle.exitVelocity) },
      invulnerable: s.invulnerable, sprinting: s.sprinting, downed: s.downed,
      rag: s.mode === MoveState.RAGDOLL ? this.ragdoll.serialize() : null,
    };
  }

  restore(snap) {
    const s = this.state;
    const v3 = (a) => (a ? new Vector3().fromArray(a) : null);
    Object.assign(s, {
      mode: snap.mode, stance: snap.stance, modeTime: snap.modeTime, time: snap.time, bodyYaw: snap.bodyYaw,
      stamina: snap.stamina, staminaRegenTimer: snap.regen, exhausted: snap.exhausted,
      timeSinceGrounded: snap.tsg, grounded: snap.grounded, wallRunsLeft: snap.wr,
      stanceT: snap.stanceT && { ...snap.stanceT }, stanceQueued: snap.stanceQueued, crouchPress: snap.crouchPress && { ...snap.crouchPress },
      slide: snap.slide && { ...snap.slide }, dive: snap.dive && { ...snap.dive }, knock: snap.knock && { ...snap.knock },
      dodgeStyle: snap.dodgeStyle, lastDiveLand: snap.lastDiveLand, invulnerable: snap.invulnerable, sprinting: snap.sprinting, supine: !!snap.supine, downed: !!snap.downed,
      mantle: snap.mantle && { ...snap.mantle, from: v3(snap.mantle.from), to: v3(snap.mantle.to), edge: v3(snap.mantle.edge), exitVelocity: v3(snap.mantle.exitVelocity) },
    });
    s.position.fromArray(snap.p); s.velocity.fromArray(snap.v); s.dodgeDir.fromArray(snap.dodgeDir);
    const h = this.t.heights;
    if (snap.rag) (this.ragdoll ??= new Ragdoll(this.t.ragdoll)).restore(snap.rag);
    this.body.setHeight(s.mode === MoveState.DIVE ? h.dive : s.mode === MoveState.SLIDE ? (s.slide?.kind === 'feet' ? h.slide : h.prone) : s.mode === MoveState.KNOCKDOWN || s.mode === MoveState.RAGDOLL ? h.prone : h[s.stance]);
    this.body.teleport?.(s.position);
  }
}

// ------------------------------------------------------------------ physics adapters

/** Rapier adapter using KinematicCharacterController (autostep, slopes, snap-to-ground). */
export class RapierBody {
  constructor(RAPIER, world, position, { radius = 0.35, height = 1.8, stepHeight = 0.35, maxSlopeDeg = 48 } = {}) {
    this.R = RAPIER; this.world = world; this.radius = radius;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x, position.y, position.z));
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(height / 2 - radius, radius).setTranslation(0, height / 2, 0), this.body);
    this.ctl = world.createCharacterController(0.02);
    this.ctl.enableAutostep(stepHeight, 0.2, true);
    this.ctl.enableSnapToGround(0.3);
    this.ctl.setMaxSlopeClimbAngle((maxSlopeDeg * Math.PI) / 180);
    this.ctl.setMinSlopeSlideAngle(((maxSlopeDeg + 5) * Math.PI) / 180);
    this._out = { delta: new Vector3(), grounded: false, groundNormal: new Vector3(0, 1, 0) };
  }
  move(desired) {
    this.ctl.computeColliderMovement(this.collider, desired);
    const m = this.ctl.computedMovement();
    const p = this.body.translation();
    this.body.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z });
    this._out.delta.set(m.x, m.y, m.z);
    this._out.grounded = this.ctl.computedGrounded();
    const hit = this.probe(_tmp.set(p.x, p.y + 0.1, p.z), new Vector3(0, -1, 0), 0.4);
    this._out.groundNormal.copy(hit ? hit.normal : UP);
    return this._out;
  }
  setHeight(h) {
    this.world.removeCollider(this.collider, false);
    const half = Math.max(0.01, h / 2 - this.radius);
    this.collider = this.world.createCollider(this.R.ColliderDesc.capsule(half, this.radius).setTranslation(0, h / 2, 0), this.body);
  }
  teleport(p) { this.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true); }
  /** Ground height for ragdoll particles (a ray down from above; Rapier colliders aren't boxes to hand out). */
  groundAt(x, z) { const hit = this.probe(_tmp.set(x, this.body.translation().y + 50, z), DOWN, 200); return hit ? hit.point.y : -Infinity; }
  nearBoxes() { return NO_BOXES; }
  probe(origin, dir, dist) {
    const ray = new this.R.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(ray, dist, true, undefined, undefined, this.collider);
    if (!hit) return null;
    const point = new Vector3(origin.x + dir.x * hit.timeOfImpact, origin.y + dir.y * hit.timeOfImpact, origin.z + dir.z * hit.timeOfImpact);
    return { hit: true, distance: hit.timeOfImpact, point, normal: new Vector3(hit.normal.x, hit.normal.y, hit.normal.z) };
  }
}

/**
 * Zero-dependency body: ground (flat y = 0, or a terrain with height(x, z) and normal(x, z, out))
 * plus axis-aligned cover boxes. Resolves each axis separately, so you slide along walls instead
 * of sticking. Steps up anything at or below `stepHeight` and lands on box tops.
 * `boxes` can be a plain array or a CoverIndex (anything with queryAABB(minX, minZ, maxX, maxZ, cb)).
 */
export class FlatGroundBody {
  constructor(position, boxes = [], { terrain = null, radius = 0.35, stepHeight = 0.35 } = {}) {
    this.p = position.clone();
    this.boxes = boxes;
    this.terrain = terrain;
    this.r = radius;
    this.step = stepHeight;
    this.h = 1.8;
    this._out = { delta: new Vector3(), grounded: false, groundNormal: new Vector3(0, 1, 0) };
    this._near = [];
  }

  #gather(x0, z0, x1, z1) {
    const out = this._near; out.length = 0;
    const r = this.r;
    if (Array.isArray(this.boxes)) {
      for (const b of this.boxes) if (b.max.x > Math.min(x0, x1) - r && b.min.x < Math.max(x0, x1) + r && b.max.z > Math.min(z0, z1) - r && b.min.z < Math.max(z0, z1) + r) out.push(b);
    } else if (this.boxes?.queryAABB) {
      this.boxes.queryAABB(Math.min(x0, x1) - r, Math.min(z0, z1) - r, Math.max(x0, x1) + r, Math.max(z0, z1) + r, (b) => out.push(b));
    }
    return out;
  }

  groundAt(x, z) { return this.terrain ? this.terrain.height(x, z) : 0; }
  /** Cover boxes overlapping a ground rectangle, for ragdoll collision (a reused array: don't keep it). */
  nearBoxes(x0, z0, x1, z1) { return this.#gather(x0, z0, x1, z1); }

  #blocking(x, z, y, near) {
    const r = this.r;
    for (const b of near) {
      if (x <= b.min.x - r || x >= b.max.x + r || z <= b.min.z - r || z >= b.max.z + r) continue;
      if (y >= b.max.y - 0.02 || y + this.h <= b.min.y) continue;
      return b;
    }
    return null;
  }

  /** @param {boolean} snapGround keep contact within step height (walking over crests and down steps) */
  move(d, snapGround = false) {
    const p = this.p, near = this.#gather(p.x, p.z, p.x + d.x, p.z + d.z);
    let x = p.x, z = p.z, y = p.y + d.y;
    // Horizontal, one axis at a time (slide along walls), stepping up low edges.
    for (const axis of ['x', 'z']) {
      const nx = axis === 'x' ? x + d.x : x, nz = axis === 'z' ? z + d.z : z;
      const hit = this.#blocking(nx, nz, Math.max(y, p.y), near);
      if (!hit) { x = nx; z = nz; continue; }
      if (hit.max.y - Math.max(y, p.y) <= this.step && !this.#blocking(nx, nz, hit.max.y + 0.01, near)) { x = nx; z = nz; y = Math.max(y, hit.max.y); }
    }
    // Vertical: terrain or box tops under us.
    let floor = this.groundAt(x, z);
    const r = this.r * 0.7;
    for (const b of near) {
      if (x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r && b.max.y <= Math.max(p.y, y) + 0.05) floor = Math.max(floor, b.max.y);
    }
    // Ceiling: rising into the underside of a box stops the rise.
    if (d.y > 0) for (const b of near) {
      if (x > b.min.x - this.r && x < b.max.x + this.r && z > b.min.z - this.r && z < b.max.z + this.r && p.y + this.h <= b.min.y && y + this.h > b.min.y) y = b.min.y - this.h;
    }
    let grounded = false;
    // Snap to the ground within step height while walking (not jumping): keeps soldiers glued over
    // hill crests and down steps instead of skipping into the air. Ledges higher than a step fall.
    const snap = snapGround ? this.step : 0.06;
    if (y <= floor || ((d.y <= 0 || snapGround) && y - floor < snap)) { y = floor; grounded = true; }
    const out = this._out;
    out.delta.set(x - p.x, y - p.y, z - p.z);
    out.grounded = grounded;
    if (grounded && this.terrain && floor === this.groundAt(x, z)) this.terrain.normal(x, z, out.groundNormal);
    else out.groundNormal.set(0, 1, 0);
    p.set(x, y, z);
    return out;
  }

  setHeight(h) { this.h = h; }
  teleport(p) { this.p.copy(p); }

  probe(o, dir, dist) {
    let best = null;
    const near = this.#gather(o.x, o.z, o.x + dir.x * dist, o.z + dir.z * dist);
    for (const bx of near) {
      const t = rayBox(o, dir, bx, dist);
      if (t !== null && (!best || t.distance < best.distance)) best = t;
    }
    // Ground: flat plane, or the terrain marched in small steps.
    if (dir.y < 0) {
      if (!this.terrain) {
        if (o.y > 0) { const t = o.y / -dir.y; if (t <= dist && (!best || t < best.distance)) best = { hit: true, distance: t, point: new Vector3(o.x + dir.x * t, 0, o.z + dir.z * t), normal: UP.clone() }; }
      } else {
        const hit = this.terrain.raycast?.(o, dir, best ? best.distance : dist);
        if (hit && (!best || hit.distance < best.distance)) best = hit;
      }
    }
    return best;
  }
}

function rayBox(o, d, b, maxDist) {
  let tmin = 0, tmax = maxDist, axisHit = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    const a = i === 0 ? 'x' : i === 1 ? 'y' : 'z';
    if (Math.abs(d[a]) < 1e-8) { if (o[a] < b.min[a] || o[a] > b.max[a]) return null; continue; }
    let t1 = (b.min[a] - o[a]) / d[a], t2 = (b.max[a] - o[a]) / d[a], s = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; s = 1; }
    if (t1 > tmin) { tmin = t1; axisHit = i; sign = s; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (axisHit < 0) return null;
  const normal = new Vector3(); normal.setComponent(axisHit, sign);
  return { hit: true, distance: tmin, point: new Vector3().copy(o).addScaledVector(d, tmin), normal };
}
