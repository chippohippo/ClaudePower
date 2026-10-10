// Wars: declaration (with allies called in), monthly war score and exhaustion, peace deals.
import { chronicle } from "../characters";
import { addRel, allied, casusBelli, enemies, guarantees, pair, rel, setAlliance, setTruce } from "../diplomacy";
import { enactLaw, categoryIndex } from "../laws";
import type { War, World } from "../world";
import { neighborsOf } from "../setup";

export const TRUCE_DAYS = 5 * 365;
export type PeaceTerm = { type: "annex"; province: number } | { type: "puppet" } | { type: "reparations" } | { type: "demilitarise" } | { type: "change_government" } | { type: "white_peace" };

export const provinceValue = (w: World, p: number) => w.provinces.cols.development![p]! + w.provinces.cols.population![p]! / 1e6;
export function countryValue(w: World, c: number): number { let v = 0; for (let p = 0; p < w.provinces.size; p++) if (w.provinces.cols.owner![p] === c) v += provinceValue(w, p); return v || 1; }

export function declareWar(w: World, a: number, d: number): War | null {
  const cb = casusBelli(w, a, d);
  if (!cb) return null;
  const war: War = { id: w.nextWarId++, name: `${w.countryTags[a]}–${w.countryTags[d]} War`, attackers: [a], defenders: [d], start: w.date, end: -1, score: 0, battleScore: 0, goal: { type: cb.type, province: cb.province }, monthsStalemate: 0, outcome: "" };
  w.wars.push(war);
  // Defensive calls: allies, bloc members, guarantors, overlord.
  for (let k = 0; k < w.countries.size; k++) {
    if (k === a || k === d || war.attackers.includes(k) || war.defenders.includes(k)) continue;
    const helps = allied(w, k, d) || guarantees(w, k, d) || w.countries.cols.overlord![d] === k || w.countries.cols.overlord![k] === d;
    const helpsA = allied(w, k, a) && rel(w, k, d) < 0 || w.countries.cols.overlord![k] === a;
    if (helps && !allied(w, k, a)) war.defenders.push(k); else if (helpsA) war.attackers.push(k);
  }
  for (const x of war.attackers) for (const y of war.defenders) { addRel(w, x, y, -100); setAlliance(w, x, y, false); }
  chronicle(w, a, "war", `${w.countryTags[a]} declares war on ${w.countryTags[d]} (${cb.type}).${war.defenders.length > 1 ? ` ${war.defenders.slice(1).map((x) => w.countryTags[x]).join(", ")} join the defence.` : ""}`);
  w.flags[`war:${w.countryTags[a]}_${w.countryTags[d]}`] = w.date;
  return war;
}

/** Monthly: war score from occupation and battles; exhaustion; stalemate counter. */
export function runWarScore(w: World): void {
  const pc = w.provinces.cols, cc = w.countries.cols;
  for (const war of w.wars) {
    if (war.end >= 0) continue;
    let occD = 0, occA = 0, valD = 0, valA = 0;
    for (let p = 0; p < w.provinces.size; p++) {
      const o = pc.owner![p]!, c = pc.controller![p]!, v = provinceValue(w, p);
      if (war.defenders.includes(o)) { valD += v; if (war.attackers.includes(c)) occD += v; }
      if (war.attackers.includes(o)) { valA += v; if (war.defenders.includes(c)) occA += v; }
    }
    const goalHeld = war.attackers.includes(pc.controller![war.goal.province]!) ? 10 : 0;
    const prev = war.score;
    war.score = Math.max(-100, Math.min(100, (100 * occD) / Math.max(1, valD) * 1.5 - (100 * occA) / Math.max(1, valA) * 1.5 + Math.max(-25, Math.min(25, war.battleScore)) + goalHeld));
    war.monthsStalemate = Math.abs(war.score - prev) < 2 ? war.monthsStalemate + 1 : 0;
    for (const c of [...war.attackers, ...war.defenders]) {
      const side = war.attackers.includes(c) ? war.score : -war.score;
      cc.warExhaustion![c] = Math.min(100, cc.warExhaustion![c]! + 0.8 + Math.max(0, -side) / 40);
    }
  }
  for (let c = 0; c < w.countries.size; c++) if (!enemies(w, c).length) cc.warExhaustion![c] = Math.max(0, cc.warExhaustion![c]! - 1.5);
}

/** War-score cost of a peace term (for the winner's demand). */
export function termCost(w: World, loser: number, t: PeaceTerm): number {
  switch (t.type) {
    case "annex": return 5 + (120 * provinceValue(w, t.province)) / countryValue(w, loser);
    case "puppet": return 60;
    case "reparations": return 20;
    case "demilitarise": return 15;
    case "change_government": return 35;
    case "white_peace": return 0;
  }
}

/** Apply a peace: winner side gets terms from the loser; ends the war (or removes the loser from it). */
export function makePeace(w: World, war: War, winner: number, loser: number, terms: PeaceTerm[]): void {
  const pc = w.provinces.cols, cc = w.countries.cols;
  const desc: string[] = [];
  for (const t of terms) {
    if (t.type === "annex" && pc.owner![t.province] === loser) { transferProvince(w, t.province, winner); desc.push(`cedes ${w.provinceNames[t.province]}`); }
    else if (t.type === "puppet") { cc.overlord![loser] = winner; desc.push("becomes a puppet"); }
    else if (t.type === "reparations") { w.modifiers.push({ target: "tax_efficiency", scope: `c:${loser}`, source: `Reparations to ${w.countryTags[winner]}`, mult: -0.1, expires: w.date + 10 * 365 }, { target: "tax_efficiency", scope: `c:${winner}`, source: `Reparations from ${w.countryTags[loser]}`, mult: 0.05, expires: w.date + 10 * 365 }); desc.push("pays reparations"); }
    else if (t.type === "demilitarise") { enactLaw(w, loser, categoryIndex("mobilisation"), 0); w.countryFlags[loser]!.demilitarised = w.date; desc.push("demilitarises"); }
    else if (t.type === "change_government") { cc.government![loser] = cc.government![winner]!; w.countryFlags[loser]!.imposed_government = w.date; desc.push("accepts a new government"); }
  }
  // Remove loser (and its puppets) from the war; end it when one side is empty.
  const remove = (c: number) => { war.attackers = war.attackers.filter((x) => x !== c); war.defenders = war.defenders.filter((x) => x !== c); };
  remove(loser);
  for (let k = 0; k < w.countries.size; k++) if (cc.overlord![k] === loser) remove(k);
  for (const x of [winner, ...war.attackers, ...war.defenders]) setTruce(w, x, loser, TRUCE_DAYS);
  if (!war.attackers.length || !war.defenders.length || terms.some((t) => t.type === "white_peace")) {
    war.end = w.date; war.outcome = terms.some((t) => t.type === "white_peace") ? "white peace" : `${w.countryTags[winner]} victorious`;
    for (let p = 0; p < w.provinces.size; p++) pc.controller![p] = pc.owner![p]!; // occupations end
  } else {
    for (let p = 0; p < w.provinces.size; p++) if (pc.owner![p] === loser || pc.controller![p] === loser) pc.controller![p] = pc.owner![p]!;
  }
  if (terms.some((t) => t.type !== "white_peace")) w.countryFlags[loser]![`revenge_${w.countryTags[winner]}`] = w.date;
  // Beating a rival is worth prestige and PP (§14 rivals).
  if (w.rivals[winner]?.includes(loser)) { cc.prestige![winner]! += 50; cc.pp![winner]! += 100; }
  chronicle(w, winner, "peace", `Peace: ${w.countryTags[loser]} ${desc.join(", ") || "makes peace"} (${war.name}).`);
  void pair;
}

/** Province changes hands: owner and controller; claims on it lapse; armies of the loser there move home. */
export function transferProvince(w: World, p: number, to: number): void {
  w.provinces.cols.owner![p] = to; w.provinces.cols.controller![p] = to;
  for (const list of w.claims) { const k = list.indexOf(p); if (k >= 0) list.splice(k, 1); }
  // Keep the capital valid.
  for (let c = 0; c < w.countries.size; c++) if (w.countries.cols.capital![c] === p && c !== to) {
    let best = -1;
    for (let q = 0; q < w.provinces.size; q++) if (w.provinces.cols.owner![q] === c && (best < 0 || w.provinces.cols.population![q]! > w.provinces.cols.population![best]!)) best = q;
    w.countries.cols.capital![c] = best;
  }
  void neighborsOf;
}
