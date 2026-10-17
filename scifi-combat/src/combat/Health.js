// Health: HP, regenerating shield (Solari) or leech armor (Void), and overshield.
// Damage order: overshield → shield → HP. Every layer that breaks emits its own event so
// audio and HUD can give a distinct cue (shield crack ≠ overshield pop ≠ low-HP heartbeat).
//
// Down but not out (data/down.json): at 0 HP a soldier is downed, not dead, unless the hit was
// overkill (far past zero, or a big headshot). Downed soldiers bleed out (paused while being
// revived), and further damage eats a small downed pool before they die. A teammate's revive
// puts them back up with part of their HP, injured (limping, aim swaying) until a stim treats it.
// Kill credit for a bleed-out goes to whoever downed them.
// Wounds: every hit is booked to where it landed (owner.woundSite: head, chest, gut, an arm or a
// leg), so the falling body clutches it and the revived soldier limps on it. Overkill by a blast
// (or far past zero) is mangling: dead, and the body limp at once.
// Events: entity:downed, entity:revived, entity:death { how: killed | mangled | finished | bledOut | gaveUp }.

import { bus } from '../core/EventBus.js';

/** Damage kinds that tear a body apart when they kill it outright. */
const BLASTS = new Set(['explosion', 'splash', 'vehicleExplosion', 'deployable']);

export class Health {
  /**
   * @param {object} owner  the entity (onHit / onDowned / onDied hooks are optional)
   * @param {object} o      { health, shield, armor, shieldRegenDelay, shieldRegenRate, down: data/down.json | null }
   */
  constructor(owner, { health = 100, shield = 0, armor = 'flesh', shieldRegenDelay = 4, shieldRegenRate = 25, down = null } = {}) {
    this.owner = owner;
    this.max = health; this.hp = health;
    this.maxShield = shield; this.shield = shield;
    this.overshield = 0; this.overshieldTime = 0;
    this.armor = armor;
    this.regenDelay = shieldRegenDelay; this.regenRate = shieldRegenRate;
    this.sinceDamage = 99;
    this.dead = false;
    this.down = down?.enabled ? down : null;
    this.downed = false;
    this.bleed = 0;            // seconds left before bleeding out
    this.downHp = 0;           // damage left before a downed soldier dies
    this.downedBy = null;      // id: credit for a bleed-out
    this.reviving = 0;         // revivers working on us (pauses the bleed)
    this.clock = 0;            // seconds this body has existed (the assist window counts on it)
    this.recent = null;        // attacker id -> clock of their last hit (battle point assists)
    this.wounds = null;        // site -> share of max HP taken there since last treated
    this.lastSite = null;      // where the last hit landed
    this.injury = null;        // { site }: got back up from a down with this wound (until treated)
  }

  /** Armor type for the damage matrix. Shields count as 'shield' while they're up. */
  armorFor(_zone) { return this.overshield > 0 || this.shield > 0 ? 'shield' : this.armor; }

  /** Alive and on your feet (not downed, not dead). */
  get up() { return !this.dead && !this.downed; }

  damage(amount, info = {}, by = null) {
    if (this.dead || amount <= 0) return { dealt: 0 };
    amount *= this.owner.status?.damageTakenMul ?? 1;
    const start = amount;
    this.sinceDamage = 0;
    if (by?.id !== undefined && by.id !== this.owner.id) { this.lastBy = by.id; (this.recent ??= new Map()).set(by.id, this.clock); }   // who's shooting at us (squads call it out)
    if (this.downed) {
      // Finishing a downed soldier: damage eats the downed pool.
      this.downHp -= amount;
      const res = { dealt: start, shieldBroke: false, killed: false, downed: false };
      if (this.downHp <= 0) { this.#die(info, by, 'finished'); res.killed = true; }
      this.owner.onHit?.(res, info, by);
      return res;
    }
    let shieldBroke = false;
    if (this.overshield > 0) {
      const t = Math.min(this.overshield, amount); this.overshield -= t; amount -= t;
      if (this.overshield <= 0) bus.emit('health:overshieldBreak', { id: this.owner.id, by: by?.id });
    }
    if (amount > 0 && this.shield > 0) {
      const t = Math.min(this.shield, amount); this.shield -= t; amount -= t;
      if (this.shield <= 0) { shieldBroke = true; bus.emit('health:shieldBreak', { id: this.owner.id, by: by?.id }); }
    }
    this.hp -= amount;
    this.owner.status?.onDamaged(info);
    // Where it landed (HitReactions.woundSite via the owner): the wound the body clutches.
    const site = info.site ?? this.owner.woundSite?.(info) ?? null;
    if (site) { info.site = site; this.lastSite = site; if (amount > 0) (this.wounds ??= {})[site] = (this.wounds[site] ?? 0) + amount / this.max; }
    let killed = false, downed = false, mangled = false;
    if (this.hp <= 0) {
      const over = -this.hp, d = this.down;
      this.hp = 0;
      const overkill = !d || info.noDown || over >= this.max * d.overkill || (info.zone === 'head' && start >= this.max * d.headshotKill);
      mangled = !!d && overkill && !info.noDown && (BLASTS.has(info.kind) || over >= this.max * (d.mangle ?? 1));
      if (overkill) { this.#die(info, by, mangled ? 'mangled' : 'killed'); killed = true; } else { this.#goDown(info, by); downed = true; }
    } else if (this.hp < this.max * 0.3) bus.emit('health:low', { id: this.owner.id });
    if (by?.team !== this.owner.team) by?.abilities?.gainSuper?.(start * 0.02);   // hurting your own side earns nothing
    const res = { dealt: start, shieldBroke, killed, downed, mangled };
    this.owner.onHit?.(res, info, by); // HitReactions: critical hits and collapses throw the body
    return res;
  }

  #goDown(info, by) {
    const d = this.down;
    this.downed = true;
    this.bleed = d.bleedOut; this.downHp = d.downHp; this.downedBy = by?.id ?? null; this.reviving = 0;
    this.shield = 0; this.overshield = 0;
    this.owner.onDowned?.();
    bus.emit('entity:downed', { id: this.owner.id, by: by?.id, info });
    if (by?.abilities) by.abilities.gainSuper(10);
  }

  #die(info, by, how) {
    const wasDowned = this.downed;
    this.dead = true; this.downed = false; this.hp = 0; this.reviving = 0;
    // A bleed-out or give-up credits whoever put them down.
    const credit = how === 'bledOut' || how === 'gaveUp' ? this.downedBy : by?.id;
    this.owner.onDied?.();
    bus.emit('entity:death', { id: this.owner.id, by: credit ?? undefined, info, how, wasDowned });
    if (by?.abilities) { by.abilities.gainSuper(wasDowned ? 5 : 15); by.abilities.flux += 1; }
    by?.melee?.onKill?.();
  }

  heal(amount) { if (!this.dead && !this.downed) this.hp = Math.min(this.max, this.hp + amount); }
  addOvershield(amount, duration) { this.overshield = Math.max(this.overshield, amount); this.overshieldTime = duration; }
  /** Respawn (or a full revive from death): back up at a fraction of max HP. */
  revive(fraction = 0.5) {
    this.dead = false; this.downed = false; this.reviving = 0; this.hp = this.max * fraction; this.recent?.clear();
    this.treat();
    bus.emit('entity:revived', { id: this.owner.id });
  }
  /**
   * A teammate got you up: back on your feet with part of your HP, injured on the wound that put
   * you down (a limp, a swaying aim) unless `treated` (a medic's stim got you up).
   */
  reviveFromDown(fraction, by = null, { treated = false } = {}) {
    if (!this.downed || this.dead) return false;
    this.downed = false; this.reviving = 0; this.hp = Math.max(1, this.max * fraction); this.sinceDamage = 0;
    if (treated) this.treat();
    else { this.injury = { site: this.lastSite ?? 'gut' }; this.owner.status?.apply('injured'); }
    this.owner.onRevived?.();
    bus.emit('entity:revived', { id: this.owner.id, by: by?.id, fromDown: true, injured: !treated });
    return true;
  }
  /** Patched up (a stim, a respawn): the wounds and the injury are gone. */
  treat() {
    this.wounds = null; this.injury = null;
    if (this.owner.status?.has('injured')) this.owner.status.remove('injured');
  }
  /** Downed and done waiting: die now (respawn sooner). */
  giveUp() { if (this.downed && !this.dead) this.#die({ kind: 'giveUp' }, null, 'gaveUp'); }

  update(dt) {
    this.sinceDamage += dt; this.clock += dt;
    if (this.downed) {
      if (this.reviving <= 0 && (this.bleed -= dt) <= 0) this.#die({ kind: 'bleedOut' }, null, 'bledOut');
      return;
    }
    if (this.overshieldTime > 0 && (this.overshieldTime -= dt) <= 0) this.overshield = 0;
    if (this.maxShield > 0 && this.sinceDamage > this.regenDelay && this.shield < this.maxShield) {
      if (this.shield === 0) bus.emit('health:shieldRegenStart', { id: this.owner.id });
      this.shield = Math.min(this.maxShield, this.shield + this.regenRate * dt);
    }
  }
}
