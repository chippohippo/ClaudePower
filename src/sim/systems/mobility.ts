// Mobility (monthly): idle pops move into strata with vacancies (peasants → workers → clerks → professionals)
// as literacy allows; long unemployment pushes people down. Assimilation (yearly): slow drift to the
// dominant culture of the province, faster with literacy.
import { N_STRATA, STRATUM } from "../defs";
import { popIndex, popSize, transferPop } from "../pops";
import type { World } from "../world";
import { jobsKey } from "./labour";
// Local aliases: avoid cross-module live-binding getters in hot loops (tsx/esbuild).
const _N_STRATA = N_STRATA, _STRATUM = STRATUM;

export const MOBILITY_RATE = 0.010;  // max share of a source pop per month
export const DOWNWARD_RATE = 0.01;
export const ASSIMILATION_RATE = 0.006;

const LADDER: [number, number, number][] = [
  // [from, to, literacy required]
  [_STRATUM.peasants, _STRATUM.workers, 0],
  [_STRATUM.workers, _STRATUM.clerks, 0.5],
  [_STRATUM.clerks, _STRATUM.professionals, 0.75],
  [_STRATUM.peasants, _STRATUM.clerks, 0.6],
];

export function runMobility(w: World, jobs: Float64Array): void {
  const p = w.pops.cols, nP = w.provinces.size;
  const workforce = new Float64Array(nP * _N_STRATA);
  for (let i = 0; i < w.pops.size; i++) workforce[jobsKey(p.prov![i]!, p.stratum![i]!)]! += p.a1![i]!;
  const vacancy = new Float64Array(nP * _N_STRATA);
  for (let k = 0; k < vacancy.length; k++) vacancy[k] = Math.max(0, jobs[k]! - workforce[k]!);
  const idx = popIndex(w);
  const n = w.pops.size;
  for (const [from, to, litReq] of LADDER) {
    for (let i = 0; i < n; i++) {
      if (p.stratum![i] !== from || p.literacy![i]! < litReq) continue;
      const k = jobsKey(p.prov![i]!, to);
      if (vacancy[k]! <= 0) continue;
      const idleAdults = p.a1![i]! - p.employed![i]!;
      if (idleAdults <= 0) continue;
      const move = Math.min(vacancy[k]!, idleAdults * MOBILITY_RATE * 3, p.a1![i]! * MOBILITY_RATE);
      vacancy[k]! -= move;
      transferPop(w, idx, i, move / p.a1![i]!, { stratum: to });
    }
  }
  // Downward: unemployed non-peasants drift to peasantry (subsistence).
  for (let i = 0; i < n; i++) {
    const s = p.stratum![i]!;
    if (s === _STRATUM.peasants || s === _STRATUM.elites || s === _STRATUM.military || s === _STRATUM.bureaucrats) continue;
    const unemp = p.a1![i]! > 0 ? 1 - p.employed![i]! / p.a1![i]! : 0;
    if (unemp > 0.15) transferPop(w, idx, i, DOWNWARD_RATE * unemp, { stratum: s === _STRATUM.workers ? _STRATUM.peasants : s - 1 });
  }
}

export function runAssimilation(w: World): void {
  const p = w.pops.cols, nP = w.provinces.size;
  const byCulture = new Map<number, number>();
  const dominant = new Int32Array(nP).fill(-1), best = new Float64Array(nP);
  for (let i = 0; i < w.pops.size; i++) {
    const k = p.prov![i]! * 4096 + p.culture![i]!;
    byCulture.set(k, (byCulture.get(k) ?? 0) + popSize(w, i));
  }
  for (const [k, n] of byCulture) { const prov = Math.floor(k / 4096); if (n > best[prov]!) { best[prov] = n; dominant[prov] = k % 4096; } }
  const idx = popIndex(w), n = w.pops.size;
  for (let i = 0; i < n; i++) {
    const d = dominant[p.prov![i]!]!;
    if (d < 0 || p.culture![i] === d) continue;
    transferPop(w, idx, i, ASSIMILATION_RATE * (0.5 + p.literacy![i]!), { culture: d });
  }
}
