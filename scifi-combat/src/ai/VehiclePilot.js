// VehiclePilot: the vehicle half of a bot's brain.
//
//  * wantVehicle(): pick a friendly vehicle worth walking to, based on the personality
//    (`usesVehicles`: never | opportunistic | always), distance and the fight's current range.
//  * drive(): turn the situation into a seat command. Each model is driven the way a decent
//    player would drive it:
//      hover   = point at the target, boost to close distance, strafe-pass when close,
//                ram infantry if aggressive
//      tracked = hold standoff range with the hull, lead shots with the turret, fire only when
//                the turret is on target
//      flyer   = climb to gun altitude, circle-strafe the target, drop passengers near the fight
//      car     = steer the wheels toward where it should go, lift off and brake for the corners;
//                in a fight keep moving and keep the gunner's gun on it, circling at 20-40 m (an
//                aggressive driver runs infantry down instead)
//    Gunners aim freely and fire; passengers hop out once the dropship is low near the fight; in
//    a car they lean out and shoot with their own guns, and get out when it pulls up.
//  * Bail out when the vehicle is about to blow (being ejected costs HP), at once when it burns.
//  * A friendly car on its roof nearby: push it back over (then maybe drive it).

import { angleDelta, localToWorld } from '../core/geom.js';
import { ballisticPitch } from './AbilityPlanner.js';
import { Vector3 } from 'three';

const _m = new Vector3(), _o = new Vector3(), _dir = new Vector3();
const ZERO = new Vector3();

export class VehiclePilot {
  constructor(brain) { this.brain = brain; this.flankSign = 1; this.flankTimer = 0; }

  wantVehicle(ctx) {
    const { self, world, persona } = this.brain;
    if (self.vehicle || self.transform) return null;
    if (ctx.target && ctx.dist < 8) return null; // never walk away from a knife fight
    // A car of ours on its roof close by, and no fight on top of us: anyone pushes it back over.
    if (!(ctx.target && ctx.los && ctx.dist < 30)) {
      const me = self.movement.state.position;
      for (const v of world.vehicles.list) if (v.car && !v.removed && !v.wreck && v.team === self.team && v.car.upright < 0.35 && v.car.speed < 1.5 && v.movement.state.position.distanceTo(me) < 18) return v;
    }
    if (persona.usesVehicles === 'never') return null;
    const always = persona.usesVehicles === 'always';
    // Opportunists decide once per life whether they're in a vehicle mood, and don't take a second
    // vehicle while a teammate already drives one (keeps infantry on the field). Crewing an ally's
    // vehicle as gunner is always fine.
    if (this.lifeRoll === undefined) this.lifeRoll = this.brain.rand();
    const mayDrive = always || (this.lifeRoll <= 0.45 && !world.entities.some((e) => e !== self && e.team === self.team && e.vehicle?.veh.seats[e.vehicle.seat].def.role === 'driver'));
    const maxWalk = always ? 70 : 22;
    let best = null, bd = maxWalk;
    for (const v of world.vehicles.list) {
      if (v.removed || v.wreck || v.team !== self.team || v.health.hp < v.health.max * 0.35) continue;
      if (v.def.gun || v.def.cargo) continue;   // guns and supply trucks have their own crews (SupportCommand)
      if (v.car && v.car.upright < 0.5) continue;
      const free = v.seats.findIndex((s) => !s.occupant);
      if (free < 0) continue;
      const allyDriven = v.seats.some((s) => s.def.role === 'driver' && s.occupant);
      // Riding along: the gun, or a car's seat you can shoot from.
      const ride = v.seats[free].def.role === 'gunner' || (v.seats[free].def.ownWeapon && v.movement.state.position.distanceTo(self.movement.state.position) < 15 && !this.#nearObjective(v, 30));
      if (!mayDrive && !(allyDriven && ride)) continue;
      // Opportunistic bots only take a vehicle when the fight is far away; support bots happily gun.
      if (persona.usesVehicles === 'opportunistic' && ctx.target && ctx.dist < 22 && v.seats[free].def.role === 'driver') continue;
      // Vehicle specialists want to drive: a gunner-only seat counts as much further away.
      const d = v.movement.state.position.distanceTo(self.movement.state.position) + (always && v.seats[free].def.role !== 'driver' ? 40 : 0);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  /** Fill `cmd` and `btn` (ButtonState) for the occupied seat. */
  drive(dt, ctx, cmd, btn) {
    const { self, persona, world } = this.brain;
    const v = self.vehicle.veh;
    const seat = v.seats[self.vehicle.seat];
    const role = seat.def.role;
    const vs = v.movement.state;
    const t = ctx.target;

    // Bail out before it blows: ejection costs 40 HP and throws you; hopping out costs nothing.
    // A car on fire goes up in seconds: out now.
    if (self.vehicle.lock <= 0 && (v.wreck || (v.health.hp < v.health.max * 0.18 && ctx.underFire))) { btn.press('interact'); return; }

    if (role === 'passenger' && v.car) {
      // Leaning out with his own gun: shoot what he sees. Out once it has pulled up near the
      // fight or the objective, or when nobody is driving.
      const pilotless = !v.seats.find((s) => s.def.role === 'driver')?.occupant;
      if (self.vehicle.lock <= 0 && v.car.speed < 3 && (pilotless || (t && ctx.dist < 25) || this.#nearObjective(v, 14))) {
        btn.press('interact');
        this.brain.vehicleCooldown = 40;          // dropped off: fight on foot now, no hopping back in
        return;
      }
      if (seat.def.ownWeapon && t && ctx.los) this.#shootOwn(ctx, cmd, btn);
      return;
    }
    if (role === 'passenger') {
      // Drop near the fight once the ship is low, or when the pilot is gone.
      const pilotless = !v.seats.find((s) => s.def.role === 'driver')?.occupant;
      if (self.vehicle.lock <= 0 && (pilotless || (t && ctx.dist < 30 && v.altitude < 4))) btn.press('interact');
      return;
    }

    const muzzleH = seat.weapons?.current.s.muzzleHeight ?? 1.5;
    const w = seat.weapons?.current;
    const aimAt = (tp, speed = 0, drop = 0) => {
      const from = vs.position;
      const dx = Math.hypot(tp.x - from.x, tp.z - from.z);
      const tt = speed ? dx / speed : 0;
      const lead = _m.copy(tp).addScaledVector(ctx.targetVel ?? ZERO, tt);
      const yaw = Math.atan2(-(lead.x - from.x), -(lead.z - from.z));
      const dy = lead.y + 1.0 - (from.y + muzzleH);
      const pitch = drop ? ballisticPitch(Math.max(1, dx), dy, speed, 9.8 * drop) : Math.atan2(dy, Math.max(1, dx));
      return { yaw, pitch };
    };
    // Heat: fire in bursts, and once it runs hot let it cool right down (holding the trigger
    // at the line just keeps the vent from ever starting).
    if (w?.usesHeat) { const max = w.s.ammo.max ?? 100; if (w.heat > max * 0.8) this.cooling = true; else if (w.heat < max * 0.25) this.cooling = false; }
    const heatOk = !w || !w.usesHeat || !this.cooling;

    if (role === 'gunner') {
      if (!t) return;
      const a = aimAt(t.pos, w?.s.velocity ?? 0, w?.s.drop ?? 0);
      // Held on the chest, the climb pulled down against (a mounted gun kicks all the same).
      cmd.yaw = a.yaw - (seat.weapons?.recoilYaw ?? 0) * 0.8; cmd.pitch = a.pitch + 0.2 / Math.max(4, ctx.dist) - (seat.weapons?.recoilPitch ?? 0) * 0.8;
      if (ctx.vehicleLos && ctx.dist < 70 && heatOk) btn.hold('light');
      return;
    }

    // ---- driver
    const d = v.def;
    if (v.car) { this.#car(dt, ctx, v, cmd); return; }
    // Nothing to fight: roll up to the squad's objective along its route (armor supports the
    // push), and back out of anything we've got stuck on.
    if (!t && d.model !== 'flyer') { this.#advance(dt, v, cmd); return; }
    if (d.model === 'tracked') {
      if (t) {
        const a = aimAt(t.pos, w?.s.velocity ?? 0, w?.s.drop ?? 0);
        cmd.yaw = a.yaw; cmd.pitch = a.pitch;
        // Hull: hold 18–35 m standoff, face the target so the thick front armor takes the hits.
        const toT = Math.atan2(-(t.pos.x - vs.position.x), -(t.pos.z - vs.position.z));
        const turn = angleDelta(v.yaw, toT);
        cmd.moveX = Math.max(-1, Math.min(1, -turn * 2));
        cmd.moveY = ctx.dist > 35 ? 1 : ctx.dist < 18 ? -1 : 0;
        // Fire only when the turret has caught up with the lead point and the gun is cool.
        if (Math.abs(angleDelta(v.turretYaw, a.yaw)) < 0.04 && ctx.vehicleLos && heatOk && ctx.dist < 80) btn.pressIfReady('light', seat.weapons);
      }
    } else if (d.model === 'flyer') {
      const wantAlt = t && ctx.dist < 40 && v.seats.some((s) => s.def.role === 'passenger' && s.occupant) ? 2 : 12;
      if (v.altitude < wantAlt - 1) btn.hold('jump'); else if (v.altitude > wantAlt + 2) btn.hold('crouch');
      if (t) {
        const a = aimAt(t.pos, w?.s.velocity ?? 0, 0);
        cmd.yaw = a.yaw; cmd.pitch = a.pitch;
        cmd.moveY = ctx.dist > 35 ? 1 : ctx.dist < 20 ? -0.6 : 0;
        cmd.moveX = 0.7 * this.#flank(dt);   // circle-strafe
        if (ctx.vehicleLos && heatOk && ctx.dist < 70) btn.hold('light');
      }
    } else {
      // hover
      if (!t) return;
      const a = aimAt(t.pos, w?.s.velocity ?? 0, 0);
      const close = ctx.dist < 12;
      const rammer = persona.aggression >= 0.6 && !t.isVehicle;
      // Close: strafe-pass at an angle (bikes are fragile when parked); far: point and go.
      cmd.yaw = close && !rammer ? a.yaw + 1.1 * this.#flank(dt) : a.yaw;
      cmd.pitch = a.pitch;
      cmd.moveY = 1;
      // A wall coming up fast: ease off and swing wide of it (a hard hit throws you over the bars).
      if (this.#wallAhead(v, 0.9)) { cmd.moveY = Math.hypot(vs.velocity.x, vs.velocity.z) > 16 ? -1 : 0.2; cmd.yaw = v.yaw + 1.2 * this.#flank(dt); return; }
      // Boost only down a clear lane (a boost can't be stopped once it's lit).
      const B = v.def.boost;
      if (B && v.boostCd <= 0 && (ctx.dist > 35 || (rammer && ctx.dist < 18 && ctx.dist > 6)) && !this.#wallAhead(v, B.duration, B.speed)) btn.press('sprint');
      if (Math.abs(angleDelta(v.yaw, a.yaw)) < 0.4 && ctx.vehicleLos && heatOk && ctx.dist < 60) btn.hold('light');
    }
  }

  #advance(dt, v, cmd) {
    const { world, objective } = this.brain;
    const vs = v.movement.state, nav = world.nav;
    if (!objective) return;
    const left = Math.hypot(objective.pos.x - vs.position.x, objective.pos.z - vs.position.z);
    const hold = v.def.model === 'tracked' ? 30 : v.car ? 12 : 10;   // tanks stop short and cover the point
    if (left < hold) { cmd.moveY = v.car && v.car.forwardSpeed > 1 ? -1 : 0; cmd.moveX = 0; cmd.yaw = v.yaw; return; }
    const f = nav?.want(objective.field, objective.pos.x, objective.pos.z, objective.radius * 0.6);
    if (!(f && nav.sample(f, vs.position.x, vs.position.z, _m))) _m.set(objective.pos.x - vs.position.x, 0, objective.pos.z - vs.position.z).normalize();
    const want = Math.atan2(-_m.x, -_m.z);
    // Stuck (on a wall, a wreck, a building): reverse and turn away for a moment.
    this.stuckT = (this.stuckT ?? 0) + dt;
    if (this.stuckT > 2.5) {
      const moved = this.stuckAt ? Math.hypot(vs.position.x - this.stuckAt.x, vs.position.z - this.stuckAt.z) : 99;
      this.reverseUntil = moved < 1.5 ? this.brain.time + 1.6 : this.reverseUntil ?? 0;
      this.stuckAt = vs.position.clone(); this.stuckT = 0;
    }
    const reversing = this.brain.time < (this.reverseUntil ?? 0);
    if (v.def.model === 'tracked') {
      const turn = angleDelta(v.yaw, want);
      cmd.moveX = reversing ? this.flankSign : Math.max(-1, Math.min(1, -turn * 2));
      cmd.moveY = reversing ? -1 : Math.abs(turn) < 0.6 ? 1 : 0.25;
      cmd.yaw = want; cmd.pitch = 0;
    } else if (v.car) {
      this.#steerCar(v, want, 1, cmd, reversing);
      cmd.yaw = want; cmd.pitch = 0;
    } else {
      cmd.yaw = reversing ? want + 1.6 * this.flankSign : want; cmd.pitch = 0;
      cmd.moveY = reversing ? -1 : 1;
    }
  }

  /**
   * A car in a fight: never parked. With a gun aboard, circle the target (in from far, round it
   * at 20-40 m, out when too close) so the gunner and the passengers keep firing; an aggressive
   * driver (or one with nobody aboard to shoot) runs infantry down instead.
   */
  #car(dt, ctx, v, cmd) {
    const t = ctx.target, vs = v.movement.state, self = this.brain.self;
    if (!t || (!ctx.vehicleLos && ctx.dist > 60)) { this.#advance(dt, v, cmd); return; }
    const to = Math.atan2(-(t.pos.x - vs.position.x), -(t.pos.z - vs.position.z));
    const armed = v.seats.some((s) => s.occupant && s.occupant !== self && (s.weapons || s.def.ownWeapon));
    const ram = !t.isVehicle && !t.isObject && ctx.dist < 35 && (this.brain.persona.aggression >= 0.6 || !armed);
    this.orbitT = (this.orbitT ?? 0) - dt;
    if (this.orbitT <= 0) { this.orbitSign = this.brain.rand() < 0.5 ? -1 : 1; this.orbitT = 8 + this.brain.rand() * 6; }
    const want = ram ? to : to + this.orbitSign * (ctx.dist > 40 ? 0.5 : ctx.dist > 20 ? 1.45 : 2.0);
    // Stuck against something mid-fight: back off it.
    this.stuckT = (this.stuckT ?? 0) + dt;
    if (this.stuckT > 2) {
      const moved = this.stuckAt ? Math.hypot(vs.position.x - this.stuckAt.x, vs.position.z - this.stuckAt.z) : 99;
      if (moved < 2) this.reverseUntil = this.brain.time + 1.4;
      this.stuckAt = vs.position.clone(); this.stuckT = 0;
    }
    this.#steerCar(v, want, ram ? 1 : 0.85, cmd, this.brain.time < (this.reverseUntil ?? 0));
    cmd.yaw = to; cmd.pitch = 0;
  }

  /** Wheel and pedals for a car to head along `want`: lift off for a wide corner, brake for a hairpin. */
  #steerCar(v, want, throttle, cmd, reversing = false) {
    if (reversing) { cmd.moveY = -1; cmd.moveX = -this.flankSign; return; }
    const turn = angleDelta(v.yaw, want), sp = v.car.forwardSpeed;
    cmd.moveX = Math.max(-1, Math.min(1, -turn * 2.2));
    cmd.moveY = Math.abs(turn) > 1.3 && sp > 9 ? -1 : Math.abs(turn) > 0.7 && sp > 12 ? 0.2 : throttle;
  }

  /**
   * Cover too tall to skim within `secs` of travel (at `speed`, or as fast as it's going) along
   * a hover's lane: its middle and both edges.
   */
  #wallAhead(v, secs, speed = 0) {
    const s = v.movement.state, sp = Math.hypot(s.velocity.x, s.velocity.z), go = Math.max(sp, speed);
    if (go < 10) return false;
    if (sp > 1) _dir.set(s.velocity.x / sp, 0, s.velocity.z / sp); else _dir.set(-Math.sin(v.yaw), 0, -Math.cos(v.yaw));
    const r = v.def.radius * 0.8;
    for (const side of [0, -1, 1]) {
      _o.set(s.position.x - _dir.z * r * side, s.position.y + 0.6, s.position.z + _dir.x * r * side);
      if (this.brain.world.raycastStatic(_o, _dir, go * secs, { includeWalls: false })) return true;
    }
    return false;
  }

  /** Close to the squad's objective (a car's passengers get out there). */
  #nearObjective(v, r) {
    const o = this.brain.objective, p = v.movement.state.position;
    return !!o && Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < r;
  }

  /** A passenger's own gun at the target, from his seat, led for a projectile; auto guns held. */
  #shootOwn(ctx, cmd, btn) {
    const self = this.brain.self, wc = self.weapons, w = wc?.current;
    if (!w) return;
    const from = self.movement.state.position, tp = ctx.target.pos, sp = w.s.velocity ?? 0;
    const dx = Math.hypot(tp.x - from.x, tp.z - from.z), lead = _m.copy(tp).addScaledVector(ctx.targetVel ?? ZERO, sp ? dx / sp : 0);
    cmd.yaw = Math.atan2(-(lead.x - from.x), -(lead.z - from.z));
    const dy = lead.y + 1.0 - (from.y + 0.7);
    cmd.pitch = w.s.drop && sp ? ballisticPitch(Math.max(1, dx), dy, sp, 9.8 * w.s.drop) : Math.atan2(dy, Math.max(1, dx));
    if (!w.usesHeat && !w.usesBattery && w.mag === 0 && w.reserve > 0) { btn.press('reload'); return; }
    if (ctx.dist > (w.s.range ?? 90) || (w.usesHeat && w.heat > w.s.ammo.max * 0.8)) return;
    if (w.s.fireMode === 'auto' || w.s.fireMode === 'beam' || w.s.fireMode === 'spool') btn.hold('light');
    else btn.pressIfReady('light', wc);
  }

  #flank(dt) {
    this.flankTimer -= dt;
    if (this.flankTimer <= 0) { this.flankSign = this.brain.rand() < 0.5 ? -1 : 1; this.flankTimer = 2 + this.brain.rand() * 2; }
    return this.flankSign;
  }

  /** Where to walk to board `v` (beside its hull, not into it). */
  boardPoint(v, out = new Vector3()) {
    return localToWorld(out, v.movement.state.position, v.yaw, [-(v.def.radius + 0.4), 0, 0]);
  }
}
