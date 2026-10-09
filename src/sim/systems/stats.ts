// Aggregates for UI, AI and calibration: province/country population, SoL, urbanisation, literacy,
// unemployment, life expectancy, fertility, money supply, GDP; yearly history snapshot.
import { N_STRATA, STRATUM } from "../defs";
import { popSize } from "../pops";
import type { World } from "../world";
import { toYmd } from "../date";
import { lifeExpectancy, mortality, tfrOf } from "./demography";
// Local aliases: avoid cross-module live-binding getters in hot loops (tsx/esbuild).
const _N_STRATA = N_STRATA, _STRATUM = STRATUM;

export function updateStats(w: World): void {
  const p = w.pops.cols, nP = w.provinces.size, nC = w.countries.size, pc = w.provinces.cols, cc = w.countries.cols;
  const pPop = new Float64Array(nP), pSol = new Float64Array(nP), pAd = new Float64Array(nP), pUn = new Float64Array(nP);
  const cPop = new Float64Array(nC), cSol = new Float64Array(nC), cUrb = new Float64Array(nC), cLit = new Float64Array(nC);
  const cAd = new Float64Array(nC), cUn = new Float64Array(nC), cM = new Float64Array(nC * 3), cTfr = new Float64Array(nC), cA1 = new Float64Array(nC);
  const money = new Float64Array(nC);
  for (let i = 0; i < w.pops.size; i++) {
    const s = popSize(w, i), pr = p.prov![i]!, c = pc.owner![pr]!, st = p.stratum![i]!;
    pPop[pr]! += s; pSol[pr]! += p.sol![i]! * s;
    cPop[c]! += s; cSol[c]! += p.sol![i]! * s; cLit[c]! += p.literacy![i]! * s;
    if (st !== _STRATUM.peasants) cUrb[c]! += s;
    if (st !== _STRATUM.peasants && st !== _STRATUM.elites) {
      const un = Math.max(0, p.a1![i]! - p.employed![i]!);
      pAd[pr]! += p.a1![i]!; pUn[pr]! += un; cAd[c]! += p.a1![i]!; cUn[c]! += un;
    }
    const m = mortality(p.health![i]!);
    for (let b = 0; b < 3; b++) cM[c * 3 + b]! += m[b]! * s;
    cTfr[c]! += tfrOf(p.literacy![i]!, st !== _STRATUM.peasants, p.sol![i]!) * p.a1![i]!; cA1[c]! += p.a1![i]!;
    money[c]! += Math.max(0, p.cash![i]!);
  }
  for (let pr = 0; pr < nP; pr++) {
    pc.population![pr] = pPop[pr]!;
    pc.sol![pr] = pPop[pr]! > 0 ? pSol[pr]! / pPop[pr]! : 0;
    pc.unemployment![pr] = pAd[pr]! > 0 ? pUn[pr]! / pAd[pr]! : 0;
  }
  for (let i = 0; i < w.buildings.size; i++) money[pc.owner![w.buildings.cols.prov![i]!]!]! += w.buildings.cols.cash![i]!;
  for (let c = 0; c < nC; c++) {
    const n = Math.max(1, cPop[c]!);
    cc.population![c] = cPop[c]!;
    cc.sol![c] = cSol[c]! / n; cc.urban![c] = cUrb[c]! / n; cc.literacy![c] = cLit[c]! / n;
    cc.unemployment![c] = cAd[c]! > 0 ? cUn[c]! / cAd[c]! : 0;
    cc.lifeExp![c] = cPop[c]! >= 1 ? lifeExpectancy([cM[c * 3]! / n, cM[c * 3 + 1]! / n, cM[c * 3 + 2]! / n]) : 0;
    cc.tfr![c] = cA1[c]! > 0 ? cTfr[c]! / cA1[c]! : 0;
    cc.money![c] = money[c]! + Math.max(0, cc.treasury![c]!) + cc.investPool![c]!;
  }
}

export const HISTORY_KEYS = ["population", "gdpYear", "sol", "urban", "literacy", "lifeExp", "tfr", "inflation", "unemployment", "debt", "taxRate"] as const;

/** January: roll the GDP year and append one history row per country. */
export function recordYear(w: World): void {
  const cc = w.countries.cols;
  for (let c = 0; c < w.countries.size; c++) { cc.gdpYear![c] = cc.gdpAcc![c]!; cc.gdpAcc![c] = 0; }
  const h = w.history;
  h.year.push(toYmd(w.date).year - 1);
  for (const k of HISTORY_KEYS) {
    const s = (h.series[k] ??= Array.from({ length: w.countries.size }, () => []));
    for (let c = 0; c < w.countries.size; c++) s[c]!.push(Math.round(cc[k]![c]! * 1000) / 1000);
  }
}

export const STRATA_COUNT = _N_STRATA;
