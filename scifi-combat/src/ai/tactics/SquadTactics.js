// SquadTactics: the squad leader's head. Turns the commander's order (take this point, hold that
// one) into a plan for its soldiers, re-thought twice a second, and hands each bot an order its
// CombatBotBrain carries out with its own aim, cover use and gunplay.
//
// Phases (one at a time, with hysteresis):
//  * advance   - no contact, far from the objective: a wedge around the leader, spaced 5 m, at
//                a run along the route (no blob, no conga line).
//  * jumpoff   - attacking across our own trench line: man its firing positions facing the enemy
//                and wait for the whistle (the commander syncs every squad on that line), then
//                everyone goes over the top together.
//  * contact   - enemies seen within ~75 m, or under fire: bounding overwatch. One fire team
//                holds cover and suppresses what the squad has seen while the other bounds 15-22 m
//                to the next cover (craters, walls, ruins), then they swap. Nobody runs across
//                open ground alone while the enemy is free to shoot.
//  * assault   - the objective is close: rush onto the point, take cover inside its radius. Also
//                when the commander storms it (storm(): he has the men there to take it, so
//                everyone goes in at once from up to 120 m out, whatever's shooting).
//  * clear     - enemies in a building or trench bay, or rooms right at the objective: stack on a
//                doorway (two flanking it, two covering), frag out if anyone has a grenade, enter
//                and split to the corners, sweep, mark the room cleared, move to the next.
//  * hold      - our point (or ordered to defend it): two anchors inside the capture radius, the
//                rest form a line ~30 m out toward the enemy: a trench if there is one there,
//                else the cover along that line, else they dig in (foxhole, sandbags, then a
//                trench to the next position: Fortify). If enemies get onto the point: counter-attack.
//  * regroup   - scattered after respawns: close up on the leader.
//  * charge    - only when desperate: the point we defend is about to fall with nobody on it,
//                the last man standing is hurt and cornered, or the team is out of tickets or time.
//                (Sword fighters close in on their own: that's their weapon, not a charge.)
//  * follow    - a human leads the squad: wedge on them while they move, cover around them when
//                they stop.
//  * directed  - a human leading the squad pinged a place or a point (Pings): the squad goes and
//                takes cover round it (on a point, inside its circle), facing the enemy, for 45 s
//                or until they ping regroup.
//  * fallback  - morale: half the squad killed within 20 s breaks it; everyone sprints back
//                to cover 40 m behind (the trench behind, where there is one) for 15 s, then regroups.
//
// In contact, a squad pinned down for 4 s (its movers too suppressed to bound) flanks: the second
// fire team goes round one side, 60° off the line to the enemy, to cover about as far from him as
// the squad is, while the first suppresses; there, it hits him from the side, and the squad goes
// back to bounding. The squad talks as it goes (Barks): "Moving!", "Covering!", "Flanking left!",
// "Suppressing fire!", "Fall back!".
//
// Shared knowledge: every member's sightings and whoever shot at a member become squad
// contacts (last seen position, 15 s memory), so a soldier who can't see the enemy still knows
// where to look, where to suppress and which way cover has to face.

import { Vector3 } from 'three';
import { bus } from '../../core/EventBus.js';
import { mulberry32 } from '../../world/Terrain.js';

const DIR = [1, -1];          // team 0 pushes toward +X
const PLAN = 0.5;
const CONTACT = 75;           // contacts closer than this put the squad in contact
const RECENT = 6;             // seconds a sighting stays "current"
const MEMORY = 15;
const _v = new Vector3();
const _w = new Vector3();

const pos = (m) => m.movement.state.position;
const isUp = (m) => !m.health.dead && !m.health.downed;
const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class SquadTactics {
  /**
   * @param {Squad} squad
   * @param {object} o { world, map, tmap: TacticalMap, mode: FrontlineMode, commander, seed }
   */
  constructor(squad, { world, map, tmap, mode, commander = null, seed = 1 }) {
    this.squad = squad; this.team = squad.team; this.world = world; this.map = map; this.tmap = tmap; this.mode = mode; this.cmdr = commander;
    this.rand = mulberry32(seed * 977 + squad.id * 131 + squad.team * 7);
    this.time = 0; this.next = (squad.id % 10) * (PLAN / 10);
    this.phase = 'advance'; this.since = 0; this.why = '';
    this.contacts = new Map();            // enemy id -> { e, pos, t }
    this.threat = new Vector3(); this.hasThreat = false;
    this.center = new Vector3();
    this.bound = null;                    // { moving, started, targets: Map(member -> {x, z, spot}) }
    this.clear = null;                    // { R, door, stage, t, started }
    this.jump = null;                     // { T, ready, gone, since, at }
    this.rush = null;                     // { until, targets } the first rush after the whistle
    this.charge = null;                   // { why, until }
    this.holdSpots = new Map();           // member -> spot
    this.lastObjective = null;
    this.flank = null;                    // { team, side, at, started, hit } the second fire team going round
    this.pinnedT = 0;                     // s the squad has been pinned in contact
    this.losses = [];                     // times members were killed (morale)
    this.alive = new Set();               // members alive at the last plan
    this.broken = null;                   // { until, at } falling back
  }

  /** Called every tick; plans every PLAN seconds (staggered across squads). */
  update(dt) {
    this.time += dt;
    this.next -= dt;
    if (this.next > 0) return;
    this.next = PLAN;
    this.plan();
  }

  /** The commander's storm: for `seconds`, every man of the squad onto the point it's attacking, whatever's shooting. */
  storm(seconds = 20) { this.stormUntil = this.time + seconds; this.next = 0; }

  /** A ping on an enemy (Pings): the squad has him, and turns its guns on him. */
  mark(e) {
    this.#spot(e, this.time); this.next = 0;
    const m = this.squad.members.find((x) => x.brain && isUp(x) && !x.vehicle);
    if (m) this.world.barks?.say(m, 'spotted');
  }

  /**
   * A person leading this squad pinged somewhere (Pings): { kind: 'move' | 'attack' | 'defend', pos,
   * point, radius }; the squad goes there for 45 s. null: regroup on them.
   */
  send(o) {
    this.sentTo = o ? { ...o, until: this.time + 45 } : null; this.next = 0;
    const m = this.squad.members.find((x) => x.brain && isUp(x) && !x.vehicle);
    const name = o?.point != null ? this.mode.points.find((p) => p.id === o.point)?.name : null;
    if (m) this.world.barks?.say(m, o ? 'onmark' : 'regroup', { place: name ?? 'the mark' });
  }

  /** The whistle: the commander sends this squad over the top (the rush starts at once). */
  overTheTop() {
    if (!this.jump) return;
    this.jump.gone = true; this.jump.at = this.time;
    this.rushDue = true; this.next = 0;
  }

  // ---------------------------------------------------------------- planning
  plan() {
    const sq = this.squad;
    const up = sq.members.filter((m) => isUp(m) && !m.vehicle && !m.detached);   // crews fight with their vehicle; a scout sent ahead has his own orders
    for (const m of sq.members) if (m.brain && !up.includes(m) && !m.detached) m.brain.order = null;
    if (!up.length) { this.#setPhase('down'); return; }
    this.#centroid(up);
    this.#sense(up);
    // Morale: count the members killed since the last plan (the downed can still be got up).
    for (const m of this.alive) if (m.health.dead) this.losses.push(this.time);
    this.alive = new Set(sq.members.filter((m) => !m.health.dead));
    while (this.losses.length && this.time - this.losses[0] > 20) this.losses.shift();
    const obj = this.#objective();
    if (obj?.point.id !== this.lastObjective) { this.lastObjective = obj?.point.id ?? null; this.jump = null; this.clear = null; this.holdSpots.clear(); }
    const human = up.find((m) => !m.brain);
    if (human && this.sentTo && this.time < this.sentTo.until) { this.#setPhase('directed', `to ${this.sentTo.kind} at the mark`); this.#directed(up, obj); return; }
    if (human) { this.#setPhase('follow', 'a human leads'); this.#follow(up, human, obj); return; }
    if (!obj) { this.#setPhase('regroup', 'no orders'); this.#regroup(up); return; }
    this.#defaultThreat(obj);
    if (this.#fallback(up)) return;
    const phase = this.#choose(up, obj);
    this.#setPhase(phase, this.why);
    if (this.rushDue) {
      // The whistle just went: the whole squad goes over together, each man to cover 15-25 m out.
      this.rushDue = false;
      if (phase !== 'charge') { this.rush = { until: this.time + 9, targets: this.#boundTargets(up, obj, up) }; this.#setPhase('contact', 'over the top'); this.#rushOrders(up); return; }
    }
    if (this.rush && phase !== 'contact' && phase !== 'charge' && !(this.stormUntil > this.time) && this.time < this.rush.until) { this.#rushOrders(up); return; }
    switch (phase) {
      case 'charge': this.#chargeOrders(up, obj); break;
      case 'hold': this.#hold(up, obj); break;
      case 'assault': this.#assault(up, obj); break;
      case 'clear': this.#clearRoom(up, obj); break;
      case 'jumpoff': this.#jumpoff(up, obj); break;
      case 'contact': this.#contact(up, obj); break;
      case 'regroup': this.#regroup(up); break;
      default: this.#advance(up, obj);
    }
  }

  #setPhase(p, why = '') {
    if (p !== this.phase) {
      const from = this.phase;
      this.phase = p; this.since = this.time; this.why = why;
      if (p !== 'contact') this.bound = null;
      if (p !== 'hold') this.holdSpots.clear();
      bus.emit('squad:phase', { team: this.team, squad: this.squad.id, phase: p, from, why });
    }
    this.why = why;
  }

  #centroid(up) {
    this.center.set(0, 0, 0);
    for (const m of up) this.center.add(pos(m));
    this.center.divideScalar(up.length);
  }

  /** Squad contacts: what members see, and whoever shot at them. */
  #sense(up) {
    const now = this.time, team = this.team;
    for (const m of up) {
      const b = m.brain;
      const t = b?.target;
      if (t && b.sawAt >= b.time - 0.6 && !t.health?.dead) this.#spot(t, now);
      if (m.health.lastBy !== undefined && m.health.sinceDamage < 1.5) {
        const e = this.world.entity(m.health.lastBy);
        if (e && this.world.hostile(m, e) && e.movement && !e.health?.dead && pos(e).distanceTo(pos(m)) < 120) { this.#spot(e, now); this.world.intel?.[team]?.spot(e, m.id); }
      }
    }
    for (const [id, c] of this.contacts) if (now - c.t > MEMORY || c.e.health?.dead) this.contacts.delete(id);
    // Threat: the nearest recent contacts, weighted toward the closest.
    let wsum = 0;
    this.threat.set(0, 0, 0);
    const list = [...this.contacts.values()].filter((c) => now - c.t < RECENT).sort((a, b) => d2(a.pos, this.center) - d2(b.pos, this.center)).slice(0, 3);
    for (const [k, c] of list.entries()) { const w = 1 / (k + 1); this.threat.addScaledVector(c.pos, w); wsum += w; }
    this.hasThreat = wsum > 0;
    if (this.hasThreat) this.threat.divideScalar(wsum);
    // Rooms where enemies were seen are hot (someone has to go in and clear them).
    for (const c of list) { const R = this.tmap?.roomAt(c.pos.x, c.pos.z); if (R) R.hot[team] = now; }
  }

  #spot(e, now) {
    let c = this.contacts.get(e.id);
    if (!c) { c = { e, pos: new Vector3(), t: now }; this.contacts.set(e.id, c); }
    c.pos.copy(pos(e)); c.t = now;
  }

  /** Nearest recent contact distance from a point (Infinity if none). */
  #nearest(p, recent = RECENT) {
    let best = Infinity;
    for (const c of this.contacts.values()) if (this.time - c.t < recent) best = Math.min(best, d2(c.pos, p));
    return best;
  }

  #objective() {
    const sq = this.squad, p = this.cmdr?.target(sq.objective) ?? this.mode.points[sq.objective];
    if (!p) return null;
    // A field the whole line shares leads to the nearest lane: once we're up at the line, our own
    // lane is along it (A* and straight lines from here).
    const field = p.shared && Math.abs(this.center.x - p.pos.x) < 40 ? null : p.field ?? `pt:${p.id}`;
    return { point: p, pos: p.pos, radius: p.radius, role: sq.role, field };
  }

  /** No contacts: the threat is where the enemy has to come from. */
  #defaultThreat(obj) {
    if (this.hasThreat) return;
    const dir = DIR[this.team];
    if (obj.role === 'defend' || obj.point.owner === this.team) this.threat.set(obj.pos.x + dir * 70, 0, obj.pos.z);
    else this.threat.set(obj.pos.x + dir * 30, 0, obj.pos.z);
  }

  #choose(up, obj) {
    const p = obj.point, team = this.team, enemy = 1 - team;
    const dPoint = d2(this.center, p.pos), near = this.#nearest(this.center);
    // Charges: only when desperate.
    const why = this.#desperate(up, obj, dPoint, near);
    if (why) { this.charge = { why, until: this.time + 8 }; this.why = why; return 'charge'; }
    if (this.phase === 'charge' && this.charge && this.time < this.charge.until && near < 25) { this.why = this.charge.why; return 'charge'; }
    this.charge = null;
    // A stretch of the front line: get there (over the top with the wave, where our trench is in
    // the way), then hold it. No point to take: it holds the ground between the points.
    if (obj.role === 'line') {
      const T = this.#jumpTrench(obj);
      if (T && !(this.jump?.gone && this.jump.T === T)) {
        if (this.jump?.T !== T) this.jump = { T, ready: false, gone: false, since: this.time, at: 0, positions: new Map() };
        this.why = 'in the jump-off trench'; return 'jumpoff';
      }
      if (dPoint < obj.radius + (this.phase === 'hold' ? 30 : 15)) { this.why = 'holding the line'; return 'hold'; }
      if (near < CONTACT || this.#suppressed(up) > 0.35) { this.why = near < CONTACT ? 'contact' : 'under fire'; return 'contact'; }
      if (this.phase === 'contact' && this.time - this.since < 4) { this.why = 'contact'; return 'contact'; }
      if (this.#roomToClear(obj)) { this.why = 'clearing'; return 'clear'; }
      if (this.#scattered(up) && near > CONTACT * 1.5) { this.why = 'scattered'; return 'regroup'; }
      this.why = 'moving up to the line'; return 'advance';
    }
    // Defending, or the point is ours: hold it; counter-attack if the enemy is on it.
    if (obj.role === 'defend' || p.owner === team) {
      if (p.counts[enemy] > 0 && dPoint < 70) { this.why = 'enemy on our point'; return 'assault'; }
      if (dPoint > 80) { this.why = near < CONTACT ? 'moving up under fire' : 'moving to defend'; return near < CONTACT ? 'contact' : 'advance'; }
      this.why = 'holding'; return 'hold';
    }
    // Attacking: from our own trench, over the top together; then clear what's in the way.
    const T = this.#jumpTrench(obj);
    if (T && !(this.jump?.gone && this.jump.T === T)) {
      if (this.jump?.T !== T) this.jump = { T, ready: false, gone: false, since: this.time, at: 0, positions: new Map() };
      this.why = 'in the jump-off trench'; return 'jumpoff';
    }
    // Stormed (the commander has the men here to take it): onto the point, now, rooms or no rooms.
    if (this.stormUntil > this.time && dPoint < 120) { this.why = 'storming the point'; return 'assault'; }
    if (this.#roomToClear(obj)) { this.why = 'clearing'; return 'clear'; }
    if (dPoint < obj.radius + 22) { this.why = 'on the objective'; return 'assault'; }
    if (near < CONTACT || this.#suppressed(up) > 0.35) { this.why = near < CONTACT ? 'contact' : 'under fire'; return 'contact'; }
    if (this.phase === 'contact' && this.time - this.since < 4) { this.why = 'contact'; return 'contact'; } // don't flip-flop
    if (this.#scattered(up) && near > CONTACT * 1.5) { this.why = 'scattered'; return 'regroup'; }
    this.why = 'advancing'; return 'advance';
  }

  #desperate(up, obj, dPoint, near) {
    const p = obj.point, team = this.team, enemy = 1 - team, m = this.mode;
    // The point we hold is about to fall and none of us is on it.
    const held = team === 0 ? p.progress : -p.progress;   // +1 = fully ours
    if ((p.owner === team || obj.role === 'defend') && p.counts[enemy] > 0 && p.counts[team] === 0 && held < 0.4 && m.capturable(p) && dPoint < 40) return 'the point is falling';
    // The last man standing, hurt, with the enemy on top of him.
    if (up.length === 1 && this.squad.members.length > 1) {
      const h = up[0].health;
      if ((h.hp + h.shield) / (h.max + h.maxShield) < 0.35 && this.#nearest(pos(up[0]), 3) < 12) return 'last stand';
    }
    // Out of tickets, or out of time and losing: the final push.
    if (obj.role === 'attack' && dPoint < 90) {
      const low = m.tickets[team] <= Math.max(5, m.cfg.tickets * 0.04);
      const late = m.cfg.timeLimit - m.time < 40 && this.#losing();
      if (low || late) return low ? 'out of tickets' : 'out of time';
    }
    return null;
  }

  #losing() {
    const held = [0, 1].map((t) => this.mode.sectors.filter((s) => s.kind !== 'hq' && s.owner === t).length);
    return held[this.team] < held[1 - this.team] || (held[0] === held[1] && this.mode.tickets[this.team] < this.mode.tickets[1 - this.team]);
  }

  #suppressed(up) { let s = 0; for (const m of up) s += m.suppression ?? 0; return s / up.length; }

  #scattered(up) {
    const lead = up[0];
    return up.filter((m) => d2(pos(m), pos(lead)) > 45).length > up.length / 2;
  }

  // ---------------------------------------------------------------- routes
  /** A point `dist` metres along the route from `from` toward the objective (flow field). */
  #ahead(from, obj, dist, out) {
    const nav = this.world.nav, f = obj.field ? nav?.want(obj.field, obj.pos.x, obj.pos.z, obj.radius * 0.6) : null;
    out.set(from.x, 0, from.z);
    if (!f) { _v.set(obj.pos.x - from.x, 0, obj.pos.z - from.z).normalize(); return out.addScaledVector(_v, dist); }
    for (let walked = 0; walked < dist; walked += 2) {
      if (!nav.sample(f, out.x, out.z, _v)) break;
      out.addScaledVector(_v, 2);
    }
    return out;
  }

  #routeLeft(p, obj) {
    const nav = this.world.nav, f = nav?.fields.get(obj.field), r = f ? nav.distance(f, p.x, p.z) : Infinity;
    return r < Infinity ? r : d2(p, obj.pos);   // no field yet, or beyond its reach
  }

  /** The direction the route runs at a point (unit, XZ). */
  #routeDir(p, obj, out) {
    const nav = this.world.nav, f = nav?.fields.get(obj.field);
    if (!f || !nav.sample(f, p.x, p.z, out)) out.set(obj.pos.x - p.x, 0, obj.pos.z - p.z).normalize();
    return out;
  }

  // ---------------------------------------------------------------- orders
  #order(m, o) {
    if (!m.brain) return;
    o.phase = this.phase; o.squad = this.squad; o.issued = this.time;
    m.brain.order = o;
  }

  /** The best free cover spot near `at` facing the threat (null if none within r). */
  #cover(m, at, r, { avoid = [], prefer = null, inside = null } = {}) {
    if (!this.tmap) return null;
    const T = this.threat;
    return this.tmap.best(at.x, at.z, r, (s) => {
      if (inside && d2(s, inside.p) > inside.r) return Infinity;
      let v = d2(s, at);
      const c = this.tmap.covers(s, T.x, T.z);
      if (!c) v += 12;
      if (s.fire === 'hide') v += 3;
      if (prefer && s.kind === prefer) v -= 3;
      for (const a of avoid) if (a && d2(s, a) < 4) v += 15;
      return v;
    }, m.id, this.time);
  }

  #advance(up, obj) {
    const lead = up[0], lp = pos(lead);
    // The leader slows to a jog when the squad has fallen behind, so it closes up on the move.
    const behind = up.some((m) => d2(pos(m), lp) > 22);
    this.#order(lead, { kind: 'move', pos: obj.pos, field: obj.field, sprint: !behind, fire: 'move', why: 'lead' });
    const fwd = this.#routeDir(lp, obj, _w);
    const rx = -fwd.z, rz = fwd.x;
    // Wedge: 5 m out to each side and 4 m back per rank.
    up.slice(1).forEach((m, k) => {
      const rank = Math.floor(k / 2) + 1, side = k % 2 ? 1 : -1;
      const x = lp.x + rx * side * 5 * rank - fwd.x * 4 * rank, z = lp.z + rz * side * 5 * rank - fwd.z * 4 * rank;
      const far = Math.hypot(pos(m).x - x, pos(m).z - z) > 6;
      this.#order(m, { kind: 'move', pos: { x, z }, sprint: lead.movement.state.sprinting || far, fire: 'move', arrive: 1.5, follow: true, why: 'wedge' });
    });
  }

  #regroup(up) {
    const lead = up[0], lp = pos(lead);
    const s = this.#cover(lead, lp, 10);
    this.#order(lead, { kind: 'hold', pos: s ?? { x: lp.x, z: lp.z }, spot: s, fire: 'cover', face: this.threat, why: 'waiting for the squad' });
    if (s) this.tmap.reserve(s, lead.id, this.time);
    up.slice(1).forEach((m, k) => {
      const a = (k / Math.max(1, up.length - 1)) * Math.PI * 2;
      this.#order(m, { kind: 'move', pos: { x: lp.x + Math.cos(a) * 3.5, z: lp.z + Math.sin(a) * 3.5 }, sprint: true, fire: 'move', arrive: 2, why: 'regroup' });
    });
  }

  /** The first rush over the top: the whole wave goes, each man to his first cover. */
  #rushOrders(up) {
    for (const m of up) {
      const t = this.rush.targets.get(m);
      if (t) this.#order(m, { kind: 'bound', pos: t, spot: t.spot, sprint: true, fire: 'move', face: this.threat, arrive: 1.2, overTop: true, why: 'over the top' });
    }
  }

  /** Bounding overwatch: one team covers while the other moves cover to cover. */
  #contact(up, obj) {
    const now = this.time;
    // Still in the rush over the top: everyone keeps going until they reach their first cover.
    const R = this.rush;
    if (R && now < R.until && up.some((m) => { const t = R.targets.get(m); return t && d2(pos(m), t) > 1.6; })) { this.#rushOrders(up); return; }
    if (R) { this.rush = null; this.bound = { moving: 0, started: now, targets: R.targets }; }
    const teams = up.length >= 2 ? [up.filter((_, i) => i % 2 === 0), up.filter((_, i) => i % 2 === 1)] : [up];
    let b = this.bound;
    if (!b) b = this.bound = { moving: 0, started: now - 10, targets: new Map() };
    // A squadmate being revived: everyone else holds and covers (no bounds).
    const reviving = up.some((m) => m.brain && this.world.revives?.jobOf?.(m.id));
    const movers = teams[b.moving % teams.length];
    const arrived = movers.every((m) => { const t = b.targets.get(m); return !t || d2(pos(m), t) < 1.6; });
    const pinned = this.#suppressed(movers) > 0.7;
    // Pinned for 4 s with the enemy where we know: the second fire team goes round his flank.
    this.pinnedT = this.#suppressed(movers) > 0.55 || this.#suppressed(up) > 0.4 ? this.pinnedT + PLAN : Math.max(0, this.pinnedT - PLAN);
    if (!this.flank && !reviving && this.pinnedT >= 4 && this.hasThreat && up.length >= 3 && teams.length > 1) this.#startFlank(teams);
    if (this.flank && this.#flankOrders(teams)) return;
    if (!reviving && (arrived || now - b.started > 8) && now - b.started > 1.2 && !pinned) {
      b.moving = teams.length > 1 ? 1 - (b.moving % 2) : 0;
      b.started = now;
      b.targets = this.#boundTargets(teams[b.moving], obj, up);
      if (teams.length > 1) { this.world.barks?.say(teams[b.moving][0], 'moving'); this.world.barks?.say(teams[1 - b.moving][0], 'covering'); }
    }
    for (const [i, team] of teams.entries()) {
      const moving = i === b.moving && teams.length > 1 ? !reviving : teams.length === 1 && !reviving && now - b.started < 6;
      for (const m of team) {
        const t = b.targets.get(m);
        if (moving && t) {
          this.#order(m, { kind: 'bound', pos: t, spot: t.spot, sprint: true, fire: 'move', face: this.threat, arrive: 1.2, why: 'bounding' });
        } else {
          // Overwatch: hold the cover we're at (or the nearest within 8 m) and suppress.
          const here = pos(m);
          const keep = t && d2(here, t) < 2 ? t.spot : null;
          const s = keep && keep.alive ? keep : this.#cover(m, here, 8, { avoid: [...b.targets.values()] });
          if (s) this.tmap.reserve(s, m.id, now);
          this.#order(m, { kind: 'overwatch', pos: s ?? { x: here.x, z: here.z }, spot: s, fire: 'cover', face: this.threat, suppress: this.hasThreat ? this.threat : null, arrive: 1, why: 'covering' });
        }
      }
    }
  }

  /**
   * Flanking: a point 60° round the enemy from the squad, about as far from him as we are
   * (20-40 m), on the side with more cover there; the second fire team goes to cover near it.
   */
  #startFlank(teams) {
    const T = this.threat, c = this.center;
    let vx = c.x - T.x, vz = c.z - T.z;
    const L = Math.hypot(vx, vz) || 1, dist = Math.max(20, Math.min(40, L));
    vx /= L; vz /= L;
    let best = null;
    for (const side of [1, -1]) {
      const a = (side * Math.PI) / 3, ca = Math.cos(a), sa = Math.sin(a);
      const at = { x: T.x + (vx * ca - vz * sa) * dist, z: T.z + (vx * sa + vz * ca) * dist };
      if (this.map.bounds && (at.x < this.map.bounds.minX + 5 || at.x > this.map.bounds.maxX - 5 || at.z < this.map.bounds.minZ + 5 || at.z > this.map.bounds.maxZ - 5)) continue;
      let cover = 0;
      this.tmap?.query(at.x, at.z, 10, () => { cover++; });
      const score = cover + this.rand();
      if (!best || score > best.score) best = { side, at, score };
    }
    if (!best) { this.pinnedT = 0; return; }
    const team = teams[1];
    this.flank = { team, side: best.side, at: best.at, started: this.time, hit: 0 };
    // Which way that is for the squad, facing the enemy: left or right.
    const fx = T.x - c.x, fz = T.z - c.z, rx = -fz, rz = fx;
    const word = (best.at.x - c.x) * rx + (best.at.z - c.z) * rz > 0 ? 'right' : 'left';
    this.world.barks?.say(team[0], 'flank', { dir: word });
    this.world.barks?.say(teams[0][0], 'suppress');
    bus.emit('squad:flank', { team: this.team, squad: this.squad.id, side: word, at: [best.at.x, 0, best.at.z], members: team.map((m) => m.id) });
  }

  /** The flank under way: true while it owns the squad's orders. */
  #flankOrders(teams) {
    const F = this.flank, now = this.time, T = this.threat;
    const going = F.team.filter((m) => isUp(m) && !m.vehicle);
    if (!going.length || !this.hasThreat || now - F.started > 35 || (F.hit && now - F.hit > 10)) { this.flank = null; this.pinnedT = 0; return false; }
    const there = going.every((m) => d2(pos(m), F.at) < 6);
    if (!F.hit && (there || now - F.started > 20)) F.hit = now;
    for (const m of going) {
      if (F.hit) this.#order(m, { kind: 'assault', pos: { x: T.x, z: T.z }, fire: 'free', sprint: false, face: T, arrive: 4, why: 'hitting the flank' });
      else {
        const s = this.#cover(m, F.at, 10);
        if (s) this.tmap.reserve(s, m.id, now);
        this.#order(m, { kind: 'move', pos: s ?? F.at, spot: s, sprint: true, fire: 'move', face: T, arrive: 1.5, why: 'flanking' });
      }
    }
    for (const m of teams[0]) {
      const here = pos(m), s = this.#cover(m, here, 8);
      if (s) this.tmap.reserve(s, m.id, now);
      this.#order(m, { kind: 'overwatch', pos: s ?? { x: here.x, z: here.z }, spot: s, fire: 'cover', face: T, suppress: T, arrive: 1, why: 'suppressing for the flank' });
    }
    return true;
  }

  /**
   * Morale: half the squad (at least two) killed in 20 s breaks it: back to cover 40 m behind, the
   * trench there if there is one, for 15 s, at most once a minute. True while falling back (it owns the orders).
   */
  #fallback(up) {
    const n = this.squad.members.length, now = this.time;
    if (!this.broken && n >= 3 && now - (this.lastBroken ?? -1e9) > 60 && this.losses.length >= Math.max(2, Math.ceil(n / 2)) && this.phase !== 'hold' && this.phase !== 'charge' && this.phase !== 'follow') {
      const back = { x: this.center.x - DIR[this.team] * 40, z: this.center.z };
      this.broken = { until: now + 15, at: back };
      this.lastBroken = now;                                  // (a squad that rallied doesn't break again for a minute)
      this.flank = null; this.bound = null; this.rush = null;
      this.world.barks?.say(up.find((m) => m.brain), 'fallback');
    }
    if (!this.broken) return false;
    if (now > this.broken.until) { this.broken = null; this.losses.length = 0; return false; }
    this.#setPhase('fallback', 'falling back');
    for (const m of up) {
      const s = this.#cover(m, this.broken.at, 15);
      if (s) this.tmap.reserve(s, m.id, now);
      this.#order(m, { kind: 'move', pos: s ?? this.broken.at, spot: s, sprint: true, fire: 'move', face: this.threat, arrive: 1.5, why: 'falling back' });
    }
    return true;
  }

  /**
   * Where the moving team bounds to: cover 12-18 m past the squad's front (the member furthest
   * along the route), so stragglers catch up instead of bounding from where they lag. Bounding
   * out of a trench lands clear of it, in no-man's-land.
   */
  #boundTargets(movers, obj, all = movers) {
    const out = new Map(), chosen = [];
    const ahead = new Vector3(), fwd = new Vector3();
    let front = pos(all[0]), frontLeft = Infinity;
    for (const m of all) { const l = this.#routeLeft(pos(m), obj); if (l < frontLeft) { frontLeft = l; front = pos(m); } }
    const dir = DIR[this.team];
    const trench = this.map.trenches?.find((q) => Math.abs(front.x - q.cx) < 4 && front.z > q.z0 - 2 && front.z < q.z1 + 2);
    movers.forEach((m, k) => {
      const left = Math.min(this.#routeLeft(pos(m), obj), frontLeft + 4);
      const dist = Math.min(Math.max(6, frontLeft - obj.radius * 0.5), 12 + this.rand() * 6);
      this.#ahead(front, obj, dist, ahead);
      if (trench && (ahead.x - trench.cx) * dir < 12) ahead.x = trench.cx + dir * (14 + this.rand() * 4);
      this.#routeDir(ahead, obj, fwd);
      const lateral = (k - (movers.length - 1) / 2) * 6;
      ahead.x += -fwd.z * lateral; ahead.z += fwd.x * lateral;
      const s = this.tmap?.best(ahead.x, ahead.z, 9, (q) => {
        let v = d2(q, ahead);
        if (!this.tmap.covers(q, this.threat.x, this.threat.z)) v += 10;
        if (q.fire === 'hide') v += 2;
        if (this.#routeLeft(q, obj) > left - 5) v += 15;      // must actually get us closer
        if (trench && (q.x - trench.cx) * dir < 8) v += 30;   // out of the trench, not along it
        for (const c of chosen) if (d2(q, c) < 4) v += 20;
        return v;
      }, m.id, this.time);
      const t = s ? { x: s.x, z: s.z, spot: s } : { x: ahead.x, z: ahead.z, spot: null, open: true };
      if (s) this.tmap.reserve(s, m.id, this.time, 10);
      chosen.push(t);
      out.set(m, t);
    });
    return out;
  }

  /** Our own trench between us and the objective: the jump-off line. */
  #jumpTrench(obj) {
    const m = this.mode, team = this.team, dir = DIR[team];
    const front = this.map.sectors[m.front[team]];
    if (!front || front.kind !== 'line') return null;
    const edge = dir > 0 ? front.x1 : front.x0;
    const T = this.map.trenches?.find((t) => Math.abs(t.cx - edge) < 8);
    if (!T) return null;
    // Behind it or in it (a squad manning it straddles the line); already lined up: stay put.
    const waiting = this.jump?.T === T && !this.jump.gone;
    const behind = (this.center.x - T.cx) * dir < (waiting ? 8 : 4);
    const beyond = (obj.pos.x - T.cx) * dir > 15;
    if (!behind || !beyond) return null;
    // Overrun (enemies down in it, near our stretch): fight for it instead of lining up in it.
    // Enemies coming at it are what manning it is for.
    for (const c of this.contacts.values()) if (this.time - c.t < 3 && Math.abs(c.pos.x - T.cx) < 3.5 && Math.abs(c.pos.z - this.center.z) < 30) return null;
    return T;
  }

  #jumpoff(up, obj) {
    const J = this.jump, T = J.T, dir = DIR[this.team], now = this.time;
    // Firing positions facing the enemy, near our lane to the objective, 3 m apart.
    const laneZ = Math.max(T.z0 + 4, Math.min(T.z1 - 4, (this.center.z * 0.4 + obj.pos.z * 0.6)));
    const taken = [];
    let inPlace = 0;
    up.forEach((m, k) => {
      let s = J.positions.get(m);
      if (!s || !s.alive || !this.tmap.free(s, m.id, now)) {
        const want = { x: T.cx, z: laneZ + (k - (up.length - 1) / 2) * 4 };
        s = this.tmap.best(want.x, want.z, 18, (q) => {
          if (q.kind !== 'trench' || q.trench !== T.id || -q.nx !== dir) return Infinity;
          let v = Math.abs(q.z - want.z);
          for (const t of taken) if (d2(q, t) < 3) v += 30;
          return v;
        }, m.id, now);
        if (s) J.positions.set(m, s);
      }
      if (s) { this.tmap.reserve(s, m.id, now); taken.push(s); if (d2(pos(m), s) < 2) inPlace++; }
      this.#order(m, { kind: 'man', pos: s ?? { x: T.cx - dir * 2, z: laneZ }, spot: s, fire: 'cover', face: this.threat, suppress: this.hasThreat ? this.threat : null, sprint: !s || d2(pos(m), s) > 8, arrive: 0.7, why: 'jump-off' });
    });
    // Ready when most of us are in place: tell the commander, who blows the whistle for the line.
    if (!J.ready && (inPlace >= Math.ceil(up.length * 0.75) || now - J.since > 25)) { J.ready = true; J.readyAt = now; this.cmdr?.readyAtTrench?.(this, T); }
    if (J.ready && !J.gone && now - J.readyAt > 30) this.overTheTop();   // nobody blew it: go anyway

  }

  #assault(up, obj) {
    const P = obj.pos, now = this.time, taken = [];
    up.forEach((m, k) => {
      const a = (k / up.length) * Math.PI * 2 + this.squad.id;
      const want = { x: P.x + Math.cos(a) * obj.radius * 0.45, z: P.z + Math.sin(a) * obj.radius * 0.45 };
      const s = this.#cover(m, want, obj.radius * 0.9, { avoid: taken, inside: { p: P, r: obj.radius * 0.9 } });
      if (s) { this.tmap.reserve(s, m.id, now); taken.push(s); }
      this.#order(m, { kind: 'assault', pos: s ?? want, spot: s, sprint: d2(pos(m), s ?? want) > 8, fire: 'free', face: this.threat, arrive: 1, why: 'take the point' });
    });
  }

  /**
   * Defend: anchors on the point, the rest a line out toward the enemy. A stretch of the front
   * (role 'line'): no anchors, the whole squad strung out across its lane on the line itself.
   */
  #hold(up, obj) {
    const P = obj.pos, now = this.time, T = this.threat, front = obj.role === 'line';
    let tx = T.x - P.x, tz = T.z - P.z;
    const tl = Math.hypot(tx, tz);
    if (tl < 5) { tx = DIR[this.team]; tz = 0; } else { tx /= tl; tz /= tl; }
    // The line keeps its frame: it only turns when the threat has really moved round (> 50° for
    // a few seconds), so positions, and the holes dug at them, stay put.
    const F = this.holdFrame;
    if (!F || F.point !== obj.point.id) this.holdFrame = { point: obj.point.id, tx, tz, off: 0 };
    else if (tx * F.tx + tz * F.tz < 0.64) { if ((F.off += PLAN) > 3) { F.tx = tx; F.tz = tz; F.off = 0; this.holdSpots.clear(); } }
    else F.off = 0;
    tx = this.holdFrame.tx; tz = this.holdFrame.tz;
    const px = -tz, pz = tx;
    const anchors = front ? 0 : up.length >= 3 ? 2 : 1;
    // A trench line out toward the enemy is the line to hold (on the front: one at the lane or just ahead of it).
    const line = this.map.trenches?.find((q) => {
      const ahead = (q.cx - P.x) * Math.sign(tx || 1);
      return Math.abs(tx) > 0.6 && (front ? ahead > -6 && ahead < 25 : ahead > 8 && ahead < 45) && P.z > q.z0 && P.z < q.z1;
    });
    const taken = [];
    const lane = ((this.squad.id % 3) - 1) * 9;   // squads on the same point spread out
    // On the front the squad spans its lane; out from a point, 7 m apart and 30 m out.
    const gap = front ? Math.max(5, Math.min(9, (obj.radius * 2) / Math.max(1, up.length - 1))) : 7, out = front ? 0 : 30;
    up.forEach((m, k) => {
      const anchor = k < anchors, along = (k - anchors - (up.length - anchors - 1) / 2) * gap + lane;
      let want;   // eslint-disable-line prefer-const (a dig place below replaces it)
      if (anchor) want = { x: P.x + px * (k - (anchors - 1) / 2) * 4 + tx * 2, z: P.z + pz * (k - (anchors - 1) / 2) * 4 + tz * 2 };
      else if (line) want = { x: line.cx, z: P.z + along };
      else want = { x: P.x + tx * out + px * along, z: P.z + tz * out + pz * along };
      let s = this.holdSpots.get(m);
      const reach = anchor ? obj.radius : line ? 12 : 6;   // the line keeps its shape: dig in rather than wander off for cover
      // A place picked to dig in stays this soldier's place (until the line turns).
      if (s?.virtual) { want = s; s = null; }
      const valid = s && s.alive && this.tmap.free(s, m.id, now) && d2(s, want) < reach + 1 && this.tmap.covers(s, this.threat.x, this.threat.z) > 0
        && (!anchor || d2(s, P) < obj.radius * 0.95) && !taken.some((t) => d2(t, s) < 3.5);
      if (!valid) {
        s = this.tmap ? this.tmap.best(want.x, want.z, reach, (q) => {
          if (anchor && d2(q, P) > obj.radius * 0.95) return Infinity;
          if (line && !anchor && q.kind === 'trench' && -q.nx !== Math.sign(tx)) return Infinity;   // man the side facing them
          let v = d2(q, want);
          if (!this.tmap.covers(q, T.x, T.z)) v += 14;
          if (q.fire === 'hide') v += 4;
          if (q.kind === 'trench' || q.kind === 'fort') v -= 3;
          if (q.kind === 'crater' && !anchor && !line) v += 8;   // a shell hole on the line is a place to dig in, not to stop
          for (const t of taken) if (d2(q, t) < 3.5) v += 25;
          return v;
        }, m.id, now) : null;
        // On the line with only a shell hole (or nothing) to hold: dig a proper position there.
        if (!anchor && !line && (!s || s.kind === 'crater') && this.world.fortify?.canDig(this.team, want.x, want.z)) s = null;
        if (s) this.holdSpots.set(m, s);
        else if (!anchor && !line && this.world.fortify?.canDig(this.team, want.x, want.z)) this.holdSpots.set(m, { x: want.x, z: want.z, virtual: true });
        else this.holdSpots.delete(m);
      }
      if (s) { this.tmap.reserve(s, m.id, now); taken.push(s); }
      // No cover where the line has to be: dig in there (Fortify), and keep improving a dug
      // position (sandbags, then a trench to the next one) while things are quiet.
      const fort = s?.kind === 'fort' ? s.fort : null;
      const dig = (!s && !anchor && !line && !!this.world.fortify?.canDig(this.team, want.x, want.z)) || (fort && (fort.stage < 2 || this.#linkable(fort)));
      this.#order(m, { kind: 'hold', pos: s ?? want, spot: s, fire: 'cover', face: T, suppress: this.hasThreat ? T : null, sprint: d2(pos(m), s ?? want) > 10, arrive: 0.8, dig, anchor, why: anchor ? 'on the point' : line ? 'holding the trench' : dig ? 'digging in' : 'holding the line' });
    });
  }

  /** Another of our positions close enough to dig a trench to. */
  #linkable(site) {
    const F = this.world.fortify;
    if (!F) return false;
    return F.sites.some((o) => o !== site && o.team === site.team && o.stage >= 1 && !site.links.has(o) && Math.hypot(o.x - site.x, o.z - site.z) < 11);
  }

  #chargeOrders(up, obj) {
    const why = this.charge?.why ?? 'charge';
    const toPoint = why !== 'last stand';
    for (const m of up) {
      let target = null, best = Infinity;
      for (const c of this.contacts.values()) if (this.time - c.t < 4 && !c.e.health?.dead) { const d = d2(c.pos, pos(m)); if (d < best) { best = d; target = c.e; } }
      this.#order(m, { kind: 'charge', pos: toPoint ? obj.pos : target ? pos(target) : obj.pos, target, sprint: true, fire: 'free', arrive: toPoint ? obj.radius * 0.4 : 1.5, why });
    }
  }

  // ---------------------------------------------------------------- sweep and clear
  /** Rooms to clear: where enemies were seen (near us), and rooms right on the objective. */
  #roomToClear(obj) {
    if (!this.tmap) return false;
    const now = this.time, team = this.team;
    const C = this.clear;
    if (C && C.R && now - C.started < 45 && now - C.R.cleared[team] > 5) return true;
    this.clear = null;
    let best = null, bd = Infinity;
    // Recent fighting around the objective makes the rooms touching it worth checking.
    const fighting = [...this.contacts.values()].some((c) => now - c.t < 15 && d2(c.pos, obj.pos) < obj.radius + 30);
    for (const R of this.tmap.roomsNear(this.center.x, this.center.z, 45)) {
      const hot = now - R.hot[team] < 12;
      const atObj = fighting && roomDist(R.room, obj.pos) < obj.radius + 3;
      if (!hot && !atObj) continue;
      if (!hot && now - R.cleared[team] < 90) continue;
      if (hot && now - R.cleared[team] < 6) continue;
      const d = roomDist(R.room, this.center);
      if (d < bd) { bd = d; best = R; }
    }
    if (!best) return false;
    this.clear = { R: best, door: null, stage: 'approach', t: now, started: now };
    return true;
  }

  #clearRoom(up, obj) {
    const C = this.clear, R = C.R, room = R.room, now = this.time, team = this.team;
    if (!C.door) {
      // The doorway nearest the squad that opens from outside (or from a room we've cleared).
      let best = null, bd = Infinity;
      for (const d of room.doors) {
        const ox = d.x + d.nx * 1.5, oz = d.z + d.nz * 1.5;
        const other = this.tmap.roomAt(ox, oz);
        if (other && other !== R && now - other.cleared[team] > 120) continue;
        const v = Math.hypot(ox - this.center.x, oz - this.center.z);
        if (v < bd) { bd = v; best = d; }
      }
      if (!best) { R.cleared[team] = now; this.clear = null; this.#assault(up, obj); return; }
      C.door = best;
    }
    const d = C.door, nx = d.nx, nz = d.nz, tx = -nz, tz = nx;
    // Room extents along the door's wall, from the doorway.
    const reach = (sx, sz) => {
      const ex = sx > 0 ? room.max.x - d.x : sx < 0 ? d.x - room.min.x : Infinity;
      const ez = sz > 0 ? room.max.z - d.z : sz < 0 ? d.z - room.min.z : Infinity;
      return Math.min(ex, ez);
    };
    const r1 = Math.max(0.6, Math.min(2.4, reach(tx, tz) - 0.9)), r2 = Math.max(0.6, Math.min(2.4, reach(-tx, -tz) - 0.9));
    const depth = Math.max(1.2, Math.min(2.0, (Math.abs(nx) ? room.max.x - room.min.x : room.max.z - room.min.z) * 0.35));
    const stack = [{ x: d.x + nx * 0.9 + tx * 1.3, z: d.z + nz * 0.9 + tz * 1.3 }, { x: d.x + nx * 0.9 - tx * 1.3, z: d.z + nz * 0.9 - tz * 1.3 }];
    const entry = [{ x: d.x - nx * depth + tx * r1, z: d.z - nz * depth + tz * r1 }, { x: d.x - nx * depth - tx * r2, z: d.z - nz * depth - tz * r2 }];
    const center = { x: (room.min.x + room.max.x) / 2, z: (room.min.z + room.max.z) / 2 };
    const rear = [{ x: d.x + nx * 5 + tx * 2, z: d.z + nz * 5 + tz * 2 }, { x: d.x + nx * 5 - tx * 2, z: d.z + nz * 5 - tz * 2 }];
    // The two nearest the doorway go in; the rest cover the entry and follow.
    if (!C.pair || C.pair.some((m) => !up.includes(m))) C.pair = [...up].sort((a, b) => d2(pos(a), door0(d)) - d2(pos(b), door0(d))).slice(0, 2);
    const pair = C.pair, cover = up.filter((m) => !pair.includes(m));
    const inside = (m) => { const p = pos(m); return p.x > room.min.x && p.x < room.max.x && p.z > room.min.z && p.z < room.max.z; };
    const enemyInside = [...this.contacts.values()].some((c) => now - c.t < 1.5 && c.pos.x > room.min.x - 0.3 && c.pos.x < room.max.x + 0.3 && c.pos.z > room.min.z - 0.3 && c.pos.z < room.max.z + 0.3);
    const elapsed = now - C.t;
    const door = { x: d.x, z: d.z };
    if (C.stage === 'approach') {
      pair.forEach((m, i) => this.#order(m, { kind: 'stack', pos: stack[i], sprint: d2(pos(m), stack[i]) > 6, fire: 'free', face: door, stance: 'crouch', arrive: 0.6, why: 'stacking up' }));
      cover.forEach((m, i) => this.#order(m, { kind: 'overwatch', pos: rear[i % 2], fire: 'cover', face: door, arrive: 1, why: 'covering the entry' }));
      const stacked = pair.every((m, i) => d2(pos(m), stack[i]) < 1.2);
      if ((stacked && elapsed > 0.8) || elapsed > 9) {
        const thrower = pair.find((m) => m.brain?.grenadeReady?.());
        C.stage = thrower ? 'frag' : 'entry'; C.t = now; C.thrower = thrower ?? null;
      }
    } else if (C.stage === 'frag') {
      pair.forEach((m, i) => this.#order(m, m === C.thrower
        ? { kind: 'grenade', pos: stack[i], at: { x: center.x, y: (this.map.terrain?.height(center.x, center.z) ?? 0) + 0.3, z: center.z }, fire: 'none', face: center, arrive: 0.8, why: 'frag out' }
        : { kind: 'stack', pos: stack[i], fire: 'free', face: door, stance: 'crouch', arrive: 0.6, why: 'frag out' }));
      if (elapsed > 1.8) { C.stage = 'entry'; C.t = now; }
    } else if (C.stage === 'entry') {
      // Through the doorway itself (narrower than a nav cell: the route is spelled out).
      const via = [{ x: d.x + nx * 0.9, z: d.z + nz * 0.9 }, { x: d.x - nx * 0.9, z: d.z - nz * 0.9 }];
      pair.forEach((m, i) => this.#order(m, { kind: 'enter', pos: entry[i], via, fire: 'free', face: entry[1 - i], arrive: 0.6, room, why: 'entering' }));
      cover.forEach((m, i) => this.#order(m, { kind: 'stack', pos: stack[i % 2], fire: 'free', face: door, arrive: 0.8, why: 'following in' }));
      if ((pair.every(inside) && elapsed > 1.2) || elapsed > 8) { C.stage = 'sweep'; C.t = now; }
    } else {
      const via = [{ x: d.x + nx * 0.9, z: d.z + nz * 0.9 }, { x: d.x - nx * 0.9, z: d.z - nz * 0.9 }];
      const viaIf = (m) => (inside(m) ? null : via);
      pair.forEach((m, i) => this.#order(m, { kind: 'enter', pos: { x: center.x + tx * (i ? -1.2 : 1.2), z: center.z + tz * (i ? -1.2 : 1.2) }, via: viaIf(m), fire: 'free', face: center, arrive: 0.8, room, why: 'sweeping' }));
      cover.forEach((m, i) => this.#order(m, { kind: 'enter', pos: entry[i % 2], via: viaIf(m), fire: 'free', face: center, arrive: 0.8, room, why: 'sweeping' }));
      if (enemyInside) C.t = now;            // still a fight in here
      else if (elapsed > 2) {
        R.cleared[team] = now; R.hot[team] = -1e9;
        bus.emit('squad:roomCleared', { team, squad: this.squad.id, ruin: R.ruin.id });
        this.clear = null;
      }
    }
  }

  // ---------------------------------------------------------------- a human leads
  #follow(up, human, obj) {
    const hp = pos(human), v = human.movement.state.velocity;
    const moving = Math.hypot(v.x, v.z) > 0.8;
    if (moving) { this.stillSince = this.time; }
    const still = this.time - (this.stillSince ?? 0) > 1.2;
    const bots = up.filter((m) => m.brain);
    if (!this.hasThreat && obj) this.#defaultThreat(obj);
    const fwd = _w.set(moving ? v.x : this.threat.x - hp.x, 0, moving ? v.z : this.threat.z - hp.z);
    if (fwd.lengthSq() < 1e-4) fwd.set(DIR[this.team], 0, 0);
    fwd.normalize();
    const rx = -fwd.z, rz = fwd.x;
    const taken = [];
    bots.forEach((m, k) => {
      const rank = Math.floor(k / 2) + 1, side = k % 2 ? 1 : -1;
      const want = { x: hp.x + rx * side * 4 * rank - fwd.x * 3.5 * rank, z: hp.z + rz * side * 4 * rank - fwd.z * 3.5 * rank };
      if (still) {
        const s = this.#cover(m, want, 9, { avoid: taken });
        if (s) { this.tmap.reserve(s, m.id, this.time); taken.push(s); }
        this.#order(m, { kind: 'overwatch', pos: s ?? want, spot: s, fire: 'cover', face: this.threat, suppress: this.hasThreat ? this.threat : null, arrive: 1, why: 'covering you' });
      } else {
        this.#order(m, { kind: 'move', pos: want, sprint: human.movement.state.sprinting || d2(pos(m), want) > 8, fire: 'move', arrive: 1.5, follow: true, why: 'following you' });
      }
    });
  }

  // ---------------------------------------------------------------- where the human pinged
  #directed(up, obj) {
    const D = this.sentTo, bots = up.filter((m) => m.brain);
    if (!this.hasThreat && obj) this.#defaultThreat(obj);
    // Round the mark: on a point, inside its circle (so it counts for the capture); else a ring 5 m out.
    const r = D.radius ? Math.max(2, Math.min(D.radius * 0.55, 7)) : 5;
    const taken = [];
    bots.forEach((m, k) => {
      const a = (k / Math.max(1, bots.length)) * Math.PI * 2 + 0.7;
      const want = { x: D.pos.x + Math.cos(a) * r, z: D.pos.z + Math.sin(a) * r };
      const far = d2(pos(m), want);
      if (far > 12) { this.#order(m, { kind: 'move', pos: want, sprint: far > 25, fire: 'move', arrive: 2, why: 'to your mark' }); return; }
      const s = this.#cover(m, want, D.radius ? Math.min(D.radius * 0.7, 8) : 8, { avoid: taken });
      if (s) { this.tmap.reserve(s, m.id, this.time); taken.push(s); }
      this.#order(m, { kind: 'overwatch', pos: s ?? want, spot: s, fire: 'cover', face: this.threat, suppress: this.hasThreat ? this.threat : null, arrive: 1, why: 'holding your mark' });
    });
  }
}

function door0(d) { return { x: d.x + d.nx * 1.5, z: d.z + d.nz * 1.5 }; }

function roomDist(room, p) {
  const dx = Math.max(room.min.x - p.x, 0, p.x - room.max.x), dz = Math.max(room.min.z - p.z, 0, p.z - room.max.z);
  return Math.hypot(dx, dz);
}
