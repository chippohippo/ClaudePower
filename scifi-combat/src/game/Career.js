// Career: what carries over from one match to the next (docs/FRONTLINE.md, "Match flow"): experience
// and rank, ribbons and the medals they add up to, lifetime totals, each class's experience and the
// last ten matches. Saved in the browser (localStorage `emberfall.career`). Pure logic with the
// storage passed in, so the start menu, the after-action report and the tests share it.
//
//  * Experience for a match: its score, 300 for seeing it through, 600 more for winning it, 150 a
//    ribbon, 300 for being your side's MVP.
//  * Ranks: 30, ten grades of three (Recruit I to Marshal III). Rank r takes 1500 (r - 1) +
//    150 (r - 1)² in all: at three to four thousand a match, a match to Recruit II, about eight to
//    Sergeant, about fifty to the top. Ranks are for show: nothing is locked behind them (reviewers
//    dock the games that gate their good stuff behind a grind).
//  * Medals: a ribbon's 10th, 50th and 150th earn its bronze, silver and gold medal.

export const GRADES = ['Recruit', 'Trooper', 'Corporal', 'Sergeant', 'Warrant', 'Lieutenant', 'Captain', 'Major', 'Colonel', 'Marshal'];
export const RANKS = GRADES.flatMap((g) => ['I', 'II', 'III'].map((n) => `${g} ${n}`));
export const MEDALS = [[10, 'Bronze'], [50, 'Silver'], [150, 'Gold']];
export const XP = { finish: 300, win: 600, ribbon: 150, mvp: 300 };
const KEY = 'emberfall.career';
const HISTORY = 10;

/** Experience in all to reach rank r (1-based). */
export const xpFor = (r) => 1500 * (r - 1) + 150 * (r - 1) ** 2;

/** Where `xp` stands: { rank, title, into (xp past this rank), span (xp from this rank to the next; 0 at the top) }. */
export function rankOf(xp) {
  let r = 1;
  while (r < RANKS.length && xp >= xpFor(r + 1)) r++;
  return { rank: r, title: RANKS[r - 1], into: xp - xpFor(r), span: r < RANKS.length ? xpFor(r + 1) - xpFor(r) : 0 };
}

export function emptyCareer() {
  return { v: 1, xp: 0, matches: 0, wins: 0, losses: 0, score: 0, kills: 0, deaths: 0, assists: 0, revives: 0, captures: 0, vehicles: 0,
    mvps: 0, best: { score: 0, kills: 0 }, ribbons: {}, classes: {}, history: [], hints: {} };
}

/** The saved career (a new one if there's none, or it can't be read). */
export function loadCareer(storage = globalThis.localStorage) {
  try {
    const s = JSON.parse(storage?.getItem(KEY) ?? 'null');
    return s && s.v === 1 ? { ...emptyCareer(), ...s } : emptyCareer();
  } catch { return emptyCareer(); }
}

export function saveCareer(c, storage = globalThis.localStorage) {
  try { storage?.setItem(KEY, JSON.stringify(c)); } catch { /* private window: this session only */ }
}

/** The medal a ribbon count has earned (null below bronze). */
export function medalFor(count) {
  let m = null;
  for (const [n, name] of MEDALS) if (count >= n) m = name;
  return m;
}

/**
 * A finished match into career `c` (changed in place, and returned with what it earned).
 * @param {object} line  the player's MatchStats line
 * @param {object} o     { won, mvp, meta: { map, size, side, classId, at } }
 * @returns {{ xp: { score, finish, win, ribbons, mvp, total }, before, after, medals: Array<{ ribbon, medal }>, career }}
 */
export function recordMatch(c, line, { won = false, mvp = false, meta = {} } = {}) {
  const ribbons = Object.values(line.ribbons ?? {}).reduce((a, n) => a + n, 0);
  const xp = { score: Math.max(0, Math.round(line.score)), finish: XP.finish, win: won ? XP.win : 0, ribbons: ribbons * XP.ribbon, mvp: mvp ? XP.mvp : 0 };
  xp.total = xp.score + xp.finish + xp.win + xp.ribbons + xp.mvp;
  const before = rankOf(c.xp);
  c.xp += xp.total;
  c.matches++;
  if (won) c.wins++; else c.losses++;
  for (const k of ['score', 'kills', 'deaths', 'assists', 'revives', 'captures', 'vehicles']) c[k] += line[k] ?? 0;
  if (mvp) c.mvps++;
  c.best.score = Math.max(c.best.score, line.score ?? 0);
  c.best.kills = Math.max(c.best.kills, line.kills ?? 0);
  const medals = [];
  for (const [id, n] of Object.entries(line.ribbons ?? {})) {
    const had = medalFor(c.ribbons[id] ?? 0);
    c.ribbons[id] = (c.ribbons[id] ?? 0) + n;
    const now = medalFor(c.ribbons[id]);
    if (now && now !== had) medals.push({ ribbon: id, medal: now });
  }
  const cls = meta.classId ?? line.classId;
  if (cls) { const k = (c.classes[cls] ??= { xp: 0, matches: 0 }); k.xp += xp.total; k.matches++; }
  c.history.unshift({ at: meta.at ?? 0, map: meta.map ?? null, size: meta.size ?? null, side: meta.side ?? line.team ?? null, classId: cls ?? null, won, score: line.score ?? 0, kills: line.kills ?? 0, deaths: line.deaths ?? 0, mvp });
  c.history.length = Math.min(c.history.length, HISTORY);
  return { xp, before, after: rankOf(c.xp), medals, career: c };
}
