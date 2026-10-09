// State budget: public-sector pay, arms, pensions, interest, debt and money printing, inflation, tax policy.
// Auto-managed until the AI/player loop (M3): taxes drift toward a balanced budget.
import { BASE_PRICE, N_GOODS, N_STRATA, PMS, STRATUM, goodIndex } from "../defs";
import { Acct, apportion, burn, mint, transfer } from "../money";
import type { World } from "../world";
import { toYmd } from "../date";
import type { OrderBook } from "./orders";
import { isStateBuilding, jobsKey } from "./labour";
// Local aliases: avoid cross-module live-binding getters in hot loops (tsx/esbuild).
const _BASE_PRICE = BASE_PRICE, _N_GOODS = N_GOODS, _PMS = PMS, _N_STRATA = N_STRATA, _STRATUM = STRATUM;

export const ARMS_PER_SOLDIER = 0.02;
export const MILITARY_PAY = 1.2, BUREAUCRAT_PAY = 1.1; // × average worker wage
export const DEBT_LIMIT_GDP = 0.9;
export const BASE_INTEREST = 0.03;
export const PRINT_INFLATION = 0.9;
export const TAX_MIN = 0.05, TAX_MAX = 0.45;
const ARMS = goodIndex("arms");
/** Government consumption basket (share of discretionary spending by good). */
export const GOV_BASKET: [number, number][] = [[goodIndex("services"), 0.5], [goodIndex("consumer_goods"), 0.2], [ARMS, 0.15], [goodIndex("fuel"), 0.1], [goodIndex("electricity"), 0.05]];
/** Months of expenses the treasury keeps; anything above is spent on government consumption. */
export const RESERVE_MONTHS = 3, DISCRETIONARY_SPEND = 0.4;

export interface StatePlan { orders: number[] }

/** Treasury buys arms for the army and inputs for public buildings (universities, hospitals). */
export function planState(w: World, book: OrderBook): StatePlan {
  const cc = w.countries.cols, mk = w.markets.cols.price!, wp = w.worldMarket.cols.price!;
  const orders: number[] = [];
  const soldiers = new Float64Array(w.countries.size);
  for (let i = 0; i < w.pops.size; i++) if (w.pops.cols.stratum![i] === _STRATUM.military) soldiers[w.provinces.cols.owner![w.pops.cols.prov![i]!]!]! += w.pops.cols.a1![i]!;
  const want = new Float64Array(w.countries.size * _N_GOODS);
  for (let c = 0; c < w.countries.size; c++) want[c * _N_GOODS + ARMS] = soldiers[c]! * ARMS_PER_SOLDIER;
  const b = w.buildings.cols;
  for (let i = 0; i < w.buildings.size; i++) {
    if (!isStateBuilding(b.type![i]!)) continue;
    const pm = _PMS[b.type![i]!]![b.pm![i]!]!, c = w.provinces.cols.owner![b.prov![i]!]!;
    for (let g = 0; g < _N_GOODS; g++) want[c * _N_GOODS + g]! += pm.inputs[g]! * b.level![i]! * b.staffing![i]!;
  }
  for (let c = 0; c < w.countries.size; c++) {
    const price = (g: number) => Math.min(mk[c * _N_GOODS + g]!, wp[g]!), maxP = (g: number) => Math.max(mk[c * _N_GOODS + g]!, wp[g]!);
    let cost = 0;
    for (let g = 0; g < _N_GOODS; g++) cost += want[c * _N_GOODS + g]! * price(g);
    const cash = Math.max(0, cc.treasury![c]!);
    const afford = cost > 0 ? Math.min(1, (cash * 0.5) / cost) : 0;
    const q = new Float64Array(_N_GOODS);
    for (let g = 0; g < _N_GOODS; g++) q[g] = want[c * _N_GOODS + g]! * afford;
    // Discretionary government consumption from reserves above target.
    const reserve = RESERVE_MONTHS * Math.max(cc.expense![c]!, cc.income![c]!);
    const spare = Math.max(0, cash - cost * afford - reserve) * DISCRETIONARY_SPEND;
    for (const [g, share] of GOV_BASKET) q[g]! += (spare * share) / price(g);
    for (let g = 0; g < _N_GOODS; g++) if (q[g]! > 0) orders.push(book.buy(c, g, q[g]!, Acct.Treasury, c, q[g]! * maxP(g) + 1));
  }
  return { orders };
}

/** Pay public employees, soldiers, bureaucrats and pensions; service debt; update inflation. */
export function settleBudget(w: World, jobs: Float64Array, filled: Float64Array): void {
  const cc = w.countries.cols, pc = w.pops.cols, nC = w.countries.size;
  // Public payroll per pop: soldiers & bureaucrats (all employed by the state), public-building staff.
  const publicJobs = new Float64Array(w.provinces.size * _N_STRATA);
  const b = w.buildings.cols;
  for (let i = 0; i < w.buildings.size; i++) {
    if (!isStateBuilding(b.type![i]!)) continue;
    const pm = _PMS[b.type![i]!]![b.pm![i]!]!;
    for (let s = 0; s < _N_STRATA; s++) publicJobs[jobsKey(b.prov![i]!, s)]! += pm.jobs[s]! * b.level![i]!;
  }
  const payroll: number[][] = Array.from({ length: nC }, () => []);
  const payW: number[][] = Array.from({ length: nC }, () => []);
  for (let i = 0; i < w.pops.size; i++) {
    const s = pc.stratum![i]!, prov = pc.prov![i]!, c = w.provinces.cols.owner![prov]!, k = jobsKey(prov, s);
    let amount = 0;
    const workerWage = cc.wage1![c]!;
    if (s === _STRATUM.military) amount = pc.a1![i]! * workerWage * MILITARY_PAY;
    else if (s === _STRATUM.bureaucrats) amount = pc.a1![i]! * workerWage * BUREAUCRAT_PAY;
    else if (publicJobs[k]! > 0 && jobs[k]! > 0) amount = pc.employed![i]! * (publicJobs[k]! / jobs[k]!) * (cc[`wage${s}`]![c]! || workerWage);
    amount += pc.a2![i]! * workerWage * cc.pensionRate![c]!;
    if (amount > 0) { payroll[c]!.push(i); payW[c]!.push(amount); }
  }
  void filled;
  for (let c = 0; c < nC; c++) {
    const want = Math.floor(payW[c]!.reduce((a, x) => a + x, 0));
    // Spending above the treasury is financed by borrowing up to the debt limit, then by printing.
    ensureFunds(w, c, want);
    const pay = Math.min(want, Math.max(0, Math.floor(cc.treasury![c]!)));
    const shares = apportion(pay, payW[c]!);
    payroll[c]!.forEach((i, j) => transfer(w, Acct.Treasury, c, Acct.Pop, i, shares[j]!));
    // Interest to foreign creditors.
    const debtRatio = cc.gdpYear![c]! > 0 ? cc.debt![c]! / cc.gdpYear![c]! : 0;
    const rate = BASE_INTEREST + 0.06 * Math.max(0, debtRatio - 0.6);
    const interest = Math.floor((cc.debt![c]! * rate) / 12);
    ensureFunds(w, c, interest);
    burn(w, Acct.Treasury, c, Math.min(interest, Math.max(0, Math.floor(cc.treasury![c]!))));
    // Repay debt from large surpluses.
    const monthlyExp = Math.max(1, cc.expense![c]!);
    const excess = cc.treasury![c]! - 6 * monthlyExp;
    if (excess > 0 && cc.debt![c]! > 0) {
      const r = Math.floor(Math.min(cc.debt![c]!, excess * 0.5));
      burn(w, Acct.Treasury, c, r, true);
      cc.debt![c]! -= r;
    }
  }
}

/** Make sure the treasury can pay `need` cents: borrow (debt) within the limit, otherwise print money. */
function ensureFunds(w: World, c: number, need: number): void {
  const cc = w.countries.cols;
  const gap = Math.ceil(need - Math.max(0, cc.treasury![c]!));
  if (gap <= 0) return;
  const limit = DEBT_LIMIT_GDP * Math.max(cc.gdpYear![c]!, 1);
  const borrow = Math.max(0, Math.min(gap, Math.floor(limit - cc.debt![c]!)));
  if (borrow > 0) { mint(w, Acct.Treasury, c, borrow, true); cc.debt![c]! += borrow; cc.borrowed![c]! += borrow; }
  const print = gap - borrow;
  if (print > 0) { mint(w, Acct.Treasury, c, print, true); cc.printed![c]! += print; }
}

/** Monthly price-level drift from printed money relative to the money supply. */
export function updateInflation(w: World): void {
  const cc = w.countries.cols;
  for (let c = 0; c < w.countries.size; c++) {
    const M = Math.max(1, cc.money![c]!);
    const push = Math.min(0.05, (PRINT_INFLATION * cc.printed![c]!) / M + (0.15 * cc.borrowed![c]!) / M);
    cc.priceLevel![c] = cc.priceLevel![c]! * (1 + push);
    cc.printed![c] = 0; cc.borrowed![c] = 0;
  }
}

/** Yearly (January): automatic fiscal policy toward a balanced budget; pensions grow with wealth. */
export function yearlyFiscalPolicy(w: World): void {
  const cc = w.countries.cols, year = toYmd(w.date).year;
  for (let c = 0; c < w.countries.size; c++) {
    const gdp = Math.max(1, cc.gdpYear![c]!), debtRatio = cc.debt![c]! / gdp;
    const months = cc.treasury![c]! / Math.max(1, cc.expense![c]!);
    let t = cc.taxRate![c]!;
    if (months < 1 || debtRatio > 0.6) t += 0.01 + (debtRatio > 0.6 ? 0.01 : 0);
    else if (months > 2 * RESERVE_MONTHS) t -= 0.01;
    cc.taxRate![c] = Math.min(TAX_MAX, Math.max(TAX_MIN, t));
    const gdpPc = gdp / Math.max(1, cc.population![c]!) / 100;
    cc.pensionRate![c] = Math.min(0.5, 0.05 + 0.4 * Math.min(1, gdpPc / 20000) * Math.min(1, (year - 1936) / 40 + 0.3));
    cc.inflation![c] = cc.plYearAgo![c]! > 0 ? cc.priceLevel![c]! / cc.plYearAgo![c]! - 1 : 0;
    cc.plYearAgo![c] = cc.priceLevel![c]!;
  }
}

/** Consumer price index per country (basket of final goods, 1 = base prices). */
export function consumerPriceIndex(w: World, c: number): number {
  const mk = w.markets.cols.price!;
  let num = 0, den = 0;
  for (const [g, wt] of CPI_BASKET) { num += wt * (mk[c * _N_GOODS + g]! / _BASE_PRICE[g]!); den += wt; }
  return num / den;
}
const CPI_BASKET: [number, number][] = ["grain", "consumer_goods", "clothing", "fuel", "services", "luxury_goods"].map((g) => [goodIndex(g), 1]);
export const MONETARY_TARGET = 1, MONETARY_RESPONSE = 0.5, MONETARY_MAX = 0.03;

/**
 * Monetary policy: a growing real economy needs more money. When consumer prices sit below target
 * (relative to the national price level) the central bank credits the treasury (seigniorage), which the
 * state then spends; this is not debt and does not feed the printing-inflation channel.
 */
export function monetaryPolicy(w: World): void {
  const cc = w.countries.cols;
  for (let c = 0; c < w.countries.size; c++) {
    const gap = MONETARY_TARGET - consumerPriceIndex(w, c) / cc.priceLevel![c]!;
    if (!(gap > 0.02)) continue; // also skips NaN (countries without markets)
    mint(w, Acct.Treasury, c, Math.floor(Math.min(MONETARY_MAX, MONETARY_RESPONSE * gap) * cc.money![c]!), true);
  }
}
