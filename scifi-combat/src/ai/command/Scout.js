// Scout: one soldier sent ahead of his squad to get eyes on a place, so the commander and the guns
// can see what's there (the commander's `scout` order; FrontlineCommander runs one per squad).
//
//  * Who goes: the squad's marksman if it has one, else its infiltrator, else whoever isn't leading
//    it. He's detached: SquadTactics plans without him until he's back.
//  * Where to: a vantage point 60-110 m short of the place, on our side of it, with a clear line of
//    sight to it (ground he can stand on; cover there if there is any; away from enemies we know of).
//  * Going there he runs while far, and fires only at an enemy right on top of him: a scout who
//    starts a firefight isn't scouting. There he goes low in cover facing the place and keeps watch:
//    twice a second he sweeps everything within `range` m he has a line of sight to into the team's
//    intel (spotted by a scout: the guns can fire on it), and the ground round him counts as watched.
//    He reports what he sees over the radio.
//  * He comes back to his squad when his watch is over (`hold` s), when he's hit or an enemy gets
//    within 20 m of him, or when he's called off.

import { Vector3 } from 'three';

const RINGS = [60, 85, 110];
const ANGLES = [-70, -45, -22, 0, 22, 45, 70];
const _o = new Vector3(), _d = new Vector3();

export class ScoutTask {
  /**
   * @param {object} o { world, map, mode, squad, member, at: {x, z}, range, hold, tmap, intel, say(member, kind, vars) }
   */
  constructor({ world, map, mode, squad, member, at, range = 130, hold = 75, tmap = null, intel = null, say = null }) {
    Object.assign(this, { world, map, mode, squad, member, at, range, hold, tmap, intel, say });
    this.team = squad.team;
    this.state = 'going';
    this.time = 0; this.sweepT = 0; this.reportT = 0; this.watchFrom = 0;
    this.seen = 0;
    member.detached = this;
    this.vantage = this.#vantage();
  }

  get done() { return this.state === 'done'; }

  /** Call him back (a new order, the squad gone). */
  end() {
    if (this.state === 'done') return;
    this.state = 'done';
    this.intel?.unwatch(this.member);
    if (this.member.detached === this) this.member.detached = null;
    if (this.member.brain) this.member.brain.order = null;
  }

  update(dt) {
    if (this.state === 'done') return;
    const m = this.member;
    this.time += dt;
    if (m.health.dead || m.squad !== this.squad) { this.end(); return; }
    if (m.health.downed || m.vehicle) return;
    const p = m.movement.state.position, V = this.vantage;
    // Hit, or an enemy on top of him: back to the squad.
    if (this.state !== 'returning' && (m.health.sinceDamage < 1.5 || this.#enemyWithin(p, 20))) {
      this.state = 'returning';
      this.intel?.unwatch(m);
      this.say?.(m, 'fallback');
    }
    if (this.state === 'going') {
      const d = Math.hypot(V.x - p.x, V.z - p.z);
      if (d < 2.5) { this.state = 'watching'; this.watchFrom = this.time; this.intel?.watch(m, this.range); }
      this.#order({ kind: 'move', pos: { x: V.x, z: V.z }, spot: V.spot ?? null, sprint: d > 25, fire: 'hidden', face: this.at, arrive: 2, why: 'scouting' });
    }
    if (this.state === 'watching') {
      this.#order({ kind: 'overwatch', pos: { x: V.x, z: V.z }, spot: V.spot ?? null, fire: 'hidden', face: this.at, stance: V.spot?.fire === 'over' || V.spot?.fire === 'around' ? 'crouch' : 'prone', arrive: 1.5, why: 'on watch' });
      if ((this.sweepT -= dt) <= 0) { this.sweepT = 0.5; this.#sweep(p); }
      // On the radio: what he sees (when there's something to see, or it's changed), every 12 s at most.
      if ((this.reportT -= dt) <= 0 && this.seen !== this.told && (this.seen > 0 || this.told === undefined)) { this.reportT = 12; this.told = this.seen; this.say?.(m, 'eyes', { n: this.seen || 'no', place: this.at.name ?? 'the objective' }); }
      if (this.time - this.watchFrom > this.hold) { this.state = 'returning'; this.intel?.unwatch(m); }
    }
    if (this.state === 'returning') {
      const lead = this.squad.members.find((q) => q !== m && !q.health.dead && !q.health.downed);
      if (!lead) { this.end(); return; }
      const lp = lead.movement.state.position, d = Math.hypot(lp.x - p.x, lp.z - p.z);
      if (d < 12) { this.end(); return; }
      this.#order({ kind: 'move', pos: { x: lp.x, z: lp.z }, sprint: true, fire: 'move', arrive: 8, follow: true, why: 'back to the squad' });
    }
  }

  #order(o) { if (this.member.brain) { o.squad = this.squad; o.issued = this.time; this.member.brain.order = o; } }

  /** Everything within range he has a line of sight to goes into the team's intel (spotted by a scout). */
  #sweep(p) {
    const team = this.team, list = [];
    this.world.fightersNear(p, this.range, (e) => {
      if (e.team === team || e.health.dead || e.isDeployable || !(e.team === 0 || e.team === 1)) return;
      const q = e.movement.state.position, d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d <= this.range) list.push([d, e]);
    });
    list.sort((a, b) => a[0] - b[0]);
    let n = 0;
    for (const [, e] of list.slice(0, 8)) {
      const q = e.movement.state.position;
      if (this.#los(p.x, p.y + 1.2, p.z, q.x, q.y + 1.1, q.z)) { this.intel?.spot(e, this.member.id, true); n++; }
    }
    this.seen = Math.max(n, this.intel ? this.intel.near(this.at.x, this.at.z, 45, 6) : n);
  }

  #enemyWithin(p, r) {
    let found = false;
    this.world.fightersNear(p, r, (e) => {
      if (found || e.team === this.team || e.health.dead || e.health.downed || !(e.team === 0 || e.team === 1)) return;
      const q = e.movement.state.position;
      if (Math.hypot(q.x - p.x, q.z - p.z) < r) found = true;
    });
    return found;
  }

  /** A clear line of sight from a to b (cover and the lie of the ground in the way)? */
  #los(ax, ay, az, bx, by, bz) {
    _d.set(bx - ax, by - ay, bz - az);
    const L = _d.length() || 1;
    return !this.world.sight(_o.set(ax, ay, az), _d.divideScalar(L), L - 0.4);
  }

  /**
   * Where to watch from: rings round the place on our side of it, walkable, the most of it in sight
   * from a standing eye, nearest him, clear of the enemies we know of; a cover spot there if any.
   */
  #vantage() {
    const at = this.at, team = this.team, me = this.member.movement.state.position, nav = this.world.nav, t = this.map.terrain;
    // Our side of the place: toward our HQ.
    const hq = this.map.hq[team], base = Math.atan2(hq.z - at.z, hq.x - at.x);
    let best = null, bs = -Infinity;
    for (const r of RINGS) for (const a of ANGLES) {
      const ang = base + (a * Math.PI) / 180, x = at.x + Math.cos(ang) * r, z = at.z + Math.sin(ang) * r;
      if (nav?.blocked?.(x, z)) continue;
      const y = t ? t.height(x, z) : 0;
      let sees = 0;
      for (const [ox, oz] of [[0, 0], [8, 0], [-8, 0], [0, 8], [0, -8]]) {
        const tx = at.x + ox, tz = at.z + oz, ty = (t ? t.height(tx, tz) : 0) + 1.1;
        if (this.#los(x, y + 1.6, z, tx, ty, tz)) sees++;
      }
      const enemies = this.intel ? this.intel.near(x, z, 35, 20) : 0;
      const score = sees * 100 - Math.hypot(x - me.x, z - me.z) * 0.4 - enemies * 60 - r * 0.15;
      if (score > bs) { bs = score; best = { x, z, y, sees }; }
    }
    if (!best) {
      const x = at.x + Math.cos(base) * RINGS[0], z = at.z + Math.sin(base) * RINGS[0];
      best = { x, z, y: t ? t.height(x, z) : 0, sees: 0 };
    }
    // Cover right there, if any (low behind it, the place in front).
    const s = this.tmap?.best(best.x, best.z, 6, (q) => Math.hypot(q.x - best.x, q.z - best.z) + (this.tmap.covers(q, at.x, at.z) ? 0 : 6), this.member.id, 0);
    if (s) { best.spot = s; best.x = s.x; best.z = s.z; }
    return best;
  }
}
