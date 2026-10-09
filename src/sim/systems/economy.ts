// Monthly economy pipeline, split across the fixed tick slots (§3.5):
// production → markets → wages & pop income → consumption & SoL → state budget → construction.
// Demand (pops, state, construction) is planned from last month's money before markets clear.
import type { World } from "../world";
import { toYmd } from "../date";
import { OrderBook } from "./orders";
import { choosePms, runLabour } from "./labour";
import { postProduction, type ProductionOrders } from "./production";
import { clearMarkets } from "./market";
import { settleBuildings, updateWageRates } from "./wages";
import { planConsumption, settleConsumption, type ConsumptionPlan } from "./consumption";
import { monetaryPolicy, planState, settleBudget, updateInflation } from "./budget";
import { planConstruction, settleConstruction, type ConstructionPlan } from "./construction";
import { publicBonuses, runDemography } from "./demography";
import { runMobility } from "./mobility";
import { updateStats } from "./stats";

interface Month {
  book: OrderBook; jobs: Float64Array; filled: Float64Array; po: ProductionOrders;
  cons: ConsumptionPlan; cons2?: ConstructionPlan; famine?: Float64Array;
}
let m: Month | null = null;
const sharedBook = new OrderBook();
const cur = () => { if (!m) throw new Error("economy month not started"); return m; };

export function production(w: World): void {
  const cc = w.countries.cols;
  for (let c = 0; c < w.countries.size; c++) { cc.income![c] = 0; cc.expense![c] = 0; cc.debtFlow![c] = 0; }
  for (const a of Object.values(w.budget.cols)) a.fill(0);
  if (toYmd(w.date).month === 1) choosePms(w);
  const { jobs, filled } = runLabour(w);
  const book = sharedBook.reset();
  const po = postProduction(w, book);
  m = { book, jobs, filled, po, cons: planConsumption(w, book) };
}

export function markets(w: World): void {
  const s = cur();
  planState(w, s.book);
  s.cons2 = planConstruction(w, s.book);
  clearMarkets(w, s.book);
}

export function wagesIncome(w: World): void {
  const s = cur();
  const { paidByKey, valueAdded } = settleBuildings(w, s.book, s.po, s.jobs, s.filled);
  updateWageRates(w, paidByKey);
  for (let c = 0; c < w.countries.size; c++) w.countries.cols.gdpAcc![c]! += Math.max(0, valueAdded[c]!);
}

export function consumptionSol(w: World): void {
  const s = cur();
  s.famine = settleConsumption(w, s.book, s.cons);
}

export function stateBudget(w: World): void {
  const s = cur();
  const before = Float64Array.from(w.countries.cols.expense!.subarray(0, w.countries.size));
  settleBudget(w, s.jobs, s.filled);
  // Public payroll is part of GDP (government value added).
  for (let c = 0; c < w.countries.size; c++) w.countries.cols.gdpAcc![c]! += w.countries.cols.expense![c]! - before[c]!;
  updateInflation(w);
  monetaryPolicy(w);
}

export function construction(w: World): void {
  const s = cur();
  settleConstruction(w, s.book, s.cons2!);
}

/** Demography (smoothed monthly) and mobility run after the market month closes. */
export function demographyMonthly(w: World): void {
  const s = cur();
  runDemography(w, s.famine!, publicBonuses(w, w.provinces.cols.population as Float64Array));
  runMobility(w, s.jobs);
  updateStats(w);
  m = null;
}
