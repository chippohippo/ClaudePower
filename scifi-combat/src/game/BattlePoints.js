// BattlePoints: points for what helps the team, spent mid-match on bigger toys
// (docs/GAMEPLAY_PLAN.md §5, data/battle-points.json). Sim only, one per world (world.bp).
//
//  * Earned from what the sim already reports: downs and kills (an assist for everyone else on
//    the other side who hurt him in the last few seconds, a spot for whoever revealed him),
//    finishing the downed, enemy vehicles and deployables destroyed, revives, mags shared from a
//    supply pod or an ammo pack, heals and repairs, digging in, points captured and defended,
//    supplies delivered. Downing or killing your own side costs you.
//  * Kills made with something you own (a sentry, a vehicle you drive, a shell you called in)
//    are yours.
//  * Spent by StratagemComponent: an extra use of a call-in that's cooling down, a vehicle drop,
//    the hero (your super, charged now). Each soldier's points are his own; bots earn and spend
//    them the same way.
//  * Dying keeps half of what you hadn't spent: staying alive with your squad compounds.
// Events: bp:earn { id, why, amount, points }, bp:spend { id, what, amount, points },
// bp:death { id, lost, points }.

import { bus } from '../core/EventBus.js';

export class BattlePoints {
  /**
   * @param {object} world  CombatWorld
   * @param {object} data   data/battle-points.json
   * @param {object} o      { mode: FrontlineMode (points to capture and defend) }
   */
  constructor(world, data, { mode = null } = {}) {
    this.world = world; this.data = data ?? {}; this.mode = mode;
    this.E = this.data.earn ?? {};
    this.defendT = 0;
    this.off = [
      bus.on('entity:downed', (e) => { const v = this.world.entity(e.id); if (v) this.#takedown(v, this.#who(e.by)); }),
      bus.on('entity:death', (e) => this.#death(e)),
      bus.on('entity:revived', (e) => { if (e.fromDown && e.by != null && e.by !== e.id) this.#forMate(e.by, e.id, 'revive'); }),
      bus.on('stratagem:grab', (e) => { if (e.owner != null && e.owner !== e.id) this.#forMate(e.owner, e.id, 'resupply', e.mags); }),
      bus.on('support:ammo', (e) => this.#forMate(e.id, e.taker, 'resupply', e.mags)),
      bus.on('support:heal', (e) => this.#forMate(e.id, e.patient, 'heal', e.amount)),
      bus.on('support:repair', (e) => this.earn(this.#who(e.id), 'repair', Math.round((this.E.repair ?? 0) * e.amount))),
      bus.on('fort:built', (e) => { if (e.by != null) this.earn(this.#who(e.by), 'build'); }),
      bus.on('mode:point', (e) => this.#flip(e)),
      bus.on('logistics:unload', (e) => this.#delivered(e)),
    ];
  }

  dispose() { this.off.forEach((f) => f()); }

  /** A soldier's points (unspent). */
  points(e) { return e?.bp?.points ?? 0; }
  #of(e) { return (e.bp ??= { points: this.data.start ?? 0, total: 0 }); }

  /** Award (or take, for a negative amount) points for `why`; the amount defaults to its price in data. */
  earn(e, why, amount = this.E[why] ?? 0) {
    if (!e || !amount || e.isVehicle || e.isDeployable) return;
    const bp = this.#of(e);
    bp.points = Math.max(0, bp.points + amount);
    if (amount > 0) bp.total += amount;
    bus.emit('bp:earn', { id: e.id, why, amount, points: bp.points });
  }

  /** Pay for something: true if the soldier had the points (and they're spent). */
  spend(e, amount, what) {
    if (!e) return false;
    const bp = this.#of(e);
    if (bp.points < amount) return false;
    bp.points -= amount;
    bus.emit('bp:spend', { id: e.id, what, amount, points: bp.points });
    return true;
  }

  /** Each second: points for everyone holding their team's point while the enemy contests it. */
  update(dt) {
    const pts = this.mode?.points;
    if (!pts || !(this.E.defend > 0) || (this.defendT += dt) < 1) return;
    this.defendT -= 1;
    for (const p of pts) {
      if (!p.contested || p.owner < 0) continue;
      this.#onPoint(p, p.owner, (e) => this.earn(e, 'defend'));
    }
  }

  // ---------------------------------------------------------------- credit
  /** The soldier credited for what an id did: the soldier, the owner of a deployable, a vehicle's driver. */
  #who(id) {
    if (id == null) return null;
    const e = this.world.entity(id);
    if (!e) return null;
    if (e.isDeployable) return e.owner ?? this.world.entity(e.ownerId) ?? null;
    if (e.isVehicle) return e.seats.find((s) => s.def.role === 'driver' && s.occupant)?.occupant ?? e.seats.find((s) => s.occupant)?.occupant ?? null;
    return e;
  }

  /** Something done for a teammate (a revive, mags, a heal): `why` x n for the giver. */
  #forMate(fromId, toId, why, n = 1) {
    const giver = this.#who(fromId), taker = this.world.entity(toId);
    if (!giver || !taker || giver === taker || giver.team !== taker.team) return;
    this.earn(giver, why, Math.round((this.E[why] ?? 0) * n));
  }

  /** Taken out of the fight (downed, or killed outright): the kill, the assists, the spot. */
  #takedown(victim, killer) {
    const enemy = (a) => a && a.team !== victim.team;
    if (victim.isVehicle || victim.isDeployable) { if (enemy(killer)) this.earn(killer, victim.isVehicle ? 'vehicle' : 'object'); return; }
    if (killer && killer !== victim) this.earn(killer, killer.team === victim.team ? 'teamkill' : 'kill');
    const h = victim.health, W = this.data.assistWindow ?? 10;
    if (h.recent?.size) {
      const paid = new Set([killer]);
      for (const [id, t] of h.recent) {
        const a = h.clock - t <= W ? this.#who(id) : null;
        if (!enemy(a) || paid.has(a)) continue;
        paid.add(a);
        this.earn(a, 'assist');
      }
      h.recent.clear();
    }
    // Whoever revealed him, if someone else got him.
    const src = victim.status?.active?.get('revealed')?.source;
    const spotter = src?.isDeployable ? src.owner : src;
    if (enemy(spotter) && spotter !== killer) this.earn(spotter, 'spot');
  }

  #death(e) {
    const victim = this.world.entity(e.id);
    if (!victim) return;
    const killer = this.#who(e.by);
    // A soldier who was down was already paid for; finishing him earns a little.
    if (!e.wasDowned) this.#takedown(victim, killer);
    else if (e.how === 'finished' && killer && killer.team !== victim.team) this.earn(killer, 'finish');
    if (victim.bp && !victim.isVehicle && !victim.isDeployable) {
      const keep = Math.floor(victim.bp.points * (this.data.deathKeeps ?? 0.5)), lost = victim.bp.points - keep;
      victim.bp.points = keep;
      if (lost > 0) bus.emit('bp:death', { id: victim.id, lost, points: keep });
    }
  }

  // ---------------------------------------------------------------- the objective
  /** A point changed hands: everyone of the side that took it (or knocked it neutral) standing on it. */
  #flip(e) {
    const p = this.mode?.points?.[e.point];
    if (!p) return;
    if (e.owner >= 0) this.#onPoint(p, e.owner, (f) => this.earn(f, 'capture'));
    else if (e.from >= 0) this.#onPoint(p, 1 - e.from, (f) => this.earn(f, 'neutralize'));
  }

  /** Soldiers of `team` up and on the point (as FrontlineMode counts them). */
  #onPoint(p, team, fn) {
    const on = [];
    this.world.fightersNear(p.pos, p.radius, (f) => {
      if (f.team !== team || f.isVehicle || f.isDeployable || !f.health?.up || (f.vehicle && !f.vehicle.exposed)) return;
      const q = f.movement.state.position;
      if (Math.abs(q.y - p.pos.y) <= 4 && Math.hypot(q.x - p.pos.x, q.z - p.pos.z) <= p.radius) on.push(f);
    });
    on.forEach(fn);
  }

  /** A truck emptied at a depot: its driver, per truckload. */
  #delivered(e) {
    const v = this.world.vehicles?.list.find((x) => x.id === e.truck);
    const driver = v?.seats.find((s) => s.def.role === 'driver')?.occupant;
    if (driver && v.def.cargo) this.earn(driver, 'deliver', Math.round((this.E.deliver ?? 0) * (e.amount / v.def.cargo)));
  }
}
