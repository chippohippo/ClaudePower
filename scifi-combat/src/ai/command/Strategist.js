// Strategist: the AI in the commander's seat (veteran and up; FrontlineCommander gives its orders).
// It plays the book, the way a good commander does: the standing orders' plan, carried out well.
//
//  * The plan: the standing orders' (the points in play by need, the line), as they go on from where
//    the squads are, every few seconds (veteran 4 s, elite 2.5 s). Squads hold a task a while
//    rather than turning round on every glimpse of the enemy (standing orders' `hold`).
//  * Our own sector never left to him: while he's near it, or it's our last line before the HQ (lose
//    it and he's through), at least a squad holds it: the nearest one not in a fight goes to the
//    point he threatens most.
//  * Attacks go in together: squads sent at an enemy-held point together wait short of it (70 m back
//    along the way) until the last of them is close, then go in at once; the guns prepare the point
//    as they go, if we can see what's on it.
//  * Scouts (veteran one, elite two, with men to spare): eyes on the points we'll attack and ours
//    under threat that nobody's watching; what they see, the guns can hit.
//  * Elite squads take orders more readily, too (difficulty `obey`).
//
// Thinking further ahead (`search` > 0; off at every level as shipped): plans weighed by playing 75 s
// of battle forward against the enemy's answers, departing from the book where that wins by a
// margin for every squad moved. Measured against standing orders in AI-vs-AI matches it did worse
// than the book it starts from (the forward model can't yet tell this sim's firefights apart well
// enough), so it stays off until it can. What it weighs:
//  * The board: the points in play (the sector we attack, and ours he attacks; in the opening the
//    neutral middle, both), the lanes of the front, and every squad: where it is, how strong (its
//    men up, the hurt counting for less, the dead coming back with the next wave), how long it
//    takes to get anywhere (along the routes).
//  * The enemy, from what we know (intel): who's been seen where and how lately, and the soldiers
//    on each point (anyone can see who's taking a point). The rest of his men, unseen, are on the
//    points he'd hold or take and a few on the line, there once they could have walked up from his
//    spawn since the front last moved (and not yet where we've looked lately and seen nobody).
//    Readings are averaged over a few seconds; lower commanders misjudge him more (`noise`).
//  * A plan played forward: every squad sent to a point, a lane or the reserve; 75 s of battle in
//    5 s steps. Squads join the fight when they get there; where both sides are, they wear each other
//    down by the square law (the side that owns the point fights from cover, nobody on a neutral
//    one), the fallen coming back with the next wave (fast beside a side's own spawn). A squad on a
//    lane fires into the fights at the points beside it. A side that has a point (nearly) to itself
//    takes it at the rules' speed.
//    The score: how near each side is to taking a sector (each point still to take a long way
//    further), over the second half of what's played forward; lanes he holds and we don't; men lost
//    on each side (tickets); every order changed (a squad turned round mid-fight wastes the fight).
//  * Against his answers (`responses`): his forces where they are; reinforcing the points we attack
//    most; throwing his reserve at our weakest point; spreading out. A plan is only as good as its
//    worst answer (and a little of the rest).
//  * Search: from the book, each squad sent everywhere else a squad at a time, and the big moves
//    (every attacking squad on one point), `search` evaluations a plan, thought through a slice a
//    tick.

import { Vector3 } from 'three';
import { mulberry32 } from '../../world/Terrain.js';

const DIR = [1, -1];
const H = 75, STEP = 5;          // s played forward, in steps
const K = 0.022;                 // a squad's fire: strength the enemy loses per second per unit of ours
const COVER = 1.45;              // the side that owns a point fights from cover
const RUN = 4.2;                 // m/s a squad moves at
const SUPPORT = 0.4;             // a lane's fire into the fights at the points beside it
const SECTOR = 2.5, LOSE = 3;    // the sector we attack taken; ours lost
const ODDS = 0.4;                // ...the odds of it falling, for each point still to take
const RESERVE = -1;              // (a squad's assignment: the reserve)
const COMMIT = 30;               // s an order stands (turning a squad round sooner costs more)
const SLICE = 40;                // evaluations thought through a tick
const NS = Math.floor(H / STEP) + 1;   // steps played forward
let LATE = 0;                          // ...of them in the second half (the sectors are judged over those)
for (let t = 0; t <= H; t += STEP) if (t >= H / 2) LATE++;
const _c = new Vector3();

export class Strategist {
  /**
   * @param {number} team
   * @param {object} o { world, mode, cfg: the difficulty's `command` ({ search, responses, noise, stage, scout, fire, reserve, margin, screen }), seed, wave: s between reinforcement waves }
   */
  constructor(team, { world, mode, cfg = {}, seed = 1, wave = 6 }) {
    this.team = team; this.world = world; this.mode = mode; this.wave = wave;
    this.cfg = { search: 120, responses: 2, noise: 0.15, stage: true, scout: 1, fire: true, reserve: false, margin: 0.75, screen: 0.1, ...cfg };
    this.rand = mulberry32(seed * 7907 + team * 31 + 3);
    this.stages = new Map();     // point id -> { place, squads: Set, since, go }
    this.judge = new Map();      // objective id -> { f: how far off our reading of it is, t }
    this.reading = new Map();    // objective id -> { e0, e1, u, t }: the enemy there, averaged over time
    this.lastFire = -1e9;
    this.time = 0;
    this.frontKey = null; this.frontT = 0;   // when the front last moved (everyone walking up since)
    this.last = null;            // the last plan's numbers (for the command view and tests): { score, evals, objectives, assign }
  }

  /** Still thinking a plan through (the commander calls plan() every tick until it's done). */
  get thinking() { return !!this.job; }

  /**
   * Think, and give the orders: started by the commander every few seconds, thought through a slice
   * at a time (SLICE evaluations a tick: no hitch however deep it looks), played when it's done.
   */
  plan(cmd) {
    const t0 = performance.now();
    if (!this.job) {
      this.time = cmd.time;
      const board = this.#board(cmd);
      if (!board) return;
      this.job = { board, it: this.#search(board, cmd), ms: 0, worst: 0, ticks: 0, split: [performance.now() - t0, 0, 0, 0] };
    }
    const J = this.job, r = J.it.next();
    if (!r.done) { const ms = performance.now() - t0; J.ms += ms; J.worst = Math.max(J.worst, ms); J.ticks++; return; }
    this.job = null;
    this.time = cmd.time;
    const best = r.value, B = J.board, t1 = performance.now();
    this.#play(cmd, B, best);
    const t2 = performance.now();
    this.#support(cmd, B, best);
    const ms = performance.now() - t0;
    J.split[1] = t1 - t0; J.split[2] = t2 - t1; J.split[3] = performance.now() - t2;   // (the board; the last slice; playing it; support)
    this.last = { score: best.score, evals: B.evals, ms: J.ms + ms, worst: Math.max(J.worst, ms), ticks: J.ticks + 1, split: J.split, book: best.book ?? false, objectives: B.obj.map((o) => ({ id: o.p.id, kind: o.kind, enemy: +(o.e0 + o.e1 + o.u).toFixed(2), name: o.p.name })), assign: best.assign.slice() };
  }

  // ---------------------------------------------------------------- the board
  #board(cmd) {
    const M = this.mode, team = this.team, enemy = 1 - team, I = this.world.intel?.[team];
    const atkS = M.attackSector(team), defS = M.attackSector(enemy);
    const fk = `${M.front[0]}:${M.front[1]}`;
    if (fk !== this.frontKey) { this.frontKey = fk; this.frontT = this.time; }
    // The points in play, each once: ours to hold, the rest to take (`atk`: of the sector we attack; `def`: of ours he attacks).
    const obj = [];
    for (const p of M.points) {
      const atk = p.sector === atkS, def = p.sector === defS;
      if ((!atk && !def) || !M.capturable(p)) continue;
      obj.push({ p, kind: p.owner === team ? 'defend' : 'attack', atk, def, value: 1 });
    }
    if (!obj.length) return null;
    const P = obj.length;
    for (const L of cmd.frontLanes(M.objectives(team).attack)) obj.push({ p: L, kind: 'line', value: 0, adj: [] });
    // A lane's fire reaches the point nearest it (and the next, if that's nearly as near).
    for (let k = P; k < obj.length; k++) {
      const L = obj[k].p.pos, d = [];
      for (let i = 0; i < P; i++) d.push([Math.hypot(obj[i].p.pos.x - L.x, obj[i].p.pos.z - L.z), i]);
      d.sort((a, b) => a[0] - b[0]);
      obj[k].adj = d.filter(([x], j) => x < 160 && (j === 0 || x < d[0][0] * 1.35)).slice(0, 2).map(([, i]) => i);
      obj[k].gap = d.length ? d[0][0] : 100;   // (how far from any point: the gaps and the flanks)
    }
    // Squads: strength now (the hurt count for less), and when the dead come back.
    const spawn = this.#spawn(team);
    const squads = cmd.squads.filter((s) => s.members.length);
    const sq = squads.map((s) => {
      let str = 0, n = 0;
      for (const m of s.members) {
        if (m.health.dead) continue;
        n++;
        str += m.health.downed ? 0.25 : 0.4 + 0.6 * Math.min(1, (m.health.hp + m.health.shield) / (m.health.max + m.health.maxShield));
      }
      const back = (s.members.length - n) * 0.85;   // the dead, back with the next wave (at the front's spawn)
      const at = s.center(_c) ? _c.clone() : spawn.clone();
      const busy = s.tactics?.phase === 'contact' || s.tactics?.phase === 'clear' || s.tactics?.phase === 'charge';
      // An order stands a while: a squad sent somewhere and turned round before it's done anything has wasted the trip.
      const committed = !!s.pending || (!!s.order && this.time - s.order.issued < COMMIT);
      return { s, str, back, at, busy, committed, cur: -2, eta: new Float64Array(obj.length) };
    });
    // How long each squad takes to each objective (along the routes; in a fight, it has to break off first).
    for (const q of sq) {
      for (let k = 0; k < obj.length; k++) q.eta[k] = cmd.eta(obj[k].p, q.at, false) / RUN + (q.busy ? 8 : 0);
      q.cur = obj.findIndex((o) => o.p.id === q.s.objective);
      const st = [...this.stages.values()].find((g) => g.squads.has(q.s));
      if (st) q.cur = obj.findIndex((o) => o.p.id === st.point);
    }
    // The enemy at each objective: seen (fresher counts for more) or on the point, now; the unseen
    // rest where he'd have them, once they could have got there.
    const theirs = Math.max(1, squads.reduce((a, s) => a + s.members.length, 0) * 0.8);   // (as many as us: some hurt, some dead)
    const his = this.#spawn(enemy), walked = this.time - this.frontT;
    let seen = 0;
    for (const o of obj) {
      const r = o.p.radius + (o.kind === 'line' ? 25 : 45), x = o.p.pos.x, z = o.p.pos.z;
      let w = 0, wd = 0;
      I?.near(x, z, r, 40, (c) => { const age = I.time - c.t, f = age < 6 ? 1 : Math.max(0.3, 1 - age / 40); w += f; wd += f * Math.max(0, Math.hypot(c.x - x, c.z - z) - o.p.radius); });
      // On the point now; seen round it, on it once they've fought their way across the ground between.
      o.e0 = o.kind === 'line' ? w : (o.p.counts?.[enemy] ?? 0);
      o.e1 = Math.max(0, w - o.e0); o.t1 = o.e1 > 0 ? ((wd / w) / RUN) * 1.5 + 3 : 0;
      o.stale = I ? I.staleness(x, z, Math.min(40, r)) : Infinity;
      // His men walking up from his spawn since the front last moved; where we're watching and see nobody, not for a while yet.
      o.tE = Math.max(0, (Math.hypot(his.x - o.p.pos.x, his.z - o.p.pos.z) * 1.15) / RUN - walked, o.stale < 20 ? 10 : 0);
      seen += o.e0 + o.e1;
    }
    // (Many of his men are elsewhere: walking up, dead, behind his line.)
    const unseen = Math.max(0, theirs - seen) * 0.6;
    // (His line, like ours, holds the gaps and the flanks first: the lanes furthest from any point.)
    let gs = 0, nl = 0, ws = 0;
    for (const o of obj) if (o.kind === 'line') { gs += o.gap; nl++; }
    const wt = (o) => (o.kind === 'line' ? 0.25 * (nl ? (o.gap * nl) / gs : 1) : 1);
    for (const o of obj) ws += wt(o);
    for (const o of obj) o.u = (unseen * wt(o)) / ws;
    // Readings of the enemy change with every glimpse: each objective's is kept as a running average
    // (over about 8 s), so the plan follows what he does, not who happened to be seen this second.
    for (const o of obj) {
      let r = this.reading.get(o.p.id);
      const k = r ? 1 - Math.exp(-(this.time - r.t) / 8) : 1;
      if (!r) this.reading.set(o.p.id, (r = { e0: 0, e1: 0, u: 0, t: this.time }));
      r.e0 += (o.e0 - r.e0) * k; r.e1 += (o.e1 - r.e1) * k; r.u += (o.u - r.u) * k; r.t = this.time;
      o.e0 = Math.max(r.e0, o.p.counts?.[enemy] ?? 0); o.e1 = r.e1; o.u = r.u;   // (who's on the point counts at once)
    }
    // Misjudgement: a reading of each objective that's off by up to `noise`, and stays off a while (30 s).
    const nz = this.cfg.noise;
    for (const o of obj) {
      let j = this.judge.get(o.p.id);
      if (!j || this.time - j.t > 30) this.judge.set(o.p.id, (j = { f: 1 + (this.rand() * 2 - 1) * nz, t: this.time }));
      o.e0 = Math.max(0, o.e0 * j.f); o.e1 = Math.max(0, o.e1 * j.f); o.u = Math.max(0, o.u * j.f);
    }
    // The dead come back: the next wave, then the walk from the side's spawn (fast beside his own line).
    for (const o of obj) {
      o.backA = Math.ceil((this.wave / 2 + 4 + (Math.hypot(spawn.x - o.p.pos.x, spawn.z - o.p.pos.z) * 1.15) / RUN) / STEP);
      o.backE = Math.ceil((this.wave / 2 + 4 + (Math.hypot(his.x - o.p.pos.x, his.z - o.p.pos.z) * 1.15) / RUN) / STEP);
    }
    // Points: who holds them and how far the capture is (+1 ours, -1 theirs).
    for (const o of obj) o.held = o.kind === 'line' ? 0 : (team === 0 ? 1 : -1) * (o.p.progress ?? 0);
    // Our own sector under attack (not the middle: there we attack too): how badly we can lose it.
    // The last line before our HQ is the battle: lose it and he's through.
    const home = obj.some((o) => o.def && !o.atk);
    const lastLine = home && M.map.sectors[M.front[team] - DIR[team]]?.kind === 'hq';
    let threat = 0;
    for (const o of obj) if (o.def && !o.atk) threat += o.e0 + o.e1;
    return { obj, P, sq, theirs, evals: 0, spawn, home, lastLine, threat, lose: LOSE * (lastLine ? 3 : 1) };
  }

  /** Where a side's men come on: the middle of its front sector's spawns (its HQ, if the front's back there). */
  #spawn(team) {
    const M = this.mode, sec = M.map.sectors[M.front[team]], list = sec && sec.kind !== 'hq' ? sec.spawns?.[team] ?? [] : [];
    if (!list.length) return M.map.hq[team];
    const out = new Vector3();
    for (const p of list) out.add(p);
    return out.divideScalar(list.length);
  }

  // ---------------------------------------------------------------- thinking it through
  /** Search plans (an objective per squad) for the best against his answers (a generator: it yields every SLICE evaluations). */
  *#search(B, cmd) {
    const n = B.sq.length, m = B.obj.length;
    // The book: where standing orders would send them.
    const book = new Int32Array(n);
    const bk = new Map(cmd.standingPlan(B.sq.map((q) => q.s), false).map((x) => [x.s, x.p.id]));
    for (let i = 0; i < n; i++) { const k = B.obj.findIndex((o) => o.p.id === bk.get(B.sq[i].s)); book[i] = k >= 0 ? k : this.#nearest(B, i); }
    const assign = new Int32Array(n);
    for (let i = 0; i < n; i++) assign[i] = B.sq[i].cur >= 0 ? B.sq[i].cur : book[i];
    this.#guard(B, book);
    const now = { assign: Int32Array.from(assign), score: this.#score(B, assign) };
    let best = now;
    const b = this.#score(B, book);
    if (!(this.cfg.search > 0)) return { assign: book, score: b, book: true };   // (no departures from the book: see the header)
    if (b > best.score) best = { assign: book, score: b, book: true };
    const budget = this.cfg.search;
    // Big moves first: everything attacking on one point.
    const atk = [];
    for (let k = 0; k < B.P; k++) if (B.obj[k].kind === 'attack') atk.push(k);
    if (atk.length > 1) for (const k of atk) {
      const a = Int32Array.from(best.assign);
      for (let i = 0; i < n; i++) if (B.obj[a[i]]?.kind === 'attack') a[i] = k;
      const s = this.#score(B, a);
      if (s > best.score) best = { assign: a, score: s };
    }
    let slice = B.evals + SLICE;
    if (B.evals >= slice - SLICE / 2) { yield; slice = B.evals + SLICE; }
    // Then a squad at a time: everywhere else (and the reserve, for elite).
    const options = [];
    for (let k = 0; k < m; k++) options.push(k);
    if (this.cfg.reserve && n >= 8) options.push(RESERVE);
    let i = Math.floor(this.rand() * Math.max(1, n));
    while (B.evals < budget && n > 0) {
      const a = Int32Array.from(best.assign), was = a[i], onLane = was >= B.P;
      let improved = false;
      for (const k of options) {
        if (k === was || B.evals >= budget) continue;
        if (onLane && k >= B.P) continue;   // (from one stretch of the line to the next: nothing gained)
        a[i] = k;
        const s = this.#score(B, a);
        if (s > best.score + 1e-6) { best = { assign: Int32Array.from(a), score: s }; improved = true; }
      }
      a[i] = best.assign[i];
      i = (i + 1) % n;
      if (B.evals >= slice) { yield; slice = B.evals + SLICE; }
      if (!improved && B.evals > budget * 0.75 && this.rand() < 0.3) {
        // Swap two squads (a closer one for a further one).
        const j = Math.floor(this.rand() * n), k2 = Math.floor(this.rand() * n);
        if (j !== k2) { const c = Int32Array.from(best.assign); const t = c[j]; c[j] = c[k2]; c[k2] = t; const s = this.#score(B, c); if (s > best.score) best = { assign: c, score: s }; }
      }
    }
    // A new plan only if it's clearly better than going on with this one (no dithering).
    // The book (standing orders, as they'd go on from here) is the default: a plan that departs from
    // it has to be worth `margin` more for every squad it sends elsewhere. The model sees a lot, but
    // not everything, and a squad sent the wrong way costs more than one sent the usual way.
    let off = 0;
    for (let i = 0; i < n; i++) if (best.assign[i] !== book[i]) off++;
    const pick = off && best.score > b + this.cfg.margin * off ? best : { assign: book, score: b, book: true };
    if (this.onPick) this.onPick({ B, now, best, book: { assign: book, score: b }, pick });   // (tuning: what it weighed)
    return pick;
  }

  /**
   * Never our own sector left to him: while he's near it (or it's our last line before the HQ), at
   * least a squad's worth holds it. The nearest squad not in a fight (and not on our own points
   * already) goes to the point he threatens most.
   */
  #guard(B, assign) {
    if (!B.home || !(B.lastLine || B.threat > 1)) return;
    let on = 0, worst = -1, wv = -1;
    for (let k = 0; k < B.P; k++) {
      const o = B.obj[k];
      if (!o.def || o.atk) continue;
      const e = o.e0 + o.e1 + (o.held < 1 ? 2 : 0);   // (seen near it; or it's being taken)
      if (e > wv) { wv = e; worst = k; }
    }
    for (let i = 0; i < assign.length; i++) { const k = assign[i]; if (k >= 0 && k < B.P && B.obj[k].def && !B.obj[k].atk) on += B.sq[i].str; }
    if (on >= 1.5 || worst < 0) return;
    let pick = -1, bd = Infinity;
    for (let i = 0; i < assign.length; i++) {
      const q = B.sq[i], k = assign[i];
      if (q.str < 1 || (k >= 0 && k < B.P && B.obj[k].def && !B.obj[k].atk)) continue;
      const d = q.eta[worst] + (q.busy ? 15 : 0);
      if (d < bd) { bd = d; pick = i; }
    }
    if (pick >= 0) assign[pick] = worst;
  }

  #nearest(B, i) {
    let best = 0, bd = Infinity;
    for (let k = 0; k < B.P; k++) if (B.sq[i].eta[k] < bd) { bd = B.sq[i].eta[k]; best = k; }
    return best;
  }

  /** A plan's worth against his answers: the worst of them, and a little of the rest. */
  #score(B, assign) {
    const R = Math.max(1, this.cfg.responses);
    let worst = Infinity, sum = 0;
    for (let r = 0; r < R; r++) { const v = this.#play75(B, assign, r); worst = Math.min(worst, v); sum += v; }
    // What changing orders costs: a squad turned round (worse in a fight, worse still just after it was sent).
    let churn = 0;
    for (let i = 0; i < assign.length; i++) { const q = B.sq[i]; if (assign[i] !== q.cur && q.cur >= 0) churn += q.committed ? 2 : q.busy ? 1 : 0.5; }
    // Never our own sector left to him: while he's near it (or it's our last line), a squad stays on it.
    let guard = 0;
    if (B.home && (B.lastLine || B.threat > 1)) {
      let on = 0;
      for (let i = 0; i < assign.length; i++) { const k = assign[i]; if (k >= 0 && k < B.P && B.obj[k].def && !B.obj[k].atk) on += B.sq[i].str; }
      if (on < 1.5) guard = B.lastLine ? 4 : 2;
    }
    return 0.5 * worst + 0.5 * (sum / R) - churn - guard;
  }

  /**
   * 75 s of battle played forward under a plan and one of his answers (0 as he stands, 1 reinforcing
   * the points we hit hardest, 2 his reserve at our weakest point, 3 spread out).
   */
  #play75(B, assign, answer) {
    B.evals++;
    const O = B.obj, m = O.length, n = assign.length, P = B.P;
    if (!this.A || this.A.length !== m) { for (const k of ['A', 'E', 'E1', 'U', 'L', 'RA', 'held', 'extra', 'w', 'FA', 'FE']) this[k] = new Float64Array(m); this.RET = new Float64Array(2 * m * NS); }
    const { A, E, E1, U, L, RA, RET, held, extra, w, FA, FE } = this;
    RET.fill(0); RA.fill(0);
    let lostA = 0, lostE = 0;
    for (let k = 0; k < m; k++) { E[k] = O[k].e0; E1[k] = O[k].e1; U[k] = O[k].u; held[k] = O[k].held; L[k] = 0; extra[k] = 0; w[k] = 0; }
    // His answer: where his free men go (some of what he has, 20 s from now).
    const free = B.theirs * 0.2;
    if (answer === 1) {
      for (let i = 0; i < n; i++) { const k = assign[i]; if (k >= 0 && O[k].kind === 'attack') w[k] += B.sq[i].str + B.sq[i].back * 0.5; }
      let ws = 0;
      for (let k = 0; k < m; k++) ws += w[k];
      if (ws > 0) for (let k = 0; k < m; k++) extra[k] = (free * w[k]) / ws;
    } else if (answer === 2) {
      let weak = -1, wv = Infinity;
      for (let k = 0; k < P; k++) {
        if (O[k].kind !== 'defend' && !O[k].def) continue;
        let mk = 0;
        for (let i = 0; i < n; i++) if (assign[i] === k) mk += B.sq[i].str;
        const e = E[k] + E1[k] + U[k];
        if (mk - e < wv) { wv = mk - e; weak = k; }
      }
      if (weak >= 0) extra[weak] = free;
    } else if (answer === 3) {
      for (let k = 0; k < P; k++) extra[k] = free / P;
    }
    const capRate = 1 / (this.mode.cfg.captureTime || 10);
    let reserveTo = -1, v = 0;
    for (let si = 0, t = 0; t <= H; si++, t += STEP) {
      // The fallen of this fight coming back to it (each side's at its own pace).
      for (let k = 0; k < m; k++) { RA[k] += RET[k * NS + si]; E[k] += RET[(m + k) * NS + si]; }
      // Ours as they get there (the dead back after the next wave); the reserve where it's worst at 25 s, 15 s later.
      A.fill(0);
      for (let i = 0; i < n; i++) {
        const k = assign[i], q = B.sq[i];
        if (k === RESERVE) { if (reserveTo >= 0 && t >= 40) A[reserveTo] += q.str; continue; }
        if (t >= q.eta[k]) A[k] += q.str;
        if (t >= q.eta[k] + 12) A[k] += q.back * 0.7;
      }
      for (let k = 0; k < m; k++) A[k] += RA[k];
      if (t === 25 && reserveTo < 0) {
        let wv = Infinity;
        for (let k = 0; k < P; k++) { const x = A[k] - L[k] - E[k] - E1[k] - U[k]; if (x < wv) { wv = x; reserveTo = k; } }
      }
      // His, as they get there.
      for (let k = 0; k < m; k++) {
        if (E1[k] > 0 && t >= O[k].t1) { E[k] += E1[k]; E1[k] = 0; }
        if (U[k] > 0 && t >= O[k].tE) { E[k] += U[k]; U[k] = 0; }
      }
      if (t === 20) for (let k = 0; k < m; k++) E[k] += extra[k];
      // The lanes' fire into the fights beside them.
      for (let k = 0; k < P; k++) { FA[k] = 0; FE[k] = 0; }
      for (let k = P; k < m; k++) {
        const adj = O[k].adj, nA = adj.length;
        if (!nA) continue;
        const a = Math.max(0, A[k] - L[k]) * SUPPORT / nA, e = E[k] * SUPPORT / nA;
        for (const j of adj) { FA[j] += a; FE[j] += e; }
      }
      for (let k = 0; k < m; k++) {
        const a = Math.max(0, A[k] - L[k]), e = E[k];
        // The fight: square law, the side that owns the point in cover.
        if (a > 0.05 && e > 0.05) {
          const ca = held[k] > 0.5 ? COVER : 1, ce = held[k] < -0.5 ? COVER : 1;
          const fa = a + (k < P ? FA[k] : 0), fe = e + (k < P ? FE[k] : 0);
          const da = Math.min(a, (K * fe * STEP) / ca), de = Math.min(e, (K * fa * STEP) / ce);
          L[k] += da; E[k] = e - de;
          lostA += da; lostE += de;
          // ...and come back later, the dead (most of the fallen) with the next wave.
          if (si + O[k].backA < NS) RET[k * NS + si + O[k].backA] += da * 0.8;
          if (si + O[k].backE < NS) RET[(m + k) * NS + si + O[k].backE] += de * 0.8;
        }
        if (k >= P) continue;
        // A side with the point (nearly) to itself pushes it its way.
        const ap = Math.max(0, A[k] - L[k]), ep = E[k], diff = Math.max(-3, Math.min(3, ap - ep));
        if (Math.abs(diff) > 0.3 && Math.min(ap, ep) < Math.max(0.3, 0.25 * Math.max(ap, ep))) held[k] = Math.max(-1, Math.min(1, held[k] + diff * capRate * STEP));
      }
      // Where it leaves the sectors, over the second half of what's played forward (the longer the
      // better): each point he still has to take is a long way further from his taking ours, each we
      // still have to take one further from our taking his (a point given away is a point he no
      // longer needs; a sector all ours or all his is as good as taken or lost).
      if (t >= H / 2) {
        let dA = 0, dD = 0, anyA = false, anyD = false;
        for (let k = 0; k < P; k++) {
          if (O[k].atk) { anyA = true; dA += (1 - held[k]) / 2; }
          if (O[k].def) { anyD = true; dD += (1 + held[k]) / 2; }
        }
        if (anyA) v += (SECTOR * ODDS ** dA) / LATE;
        if (anyD) v -= (B.lose * ODDS ** dD) / LATE;
      }
    }
    // A lane he holds and we don't: a way round our points, to our guns and our rear.
    const sc = this.cfg.screen;
    if (sc) for (let k = P; k < m; k++) { const e = E[k] - Math.max(0, A[k] - L[k]); if (e > 0) v -= sc * Math.min(2, e); }
    if (this.debug) this.debug.push({ answer, v, lostA, lostE, held: Array.from(held), A: Array.from(A), L: Array.from(L), E: Array.from(E), U: Array.from(U) });
    return v + (lostE - lostA) * 0.1;   // (tickets)
  }

  /** (Tests and tuning: the board as it stands, and how a plan plays out against each answer.) */
  explain(cmd, assign = null) {
    const B = this.#board(cmd);
    if (!B) return null;
    this.debug = [];
    const a = Int32Array.from(assign ?? B.sq.map((q) => q.cur));
    const score = this.#score(B, a);
    const runs = this.debug; this.debug = null;
    return { score, runs, board: { P: B.P, theirs: B.theirs, obj: B.obj.map((o) => ({ name: o.p.name, kind: o.kind, atk: o.atk, def: o.def, e0: o.e0, e1: o.e1, t1: o.t1, u: o.u, tE: o.tE, held: o.held, adj: o.adj })), sq: B.sq.map((q) => ({ name: q.s.callsign, str: q.str, back: q.back, busy: q.busy, committed: q.committed, cur: q.cur, eta: Array.from(q.eta) })) } };
  }

  // ---------------------------------------------------------------- playing it
  #play(cmd, B, best) {
    const team = this.team;
    // Staging: squads sent together on an attack wait short of it until the last of them is close.
    const byObj = new Map();
    best.assign.forEach((k, i) => { if (k >= 0) (byObj.get(k) ?? byObj.set(k, []).get(k)).push(i); });
    for (const [pid, st] of this.stages) {
      const k = B.obj.findIndex((o) => o.p.id === pid);
      const still = k >= 0 ? (byObj.get(k) ?? []).map((i) => B.sq[i].s) : [];
      if (!still.length) { this.stages.delete(pid); continue; }
      st.squads = new Set(still);
      // Go when the last is near its staging place (or it's been long enough).
      const ready = still.every((s) => { const c = s.center(_c); return !c || Math.hypot(c.x - st.place.pos.x, c.z - st.place.pos.z) < 40; });
      if (!st.go && (ready || this.time - st.since > 20)) {
        st.go = true;
        for (const s of still) cmd.give(s, { kind: 'take', point: pid, by: 'ai' });
        if (this.cfg.fire && st.prep !== false) this.#prep(cmd, B.obj[k].p);
      }
      if (st.go && this.time - st.since > 120) this.stages.delete(pid);
    }
    for (let i = 0; i < B.sq.length; i++) {
      const q = B.sq[i], k = best.assign[i], s = q.s;
      if (k === RESERVE) {
        // The reserve: behind the line, central.
        const at = this.#reservePlace(B);
        if (!s.order || s.order.obj?.id !== at.id) cmd.give(s, { kind: 'hold', at: { x: at.pos.x, z: at.pos.z }, by: 'ai' });
        continue;
      }
      const o = B.obj[k];
      if (!o) continue;
      const staged = [...this.stages.values()].find((g) => g.squads.has(s));
      if (staged && !staged.go && staged.point === o.p.id) continue;   // waiting for the others
      if (s.objective === o.p.id && s.order) continue;                 // already on it
      if (s.pending?.order.obj.id === o.p.id) continue;                // told, going when they can
      if (o.kind === 'line') { cmd.give(s, { kind: 'hold', lane: o.p.id, by: 'ai' }); continue; }
      if (o.kind === 'defend') { cmd.give(s, { kind: 'hold', point: o.p.id, by: 'ai' }); continue; }
      // An attack: staged when two or more go in together and they'd get there far apart.
      const group = (byObj.get(k) ?? []).map((j) => B.sq[j]);
      const spread = group.length > 1 ? Math.max(...group.map((g) => g.eta[k])) - Math.min(...group.map((g) => g.eta[k])) : 0;
      // (Not in a race for a neutral point: there, whoever's first holds it.)
      if (this.cfg.stage && group.length > 1 && spread > 15 && o.p.owner === 1 - team && !this.stages.has(o.p.id)) {
        const place = this.#stagePlace(cmd, o.p);
        this.stages.set(o.p.id, { point: o.p.id, place, squads: new Set(group.map((g) => g.s)), since: this.time, go: false });
        for (const g of group) cmd.give(g.s, { kind: 'hold', at: { x: place.pos.x, z: place.pos.z }, by: 'ai' });
        continue;
      }
      const st = this.stages.get(o.p.id);
      if (st && !st.go) { st.squads.add(s); cmd.give(s, { kind: 'hold', at: { x: st.place.pos.x, z: st.place.pos.z }, by: 'ai' }); continue; }
      cmd.give(s, { kind: 'take', point: o.p.id, by: 'ai' });
    }
  }

  /** Where squads wait before going in together: 70 m short of the point, back along our way to it. */
  #stagePlace(cmd, p) {
    const team = this.team, back = DIR[team] * -70;
    return cmd.place(p.pos.x + back, p.pos.z, { radius: 18, name: `${p.name} start line` });
  }

  #reservePlace(B) {
    const sp = B.spawn;
    return this.reserve ??= { id: -1, pos: sp.clone() };
  }

  /** Eyes on what we're about to hit, and the guns on enemies massing at our points. */
  #support(cmd, B, best) {
    const I = this.world.intel?.[this.team];
    if (!I) return;
    // Scouts: on the attack targets (and threatened points) nobody's watched lately; only with men to
    // spare (a scout is a rifle out of the fight), and not in the opening race for the middle.
    const out = [...cmd.scouts.values()].filter((t) => !t.done).length;
    const allowed = Math.min(this.cfg.scout ?? 0, Math.floor(B.sq.length / 5));
    if (allowed > 0 && out < allowed && this.time > 45) {
      const want = B.obj.filter((o) => o.kind !== 'line' && o.stale > 25 && (o.kind === 'defend' || o.p.owner === 1 - this.team) && ![...cmd.scouts.values()].some((t) => Math.hypot(t.at.x - o.p.pos.x, t.at.z - o.p.pos.z) < 40))
        .sort((a, b) => (b.kind === 'attack') - (a.kind === 'attack') || b.stale - a.stale)[0];
      if (want) {
        // The nearest squad not in a fight, not already scouting.
        let pick = null, bd = Infinity;
        for (const q of B.sq) {
          if (q.busy || cmd.scouts.has(q.s) || q.str < 1.2) continue;
          const d = Math.hypot(q.at.x - want.p.pos.x, q.at.z - want.p.pos.z);
          if (d < bd) { bd = d; pick = q.s; }
        }
        if (pick && bd < 260) cmd.give(pick, { kind: 'scout', at: { x: want.p.pos.x, z: want.p.pos.z }, name: want.p.name, by: 'ai' });
      }
    }
    // (The guns fire on what we can see on their own: the batteries' commander shells every group
    // our soldiers and scouts spot, and answers the enemy's guns. Ours only add the preparation of
    // an attack, and never over his counter-battery: guns that fire too much get found.)
    void best;
  }

  /** Before an attack goes in: shell the point if we can see what's on it (not more than every 20 s). */
  #prep(cmd, p) {
    const I = this.world.intel?.[this.team];
    if (!I || !cmd.support || this.time - this.lastFire < 20) return;
    if (I.near(p.pos.x, p.pos.z, p.radius + 20, 10) < 2) return;
    const r = cmd.fire({ x: p.pos.x, z: p.pos.z, r: p.radius + 6, rounds: 3, by: 'ai', pri: 5 });
    if (r.ok) this.lastFire = this.time;
  }
}

