// Labour: jobs per (province, stratum), building staffing, pop employment and subsistence.
import { BUILDINGS, N_STRATA, PMS, STRATUM } from "../defs";
import type { World } from "../world";
import { toYmd } from "../date";
import { relYear, TREE_INDUSTRY } from "../techs";
// Local aliases: avoid cross-module live-binding getters in hot loops (tsx/esbuild).
const _PMS = PMS, _N_STRATA = N_STRATA, _STRATUM = STRATUM, _BUILDINGS = BUILDINGS;

export const jobsKey = (prov: number, s: number) => prov * _N_STRATA + s;

/**
 * Pick the production method with the best expected profit at current national prices and wages among
 * those unlocked by year (gated by the industry tech year). Inputs priced at the dearer of national/world
 * price so shortages discourage switching. Runs yearly (and for new buildings).
 */
export function choosePms(w: World, only?: number): void {
  const year = toYmd(w.date).year, b = w.buildings.cols, cc = w.countries.cols;
  const mk = w.markets.cols.price!, wp = w.worldMarket.cols.price!, nG = mk.length / Math.max(1, w.countries.size);
  for (let i = only ?? 0; i < (only !== undefined ? only + 1 : w.buildings.size); i++) {
    const pms = _PMS[b.type![i]!]!, c = w.provinces.cols.owner![b.prov![i]!]!;
    let best = 0, bestV = -Infinity;
    for (let k = 0; k < pms.length; k++) {
      const pm = pms[k]!;
      if (pm.year > relYear(w, c, TREE_INDUSTRY)) continue;
      let v = 0;
      for (let g = 0; g < nG; g++) {
        if (pm.outputs[g]) v += pm.outputs[g]! * Math.min(mk[c * nG + g]!, wp[g]! * 1.5);
        if (pm.inputs[g]) v -= pm.inputs[g]! * Math.max(mk[c * nG + g]!, wp[g]!);
      }
      for (let s = 0; s < _N_STRATA; s++) v -= pm.jobs[s]! * (cc[`wage${s}`]![c]! || 0);
      if (v > bestV * 1.05 || k === 0) { bestV = v; best = k; }
    }
    b.pm![i] = best;
  }
}

/** Returns jobs and filled jobs arrays indexed by jobsKey. */
export function runLabour(w: World): { jobs: Float64Array; filled: Float64Array } {
  const nP = w.provinces.size, b = w.buildings.cols, p = w.pops.cols;
  const jobs = new Float64Array(nP * _N_STRATA), workforce = new Float64Array(nP * _N_STRATA), filled = new Float64Array(nP * _N_STRATA);
  for (let i = 0; i < w.buildings.size; i++) {
    const pm = _PMS[b.type![i]!]![b.pm![i]!]!, lv = b.level![i]!;
    for (let s = 0; s < _N_STRATA; s++) if (pm.jobs[s]) jobs[jobsKey(b.prov![i]!, s)]! += lv * pm.jobs[s]!;
  }
  for (let i = 0; i < w.pops.size; i++) workforce[jobsKey(p.prov![i]!, p.stratum![i]!)]! += p.a1![i]!;
  for (let k = 0; k < jobs.length; k++) filled[k] = Math.min(jobs[k]!, workforce[k]!);
  for (let i = 0; i < w.buildings.size; i++) {
    const pm = _PMS[b.type![i]!]![b.pm![i]!]!;
    let tot = 0, got = 0;
    for (let s = 0; s < _N_STRATA; s++) {
      if (!pm.jobs[s]) continue;
      const k = jobsKey(b.prov![i]!, s);
      tot += pm.jobs[s]!; got += pm.jobs[s]! * (jobs[k]! > 0 ? filled[k]! / jobs[k]! : 0);
    }
    b.staffing![i] = tot > 0 ? got / tot : 1;
  }
  const self = [_STRATUM.elites, _STRATUM.military, _STRATUM.bureaucrats];
  for (let i = 0; i < w.pops.size; i++) {
    const s = p.stratum![i]!, k = jobsKey(p.prov![i]!, s), a1 = p.a1![i]!;
    const rate = self.includes(s) ? 1 : workforce[k]! > 0 ? filled[k]! / workforce[k]! : 0;
    p.employed![i] = a1 * rate;
    p.subsistence![i] = s === _STRATUM.peasants ? 1 - rate : 0;
  }
  return { jobs, filled };
}

export const isStateBuilding = (type: number) => _BUILDINGS[type]!.owner === "state";
