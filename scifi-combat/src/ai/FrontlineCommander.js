// FrontlineCommander: a team's command (one per team). Squads take its orders and carry them out;
// who gives them is a person in the commander's seat, or the AI (the Strategist, src/ai/command).
//
//  * Squads of up to 4 bots move and fight together: the leader heads for the objective, members
//    hold slots around it, and everyone respawns on the leader when it's safe.
//  * Orders (`give`): take a place, hold it, scout it, fall back; and fire missions for the guns
//    (`fire`). A place is a capture point or anywhere on the map: a crossroads, a building, a hill
//    (a point the squad gets to and holds, clearing what's in the way). Taking an enemy point is an
//    attack on it; holding ours, its defence.
//  * Squads do as they're told most of the time (the difficulty's `obey`). Out of contact they
//    nearly always go at once; in a firefight they may finish it first, pinned down they mostly
//    can't move yet, and a squad falling back regroups before it does anything. A squad that can't
//    go says so and goes when it can (a few seconds later; never more than three times).
//  * Scouting: the squad sends one man ahead to a vantage point with eyes on the place (ScoutTask);
//    what he sees goes into the team's intel, and the guns can fire on it.
//  * Fire missions: the guns shell a place (SupportCommand). Where we have eyes on it (fresh
//    contacts or ground watched in the last 10 s) the rounds land on the mark; fired blind, they
//    scatter twice as wide round an aim point that's off by up to 25 m.
//  * The radio: every order, refusal and report goes on the log (the command view shows it), and
//    the squad leader says it (Barks).
//  * Standing orders: squads nobody has given an order (all of them, for the AI below veteran) are
//    shared out every few seconds between the points of the sector in front of our line and our
//    own points under attack. Priorities: points being captured from us, then enemy points we're
//    closest to taking, then neutral ones; at least one squad per attack point; squads keep their
//    orders unless the plan changed a lot (no thrashing).
//  * The line: points alone would draw every squad onto a few spots and leave the ground between
//    them and out on the flanks empty. So about four squads in ten (fewer while one of our points
//    is being taken) hold the front instead: it's cut into lanes across the map's whole width, and
//    they take the lanes furthest from any point first (the gaps and the flanks). While our attack
//    on the sector ahead is going (any point of it ours, or none of it theirs yet) they push a third
//    of the way into it with the assault; when the enemy holds all of it, they hold just behind our
//    own line. A lane is a point to SquadTactics (role 'line': get there and hold it).
//  * Orders reach the soldiers as plain data on each brain (`brain.objective`); each squad's
//    SquadTactics turns them into moves (bounding, clearing, holding the line).
//  * Over the top: squads attacking across their own trench line man it and report ready; the
//    commander blows one whistle for the whole line (waiting a few seconds for other squads to
//    get in, at most one wave every 18 s), and every squad ready in that trench goes at once.
//    With artillery (SupportCommand) the whistle waits for a preparation barrage on the points
//    ahead, which lifts just before the wave goes.
// Events: command:order { team, squad, kind, at, by }, command:radio { team, squad, kind, text },
// command:fire { team, x, z, r, observed, by }.

import { Vector3 } from 'three';
import { bus } from '../core/EventBus.js';
import { mulberry32 } from '../world/Terrain.js';
import { ScoutTask } from './command/Scout.js';

const DIR = [1, -1];
const CALLSIGNS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'X-ray', 'Yankee', 'Zulu'];
/** What a command's difficulty sets (data/ai/personalities.json difficulty.*.command). */
export const COMMAND = { obey: 0.85, interval: 4, mind: false, line: 0.4 };

export class Squad {
  constructor(team, id, members = []) {
    this.team = team; this.id = id; this.members = members;
    this.objective = null;    // point, lane or place id
    this.role = null;         // 'attack' | 'defend' | 'line'
    this.since = 0;
    this.order = null;        // the order it's under: { kind, obj, role, by, issued } (null: standing orders)
    this.pending = null;      // an order it hasn't been able to carry out yet: { order, at, tries }
    const n = Math.floor(id / CALLSIGNS.length);
    this.callsign = CALLSIGNS[id % CALLSIGNS.length] + (n ? ` ${n + 1}` : '');
  }
  get leader() { return this.members.find((m) => !m.health.dead && !m.health.downed && !m.detached) ?? this.members.find((m) => !m.health.dead && !m.health.downed) ?? null; }
  get alive() { let n = 0; for (const m of this.members) if (!m.health.dead) n++; return n; }
  /** Centroid of living members (or null). */
  center(out) {
    let n = 0; out.set(0, 0, 0);
    for (const m of this.members) if (!m.health.dead && !m.detached) { out.add(m.movement.state.position); n++; }
    return n ? out.divideScalar(n) : null;
  }
}

export class FrontlineCommander {
  /**
   * @param {number} team
   * @param {FrontlineMode} mode
   * @param {object} o { interval, nav, world, map, tmap, cfg (COMMAND), seed }
   */
  constructor(team, mode, { interval = null, nav = null, world = null, tmap = null, cfg = null, seed = 1 } = {}) {
    this.team = team; this.mode = mode; this.nav = nav; this.world = world; this.tmap = tmap;
    this.cfg = { ...COMMAND, ...(cfg ?? {}) };
    this.interval = interval ?? this.cfg.interval;
    this.timer = 0;
    this.time = 0;
    this.squads = [];
    this.waves = new Map();   // trench id -> { at, ready: Set<SquadTactics>, blown, x, z }
    this.support = null;      // SupportCommand: shells the objective before the whistle; fires our missions
    this.lanes = new Map();   // lane id -> the stretch of the front it holds (a point to SquadTactics)
    this.places = new Map();  // place id -> a spot anywhere on the map we ordered taken or held
    this.scouts = new Map();  // squad -> ScoutTask
    this.human = false;       // a person in the commander's seat
    this.mind = null;         // the AI's plan (Strategist), when it commands this side
    this.log = [];            // the radio: { t, squad, kind, text }
    this.rand = mulberry32(seed * 131 + team * 17 + 5);
    this.off = bus.on('mode:sector', () => { this.timer = 0; });
  }

  /** A point, a lane or a place by id: what a squad's `objective` names. */
  target(id) { return this.places.get(id) ?? this.lanes.get(id) ?? this.mode.points[id] ?? null; }

  // ---------------------------------------------------------------- places
  /**
   * A place to take or hold: anywhere on the map, as a point SquadTactics understands (a squad
   * gets there and holds it). The same spot (within 6 m) is the same place.
   */
  place(x, z, { radius = 14, name = null } = {}) {
    for (const P of this.places.values()) if (Math.hypot(P.pos.x - x, P.pos.z - z) < 6) return P;
    const id = 2000 + this.team * 1000 + (this.placeN = (this.placeN ?? 0) + 1);
    const pos = this.#open(x, z, new Vector3());
    pos.y = this.mode.map.terrain?.height(pos.x, pos.z) ?? 0;
    const P = { id, place: true, line: true, pos, radius, owner: this.team, counts: [0, 0], progress: 0, contested: false, name: name ?? this.where(pos.x, pos.z), field: `place:${this.team}:${id}` };
    this.places.set(id, P);
    // (Places nobody is sent to any more go: their flow fields with them.)
    if (this.places.size > 24) for (const [k, Q] of this.places) if (!this.squads.some((s) => s.objective === k) && Q !== P) { this.places.delete(k); if (this.places.size <= 16) break; }
    return P;
  }

  /** A place's name on the radio: the point there, else how far and which way from the nearest one. */
  where(x, z) {
    let best = null, bd = Infinity;
    for (const p of this.mode.points) { const d = Math.hypot(p.pos.x - x, p.pos.z - z); if (d < bd) { bd = d; best = p; } }
    if (!best) return `grid ${Math.round(x / 100)}-${Math.round(z / 100)}`;
    if (bd < best.radius + 12) return best.name;
    const dx = x - best.pos.x, dz = z - best.pos.z;
    // Which way, as the side sees it: toward the enemy is "forward".
    const fwd = dx * DIR[this.team], side = dz * DIR[this.team];
    const way = Math.abs(fwd) > Math.abs(side) ? (fwd > 0 ? 'past' : 'short of') : side > 0 ? 'right of' : 'left of';
    return `${Math.round(bd / 10) * 10} m ${way} ${best.name}`;
  }

  // ---------------------------------------------------------------- orders
  /**
   * An order for a squad: { kind: 'take' | 'hold' | 'scout' | 'fallback' | 'line', point: id, at: {x, z}, lane: id, by: 'human' | 'ai' }.
   * Returns { ok, why } (not ok: it'll go when it can, and says so).
   */
  give(squad, o) {
    if (!squad || squad.team !== this.team) return { ok: false, why: 'not ours' };
    if (o.kind === 'scout') return this.#scout(squad, o);
    if (o.kind === 'auto') { squad.order = null; squad.pending = null; this.timer = 0; this.#radio(squad, 'order', { place: 'standing orders' }); return { ok: true }; }
    const t = this.#resolve(squad, o);
    if (!t) return { ok: false, why: 'nowhere' };
    const order = { kind: o.kind, by: o.by ?? 'ai', obj: t.obj, role: t.role, issued: this.time, at: { x: t.obj.pos.x, z: t.obj.pos.z } };
    squad.order = order;
    squad.pending = null;
    bus.emit('command:order', { team: this.team, squad: squad.id, kind: order.kind, at: [order.at.x, order.at.z], name: t.obj.name ?? null, by: order.by });
    return this.#tryOrder(squad, order, 0);
  }

  /** Carry an order out now, or put it off (pinned down, in a firefight, falling back) and say so. */
  #tryOrder(squad, order, tries) {
    const v = tries >= 3 ? { ok: true } : this.#obey(squad, order, tries);
    if (v.ok) {
      squad.pending = null;
      this.#apply(squad, order);
      this.#radio(squad, order.kind === 'fallback' ? 'fallback' : 'order', { place: order.obj.name ?? 'the objective' });
      return { ok: true };
    }
    squad.pending = { order, at: this.time + v.delay, tries: tries + 1 };
    this.#radio(squad, 'refuse', { why: v.why });
    return { ok: false, why: v.why, delay: v.delay };
  }

  /**
   * Will they go now? Out of contact, nearly always; in a firefight, mostly; pinned down, rarely;
   * falling back, not until they've regrouped. Each try after a refusal is likelier.
   */
  #obey(squad, order, tries) {
    const T = squad.tactics;
    if (!T) return { ok: true };
    if (T.broken && T.time < T.broken.until) return { ok: false, delay: T.broken.until - T.time + 1, why: 'falling back' };
    const up = squad.members.filter((m) => !m.health.dead && !m.detached);
    const sup = up.length ? up.reduce((a, m) => a + (m.suppression ?? 0), 0) / up.length : 0;
    const pinned = T.pinnedT > 2.5 || sup > 0.55, fighting = T.phase === 'contact' || T.phase === 'clear' || (T.phase === 'assault' && T.hasThreat);
    // Holding where they are isn't moving: a pinned squad can do that.
    const here = order.obj && T.center ? Math.hypot(order.obj.pos.x - T.center.x, order.obj.pos.z - T.center.z) < order.obj.radius + 10 : false;
    let p = this.cfg.obey;
    if (here) p = 1;
    else if (pinned) p *= 0.35;
    else if (fighting) p = p * 0.8 + 0.1;
    else p = 1 - (1 - p) * 0.25;
    p = Math.min(1, p + tries * 0.3);
    if (this.rand() < p) return { ok: true };
    return { ok: false, delay: pinned ? 7 + this.rand() * 6 : 4 + this.rand() * 5, why: pinned ? 'pinned down' : 'engaged' };
  }

  /** What the order names, and how the squad goes about it. */
  #resolve(squad, o) {
    const M = this.mode, team = this.team;
    if (o.kind === 'fallback') {
      // Back to our own line: the spawn of our front sector nearest the squad.
      const sec = M.map.sectors[M.front[team]], c = squad.center(new Vector3()) ?? M.map.hq[team];
      const list = sec ? [...(sec.spawns?.[team] ?? []), ...(sec.rearSpawns?.[team] ?? [])] : [];
      let best = M.map.hq[team], bd = Infinity;
      for (const p of list) { const d = Math.hypot(p.x - c.x, p.z - c.z); if (d < bd) { bd = d; best = p; } }
      return { obj: this.place(best.x, best.z, { radius: 16 }), role: 'line' };
    }
    if (o.lane != null && this.lanes.has(o.lane)) return { obj: this.lanes.get(o.lane), role: 'line' };
    if (o.point != null) {
      const p = M.points[o.point];
      if (!p) return null;
      // A point in play: an attack on it, or its defence. Behind the lines (it can't change hands): a place there.
      if (M.capturable(p) || p.owner === team) {
        if (M.capturable(p)) return { obj: p, role: p.owner === team ? 'defend' : 'attack' };
        return { obj: this.place(p.pos.x, p.pos.z, { radius: p.radius, name: p.name }), role: 'line' };
      }
      return { obj: this.place(p.pos.x, p.pos.z, { radius: p.radius, name: p.name }), role: 'line' };
    }
    if (o.at) {
      // A spot on a point in play is that point.
      for (const p of M.points) if (Math.hypot(p.pos.x - o.at.x, p.pos.z - o.at.z) < p.radius && M.capturable(p)) return { obj: p, role: p.owner === team ? 'defend' : 'attack' };
      return { obj: this.place(o.at.x, o.at.z, { radius: o.radius ?? 14 }), role: 'line' };
    }
    return null;
  }

  #apply(squad, order) {
    const sc = this.scouts.get(squad);
    if (sc && order.kind === 'fallback') { sc.end(); this.scouts.delete(squad); }
    this.#order(squad, order.obj, order.role);
  }

  /** One man of the squad goes ahead to get eyes on a place. */
  #scout(squad, o) {
    const at = o.at ?? (o.point != null ? this.mode.points[o.point]?.pos : null);
    if (!at) return { ok: false, why: 'nowhere' };
    const up = squad.members.filter((m) => !m.health.dead && !m.health.downed && m.brain && !m.vehicle);
    if (!up.length) { this.#radio(squad, 'refuse', { why: 'no one to send' }); return { ok: false, why: 'no one to send' }; }
    const lead = squad.leader;
    const pick = up.find((m) => m.role === 'marksman' && (m !== lead || up.length === 1)) ?? up.find((m) => m.role === 'infiltrator' && (m !== lead || up.length === 1)) ?? up.find((m) => m !== lead) ?? up[0];
    this.scouts.get(squad)?.end();
    const name = o.name ?? this.where(at.x, at.z);
    const task = new ScoutTask({
      world: this.world, map: this.mode.map, mode: this.mode, squad, member: pick, at: { x: at.x, z: at.z, name }, tmap: this.tmap, intel: this.world?.intel?.[this.team],
      say: (m, kind, vars) => this.#radio(squad, kind, vars, m),
    });
    this.scouts.set(squad, task);
    bus.emit('command:order', { team: this.team, squad: squad.id, kind: 'scout', at: [at.x, at.z], name, by: o.by ?? 'ai', scout: pick.id });
    this.#radio(squad, 'scout', { place: name, name: pick.name ?? 'him' });
    return { ok: true, scout: pick };
  }

  /**
   * A fire mission: the guns shell (x, z) (radius r). Where we have eyes on it the rounds land on the
   * mark; fired blind they scatter. Returns { ok, observed, why }.
   */
  fire({ x, z, r = 16, rounds = 4, by = 'ai', pri = null }) {
    if (!this.support) return { ok: false, why: 'no guns' };
    const intel = this.world?.intel?.[this.team];
    const observed = !!intel && (intel.near(x, z, r + 10, 8) > 0 || intel.staleness(x, z, Math.min(r, 20)) < 10);
    const ok = this.support.request({ x, z, r, rounds, observed, pri: pri ?? (by === 'human' ? 7 : 5), by });
    if (!ok) return { ok: false, why: 'no guns ready' };
    bus.emit('command:fire', { team: this.team, x, z, r, observed, by });
    this.#log(null, 'fire', observed ? `Fire mission ${this.where(x, z)}: rounds on the way.` : `Fire mission ${this.where(x, z)}: firing blind, no eyes on it.`);
    return { ok: true, observed };
  }

  /** On the radio: the log (all of it) and the squad leader's line (if he isn't talking already). */
  #radio(squad, kind, vars = {}, speaker = null) {
    const who = speaker ?? squad?.leader;
    const barks = this.world?.barks;
    if (who && barks) barks.say(who, kind, vars);
    const text = (who && barks?.line(who, kind, vars)) ?? DEFAULT[kind]?.(vars) ?? kind;
    this.#log(squad, kind, text);
  }

  #log(squad, kind, text) {
    const e = { t: this.time, squad: squad?.id ?? null, callsign: squad?.callsign ?? 'Guns', kind, text };
    this.log.push(e);
    if (this.log.length > 60) this.log.shift();
    bus.emit('command:radio', { team: this.team, ...e });
  }

  // ---------------------------------------------------------------- the front's lanes
  /**
   * Where the lanes run across the map: down the city's avenues, else evenly across the ground the
   * trench lines span (clear of the berms at the map's edges). Fixed for the match.
   */
  #laneZs() {
    if (this.laneZ) return this.laneZ;
    const map = this.mode.map, b = map.bounds ?? { minZ: -150, maxZ: 150 }, T = map.trenches ?? [];
    if (map.city?.avenues?.length) return (this.laneZ = map.city.avenues.slice().sort((a, c) => a - c));
    const depth = b.maxZ - b.minZ;
    const lo = T.length ? Math.min(...T.map((t) => t.z0)) + 4 : b.minZ + depth * 0.14;
    const hi = T.length ? Math.max(...T.map((t) => t.z1)) - 4 : b.maxZ - depth * 0.14;
    const n = Math.max(3, Math.min(9, Math.round((hi - lo) / 45))), w = (hi - lo) / n;
    return (this.laneZ = Array.from({ length: n }, (_, i) => lo + w * (i + 0.5)));
  }

  /** The nearest open ground to (x, z): rings 2 m apart out to 20 m (a lane's spot can land on a wall or a wreck). */
  #open(x, z, out) {
    const nav = this.nav;
    out.set(x, 0, z);
    if (!nav?.blocked || !nav.blocked(x, z)) return out;
    for (let r = 2; r <= 20; r += 2) {
      for (let k = 0, n = Math.round(r * 3); k < n; k++) {
        const a = (k / n) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r * 0.5;   // along the line first
        if (!nav.blocked(px, pz)) return out.set(px, 0, pz);
      }
    }
    return out;
  }

  /**
   * The front cut into lanes across the map's width: where each one is held now. Pushed a third of
   * the way into the sector we're attacking while the attack is going, else just behind our line.
   */
  frontLanes(attack = this.mode.objectives(this.team).attack) {
    const M = this.mode, map = M.map, team = this.team, dir = DIR[team];
    const atk = map.sectors[M.attackSector(team)], own = map.sectors[M.front[team]];
    if (!atk || !own) return [];
    const zs = this.#laneZs(), n = zs.length, w = n > 1 ? (zs[n - 1] - zs[0]) / (n - 1) : 40;
    const going = attack.some((p) => p.owner === team) || !attack.every((p) => p.owner === 1 - team);
    const line = team === 0 ? own.x1 : own.x0;
    const x = going ? line + dir * (atk.x1 - atk.x0) * 0.33 : line - dir * Math.min(14, (own.x1 - own.x0) * 0.15);
    // Big maps: one flow field to the whole line (it leads to the nearest lane; squads go along the
    // line to their own from there), not one per lane: a field there is 1-3 MB and they're capped.
    const shared = !!this.nav?.big, lineKey = `line:${team}:${atk.index}:${going ? 'a' : 'h'}`;
    const out = [];
    for (let i = 0; i < n; i++) {
      const id = 1000 + team * 100 + i, key = `${atk.index}:${going ? 'a' : 'h'}:${i}`;
      let L = this.lanes.get(id);
      if (!L) this.lanes.set(id, (L = { id, line: true, lane: i, pos: new Vector3(), counts: [0, 0], progress: 0, contested: false }));
      if (L.key !== key) {   // the front moved (or the attack started or stalled): the lane's new spot
        this.#open(x, zs[i], L.pos);
        L.pos.y = map.terrain?.height(L.pos.x, L.pos.z) ?? 0;
      }
      Object.assign(L, { key, name: `LINE ${i + 1}`, radius: Math.min(18, w * 0.42), owner: team, sector: atk.index, field: shared ? lineKey : `line:${team}:${key}`, shared, going });
      out.push(L);
    }
    if (shared && this.lineKey !== lineKey) {
      this.lineKey = lineKey;
      this.nav.want(lineKey, out[0].pos.x, out[0].pos.z, out[0].radius * 0.6, { goals: out.map((L) => ({ x: L.pos.x, z: L.pos.z, r: L.radius * 0.6 })) });
    }
    return out;
  }

  // ---------------------------------------------------------------- over the top
  /** A squad is in position in trench T: it goes with the next whistle on that line. */
  readyAtTrench(tactics, T) {
    let w = this.waves.get(T.id);
    if (!w) { w = { at: null, ready: new Set(), blown: -1e9 }; this.waves.set(T.id, w); }
    // Just missed a whistle? Go with it.
    if (this.time - w.blown < 3) { tactics.overTheTop(); return w.blown; }
    w.ready.add(tactics);
    if (w.at === null) {
      w.at = Math.max(this.time + 6, w.blown + 18);
      // A preparation barrage first, if the batteries can fire one: the whistle waits for it.
      w.at += this.support?.prepare(T, tactics.center?.z ?? 0, w.at) ?? 0;
    }
    return w.at;
  }

  #whistles() {
    for (const [id, w] of this.waves) {
      if (w.at === null || this.time < w.at) continue;
      const list = [...w.ready].filter((t) => t.jump && !t.jump.gone && t.jump.T.id === id && t.phase === 'jumpoff');
      w.at = null; w.ready.clear();
      if (!list.length) continue;
      w.blown = this.time;
      const x = list[0].jump.T.cx, z = list.reduce((a, t) => a + t.center.z, 0) / list.length;
      for (const t of list) t.overTheTop();
      bus.emit('squad:whistle', { team: this.team, trench: id, x, z, squads: list.map((t) => t.squad.id) });
    }
  }

  dispose() { this.off?.(); for (const s of this.scouts.values()) s.end(); }

  // ---------------------------------------------------------------- per tick
  update(dt) {
    this.time += dt;
    this.#whistles();
    // Orders put off: try again.
    for (const s of this.squads) if (s.pending && this.time >= s.pending.at) { if (s.order === s.pending.order) this.#tryOrder(s, s.pending.order, s.pending.tries); else s.pending = null; }
    for (const [sq, task] of this.scouts) { task.update(dt); if (task.done) this.scouts.delete(sq); }
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.interval;
    this.#upkeep();
    if (this.mind) this.mind.plan(this);
    this.#standing(this.squads.filter((s) => !s.order));
    // Refresh the per-bot orders (members change as they respawn into squads; lanes move with the front).
    for (const s of this.squads) { if (s.pending) continue; const p = this.target(s.objective); if (p) this.#order(s, p, s.role, true); }
  }

  /** Orders that have run their course: the point taken and locked behind our new line, a fall-back done. */
  #upkeep() {
    for (const s of this.squads) {
      const o = s.order;
      if (!o) continue;
      const p = o.obj;
      if (!p.place && !p.line && !this.mode.capturable(p)) {
        // The point can't change hands any more: taken (the line moved past it) or lost.
        s.order = null; s.pending = null;
        if (p.owner === this.team) this.#radio(s, 'secured', { place: p.name });
        continue;
      }
      if (o.kind === 'fallback' && !this.human && this.time - o.issued > 25) s.order = null;
    }
  }

  /** Standing orders for squads under none: the points in play and the line, shared out. */
  #standing(squads) {
    for (const { s, p, role } of this.standingPlan(squads)) this.#order(s, p, role);
  }

  /** Where standing orders would send these squads: [{ s: squad, p: point or lane, role }]. */
  standingPlan(squads) {
    if (!squads.length) return [];
    const { attack, defend } = this.mode.objectives(this.team);
    const team = this.team;
    // Priorities.
    const wants = [];
    for (const p of defend) {
      const enemyOn = p.counts[1 - team], losing = team === 0 ? 1 - p.progress : 1 + p.progress; // 0 = safe, 2 = lost
      wants.push({ p, role: 'defend', w: 0.35 + enemyOn * 0.45 + losing * 0.9, min: enemyOn > 0 ? 2 : 0 });
    }
    for (const p of attack) {
      const gained = team === 0 ? 1 + p.progress : 1 - p.progress; // 0 = enemy-held, 2 = ours
      wants.push({ p, role: 'attack', w: 1 + (p.owner === -1 ? 0.25 : 0) + gained * 0.3, min: 1 });
    }
    if (!wants.length) return [];
    let n = squads.length;
    // The line: lanes for the squads the points don't need (the gaps and the flanks first). Never
    // the squads every attack point needs, or the two a point being taken from us gets.
    const pressed = defend.some((p) => p.counts[1 - team] > 0), need = wants.reduce((a, x) => a + (x.min ?? 0), 0);
    const share = this.cfg.line ?? 0.4, lineN = n >= 4 ? Math.max(0, Math.min(n - Math.max(1, need), Math.round(n * share * (pressed ? 0.625 : 1)))) : 0;
    if (lineN > 0) {
      const lanes = this.frontLanes(attack), pts = [...attack, ...defend];
      const gap = (L) => pts.reduce((m, p) => Math.min(m, Math.abs(p.pos.z - L.pos.z)), Infinity);
      const order = lanes.slice().sort((a, b) => gap(b) - gap(a) || a.lane - b.lane);
      for (let k = 0; k < lineN; k++) {
        const L = order[k % order.length], x = wants.find((y) => y.p === L);
        if (x) x.fixed++; else wants.push({ p: L, role: 'line', fixed: 1 });
      }
      n -= lineN;
    }
    // Proportional allocation (largest remainder) of the rest among the points, at least one squad per attack point when possible.
    const pointWants = wants.filter((x) => !x.fixed);
    const total = pointWants.reduce((a, x) => a + x.w, 0);
    for (const x of pointWants) { x.share = (x.w / total) * n; x.slots = Math.floor(x.share); }
    for (const x of wants) if (x.fixed) x.slots = x.fixed;
    let left = n - pointWants.reduce((a, x) => a + x.slots, 0);
    for (const x of [...pointWants].sort((a, b) => (b.share - b.slots) - (a.share - a.slots))) { if (left <= 0) break; x.slots++; left--; }
    for (const x of pointWants) {
      while (x.min && x.slots < x.min) {
        const donor = pointWants.filter((y) => y !== x && y.slots > (y.min ?? 0)).sort((a, b) => b.slots - a.slots)[0];
        if (!donor) break;
        donor.slots--; x.slots++;
      }
    }
    // Keep current orders where they still fit; then fill remaining slots with the nearest squads.
    const byId = new Map(wants.map((x) => [x.p.id, x]));
    const free = [], out = [];
    for (const s of squads) {
      const x = byId.get(s.objective);
      if (x && x.slots > 0 && x.role === s.role) { x.slots--; out.push({ s, p: x.p, role: x.role }); continue; }
      free.push(s);
    }
    const c = new Vector3();
    for (const s of free) {
      const at = s.center(c) ?? this.mode.map.hq[team];
      let best = null, bd = Infinity;
      for (const x of wants) {
        if (x.slots <= 0) continue;
        const d = this.eta(x.p, at);
        if (d < bd) { bd = d; best = x; }
      }
      if (!best) best = pointWants.reduce((a, b) => (b.w > a.w ? b : a), pointWants[0] ?? wants[0]);
      best.slots--;
      out.push({ s, p: best.p, role: best.role });
    }
    return out;
  }

  /** How far (m, along the routes where there's a field) a squad at `at` is from point or place p. */
  eta(p, at) {
    // A lane on a shared field: that's the way to the nearest lane, not this one: as the crow flies.
    const f = p.shared ? null : this.nav?.want(p.field ?? `pt:${p.id}`, p.pos.x, p.pos.z, p.radius * 0.6);
    const r = f ? this.nav.distance(f, at.x, at.z) : Infinity;
    return r < Infinity ? r : Math.hypot(at.x - p.pos.x, at.z - p.pos.z);   // beyond a big map's field: as the crow flies
  }

  #order(squad, point, role, refresh = false) {
    if (!refresh && (squad.objective !== point.id || squad.role !== role)) { squad.objective = point.id; squad.role = role; squad.since = this.time; }
    squad.members.forEach((m, slot) => {
      if (!m.brain) return;
      m.brain.objective = { id: point.id, pos: point.pos, radius: point.radius, field: point.field ?? `pt:${point.id}`, shared: !!point.shared, role, slot, of: squad.members.length, squad };
    });
  }
}

/** Radio lines when nobody can say them (no barks data): the log still reads. */
const DEFAULT = {
  order: (v) => `Copy, moving on ${v.place}.`,
  fallback: () => 'Falling back.',
  refuse: (v) => `Negative, ${v.why}. Will comply when we can.`,
  scout: (v) => `${v.name ?? 'Scout'} going forward to get eyes on ${v.place}.`,
  eyes: (v) => `Eyes on ${v.place}: ${v.n} hostiles in sight.`,
  secured: (v) => `${v.place} secured. Awaiting orders.`,
};
