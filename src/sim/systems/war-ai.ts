// AI armies and peace (monthly): recruit toward a target size, auto-command armies at war, offer and
// accept peace. Auto-command is also what a player gets by setting an army to "auto".
import { enemies } from "../diplomacy";
import { DIVISION, demobilise, distances, fielded, recruit, soldiers, updateArmyPower, mergeArmies } from "./armies";
import { makePeace, termCost, type PeaceTerm } from "./wars";
import { countryStat } from "../modifiers";
import { neighborsOf } from "../setup";
import type { War, World } from "../world";

import { AUTO_ARMY } from "../automation";

/** Assign auto armies: attack the nearest weakly held enemy province, or defend occupied home provinces. */
export function autoCommand(w: World): void {
  const a = w.armies.cols, pc = w.provinces.cols;
  const strengthAt = new Map<number, number>();
  for (let i = 0; i < w.armies.size; i++) if (a.alive![i]) strengthAt.set(a.prov![i]! * 1000 + a.country![i]!, (strengthAt.get(a.prov![i]! * 1000 + a.country![i]!) ?? 0) + a.strength![i]!);
  for (let i = 0; i < w.armies.size; i++) {
    if (!a.alive![i] || !a.auto![i] || a.battle![i]! >= 0 || a.target![i]! >= 0) continue;
    const c = a.country![i]!, foes = enemies(w, c);
    if (!foes.length) { // peace: return home if abroad
      if (pc.owner![a.prov![i]!] !== c && w.countries.cols.capital![c]! >= 0) a.target![i] = w.countries.cols.capital![c]!;
      continue;
    }
    if (a.org![i]! < 0.5) continue; // recover first
    // Priority 1: liberate own occupied provinces. Priority 2: nearest enemy-controlled province.
    let best = -1, bestD = Infinity;
    const dist = distances(w, c, a.prov![i]!);
    for (let p = 0; p < w.provinces.size; p++) {
      if (dist[p]! < 0) continue;
      const mine = pc.owner![p] === c && pc.controller![p] !== c;
      const theirs = foes.includes(pc.controller![p]!);
      if (!mine && !theirs) continue;
      let enemyMen = 0;
      for (const f of foes) enemyMen += strengthAt.get(p * 1000 + f) ?? 0;
      if (enemyMen > 2 * a.strength![i]!) continue; // don't suicide
      const d = dist[p]! - (mine ? 2 : 0);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best >= 0 && best !== a.prov![i]) a.target![i] = best;
  }
}

/** Recruit toward target size: 30% of manpower in peace, 80% in war (needs soldiers and money). */
export function aiRecruit(w: World): void {
  const cc = w.countries.cols, f = fielded(w), sArr = soldiers(w);
  for (let c = 0; c < w.countries.size; c++) {
    if (!(cc.automation![c]! & AUTO_ARMY) || cc.capital![c]! < 0 || cc.treasury![c]! < 0) continue;
    const target = cc.manpower![c]! * (enemies(w, c).length ? 0.8 : 0.3);
    const gap = target - f[c]!;
    // Peace dividend: shrink back toward the peacetime army (soldiers return to the workforce).
    const sold = sArr[c]!, peaceSize = Math.max(cc.manpower![c]! * 0.3, 0.004 * cc.population![c]!);
    if (!enemies(w, c).length && sold > peaceSize * 1.3) {
      const excess = sold - peaceSize;
      demobilise(w, c, excess * 0.25);
      continue;
    }
    if (gap > DIVISION * 2) {
      // Recruit at the border province nearest an enemy if at war, else the capital.
      const foes = enemies(w, c);
      let at = cc.capital![c]!;
      if (foes.length) for (let p = 0; p < w.provinces.size; p++) if (w.provinces.cols.owner![p] === c && neighborsOf(w, p).some((q) => foes.includes(w.provinces.cols.owner![q]!))) { at = p; break; }
      recruit(w, c, at, Math.min(20, Math.floor(gap / DIVISION)));
    }
  }
  // Armies recover organisation and re-equip monthly.
  const a = w.armies.cols, rec = countryStat(w, "org_recovery");
  for (let i = 0; i < w.armies.size; i++) if (a.alive![i] && a.battle![i]! < 0) a.org![i] = Math.min(1, a.org![i]! + 0.15 * rec[a.country![i]!]! * (0.5 + 0.5 * w.countries.cols.equip![a.country![i]!]!));
  // Soldiers that are no longer in any army (losses replaced in pops) — keep fielded ≤ soldiers.
  const s = soldiers(w), fl = fielded(w);
  for (let i = 0; i < w.armies.size; i++) if (a.alive![i]) { const c = a.country![i]!; if (fl[c]! > s[c]! && fl[c]! > 0) a.strength![i]! *= Math.max(0.5, s[c]! / fl[c]!); if (a.strength![i]! < 1000) a.alive![i] = 0; }
  mergeArmies(w);
  updateArmyPower(w);
}

/** Peace: the side ahead demands what its score buys; losers accept when beaten or exhausted. */
export function aiPeace(w: World): void {
  const cc = w.countries.cols;
  for (const war of w.wars) {
    if (war.end >= 0) continue;
    const leadA = war.attackers[0]!, leadD = war.defenders[0]!;
    const playerSide = [...war.attackers, ...war.defenders].some((c) => !(cc.automation![c]! & AUTO_ARMY));
    const ahead = war.score >= 0 ? leadA : leadD, behind = war.score >= 0 ? leadD : leadA, score = Math.abs(war.score);
    if (playerSide && !(cc.automation![ahead]! & AUTO_ARMY)) continue; // the player negotiates their own wins
    const months = (w.date - war.start) / 30.44;
    if ((score >= 25 && months >= 3) || cc.warExhaustion![behind]! > 60) {
      const terms = demand(w, war, ahead, behind, score + (cc.warExhaustion![behind]! > 60 ? 15 : 0));
      if (terms.length) { makePeace(w, war, ahead, behind, terms); continue; }
    }
    if (war.monthsStalemate > 18 && Math.min(cc.warExhaustion![leadA]!, cc.warExhaustion![leadD]!) > 40) makePeace(w, war, leadA, leadD, [{ type: "white_peace" }]);
  }
}

/** Build the best demand affordable with `budget` war score: the war goal first, then more land, reparations. */
export function demand(w: World, war: War, winner: number, loser: number, budget: number): PeaceTerm[] {
  const terms: PeaceTerm[] = [];
  let left = budget;
  const take = (t: PeaceTerm) => { const k = termCost(w, loser, t); if (k <= left) { terms.push(t); left -= k; return true; } return false; };
  if (w.provinces.cols.owner![war.goal.province] === loser) take({ type: "annex", province: war.goal.province });
  for (let p = 0; p < w.provinces.size && left > 10; p++) if (w.provinces.cols.owner![p] === loser && w.provinces.cols.controller![p] === winner && p !== war.goal.province && w.countries.cols.capital![loser] !== p) take({ type: "annex", province: p });
  take({ type: "reparations" });
  if (left > 60) take({ type: "puppet" });
  return terms;
}
