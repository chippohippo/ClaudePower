// Wages & pop income: buildings pay a labour share of value added, profit tax, and dividends to elites.
import { BASE_PRICE, N_GOODS, N_STRATA, PMS, STRATUM } from "../defs";
import { Acct, Escrow, apportion, budgetLine, transfer } from "../money";
import { countryStat } from "../modifiers";
import type { World } from "../world";
import { jobsKey, isStateBuilding } from "./labour";
import type { OrderBook } from "./orders";
import type { ProductionOrders } from "./production";
// Local aliases: avoid cross-module live-binding getters in hot loops (tsx/esbuild).
const _N_GOODS = N_GOODS, _BASE_PRICE = BASE_PRICE, _PMS = PMS, _N_STRATA = N_STRATA, _STRATUM = STRATUM;

export const LABOUR_SHARE = 0.65;
export const DIVIDEND_SHARE = 0.7;
export const POOL_RETURN = 0.08;
/** Relative pay per stratum within a building's wage pool. */
export const STRATUM_PAY = [1, 1.5, 2, 3.5, 0, 1.5, 2];

export interface WageResult { paidByKey: Float64Array; valueAdded: Float64Array }

export function settleBuildings(w: World, book: OrderBook, po: ProductionOrders, jobs: Float64Array, filled: Float64Array): WageResult {
  const nP = w.provinces.size, b = w.buildings.cols, pc = w.pops.cols, cc = w.countries.cols;
  const netByKey = new Float64Array(nP * _N_STRATA), paidByKey = new Float64Array(nP * _N_STRATA);
  const valueAdded = new Float64Array(w.countries.size);
  const esc = new Escrow(w);
  const dividendsByProv = new Float64Array(nP);
  const weights = new Float64Array(_N_STRATA);
  const taxEff = countryStat(w, "tax_efficiency"), invest = countryStat(w, "investment_rate");

  for (let i = 0; i < w.buildings.size; i++) {
    const prov = b.prov![i]!, country = w.provinces.cols.owner![prov]!, pm = _PMS[b.type![i]!]![b.pm![i]!]!;
    let revenue = 0, inputCost = 0, wantVal = 0, gotVal = 0;
    for (let k = 0; k < po.outCount[i]!; k++) revenue += book.sRevenue[po.outFirst[i]! + k]!;
    for (let k = 0; k < po.inCount[i]!; k++) {
      const o = po.inFirst[i]! + k;
      inputCost += book.bPaid[o]!;
      gotVal += book.bGot[o]! * _BASE_PRICE[book.bGood[o]!]!;
    }
    for (let g = 0; g < _N_GOODS; g++) wantVal += po.wanted[i * _N_GOODS + g]! * _BASE_PRICE[g]!;
    if (!isStateBuilding(b.type![i]!)) b.inputSat![i] = wantVal > 0 ? Math.min(1, gotVal / wantVal) : 1;
    b.revenue![i] = revenue;
    const va = revenue - inputCost;
    valueAdded[country]! += va;
    if (isStateBuilding(b.type![i]!)) continue; // staff paid by the state budget
    const pool = Math.min(b.cash![i]!, Math.floor(Math.max(0, va) * LABOUR_SHARE));
    b.wages![i] = pool;
    if (pool > 0) {
      const rate = Math.min(0.6, cc.taxRate![country]! * taxEff[country]! * (0.85 + 0.03 * w.provinces.cols.devTax![prov]!));
      const tax = Math.floor(pool * rate);
      budgetLine("income_tax");
      transfer(w, Acct.Building, i, Acct.Treasury, country, tax);
      esc.take(Acct.Building, i, pool - tax);
      let wsum = 0;
      for (let s = 0; s < _N_STRATA; s++) {
        const k = jobsKey(prov, s);
        weights[s] = jobs[k]! > 0 ? pm.jobs[s]! * b.level![i]! * (filled[k]! / jobs[k]!) * STRATUM_PAY[s]! : 0;
        wsum += weights[s]!;
      }
      const shares = apportion(pool - tax, weights);
      for (let s = 0; s < _N_STRATA; s++) { netByKey[jobsKey(prov, s)]! += shares[s]!; paidByKey[jobsKey(prov, s)]! += (pool * weights[s]!) / Math.max(1e-9, wsum); }
    }
    const profit = va - pool;
    b.profit![i] = profit;
    budgetLine("profit_tax");
    const prate = Math.min(0.6, cc.taxRate![country]! * taxEff[country]! * (0.85 + 0.03 * w.provinces.cols.devTax![prov]!));
    if (profit > 0) transfer(w, Acct.Building, i, Acct.Treasury, country, Math.min(b.cash![i]!, Math.floor(profit * prate)));
    const reserve = 2 * inputCost + pool;
    const div = Math.floor(Math.max(0, b.cash![i]! - reserve) * DIVIDEND_SHARE);
    if (div > 0) { esc.take(Acct.Building, i, div); dividendsByProv[prov]! += div; }
  }

  budgetLine("other_income");
  // Pay net wages to employed pops by (province, stratum), dividends to elites in the province.
  const popsByKey = new Map<number, number[]>();
  const elitesByProv = new Map<number, number[]>();
  for (let i = 0; i < w.pops.size; i++) {
    const k = jobsKey(pc.prov![i]!, pc.stratum![i]!);
    (popsByKey.get(k) ?? popsByKey.set(k, []).get(k)!).push(i);
    if (pc.stratum![i] === _STRATUM.elites) (elitesByProv.get(pc.prov![i]!) ?? elitesByProv.set(pc.prov![i]!, []).get(pc.prov![i]!)!).push(i);
    pc.income![i] = 0;
  }
  const cash0 = Float64Array.from(pc.cash!.subarray(0, w.pops.size));
  for (let k = 0; k < netByKey.length; k++) {
    if (!netByKey[k]) continue;
    const ps = popsByKey.get(k);
    if (!ps) { esc.give(Acct.Treasury, w.provinces.cols.owner![Math.floor(k / _N_STRATA)]!, netByKey[k]!); continue; }
    const shares = apportion(netByKey[k]!, ps.map((i) => pc.employed![i]!));
    ps.forEach((i, j) => esc.give(Acct.Pop, i, shares[j]!));
  }
  for (let prov = 0; prov < nP; prov++) {
    if (!dividendsByProv[prov]) continue;
    const el = elitesByProv.get(prov);
    if (!el) { esc.give(Acct.Treasury, w.provinces.cols.owner![prov]!, dividendsByProv[prov]!); continue; }
    const shares = apportion(dividendsByProv[prov]!, el.map((i) => pc.a1![i]! + 1));
    el.forEach((i, j) => esc.give(Acct.Pop, i, shares[j]!));
  }
  esc.settle();
  for (let i = 0; i < w.pops.size; i++) pc.income![i] = pc.cash![i]! - cash0[i]!;

  // Idle investment money flows back to elites (no hoarding when projects stall).
  const elitesByCountry = new Map<number, number[]>();
  for (const [prov, el] of elitesByProv) { const c = w.provinces.cols.owner![prov]!; (elitesByCountry.get(c) ?? elitesByCountry.set(c, []).get(c)!).push(...el); }
  for (let c = 0; c < w.countries.size; c++) {
    const back = Math.floor(cc.investPool![c]! * POOL_RETURN);
    const el = elitesByCountry.get(c);
    if (!el || back <= 0) continue;
    const e2 = new Escrow(w);
    e2.take(Acct.Pool, c, back);
    const sh = apportion(back, el.map((i) => pc.a1![i]! + 1));
    el.forEach((i, j) => e2.give(Acct.Pop, i, sh[j]!));
    e2.settle();
  }
  // Elites invest part of their savings into the national investment pool.
  for (let i = 0; i < w.pops.size; i++) {
    if (pc.stratum![i] !== _STRATUM.elites) continue;
    transfer(w, Acct.Pop, i, Acct.Pool, w.provinces.cols.owner![pc.prov![i]!]!, Math.floor(Math.max(0, pc.cash![i]!) * invest[w.provinces.cols.owner![pc.prov![i]!]!]!));
  }
  return { paidByKey, valueAdded };
}

/** Average monthly wage per employed person by country and stratum (for state pay and display). */
export function updateWageRates(w: World, paidByKey: Float64Array): void {
  const nC = w.countries.size, pc = w.pops.cols, cc = w.countries.cols;
  const paid = new Float64Array(nC * _N_STRATA), emp = new Float64Array(nC * _N_STRATA);
  for (let k = 0; k < paidByKey.length; k++) {
    if (!paidByKey[k]) continue;
    const prov = Math.floor(k / _N_STRATA), s = k % _N_STRATA;
    paid[w.provinces.cols.owner![prov]! * _N_STRATA + s]! += paidByKey[k]!;
  }
  for (let i = 0; i < w.pops.size; i++) emp[w.provinces.cols.owner![pc.prov![i]!]! * _N_STRATA + pc.stratum![i]!]! += pc.employed![i]!;
  for (let c = 0; c < nC; c++) for (let s = 0; s < _N_STRATA; s++) {
    const col = cc[`wage${s}`]!, k = c * _N_STRATA + s;
    if (emp[k]! > 0 && paid[k]! > 0) col[c] = col[c]! * 0.7 + 0.3 * (paid[k]! / emp[k]!);
  }
}
