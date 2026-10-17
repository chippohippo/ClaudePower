// Passives: every class's passive (data/classes/*.json `passive.id`, the numbers in
// data/passives.json, docs/GAMEPLAY_PLAN.md §5). Sim only, one per world (world.passives).
// Bots carry the same passives: they come with the class.
//
//  * attach(soldier, id) gives him his passive: `e.passive` (the id) and `e.perks`, the modifiers
//    the systems read where they apply:
//      enterTime     VehicleSystem: boarding takes this share of the time (ace, drift)
//      handling      VehicleSystem: steering and grip (ace)
//      ventRate      the guns: heat bleeds off and vents this much faster (overcharge)
//      selfBlast     blasts: your own hurt you this share of what they would (blast_proof, rift_proof)
//      knockback     blasts and abilities: how far they throw you while you're up (mass: not at all)
//      slowDecay     statuses: Slow wears off this many times faster (mass)
//      pullImmune    pulls (zones, abilities) don't drag you (rift_proof)
//      reviveRate    ReviveSystem: you revive this many times faster (triage)
//      flinchShield  a hit doesn't flinch you or your aim while your shield is above this share (unshakable)
//      backstab      the sword from behind: { mul, status, duration } (ghoststep, from_nowhere)
//      silent        no footsteps while crouched, or while sprinting (ghoststep, from_nowhere)
//  * The rest answer the sim's events, or tick in update():
//      momentum      your takedowns: +25 stamina and Momentum (+10% speed) for 3 s
//      salvage       tech destroyed within 12 m (any vehicle or deployable): a mag from the wreck
//      triage        3 HP a second to your squad within 10 m
//      spotter       aim down sights at an enemy for 0.4 s and he's revealed for 5 s (the spot
//                    assist is yours if someone else takes him down)
//      radiant_guard a perfect parry heals you 10
//      hunger        your hits on Weakened enemies give back 5 leech armor (at most every 0.2 s)
//      scavenger     an enemy deployable you destroy takes 30% off your ability cooldowns
//      leech_link    20% of your damage to enemies heals the most hurt teammate within 20 m
//      patient_eye   each second down your sights without firing: +10% gun damage, at most 30%;
//                    the next shot spends it
//      black_flame   sword hits build Volatile (10 a hit; 30 sets it), perfect blocks give back
//                    10 leech armor
//      drift         getting out of a vehicle: Phased for 1 s
//      mindread      aim at an enemy for 0.5 s and his ability cooldowns are yours to read
//                    (e.mindread { id, until }: the HUD shows them)
// Events: passive:proc { id, passive, ... } (HUD and audio).

import { Vector3 } from 'three';
import { bus } from '../core/EventBus.js';

const _o = new Vector3(), _d = new Vector3();

export class PassiveSystem {
  /** @param {object} world CombatWorld @param {object} data data/passives.json */
  constructor(world, data = null) {
    this.world = world;
    this.defs = data?.passives ?? {};
    this.byId = new Map();     // soldier id -> soldier, for those whose passive answers hits
    this.list = [];            // soldiers whose passive ticks
    this.time = 0; this.auraT = 0;
    this.off = [
      bus.on('entity:downed', (e) => this.#takedown(e.by, e.id)),
      bus.on('entity:death', (e) => { this.#tech(e); if (!e.wasDowned) this.#takedown(e.by, e.id); }),
      bus.on('weapon:hit', (e) => this.#hit(e.attacker, e.victim, e.damage, false)),
      bus.on('melee:hit', (e) => this.#hit(e.attacker, e.defender, e.damage, true)),
      bus.on('melee:parry', (e) => this.#guard(e.defender, 'parry')),
      bus.on('melee:perfectBlock', (e) => this.#guard(e.defender, 'perfectBlock')),
      bus.on('vehicle:exit', (e) => this.#exit(e.entity)),
    ];
  }

  dispose() { this.off.forEach((f) => f()); }

  /** Give a soldier his class's passive (null: none). */
  attach(e, id) {
    const def = this.defs[id] ?? null;
    e.passive = def ? id : null;
    e.perks = { ...(def?.mods ?? {}) };
    if (!def) return null;
    this.byId.set(e.id, e);
    if (def.aura || def.aim || def.eye || def.read) this.list.push(e);
    return def;
  }

  update(dt) {
    this.time += dt;
    const pulse = (this.auraT += dt) >= 1;
    if (pulse) this.auraT -= 1;
    for (const e of this.list) {
      const D = this.defs[e.passive];
      if (!e.health.up || e.vehicle) { e.aimT = 0; if (D.eye) { e.eyeT = 0; e.weapons.passiveMul = 1; } continue; }
      if (D.aura && pulse) this.#aura(e, D.aura);
      if (D.eye) this.#eye(e, D.eye, dt);
      if (D.aim || D.read) this.#aim(e, D.aim ?? D.read, dt, !!D.aim);
    }
  }

  // ---------------------------------------------------------------- events
  /** The soldier credited for what an id did: the soldier, a deployable's owner, a vehicle's driver. */
  #who(id) {
    if (id == null) return null;
    const e = this.byId.get(id) ?? this.world.entity(id);
    if (e?.isDeployable) return e.owner ?? null;
    if (e?.isVehicle) return e.seats.find((s) => s.def.role === 'driver' && s.occupant)?.occupant ?? null;
    return e ?? null;
  }

  /** Momentum: a takedown of an enemy tops up stamina and gives a burst of speed. */
  #takedown(byId, victimId) {
    const e = this.#who(byId);
    if (e?.passive !== 'momentum' || !e.health.up) return;
    const v = this.world.entity(victimId);
    if (!v || v.team === e.team || v.isVehicle || v.isDeployable) return;
    const T = this.defs.momentum.takedown, s = e.movement.state;
    s.stamina = Math.min(e.movement.t?.stamina?.max ?? 100, s.stamina + T.stamina);
    s.exhausted = false;
    e.status?.apply(T.status, { source: e });
    bus.emit('passive:proc', { id: e.id, passive: 'momentum' });
  }

  /** A vehicle or deployable destroyed: salvage for those near, a refund for the scavenger who did it. */
  #tech(ev) {
    const x = this.world.entity(ev.id);
    if (!x || !(x.isVehicle || x.isDeployable)) return;
    const p = x.movement?.state.position;
    const S = this.defs.salvage?.tech;
    if (S && p) {
      this.world.fightersNear(p, S.radius, (f) => {
        if (f.passive !== 'salvage' || !f.health?.up || f.vehicle || f.movement.state.position.distanceTo(p) > S.radius) return;
        const got = f.weapons?.resupply?.(S.mags) ?? 0;
        if (got > 0) bus.emit('passive:proc', { id: f.id, passive: 'salvage', mags: got });
      });
    }
    const by = this.#who(ev.by);
    if (x.isDeployable && by?.passive === 'scavenger' && by.team !== x.team) {
      const k = this.defs.scavenger.refund.share;
      for (const s of Object.values(by.abilities?.slots ?? {})) if (s.cooldown > 0) s.cooldown = Math.max(0, s.cooldown - k * (s.stats?.cooldown ?? s.cooldown));
      bus.emit('passive:proc', { id: by.id, passive: 'scavenger' });
    }
  }

  /** Hits: hunger, leech link, black flame. */
  #hit(aId, vId, dmg, sword) {
    const a = this.byId.get(aId);
    if (!a || !(dmg > 0)) return;
    const P = a.passive;
    if (P !== 'hunger' && P !== 'leech_link' && !(P === 'black_flame' && sword)) return;
    const v = this.world.entity(vId);
    if (!v || v.team === a.team || v.isVehicle || v.isDeployable) return;
    if (P === 'hunger') {
      const H = this.defs.hunger.weakened, h = a.health;
      if (!v.status?.has('weaken') || this.time < (a.hungerAt ?? 0) || !h.up || h.shield >= h.maxShield) return;
      a.hungerAt = this.time + H.every;
      h.shield = Math.min(h.maxShield, h.shield + H.armor);
      bus.emit('passive:proc', { id: a.id, passive: 'hunger' });
    } else if (P === 'leech_link') {
      const L = this.defs.leech_link.link, me = a.movement.state.position;
      let best = null, low = 1;
      this.world.fightersNear(me, L.radius, (f) => {
        if (f === a || f.team !== a.team || f.isVehicle || f.isDeployable || !f.health?.up || f.movement.state.position.distanceTo(me) > L.radius) return;
        const k = f.health.hp / f.health.max;
        if (k < low) { low = k; best = f; }
      });
      if (best) { best.health.heal(dmg * L.share); bus.emit('passive:proc', { id: a.id, passive: 'leech_link', target: best.id }); }
    } else {
      const B = this.defs.black_flame.sword;
      v.status?.apply(B.status, { stacks: B.stacks, source: a });
    }
  }

  /** Radiant guard: a perfect parry heals. Black flame: a perfect block gives leech armor back. */
  #guard(id, kind) {
    const e = this.byId.get(id);
    if (!e?.health.up) return;
    if (kind === 'parry' && e.passive === 'radiant_guard') { e.health.heal(this.defs.radiant_guard.parry.heal); bus.emit('passive:proc', { id, passive: e.passive }); }
    if (kind === 'perfectBlock' && e.passive === 'black_flame') {
      const h = e.health;
      h.shield = Math.min(h.maxShield, h.shield + this.defs.black_flame.perfectBlock.armor);
      bus.emit('passive:proc', { id, passive: e.passive });
    }
  }

  /** Drift: out of a vehicle, Phased for a moment. */
  #exit(id) {
    const e = this.byId.get(id) ?? this.world.entity(id);
    if (e?.passive !== 'drift' || e.health.dead) return;
    const X = this.defs.drift.exit;
    e.status?.apply(X.status, { duration: X.duration, source: e });
    bus.emit('passive:proc', { id, passive: 'drift' });
  }

  // ---------------------------------------------------------------- ticking
  /** Triage: heal the squad (or, without one, teammates) within reach, a second's worth at a time. */
  #aura(e, A) {
    const me = e.movement.state.position;
    let healed = 0;
    this.world.fightersNear(me, A.radius, (f) => {
      if (f.team !== e.team || f.isVehicle || f.isDeployable || !f.health?.up || f.health.hp >= f.health.max) return;
      if (A.squad && e.squad && f.squad !== e.squad && f !== e) return;
      if (f.movement.state.position.distanceTo(me) > A.radius) return;
      f.health.heal(A.hps); healed++;
    });
    if (healed) bus.emit('passive:proc', { id: e.id, passive: 'triage', healed });
  }

  /** Patient eye: damage builds while you hold your sights on without firing; the next shot spends it. */
  #eye(e, E, dt) {
    const w = e.weapons;
    if (!w) return;
    if (w.shotIndex !== e.eyeShot) { e.eyeShot = w.shotIndex; e.eyeT = 0; }
    e.eyeT = e.mode === 'gun' && w.ads > 0.9 ? (e.eyeT ?? 0) + dt : 0;
    w.passiveMul = 1 + Math.min(E.max, Math.floor(e.eyeT / E.every) * E.per);
  }

  /**
   * Spotter and mindread: the enemy you've held your sights on (the nearest to the gun's aim
   * within the cone and range, in sight) for long enough. Searched five times a second.
   */
  #aim(e, A, dt, spot) {
    const w = e.weapons;
    if (!w || e.mode !== 'gun' || w.ads < 0.9) { e.aimT = 0; e.aimAt = null; return; }
    if (this.time >= (e.aimScan ?? 0)) {
      e.aimScan = this.time + 0.2;
      const t = this.#inSights(e, A);
      if (t !== e.aimAt) { e.aimAt = t; e.aimT = 0; }
    }
    if (!e.aimAt) return;
    e.aimT += dt;
    if (e.aimT < A.hold) return;
    if (spot) {
      if (this.time < (e.spotNext ?? 0)) return;
      e.spotNext = this.time + A.every;
      e.aimAt.status?.apply('revealed', { duration: A.reveal, source: e });
      bus.emit('passive:proc', { id: e.id, passive: 'spotter', target: e.aimAt.id });
    } else e.mindread = { id: e.aimAt.id, until: this.time + 3 };
  }

  #inSights(e, A) {
    const w = e.weapons, s = e.movement.state, me = s.position;
    const cp = Math.cos(w.aimPitch), dx = -Math.sin(w.aimYaw) * cp, dy = Math.sin(w.aimPitch), dz = -Math.cos(w.aimYaw) * cp;
    const cone = Math.cos((A.cone * Math.PI) / 180);
    _o.set(me.x, me.y + 1.5, me.z);
    let best = null, bestDot = cone;
    this.world.fightersNear(me, A.range, (f) => {
      if (f.team === e.team || f.isDeployable || !f.health || f.health.dead) return;
      const q = f.movement.state.position;
      _d.set(q.x - _o.x, q.y + 1.1 - _o.y, q.z - _o.z);
      const L = _d.length();
      if (L > A.range || L < 1) return;
      const dot = (_d.x * dx + _d.y * dy + _d.z * dz) / L;
      if (dot > bestDot) { bestDot = dot; best = f; }
    });
    if (!best) return null;
    const q = best.movement.state.position;
    _d.set(q.x - _o.x, q.y + 1.1 - _o.y, q.z - _o.z);
    const L = _d.length();
    return (this.world.sight ?? this.world.raycastStatic)?.call(this.world, _o, _d.divideScalar(L), L - 0.5) ? null : best;
  }
}
