// AbilitySystem: class kits (ability1, ability2, grenade, super).
//
// Design goals, borrowed from Deadlock and Destiny 2:
//   * Every ability is a commitment. It has a cast time (the tell), a cooldown that matters
//     (12-90 s) and a counterplay line in its data. Fights become cooldown trades: "she just
//     burned her dash, so now I can commit."
//   * Every cast is readable. It emits a telegraph (shape on the ground or in the air, colored
//     by team relation) and an audio cue in two variants: a friendly one, and a louder, harsher
//     enemy one that is never culled. Enemies hear it before they see it.
//   * The super charges from combat (damage, kills, objectives, plus a slow trickle over time).
//     When an enemy casts one, a directional warning plays for every threatened player.
//   * Mid-match upgrades (Deadlock's ability points): each ability has 3 tiers bought with Flux
//     from kills and objectives. Tier 3 changes how the ability behaves, not just its numbers.
//
// Like the other combat systems this is pure simulation. Effects run through an injected world:
//   world.entitiesInRadius(point, radius) -> entity[]
//   world.entitiesInShape(shape, origin, dir) -> entity[]
//   world.spawnProjectile(spec), world.spawnZone(spec), world.spawnDeployable(spec), world.raycast(...)

import { Vector3 } from 'three';
import { bus } from '../core/EventBus.js';

export const AbilityPhase = Object.freeze({ READY: 'ready', CASTING: 'casting', ACTIVE: 'active', COOLDOWN: 'cooldown' });
export const SLOTS = ['ability1', 'ability2', 'grenade', 'super'];

const _fwd = new Vector3();
const _p = new Vector3();

export class AbilitySlot {
  constructor(def) {
    this.def = def;
    this.tier = 0;                       // 0 = base, 1..3 = bought upgrades
    this.charges = def.charges ?? 1;
    this.cooldown = 0;                   // time until the next charge comes back
    this.phase = AbilityPhase.READY;
    this.phaseTime = 0;
    this.effectsFired = new Set();
    this.recast = null;                  // { until } when the ability supports a recast
  }
  /** Data after applying upgrade tiers (tier ops use the same format as attachments). */
  get stats() {
    if (this._cacheTier === this.tier) return this._cache;
    const d = structuredClone(this.def);
    for (let i = 0; i < this.tier; i++) for (const op of d.upgrades?.[i]?.ops ?? []) applyOp(d, op);
    this._cacheTier = this.tier; this._cache = d;
    return d;
  }
  get ready() { return this.charges > 0 && this.phase !== AbilityPhase.CASTING && this.phase !== AbilityPhase.ACTIVE; }
}

export class AbilityComponent {
  /**
   * @param {object} owner { id, team, movement, health, status, weapons, melee }
   * @param {object} kit   { ability1, ability2, grenade, super } definitions from data/abilities
   */
  constructor(owner, kit, world, { superCost = 100 } = {}) {
    this.owner = owner;
    this.world = world;
    this.slots = Object.fromEntries(SLOTS.filter((k) => kit[k]).map((k) => [k, new AbilitySlot(kit[k])]));
    this.superEnergy = 0;
    this.superCost = superCost;
    this.flux = 0;                       // upgrade currency earned in the match
    this.casting = null;                 // slot currently casting or active
    this.cooldownMul = 1;                // passives and buffs can change this
  }

  // ---------------------------------------------------------------- tick
  update(cmd, dt) {
    const st = this.owner.status;
    this.superEnergy = Math.min(this.superCost, this.superEnergy + dt * 0.35); // slow trickle, about 5 min from empty
    if (this.iframeTime > 0 && (this.iframeTime -= dt) <= 0) this.owner.movement.state.invulnerable = false;

    for (const [key, slot] of Object.entries(this.slots)) {
      const s = slot.stats;
      // Cooldowns run while not casting, one charge at a time.
      if (key !== 'super' && slot.charges < (s.charges ?? 1) && slot.phase !== AbilityPhase.CASTING) {
        slot.cooldown -= dt / this.cooldownMul;
        if (slot.cooldown <= 0) {
          slot.charges++;
          slot.cooldown = slot.charges < (s.charges ?? 1) ? s.cooldown : 0;
          bus.emit('ability:ready', { id: this.owner.id, slot: key, ability: s.id }); // self-only "ready" ping
        }
      }
      if (slot.recast && slot.phaseTime > slot.recast.until) slot.recast = null;
      slot.phaseTime += dt;
    }

    if (this.casting) return this.#tickCast(cmd, dt);

    // Input → cast. Silence/suppress blocks everything; recasts (detonate, return) still count as casts.
    const b = cmd.buttons;
    for (const key of SLOTS) {
      if (!b[key]?.pressed || !this.slots[key]) continue;
      const slot = this.slots[key];
      if (slot.recast) { this.#recast(key, slot, cmd); break; }
      if (st?.silenced) { bus.emit('ability:blocked', { id: this.owner.id, slot: key, reason: 'silenced' }); break; }
      if (!this.#canCast(key, slot)) { bus.emit('ability:blocked', { id: this.owner.id, slot: key, reason: slot.charges <= 0 ? 'cooldown' : 'state' }); break; }
      this.#beginCast(key, slot, cmd);
      break;
    }
  }

  #canCast(key, slot) {
    const s = slot.stats, mv = this.owner.movement.state;
    if (!slot.ready) return false;
    if (key === 'super' && this.superEnergy < this.superCost) return false;
    if (s.cast?.groundedOnly && !mv.grounded) return false;
    if (mv.mode === 'mantle' || mv.mode === 'vehicle') return false;
    if (this.owner.melee?.busy && !s.cast?.cancelsMelee) return false;
    return true;
  }

  #beginCast(key, slot, cmd) {
    const s = slot.stats;
    this.casting = { key, slot, aimYaw: cmd.yaw, aimPitch: cmd.pitch, origin: this.owner.movement.state.position.clone() };
    slot.phase = AbilityPhase.CASTING;
    slot.phaseTime = 0;
    slot.effectsFired.clear();
    if (key === 'super') this.superEnergy = 0; else slot.charges--;
    if (key !== 'super' && slot.cooldown <= 0) slot.cooldown = s.cooldown;

    // Commitment: casting slows or roots you and stops sprinting (Deadlock: abilities are decisions).
    const mv = this.owner.movement.state;
    mv.locks.sprint = (s.cast?.time ?? 0) + 0.1;
    if (s.cast?.root) mv.locks.move = s.cast.time ?? 0;

    // Clarity: the telegraph and cast cue go out on the first tick of the cast, so enemies get
    // the full cast time to react. That is what makes the tell fair.
    bus.emit('ability:cast', {
      id: this.owner.id, team: this.owner.team, slot: key, ability: s.id, tier: slot.tier,
      castTime: s.cast?.time ?? 0, telegraph: s.telegraph, audio: s.audio,
      origin: this.casting.origin.toArray(), yaw: cmd.yaw, isSuper: key === 'super',
    });
  }

  #tickCast(cmd, dt) {
    const { key, slot } = this.casting;
    const s = slot.stats;
    const castTime = s.cast?.time ?? 0;
    // Aim keeps following during the cast unless the ability locks its direction.
    if (!s.cast?.lockAim) { this.casting.aimYaw = cmd.yaw; this.casting.aimPitch = cmd.pitch; }
    this.owner.movement.state.speedScale = Math.min(this.owner.movement.state.speedScale, s.cast?.moveMul ?? 1);

    if (slot.phase === AbilityPhase.CASTING && slot.phaseTime >= castTime) {
      slot.phase = AbilityPhase.ACTIVE;
      slot.phaseTime = 0;
      bus.emit('ability:activate', { id: this.owner.id, team: this.owner.team, slot: key, ability: s.id, audio: s.audio, isSuper: key === 'super' });
    }
    if (slot.phase === AbilityPhase.ACTIVE) {
      // Effects fire at their own 'at' offset (seconds after activation), or 'end'.
      const dur = s.duration ?? 0;
      for (let i = 0; i < s.effects.length; i++) {
        const fx = s.effects[i];
        const at = fx.at === 'end' ? dur : fx.at ?? 0;
        if (!slot.effectsFired.has(i) && slot.phaseTime >= at) {
          slot.effectsFired.add(i);
          runEffect(fx, this, slot);
        }
      }
      // Channels and supers can be ended early by pressing the slot again.
      const cancel = s.cancelable && cmd.buttons[key]?.pressed && slot.phaseTime > 0.2;
      if (slot.phaseTime >= dur || cancel) this.#finish(key, slot, cancel ? 'cancel' : 'done');
    }
  }

  #finish(key, slot, reason) {
    const s = slot.stats;
    slot.phase = slot.charges > 0 ? AbilityPhase.READY : AbilityPhase.COOLDOWN;
    slot.phaseTime = 0;
    if (s.recast) slot.recast = { until: s.recast.window };
    this.casting = null;
    bus.emit('ability:end', { id: this.owner.id, slot: key, ability: s.id, reason, audio: s.audio });
  }

  #recast(key, slot, cmd) {
    const s = slot.stats;
    slot.recast = null;
    this.casting = { key, slot, aimYaw: cmd.yaw, aimPitch: cmd.pitch, origin: this.owner.movement.state.position.clone() };
    for (const fx of s.recast.effects) runEffect(fx, this, slot);
    this.casting = null;
    bus.emit('ability:recast', { id: this.owner.id, slot: key, ability: s.id, audio: s.audio });
  }

  /** Stun or suppress during a cast cancels it and refunds half the cooldown (Deadlock-style interrupt). */
  interrupt(reason) {
    if (!this.casting) return;
    const { key, slot } = this.casting;
    const s = slot.stats;
    if (slot.phase === AbilityPhase.CASTING && s.cast?.interruptible !== false) {
      if (key === 'super') this.superEnergy = this.superCost * 0.5;
      else slot.cooldown *= 0.5;
      bus.emit('ability:interrupted', { id: this.owner.id, slot: key, ability: s.id, reason });
      this.#finish(key, slot, 'interrupted');
    }
  }

  // ---------------------------------------------------------------- economy hooks
  gainSuper(amount) {
    const before = this.superEnergy;
    this.superEnergy = Math.min(this.superCost, this.superEnergy + amount);
    if (before < this.superCost && this.superEnergy >= this.superCost) bus.emit('ability:superReady', { id: this.owner.id });
  }
  /** Spend Flux to upgrade an ability. Upgrade cost grows by tier: 1, 2, 3. */
  upgrade(key) {
    const slot = this.slots[key];
    if (!slot) return false;
    const cost = slot.tier + 1;
    if (slot.tier >= (slot.def.upgrades?.length ?? 0) || this.flux < cost) return false;
    this.flux -= cost;
    slot.tier++;
    bus.emit('ability:upgraded', { id: this.owner.id, slot: key, tier: slot.tier, desc: slot.def.upgrades[slot.tier - 1].desc });
    return true;
  }
  /** Public state for the HUD, including what enemies can see (Deadlock shows enemy cooldowns). */
  snapshot() {
    return Object.fromEntries(Object.entries(this.slots).map(([k, s]) => [k, {
      id: s.def.id, charges: s.charges, cooldown: s.cooldown, max: s.stats.cooldown, tier: s.tier, phase: s.phase,
      ready: k === 'super' ? this.superEnergy >= this.superCost : s.charges > 0,
    }]));
  }
}

// ---------------------------------------------------------------- effect library
// Small composable primitives. Each ability in data is a list of these. New abilities need new
// data, not new code, unless they need a new primitive.

function forwardOf(c) {
  const y = c.casting.aimYaw, p = c.casting.aimPitch ?? 0;
  return _fwd.set(-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
}
function enemiesOf(c, list) { return list.filter((e) => e.team !== c.owner.team && e.health && !e.movement?.state.invulnerable); }
function alliesOf(c, list) { return list.filter((e) => e.team === c.owner.team && e.health); }

function hitEntities(c, fx, targets, slot) {
  for (const e of targets) {
    if (fx.damage) {
      const res = e.health.damage(fx.damage * (e.status?.damageTakenMul ?? 1), { kind: 'ability', ability: slot.def.id, ammoType: fx.element }, c.owner);
      c.gainSuper(fx.damage * 0.05);
      bus.emit('ability:hit', { attacker: c.owner.id, victim: e.id, ability: slot.def.id, damage: fx.damage, killed: !!res?.killed, element: fx.element });
    }
    if (fx.status) e.status?.apply(fx.status.id, { stacks: fx.status.stacks ?? 1, duration: fx.status.duration, source: c.owner });
    if (fx.knockback) {
      _p.subVectors(e.movement.state.position, c.owner.movement.state.position).setY(0).normalize();
      e.movement.state.velocity.addScaledVector(_p, fx.knockback).y += fx.knockup ?? 2;
    }
    if (fx.pull) {
      _p.subVectors(c.owner.movement.state.position, e.movement.state.position).setY(0).normalize();
      e.movement.state.velocity.addScaledVector(_p, fx.pull);
    }
  }
}

export const EFFECTS = {
  /** Directional burst of movement along the aim on the ground plane. */
  dash(fx, c) {
    const mv = c.owner.movement.state;
    const f = forwardOf(c).setY(0).normalize();
    const speed = fx.distance / fx.duration;
    mv.forced = { x: f.x * speed, z: f.z * speed, time: fx.duration };
    if (fx.lift) mv.velocity.y = fx.lift;
    if (fx.iframes) { mv.invulnerable = true; c.iframeTime = fx.duration; }
    bus.emit('ability:dash', { id: c.owner.id, distance: fx.distance });
  },
  /** Instant reposition (raycast-limited so you can't blink through walls). */
  blink(fx, c) {
    const mv = c.owner.movement.state;
    const f = forwardOf(c).setY(0).normalize();
    _p.copy(mv.position); _p.y += 1;
    const hit = c.world.raycast(_p, f, fx.distance, c.owner.id);
    const d = hit ? Math.max(0, hit.distance - 0.6) : fx.distance;
    const from = mv.position.toArray();
    mv.position.addScaledVector(f, d);
    c.owner.movement.body.teleport?.(mv.position);
    bus.emit('ability:blink', { id: c.owner.id, from, to: mv.position.toArray() });
  },
  /** Instant area: sphere around the caster, or at the end of the aim ray when `at: 'aim'`. */
  area(fx, c, slot) {
    const center = fx.center === 'aim' ? aimPoint(c, fx.range ?? 20) : c.owner.movement.state.position;
    const all = c.world.entitiesInRadius(center, fx.radius);
    hitEntities(c, fx, fx.target === 'allies' ? alliesOf(c, all) : enemiesOf(c, all), slot);
    if (fx.heal) for (const a of alliesOf(c, all)) a.health.heal?.(fx.heal);
    bus.emit('ability:area', { id: c.owner.id, ability: slot.def.id, center: center.toArray(), radius: fx.radius, element: fx.element });
  },
  /** Cone or line in front of the caster. */
  shape(fx, c, slot) {
    const targets = c.world.entitiesInShape({ kind: fx.shape, length: fx.length, width: fx.width, angle: fx.angle }, c.owner.movement.state.position, forwardOf(c));
    hitEntities(c, fx, enemiesOf(c, targets), slot);
  },
  projectile(fx, c, slot) {
    _p.copy(c.owner.movement.state.position); _p.y += 1.5;
    c.world.spawnProjectile({
      ownerId: c.owner.id, team: c.owner.team, origin: _p.clone(), dir: forwardOf(c).clone(),
      speed: fx.speed, drop: fx.drop ?? 0, damageMul: 1, splash: fx.radius ?? 0, deflectable: !!fx.deflectable,
      weapon: { id: slot.def.id, ammoType: fx.element ?? 'explosive', damage: { base: fx.damage ?? 0, splash: fx.radius ?? 0 }, vfx: { tracer: fx.vfx } },
      onHit: fx.onHit, fuse: fx.fuse, bounce: fx.bounce, sticky: fx.sticky,
    });
  },
  /** Persistent zone that ticks (healing wells, gravity wells, fire fields). */
  zone(fx, c, slot) {
    const center = fx.center === 'aim' ? aimPoint(c, fx.range ?? 20) : c.owner.movement.state.position.clone();
    c.world.spawnZone({ ownerId: c.owner.id, team: c.owner.team, ability: slot.def.id, center, ...fx });
  },
  deployable(fx, c, slot) {
    c.world.spawnDeployable({ ownerId: c.owner.id, team: c.owner.team, ability: slot.def.id, at: aimPoint(c, fx.range ?? 4), yaw: c.casting.aimYaw, ...fx });
  },
  /** Statuses and buffs on yourself: overshield, haste, cleanse, weapon buffs. */
  self(fx, c) {
    if (fx.status) c.owner.status?.apply(fx.status.id, { stacks: fx.status.stacks ?? 1, duration: fx.status.duration, source: c.owner });
    if (fx.overshield) c.owner.health.addOvershield?.(fx.overshield, fx.duration ?? 6);
    if (fx.heal) c.owner.health.heal?.(fx.heal);
    if (fx.cleanse) c.owner.status?.cleanse();
    if (fx.weaponBuff) c.owner.weapons?.applyBuff(fx.weaponBuff, fx.duration ?? 6);
    if (fx.meleeHeat != null && c.owner.melee) c.owner.melee.heat = fx.meleeHeat;
  },
  /** Reveal enemies in radius through walls for the caster's team (Deadlock: info is power). */
  reveal(fx, c) {
    const all = enemiesOf(c, c.world.entitiesInRadius(c.owner.movement.state.position, fx.radius));
    for (const e of all) e.status?.apply('revealed', { duration: fx.duration, source: c.owner });
    bus.emit('ability:reveal', { id: c.owner.id, team: c.owner.team, count: all.length, radius: fx.radius });
  },
  /** Transform: temporary weapon or moveset swap (Destiny roaming supers). */
  transform(fx, c, slot) {
    bus.emit('ability:transform', { id: c.owner.id, ability: slot.def.id, form: fx.form, duration: slot.stats.duration });
    if (fx.meleeOverride && c.owner.melee) c.owner.melee.override = fx.meleeOverride;
    if (fx.status) EFFECTS.self(fx, c);
  },
};

function runEffect(fx, c, slot) {
  const f = EFFECTS[fx.type];
  if (!f) return console.warn(`Unknown ability effect "${fx.type}" in ${slot.def.id}`);
  f(fx, c, slot);
}

function aimPoint(c, range) {
  _p.copy(c.owner.movement.state.position); _p.y += 1.6;
  const f = forwardOf(c);
  const hit = c.world.raycast(_p, f, range, c.owner.id);
  return hit ? hit.point.clone() : _p.clone().addScaledVector(f, range);
}

function applyOp(obj, { stat, op, value }) {
  const keys = stat.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[isNaN(keys[i]) ? keys[i] : +keys[i]] ??= {};
  const k = keys[keys.length - 1];
  if (op === 'set') o[k] = value;
  else if (op === 'mul') o[k] = (o[k] ?? 1) * value;
  else if (op === 'add') o[k] = (o[k] ?? 0) + value;
  else if (op === 'push') (o[k] ??= []).push(value);
}
