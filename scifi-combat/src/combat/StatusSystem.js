// StatusSystem: timed effects on entities (Destiny 2 "verbs" plus Deadlock-style silence and disarm).
//
// Every status has a definite visual and audio identity (see data/abilities/statuses.json).
// A player should always be able to answer "what is on me, who put it there, and how long does it last".

import { bus } from '../core/EventBus.js';

export class StatusComponent {
  constructor(owner, defs, world = null) {
    this.owner = owner;
    this.world = world;        // needed for area effects (Ignite, Volatile)
    this.defs = defs;          // statuses.json "statuses"
    this.active = new Map();   // id -> { stacks, time, duration, source }
  }

  has(id) { return this.active.has(id); }
  stacks(id) { return this.active.get(id)?.stacks ?? 0; }

  /** Gates read by other systems. */
  get silenced() { return this.has('suppress') || this.has('silence') || this.has('stun'); }
  get disarmed() { return this.has('disarm') || this.has('stun'); }
  get rooted() { return this.has('stun') || this.has('root'); }
  get damageTakenMul() { return (this.has('weaken') ? 1 + this.defs.weaken.damageTaken : 1) * (this.has('fortify') ? 1 - this.defs.fortify.damageReduction : 1); }
  get speedMul() {
    let m = 1;
    if (this.has('slow')) m *= 1 - this.defs.slow.amount * Math.min(1, this.stacks('slow') / (this.defs.slow.maxStacks ?? 1));
    if (this.has('haste')) m *= 1 + this.defs.haste.amount;
    return this.rooted ? 0 : m;
  }

  apply(id, { stacks = 1, duration, source } = {}) {
    const def = this.defs[id];
    if (!def || this.immune?.has(id)) return; // vehicles are immune to body statuses such as Scorch and Volatile
    if (this.has('cleanseImmune') && def.negative) return;
    const cur = this.active.get(id);
    const dur = duration ?? def.duration;
    if (cur) {
      cur.stacks = Math.min(def.maxStacks ?? 1, cur.stacks + stacks);
      cur.duration = Math.max(cur.duration - cur.time, dur); cur.time = 0;
      cur.source = source ?? cur.source;
    } else {
      this.active.set(id, { stacks: Math.min(def.maxStacks ?? 1, stacks), time: 0, duration: dur, source });
      bus.emit('status:applied', { id: this.owner.id, status: id, source: source?.id, duration: dur });
      // Interrupts: a stun or suppress cancels casts, reloads and channels right away.
      if (def.detonate) this.#burst(def.detonate, source, id);
      if (def.interrupts) { this.owner.abilities?.interrupt?.(id); this.owner.weapons?.interrupt?.('stun'); }
    }
    // Threshold transforms, as in Destiny: 100 Scorch stacks Ignite, and 3 Slow stacks Freeze.
    const s = this.active.get(id);
    if (def.thresholdTo && s.stacks >= def.maxStacks) {
      this.remove(id);
      this.apply(def.thresholdTo, { source });
      bus.emit('status:threshold', { id: this.owner.id, from: id, to: def.thresholdTo, source: source?.id });
    }
  }

  /** Called by Health after any damage. Volatile bursts and cloak breaks hook in here. */
  onDamaged(info) {
    if (info?.kind === 'status') return; // a DoT tick must not chain-detonate itself
    const v = this.active.get('volatile');
    if (v) { this.remove('volatile'); this.#burst(this.defs.volatile.onDamaged, v.source, 'volatile'); }
    if (this.has('cloak') && this.defs.cloak.breakOn?.includes('damaged')) this.remove('cloak');
  }

  #burst({ radius, damage }, source, cause) {
    const center = this.owner.movement.state.position;
    bus.emit('status:burst', { id: this.owner.id, cause, center: center.toArray(), radius, source: source?.id });
    if (!this.world) return;
    for (const e of this.world.entitiesInRadius(center, radius)) {
      if (e.team === source?.team || !e.health) continue;
      e.health.damage(damage, { kind: 'status', status: cause }, source);
    }
  }

  remove(id) {
    if (this.active.delete(id)) bus.emit('status:removed', { id: this.owner.id, status: id });
  }

  cleanse() {
    for (const id of [...this.active.keys()]) if (this.defs[id]?.negative && this.defs[id]?.cleansable !== false) this.remove(id);
  }

  update(dt) {
    for (const [id, s] of this.active) {
      const def = this.defs[id];
      s.time += dt;
      if (def.dps) this.owner.health.damage(def.dps * s.stacks * dt, { kind: 'status', status: id }, s.source);
      if (def.hps) this.owner.health.heal?.(def.hps * dt);
      if (def.decayStacksPerSec && s.time > (def.decayDelay ?? 0)) s.stacks -= def.decayStacksPerSec * dt;
      if (s.time >= s.duration || s.stacks <= 0) this.remove(id);
    }
  }
}
