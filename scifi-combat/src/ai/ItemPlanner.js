// ItemPlanner: a bot's support items (data/support.json, combat/SupportItems.js), used with the
// same item key a player presses; and an engineer's repairs, the dig key held at the hull.
//
//  * Medic with stims: a downed teammate within reach gets a stim instead of a kneeling revive
//    (the brain's revive hands over to stimRevive); a teammate in reach below half health gets
//    one; himself below 40% with no enemy within 12 m.
//  * Engineer with packs: one at his feet when he or a squadmate within 12 m is short of ammo (a
//    third of a load), with none of his packs down already and no enemy within 15 m.
//  * Engineer repairs: a friendly vehicle or turret within 25 m below 60% health, nobody shooting
//    at him and no enemy close: he goes to its hull and holds the dig key until it's whole (or
//    the fight comes to him).
//  * Short of ammo with one of our packs within 25 m: walk over (like a supply pod).

import { lowOnAmmo } from '../combat/Stratagems.js';
import { hyp } from '../core/geom.js';

export class ItemPlanner {
  /** @param {object} brain  the CombatBotBrain (its self, world, buttons, aim override, clock) */
  constructor(brain) {
    this.b = brain;
    this.next = 0;          // when to consider an item again
    this.fix = null;        // the vehicle or turret being repaired
  }

  get #sup() { return this.b.world.support; }

  /**
   * A medic beside a downed teammate: a stim if he has one (facing him, the item key), then wait
   * for it to take. True while this owns the command.
   */
  stimRevive(p, d, cmd) {
    const b = this.b, self = b.self, I = self.items, S = this.#sup?.data?.stim;
    if (I?.kind !== 'stim' || !S || d > S.reach * 0.9) return false;
    const pending = this.#sup.stimming(p);
    if (!pending && I.left <= 0) return false;
    const me = self.movement.state.position, pp = p.movement.state.position;
    cmd.yaw = Math.atan2(-(pp.x - me.x), -(pp.z - me.z)); cmd.pitch = -0.5; b.aimYaw = cmd.yaw;
    b.aimOverride = { yaw: cmd.yaw, pitch: -0.5, until: b.time + 0.1 };
    if (!pending && b.time >= this.next) { b.btn.press('item'); this.next = b.time + 0.5; }
    return true;
  }

  /** Each think, after the call-ins: stims for the hurt, a pack for the short. */
  update(ctx) {
    const b = this.b, self = b.self, I = self.items, sup = this.#sup;
    if (!I || I.left <= 0 || !sup?.data || self.vehicle || !self.health.up || b.time < this.next || (self.stratagems && self.stratagems.state !== 'idle')) return;
    this.next = b.time + 0.4 + b.rand() * 0.3;
    const me = self.movement.state.position;
    if (I.kind === 'stim') {
      // A teammate in reach below half health (the nearest), else ourselves when it's quiet.
      const S = sup.data.stim;
      let p = null, bd = S.reach * 0.9;
      b.world.fightersNear(me, S.reach, (f) => {
        if (f === self || f.team !== self.team || f.isVehicle || f.isDeployable || f.vehicle || !f.health?.up || f.health.hp > f.health.max * 0.5 || f.status?.has('stim')) return;
        const d = f.movement.state.position.distanceTo(me);
        if (d < bd) { bd = d; p = f; }
      });
      if (p) {
        const q = p.movement.state.position, yaw = Math.atan2(-(q.x - me.x), -(q.z - me.z));
        b.aimOverride = { yaw, pitch: -0.3, until: b.time + 0.12 };
        b.btn.press('item');
        return;
      }
      if (self.health.hp < self.health.max * 0.4 && !self.status?.has('stim') && !(ctx.target && ctx.los && ctx.dist < 12)) {
        b.aimOverride = { yaw: self.movement.state.yaw + Math.PI, pitch: -1.2, until: b.time + 0.12 };   // nobody in front: it's ours
        b.btn.press('item');
      }
      return;
    }
    if (I.kind === 'ammo') {
      if (ctx.enemiesNear > 0 || (ctx.target && ctx.los && ctx.dist < 15)) return;
      if (sup.packs.some((k) => k.owner === self && k.takers > 0)) return;
      let short = lowOnAmmo(self);
      if (!short) b.world.fightersNear(me, 12, (f) => { if (!short && f !== self && f.team === self.team && f.squad === self.squad && f.health?.up && !f.vehicle && lowOnAmmo(f)) short = true; });
      if (short) b.btn.press('item');
    }
  }

  /**
   * An engineer's repair job: the friendly vehicle or turret to fix, or null. While it returns
   * one, the brain walks to its hull and holds the dig key (SupportItems.repairInput).
   */
  repairJob(ctx) {
    const b = this.b, self = b.self, sup = this.#sup, R = sup?.data?.repair;
    if (!R || !R.roles.includes(self.role) || self.vehicle || !self.health.up) { this.fix = null; return null; }
    if (ctx.underFire || (ctx.target && ctx.los && ctx.dist < 25)) { this.fix = null; return null; }
    const ok = (x) => x && !x.removed && x.team === self.team && x.health && !x.health.dead && x.health.hp < x.health.max;
    if (ok(this.fix)) return this.fix;
    this.fix = null;
    if (b.time < (this.lookFix ?? 0)) return null;
    this.lookFix = b.time + 1.5;
    const me = self.movement.state.position;
    let best = null, bd = 25;
    const consider = (x) => {
      if (!ok(x) || x.health.hp > x.health.max * 0.6) return;
      const q = x.movement.state.position, d = hyp(q.x - me.x, q.z - me.z);
      if (d < bd && !(x.isVehicle && x.seats.some((s) => s.occupant) && hyp(x.movement.state.velocity.x, x.movement.state.velocity.z) > 1)) { bd = d; best = x; }
    };
    for (const v of b.world.vehicles.list) consider(v);
    for (const d of b.world.deployables.list) if (d.kind === 'turret') consider(d);
    return (this.fix = best);
  }

  /** One of our ammo packs within 25 m to fetch from, when short of ammo and not in a close fight. */
  packToFetch(ctx) {
    const b = this.b, self = b.self, sup = this.#sup;
    if (!sup?.packs.length || self.vehicle || !lowOnAmmo(self) || (ctx.target && ctx.los && ctx.dist < 20)) return null;
    return sup.packNear(self, 25);
  }
}
