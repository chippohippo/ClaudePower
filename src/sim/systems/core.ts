// Core loop (monthly, "points_pp" slot): monarch points, political power, stability drift, unrest,
// manpower, and auto-develop. All rates come from the modifier system so tooltips can explain them.
import { countryStat, getStat } from "../modifiers";
import { AUTO_DEVELOP } from "../automation";
import { applyCommand } from "../commands";
import { cheapestDevelopment } from "../commands/player";
import "../commands/politics";
import type { World } from "../world";

export const POINT_CAP = 999, PP_CAP = 2000;
export const STABILITY_DRIFT = 0.02;
export const UNREST_SMOOTH = 0.15;
/** Auto-develop spends points once they pass this level. */
export const AUTO_DEVELOP_AT = 600;
const POINTS = [["adm", "adm_gain"], ["dip", "dip_gain"], ["mil", "mil_gain"]] as const;

export function runCore(w: World): void {
  const cc = w.countries.cols, n = w.countries.size;
  for (const [k, stat] of POINTS) {
    const gain = countryStat(w, stat);
    for (let c = 0; c < n; c++) cc[k]![c] = Math.min(POINT_CAP, cc[k]![c]! + gain[c]!);
  }
  const pp = countryStat(w, "pp_gain"), target = countryStat(w, "stability_target"), mob = countryStat(w, "mobilisation");
  // Unrest per province: misery, joblessness and weak stability.
  const pc = w.provinces.cols, nP = w.provinces.size;
  const unrestSum = new Float64Array(n), popSum = new Float64Array(n);
  for (let p = 0; p < nP; p++) {
    const c = pc.owner![p]!;
    const t = Math.max(0, Math.min(10, (45 - pc.sol![p]!) / 6 + 12 * pc.unemployment![p]! - cc.stability![c]!));
    pc.unrest![p] = pc.unrest![p]! + (t - pc.unrest![p]!) * UNREST_SMOOTH;
    unrestSum[c]! += pc.unrest![p]! * pc.population![p]!; popSum[c]! += pc.population![p]!;
  }
  for (let c = 0; c < n; c++) {
    cc.pp![c] = Math.min(PP_CAP, cc.pp![c]! + pp[c]! + 0.5 * cc.stability![c]!);
    const avgUnrest = popSum[c]! > 0 ? unrestSum[c]! / popSum[c]! : 0;
    const t = Math.max(-3, Math.min(3, target[c]! + (cc.sol![c]! - 45) / 25 - avgUnrest / 4 - cc.warExhaustion![c]! / 40));
    cc.stability![c] = cc.stability![c]! + (t - cc.stability![c]!) * STABILITY_DRIFT;
  }
  updateManpower(w, mob);
  // Auto-develop (AI and players who enabled it).
  for (let c = 0; c < n; c++) {
    if (!(cc.automation![c]! & AUTO_DEVELOP)) continue;
    for (let k = 0; k < 3; k++) {
      if (cc[POINTS[k]![0]]![c]! < AUTO_DEVELOP_AT) continue;
      const pick = cheapestDevelopment(w, c, k);
      if (pick >= 0) applyCommand({ type: "develop", actor: c, payload: { province: pick, kind: k }, issuedOn: w.date }, w);
    }
  }
}

/** Manpower: working-age population × mobilisation rate, boosted by manpower development. */
export function updateManpower(w: World, mob = countryStat(w, "mobilisation")): void {
  const cc = w.countries.cols, pc = w.provinces.cols, man = new Float64Array(w.countries.size);
  for (let i = 0; i < w.pops.size; i++) {
    const p = w.pops.cols.prov![i]!;
    man[pc.owner![p]!]! += w.pops.cols.a1![i]! * (1 + 0.03 * pc.devMan![p]!);
  }
  for (let c = 0; c < w.countries.size; c++) cc.manpower![c] = man[c]! * mob[c]!;
}

/** Stability target breakdown for tooltips (modifiers plus model terms). */
export function stabilityWhy(w: World, c: number): { label: string; value: number }[] {
  const s = getStat(w, `c:${c}`, "stability_target");
  return [...s.contributors.map((x) => ({ label: x.source, value: x.add ?? 0 })), { label: "Standard of living", value: (w.countries.cols.sol![c]! - 45) / 25 }];
}
