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
//    Gunners aim freely and fire; passengers hop out once the dropship is low near the fight.
//  * Bail out when the vehicle is about to blow (being ejected costs HP).

import { angleDelta, localToWorld } from '../core/geom.js';
import { ballisticPitch } from './AbilityPlanner.js';
import { Vector3 } from 'three';

const _m = new Vector3();
const ZERO = new Vector3();

export class VehiclePilot {
  constructor(brain) { this.brain = brain; this.flankSign = 1; this.flankTimer = 0; }

  wantVehicle(ctx) {
    const { self, world, persona } = this.brain;
    if (self.vehicle || persona.usesVehicles === 'never' || self.transform) return null;
    if (ctx.target && ctx.dist < 8) return null; // never walk away from a knife fight
    const always = persona.usesVehicles === 'always';
    // Opportunists decide once per life whether they're in a vehicle mood, and don't take a second
    // vehicle while a teammate already drives one (keeps infantry on the field). Crewing an ally's
    // vehicle as gunner is always fine.
    if (this.lifeRoll === undefined) this.lifeRoll = this.brain.rand();
    const mayDrive = always || (this.lifeRoll <= 0.45 && !world.entities.some((e) => e !== self && e.team === self.team && e.vehicle?.veh.seats[e.vehicle.seat].def.role === 'driver'));
    const maxWalk = always ? 70 : 22;
    let best = null, bd = maxWalk;
    for (const v of world.vehicles.list) {
      if (v.removed || v.team !== self.team || v.health.hp < v.health.max * 0.35) continue;
      if (v.def.gun || v.def.cargo) continue;   // guns and supply trucks have their own crews (SupportCommand)
      const free = v.seats.findIndex((s) => !s.occupant);
      if (free < 0) continue;
      const allyDriven = v.seats.some((s) => s.def.role === 'driver' && s.occupant);
      if (!mayDrive && !(allyDriven && v.seats[free].def.role === 'gunner')) continue;
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
    if (v.health.hp < v.health.max * 0.18 && ctx.underFire && self.vehicle.lock <= 0) { btn.press('interact'); return; }

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
    const heatOk = !w || !w.usesHeat || w.heat < 75;

    if (role === 'gunner') {
      if (!t) return;
      const a = aimAt(t.pos, w?.s.velocity ?? 0, w?.s.drop ?? 0);
      cmd.yaw = a.yaw; cmd.pitch = a.pitch;
      if (ctx.vehicleLos && ctx.dist < 70 && heatOk) btn.hold('light');
      return;
    }

    // ---- driver
    const d = v.def;
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
      if (v.boostCd <= 0 && (ctx.dist > 35 || (rammer && ctx.dist < 18 && ctx.dist > 6))) btn.press('sprint');
      if (Math.abs(angleDelta(v.yaw, a.yaw)) < 0.4 && ctx.vehicleLos && heatOk && ctx.dist < 60) btn.hold('light');
    }
  }

  #advance(dt, v, cmd) {
    const { world, objective } = this.brain;
    const vs = v.movement.state, nav = world.nav;
    if (!objective) return;
    const left = Math.hypot(objective.pos.x - vs.position.x, objective.pos.z - vs.position.z);
    const hold = v.def.model === 'tracked' ? 30 : 10;   // tanks stop short and cover the point
    if (left < hold) { cmd.moveY = 0; cmd.moveX = 0; cmd.yaw = v.yaw; return; }
    if (!(nav && nav.sample(nav.field(objective.field, objective.pos.x, objective.pos.z, objective.radius * 0.6), vs.position.x, vs.position.z, _m))) _m.set(objective.pos.x - vs.position.x, 0, objective.pos.z - vs.position.z).normalize();
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
    } else {
      cmd.yaw = reversing ? want + 1.6 * this.flankSign : want; cmd.pitch = 0;
      cmd.moveY = reversing ? -1 : 1;
    }
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
