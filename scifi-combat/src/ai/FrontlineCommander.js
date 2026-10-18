// FrontlineCommander: turns the frontline into orders for bot squads (one commander per team).
//
//  * Squads of up to 4 bots move and fight together: the leader heads for the objective, members
//    hold slots around it, and everyone respawns on the leader when it's safe.
//  * Every few seconds (and immediately when a sector falls) the commander splits its squads
//    between attacking the points of the sector in front of its line and defending its own points
//    under attack. Priorities: points being captured from us, then enemy points we're closest to
//    taking, then neutral points. Allocation is proportional with a minimum of one squad per
//    attack point, and squads keep their orders unless the plan changed a lot (no thrashing).
//  * The line: points alone would draw every squad onto a few spots and leave the ground between
//    them and out on the flanks empty. So about four squads in ten (fewer while one of our points
//    is being taken) hold the front instead: it's cut into lanes across the map's whole width, and
//    they take the lanes furthest from any point first (the gaps and the flanks). While our attack
//    on the sector ahead is going (any point of it ours, or none of it theirs yet) they push a third
//    of the way into it with the assault; when the enemy holds all of it, they hold just behind our
//    own line. A lane is a point to SquadTactics (role 'line': get there and hold it).
//  * Orders are plain data on each brain (`brain.objective`); each squad's SquadTactics turns
//    them into moves (bounding, clearing, holding the line) for its soldiers.
//  * Over the top: squads attacking across their own trench line man it and report ready; the
//    commander blows one whistle for the whole line (waiting a few seconds for other squads to
//    get in, at most one wave every 18 s), and every squad ready in that trench goes at once.
//    With artillery (SupportCommand) the whistle waits for a preparation barrage on the points
//    ahead, which lifts just before the wave goes.

import { Vector3 } from 'three';
import { bus } from '../core/EventBus.js';

export class Squad {
  constructor(team, id, members = []) {
    this.team = team; this.id = id; this.members = members;
    this.objective = null;    // point id
    this.role = null;         // 'attack' | 'defend'
    this.since = 0;
  }
  get leader() { return this.members.find((m) => !m.health.dead && !m.health.downed) ?? null; }
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
    this.waves = new Map();   // trench id -> { at, ready: Set<SquadTactics>, blown, x, z }
    this.support = null;      // SupportCommand: shells the objective before the whistle
    this.lanes = new Map();   // lane id -> the stretch of the front it holds (a point to SquadTactics)
    this.off = bus.on('mode:sector', () => { this.timer = 0; });
  }

  /** A point or a lane by id: what a squad's `objective` names. */
  target(id) { return this.lanes.get(id) ?? this.mode.points[id] ?? null; }

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
  #frontLanes(attack) {
    const M = this.mode, map = M.map, team = this.team, dir = team === 0 ? 1 : -1;
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

  dispose() { this.off?.(); }

  update(dt) {
    this.time += dt;
    this.#whistles();
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
      wants.push({ p, role: 'defend', w: 0.35 + enemyOn * 0.45 + losing * 0.9, min: enemyOn > 0 ? 2 : 0 });
    }
    for (const p of attack) {
      const gained = team === 0 ? 1 + p.progress : 1 - p.progress; // 0 = enemy-held, 2 = ours
      wants.push({ p, role: 'attack', w: 1 + (p.owner === -1 ? 0.25 : 0) + gained * 0.3, min: 1 });
    }
    if (!wants.length) return;
    const squads = this.squads.filter((s) => s.alive > 0 || s.members.length);
    let n = squads.length;
    // The line: lanes for the squads the points don't need (the gaps and the flanks first). Never
    // the squads every attack point needs, or the two a point being taken from us gets.
    const pressed = defend.some((p) => p.counts[1 - team] > 0), need = wants.reduce((a, x) => a + (x.min ?? 0), 0);
    const lineN = n >= 4 ? Math.min(n - Math.max(1, need), Math.round(n * (pressed ? 0.25 : 0.4))) : 0;
    if (lineN > 0) {
      const lanes = this.#frontLanes(attack), pts = [...attack, ...defend];
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
        // A lane on a shared field: that's the way to the nearest lane, not this one: as the crow flies.
        const f = x.p.shared ? null : this.nav?.want(x.p.field ?? `pt:${x.p.id}`, x.p.pos.x, x.p.pos.z, x.p.radius * 0.6);
        const r = f ? this.nav.distance(f, at.x, at.z) : Infinity, d = r < Infinity ? r : at.distanceTo(x.p.pos);   // beyond a big map's field: as the crow flies
        if (d < bd) { bd = d; best = x; }
      }
      if (!best) best = pointWants.reduce((a, b) => (b.w > a.w ? b : a), pointWants[0] ?? wants[0]);
      best.slots--;
      this.#order(s, best.p, best.role);
    }
    // Refresh the per-bot orders (members change as they respawn into squads; lanes move with the front).
    for (const s of squads) { const p = this.target(s.objective); if (p) this.#order(s, p, s.role, true); }
  }

  #order(squad, point, role, refresh = false) {
    if (!refresh && (squad.objective !== point.id || squad.role !== role)) { squad.objective = point.id; squad.role = role; squad.since = this.time; }
    squad.members.forEach((m, slot) => {
      if (!m.brain) return;
      m.brain.objective = { id: point.id, pos: point.pos, radius: point.radius, field: point.field ?? `pt:${point.id}`, shared: !!point.shared, role, slot, of: squad.members.length, squad };
    });
  }
}
