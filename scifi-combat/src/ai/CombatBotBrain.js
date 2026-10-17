// CombatBotBrain: a full-kit bot. Produces the same Command a player's InputManager does, so it
// moves, shoots, fights with the sword, casts abilities and drives vehicles through the exact same
// systems (and is bound by the same cooldowns, cast times, recoil and counterplay).
//
// Layers, re-evaluated every `decisionInterval` (difficulty):
//   Perception  - nearest enemy (vehicles included), line of sight, cloak, incoming damage
//   Vehicles    - VehiclePilot: board a friendly vehicle, then drive/gun/bail
//   Abilities   - AbilityPlanner: data-driven utility; reacts to enemy casts with interrupts
//   Weapon      - range-band positioning, strafing, aim with error and reaction time, recoil
//                 compensation, burst control, reloads, venting, ADS, gun swaps
//   Sword       - MeleeDuelistBrain for close fights (parry/feint/guard-break reading)
//   Safety      - steps out of telegraphed zones and line casts, retreats at low HP
//   Objective   - frontline orders (FrontlineCommander): follow the flow field to the point,
//                 fight on the way, spread over the point and hold it
//   Downs       - downed: crawl toward help, lie still while being revived, give up when alone;
//                 up: revive downed teammates nearby (medics go further), one reviver per patient
//
// Tells (fairness): bots react after `reactionTime`, aim with wandering error, and their casts
// go through the same telegraphs as yours.

import { Vector3 } from 'three';
import { bus } from '../core/EventBus.js';
import { emptyCommand } from '../input/InputManager.js';
import { rng } from '../combat/weapons/WeaponSystem.js';
import { angleDelta } from '../core/geom.js';
import { MeleeDuelistBrain } from './MeleeDuelistBrain.js';
import { profileAbility, scoreAbility, aimAbility, abilityReach } from './AbilityPlanner.js';
import { VehiclePilot } from './VehiclePilot.js';

const SLOTS = ['ability1', 'ability2', 'grenade', 'super'];
const _a = new Vector3();
const _b = new Vector3();
const _d = new Vector3();

/** Edge-correct button state: press() always produces a clean pressed edge, even on held keys. */
class Buttons {
  constructor() { this.prev = new Set(); this.down = new Set(); this.queued = new Set(); }
  hold(k) { this.down.add(k); }
  press(k) { this.queued.add(k); }
  pressIfReady(k, wc) { if (wc && wc.cooldown <= 0 && wc.phase === 'ready') this.press(k); }
  finalize(cmd) {
    const carry = new Set();
    for (const k of this.queued) { if (this.prev.has(k) && !this.down.has(k)) carry.add(k); else this.down.add(k); }
    for (const k of new Set([...this.down, ...this.prev])) {
      cmd.buttons[k] = { down: this.down.has(k), pressed: this.down.has(k) && !this.prev.has(k), released: !this.down.has(k) && this.prev.has(k) };
    }
    this.prev = this.down; this.down = new Set(); this.queued = carry;
  }
}

export class CombatBotBrain {
  /**
   * @param {object} self        fighter entity
   * @param {object} world       CombatWorld
   * @param {object} persona     data/ai/personalities.json entry
   * @param {object} difficulty  data/ai/personalities.json difficulty entry
   */
  constructor(self, world, persona, difficulty, { seed = 1 } = {}) {
    this.self = self; this.world = world; this.persona = persona; this.diff = difficulty;
    this.rand = rng(self.id, seed);
    this.btn = new Buttons();
    this.pilot = new VehiclePilot(this);
    this.duelist = new MeleeDuelistBrain(self, { aggression: persona.aggression, parrySkill: difficulty.parrySkill, reactionTime: difficulty.reactionTime }, this.rand);
    this.duelist.world = world;
    this.time = 0;
    this.target = null; this.targetSince = 0;
    this.decideIn = 0;
    this.abilityLock = 0;               // min gap between casts
    this.aimOverride = null;            // { yaw, pitch, until } while an ability's cast follows aim
    this.aimYaw = 0; this.aimPitch = 0;
    this.errPhase = this.rand() * 10;
    this.strafeSign = 1; this.strafeTimer = 0;
    this.modeTimer = 0;
    this.burstShots = 0; this.burstPause = 0; this.lastShotIndex = 0;
    this.swapTimer = 0;
    this.lastHp = null; this.dmgRate = 0;
    this.dodgeUntil = 0; this.dodgeDir = new Vector3();
    this.pendingInterrupt = null;       // { at, casterId }
    this.vehicleGoal = null; this.vehicleGoalTime = 0; this.vehicleCooldown = 0;
    this.prevDist = null;
    this.profiles = new Map();
    this.log = [];                      // recent decisions, handy in tests and debug overlays
    this.objective = null;              // { id, pos, radius, field, role, slot, of } from a commander
    this.reviveGoal = null; this.downT = 0;
    this.moveDir = new Vector3(); this.hasMoveDir = false;
    this._cand = [];
    this.#listen();
  }

  dispose() { this.offs?.forEach((f) => f()); }

  #listen() {
    this.offs = [
      bus.on('melee:windup', (e) => this.duelist.observeWindup(e)),
      bus.on('melee:parry', (e) => this.duelist.observeParried(e)),
      bus.on('ability:cast', (e) => this.#onEnemyCast(e)),
    ];
  }

  // ---------------------------------------------------------------- reactions
  #onEnemyCast(e) {
    const caster = this.world.entity(e.id);
    if (!caster || caster.team === this.self.team || this.self.health.dead || !caster.movement) return;
    const me = this.self.movement.state.position;
    const origin = _a.fromArray(e.origin);
    // 1. Dodge telegraphed shapes aimed from the caster's position (dashes, slams, strafing lines).
    const t = e.telegraph;
    if (t && (t.shape === 'line' || t.shape === 'circle') && !t.at) {
      let inside = false;
      _d.subVectors(me, origin).setY(0);
      if (t.shape === 'circle') inside = _d.length() < t.radius + 0.8;
      else {
        const f = _b.set(-Math.sin(e.yaw), 0, -Math.cos(e.yaw));
        const along = _d.dot(f);
        inside = along > -1 && along < t.length + 1 && _d.addScaledVector(f, -along).length() < t.width / 2 + 0.9;
        if (inside) this.dodgeDir.set(-f.z, 0, f.x).multiplyScalar(this.rand() < 0.5 ? 1 : -1); // sidestep
      }
      if (inside) {
        if (t.shape === 'circle') this.dodgeDir.copy(_d.subVectors(me, origin).setY(0).normalize());
        this.dodgeUntil = this.time + this.diff.reactionTime + (e.castTime ?? 0.3) + 0.25;
        this.dodgeAt = this.time + this.diff.reactionTime;
        this.dodgeRoll = (e.castTime ?? 0) > this.diff.reactionTime && this.self.movement.state.stamina > 30;
      }
    }
    // 2. Interrupt casts worth interrupting (anything with a real cast time) if we can.
    if ((e.castTime ?? 0) >= 0.25 && this.rand() < this.diff.interruptChance) {
      if (e.castTime > this.diff.reactionTime) this.pendingInterrupt = { at: this.time + this.diff.reactionTime, casterId: e.id, until: this.time + e.castTime };
    }
  }

  // ---------------------------------------------------------------- main
  think(dt, tick) {
    this.time += dt;
    const cmd = emptyCommand();
    cmd.tick = tick;
    const self = this.self;
    this.hasMoveDir = false;
    if (self.health.dead) { this.target = null; this.vehicleGoal = null; this.pilot.lifeRoll = undefined; this.#dropRevive(); this.downT = 0; this.btn.finalize(cmd); return cmd; }
    if (self.health.downed) { this.#dropRevive(); this.#downed(dt, cmd); this.btn.finalize(cmd); return cmd; }
    this.downT = 0;
    this.decideIn -= dt; this.abilityLock -= dt; this.modeTimer += dt; this.swapTimer -= dt; this.vehicleCooldown -= dt;

    // Incoming damage rate (EMA), the "am I under fire" signal.
    // In a vehicle the hull takes the hits, so "under fire" means the vehicle is losing HP.
    const hpSrc = self.vehicle ? self.vehicle.veh.health : self.health;
    const hp = hpSrc.hp + hpSrc.shield + hpSrc.overshield;
    if (this.lastHp !== null) this.dmgRate = this.dmgRate * Math.exp(-dt / 1.2) + Math.max(0, this.lastHp - hp) / 1.2;
    this.lastHp = hp;

    if (this.decideIn <= 0 || !this.#valid(this.target) || this.target.health?.downed) { this.#pickTarget(); } // a target that went down: look for one still standing
    const ctx = this.#context();
    if (this.decideIn <= 0) this.decideIn = this.diff.decisionInterval * (0.8 + this.rand() * 0.4);

    // ---- after a dive (or a knockdown into prone) bots get straight back up: jump = stand up from prone
    const ms = self.movement.state;
    if (ms.mode === 'ground' && ms.stance === 'prone' && !ms.stanceT && !self.vehicle) this.btn.press('jump');

    // ---- in a vehicle: the pilot owns the command
    if (self.vehicle) {
      cmd.yaw = self.movement.state.yaw; cmd.pitch = 0;
      this.pilot.drive(dt, ctx, cmd, this.btn);
      if (cmd.buttons.interact?.pressed || this.btn.queued.has('interact')) this.vehicleCooldown = 6;
      this.btn.finalize(cmd);
      return cmd;
    }

    // ---- walk to a vehicle we want
    if (this.vehicleCooldown <= 0 && (this.vehicleGoal || this.decideIn > this.diff.decisionInterval * 0.7)) {
      const want = this.vehicleGoal && !this.vehicleGoal.removed && this.vehicleGoal.seats.some((s) => !s.occupant) ? this.vehicleGoal : this.pilot.wantVehicle(ctx);
      if (want !== this.vehicleGoal) { this.vehicleGoal = want; this.vehicleGoalTime = 0; }
    }
    if (this.vehicleGoal) {
      this.vehicleGoalTime += dt;
      if (this.vehicleGoalTime > 20 || (ctx.target && ctx.dist < 7)) { this.vehicleGoal = null; this.vehicleCooldown = 8; }
      else {
        const bp = this.pilot.boardPoint(this.vehicleGoal, _b);
        this.#moveToward(cmd, bp, true);
        const me = self.movement.state.position;
        this.moveDir.set(bp.x - me.x, 0, bp.z - me.z).normalize();
        if (this.world.vehicles.nearestEnterable(self) === this.vehicleGoal) this.btn.press('interact');
        if (ctx.target && ctx.los) { this.#gunfight(dt, ctx, cmd, true); this.#worldMove(cmd, this.moveDir); } // shoot on the way
        this.btn.finalize(cmd);
        return cmd;
      }
    }

    // ---- revive a downed teammate (the ReviveSystem kneels us once we hold interact beside them)
    if (this.#revive(dt, ctx, cmd)) { this.btn.finalize(cmd); return cmd; }

    // ---- abilities (may set an aim override for their cast)
    if (!self.transform || self.abilities.casting?.key !== 'super') this.#abilities(ctx);

    // ---- mode: sword or gun
    this.#chooseMode(ctx);

    // Frontline orders: fight what's close (or on our point); otherwise keep pushing to the
    // objective along the flow field, shooting on the move.
    this.hasMoveDir = false; this.dodging = false;
    const engage = ctx.target && (!this.objective || this.#worthFighting(ctx));
    if (self.mode === 'sword' && ctx.target && !ctx.target.isVehicle && engage) this.#swordfight(dt, tick, ctx, cmd);
    else if (engage || !this.objective) this.#gunfight(dt, ctx, cmd, false);
    else { this.#advance(ctx, cmd); if (ctx.target && ctx.los) this.#gunfight(dt, ctx, cmd, true); }

    // ---- safety overrides: telegraph dodges, hostile zones, low-HP retreat
    this.#safety(ctx, cmd);

    if (this.aimOverride && this.time < this.aimOverride.until) {
      // Keep tracking the target through the cast: aim is read again when the effect fires.
      const o = this.aimOverride;
      const a = o.p && ctx.target && ['target', 'ground', 'level', 'near'].includes(o.p.aim) ? aimAbility(o.p, this.#context()) : o;
      cmd.yaw = a.yaw; cmd.pitch = a.pitch;
    }
    // World-space moves (objective paths, dodges, zone escapes) become stick input relative to the
    // final aim, so aiming elsewhere never bends the path.
    if (this.hasMoveDir) { this.#worldMove(cmd, this.moveDir); if (!this.dodging) this.#avoidObstacles(cmd); }
    this.btn.finalize(cmd);
    return cmd;
  }

  // ---------------------------------------------------------------- downs and revives
  /**
   * Downed: lie still while someone revives us; otherwise crawl toward the nearest teammate (or
   * away from the nearest enemy), and give up (hold jump) when nobody is coming: quickly when no
   * teammate is within 30 m, eventually anyway.
   */
  #downed(dt, cmd) {
    const self = this.self, me = self.movement.state.position;
    this.downT = (this.downT ?? 0) + dt;
    this.target = null; this.vehicleGoal = null;
    cmd.yaw = self.movement.state.yaw;
    if (self.health.reviving > 0) return;
    let ally = null, ad = Infinity, medic = false, foe = null, fd = Infinity;
    this.world.fightersNear(me, 45, (e) => {
      if (e === self || e.isVehicle || e.isDeployable || !e.health || !e.health.up) return;
      const d = e.movement.state.position.distanceTo(me);
      if (e.team === self.team) { if (d < ad) { ad = d; ally = e; } if (d < 40 && this.world.revives.isMedic(e)) medic = true; }
      else if (d < fd) { fd = d; foe = e; }
    });
    const coming = (ally && ad < 30) || medic;
    if (this.downT > (coming ? 14 : 3)) { this.btn.hold('jump'); return; }
    if (ally && ad > 2.5) { const p = ally.movement.state.position; cmd.yaw = Math.atan2(-(p.x - me.x), -(p.z - me.z)); cmd.moveY = 1; }
    else if (foe && fd < 25) { const p = foe.movement.state.position; cmd.yaw = Math.atan2(p.x - me.x, p.z - me.z); cmd.moveY = 1; }
  }

  /**
   * Go get a downed teammate up: the nearest one nobody else has claimed, within 18 m (medics:
   * 40 m), unless we're in a close fight (medics only care about being shot). Returns true while
   * this owns the command.
   */
  #revive(dt, ctx, cmd) {
    const self = this.self, me = self.movement.state.position, rv = this.world.revives;
    if (!rv?.cfg || self.vehicle) return false;
    const medic = rv.isMedic(self);
    // Once a revive is well under way, finish it unless we're about to go down ourselves.
    const job = rv.jobOf(self.id), committed = job && job.t / job.need > 0.35 && ctx.selfHp > 0.4;
    const busy = !committed && ((medic ? ctx.underFire && ctx.selfHp < 0.5 : ctx.underFire) || (ctx.target && ctx.los && ctx.dist < (medic ? 8 : 15)));
    let p = this.reviveGoal;
    if (p && (!p.health.downed || busy)) { this.#dropRevive(); p = null; }
    if (!p && !busy) {
      const reach = medic ? 40 : 18;
      let bd = reach;
      this.world.fightersNear(me, reach, (e) => {
        if (e === self || e.team !== self.team || !e.health?.downed || e.isVehicle) return;
        const c = e.health.reviveClaim;
        if (c && c !== this && c.reviveGoal === e && c.self.health.up) return; // someone's on it
        const d = e.movement.state.position.distanceTo(me);
        if (d < bd) { bd = d; p = e; }
      });
      if (p) { this.reviveGoal = p; p.health.reviveClaim = this; }
    }
    if (!p) return false;
    const pp = p.movement.state.position, d = pp.distanceTo(me);
    // Walk in to 75% of the range; once kneeling, stay put while within the system's full reach
    // (a few centimetres of drift must not restart the revive).
    if (d > rv.cfg.reviveRange * (rv.jobOf(self.id) ? 1.2 : 0.75)) {
      this.#moveToward(cmd, pp, d > 6 && !ctx.underFire);
      this.moveDir.set(pp.x - me.x, 0, pp.z - me.z).normalize(); this.hasMoveDir = true;
      if (ctx.target && ctx.los) this.#gunfight(dt, ctx, cmd, true); // cover ourselves on the way
      if (this.hasMoveDir) this.#worldMove(cmd, this.moveDir);
    } else {
      cmd.yaw = Math.atan2(-(pp.x - me.x), -(pp.z - me.z)); cmd.pitch = -0.6; this.aimYaw = cmd.yaw;
      this.btn.hold('interact');
    }
    return true;
  }

  #dropRevive() {
    const p = this.reviveGoal;
    if (p && p.health.reviveClaim === this) p.health.reviveClaim = null;
    this.reviveGoal = null;
  }

  // ---------------------------------------------------------------- perception
  /** Same membership as world.fighters() without scanning it: alive, targetable, not inside a hull. */
  #valid(t) { return !!t && !t.removed && !t.health?.dead && !t.isDeployable && (t.isVehicle || !t.vehicle || t.vehicle.exposed); }

  #pickTarget() {
    const me = this.self.movement.state.position;
    // Candidates from the spatial grid on big maps; line of sight only for the nearest few
    // (128 bots each raycasting every enemy would cost more than the whole battle).
    const range = this.world.spatial ? this.diff.perceptionRange ?? 90 : Infinity;
    const cand = this._cand; cand.length = 0;
    this.world.fightersNear(me, range === Infinity ? 1e6 : range, (e) => {
      if (e.team === this.self.team || e.health.dead || e.removed || e.isDeployable) return;
      const d = e.movement.state.position.distanceTo(me);
      if (d <= range) cand.push(d, e);
    });
    const order = [];
    for (let i = 0; i < cand.length; i += 2) order.push(i);
    order.sort((a, b) => cand[a] - cand[b]);
    let best = null, bs = Infinity;
    for (let k = 0; k < order.length; k++) {
      const d = cand[order[k]], e = cand[order[k] + 1];
      const vis = k < 4 && this.#visible(e, d);
      let s = d * (vis ? 1 : 2.2);
      if (e.isVehicle && !e.seats.some((x) => x.occupant)) s += 60;     // empty vehicles are low value
      else if (e.isVehicle) s += 8;
      if (e === this.target) s -= 6;                                     // hysteresis
      if (e.health?.downed) s += 40;                                     // finish the downed only when nothing's standing
      if (s < bs) { bs = s; best = e; }
    }
    if (best !== this.target) { this.target = best; this.targetSince = this.time; }
  }

  #eye(out) {
    const p = this.self.movement.state.position;
    return out.set(p.x, p.y + (this.self.vehicle ? 2.2 : 1.6), p.z);
  }

  #visible(e, d = null) {
    const dist = d ?? e.movement.state.position.distanceTo(this.self.movement.state.position);
    if (e.status?.has('cloak') && !e.status.has('revealed') && dist > 8) return false;
    const from = this.#eye(_a), tp = e.movement.state.position;
    // dir is the only use of _b here: the smoke-zone check takes the raw position (it used to
    // re-copy it into _b, overwriting dir, so sight rays pointed along the target's world position).
    const dir = _b.copy(tp); dir.y += e.isVehicle ? e.def.size.y * 0.5 : 1.1;
    dir.sub(from);
    const len = dir.length();
    if (len < 0.5) return true;
    if (this.world.zones.blocksVisionBetween(from, tp)) return false;
    return !this.world.raycastStatic(from, dir.divideScalar(len), len - 0.3);
  }

  #context() {
    const self = this.self, me = self.movement.state.position;
    const t = this.#valid(this.target) ? this.target : null;
    const ctx = {
      self, selfPos: me, yaw: self.movement.state.yaw,
      selfHp: (self.health.hp + self.health.shield) / (self.health.max + self.health.maxShield),
      underFire: this.dmgRate > 8, enemiesNear: 0, alliesNear: 0, hurtAlly: null, hurtAllyHp: 1, hurtAllyDist: Infinity,
      negativeStatuses: [...self.status.active.keys()].filter((k) => self.status.defs[k]?.negative && k !== 'revealed').length,
      inVehicle: !!self.vehicle,
      vehicleNearby: this.world.vehicles.list.some((v) => v.team === self.team && !v.removed && v.movement.state.position.distanceTo(me) < 30),
      ownsDeployable: (kind) => this.world.deployables.list.some((d) => d.ownerId === self.id && d.kind === kind && !d.removed),
      target: null, dist: Infinity, los: false, holdInterrupts: this.diff.interruptChance >= 0.5,
    };
    this.world.fightersNear(me, 30, (e) => {
      if (e === self || e.health.dead || e.isDeployable) return;
      const d = e.movement.state.position.distanceTo(me);
      if (e.health.downed) return;
      if (e.team !== self.team) { if (d < 8) ctx.enemiesNear++; return; }
      if (d < 12) ctx.alliesNear++;
      if (!e.isVehicle && e.health.hp / e.health.max < ctx.hurtAllyHp) { ctx.hurtAlly = { e, pos: e.movement.state.position }; ctx.hurtAllyHp = e.health.hp / e.health.max; ctx.hurtAllyDist = d; }
    });
    if (t) {
      const tp = t.movement.state.position;
      ctx.target = { e: t, pos: tp, isVehicle: !!t.isVehicle };
      ctx.targetVel = t.movement.state.velocity;
      ctx.dist = tp.distanceTo(me);
      ctx.los = this.#visible(t, ctx.dist);
      ctx.vehicleLos = ctx.los;
      ctx.targetSpeed = Math.hypot(t.movement.state.velocity.x, t.movement.state.velocity.z);
      ctx.targetRooted = !!t.status?.rooted || t.status?.has('slow');
      ctx.targetCloaked = !!t.status?.has('cloak');
      ctx.targetHp = t.health.hp / t.health.max;
      // Casts are only "seen" through the telegraph event after the bot's reaction time (no wallhack on state).
      ctx.targetCasting = !!(this.pendingInterrupt && this.pendingInterrupt.casterId === t.id && this.time >= this.pendingInterrupt.at && this.time < this.pendingInterrupt.until);
      ctx.closing = this.prevDist !== null && ctx.dist < this.prevDist - 0.02;
      this.prevDist = ctx.dist;
    }
    return ctx;
  }

  // ---------------------------------------------------------------- abilities
  #profile(slotKey, slot) {
    const key = `${slot.def.id}:${slot.tier}`;
    let p = this.profiles.get(key);
    if (!p) { p = profileAbility(slot.stats, slotKey); this.profiles.set(key, p); }
    return p;
  }

  #abilities(ctx) {
    const ab = this.self.abilities;
    if (!ab || ab.casting || this.self.status.silenced) return;

    // Recasts: detonate a planted charge when an enemy walks into its radius.
    for (const key of SLOTS) {
      const slot = ab.slots[key];
      if (!slot?.recast) continue;
      const charge = this.world.deployables.list.find((d) => d.ownerId === this.self.id && d.ability === slot.def.id && d.kind === 'charge' && !d.removed);
      const r = slot.stats.recast.effects?.[0]?.radius ?? 4;
      if (charge && this.world.fighters().some((e) => e.team !== this.self.team && !e.health.dead && e.movement.state.position.distanceTo(charge.movement.state.position) < r * 0.85)) {
        this.btn.press(key); this.#note('recast', key); return;
      }
    }

    if (this.abilityLock > 0 && !ctx.targetCasting) return;
    let best = null, bs = 0.55;
    for (const key of SLOTS) {
      const slot = ab.slots[key];
      if (!slot || slot.recast) continue;
      if (key === 'super' ? ab.superEnergy < ab.superCost || slot.phase !== 'ready' : !slot.ready) continue;
      const p = this.#profile(key, slot);
      const s = scoreAbility(p, ctx, this.persona) * this.diff.abilityMul * (0.85 + this.rand() * 0.3);
      if (s > bs) { bs = s; best = { key, p }; }
    }
    if (!best) return;
    const aim = aimAbility(best.p, ctx);
    this.aimOverride = { ...aim, p: best.p, until: this.time + best.p.cast + 0.12 };
    this.btn.press(best.key);
    this.abilityLock = this.diff.decisionInterval * 2.5;
    if (ctx.targetCasting && best.p.tags.has('interrupt')) this.pendingInterrupt = null;
    this.#note('cast', best.key, best.p.id, [...best.p.tags].join('+'));
  }

  /** Closest range any ready, close-range ability wants (supers always; others if the bot is assertive). */
  #reachHint() {
    const ab = this.self.abilities;
    if (!ab || this.self.status.silenced) return Infinity;
    let r = Infinity;
    for (const key of SLOTS) {
      const slot = ab.slots[key];
      if (!slot || (key === 'super' ? ab.superEnergy < ab.superCost : !slot.ready)) continue;
      const p = this.#profile(key, slot);
      if (key !== 'super' && this.persona.aggression < 0.5 && !p.tags.has('tetherEnemy')) continue;
      r = Math.min(r, abilityReach(p));
    }
    return Math.max(2, r);
  }

  #note(...a) { this.log.push([this.time.toFixed(2), ...a]); if (this.log.length > 60) this.log.shift(); }

  // ---------------------------------------------------------------- sword
  #chooseMode(ctx) {
    const self = this.self;
    if (self.transform) return; // the super decided the mode
    const pref = this.persona.melee;
    const tv = ctx.target?.isVehicle;
    let want = 'gun';
    if (ctx.target && !tv) {
      if (pref === 'prefer' && ctx.dist < 12) want = 'sword';
      else if (pref === 'close' && ctx.dist < 3.2) want = 'sword';
    }
    if (want !== self.mode && this.modeTimer > 0.6) { self.mode = want; this.modeTimer = 0; }
  }

  #swordfight(dt, tick, ctx, cmd) {
    this.duelist.target = ctx.target.e;
    const d = this.duelist.think(dt, tick);
    cmd.moveX = d.moveX; cmd.moveY = d.moveY; cmd.yaw = d.yaw; cmd.pitch = 0;
    for (const k of ['light', 'heavy', 'guard', 'dodge']) if (d.buttons[k]?.down) this.btn.hold(k);
    // Close the gap faster than a walk when far.
    if (ctx.dist > 5) { this.btn.hold('sprint'); cmd.moveY = 1; }
  }

  // ---------------------------------------------------------------- guns
  #gunfight(dt, ctx, cmd, moving) {
    const self = this.self, wc = self.weapons, me = self.movement.state.position;
    const t = ctx.target;
    if (!t) { this.#hunt(cmd); return; }
    const w = wc.current, s = w.s;

    // Aim point: chest (vehicle: centre mass, rear if behind), lead for projectiles, drop compensation.
    const speed = s.projectile === 'hitscan' || s.projectile === 'pellets' || s.projectile === 'beam' ? 0 : s.velocity ?? 120;
    const tt = speed ? ctx.dist / speed : 0;
    _a.copy(t.pos).addScaledVector(ctx.targetVel, tt);
    _a.y += t.isVehicle ? t.e.def.size.y * 0.5 : 1.1;
    if (speed && s.drop) _a.y += 0.5 * 9.8 * s.drop * tt * tt;
    const eyeY = me.y + 1.6;
    const wantYaw = Math.atan2(-(_a.x - me.x), -(_a.z - me.z));
    const wantPitch = Math.atan2(_a.y - eyeY, Math.max(0.5, Math.hypot(_a.x - me.x, _a.z - me.z)));

    // Human-ish tracking: limited turn speed plus a slow wandering error.
    const step = this.diff.aimSpeed * dt;
    this.aimYaw += Math.max(-step, Math.min(step, angleDelta(this.aimYaw, wantYaw)));
    this.aimPitch += Math.max(-step, Math.min(step, wantPitch - this.aimPitch));
    const err = (this.diff.aimError * Math.PI) / 180;
    const ey = Math.sin(this.time * 1.3 + this.errPhase) * err * (0.6 + 0.4 * Math.sin(this.time * 0.7));
    const ep = Math.sin(this.time * 1.7 + this.errPhase * 2) * err * 0.5;
    const comp = this.diff.recoilComp;
    cmd.yaw = this.aimYaw + ey - wc.recoilYaw * comp;
    cmd.pitch = this.aimPitch + ep - wc.recoilPitch * comp;

    // Positioning: hold the personality's range band, strafe, flank, sprint to close.
    if (!moving) {
      const reach = this.#reachHint();
      const pref = Math.min(this.persona.preferredRange, reach), band = this.persona.rangeBand;
      const retreat = ctx.selfHp < this.persona.retreatHp && ctx.underFire;
      let fwd = retreat ? -1 : Math.max(-1, Math.min(1, (ctx.dist - pref) / band));
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) { this.strafeSign = this.rand() < 0.5 ? -1 : 1; this.strafeTimer = 1 + this.rand() * 1.6; }
      let side = this.strafeSign * this.persona.strafe;
      if (this.persona.flank && ctx.dist > 12 && !retreat) side = this.strafeSign * 0.9;
      cmd.moveY = fwd; cmd.moveX = side;
      // Commit: a ready close-range ability (tether, slam, point-blank super) is worth sprinting in for.
      const committing = reach < this.persona.preferredRange && ctx.dist > reach + 1.5 && !retreat;
      if (committing) { cmd.moveY = 1; cmd.moveX *= 0.3; }
      if ((fwd > 0.8 && ctx.dist > pref + band + 6 && !ctx.los) || retreat || (committing && ctx.dist > reach + 4)) { this.btn.hold('sprint'); cmd.moveY = retreat ? -1 : 1; }
      this.#avoidObstacles(cmd);
    }

    // Firing discipline.
    const tol = Math.max(0.025, Math.atan2(0.45, Math.max(1, ctx.dist)));
    const aimed = Math.abs(angleDelta(wc.aimYaw, wantYaw)) < tol * 2.2 && Math.abs(wc.aimPitch - wantPitch) < tol * 2.5;
    const reacted = this.time - this.targetSince > this.diff.reactionTime;
    const range = s.range ?? (s.projectile === 'beam' ? 35 : s.pellets ? 25 : 120);
    const hot = w.usesHeat && w.heat > w.s.ammo.max * 0.85;
    const canFire = ctx.los && reacted && aimed && ctx.dist < range && !hot && wc.phase === 'ready' && !this.self.status.disarmed;
    if (wc.shotIndex !== this.lastShotIndex) { this.burstShots += wc.shotIndex - this.lastShotIndex; this.lastShotIndex = wc.shotIndex; }
    this.burstPause -= dt;
    const burstLen = ctx.dist < 10 ? 30 : ctx.dist < 25 ? 9 : 4;
    if (this.burstShots >= burstLen) { this.burstShots = 0; this.burstPause = 0.25 + this.rand() * 0.25; }
    if (canFire && this.burstPause <= 0) {
      if (s.fireMode === 'auto' || s.fireMode === 'beam' || s.fireMode === 'spool') this.btn.hold('light');
      else if (s.fireMode === 'charge') { this.btn.hold('light'); if (wc.charge >= 1) this.btn.down.delete('light'); }
      else this.btn.pressIfReady('light', wc);
    }
    // ADS at range when not sprinting.
    if (ctx.los && ctx.dist > 14 && !this.btn.down.has('sprint')) this.btn.hold('guard');
    // Reloads and vents.
    if (!w.usesHeat && !w.usesBattery && (w.mag === 0 || (w.mag < s.mag * 0.3 && !ctx.los)) && w.reserve > 0) this.btn.press('reload');
    if (w.usesHeat && w.heat > w.s.ammo.max * 0.5 && !ctx.los) this.btn.press('reload');
    // Swap to the shotgun up close and back to the rifle at range.
    if (wc.loadout.length > 1 && this.swapTimer <= 0 && wc.phase === 'ready') {
      const pelletIdx = wc.loadout.findIndex((x) => x.s.pellets);
      const want = pelletIdx >= 0 && ctx.dist < 9 ? pelletIdx : wc.loadout.findIndex((x) => !x.s.pellets);
      if (want >= 0 && want !== wc.index) { this.btn.press('swapWeapon'); this.swapTimer = 2; }
    }
  }

  /** No target in sight: go to the objective if we have orders, else toward the nearest enemy we know about. */
  #hunt(cmd) {
    if (this.objective) { this.#advance(this.#context(), cmd); return; }
    const me = this.self.movement.state.position;
    let best = null, bd = Infinity;
    for (const e of this.world.fighters()) if (e.team !== this.self.team && !e.health.dead && !e.isDeployable) { const d = e.movement.state.position.distanceTo(me); if (d < bd) { bd = d; best = e; } }
    if (best && bd > this.persona.preferredRange) this.#moveToward(cmd, best.movement.state.position, false);
  }

  // ---------------------------------------------------------------- frontline orders
  /**
   * Stop and fight properly (range band, strafing, sword duels), or keep pushing to the objective
   * while shooting on the move? Battlefront soldiers with orders keep moving: they only stop for
   * an enemy too close to walk past, one shooting them from nearby, or one holding their point.
   * On the point itself they keep their slot and fight from it.
   */
  #worthFighting(ctx) {
    if (ctx.dist < 18) return true;
    const o = this.objective, me = this.self.movement.state.position, tp = ctx.target.pos;
    if (Math.hypot(me.x - o.pos.x, me.z - o.pos.z) < o.radius * 1.8) return false;
    if (ctx.underFire && ctx.dist < 30) return true;
    return Math.hypot(tp.x - o.pos.x, tp.z - o.pos.z) < o.radius + 25;
  }

  /**
   * Move to the objective: flow field around cover when far, straight to a slot on the point
   * when close (the squad spreads over it), then hold facing the enemy's side.
   * Sets a world-space move (applied after aiming, so shooting on the move doesn't bend the path).
   */
  #advance(ctx, cmd) {
    const o = this.objective, me = this.self.movement.state.position, nav = this.world.nav;
    const ang = (o.slot / Math.max(1, o.of)) * Math.PI * 2 + (o.id ?? 0) * 1.3;
    const slotR = o.radius * (o.role === 'defend' ? 0.75 : 0.5);
    const sx = o.pos.x + Math.cos(ang) * slotR, sz = o.pos.z + Math.sin(ang) * slotR;
    const toPoint = Math.hypot(me.x - o.pos.x, me.z - o.pos.z);
    const dir = this.moveDir;
    if (toPoint < o.radius * 1.8) {
      dir.set(sx - me.x, 0, sz - me.z);
      const l = dir.length();
      if (l < 1.5) {
        // Holding: face the enemy's side of the map and wait for them.
        const enemyHq = this.world.mode?.map.hq[1 - this.self.team];
        if (enemyHq) { cmd.yaw = Math.atan2(-(enemyHq.x - me.x), -(enemyHq.z - me.z)) + Math.sin(this.time * 0.3 + o.slot) * 0.6; this.aimYaw = cmd.yaw; }
        return;
      }
      dir.divideScalar(l);
    } else if (!(nav && nav.sample(nav.field(o.field, o.pos.x, o.pos.z, o.radius * 0.6), me.x, me.z, dir))) {
      dir.set(o.pos.x - me.x, 0, o.pos.z - me.z).normalize();
    }
    cmd.yaw = Math.atan2(-dir.x, -dir.z); cmd.pitch = 0; this.aimYaw = cmd.yaw;
    this.hasMoveDir = true;
    if (toPoint > 30 && !ctx.underFire && ctx.enemiesNear === 0 && !(ctx.target && ctx.los && ctx.dist < 50)) this.btn.hold('sprint');
  }

  #moveToward(cmd, p, sprint) {
    const me = this.self.movement.state.position;
    cmd.yaw = Math.atan2(-(p.x - me.x), -(p.z - me.z));
    this.aimYaw = cmd.yaw; cmd.pitch = 0;
    cmd.moveY = 1; cmd.moveX = 0;
    if (sprint && me.distanceTo(p) > 3) this.btn.hold('sprint');
    this.#avoidObstacles(cmd);
  }

  /** Two feelers: sidestep tall cover; sprint-vault low cover (the movement system auto-vaults). */
  #avoidObstacles(cmd) {
    const me = this.self.movement.state.position;
    const y = cmd.yaw;
    const fx = -Math.sin(y), fz = -Math.cos(y), rx = Math.cos(y), rz = -Math.sin(y);
    const dirX = fx * cmd.moveY + rx * cmd.moveX, dirZ = fz * cmd.moveY + rz * cmd.moveX;
    const len = Math.hypot(dirX, dirZ);
    if (len < 0.1) return;
    _d.set(dirX / len, 0, dirZ / len);
    const hit = this.world.raycastStatic(_a.set(me.x, me.y + 0.5, me.z), _d, 2.2, { includeWalls: true });
    if (!hit) return;
    const top = hit.cover ? hit.cover.max.y - me.y : 3;
    // Low cover: hold climb and the movement system vaults it when we reach it (HD2 hold-to-climb).
    if (top < 1.1 && cmd.moveY > 0.5) { this.btn.hold('jump'); return; }
    cmd.moveX = this.strafeSign; // slide along it
    if (cmd.moveY > 0) cmd.moveY = 0.2;
  }

  // ---------------------------------------------------------------- safety
  #safety(ctx, cmd) {
    const me = this.self.movement.state.position;
    // Telegraphed cast incoming at our position: sidestep (and roll if there's time).
    this.dodging = false;
    if (this.time < this.dodgeUntil && this.time >= (this.dodgeAt ?? 0)) {
      this.moveDir.copy(this.dodgeDir); this.hasMoveDir = true; this.dodging = true;
      if (this.dodgeRoll) { this.btn.press('dodge'); this.dodgeRoll = false; }
      this.btn.down.delete('light'); this.btn.down.delete('guard');
      return;
    }
    // Standing in a hostile zone (airstrike, anchor, storm): walk out along the threat vector.
    const threat = this.world.zones.threatAt(me, this.self.team, _b);
    if (threat.lengthSq() > 0) { this.moveDir.copy(threat.normalize()); this.hasMoveDir = true; this.btn.hold('sprint'); }
  }

  #worldMove(cmd, dir) {
    const y = cmd.yaw;
    const fx = -Math.sin(y), fz = -Math.cos(y), rx = Math.cos(y), rz = -Math.sin(y);
    cmd.moveY = dir.x * fx + dir.z * fz;
    cmd.moveX = dir.x * rx + dir.z * rz;
  }
}
