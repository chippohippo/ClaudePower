// MatchStats: the scoreboard's numbers, the ribbons earned during a match, and the story of it for
// the after-action report (docs/FRONTLINE.md, "Match flow"). Sim only, one per session
// (session.match); nothing here changes the battle.
//
//  * Every soldier of the two armies (civilians and gangs aren't counted) has a line: score (every
//    battle point earned, teamkill penalties taken off), kills (downs and kills: BattlePoints'
//    `kill`), deaths, assists, revives, captures (points taken or neutralized while on them),
//    vehicles (vehicles and deployables destroyed), support (the points from resupplying, healing,
//    repairing, building and delivering), spots (an enemy you revealed taken down by someone else).
//    It's all read off the battle points' ledger (bp:earn), so a soldier scores for exactly what
//    earns him points, and off entity:death.
//  * Ribbons (Battlefield's): every so many of a thing in one match earns its ribbon again (four
//    kills, three revives, two captures...; RIBBONS), announced as it's earned. At the end, the
//    best score on each side is its MVP.
//  * The match's story: every sector that changed hands (when, to whom) and both sides' tickets
//    every 15 s.
// Events: ribbon:earn { id, ribbon, name, count }.

import { CIVILIAN, BANDIT } from '../combat/Teams.js';
import { bus } from '../core/EventBus.js';

/** The ribbons: one each time a soldier's count of `of` in this match reaches another `every`. */
export const RIBBONS = {
  combat:    { name: 'Combat',       of: 'kills',    every: 4,   desc: '4 enemies taken down' },
  medic:     { name: 'Field Medic',  of: 'revives',  every: 3,   desc: '3 teammates revived' },
  objective: { name: 'Objective',    of: 'captures', every: 2,   desc: '2 points taken or neutralized' },
  defender:  { name: 'Defender',     of: 'defend',   every: 150, desc: '15 s holding a point under attack' },
  armor:     { name: 'Anti-Armor',   of: 'vehicles', every: 2,   desc: '2 vehicles or emplacements destroyed' },
  support:   { name: 'Support',      of: 'support',  every: 300, desc: '300 points of resupply, healing, repairs, building or deliveries' },
  recon:     { name: 'Recon',        of: 'spots',    every: 3,   desc: '3 enemies you revealed taken down' },
  teamwork:  { name: 'Teamwork',     of: 'assists',  every: 5,   desc: '5 kill assists' },
};
/** What each battle-point reason counts toward. */
const COUNTS = { kill: 'kills', assist: 'assists', revive: 'revives', capture: 'captures', neutralize: 'captures', vehicle: 'vehicles', object: 'vehicles', spot: 'spots', finish: 'finishes' };
const SUPPORT = new Set(['resupply', 'heal', 'repair', 'build', 'deliver']);
const SAMPLE = 15;   // s between the tickets' samples

export class MatchStats {
  /**
   * @param {object} world  CombatWorld (world.entity)
   * @param {object} mode   FrontlineMode (tickets, sectors, winner)
   */
  constructor(world, mode) {
    this.world = world; this.mode = mode;
    this.lines = new Map();       // id -> line
    this.flips = [];              // { t, sector, team }
    this.tickets = [];            // { t, tickets: [a, b] }
    this.time = 0; this.next = 0;
    this.off = [
      bus.on('bp:earn', (e) => this.#earn(e)),
      bus.on('entity:death', (e) => { const l = this.#line(this.world.entity(e.id)); if (l) l.deaths++; }),
      bus.on('mode:sector', (e) => this.flips.push({ t: Math.round(this.mode.time ?? this.time), sector: e.sector, team: e.team })),
    ];
  }

  dispose() { this.off.forEach((f) => f()); }

  update(dt) {
    this.time += dt;
    if (this.time >= this.next && this.mode.winner < 0) { this.next = this.time + SAMPLE; this.tickets.push({ t: Math.round(this.time), tickets: [...this.mode.tickets] }); }
  }

  /** A soldier's line (null for civilians, gangs, vehicles and anything else that isn't one). */
  line(e) { return this.#line(e); }

  /** Lines of `team`, best score first (ties: more kills, fewer deaths). Soldiers who never scored or died are still there. */
  board(team) {
    const out = [];
    for (const l of this.lines.values()) if (l.team === team) out.push(l);
    return out.sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths || a.id - b.id);
  }

  /** The best score on `team` (null if nobody scored). */
  mvp(team) { const b = this.board(team); return b.length && b[0].score > 0 ? b[0] : null; }

  /** Register a soldier (the session does, for every fighter it fields, so the board lists them all). */
  add(e) { this.#line(e); }

  #line(e) {
    if (!e || e.isVehicle || e.isDeployable || e.team === CIVILIAN || e.team === BANDIT || !(e.team === 0 || e.team === 1)) return null;
    let l = this.lines.get(e.id);
    if (!l) {
      l = { id: e.id, team: e.team, name: e.name ?? `#${e.id}`, classId: e.classId ?? null, squad: e.squad?.callsign ?? null, human: !e.brain,
        score: 0, kills: 0, deaths: 0, assists: 0, revives: 0, captures: 0, vehicles: 0, support: 0, spots: 0, finishes: 0, defend: 0,
        ribbons: {} };
      this.lines.set(e.id, l);
    }
    // (Names, squads and classes can change after the line is made: the latest are shown.)
    if (e.name) l.name = e.name;
    if (e.squad?.callsign) l.squad = e.squad.callsign;
    if (e.classId) l.classId = e.classId;
    return l;
  }

  #earn(ev) {
    const e = this.world.entity(ev.id), l = this.#line(e);
    if (!l) return;
    l.score = Math.max(0, l.score + ev.amount);
    const c = COUNTS[ev.why];
    if (c) l[c]++;
    if (SUPPORT.has(ev.why)) l.support += ev.amount;
    if (ev.why === 'defend') l.defend += ev.amount;
    for (const [id, R] of Object.entries(RIBBONS)) {
      const have = l.ribbons[id] ?? 0, due = Math.floor(l[R.of] / R.every);
      if (due > have) { l.ribbons[id] = due; bus.emit('ribbon:earn', { id: l.id, ribbon: id, name: R.name, count: due }); }
    }
  }

  /**
   * The after-action report's facts: winner, reason, duration, tickets, the story, both boards
   * and MVPs, and `me`'s line (with its ribbons and rank on its side).
   */
  report(meId = null) {
    const M = this.mode, me = meId != null ? this.lines.get(meId) ?? null : null;
    const boards = [this.board(0), this.board(1)];
    return {
      winner: M.winner, reason: M.reason ?? null, duration: Math.round(M.time ?? this.time), tickets: [...M.tickets],
      flips: this.flips.slice(), samples: this.tickets.concat([{ t: Math.round(M.time ?? this.time), tickets: [...M.tickets] }]),
      boards, mvp: [this.mvp(0), this.mvp(1)],
      me, place: me ? boards[me.team].indexOf(me) + 1 : 0,
    };
  }
}
