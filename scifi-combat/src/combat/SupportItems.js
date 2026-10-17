// SupportItems: what the support roles carry (data/support.json, docs/GAMEPLAY_PLAN.md §5). Sim
// only, one per world (world.support). The item key (3) uses them; bots press the same key.
//
//  * Stims (medics, 3): the teammate you face within reach (else yourself, if you're hurt) heals
//    60 HP over 2 s. A downed teammate is back on his feet a second later with 60% of his health,
//    and his bleeding stops meanwhile; the medic doesn't kneel, he keeps fighting.
//  * Ammo packs (engineers, 2): dropped at your feet; teammates short of at least a mag take two
//    each as they pass, four of them, for a minute.
//  * Repairs (engineers): hold the dig key beside a damaged friendly vehicle or turret: 50 HP a
//    second, kneeling at the job like digging in (it owns the tick).
//  * Supply pods, depots and redeploying refill them.
// Events: support:stim { id, patient, revive }, support:heal { id, patient, amount },
// support:pack { pack, owner, team, at }, support:ammo { id, taker, mags, pack },
// support:packGone { pack }, support:repair { id, target, amount } (a second's worth at a time),
// support:empty { id } (the key pressed with nothing left).

import { Vector3 } from 'three';
import { bus } from '../core/EventBus.js';

let nextPackId = 1;

export class SupportItems {
  /** @param {object} world CombatWorld @param {object} data data/support.json */
  constructor(world, data = null) {
    this.world = world; this.data = data;
    this.packs = [];          // ammo packs on the ground
    this.stims = [];          // downed teammates getting up on a stim: { patient, by, t }
    this.time = 0;
  }

  /** A soldier's items by his role (most roles carry none). */
  equip(e) {
    const it = this.data?.items?.[e.role];
    e.items = it ? { kind: it.kind, left: it.count, max: it.count, ready: 0 } : null;
  }

  /** Back to a full load (supply pods, depots, redeploying). True if anything was missing. */
  refill(e) {
    if (!e.items || e.items.left >= e.items.max) return false;
    e.items.left = e.items.max;
    return true;
  }

  /** The item key, after the call-in has had its say (typing a code takes the hands). True if used. */
  itemInput(e, cmd) {
    const I = e.items;
    if (!I || !cmd.buttons?.item?.pressed || !e.health.up || e.vehicle || e.transform || this.time < I.ready) return false;
    if (I.left <= 0) { bus.emit('support:empty', { id: e.id }); return false; }
    const ok = I.kind === 'stim' ? this.#stim(e, cmd.yaw) : I.kind === 'ammo' ? this.#drop(e) : false;
    if (ok) { I.left--; I.ready = this.time + (this.data[I.kind]?.cooldown ?? 1); }
    return ok;
  }

  /** Is a stim already getting this soldier up? */
  stimming(patient) { return this.stims.some((s) => s.patient === patient); }

  /** The teammate a stim would go to: the nearest in reach and in front (downed or hurt), else null. */
  stimTarget(e, yaw) {
    const S = this.data.stim, me = e.movement.state.position, half = (S.cone * Math.PI) / 360;
    let best = null, bd = S.reach;
    this.world.fightersNear(me, S.reach + 1, (f) => {
      if (f === e || f.team !== e.team || f.isVehicle || f.isDeployable || !f.health || f.health.dead || f.vehicle) return;
      if (!(f.health.downed ? !this.stimming(f) : f.health.hp < f.health.max)) return;
      const q = f.movement.state.position, d = Math.hypot(q.x - me.x, q.z - me.z);
      if (d > bd) return;
      let off = Math.atan2(-(q.x - me.x), -(q.z - me.z)) - yaw;
      off = Math.atan2(Math.sin(off), Math.cos(off));
      if (Math.abs(off) <= half || d < 0.8) { bd = d; best = f; }
    });
    return best;
  }

  #stim(e, yaw) {
    const S = this.data.stim, h = e.health;
    const p = this.stimTarget(e, yaw) ?? (h.hp < h.max ? e : null);
    if (!p) return false;
    if (p.health.downed) {
      this.stims.push({ patient: p, by: e, t: S.reviveTime });
      p.health.reviving++;                       // no bleeding while the stim takes
      bus.emit('support:stim', { id: e.id, patient: p.id, revive: true });
      return true;
    }
    const amount = Math.min(S.heal, p.health.max - p.health.hp);
    p.status?.apply('stim', { duration: S.over, source: e });
    bus.emit('support:stim', { id: e.id, patient: p.id, revive: false });
    if (p !== e) bus.emit('support:heal', { id: e.id, patient: p.id, amount: Math.round(amount) });
    return true;
  }

  #drop(e) {
    const A = this.data.ammo, p = e.movement.state.position;
    const pack = { id: nextPackId++, owner: e, team: e.team, pos: new Vector3(p.x, p.y, p.z), takers: A.takers, age: 0, took: new Set() };
    this.packs.push(pack);
    bus.emit('support:pack', { pack: pack.id, owner: e.id, team: e.team, at: pack.pos.toArray() });
    return true;
  }

  /**
   * An engineer holding the dig key beside a damaged friendly vehicle or turret repairs it.
   * Returns true while he's at it (the session kneels him: no moving, shooting or casting).
   */
  repairInput(e, cmd, dt) {
    const R = this.data?.repair;
    if (!R || !cmd.buttons?.dig?.down || !R.roles.includes(e.role) || !e.health.up || e.vehicle) { e.repairing = null; return false; }
    const t = this.repairTarget(e);
    if (!t) { e.repairing = null; return false; }
    const h = t.health, add = Math.min(h.max - h.hp, R.rate * dt);
    h.hp += add;
    const job = e.repairing?.target === t ? e.repairing : (e.repairing = { target: t, acc: 0, t: 0 });
    job.acc += add; job.t += dt;
    if (job.t >= 1 || h.hp >= h.max) {
      if (job.acc >= 1) bus.emit('support:repair', { id: e.id, target: t.id, amount: Math.round(job.acc) });
      job.acc = 0; job.t = 0;
    }
    return true;
  }

  /** The damaged friendly vehicle or turret within an engineer's reach (its hull, not its middle), or null. */
  repairTarget(e) {
    const R = this.data?.repair, me = e.movement.state.position;
    if (!R) return null;
    let best = null, bd = R.reach;
    const look = (x, r) => {
      if (x.removed || x.team !== e.team || !x.health || x.health.dead || x.health.hp >= x.health.max) return;
      const q = x.movement.state.position, d = Math.hypot(q.x - me.x, q.z - me.z) - r;
      if (d <= bd && Math.abs(q.y - me.y) < 3) { bd = d; best = x; }
    };
    for (const v of this.world.vehicles?.list ?? []) look(v, v.def.radius ?? 1.5);
    for (const d of this.world.deployables?.list ?? []) if (d.kind === 'turret') look(d, 0.6);
    return best;
  }

  update(dt) {
    this.time += dt;
    // Stims getting the downed up.
    for (let i = this.stims.length - 1; i >= 0; i--) {
      const s = this.stims[i], h = s.patient.health;
      if (!h.downed || h.dead) { this.stims.splice(i, 1); h.reviving = Math.max(0, h.reviving - 1); continue; }
      if ((s.t -= dt) > 0) continue;
      this.stims.splice(i, 1);
      h.reviving = Math.max(0, h.reviving - 1);
      h.reviveFromDown(this.data.stim.reviveHp, s.by);
    }
    // Ammo packs: teammates short of a mag help themselves as they pass.
    const A = this.data?.ammo;
    for (let i = this.packs.length - 1; i >= 0; i--) {
      const k = this.packs[i];
      k.age += dt;
      if (k.takers > 0 && k.age < A.life) {
        this.world.fightersNear(k.pos, A.reach + 0.5, (f) => {
          if (k.takers <= 0 || f.team !== k.team || f.isVehicle || f.isDeployable || f.vehicle || !f.health?.up || k.took.has(f.id)) return;
          const q = f.movement.state.position;
          if (Math.hypot(q.x - k.pos.x, q.z - k.pos.z) > A.reach || Math.abs(q.y - k.pos.y) > 1.5 || (f.weapons?.missing?.() ?? 0) < 1) return;
          const got = f.weapons.resupply(A.mags);
          if (!(got > 0)) return;
          k.takers--; k.took.add(f.id);
          bus.emit('support:ammo', { id: k.owner.id, taker: f.id, mags: Math.round(got), pack: k.id });
        });
      }
      if (k.takers <= 0 || k.age >= A.life) { this.packs.splice(i, 1); bus.emit('support:packGone', { pack: k.id }); }
    }
  }

  /** The nearest of our ammo packs within `r` m with takers left that this soldier hasn't taken from (bots fetch from it). */
  packNear(e, r) {
    const me = e.movement.state.position;
    let best = null, bd = r;
    for (const k of this.packs) {
      if (k.team !== e.team || k.takers <= 0 || k.took.has(e.id)) continue;
      const d = Math.hypot(k.pos.x - me.x, k.pos.z - me.z);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }
}
