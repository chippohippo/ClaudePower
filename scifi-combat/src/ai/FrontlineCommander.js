// FrontlineCommander: turns the frontline into orders for bot squads (one commander per team).
//
//  * Squads of up to 4 bots move and fight together: the leader heads for the objective, members
//    hold slots around it, and everyone respawns on the leader when it's safe.
//  * Every few seconds (and immediately when a sector falls) the commander splits its squads
//    between attacking the points of the sector in front of its line and defending its own points
//    under attack. Priorities: points being captured from us, then enemy points we're closest to
//    taking, then neutral points. Allocation is proportional with a minimum of one squad per
//    attack point, and squads keep their orders unless the plan changed a lot (no thrashing).
//  * Orders are plain data on each brain (`brain.objective`); CombatBotBrain follows the flow
//    field there, fights on the way, then holds the point.

import { Vector3 } from 'three';
import { bus } from '../core/EventBus.js';

export class Squad {
  constructor(team, id, members = []) {
    this.team = team; this.id = id; this.members = members;
    this.objective = null;    // point id
    this.role = null;         // 'attack' | 'defend'
    this.since = 0;
  }
  get leader() { return this.members.find((m) => !m.health.dead) ?? null; }
  get alive() { let n = 0; for (const m of this.members) if (!m.health.dead) n++; return n; }
  /** Centroid of living members (or null). */
  center(out) {
    let n = 0; out.set(0, 0, 0);
    for (const m of this.members) if (!m.health.dead) { out.add(m.movement.state.position); n++; }
    return n ? out.divideScalar(n) : null;
  }
}

export class FrontlineCommander {
  /**
   * @param {number} team
   * @param {FrontlineMode} mode
   * @param {object} o { interval, nav }
   */
  constructor(team, mode, { interval = 4, nav = null } = {}) {
    this.team = team; this.mode = mode; this.nav = nav;
    this.interval = interval;
    this.timer = 0;
    this.time = 0;
    this.squads = [];
    this.off = bus.on('mode:sector', () => { this.timer = 0; });
  }

  dispose() { this.off?.(); }

  update(dt) {
    this.time += dt;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.interval;
    this.#plan();
  }

  #plan() {
    const { attack, defend } = this.mode.objectives(this.team);
    const team = this.team;
    // Priorities.
    const wants = [];
    for (const p of defend) {
      const enemyOn = p.counts[1 - team], losing = team === 0 ? 1 - p.progress : 1 + p.progress; // 0 = safe, 2 = lost
      wants.push({ p, role: 'defend', w: 0.35 + enemyOn * 0.45 + losing * 0.9 });
    }
    for (const p of attack) {
      const gained = team === 0 ? 1 + p.progress : 1 - p.progress; // 0 = enemy-held, 2 = ours
      wants.push({ p, role: 'attack', w: 1 + (p.owner === -1 ? 0.25 : 0) + gained * 0.3, min: 1 });
    }
    if (!wants.length) return;
    const squads = this.squads.filter((s) => s.alive > 0 || s.members.length);
    const n = squads.length;
    // Proportional allocation (largest remainder), at least one squad per attack point when possible.
    const total = wants.reduce((a, x) => a + x.w, 0);
    for (const x of wants) { x.share = (x.w / total) * n; x.slots = Math.floor(x.share); }
    let left = n - wants.reduce((a, x) => a + x.slots, 0);
    for (const x of [...wants].sort((a, b) => (b.share - b.slots) - (a.share - a.slots))) { if (left <= 0) break; x.slots++; left--; }
    for (const x of wants) {
      if (!x.min || x.slots >= x.min) continue;
      const donor = wants.filter((y) => y !== x && y.slots > (y.min ?? 0)).sort((a, b) => b.slots - a.slots)[0];
      if (donor) { donor.slots--; x.slots++; }
    }
    // Keep current orders where they still fit; then fill remaining slots with the nearest squads.
    const byId = new Map(wants.map((x) => [x.p.id, x]));
    const free = [];
    for (const s of squads) {
      const x = byId.get(s.objective);
      if (x && x.slots > 0 && x.role === s.role) { x.slots--; continue; }
      free.push(s);
    }
    const c = new Vector3();
    for (const s of free) {
      const at = s.center(c) ?? this.mode.map.hq[team];
      let best = null, bd = Infinity;
      for (const x of wants) {
        if (x.slots <= 0) continue;
        const d = this.nav ? this.nav.distance(this.nav.field(`pt:${x.p.id}`, x.p.pos.x, x.p.pos.z, x.p.radius * 0.6), at.x, at.z) : at.distanceTo(x.p.pos);
        if (d < bd) { bd = d; best = x; }
      }
      if (!best) best = wants.reduce((a, b) => (b.w > a.w ? b : a));
      best.slots--;
      this.#order(s, best.p, best.role);
    }
    // Refresh the per-bot orders (members change as they respawn into squads).
    for (const s of squads) { const p = this.mode.points[s.objective]; if (p) this.#order(s, p, s.role, true); }
  }

  #order(squad, point, role, refresh = false) {
    if (!refresh && (squad.objective !== point.id || squad.role !== role)) { squad.objective = point.id; squad.role = role; squad.since = this.time; }
    squad.members.forEach((m, slot) => {
      if (!m.brain) return;
      m.brain.objective = { id: point.id, pos: point.pos, radius: point.radius, field: `pt:${point.id}`, role, slot, of: squad.members.length, squad };
    });
  }
}
