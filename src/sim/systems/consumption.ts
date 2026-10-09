// Pop consumption: plan purchases tier by tier (subsistence → everyday → luxury) from savings,
// then compute standard of living (SoL 0–100) from what was actually delivered.
import { BASE_PRICE, N_GOODS, NEEDS, goodIndex } from "../defs";
import { Acct, transfer } from "../money";
import { popSize } from "../pops";
import type { World } from "../world";
import type { OrderBook } from "./orders";
import { provinceProductivity } from "./production";
// Local aliases: avoid cross-module live-binding getters in hot loops (tsx/esbuild).
const _N_GOODS = N_GOODS, _BASE_PRICE = BASE_PRICE, _NEEDS = NEEDS;

export const SPEND_RATE = 0.55;
export const CONSUMPTION_TAX = 0.05;
export const MAX_LUXURY_MULT = 25;
export const SOL_SMOOTH = 0.2;
const GRAIN = goodIndex("grain");

export interface ConsumptionPlan { first: Int32Array; tiers: Float64Array; subsGrain: Float64Array }

/** Subsistence farmers grow their own grain (per capita per month). */
export const subsistenceYield = (dev: number) => Math.min(1.1, 0.75 * provinceProductivity(dev) + 0.35);

export function planConsumption(w: World, book: OrderBook): ConsumptionPlan {
  const n = w.pops.size, p = w.pops.cols;
  const plan: ConsumptionPlan = { first: new Int32Array(n * _N_GOODS).fill(-1), tiers: new Float64Array(n * 3), subsGrain: new Float64Array(n) };
  const mk = w.markets.cols.price!, wp = w.worldMarket.cols.price!;
  const pp = new Float64Array(_N_GOODS), qty = new Float64Array(_N_GOODS);
  for (let i = 0; i < n; i++) {
    const size = popSize(w, i);
    if (size < 1) continue;
    const prov = p.prov![i]!, c = w.provinces.cols.owner![prov]!;
    for (let g = 0; g < _N_GOODS; g++) pp[g] = Math.min(mk[c * _N_GOODS + g]!, wp[g]! * 1.05);
    const subs = p.subsistence![i]! * size * subsistenceYield(w.provinces.cols.development![prov]!);
    plan.subsGrain[i] = subs;
    const budget = (Math.max(0, p.cash![i]!) * SPEND_RATE) / (1 + CONSUMPTION_TAX);
    // tier costs at plan prices
    const tierCost = [0, 0, 0];
    for (let t = 0; t < 3; t++) for (let g = 0; g < _N_GOODS; g++) {
      let q = _NEEDS[t]![g]! * size;
      if (t === 0 && g === GRAIN) q = Math.max(0, q - subs);
      tierCost[t]! += q * pp[g]!;
    }
    let rem = budget;
    const t1 = tierCost[0]! > 0 ? Math.min(1, rem / tierCost[0]!) : 1; rem -= t1 * tierCost[0]!;
    const t2 = t1 >= 1 && tierCost[1]! > 0 ? Math.min(1, rem / tierCost[1]!) : 0; rem -= t2 * tierCost[1]!;
    const k3 = t2 >= 1 && tierCost[2]! > 0 ? Math.min(MAX_LUXURY_MULT, rem / tierCost[2]!) : 0;
    plan.tiers[i * 3] = t1; plan.tiers[i * 3 + 1] = t2; plan.tiers[i * 3 + 2] = k3;
    for (let g = 0; g < _N_GOODS; g++) {
      let q1 = _NEEDS[0]![g]! * size;
      if (g === GRAIN) q1 = Math.max(0, q1 - subs);
      qty[g] = t1 * q1 + t2 * _NEEDS[1]![g]! * size + k3 * _NEEDS[2]![g]! * size;
      if (qty[g]! <= 0) continue;
      plan.first[i * _N_GOODS + g] = book.buy(c, g, qty[g]!, Acct.Pop, i, qty[g]! * Math.max(mk[c * _N_GOODS + g]!, wp[g]!) + 1);
    }
  }
  return plan;
}

/** After clearing: consumption tax, coverage per tier, and SoL. */
export function settleConsumption(w: World, book: OrderBook, plan: ConsumptionPlan): Float64Array {
  const n = w.pops.size, p = w.pops.cols;
  const famine = new Float64Array(n), fill = new Float64Array(_N_GOODS);
  for (let i = 0; i < n; i++) {
    const size = popSize(w, i);
    if (size < 1) continue;
    const c = w.provinces.cols.owner![p.prov![i]!]!;
    let paid = 0;
    for (let g = 0; g < _N_GOODS; g++) {
      const o = plan.first[i * _N_GOODS + g]!;
      if (o < 0) { fill[g] = 1; continue; }
      paid += book.bPaid[o]!;
      fill[g] = book.bQty[o]! > 0 ? book.bGot[o]! / book.bQty[o]! : 1;
    }
    transfer(w, Acct.Pop, i, Acct.Treasury, c, Math.min(Math.max(0, p.cash![i]!), Math.floor(paid * CONSUMPTION_TAX)));
    const cov = [0, 0, 0];
    for (let t = 0; t < 3; t++) {
      let need = 0, got = 0;
      for (let g = 0; g < _N_GOODS; g++) {
        const v = _NEEDS[t]![g]! * _BASE_PRICE[g]!;
        if (!v) continue;
        need += v;
        const subsCover = t === 0 && g === GRAIN ? Math.min(1, plan.subsGrain[i]! / Math.max(1e-9, _NEEDS[0]![g]! * size)) : 0;
        got += v * (subsCover + (1 - subsCover) * fill[g]!);
      }
      cov[t] = need > 0 ? got / need : 1;
    }
    const t1 = plan.tiers[i * 3]!, t2 = plan.tiers[i * 3 + 1]!, k3 = plan.tiers[i * 3 + 2]!;
    const subsOnly = plan.subsGrain[i]! / Math.max(1e-9, _NEEDS[0]![GRAIN]! * size);
    const c1 = Math.min(1, Math.max(t1, Math.min(1, subsOnly) * 0.6) * cov[0]!);
    const target = 30 * c1 + 30 * t2 * cov[1]! + 25 * Math.min(1, k3) * cov[2]! + 15 * (1 - 1 / (1 + 0.3 * Math.max(0, k3 - 1) * cov[2]!));
    p.sol![i] = p.sol![i]! + (target - p.sol![i]!) * SOL_SMOOTH;
    famine[i] = Math.max(0, 0.7 - c1) / 0.7;
  }
  return famine;
}
