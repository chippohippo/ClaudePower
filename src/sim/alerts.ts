// Alerts column (§13.1): actionable, sim-derived warnings for one country. Each has a type (mutable),
// a severity, readable text, and an optional jump target.
import { BUILDINGS, GOODS, N_GOODS } from "./defs";
import { countryStat } from "./modifiers";
import { POINT_CAP } from "./systems/core";
import { AUTO_BUILD } from "./automation";
import type { World } from "./world";
import { IGS, N_IGS, igIndex, igRow } from "./igs";
import { Role, findRole } from "./characters";
import { toYmd } from "./date";

const PRODUCER: Record<number, string> = {};
BUILDINGS.forEach((b) => { for (const g of Object.keys(b.pms[0]!.outputs)) PRODUCER[GOODS.findIndex((x) => x.id === g)] = b.name; });

export interface Alert { type: string; severity: 1 | 2 | 3; text: string; province?: number; panel?: "economy" | "population" | "government" | "igs" | "military" }

export const ALERT_TYPES = ["war", "battle", "ig_radical", "strike", "coup_risk", "vacant_seat", "election", "points_cap", "pp_cap", "unemployment", "unrest", "bankruptcy", "debt", "shortage", "stability", "idle_treasury", "construction_idle"] as const;

export function computeAlerts(w: World, c: number): Alert[] {
  const out: Alert[] = [], cc = w.countries.cols, pc = w.provinces.cols;
  const gain = { adm: countryStat(w, "adm_gain")[c]!, dip: countryStat(w, "dip_gain")[c]!, mil: countryStat(w, "mil_gain")[c]! };
  for (const k of ["adm", "dip", "mil"] as const) {
    const months = (POINT_CAP - cc[k]![c]!) / Math.max(0.1, gain[k]);
    if (months <= 3) out.push({ type: "points_cap", severity: months <= 0 ? 3 : 2, text: months <= 0 ? `${k.toUpperCase()} is capped — points are being wasted` : `You'll waste ${k.toUpperCase()} in ${Math.ceil(months)} months — develop a province` });
  }
  if (cc.pp![c]! > 1500) out.push({ type: "pp_cap", severity: 1, text: `Political power ${Math.floor(cc.pp![c]!)} — enact a law`, panel: "government" });
  // Worst provinces by unemployment and unrest.
  let worstU = -1, worstR = -1;
  for (let p = 0; p < w.provinces.size; p++) {
    if (pc.owner![p] !== c || pc.population![p]! < 1e5) continue;
    if (worstU < 0 || pc.unemployment![p]! > pc.unemployment![worstU]!) worstU = p;
    if (worstR < 0 || pc.unrest![p]! > pc.unrest![worstR]!) worstR = p;
  }
  if (worstU >= 0 && pc.unemployment![worstU]! > 0.1) out.push({ type: "unemployment", severity: pc.unemployment![worstU]! > 0.2 ? 3 : 2, text: `Unemployment ${(100 * pc.unemployment![worstU]!).toFixed(0)}% in ${w.provinceNames[worstU]}`, province: worstU });
  if (worstR >= 0 && pc.unrest![worstR]! > 4) out.push({ type: "unrest", severity: pc.unrest![worstR]! > 7 ? 3 : 2, text: `Unrest ${pc.unrest![worstR]!.toFixed(1)} in ${w.provinceNames[worstR]} (output −${(3 * pc.unrest![worstR]!).toFixed(0)}%)`, province: worstR });
  const net = cc.income![c]! - cc.expense![c]!;
  if (net < 0 && cc.treasury![c]! > 0) {
    const months = cc.treasury![c]! / -net;
    if (months < 12) out.push({ type: "bankruptcy", severity: months < 4 ? 3 : 2, text: `Treasury empty in ${Math.max(1, Math.round(months))} months at this deficit — then debt`, panel: "economy" });
  }
  const debtRatio = cc.debt![c]! / Math.max(1, cc.gdpYear![c]!);
  if (debtRatio > 0.6) out.push({ type: "debt", severity: debtRatio > 0.85 ? 3 : 2, text: `Debt at ${(100 * debtRatio).toFixed(0)}% of GDP — interest rising${debtRatio > 0.85 ? ", printing money soon" : ""}`, panel: "economy" });
  // Only the two worst shortages, so the column stays readable.
  const short: [number, number][] = [];
  for (let g = 0; g < N_GOODS; g++) {
    const k = c * N_GOODS + g, demand = w.markets.cols.demand![k]!;
    const unmet = demand > 0 ? 1 - w.markets.cols.bought![k]! / demand : 0;
    if (unmet > 0.3) short.push([g, unmet]);
  }
  for (const [g, unmet] of short.sort((a, b) => b[1] - a[1]).slice(0, 2)) {
    const k = c * N_GOODS + g, base = GOODS[g]!.basePrice * cc.priceLevel![c]!;
    out.push({ type: "shortage", severity: unmet > 0.5 ? 3 : 2, text: `${GOODS[g]!.name} shortage: ${(100 * unmet).toFixed(0)}% unmet, price ×${(w.markets.cols.price![k]! / base).toFixed(1)} — build ${PRODUCER[g] ?? "more"}`, panel: "economy" });
  }
  if (cc.stability![c]! < -1) out.push({ type: "stability", severity: cc.stability![c]! < -2 ? 3 : 2, text: `Stability ${cc.stability![c]!.toFixed(1)} — unrest rising`, panel: "government" });
  if (!(cc.automation![c]! & AUTO_BUILD)) {
    let mine = 0;
    for (let j = 0; j < w.projects.size; j++) if (w.projects.cols.country![j] === c && w.projects.cols.state![j] === 1) mine++;
    if (mine === 0) out.push({ type: "construction_idle", severity: 1, text: "No state construction under way" });
    if (cc.treasury![c]! > 12 * Math.max(1, cc.expense![c]!)) out.push({ type: "idle_treasury", severity: 1, text: "Treasury holds a year of spending — invest it or cut taxes", panel: "economy" });
  }
  // Wars and battles.
  for (const war of w.wars) {
    if (war.end >= 0 || (!war.attackers.includes(c) && !war.defenders.includes(c))) continue;
    const ours = war.attackers.includes(c) ? war.score : -war.score;
    out.push({ type: "war", severity: ours < -20 ? 3 : 2, text: `${war.name}: war score ${ours.toFixed(0)}${ours >= 25 ? " — you can demand terms" : ours <= -25 ? " — consider peace" : ""}`, panel: "military" });
  }
  const fighting = w.battles.filter((b) => b.winner === "ongoing" && (b.attacker === c || b.defender === c));
  if (fighting.length) out.push({ type: "battle", severity: 2, text: `${fighting.length} battle${fighting.length > 1 ? "s" : ""} under way (${fighting.map((b) => w.provinceNames[b.prov]).slice(0, 2).join(", ")})`, province: fighting[0]!.prov, panel: "military" });
  // Interest groups.
  const AF = igIndex("armed_forces");
  for (let g = 0; g < N_IGS; g++) {
    const r = igRow(c, g), ic = w.igs.cols;
    if (ic.strikes![r]! > 0) out.push({ type: "strike", severity: 3, text: `${IGS[g]!.name} are striking (radicalism ${ic.radicalism![r]!.toFixed(0)}) — output falls`, panel: "igs" });
    else if (ic.radicalism![r]! > 30 && ic.clout![r]! > 0.05) out.push({ type: "ig_radical", severity: 2, text: `${IGS[g]!.name} radicalising (${ic.radicalism![r]!.toFixed(0)}) — grant their privilege or co-opt`, panel: "igs" });
    if (g === AF && ic.radicalism![r]! > 45 && ic.clout![r]! > 0.08) out.push({ type: "coup_risk", severity: 3, text: `Coup risk: the Armed Forces are restless (radicalism ${ic.radicalism![r]!.toFixed(0)})`, panel: "igs" });
  }
  for (const [role, n] of [[Role.Cabinet, 4], [Role.HighCommand, 3]] as const) for (let sl = 0; sl < n; sl++) if (findRole(w, c, role, sl) < 0) { out.push({ type: "vacant_seat", severity: 2, text: `A ${role === Role.Cabinet ? "cabinet" : "high command"} seat is vacant — appoint someone`, panel: "government" }); break; }
  if (cc.government![c] === 0) {
    const next = cc.nextElection![c]!, months = (Math.floor(next / 100) - toYmd(w.date).year) * 12 + (next % 100) - toYmd(w.date).month;
    if (months >= 0 && months <= 6) out.push({ type: "election", severity: 1, text: `Election in ${months} months — IG approval decides the vote`, panel: "igs" });
  }
  return out.sort((a, b) => b.severity - a.severity);
}
