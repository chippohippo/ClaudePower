// Demography (yearly rates, applied monthly for smoothness): births, deaths by age band, ageing,
// health and literacy drift. Demographic transition: fertility falls with literacy, urbanisation and SoL.
import { STRATUM } from "../defs";
import { getStat } from "../modifiers";
import type { World } from "../world";
import { toYmd } from "../date";

export const TFR_FLOOR = 1.2, TFR_RANGE = 5.6;
export const HEALTH_DRIFT = 0.02, LITERACY_YEARS = 12;
export const FAMINE_DEATHS = 0.06;
/** Births per adult (15–64) per unit TFR per year: women 15–49 ≈ 45% of adults, TFR spread over 35 years. */
export const BIRTH_FACTOR = 0.014;

/** Global medicine (placeholder for the tech system, M7): 0.8 in 1936 → 1.0 by ~1976. */
export const medicine = (year: number) => Math.min(1, 0.8 + 0.2 * Math.max(0, (year - 1936) / 40) ** 0.7);
/** Global schooling reach: 0.55 in 1936 → 1.0 by ~2010. */
export const schooling = (year: number) => Math.min(1, 0.55 + 0.45 * Math.max(0, (year - 1936) / 74));

export function tfrOf(literacy: number, urban: boolean, sol: number): number {
  return TFR_FLOOR + TFR_RANGE * (1 - 0.6 * literacy) * (urban ? 0.7 : 1) * (1 - 0.65 * sol / 100);
}
/** Annual mortality per age band from health (0–1). */
export function mortality(h: number): [number, number, number] {
  const x = 1 - h;
  return [0.002 + 0.05 * x, 0.002 + 0.012 * x, 0.04 + 0.08 * x];
}
/** Period life expectancy from band mortality (0–14, 15–64, 65+). */
export function lifeExpectancy([m0, m1, m2]: [number, number, number]): number {
  const y0 = (1 - Math.exp(-15 * m0)) / m0, s15 = Math.exp(-15 * m0);
  const y1 = (1 - Math.exp(-50 * m1)) / m1, s65 = Math.exp(-50 * m1);
  return y0 + s15 * (y1 + s65 / m2);
}

export interface Bonuses { literacy: Float64Array; health: Float64Array }

export function runDemography(w: World, famine: Float64Array, bonus: Bonuses): void {
  const p = w.pops.cols, year = toYmd(w.date).year, med = medicine(year), school = schooling(year);
  const fertMult = Array.from({ length: w.countries.size }, (_, c) => getStat(w, `c:${c}`, "fertility_mult").value);
  for (let i = 0; i < w.pops.size; i++) {
    const a0 = p.a0![i]!, a1 = p.a1![i]!, a2 = p.a2![i]!;
    if (a0 + a1 + a2 < 1) continue;
    const c = w.provinces.cols.owner![p.prov![i]!]!, prov = p.prov![i]!;
    const sol = p.sol![i]!, lit = p.literacy![i]!;
    const tfr = tfrOf(lit, p.stratum![i] !== STRATUM.peasants, sol) * fertMult[c]!;
    const births = (BIRTH_FACTOR * a1 * tfr) / 12;
    const [m0, m1, m2] = mortality(p.health![i]!);
    const fam = 1 + FAMINE_DEATHS * famine[i]! * 12;
    const d0 = Math.min(a0, (a0 * m0 * fam) / 12), d1 = Math.min(a1, (a1 * m1 * fam) / 12), d2 = Math.min(a2, (a2 * m2 * fam) / 12);
    const up0 = a0 / 15 / 12, up1 = a1 / 50 / 12;
    p.a0![i] = a0 + births - d0 - up0;
    p.a1![i] = a1 + up0 - d1 - up1;
    p.a2![i] = a2 + up1 - d2;
    w.ledger.born += births; w.ledger.died += d0 + d1 + d2;
    const hTarget = Math.min(1, med * (0.45 + 0.55 * sol / 100) + bonus.health[prov]!);
    p.health![i] = p.health![i]! + (hTarget - p.health![i]!) * HEALTH_DRIFT;
    const lTarget = Math.min(1, school * (0.35 + 0.65 * Math.min(1, sol / 70)) + bonus.literacy[prov]!);
    p.literacy![i] = lit + (lTarget - lit) / (LITERACY_YEARS * 12);
  }
}

/** Public building effects per province: staffed university/hospital capacity per capita. */
export function publicBonuses(w: World, provPop: Float64Array): Bonuses {
  const lit = new Float64Array(w.provinces.size), health = new Float64Array(w.provinces.size);
  const b = w.buildings.cols;
  for (let i = 0; i < w.buildings.size; i++) {
    const t = b.type![i]!, prov = b.prov![i]!, cap = (b.level![i]! * b.staffing![i]! * 1e6) / Math.max(1, provPop[prov]!);
    if (t === UNI) lit[prov]! += 0.1 * cap;
    else if (t === HOSP) health[prov]! += 0.1 * cap;
  }
  for (let p = 0; p < w.provinces.size; p++) { lit[p] = Math.min(0.25, lit[p]!); health[p] = Math.min(0.2, health[p]!); }
  return { literacy: lit, health };
}
import { buildingIndex } from "../defs";
const UNI = buildingIndex("university"), HOSP = buildingIndex("hospital");
