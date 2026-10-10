// AI diplomacy (monthly) and rivals (yearly). Relations drift toward a target set by ideology,
// rivalry, alliances, trade and claims; AI forms trade deals and alliances, fabricates claims, and
// declares war when it has a casus belli, a clear power edge and an aggressive government.
import { Rng } from "../rng";
import { Role, findRole } from "../characters";
import { allied, borders, casusBelli, coalitionPower, enemies, hasTrade, neighbourCountries, pair, rel, setAlliance, setRel, setTrade, truceWith, warBetween, atWar } from "../diplomacy";
import { declareWar } from "./wars";
import { igIndex, igRow } from "../igs";
import { activeLaw, categoryIndex } from "../laws";
import type { World } from "../world";

import { AUTO_DIPLOMACY } from "../automation";
export const RELATION_DRIFT = 0.05, WAR_POWER_EDGE = 1.6;
/** Monthly odds per eligible target, scaled by aggression; wars need deep hostility. */
export const WAR_CHANCE = 0.025, CLAIM_CHANCE = 0.006, WAR_RELATIONS = -40;

const ideo = (w: World, c: number) => { const h = findRole(w, c, Role.Head); return h >= 0 ? w.characters.cols.ideology![h]! : 3; };

/** Per-month cache for relation targets (ideology of each head, who claims whom, wars). */
interface RelCache { ideo: Int32Array; claimsOn: Set<number>[]; war: Set<number> }
function relCache(w: World): RelCache {
  const n = w.countries.size, ideoArr = new Int32Array(n).fill(3), ch = w.characters.cols;
  for (let i = 0; i < w.characters.size; i++) if (ch.alive![i] && ch.role![i] === Role.Head) ideoArr[ch.country![i]!] = ch.ideology![i]!;
  const claimsOn = Array.from({ length: n }, (_, a) => new Set(w.claims[a]!.map((p) => w.provinces.cols.owner![p]!)));
  const war = new Set<number>();
  for (const x of w.wars) if (x.end < 0) for (const p of x.attackers) for (const q of x.defenders) { war.add(p * n + q); war.add(q * n + p); }
  return { ideo: ideoArr, claimsOn, war };
}

export function relationTarget(w: World, a: number, b: number, k: RelCache = relCache(w)): number {
  const ia = k.ideo[a]!, ib = k.ideo[b]!;
  let t = ia === ib ? 30 : ia === 3 || ib === 3 ? 0 : -20;
  if (allied(w, a, b)) t += 60;
  if (hasTrade(w, a, b)) t += 20;
  if (w.rivals[a]?.includes(b) || w.rivals[b]?.includes(a)) t -= 60;
  if (k.claimsOn[a]!.has(b) || k.claimsOn[b]!.has(a)) t -= 80;
  if (k.war.has(a * w.countries.size + b)) t = -200;
  if (w.countries.cols.overlord![a] === b || w.countries.cols.overlord![b] === a) t += 50;
  return t;
}

/** Aggression 0–1: militarist governments, mobilised economies, strong angry armies. */
export function aggression(w: World, c: number): number {
  const af = w.igs.cols.clout![igRow(c, igIndex("armed_forces"))]!;
  const mob = activeLaw(w, c, categoryIndex("mobilisation"));
  const i = ideo(w, c);
  const democracy = w.countries.cols.government![c] === 0;
  return (democracy ? 0.3 : 1) * Math.min(1, (i === 1 ? 0.45 : i === 2 ? 0.25 : 0.05) + 0.1 * mob + af + (democracy ? 0 : 0.1) + ("jap_militarist" in w.flags && w.countryTags[c] === "JAP" ? 0.3 : 0) + ("ger_militarist" in w.flags && w.countryTags[c] === "GER" ? 0.3 : 0) + ("ita_imperial" in w.flags && w.countryTags[c] === "ITA" ? 0.3 : 0));
}

export function runDiplomacyAi(w: World): void {
  const n = w.countries.size, rng = new Rng(w.rng), cc = w.countries.cols, cache = relCache(w);
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const r = rel(w, a, b);
    setRel(w, a, b, r + (relationTarget(w, a, b, cache) - r) * RELATION_DRIFT);
  }
  for (let a = 0; a < n; a++) {
    if (!(cc.automation![a]! & AUTO_DIPLOMACY) || cc.population![a]! < 1 || cc.capital![a]! < 0) continue;
    const nb = neighbourCountries(w, a);
    // Trade with friendly partners.
    for (const b of nb) if (!hasTrade(w, a, b) && rel(w, a, b) > 30 && rng.chance(0.05)) setTrade(w, a, b, true);
    // Alliances against a common threat.
    const threat = nb.filter((b) => rel(w, a, b) < -50 && coalitionPower(w, b) > coalitionPower(w, a));
    if (threat.length) for (let k = 0; k < n; k++) if (k !== a && !allied(w, a, k) && rel(w, a, k) > 60 && threat.some((t) => rel(w, k, t) < -30) && rng.chance(0.03)) setAlliance(w, a, k, true);
    // Aggression: claims and wars.
    const agg = aggression(w, a);
    if (agg < 0.4 || atWar(w, a) || cc.warExhaustion![a]! > 20) continue;
    const targets = nb.filter((b) => !allied(w, a, b) && !truceWith(w, a, b) && cc.overlord![b] !== a && cc.overlord![a] !== b && rel(w, a, b) < WAR_RELATIONS);
    for (const b of targets) {
      // Nuclear deterrence: never start a war with a nuclear power unless also nuclear and far stronger.
      if (cc.nukes![b]! > 0 && (cc.nukes![a]! === 0 || coalitionPower(w, a) < 3 * coalitionPower(w, b))) continue;
      if (!casusBelli(w, a, b)) {
        if (rng.chance(CLAIM_CHANCE * agg) && borders(w, a, b)) {
          const p = [...Array(w.provinces.size).keys()].find((q) => w.provinces.cols.owner![q] === b && !w.claims[a]!.includes(q));
          if (p !== undefined) w.claims[a]!.push(p);
        }
        continue;
      }
      if (coalitionPower(w, a) > WAR_POWER_EDGE * coalitionPower(w, b) && rng.chance(WAR_CHANCE * agg)) { declareWar(w, a, b); break; }
    }
  }
  w.rng = rng.state;
  void pair; void enemies;
}

/** Yearly: up to three rivals — comparable power, nearby, unfriendly. */
export function runRivals(w: World): void {
  const n = w.countries.size, power = Array.from({ length: n }, (_, c) => coalitionPower(w, c));
  for (let a = 0; a < n; a++) {
    if (w.countries.cols.population![a]! < 1) { w.rivals[a] = []; continue; }
    const nb = new Set(neighbourCountries(w, a));
    w.rivals[a] = [...Array(n).keys()].filter((b) => b !== a && power[b]! > 0.5 * power[a]! && power[b]! < 2 * power[a]! && !allied(w, a, b))
      .map((b) => [b, (nb.has(b) ? 100 : 0) - rel(w, a, b)] as const).filter(([, s]) => s > 40).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([b]) => b);
  }
}
