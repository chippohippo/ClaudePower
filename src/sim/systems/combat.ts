// Daily combat and sieges. Battles are readable: every factor is recorded in the battle report.
// No instant wipes: daily casualties are capped, and a side retreats when its organisation breaks.
import { Rng } from "../rng";
import { TERRAINS } from "../schemas";
import { neighborsOf } from "../setup";
import { enemies, militaryQuality, warBetween } from "../diplomacy";
import { STRATUM } from "../defs";
import { popSize } from "../pops";
import { chronicle } from "../characters";
import { countryStat } from "../modifiers";
import type { BattleReport, World } from "../world";

export const BASE_DAMAGE = 0.012, MAX_DAILY_LOSS = 0.03, ORG_DAMAGE = 0.05, RETREAT_ORG = 0.25;
export const TERRAIN_DEFENCE: Record<string, number> = { plains: 1, desert: 1, tundra: 1.1, forest: 1.15, marsh: 1.2, hills: 1.25, jungle: 1.3, mountains: 1.5 };

interface Side { armies: number[]; country: number; strength: number }

function sidePower(w: World, s: Side, defending: boolean, prov: number, land: Float64Array): { power: number; mods: Record<string, number> } {
  const a = w.armies.cols, cc = w.countries.cols, ch = w.characters.cols;
  let org = 0, ent = 0, gen = 0;
  for (const i of s.armies) { org += a.org![i]! * a.strength![i]!; ent += a.entrench![i]! * a.strength![i]!; const g = a.general![i]!; if (g >= 0 && ch.alive![g]) gen = Math.max(gen, ch.mil![g]!); }
  org /= Math.max(1, s.strength); ent /= Math.max(1, s.strength);
  const terrain = TERRAINS[w.provinces.cols.terrain![prov]!]!;
  const mods = {
    "Men": s.strength,
    "Equipment": 0.4 + 0.6 * cc.equip![s.country]!,
    "Organisation": 0.5 + 0.5 * org,
    "General": 1 + 0.05 * gen,
    "Terrain": defending ? TERRAIN_DEFENCE[terrain] ?? 1 : 1,
    "Entrenchment": defending ? 1 + 0.1 * Math.min(5, ent / 10) : 1,
    "Industry & doctrine": land[s.country]! * militaryQuality(w, s.country),
  };
  return { power: Object.values(mods).reduce((x, y) => x * y, 1), mods };
}

export function runCombat(w: World): void {
  const a = w.armies.cols, rng = new Rng(w.rng);
  const land = countryStat(w, "land_combat");
  // Group live armies by province.
  const byProv = new Map<number, number[]>();
  for (let i = 0; i < w.armies.size; i++) if (a.alive![i]) (byProv.get(a.prov![i]!) ?? byProv.set(a.prov![i]!, []).get(a.prov![i]!)!).push(i);
  for (let i = 0; i < w.armies.size; i++) if (a.alive![i] && a.target![i]! < 0) a.entrench![i] = Math.min(60, a.entrench![i]! + 1);
  for (const [prov, list] of byProv) {
    const countries = [...new Set(list.map((i) => a.country![i]!))];
    if (countries.length < 2) { list.forEach((i) => (a.battle![i] = -1)); continue; }
    // Defender: the side that controls the province (or whose army was there first); attacker: any enemy of it.
    const ctrl = w.provinces.cols.controller![prov]!;
    const defC = countries.includes(ctrl) ? ctrl : a.country![list[0]!]!;
    const foes = enemies(w, defC);
    const att = list.filter((i) => foes.includes(a.country![i]!));
    const attC = att.length ? a.country![att[0]!]! : -1;
    const def = list.filter((i) => !att.includes(i) && (a.country![i] === defC || enemies(w, a.country![i]!).includes(attC)));
    if (!att.length) { list.forEach((i) => (a.battle![i] = -1)); continue; }
    const war = warBetween(w, a.country![att[0]!]!, defC);
    if (!war) continue;
    const mk = (ids: number[]): Side => ({ armies: ids, country: a.country![ids[0]!]!, strength: ids.reduce((s, i) => s + a.strength![i]!, 0) });
    const A = mk(att), D = mk(def.length ? def : list.filter((i) => a.country![i] === defC));
    if (!D.armies.length) continue;
    // Find or open the battle report.
    let rep = w.battles.find((b) => b.winner === "ongoing" && b.prov === prov);
    if (!rep) {
      rep = { id: w.nextBattleId++, war: war.id, prov, start: w.date, end: -1, attacker: A.country, defender: D.country, aStart: A.strength, dStart: D.strength, aEnd: A.strength, dEnd: D.strength, winner: "ongoing", modifiers: [], firstDayLoss: 0 };
      w.battles.push(rep);
      if (w.battles.length > 400) w.battles.splice(0, w.battles.length - 400);
    }
    [...A.armies, ...D.armies].forEach((i) => (a.battle![i] = rep!.id));
    const pa = sidePower(w, A, false, prov, land), pd = sidePower(w, D, true, prov, land);
    rep.modifiers = Object.keys(pa.mods).map((k) => ({ label: k, attacker: round(pa.mods[k]!), defender: round(pd.mods[k]!) }));
    // Casualties: proportional to enemy power relative to own size; capped per day.
    const lossA = Math.min(MAX_DAILY_LOSS, (BASE_DAMAGE * pd.power) / Math.max(1, pa.power) * (0.5 + rng.next()) + 0.002);
    const lossD = Math.min(MAX_DAILY_LOSS, (BASE_DAMAGE * pa.power) / Math.max(1, pd.power) * (0.5 + rng.next()) + 0.002);
    const orgA = ORG_DAMAGE * Math.min(3, pd.power / Math.max(1, pa.power)), orgD = ORG_DAMAGE * Math.min(3, pa.power / Math.max(1, pd.power));
    let deadA = 0, deadD = 0;
    for (const i of A.armies) { const d = a.strength![i]! * lossA; a.strength![i]! -= d; deadA += d; a.org![i] = Math.max(0, a.org![i]! - orgA); }
    for (const i of D.armies) { const d = a.strength![i]! * lossD; a.strength![i]! -= d; deadD += d; a.org![i] = Math.max(0, a.org![i]! - orgD); }
    if (rep.start === w.date) rep.firstDayLoss = Math.max(lossA, lossD);
    killSoldiers(w, A.country, deadA); killSoldiers(w, D.country, deadD);
    rep.aEnd = A.strength - deadA; rep.dEnd = D.strength - deadD;
    const avgOrg = (s: Side) => s.armies.reduce((x, i) => x + a.org![i]! * a.strength![i]!, 0) / Math.max(1, s.armies.reduce((x, i) => x + a.strength![i]!, 0));
    const loser = avgOrg(A) < RETREAT_ORG ? A : avgOrg(D) < RETREAT_ORG ? D : null;
    if (loser) {
      rep.winner = loser === A ? "defender" : "attacker"; rep.end = w.date;
      war.battleScore += (loser === A ? -1 : 1) * Math.min(10, (rep.aStart + rep.dStart) / 100_000 + 1);
      for (const i of loser.armies) retreat(w, i);
      for (const i of [...A.armies, ...D.armies]) a.battle![i] = -1;
      const names = (c: number) => w.countryTags[c]!;
      chronicle(w, rep.winner === "attacker" ? A.country : D.country, "battle", `Battle of ${w.provinceNames[prov]}: ${names(rep.winner === "attacker" ? A.country : D.country)} defeats ${names(loser.country)} (${Math.round((rep.aStart - rep.aEnd + rep.dStart - rep.dEnd) / 1000)}k casualties).`);
    }
  }
  w.rng = rng.state;
}
const round = (x: number) => Math.round(x * 100) / 100;

/** Retreat to an adjacent province controlled by the army's side; shattered if none. */
function retreat(w: World, i: number): void {
  const a = w.armies.cols, c = a.country![i]!;
  const foes = enemies(w, c);
  const safe = neighborsOf(w, a.prov![i]!).find((q) => !foes.includes(w.provinces.cols.controller![q]!) && (w.provinces.cols.owner![q] === c || w.provinces.cols.controller![q] === c));
  if (safe === undefined) { killSoldiers(w, c, a.strength![i]! * 0.5); a.strength![i]! *= 0.5; a.org![i] = 0.1; return; }
  a.prov![i] = safe; a.target![i] = -1; a.next![i] = -1; a.org![i] = Math.max(0.05, a.org![i]!);
}

/** Casualties are real people: remove them from the country's military pops (logged as deaths). */
export function killSoldiers(w: World, c: number, men: number): void {
  if (men <= 0) return;
  const p = w.pops.cols, ids: number[] = [];
  let tot = 0;
  for (let i = 0; i < w.pops.size; i++) if (p.stratum![i] === STRATUM.military && w.provinces.cols.owner![p.prov![i]!] === c) { ids.push(i); tot += p.a1![i]!; }
  if (tot <= 0) return;
  const k = Math.min(1, men / tot);
  for (const i of ids) { const d = p.a1![i]! * k; p.a1![i]! -= d; w.ledger.died += d; }
  void popSize;
}

/** Sieges: an enemy army alone in a province occupies it after a few weeks (longer for developed provinces). */
export function runSieges(w: World): void {
  const a = w.armies.cols, pc = w.provinces.cols;
  const present = new Map<number, Set<number>>();
  for (let i = 0; i < w.armies.size; i++) if (a.alive![i] && a.battle![i]! < 0) (present.get(a.prov![i]!) ?? present.set(a.prov![i]!, new Set()).get(a.prov![i]!)!).add(i);
  for (const [prov, set] of present) {
    const ids = [...set], ctrl = pc.controller![prov]!, owner = pc.owner![prov]!;
    const besiegers = ids.filter((i) => enemies(w, a.country![i]!).includes(ctrl));
    const defenders = ids.filter((i) => a.country![i] === ctrl);
    if (!besiegers.length || defenders.length) { if (!besiegers.length) pc.siege![prov] = 0; continue; }
    const men = besiegers.reduce((s, i) => s + a.strength![i]!, 0);
    pc.siege![prov]! += Math.min(0.1, men / (30_000 * (5 + pc.development![prov]!)));
    if (pc.siege![prov]! >= 1) {
      const by = a.country![besiegers[0]!]!;
      // Liberating your own (or an ally's) province returns it to its owner.
      pc.controller![prov] = enemies(w, by).includes(owner) ? by : owner;
      pc.siege![prov] = 0;
      pc.unrest![prov] = Math.min(10, pc.unrest![prov]! + 2);
    }
  }
}
