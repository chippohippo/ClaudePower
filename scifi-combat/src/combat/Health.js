// Health: HP, regenerating shield (Solari) or leech armor (Void), and overshield.
// Damage order: overshield → shield → HP. Every layer that breaks emits its own event so
// audio and HUD can give a distinct cue (shield crack ≠ overshield pop ≠ low-HP heartbeat).
//
// Down but not out (data/down.json): at 0 HP a soldier is downed, not dead, unless the hit was
// overkill (far past zero, or a big headshot). Downed soldiers bleed out (paused while being
// revived), and further damage eats a small downed pool before they die. A teammate's revive
// puts them back up with part of their HP. Kill credit for a bleed-out goes to whoever downed
// them. Events: entity:downed, entity:revived, entity:death { how: killed | finished | bledOut | gaveUp }.

import { bus } from '../core/EventBus.js';

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
    let killed = false, downed = false;
    if (this.hp <= 0) {
      const over = -this.hp, d = this.down;
      this.hp = 0;
      const overkill = !d || info.noDown || over >= this.max * d.overkill || (info.zone === 'head' && start >= this.max * d.headshotKill);
      if (overkill) { this.#die(info, by, 'killed'); killed = true; } else { this.#goDown(info, by); downed = true; }
    } else if (this.hp < this.max * 0.3) bus.emit('health:low', { id: this.owner.id });
    by?.abilities?.gainSuper?.(start * 0.02);
    const res = { dealt: start, shieldBroke, killed, downed };
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
    this.dead = false; this.downed = false; this.reviving = 0; this.hp = this.max * fraction;
    bus.emit('entity:revived', { id: this.owner.id });
  }
  /** A teammate got you up: back on your feet with part of your HP. */
  reviveFromDown(fraction, by = null) {
    if (!this.downed || this.dead) return false;
    this.downed = false; this.reviving = 0; this.hp = Math.max(1, this.max * fraction); this.sinceDamage = 0;
    this.owner.onRevived?.();
    bus.emit('entity:revived', { id: this.owner.id, by: by?.id, fromDown: true });
    return true;
  }
  /** Downed and done waiting: die now (respawn sooner). */
  giveUp() { if (this.downed && !this.dead) this.#die({ kind: 'giveUp' }, null, 'gaveUp'); }

  update(dt) {
    this.sinceDamage += dt;
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
