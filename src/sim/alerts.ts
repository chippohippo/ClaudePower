// Alerts column (§13.1): actionable, sim-derived warnings for one country. Each has a type (mutable),
// a severity, readable text, and an optional jump target.
import { GOODS, N_GOODS } from "./defs";
import { countryStat } from "./modifiers";
import { POINT_CAP } from "./systems/core";
import { AUTO_BUILD } from "./setup";
import type { World } from "./world";

export interface Alert { type: string; severity: 1 | 2 | 3; text: string; province?: number; panel?: "economy" | "population" | "government" }

export const ALERT_TYPES = ["points_cap", "pp_cap", "unemployment", "unrest", "bankruptcy", "debt", "shortage", "stability", "idle_treasury", "construction_idle"] as const;

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
  for (let g = 0; g < N_GOODS; g++) {
    const k = c * N_GOODS + g, base = GOODS[g]!.basePrice * cc.priceLevel![c]!;
    const demand = w.markets.cols.demand![k]!, unmet = demand > 0 ? 1 - w.markets.cols.bought![k]! / demand : 0;
    if (unmet > 0.2 && demand > 0) out.push({ type: "shortage", severity: unmet > 0.5 ? 3 : 2, text: `${GOODS[g]!.name} shortage: ${(100 * unmet).toFixed(0)}% of demand unmet, price ×${(w.markets.cols.price![k]! / base).toFixed(1)} — build more`, panel: "economy" });
  }
  if (cc.stability![c]! < -1) out.push({ type: "stability", severity: cc.stability![c]! < -2 ? 3 : 2, text: `Stability ${cc.stability![c]!.toFixed(1)} — unrest rising`, panel: "government" });
  if (!(cc.automation![c]! & AUTO_BUILD)) {
    let mine = 0;
    for (let j = 0; j < w.projects.size; j++) if (w.projects.cols.country![j] === c && w.projects.cols.state![j] === 1) mine++;
    if (mine === 0) out.push({ type: "construction_idle", severity: 1, text: "No state construction under way" });
    if (cc.treasury![c]! > 12 * Math.max(1, cc.expense![c]!)) out.push({ type: "idle_treasury", severity: 1, text: "Treasury holds a year of spending — invest it or cut taxes", panel: "economy" });
  }
  return out.sort((a, b) => b.severity - a.severity);
}
