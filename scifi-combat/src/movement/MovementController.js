// MovementController — the locomotion state machine.
//
// Pure simulation: consumes a Command each fixed tick, mutates `this.state`, emits events.
// No rendering, no DOM — the same file runs on the authoritative server and for client
// prediction, and bots drive it with synthetic Commands.
//
// Physics is abstracted behind a `body` adapter (see RapierBody / FlatGroundBody below) with:
//   move(desiredDelta: Vector3) -> { delta: Vector3, grounded: bool, groundNormal: Vector3 }
//   setHeight(h), probe(origin, dir, dist) -> { hit, distance, point, normal } | null
//
// Feel notes are inline; tuning lives in data/movement.json.

import { Vector3 } from 'three';
import { bus } from '../core/EventBus.js';

export const MoveState = Object.freeze({
  GROUND: 'ground', AIR: 'air', SLIDE: 'slide', DODGE: 'dodge',
  MANTLE: 'mantle', WALLRUN: 'wallrun', VEHICLE: 'vehicle',
});
export const Stance = Object.freeze({ STAND: 'stand', CROUCH: 'crouch', PRONE: 'prone' });

// Scratch vectors: zero allocation in the hot path.
const _wish = new Vector3();
const _fwd = new Vector3();
const _right = new Vector3();
const _delta = new Vector3();
const _tmp = new Vector3();
const UP = new Vector3(0, 1, 0);

export class MovementController {
  /**
   * @param {object} tuning  data/movement.json
   * @param {object} body    physics adapter
   * @param {object} mods    class modifiers { speedMul, accelMul, staminaMul, canWallRun, dodgeStyle }
   */
  constructor(tuning, body, mods = {}, entityId = 0) {
    this.t = tuning;
    this.body = body;
    this.id = entityId;
    this.mods = { speedMul: 1, accelMul: 1, staminaMul: 1, canWallRun: true, dodgeStyle: 'roll', ...mods };

    this.state = {
      mode: MoveState.GROUND,
      stance: Stance.STAND,
      position: new Vector3(),
      velocity: new Vector3(),
      yaw: 0,
      grounded: true,
      groundNormal: UP.clone(),
      stamina: tuning.stamina.max,
      staminaRegenTimer: 0,
      timeSinceGrounded: 0,      // coyote time
      timeSinceJumpPressed: 99,  // jump buffer
      jumpHeld: false,
      modeTime: 0,               // seconds in current mode
      dodgeDir: new Vector3(),
      invulnerable: false,
      wallRunsLeft: tuning.wallRun.perAirtime,
      wallNormal: new Vector3(),
      mantle: null,              // { from, to, duration, kind }
      sprinting: false,
      // Locks set by other systems (e.g. melee recovery stops sprint; heavy attack roots you).
      locks: { sprint: 0, move: 0, jump: 0 },
      speedScale: 1,             // e.g. guarding = 0.55, ADS = 0.6
      forced: null,              // { x, z, time } set by abilities (dash, charge)
    };
  }

  // ---------------------------------------------------------------- public API
  /**
   * External impulse (launch pads, knock-ups, explosions). Upward impulses lift you off the ground
   * so ground snapping can't absorb them.
   */
  impulse(x, y, z) {
    const s = this.state;
    s.velocity.x += x; s.velocity.y += y; s.velocity.z += z;
    if (y > 0.5) {
      s.velocity.y = Math.max(s.velocity.y, y);
      s.grounded = false; s.timeSinceGrounded = 99;
      if (s.mode === MoveState.GROUND || s.mode === MoveState.SLIDE) this.#setMode(MoveState.AIR);
    }
  }

  /** Called by VehicleSystem: the body is now carried by a vehicle seat. */
  enterVehicle() {
    const s = this.state;
    if (s.mode === MoveState.SLIDE) this.body.setHeight(this.t.heights[s.stance]);
    s.mode = MoveState.VEHICLE; s.modeTime = 0;
    s.velocity.set(0, 0, 0);
    s.invulnerable = false; s.sprinting = false; s.forced = null;
  }

  /** Hop out at `pos`, carrying some of the vehicle's velocity. Lands in AIR so ejects arc naturally. */
  exitVehicle(pos, vel) {
    const s = this.state;
    s.position.copy(pos);
    this.body.teleport?.(pos);
    s.velocity.copy(vel);
    s.grounded = false; s.timeSinceGrounded = 99;
    s.mode = MoveState.AIR; s.modeTime = 0;
    if (s.stance !== Stance.STAND) { s.stance = Stance.STAND; this.body.setHeight(this.t.heights.stand); }
  }

  canAct() { return this.state.mode !== MoveState.MANTLE && this.state.mode !== MoveState.VEHICLE; }
  isSliding() { return this.state.mode === MoveState.SLIDE; }
  spendStamina(amount) {
    const s = this.state;
    const cost = amount * this.mods.staminaMul;
    if (s.stamina < cost) return false;
    s.stamina -= cost;
    s.staminaRegenTimer = this.t.stamina.regenDelay;
    return true;
  }

  // ---------------------------------------------------------------- tick
  update(cmd, dt) {
    const s = this.state;
    const b = cmd.buttons;
    s.yaw = cmd.yaw;
    s.modeTime += dt;
    for (const k in s.locks) s.locks[k] = Math.max(0, s.locks[k] - dt);

    // Camera-relative basis on the ground plane.
    _fwd.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
    _right.set(-_fwd.z, 0, _fwd.x);
    _wish.copy(_fwd).multiplyScalar(cmd.moveY).addScaledVector(_right, cmd.moveX);
    const wishMag = Math.min(1, _wish.length());
    if (wishMag > 0) _wish.normalize();
    if (s.locks.move > 0) _wish.set(0, 0, 0);

    // Jump buffer: remember press for a short window so early presses still count on landing.
    s.timeSinceJumpPressed = b.jump?.pressed ? 0 : s.timeSinceJumpPressed + dt;
    s.jumpHeld = !!b.jump?.down;

    this.#updateStamina(dt);

    // Forced motion (ability dashes, knock-backs that must not be fought by input accel).
    if (s.forced && s.forced.time > 0) {
      s.forced.time -= dt;
      s.velocity.x = s.forced.x; s.velocity.z = s.forced.z;
      if (!s.grounded) s.velocity.y -= this.t.gravity * dt;
      if (s.forced.time <= 0) { s.forced = null; s.velocity.multiplyScalar(0.35); } // keep a little carry
    } else switch (s.mode) {
      case MoveState.GROUND:  this.#ground(cmd, dt, wishMag); break;
      case MoveState.AIR:     this.#air(cmd, dt, wishMag); break;
      case MoveState.SLIDE:   this.#slide(cmd, dt); break;
      case MoveState.DODGE:   this.#dodge(cmd, dt); break;
      case MoveState.MANTLE:  this.#mantle(dt); return; // root-motion: skips physics move
      case MoveState.WALLRUN: this.#wallRun(cmd, dt); break;
      case MoveState.VEHICLE: return;
    }

    // Integrate via the physics adapter (collide-and-slide, stairs, slopes).
    _delta.copy(s.velocity).multiplyScalar(dt);
    const res = this.body.move(_delta);
    s.position.add(res.delta);
    // Kill velocity into surfaces we hit (prevents "sticky" walls and ceiling bonks).
    if (dt > 0) {
      const realized = _tmp.copy(res.delta).divideScalar(dt);
      if (realized.y < s.velocity.y - 0.01 && s.velocity.y > 0) s.velocity.y = realized.y; // ceiling
    }
    this.#updateGrounded(res, dt);
  }

  // ---------------------------------------------------------------- modes
  #ground(cmd, dt, wishMag) {
    const s = this.state, t = this.t, b = cmd.buttons;

    // Stance: tap crouch toggles crouch, hold 0.4 s goes prone.
    if (b.crouch?.pressed) {
      if (s.sprinting && this.#horizSpeed() >= t.slide.minEntrySpeed) return this.#enterSlide();
      this.#setStance(s.stance === Stance.CROUCH ? Stance.STAND : Stance.CROUCH);
      this._crouchHold = 0;
    }
    if (b.crouch?.down) {
      this._crouchHold = (this._crouchHold ?? 0) + dt;
      if (this._crouchHold > 0.4 && s.stance !== Stance.PRONE) this.#setStance(Stance.PRONE);
    }

    // Sprint: only forward-ish, standing, not locked by combat.
    s.sprinting = !!b.sprint?.down && cmd.moveY > 0.5 && s.locks.sprint <= 0 && s.speedScale >= 1 && this.mods.canSprint !== false;
    if (s.sprinting && s.stance !== Stance.STAND) this.#setStance(Stance.STAND);

    // Dodge
    if (b.dodge?.pressed && s.stance !== Stance.PRONE && this.mods.canDodge !== false && this.spendStamina(t.dodge.staminaCost)) {
      return this.#enterDodge(wishMag > 0 ? _wish : _tmp.copy(_fwd).negate()); // no input = backstep
    }

    // Jump (buffered) — also stands you up.
    if (s.timeSinceJumpPressed <= t.jumpBuffer && s.locks.jump <= 0) {
      if (this.#tryMantle(true)) return;
      return this.#jump();
    }
    // Sprinting into a low wall auto-vaults (Helldivers/TLOU feel: no button mash needed).
    if (s.sprinting && this.#tryMantle(false)) return;

    const target = this.#targetSpeed() * wishMag;
    this.#accelerate(_wish, target, t.groundAccel * this.mods.accelMul, t.groundDecel, dt);

    // Stick to slopes: project velocity onto ground plane so walking down ramps doesn't "hop".
    const n = s.groundNormal;
    const vn = s.velocity.dot(n);
    s.velocity.addScaledVector(n, -vn);
    s.velocity.y -= 2 * dt; // small snap force
  }

  #air(cmd, dt, wishMag) {
    const s = this.state, t = this.t;

    // Coyote time: still allowed to jump shortly after walking off a ledge.
    if (s.timeSinceJumpPressed <= t.jumpBuffer && s.timeSinceGrounded <= t.coyoteTime && s.velocity.y <= 0) {
      return this.#jump();
    }
    // Ledge grab while falling/jumping toward a ledge.
    if (cmd.buttons.jump?.down && this.#tryMantle(true)) return;
    // Wall run.
    if (this.#tryWallRun(cmd)) return;

    // Limited air control: steer, don't reverse.
    const target = Math.max(this.#horizSpeed(), t.walkSpeed) * wishMag;
    this.#accelerate(_wish, target, t.airAccel * t.airControl, 0, dt);

    // Asymmetric gravity: snappy arcs. Release jump early → shorter hop.
    let g = t.gravity;
    if (s.velocity.y < 0) g *= t.fallGravityMul;
    else if (!s.jumpHeld) g *= t.lowJumpGravityMul;
    s.velocity.y -= g * dt;
  }

  #slide(cmd, dt) {
    const s = this.state, sl = this.t.slide;
    // Gravity projected on slope: downhill slides accelerate, uphill bleed out fast.
    const n = s.groundNormal;
    _tmp.set(0, -this.t.gravity * sl.slopeGravity, 0);
    _tmp.addScaledVector(n, -_tmp.dot(n));
    s.velocity.addScaledVector(_tmp, dt);
    // Friction
    const sp = this.#horizSpeed();
    const drop = sl.friction * dt;
    if (sp > 0) {
      const k = Math.max(sp - drop, 0) / sp;
      s.velocity.x *= k; s.velocity.z *= k;
    }
    // Slight steering so slides feel controllable.
    _tmp.copy(_fwd).multiplyScalar(cmd.moveY).addScaledVector(_right, cmd.moveX);
    s.velocity.addScaledVector(_tmp, 3 * dt);

    if (s.timeSinceJumpPressed <= this.t.jumpBuffer) {
      // Slide-jump keeps most momentum: the Helldivers "dive out of trouble" moment.
      s.velocity.x *= sl.jumpCarry; s.velocity.z *= sl.jumpCarry;
      return this.#jump();
    }
    const done = s.modeTime > sl.minDuration &&
      (this.#horizSpeed() < sl.exitSpeed || s.modeTime > sl.maxDuration || !cmd.buttons.crouch?.down && s.modeTime > 0.6);
    if (done) this.#exitSlide(cmd.buttons.crouch?.down ? Stance.CROUCH : Stance.STAND);
    if (!s.grounded) this.#setMode(MoveState.AIR);
  }

  #dodge(cmd, dt) {
    const s = this.state, d = this.t.dodge;
    // Ease-out speed curve: explosive start, controllable end.
    const k = 1 - s.modeTime / d.duration;
    const speed = d.speed * Math.max(0, k * k * 1.4);
    s.velocity.x = s.dodgeDir.x * speed;
    s.velocity.z = s.dodgeDir.z * speed;
    s.velocity.y -= this.t.gravity * dt;

    const iframes = s.modeTime >= d.iframeStart && s.modeTime <= d.iframeEnd;
    if (iframes !== s.invulnerable) { s.invulnerable = iframes; bus.emit('move:iframes', { id: this.id, on: iframes }); }

    // Late in the roll you can cancel into jump/sprint so it never feels like lost control.
    if (s.modeTime >= d.cancelableAfter && (s.timeSinceJumpPressed <= this.t.jumpBuffer)) {
      s.invulnerable = false;
      return this.#jump();
    }
    if (s.modeTime >= d.duration) {
      s.invulnerable = false;
      this.#setMode(s.grounded ? MoveState.GROUND : MoveState.AIR);
    }
  }

  #mantle(dt) {
    const s = this.state, m = s.mantle;
    // Two-phase curve: rise first (up), then push over (forward) — reads as a real climb.
    const u = Math.min(1, s.modeTime / m.duration);
    const up = Math.min(1, u / 0.6);
    const fwd = Math.max(0, (u - 0.35) / 0.65);
    const ease = (x) => 1 - (1 - x) * (1 - x);
    s.position.set(
      m.from.x + (m.to.x - m.from.x) * ease(fwd),
      m.from.y + (m.to.y - m.from.y) * ease(up),
      m.from.z + (m.to.z - m.from.z) * ease(fwd),
    );
    this.body.teleport?.(s.position);
    if (u >= 1) {
      // Vault keeps momentum; climb starts you from a stand.
      s.velocity.copy(m.kind === 'vault' ? m.exitVelocity : _tmp.set(0, 0, 0));
      this.#setMode(MoveState.GROUND);
      bus.emit('move:mantleEnd', { id: this.id, kind: m.kind });
    }
  }

  #wallRun(cmd, dt) {
    const s = this.state, w = this.t.wallRun;
    s.velocity.y -= this.t.gravity * w.gravityMul * dt;
    // Keep pressing into wall; leave if no wall, too slow, or timed out.
    const stillWall = this.body.probe(s.position, _tmp.copy(s.wallNormal).negate(), 0.8);
    if (s.timeSinceJumpPressed <= this.t.jumpBuffer) {
      s.velocity.addScaledVector(s.wallNormal, w.jumpOffForce * 0.8);
      s.velocity.y = this.t.jumpVelocity * 0.9;
      s.timeSinceJumpPressed = 99;
      bus.emit('move:wallJump', { id: this.id });
      return this.#setMode(MoveState.AIR);
    }
    if (!stillWall || s.modeTime > w.maxDuration || this.#horizSpeed() < w.minSpeed * 0.7 || cmd.moveY <= 0) {
      this.#setMode(MoveState.AIR);
    }
  }

  // ---------------------------------------------------------------- transitions
  #jump() {
    const s = this.state;
    if (s.stance !== Stance.STAND) this.#setStance(Stance.STAND);
    s.velocity.y = this.t.jumpVelocity * (this.mods.jumpMul ?? 1);
    s.timeSinceJumpPressed = 99;
    s.timeSinceGrounded = 99; // consume coyote
    s.grounded = false;
    this.#setMode(MoveState.AIR);
    bus.emit('move:jump', { id: this.id });
  }

  #enterSlide() {
    const s = this.state;
    const sp = this.#horizSpeed();
    const boost = this.t.slide.entryBoost;
    s.velocity.x *= boost; s.velocity.z *= boost;
    this.body.setHeight(this.t.heights.slide);
    s.sprinting = false;
    this.#setMode(MoveState.SLIDE);
    bus.emit('move:slide', { id: this.id, speed: sp * boost });
  }

  #exitSlide(stance) {
    this.#setStance(stance);
    this.#setMode(MoveState.GROUND);
  }

  #enterDodge(dir) {
    const s = this.state;
    s.dodgeDir.copy(dir).setY(0).normalize();
    this.#setMode(MoveState.DODGE);
    bus.emit('move:dodge', { id: this.id, dir: s.dodgeDir, style: this.mods.dodgeStyle });
  }

  /** Probe knee/chest/head + top-down to find vaultable/climbable ledge in front. */
  #tryMantle(explicit) {
    const s = this.state, m = this.t.mantle;
    const fwd = _fwd;
    const base = s.position;
    const knee = this.body.probe(_tmp.copy(base).setY(base.y + 0.5), fwd, m.probeDistance);
    if (!knee) return false;
    // Top-down probe from above the max climb height, slightly past the wall face.
    const over = new Vector3().copy(base).addScaledVector(fwd, knee.distance + 0.3);
    over.y = base.y + m.climbMaxHeight + 0.2;
    const top = this.body.probe(over, new Vector3(0, -1, 0), m.climbMaxHeight + 0.2);
    if (!top || top.normal.y < 0.7) return false;
    const height = top.point.y - base.y;
    if (height < this.t.stepHeight) return false;
    const kind = height <= m.vaultMaxHeight ? 'vault' : height <= m.climbMaxHeight && explicit ? 'climb' : null;
    if (!kind) return false;

    // Vault lands you on the far side; climb puts you on top.
    const to = kind === 'vault'
      ? new Vector3().copy(top.point).addScaledVector(fwd, 0.7).setY(base.y)
      : new Vector3().copy(top.point).addScaledVector(fwd, 0.35);
    s.mantle = {
      kind, from: base.clone(), to,
      duration: kind === 'vault' ? m.vaultDuration : m.climbDuration,
      exitVelocity: new Vector3(s.velocity.x, 0, s.velocity.z),
    };
    this.#setMode(MoveState.MANTLE);
    bus.emit('move:mantle', { id: this.id, kind, height });
    return true;
  }

  #tryWallRun(cmd) {
    const s = this.state, w = this.t.wallRun;
    if (!w.enabled || !this.mods.canWallRun || s.wallRunsLeft <= 0) return false;
    if (this.#horizSpeed() < w.minSpeed || cmd.moveY <= 0.5 || !cmd.buttons.sprint?.down) return false;
    for (const side of [_right, _tmp.copy(_right).negate()]) {
      const hit = this.body.probe(s.position, side, 0.7);
      if (hit && Math.abs(hit.normal.y) < 0.2) {
        s.wallNormal.copy(hit.normal);
        // Redirect velocity along the wall.
        const along = new Vector3().crossVectors(UP, hit.normal);
        if (along.dot(s.velocity) < 0) along.negate();
        const sp = this.#horizSpeed();
        s.velocity.set(along.x * sp, Math.max(s.velocity.y, 1.5), along.z * sp);
        s.wallRunsLeft--;
        this.#setMode(MoveState.WALLRUN);
        bus.emit('move:wallRun', { id: this.id });
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- helpers
  #accelerate(dir, targetSpeed, accel, decel, dt) {
    const v = this.state.velocity;
    const desiredX = dir.x * targetSpeed, desiredZ = dir.z * targetSpeed;
    const dx = desiredX - v.x, dz = desiredZ - v.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return;
    // Opposing input → boosted accel (snappy reversals). Releasing input → decel rate.
    let rate = targetSpeed < 0.01 ? decel : accel;
    if (v.x * desiredX + v.z * desiredZ < 0) rate *= this.t.turnAroundBoost;
    const step = Math.min(dist, rate * dt);
    v.x += (dx / dist) * step;
    v.z += (dz / dist) * step;
  }

  #targetSpeed() {
    const s = this.state, t = this.t;
    const base = s.stance === Stance.PRONE ? t.proneSpeed
      : s.stance === Stance.CROUCH ? t.crouchSpeed
      : s.sprinting ? t.sprintSpeed : t.walkSpeed;
    return base * this.mods.speedMul * s.speedScale;
  }

  #horizSpeed() { return Math.hypot(this.state.velocity.x, this.state.velocity.z); }

  #setStance(stance) {
    const s = this.state;
    if (s.stance === stance) return;
    // TODO: ceiling check before standing (probe up) so you can't stand into geometry.
    s.stance = stance;
    this.body.setHeight(this.t.heights[stance]);
    bus.emit('move:stance', { id: this.id, stance });
  }

  #setMode(mode) {
    const s = this.state;
    if (s.mode === MoveState.SLIDE && mode !== MoveState.SLIDE) this.body.setHeight(this.t.heights[s.stance]);
    s.mode = mode;
    s.modeTime = 0;
  }

  #updateGrounded(res, dt) {
    const s = this.state;
    const wasGrounded = s.grounded;
    s.grounded = res.grounded && s.velocity.y <= 0.01;
    if (s.grounded) {
      s.groundNormal.copy(res.groundNormal);
      s.timeSinceGrounded = 0;
      s.wallRunsLeft = this.t.wallRun.perAirtime;
      if (!wasGrounded) {
        bus.emit('move:land', { id: this.id, impact: -s.velocity.y });
        s.velocity.y = 0;
        if (s.mode === MoveState.AIR || s.mode === MoveState.WALLRUN) this.#setMode(MoveState.GROUND);
      }
    } else {
      s.timeSinceGrounded += dt;
      if (s.mode === MoveState.GROUND) this.#setMode(MoveState.AIR);
    }
  }

  #updateStamina(dt) {
    const s = this.state, st = this.t.stamina;
    if (s.staminaRegenTimer > 0) s.staminaRegenTimer -= dt;
    else s.stamina = Math.min(st.max, s.stamina + st.regenPerSec * dt);
  }

  // ---------------------------------------------------------------- netcode
  /** Compact snapshot for reconciliation (only what affects future simulation). */
  serialize() {
    const s = this.state;
    return {
      mode: s.mode, stance: s.stance, modeTime: s.modeTime,
      p: s.position.toArray(), v: s.velocity.toArray(),
      stamina: s.stamina, regen: s.staminaRegenTimer, tsg: s.timeSinceGrounded,
      tjp: s.timeSinceJumpPressed, grounded: s.grounded, wr: s.wallRunsLeft,
      dodgeDir: s.dodgeDir.toArray(), mantle: s.mantle,
    };
  }

  restore(snap) {
    const s = this.state;
    Object.assign(s, {
      mode: snap.mode, stance: snap.stance, modeTime: snap.modeTime, stamina: snap.stamina,
      staminaRegenTimer: snap.regen, timeSinceGrounded: snap.tsg, timeSinceJumpPressed: snap.tjp,
      grounded: snap.grounded, wallRunsLeft: snap.wr, mantle: snap.mantle,
    });
    s.position.fromArray(snap.p); s.velocity.fromArray(snap.v); s.dodgeDir.fromArray(snap.dodgeDir);
    this.body.teleport?.(s.position);
  }
}

// ------------------------------------------------------------------ physics adapters

/** Rapier adapter using KinematicCharacterController (autostep, slopes, snap-to-ground). */
export class RapierBody {
  constructor(RAPIER, world, position, { radius = 0.35, height = 1.8, stepHeight = 0.35, maxSlopeDeg = 50 } = {}) {
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
    // Ground normal from a short downward ray.
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
  probe(origin, dir, dist) {
    const ray = new this.R.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(ray, dist, true, undefined, undefined, this.collider);
    if (!hit) return null;
    const point = new Vector3(origin.x + dir.x * hit.timeOfImpact, origin.y + dir.y * hit.timeOfImpact, origin.z + dir.z * hit.timeOfImpact);
    return { hit: true, distance: hit.timeOfImpact, point, normal: new Vector3(hit.normal.x, hit.normal.y, hit.normal.z) };
  }
}

/** Zero-dependency fallback: infinite flat ground at y=0 plus axis-aligned boxes. Great for graybox tests. */
export class FlatGroundBody {
  constructor(position, boxes = []) { this.p = position.clone(); this.boxes = boxes; this.h = 1.8; }
  move(d) {
    const next = _tmp.copy(this.p).add(d);
    let grounded = false;
    if (next.y <= 0) { next.y = 0; grounded = true; }
    for (const bx of this.boxes) {
      // Resolve horizontal penetration against box (radius 0.35); land on top if above.
      const inX = next.x > bx.min.x - 0.35 && next.x < bx.max.x + 0.35;
      const inZ = next.z > bx.min.z - 0.35 && next.z < bx.max.z + 0.35;
      if (!inX || !inZ) continue;
      if (this.p.y >= bx.max.y - 0.05 && next.y <= bx.max.y) { next.y = bx.max.y; grounded = true; continue; }
      if (next.y < bx.max.y && next.y + this.h > bx.min.y) { next.x = this.p.x; next.z = this.p.z; }
    }
    const delta = new Vector3().subVectors(next, this.p);
    this.p.copy(next);
    return { delta, grounded, groundNormal: UP };
  }
  setHeight(h) { this.h = h; }
  teleport(p) { this.p.copy(p); }
  probe(o, dir, dist) {
    let best = null;
    for (const bx of this.boxes) {
      const t = rayBox(o, dir, bx, dist);
      if (t !== null && (!best || t.distance < best.distance)) best = t;
    }
    if (dir.y < 0 && o.y > 0) {
      const t = o.y / -dir.y;
      if (t <= dist && (!best || t < best.distance)) best = { hit: true, distance: t, point: new Vector3(o.x + dir.x * t, 0, o.z + dir.z * t), normal: UP.clone() };
    }
    return best;
  }
}

function rayBox(o, d, b, maxDist) {
  let tmin = 0, tmax = maxDist, axisHit = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    const a = ['x', 'y', 'z'][i];
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
