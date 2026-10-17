// SupportCommand: one per team. It runs the team's field guns and supply trucks with dedicated
// crews (bots taken out of the infantry at the start of the match; they redeploy beside their unit).
//
//  * Units: every gun pad in the park and every truck pad at the HQ dump is a unit with a crew of
//    one (big batteries also get a loader). CrewPilot drives the vehicle; this decides where it
//    goes and what it shoots.
//  * Posts: batteries (howitzers, rocket batteries) set up in the park of the team's front sector.
//    The park moves with the front and the crews move the guns there. AT guns set up AT_BACK m
//    behind the front-line trench, facing the enemy, spread across the lanes of the attacked
//    sector: where the enemy's armor has to come through.
//  * Fire missions, re-planned every second, highest priority first:
//      6  SOS: the enemy blew its whistles. Fire on the ground in front of the trench they are
//         leaving, while they cross it.
//      5  preparation: our commander is about to send a wave over. Shell the enemy-held points
//         ahead of it (prepare() pushes that whistle back while the barrage lands), lifting
//         early enough that the last rounds are down when the wave goes.
//      4  counter-battery: enemy guns located from their muzzle flashes (more shots, better fix).
//      2+ observed fire: groups of enemies our soldiers can see.
//      1  interdiction: the enemy's forward depot (howitzers only, a few rounds, not too often).
//    Never danger close: no mission within DANGER m of our own soldiers. Low on ammo, a battery
//    only answers priority 4 and up.
//  * Trucks run HQ dump -> forward depot -> back (CrewPilot), so the front stays supplied.
// Events: support:mission { team, unit, kind, x, z, pri }.

import { Vector3 } from 'three';
import { bus } from '../core/EventBus.js';

const DIR = [1, -1];
const DANGER = 32;        // m: no shells this close to our own soldiers
const AT_BACK = 30;       // m behind the front-line trench where AT guns set up
const CLUSTER = 18;       // m cells for grouping spotted enemies
const PLAN = 1;           // s between plans
const INTERDICT = 50;     // s between interdiction missions
const PREP = 12;          // s a whistle waits for its preparation barrage (when there is a battery to fire it)
const LIFT = 5;           // s before the whistle the guns stop firing (rounds in the air still land)

export class SupportCommand {
  /**
   * @param {number} team
   * @param {object} o { world, map, mode, logistics }
   */
  constructor(team, { world, map, mode, logistics = null }) {
    this.team = team; this.world = world; this.map = map; this.mode = mode; this.logistics = logistics;
    this.units = [];
    for (const pad of world.vehicles.pads) {
      if (pad.team !== team || (pad.group !== 'park' && pad.group !== 'hq')) continue;
      this.units.push({ id: this.units.length, kind: pad.kind, pad, team, crew: [], post: null, field: null, facing: team === 0 ? -Math.PI / 2 : Math.PI / 2, mission: null, leg: null });
    }
    this.time = 0; this.next = 0;
    this.enemyGuns = new Map();     // gun id -> { shots, last, ox, oz }
    this.prep = null;               // { points: [{x, z, r}], until, ended }
    this.prepEnded = -1e9;
    this.interdictAt = -1e9;        // last interdiction mission (one every INTERDICT s at most)
    this.sos = null;                // { x, z, r, until }
    this.offs = [
      bus.on('gun:fire', (e) => this.#heard(e)),
      bus.on('squad:whistle', (e) => this.#whistle(e)),
    ];
  }

  dispose() { this.offs.forEach((f) => f()); }

  /** The live vehicle of a unit (or null while its replacement is on the way). */
  vehicle(u) { const v = u.pad.current; return v && !v.removed && !v.health.dead ? v : null; }

  /** How many crew each unit gets. */
  crewSlots(players) {
    const out = [];
    for (const u of this.units) {
      out.push({ unit: u, seat: 0 });
      if (u.kind === 'howitzer' && players >= 256) out.push({ unit: u, seat: 1 });
    }
    return out;
  }

  assign(f, unit, seat) {
    unit.crew[seat] = f;
    f.duty = { unit, seat };
    if (f.brain) f.brain.duty = f.duty;
  }

  update(dt) {
    this.time += dt;
    this.next -= dt;
    if (this.next > 0) return;
    this.next = PLAN;
    this.#posts();
    this.#missions();
  }

  // ---------------------------------------------------------------- where the units go
  #posts() {
    const nav = this.world.nav, team = this.team;
    const front = this.map.sectors[this.mode.front[team]];
    const atk = this.map.sectors[this.mode.attackSector(team)];
    const ats = this.units.filter((u) => u.kind === 'at');
    // The line the AT guns cover: the trench on the boundary of our front sector.
    const lineX = front ? (team === 0 ? front.x1 : front.x0) : null;
    const lanes = (atk?.points ?? []).map((id) => this.map.points[id].pos.z).sort((a, b) => a - b);
    ats.forEach((u, k) => {
      if (lineX === null) { u.post = u.pad.at.clone(); return; }
      const z0 = lanes.length ? lanes[k % lanes.length] + Math.floor(k / lanes.length) * 22 : (k - (ats.length - 1) / 2) * 40;
      const want = this.#open(lineX - DIR[team] * AT_BACK, z0);
      if (!u.post || u.post.distanceTo(want) > 12) this.#setPost(u, want);
    });
    for (const u of this.units) {
      if (u.kind === 'at') continue;
      if (u.kind === 'truck') { u.post = null; continue; }
      if (!u.post || u.post.distanceTo(u.pad.at) > 4) this.#setPost(u, u.pad.at.clone());
    }
    void nav;
  }

  #setPost(u, p) {
    u.post = p;
    u.field = `post:${this.team}:${u.id}:${Math.round(p.x)}:${Math.round(p.z)}`;
  }

  /** A walkable, fairly level spot near (x, z) (searching outward). */
  #open(x, z) {
    const nav = this.world.nav, t = this.map.terrain;
    for (let r = 0; r <= 24; r += 4) {
      for (let k = 0; k < (r ? 8 : 1); k++) {
        const a = (k / 8) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (nav?.blocked(px, pz) || (t && t.slopeDeg(px, pz) > 14)) continue;
        if (this.logistics?.inTrench(px, pz)) continue;
        return new Vector3(px, t ? t.height(px, pz) : 0, pz);
      }
    }
    return new Vector3(x, t ? t.height(x, z) : 0, z);
  }

  // ---------------------------------------------------------------- what they shoot
  /** Our commander is about to blow a whistle on trench T: shell what's ahead. Returns seconds to wait for it. */
  prepare(T, z, at) {
    if (this.time - this.prepEnded < 30 || (this.prep && this.time < this.prep.until)) return 0;
    const batteries = this.units.filter((u) => (u.kind === 'howitzer' || u.kind === 'rockets') && this.#ready(u));
    if (!batteries.length) return 0;
    const atk = this.map.sectors[this.mode.attackSector(this.team)];
    const pts = (atk?.points ?? []).map((id) => this.mode.points[id]).filter((p) => p.owner !== this.team)
      .sort((a, b) => Math.abs(a.pos.z - z) - Math.abs(b.pos.z - z)).slice(0, 2);
    if (!pts.length) return 0;
    this.prep = { points: pts.map((p) => ({ x: p.pos.x, z: p.pos.z, r: p.radius + 10 })), until: at + PREP - LIFT, trench: T.id };
    bus.emit('support:prep', { team: this.team, trench: T.id, until: this.prep.until, points: pts.map((p) => p.id) });
    return PREP;
  }

  /** Set up (or setting up) with rounds to fire. */
  #ready(u) { const v = this.vehicle(u); return !!v && !!v.seats[0]?.occupant && v.gun?.ammo > 0 && v.gun.state !== 'packing'; }

  #heard(e) {
    if (e.team === this.team) return;
    let g = this.enemyGuns.get(e.id);
    if (!g) {
      // Each enemy gun's first fix is off by a fixed error, shrinking with every shot heard.
      const h = Math.sin(e.id * 12.9898) * 43758.5453, a = (h - Math.floor(h)) * Math.PI * 2;
      g = { shots: 0, last: 0, ox: Math.cos(a), oz: Math.sin(a) };
      this.enemyGuns.set(e.id, g);
    }
    g.shots++; g.last = this.time;
  }

  #whistle(e) {
    if (e.team === this.team) return;
    // They are coming out of their trench at (e.x, e.z), toward us: shell the ground they must cross.
    this.sos = { x: e.x + DIR[e.team] * 30, z: e.z, r: 24, until: this.time + 15 };
  }

  #missions() {
    const team = this.team, w = this.world, time = this.time;
    const cands = [];
    if (this.sos && time < this.sos.until) cands.push({ ...this.sos, kind: 'sos', pri: 6 });
    if (this.prep) {
      if (time < this.prep.until) for (const p of this.prep.points) cands.push({ ...p, until: this.prep.until, kind: 'prep', pri: 5 });
      else { this.prep = null; this.prepEnded = time; }
    }
    for (const [id, g] of this.enemyGuns) {
      const v = w.entity(id);
      if (!v || v.removed || v.health?.dead || time - g.last > 40) { if (!v || v.removed) this.enemyGuns.delete(id); continue; }
      if (g.shots < 2) continue;
      const err = 30 / Math.sqrt(g.shots), p = v.movement.state.position;
      cands.push({ x: p.x + g.ox * err, z: p.z + g.oz * err, r: 8 + err * 0.5, until: time + 12, kind: 'counter', pri: 4, gun: id });
    }
    for (const c of this.#clusters()) cands.push({ ...c, until: time + 10, kind: 'observed', pri: 2 + Math.min(6, c.n) * 0.4 });
    const ed = this.logistics?.front(1 - team);
    if (ed && ed.stock > 30 && time - this.interdictAt > INTERDICT) cands.push({ x: ed.pos.x, z: ed.pos.z, r: 9, until: time + 20, kind: 'interdict', pri: 1 });
    const safe = cands.filter((c) => !this.#friendsNear(c.x, c.z, DANGER + c.r * 0.5)).sort((a, b) => b.pri - a.pri);

    for (const u of this.units) {
      if (u.kind !== 'howitzer' && u.kind !== 'rockets') continue;
      const v = this.vehicle(u);
      if (!v) { u.mission = null; continue; }
      const G = v.gun, d = v.def.gun, [lo, hi] = w.vehicles.guns.range(d), p = v.movement.state.position;
      const m = u.mission;
      // Keep the current mission while it lasts and nothing much more urgent comes up.
      const rounds = m ? G.shots - (m.start ?? G.shots) : 0;
      const keep = m && time < m.until && rounds < m.rounds && !safe.some((c) => c.pri >= m.pri + 2) && safe.some((c) => c.kind === m.kind && Math.hypot(c.x - m.x, c.z - m.z) < 30);
      if (keep) continue;
      const low = G.ammo < 3;
      const pick = safe.find((c) => {
        if (low && c.pri < 4) return false;
        if (u.kind === 'rockets' && (c.kind === 'counter' || c.kind === 'interdict')) return false;    // rockets saturate areas, not point targets
        const r = Math.hypot(c.x - p.x, c.z - p.z);
        return r > lo * 1.1 && r < hi * 0.97;
      });
      u.mission = pick ? { x: pick.x, z: pick.z, r: pick.r, kind: pick.kind, pri: pick.pri, until: pick.until, rounds: u.kind === 'rockets' ? d.salvo : ROUNDS[pick.kind] ?? 3, start: null } : null;
      if (pick?.kind === 'interdict') this.interdictAt = time;
      if (pick && (!m || m.kind !== pick.kind || Math.hypot(m.x - pick.x, m.z - pick.z) > 20)) bus.emit('support:mission', { team, unit: u.id, gun: v.id, kind: pick.kind, x: pick.x, z: pick.z, pri: pick.pri });
    }
  }

  /** Groups of enemies our soldiers can see (anything a friendly bot saw in the last 3 s). */
  #clusters() {
    const seen = new Set(), team = this.team;
    for (const e of this.world.entities) {
      if (e.team !== team || e.health.dead || !e.brain) continue;
      const t = e.brain.target;
      if (t && !t.health?.dead && !t.health?.downed && !t.isVehicle && !t.vehicle && e.brain.time - e.brain.sawAt < 3) seen.add(t);
    }
    const cells = new Map();
    for (const t of seen) {
      const p = t.movement.state.position, k = `${Math.floor(p.x / CLUSTER)},${Math.floor(p.z / CLUSTER)}`;
      const c = cells.get(k) ?? { x: 0, z: 0, n: 0 };
      c.x += p.x; c.z += p.z; c.n++;
      cells.set(k, c);
    }
    const out = [];
    for (const c of cells.values()) if (c.n >= 2) out.push({ x: c.x / c.n, z: c.z / c.n, r: 10, n: c.n });
    return out;
  }

  #friendsNear(x, z, r) {
    let found = false;
    this.world.fightersNear({ x, z }, r + 2, (e) => {
      if (found || e.team !== this.team || e.health.dead || e.isDeployable) return;
      const p = e.movement.state.position;
      if (Math.hypot(p.x - x, p.z - z) < r) found = true;
    });
    return found;
  }
}

/** Rounds per gun per mission. */
const ROUNDS = { sos: 4, prep: 5, counter: 4, observed: 3, interdict: 2 };
