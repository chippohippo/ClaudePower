// MeleeSystem — flame-sword attack/guard state machine + hit resolution.
//
// One MeleeComponent per combatant. Each sim tick:
//   1. component.update(cmd, dt)          → advances own FSM (attacks, guard, heat, stagger)
//   2. MeleeSystem.resolve(components)     → for every attacker in ACTIVE phase, sweep targets
//      and call defender.receiveHit(), which decides parry / perfect block / block / hit.
//
// Everything is time-based and data-driven (data/weapons/melee.json). Presentation listens
// to `melee:*` events for hit-stop, VFX (flame burst), audio, camera kick, HUD indicators.

import { Vector3 } from 'three';
import { bus } from '../../core/EventBus.js';

export const MeleePhase = Object.freeze({
  IDLE: 'idle', WINDUP: 'windup', ACTIVE: 'active', RECOVERY: 'recovery',
  GUARD: 'guard', PARRY_WHIFF: 'parryWhiff', STAGGER: 'stagger', GUARD_BROKEN: 'guardBroken',
  CHARGING: 'charging',
});

export const HitResult = Object.freeze({
  PARRIED: 'parried', PERFECT_BLOCK: 'perfectBlock', BLOCKED: 'blocked', HIT: 'hit',
  IFRAME: 'iframe', GUARD_BREAK: 'guardBreak',
});

const _toTarget = new Vector3();

export class MeleeComponent {
  /**
   * @param {object} weapon   entry from melee.json
   * @param {object} owner    { id, movement: MovementController, health: HealthComponent, team }
   */
  constructor(weapon, owner, world = null) {
    this.w = weapon;
    this.owner = owner;
    this.world = world;            // needed for projectile attacks (flame waves, thrown daggers)
    this.projectileAmmo = new Map(); // attackId -> remaining throws (Spectral Daggers)
    this.phase = MeleePhase.IDLE;
    this.phaseTime = 0;
    this.attackId = null;          // current attack key
    this.attack = null;            // current attack data
    this.hitThisSwing = new Set(); // ids already hit during this active window
    this.queued = null;            // buffered next input ('light' | 'heavy')
    this.chainTimer = 0;           // time left to chain into attack.next
    this.lastAttackId = null;

    this.guardHeld = false;
    this.guardPressedAt = -1;      // sim time guard was last pressed (for parry timing)
    this.time = 0;
    this.guardMeter = 0;
    this.heat = 0;
    this.heatVentTimer = 0;
    this.overheated = 0;
    this.counterWindow = 0;        // >0 = next light becomes 'counter'
    this.staggerTime = 0;
    this.poise = 100;
    this.chargeTime = 0;
  }

  /** Swap the whole moveset (transform supers). Cancels whatever was in progress. */
  setMoveset(def) {
    this.w = def;
    this.attack = null; this.attackId = null; this.queued = null; this.chainTimer = 0;
    this.heat = 0; this.overheated = 0;
    this.projectileAmmo.clear();
    for (const [id, a] of Object.entries(def.attacks)) if (a.projectile?.ammo) this.projectileAmmo.set(id, a.projectile.ammo);
    if (this.busy || this.phase === MeleePhase.CHARGING) this.#setPhase(MeleePhase.IDLE);
  }

  /** Called by Health when this fighter gets a kill. */
  onKill() {
    for (const [id, a] of Object.entries(this.w.attacks)) if (a.projectile?.refillOnKill) this.projectileAmmo.set(id, a.projectile.ammo);
  }

  get busy() { return this.phase === MeleePhase.WINDUP || this.phase === MeleePhase.ACTIVE || this.phase === MeleePhase.RECOVERY; }
  get guarding() { return this.phase === MeleePhase.GUARD; }
  get vulnerable() { return this.phase === MeleePhase.STAGGER || this.phase === MeleePhase.GUARD_BROKEN; }

  update(cmd, dt) {
    this.time += dt;
    this.phaseTime += dt;
    this.chainTimer = Math.max(0, this.chainTimer - dt);
    this.counterWindow = Math.max(0, this.counterWindow - dt);
    this.#updateHeat(dt);
    this.poise = Math.min(100, this.poise + 25 * dt);

    const b = cmd.buttons;
    const mv = this.owner.movement;

    // Input buffering: a press during an attack is remembered and fired at the earliest legal frame.
    if (b.light?.pressed) this.queued = 'light';
    if (b.heavy?.pressed) { this.queued = 'heavy'; this.chargeTime = 0; }

    switch (this.phase) {
      case MeleePhase.STAGGER:
      case MeleePhase.GUARD_BROKEN:
        if (this.phaseTime >= this.staggerTime) this.#setPhase(MeleePhase.IDLE);
        return;

      case MeleePhase.PARRY_WHIFF:
        // Whiffed parry: can still hold block, but no parry window until this expires.
        if (this.phaseTime >= this.w.guard.parryWhiff) this.#setPhase(b.guard?.down ? MeleePhase.GUARD : MeleePhase.IDLE);
        return;

      case MeleePhase.WINDUP: {
        // Feint: pressing guard during the first 60% of a heavy windup cancels it (costs stamina).
        if (b.guard?.pressed && this.attackId.startsWith('heavy') && this.phaseTime < this.attack.windup * 0.6 && mv.spendStamina(10)) {
          bus.emit('melee:feint', { id: this.owner.id });
          return this.#enterGuard();
        }
        if (this.phaseTime >= this.attack.windup) {
          this.hitThisSwing.clear();
          this.#setPhase(MeleePhase.ACTIVE);
          if (this.attack.lunge) mv.state.velocity.addScaledVector(this.#forward(), this.attack.lunge);
          if (this.attack.projectile) this.#launchProjectile(this.attack);
        }
        return;
      }

      case MeleePhase.ACTIVE:
        if (this.phaseTime >= this.attack.active) this.#setPhase(MeleePhase.RECOVERY);
        return;

      case MeleePhase.RECOVERY: {
        const a = this.attack;
        // Chain into next attack as soon as the cancel point passes, using the buffered input.
        const cancelPoint = a.recovery * 0.4;
        if (this.phaseTime >= cancelPoint) {
          if (this.queued && a.next?.[this.queued]) return this.#startAttack(a.next[this.queued]);
          if (b.guard?.pressed) return this.#enterGuard();
          if (b.dodge?.pressed) { this.#setPhase(MeleePhase.IDLE); return; } // movement handles the dodge
        }
        if (this.phaseTime >= a.recovery) {
          this.chainTimer = a.chainWindow ?? 0;
          this.lastAttackId = this.attackId;
          mv.state.locks.sprint = 0;
          this.#setPhase(MeleePhase.IDLE);
        }
        return;
      }

      case MeleePhase.CHARGING:
        // Hold heavy to charge the flame special; release early → normal heavy.
        this.chargeTime += dt;
        if (!b.heavy?.down) {
          const charged = this.chargeTime >= this.w.chargeTime && this.overheated <= 0;
          return this.#startAttack(charged ? (mv.state.sprinting ? 'sweepArc' : 'flameWave') : 'heavy1');
        }
        return;

      case MeleePhase.GUARD:
        mv.state.speedScale = Math.min(mv.state.speedScale, 0.55);
        if (!b.guard?.down) {
          // Tap-released with nothing to parry = whiffed parry → short lockout (anti-spam).
          const whiffed = this._pendingParryCheck && this.phaseTime < 0.3;
          this._pendingParryCheck = false;
          this.#setPhase(whiffed ? MeleePhase.PARRY_WHIFF : MeleePhase.IDLE);
          if (whiffed) bus.emit('melee:parryWhiff', { id: this.owner.id });
        }
        else if (b.light?.pressed && b.heavy?.down) return this.#startAttack('guardBreak');
        return;

      case MeleePhase.IDLE:
      default:
        if (b.guard?.pressed) return this.#enterGuard();
        if (this.queued === 'light') {
          // Priority: counter > slide slash > chain > opener.
          if (this.counterWindow > 0) return this.#startAttack('counter');
          if (mv.isSliding()) return this.#startAttack('slideSlash');
          const chained = this.chainTimer > 0 && this.w.attacks[this.lastAttackId]?.next?.light;
          return this.#startAttack(chained || 'light1');
        }
        if (this.queued === 'heavy') {
          this.queued = null;
          this.#setPhase(MeleePhase.CHARGING);
        }
    }
  }

  // ----------------------------------------------------------------- defense
  /**
   * Called by MeleeSystem when an attacker's active hitbox overlaps this owner.
   * Returns HitResult; also applies damage/stagger to both parties.
   */
  receiveHit(attacker, attack, hitDir) {
    const g = this.w.guard;
    const mv = this.owner.movement;
    if (mv.state.invulnerable) return HitResult.IFRAME;

    // Must be roughly facing the attacker to defend (no blocking from behind).
    const facing = this.#forward().dot(hitDir) < -0.3;
    const sinceGuardPress = this.time - this.guardPressedAt;
    const parryable = attack.parryable !== false;
    if (this.phase === MeleePhase.GUARD) this._pendingParryCheck = false; // a hit arrived: not a whiff

    if (facing && this.phase === MeleePhase.GUARD && parryable && sinceGuardPress <= g.parryWindow) {
      // ---------- PERFECT PARRY
      attacker.#stagger(0.9, 'parried');
      this.counterWindow = 0.6;
      this.guardMeter = Math.min(g.guardMax, this.guardMeter + 25);
      this.heat = Math.max(0, this.heat - this.w.heat.parryVent);
      bus.emit('melee:parry', { defender: this.owner.id, attacker: attacker.owner.id, hitStop: 4 / 60 });
      return HitResult.PARRIED;
    }

    if (facing && this.phase === MeleePhase.GUARD && !attack.unblockable) {
      const perfect = sinceGuardPress <= g.parryWindow + g.perfectBlockWindow;
      const reduction = perfect ? 1 : g.blockReduction * (this.overheated > 0 ? 0.5 : 1);
      this.owner.health.damage(attack.damage * (1 - reduction), attack, attacker.owner);
      if (perfect) {
        this.guardMeter = Math.min(g.guardMax, this.guardMeter + 15);
        bus.emit('melee:perfectBlock', { defender: this.owner.id, attacker: attacker.owner.id, hitStop: 2 / 60 });
        return HitResult.PERFECT_BLOCK;
      }
      // Guard damage drains stamina; empty stamina = guard break.
      if (!mv.spendStamina(attack.guardDmg * 0.5)) {
        mv.state.stamina = 0;
        this.#stagger(1.2, 'guardBroken');
        bus.emit('melee:guardBreak', { defender: this.owner.id, attacker: attacker.owner.id });
        return HitResult.GUARD_BREAK;
      }
      bus.emit('melee:block', { defender: this.owner.id, attacker: attacker.owner.id, hitStop: 1 / 60 });
      return HitResult.BLOCKED;
    }

    // ---------- CLEAN HIT
    const hot = attacker.heat >= attacker.w.heat.hotThreshold;
    const vulnerableBonus = this.vulnerable ? 1.5 : 1;
    const dmg = attack.damage * (hot ? 1 + attacker.w.heat.hotBurnBonus : 1) * vulnerableBonus;
    this.owner.health.damage(dmg, attack, attacker.owner);
    if (attack.onHitStatus) this.owner.status?.apply(attack.onHitStatus, { source: attacker.owner });

    // Poise: hyper-armor ignores flinch; otherwise poise damage → interrupt.
    const inHyper = this.attack?.hyperArmor && this.phase !== MeleePhase.IDLE &&
      this.phaseTime >= this.attack.hyperArmor[0] && this.phaseTime <= this.attack.hyperArmor[1];
    this.poise -= attack.poise;
    if (!inHyper && (this.poise <= 0 || this.busy)) this.#stagger(this.poise <= 0 ? 0.8 : 0.35, 'flinch');
    if (this.poise <= 0) this.poise = 60;

    bus.emit('melee:hit', {
      attacker: attacker.owner.id, defender: this.owner.id, damage: dmg, crit: this.vulnerable || hot,
      hitStop: (this.vulnerable ? 5 : 3) / 60, dir: hitDir,
    });
    // Gun interplay: melee interrupts reloads/ADS on the victim.
    this.owner.weapons?.interrupt?.('melee');
    return HitResult.HIT;
  }

  /** Called by WeaponSystem when a point-blank shotgun/heavy pistol hits us during windup. */
  interruptByGun(poiseDamage) {
    if (this.phase === MeleePhase.WINDUP && !this.attack.hyperArmor) this.#stagger(0.3, 'gunFlinch');
    this.poise -= poiseDamage;
  }

  // ----------------------------------------------------------------- internals
  #startAttack(id) {
    const a = this.w.attacks[id];
    if (!a) { this.queued = null; if (this.phase === MeleePhase.CHARGING) this.#setPhase(MeleePhase.IDLE); return; }
    if (this.projectileAmmo.has(id) && this.projectileAmmo.get(id) <= 0) { bus.emit('melee:noAmmo', { id: this.owner.id, attack: id }); this.queued = null; return; }
    const mv = this.owner.movement;
    if (a.stamina > 0 && !mv.spendStamina(a.stamina)) { bus.emit('melee:noStamina', { id: this.owner.id }); this.queued = null; return; }
    if (this.overheated > 0 && (id === 'flameWave' || id === 'sweepArc')) id = 'heavy1';
    this.attackId = id;
    this.attack = this.w.attacks[id];
    this.queued = null;
    this.#addHeat(this.attack.heat);
    mv.state.locks.sprint = this.attack.windup + this.attack.active + this.attack.recovery;
    this.#setPhase(MeleePhase.WINDUP);
    // Windup event drives the HUD directional indicator on defenders + AI reaction.
    bus.emit('melee:windup', {
      id: this.owner.id, attack: id, windup: this.attack.windup,
      unblockable: !!this.attack.unblockable, parryable: this.attack.parryable !== false,
    });
  }

  /**
   * Flame waves, rift arcs and thrown daggers. They are real projectiles: they can be dodged, and a
   * flame-sword guard can parry them back (deflectable), which is the stated counterplay.
   */
  #launchProjectile(a) {
    const pj = a.projectile;
    if (this.projectileAmmo.has(this.attackId)) this.projectileAmmo.set(this.attackId, this.projectileAmmo.get(this.attackId) - 1);
    bus.emit('melee:projectile', { id: this.owner.id, attack: this.attackId, dir: this.#forward().clone(), width: pj.width, element: pj.element });
    if (!this.world) return;
    const o = this.owner.movement.state.position.clone(); o.y += 1.2;
    this.world.spawnProjectile({
      ownerId: this.owner.id, team: this.owner.team, origin: o, dir: this.#forward().clone(),
      speed: pj.speed, drop: 0, damageMul: 1, splash: pj.splashRadius ?? 0, deflectable: pj.reflectOnParry !== false, width: pj.width,
      weapon: { id: `${this.w.id ?? 'sword'}:${this.attackId}`, ammoType: pj.element === 'void' ? 'void' : 'flame', range: pj.range, damage: { base: a.damage }, vfx: { tracer: `wave_${pj.element ?? 'flame'}` } },
      onHit: { status: pj.status, zone: pj.pull ? { radius: 3, lifetime: 0.4, tick: 0.1, pull: pj.pull } : undefined },
    });
  }

  #enterGuard() {
    this.guardPressedAt = this.time;
    this.guardHeld = true;
    this.#setPhase(MeleePhase.GUARD);
    // Parry whiff detection happens on release in the GUARD phase.
    this._pendingParryCheck = true;
  }

  #stagger(duration, reason) {
    this.staggerTime = duration;
    this.attack = null;
    this.queued = null;
    this.#setPhase(reason === 'guardBroken' ? MeleePhase.GUARD_BROKEN : MeleePhase.STAGGER);
    this.owner.movement.state.locks.move = duration * 0.6;
    bus.emit('melee:stagger', { id: this.owner.id, reason, duration });
  }

  #addHeat(amount) {
    this.heat = Math.max(0, Math.min(this.w.heat.max, this.heat + amount));
    this.heatVentTimer = this.w.heat.ventDelay;
    if (this.heat >= this.w.heat.max && this.overheated <= 0) {
      this.overheated = this.w.heat.overheatDuration;
      bus.emit('melee:overheat', { id: this.owner.id });
    }
  }

  #updateHeat(dt) {
    if (this.overheated > 0) { this.overheated -= dt; if (this.overheated <= 0) this.heat = this.w.heat.max * 0.5; return; }
    if (this.heatVentTimer > 0) this.heatVentTimer -= dt;
    else this.heat = Math.max(0, this.heat - this.w.heat.ventPerSec * dt);
  }

  #setPhase(p) { this.phase = p; this.phaseTime = 0; }

  #forward() {
    const yaw = this.owner.movement.state.yaw;
    return _fwdScratch.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  }

  // Exposed to MeleeSystem
  _forward() { return this.#forward(); }
}
const _fwdScratch = new Vector3();

/** Resolves overlaps between active attacks and targets. Server-authoritative online. */
export class MeleeSystem {
  constructor() { this.components = []; }
  add(c) { this.components.push(c); return c; }
  remove(c) { this.components = this.components.filter((x) => x !== c); }

  resolve() {
    for (const atk of this.components) {
      if (atk.phase !== MeleePhase.ACTIVE || !atk.attack || atk.attack.projectile) continue;
      const a = atk.attack;
      const origin = atk.owner.movement.state.position;
      const fwd = atk._forward();
      const cosHalfArc = Math.cos(((a.arc ?? 90) * Math.PI) / 360);

      for (const def of this.components) {
        if (def === atk || def.owner.team === atk.owner.team || atk.hitThisSwing.has(def.owner.id)) continue;
        if ((def.owner.vehicle && !def.owner.vehicle.exposed) || atk.owner.vehicle) continue; // swords can't reach inside hulls
        _toTarget.subVectors(def.owner.movement.state.position, origin);
        _toTarget.y = 0;
        const dist = _toTarget.length();
        if (dist > a.range || dist < 1e-3) continue;
        _toTarget.divideScalar(dist);
        if (_toTarget.dot(fwd) < cosHalfArc) continue;
        // TODO: replace cone test with swept capsule (socket_flame_base→tip between ticks) vs hitbox capsules.
        atk.hitThisSwing.add(def.owner.id);
        def.receiveHit(atk, a, _toTarget.clone());
      }
    }
  }
}
