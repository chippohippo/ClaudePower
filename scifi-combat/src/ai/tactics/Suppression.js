// Suppression: incoming fire pins soldiers down. Every round that cracks past an enemy soldier,
// every hit and every blast nearby raises their suppression (0..1); it bleeds off once the fire
// stops. Bots read it: suppressed soldiers stay low behind cover and shoot worse, pinned ones
// hug the dirt, and a squad under heavy fire covers instead of bounding. Squads use it on
// purpose: the overwatch team's job is to suppress, so the other team can move.
//
// Cheap at 128 fighters: a bot's round is checked against the soldier it was aimed at and that
// soldier's neighbours (the near miss that matters); a human's round is sampled along its path.

import { bus } from '../../core/EventBus.js';

const _p = { x: 0, y: 0, z: 0 };

export class Suppression {
  /**
   * @param {object} world  CombatWorld (entity(), fightersNear())
   * @param {object} o      { radius (m a round suppresses within), decay (per s), hold (s before decay) }
   */
  constructor(world, { radius = 2.6, decay = 0.32, hold = 0.6 } = {}) {
    this.world = world; this.radius = radius; this.decay = decay; this.hold = hold;
    this.time = 0; this.rounds = 0;
    this.off = [
      bus.on('weapon:tracer', (e) => this.#round(e)),
      bus.on('weapon:hit', (e) => { const v = world.entity(e.victim); if (v && !v.isVehicle) this.add(v, 0.12 + Math.min(0.2, (e.damage ?? 0) / 300)); }),
      bus.on('projectile:explode', (e) => this.#blast(e.point, e.radius, e.ownerId)),
      bus.on('weapon:impact', (e) => { if (e.ownerId !== undefined) this.#near(e.point, e.team, 0.05 + Math.min(0.15, (e.damage ?? 0) / 400), e.ownerId); }),
    ];
  }

  dispose() { this.off.forEach((f) => f()); }

  add(f, amount) {
    if (!f || f.health?.dead) return;
    f.suppression = Math.min(1, (f.suppression ?? 0) + amount);
    f.suppressedAt = this.time;
    f.suppressT = 0;
  }

  update(dt, fighters) {
    this.time += dt;
    for (const f of fighters) {
      if (!f.suppression) continue;
      f.suppressT = (f.suppressT ?? 0) + dt;
      if (f.suppressT > this.hold) f.suppression = Math.max(0, f.suppression - this.decay * dt * (0.6 + f.suppression));
    }
  }

  #round(e) {
    const shooter = this.world.entity(e.id);
    if (!shooter) return;
    const team = shooter.team, w = shooter.weapons?.current?.s;
    const per = (0.05 + Math.min(0.2, (w?.damage?.base ?? 25) / 220)) * (w?.pellets ? 0.35 : 1);
    const [ox, oy, oz] = e.from, [dx, dy, dz] = e.dir, len = e.dist;
    const round = ++this.rounds;
    const aimed = shooter.brain?.target;
    if (aimed && !aimed.isVehicle && aimed.movement) {
      // A bot's round: did it pass near the soldier it was fired at (or their neighbours)?
      const q = aimed.movement.state.position;
      this.world.fightersNear(q, 4, (v) => this.#test(v, team, ox, oy, oz, dx, dy, dz, len, per, round));
      return;
    }
    // A human's round: sample along its path.
    const steps = Math.min(10, Math.ceil(len / 12));
    for (let k = 1; k <= steps; k++) {
      const t = (len * k) / steps;
      _p.x = ox + dx * t; _p.y = oy + dy * t; _p.z = oz + dz * t;
      this.world.fightersNear(_p, 7, (v) => this.#test(v, team, ox, oy, oz, dx, dy, dz, len, per, round));
    }
  }

  #test(v, team, ox, oy, oz, dx, dy, dz, len, per, round) {
    if (v.team === team || v.isVehicle || v.isDeployable || !v.movement || v.health?.dead) return;
    const p = v.movement.state.position;
    // Closest approach of the round to the soldier's chest.
    const px = p.x - ox, py = p.y + 1.1 - oy, pz = p.z - oz;
    const t = Math.max(0, Math.min(len, px * dx + py * dy + pz * dz));
    const cx = px - dx * t, cy = py - dy * t, cz = pz - dz * t;
    const d = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (d >= this.radius || v.suppressRound === round) return;
    v.suppressRound = round;   // one round, one increment
    const k = 1 - d / this.radius;
    this.add(v, per * k);
    // The crack makes him flinch: his body (the rig, fighter:nearMiss), and a person's aim jumps a
    // little (a bot's shooting worse under fire is its suppression already).
    if (!v.brain) v.weapons?.flinch?.(4 + 8 * k, { x: ox, z: oz });
    bus.emit('fighter:nearMiss', { id: v.id, from: [ox, oy, oz], k });
  }

  #near(point, team, amount, ownerId) {
    const shooter = this.world.entity(ownerId);
    const t = team ?? shooter?.team;
    this.world.fightersNear(point, this.radius + 1, (v) => {
      if (v.team === t || v.isVehicle || v.isDeployable || !v.movement) return;
      const p = v.movement.state.position, d = Math.hypot(p.x - point.x, p.z - point.z);
      if (d < this.radius) this.add(v, amount * (1 - d / this.radius));
    });
  }

  #blast(point, radius, ownerId) {
    const shooter = this.world.entity(ownerId), team = shooter?.team, reach = Math.max(4, radius * 2.5);
    this.world.fightersNear(point, reach, (v) => {
      if ((team !== undefined && v.team === team) || v.isVehicle || v.isDeployable || !v.movement) return;
      const p = v.movement.state.position, d = Math.hypot(p.x - point.x, p.z - point.z);
      if (d < reach) this.add(v, 0.55 * (1 - d / reach) + 0.1);
    });
  }
}
