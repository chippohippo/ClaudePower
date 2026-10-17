// ReviveSystem: getting downed teammates back up, and giving up (data/down.json).
//  * Hold interact within reviveRange of a downed teammate: you kneel (no moving, shooting or
//    casting) for reviveTime, their bleed-out pauses, and they get up with reviveHp of their
//    health. Medics are twice as fast and bring them back healthier. Letting go, going down
//    yourself, or the patient dying cancels it.
//  * Downed soldiers hold jump for giveUpHold to die now and respawn sooner.
//  * Finishers: the same hold beside a downed ENEMY (none of ours to revive there) kneels you over
//    him for finisherTime (1.1 s) and kills him; he keeps bleeding meanwhile, and letting go,
//    going down or his being revived first stops it. Credit and battle points as any finish.
// The session calls handleInput(fighter, cmd, dt) for everyone before vehicles; it returns true
// while the fighter is busy reviving (the session then strips their movement and actions).
// Events: revive:start { id, patient, duration }, revive:cancel, revive:done, revive:giveUp,
// finisher:start { id, victim, duration }, finisher:done { id, victim }, finisher:cancel { id, victim }.

import { bus } from '../core/EventBus.js';

export class ReviveSystem {
  /** @param {CombatWorld} world @param {object} cfg data/down.json */
  constructor(world, cfg = null) {
    this.world = world;
    this.cfg = cfg;
    this.jobs = new Map();       // reviver id -> { patient, t, need, hp }
    this.giveUpT = new Map();    // downed id -> seconds jump has been held
  }

  /** The job a fighter is doing, if any (HUD and animation read this). */
  jobOf(id) { return this.jobs.get(id) ?? null; }
  /** Who is reviving this patient, if anyone. */
  reviverOf(patientId) { for (const [id, j] of this.jobs) if (j.patient.id === patientId) return this.world.entity(id); return null; }

  isMedic(f) { return !!f.role && (this.cfg?.medicRoles ?? []).includes(f.role); }

  /** A downed enemy the fighter could finish right now (nearest in range, not already being finished). */
  victimFor(f) {
    const c = this.cfg, me = f.movement.state.position;
    if (!c) return null;
    let best = null, bd = c.reviveRange;
    this.world.fightersNear(me, c.reviveRange + 1, (e) => {
      if (e.team === f.team || !e.health?.downed || e.health.dead || e.isVehicle || e.isDeployable || e.finishedBy) return;
      const d = e.movement.state.position.distanceTo(me);
      if (d <= bd) { bd = d; best = e; }
    });
    return best;
  }

  /** Downed teammate the fighter could revive right now (nearest in range). */
  patientFor(f) {
    const c = this.cfg, me = f.movement.state.position;
    let best = null, bd = c.reviveRange;
    this.world.fightersNear(me, c.reviveRange + 1, (e) => {
      if (e === f || e.team !== f.team || !e.health?.downed || e.isVehicle) return;
      const d = e.movement.state.position.distanceTo(me);
      if (d <= bd) { bd = d; best = e; }
    });
    return best;
  }

  /** @returns {boolean} true while the fighter is reviving (it owns this tick's command) */
  handleInput(f, cmd, dt) {
    const c = this.cfg;
    if (!c || f.isVehicle) return false;
    const h = f.health;
    // Downed: hold jump to give up.
    if (h.downed) {
      this.#cancel(f.id, 'downed');
      if (cmd.buttons?.jump?.down) {
        const t = (this.giveUpT.get(f.id) ?? 0) + dt;
        this.giveUpT.set(f.id, t);
        if (t >= c.giveUpHold) { this.giveUpT.delete(f.id); bus.emit('revive:giveUp', { id: f.id }); h.giveUp(); }
      } else this.giveUpT.delete(f.id);
      return false;
    }
    this.giveUpT.delete(f.id);
    const hold = !!cmd.buttons?.interact?.down;
    let job = this.jobs.get(f.id);
    if (!hold || h.dead || f.vehicle || f.movement.state.mode === 'ragdoll' || f.movement.state.mode === 'knockdown') { this.#cancel(f.id, 'released'); return false; }
    if (!job) {
      const p = this.patientFor(f);
      if (!p) return this.#finisher(f, dt);
      const medic = this.isMedic(f);
      job = { patient: p, t: 0, need: (medic ? c.medicReviveTime : c.reviveTime) / (f.perks?.reviveRate ?? 1), hp: medic ? c.medicReviveHp : c.reviveHp };   // Triage: faster still
      this.jobs.set(f.id, job);
      f.reviveJob = job;                 // the rig kneels the reviver over the patient
      p.health.reviving++;
      bus.emit('revive:start', { id: f.id, patient: p.id, duration: job.need });
    }
    const p = job.patient;
    if (!p.health.downed || p.movement.state.position.distanceTo(f.movement.state.position) > c.reviveRange + 0.5) { this.#cancel(f.id, 'lost'); return false; }
    job.t += dt;
    if (job.t >= job.need) {
      this.jobs.delete(f.id); f.reviveJob = null;
      p.health.reviving = Math.max(0, p.health.reviving - 1);
      p.health.reviveFromDown(job.hp, f);
      bus.emit('revive:done', { id: f.id, patient: p.id });
      return false;
    }
    return true;
  }

  /** Holding interact over a downed enemy: kneel and finish him. True while at it. */
  #finisher(f, dt) {
    const c = this.cfg;
    let job = this.finishing?.get(f.id);
    if (!job) {
      const v = this.victimFor(f);
      if (!v) return false;
      job = { victim: v, t: 0, need: c.finisherTime ?? 1.1, finish: true };
      (this.finishing ??= new Map()).set(f.id, job);
      v.finishedBy = f.id;
      f.reviveJob = { patient: v, t: 0, need: job.need, finish: true };       // the rig kneels him over the victim
      bus.emit('finisher:start', { id: f.id, victim: v.id, duration: job.need });
    }
    const v = job.victim;
    if (!v.health.downed || v.health.dead || v.movement.state.position.distanceTo(f.movement.state.position) > c.reviveRange + 0.6) { this.#endFinisher(f, 'lost'); return false; }
    job.t += dt;
    // (the kneel can be cleared under us: a respawn, a revive finishing; put it back)
    f.reviveJob ??= { patient: v, t: 0, need: job.need, finish: true };
    f.reviveJob.t = job.t;
    if (job.t < job.need) return true;
    this.#endFinisher(f, null);
    v.health.damage(v.health.downHp + 1, { kind: 'finisher', melee: true, noDown: true }, f);
    bus.emit('finisher:done', { id: f.id, victim: v.id });
    return false;
  }

  #endFinisher(f, why) {
    const job = this.finishing?.get(f.id);
    if (!job) return;
    this.finishing.delete(f.id);
    if (job.victim.finishedBy === f.id) job.victim.finishedBy = null;
    f.reviveJob = null;
    if (why) bus.emit('finisher:cancel', { id: f.id, victim: job.victim.id, why });
  }

  #cancel(id, why) {
    const f0 = this.finishing?.has(id) ? this.world.entity(id) : null;
    if (f0) this.#endFinisher(f0, why);
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.delete(id);
    const f = this.world.entity(id);
    if (f) f.reviveJob = null;
    job.patient.health.reviving = Math.max(0, job.patient.health.reviving - 1);
    bus.emit('revive:cancel', { id, patient: job.patient.id, why });
  }
}
