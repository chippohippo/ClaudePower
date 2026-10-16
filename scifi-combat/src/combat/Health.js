// Health: HP, regenerating shield (Solari) or leech armor (Void), and overshield.
// Damage order: overshield → shield → HP. Every layer that breaks emits its own event so
// audio and HUD can give a distinct cue (shield crack ≠ overshield pop ≠ low-HP heartbeat).

import { bus } from '../core/EventBus.js';

export class Health {
  constructor(owner, { health = 100, shield = 0, armor = 'flesh', shieldRegenDelay = 4, shieldRegenRate = 25 } = {}) {
    this.owner = owner;
    this.max = health; this.hp = health;
    this.maxShield = shield; this.shield = shield;
    this.overshield = 0; this.overshieldTime = 0;
    this.armor = armor;
    this.regenDelay = shieldRegenDelay; this.regenRate = shieldRegenRate;
    this.sinceDamage = 99;
    this.dead = false;
  }

  /** Armor type for the damage matrix. Shields count as 'shield' while they're up. */
  armorFor(_zone) { return this.overshield > 0 || this.shield > 0 ? 'shield' : this.armor; }

  damage(amount, info = {}, by = null) {
    if (this.dead || amount <= 0) return { dealt: 0 };
    amount *= this.owner.status?.damageTakenMul ?? 1;
    const start = amount;
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
    this.sinceDamage = 0;
    this.owner.status?.onDamaged(info);
    const killed = this.hp <= 0;
    if (killed) { this.hp = 0; this.dead = true; bus.emit('entity:death', { id: this.owner.id, by: by?.id, info }); if (by?.abilities) { by.abilities.gainSuper(15); by.abilities.flux += 1; } by?.melee?.onKill?.(); }
    else if (this.hp < this.max * 0.3) bus.emit('health:low', { id: this.owner.id });
    by?.abilities?.gainSuper?.(start * 0.02);
    return { dealt: start, shieldBroke, killed };
  }

  heal(amount) { if (!this.dead) this.hp = Math.min(this.max, this.hp + amount); }
  addOvershield(amount, duration) { this.overshield = Math.max(this.overshield, amount); this.overshieldTime = duration; }
  revive(fraction = 0.5) { this.dead = false; this.hp = this.max * fraction; bus.emit('entity:revived', { id: this.owner.id }); }

  update(dt) {
    this.sinceDamage += dt;
    if (this.overshieldTime > 0 && (this.overshieldTime -= dt) <= 0) this.overshield = 0;
    if (this.maxShield > 0 && this.sinceDamage > this.regenDelay && this.shield < this.maxShield) {
      if (this.shield === 0) bus.emit('health:shieldRegenStart', { id: this.owner.id });
      this.shield = Math.min(this.maxShield, this.shield + this.regenRate * dt);
    }
  }
}
