// Construction: private investment (elite savings pool) and state construction, auto-managed until M3.
// Projects buy a basket of steel/tools/machinery; each delivered basket fraction advances progress.
import { BASE_PRICE, BUILDINGS, CONSTRUCTION_BASKET, N_GOODS, N_STRATA, PMS, STRATUM } from "../defs";
import { Acct } from "../money";
import { RES_COAL, RES_IRON, RES_OIL } from "../setup";
import { ensureCapacity, type World } from "../world";
import type { OrderBook } from "./orders";
import { eraProductivity, provinceProd } from "./production";
import { countryStat } from "../modifiers";
import { AUTO_BUILD } from "../setup";
import { LABOUR_SHARE } from "./wages";
import { toYmd } from "../date";
import { choosePms, jobsKey } from "./labour";
// Local aliases: avoid cross-module live-binding getters in hot loops (tsx/esbuild).
const _N_GOODS = N_GOODS, _BASE_PRICE = BASE_PRICE, _PMS = PMS, _N_STRATA = N_STRATA, _STRATUM = STRATUM, _BUILDINGS = BUILDINGS, _CONSTRUCTION_BASKET = CONSTRUCTION_BASKET;

export const MAX_PROJECTS_PER_COUNTRY = 4;
export const POOL_SPEND = 0.5;
const RES_FLAG: Record<string, number> = { oil: RES_OIL, coal: RES_COAL, iron: RES_IRON };

export interface ConstructionPlan { orders: Int32Array } // project × basket item

export function basketCost(w: World, c: number): number {
  let s = 0;
  for (const [g, q] of _CONSTRUCTION_BASKET) s += q * Math.min(w.markets.cols.price![c * _N_GOODS + g]!, w.worldMarket.cols.price![g]!);
  return s;
}

export function planConstruction(w: World, book: OrderBook): ConstructionPlan {
  startProjects(w);
  const pr = w.projects.cols, n = w.projects.size;
  const orders = new Int32Array(n * _CONSTRUCTION_BASKET.length).fill(-1);
  const mk = w.markets.cols.price!, wp = w.worldMarket.cols.price!;
  const stateShare = countryStat(w, "state_construction"), costMult = countryStat(w, "construction_cost");
  // Split each funder's monthly budget across its active projects.
  const count = new Map<string, number>();
  for (let j = 0; j < n; j++) { const k = `${pr.country![j]}:${pr.state![j]}`; count.set(k, (count.get(k) ?? 0) + 1); }
  for (let j = 0; j < n; j++) {
    const c = pr.country![j]!, state = pr.state![j]! === 1;
    const funds = state ? Math.max(0, w.countries.cols.treasury![c]! - 3 * w.countries.cols.expense![c]!) * (pr.levels![j]! > 0 && (w.countries.cols.automation![c]! & AUTO_BUILD) ? stateShare[c]! : 0.5) : w.countries.cols.investPool![c]! * POOL_SPEND;
    const budget = funds / count.get(`${c}:${pr.state![j]}`)!;
    const remaining = 1 - pr.progress![j]!, lv = pr.levels![j]!;
    const unit = basketCost(w, c) * lv * costMult[c]!;
    const frac = unit > 0 ? Math.min(remaining, budget / unit) : 0;
    _CONSTRUCTION_BASKET.forEach(([g, q], k) => {
      const qty = q * lv * frac * costMult[c]!;
      orders[j * _CONSTRUCTION_BASKET.length + k] = book.buy(c, g, qty, state ? Acct.Treasury : Acct.Pool, c, qty * Math.max(mk[c * _N_GOODS + g]!, wp[g]!) + 1);
    });
  }
  return { orders };
}

export function settleConstruction(w: World, book: OrderBook, plan: ConstructionPlan): void {
  const pr = w.projects.cols, costMult = countryStat(w, "construction_cost");
  let basketVal = 0;
  for (const [g, q] of _CONSTRUCTION_BASKET) basketVal += q * _BASE_PRICE[g]!;
  for (let j = 0; j < w.projects.size; j++) {
    let got = 0;
    _CONSTRUCTION_BASKET.forEach(([g], k) => { const o = plan.orders[j * _CONSTRUCTION_BASKET.length + k]!; if (o >= 0) got += book.bGot[o]! * _BASE_PRICE[g]!; });
    pr.progress![j]! += got / (basketVal * pr.levels![j]! * costMult[pr.country![j]!]!);
  }
  // Complete finished projects.
  let out = 0;
  for (let j = 0; j < w.projects.size; j++) {
    if (pr.progress![j]! >= 0.999) { addLevels(w, pr.prov![j]!, pr.type![j]!, pr.levels![j]!); continue; }
    if (out !== j) for (const a of Object.values(w.projects.cols)) a[out] = a[j]!;
    out++;
  }
  w.projects.size = out;
}

function addLevels(w: World, prov: number, type: number, n: number): void {
  const b = w.buildings.cols;
  for (let i = 0; i < w.buildings.size; i++) if (b.prov![i] === prov && b.type![i] === type) { b.level![i]! += n; return; }
  ensureCapacity(w.buildings, w.buildings.size + 1);
  const i = w.buildings.size++;
  const nb = w.buildings.cols;
  for (const a of Object.values(nb)) a[i] = 0;
  nb.prov![i] = prov; nb.type![i] = type; nb.level![i] = n; nb.staffing![i] = 0; nb.inputSat![i] = 1;
  choosePms(w, i);
}

/** Expected monthly profit per level of a building type at current national prices. */
function expectedProfit(w: World, c: number, type: number, prov: number): number {
  const pms = _PMS[type]!, year = toYmd(w.date).year;
  let pm = pms[0]!;
  for (const p of pms) if (p.year <= year) pm = p;
  const mk = w.markets.cols.price!, wp = w.worldMarket.cols.price!;
  const prod = eraProductivity(year) * provinceProd(w, prov);
  let out = 0, inp = 0;
  for (let g = 0; g < _N_GOODS; g++) {
    const sell = Math.max(mk[c * _N_GOODS + g]!, wp[g]! * 0.9);
    out += pm.outputs[g]! * prod * sell;
    inp += pm.inputs[g]! * Math.min(mk[c * _N_GOODS + g]!, wp[g]!);
  }
  return (out - inp) * (1 - LABOUR_SHARE);
}

/** Choose new projects: the best expected return in the province with most idle labour for its jobs. */
function startProjects(w: World): void {
  const nC = w.countries.size, pr = w.projects.cols, cc = w.countries.cols;
  const active = new Int32Array(nC);
  for (let j = 0; j < w.projects.size; j++) active[pr.country![j]!]!++;
  // idle labour per (province, stratum): working-age not employed (subsistence peasants count)
  const idle = new Float64Array(w.provinces.size * _N_STRATA);
  for (let i = 0; i < w.pops.size; i++) idle[jobsKey(w.pops.cols.prov![i]!, w.pops.cols.stratum![i]!)]! += w.pops.cols.a1![i]! - w.pops.cols.employed![i]!;
  const lit = new Float64Array(w.provinces.size), health = new Float64Array(w.provinces.size), adults = new Float64Array(w.provinces.size);
  for (let i = 0; i < w.pops.size; i++) {
    const p = w.pops.cols.prov![i]!, s = w.pops.cols.a1![i]!;
    adults[p]! += s; lit[p]! += w.pops.cols.literacy![i]! * s; health[p]! += w.pops.cols.health![i]! * s;
  }
  const publicValue = (p: number, effect?: string) => adults[p]! ? 0.02 * (1 - (effect === "literacy" ? lit[p]! : health[p]!) / adults[p]!) : 0;
  const provsOf: number[][] = Array.from({ length: nC }, () => []);
  for (let p = 0; p < w.provinces.size; p++) provsOf[w.provinces.cols.owner![p]!]!.push(p);
  for (let c = 0; c < nC; c++) {
    if (active[c]! >= MAX_PROJECTS_PER_COUNTRY) continue;
    const cost = basketCost(w, c);
    for (const state of [0, 1]) {
      if (state === 1 && !(cc.automation![c]! & AUTO_BUILD)) continue; // player builds by hand
      if (active[c]! >= MAX_PROJECTS_PER_COUNTRY) break;
      const funds = state ? cc.treasury![c]! - 3 * cc.expense![c]! : cc.investPool![c]!;
      if (funds < cost * 0.25) continue;
      let best = -1, bestProv = -1, bestScore = 0, bestLabour = 0;
      for (let t = 0; t < _BUILDINGS.length; t++) {
        const def = _BUILDINGS[t]!;
        if ((def.owner === "state") !== (state === 1) && !(state === 1 && def.owner === "private")) continue;
        const main = mainStratum(t);
        for (const p of provsOf[c]!) {
          if (def.resource && !(w.provinces.cols.res![p]! & RES_FLAG[def.resource]!)) continue;
          const labour = idle[jobsKey(p, main)]! + 0.3 * idle[jobsKey(p, _STRATUM.peasants)]! + (main !== _STRATUM.workers ? 0.2 * idle[jobsKey(p, _STRATUM.workers)]! : 0);
          if (labour < 500) continue;
          const roi = def.owner === "state" ? publicValue(p, def.effect) : expectedProfit(w, c, t, p) / cost;
          const score = roi * Math.min(1, labour / 5000);
          if (score > bestScore) { bestScore = score; best = t; bestProv = p; bestLabour = labour; }
        }
      }
      if (best < 0 || (state === 0 && bestScore < 0.004)) continue;
      ensureCapacity(w.projects, w.projects.size + 1);
      const j = w.projects.size++;
      const pc = w.projects.cols;
      // Size: absorb up to half the idle labour, limited to what ~4 months of funding can buy.
      const perLevel = _PMS[best]![0]!.jobs[mainStratum(best)]!;
      const levels = Math.max(1, Math.min(Math.floor((0.5 * bestLabour) / perLevel), Math.floor((4 * funds * (state ? 0.3 : POOL_SPEND)) / cost)));
      pc.country![j] = c; pc.prov![j] = bestProv; pc.type![j] = best; pc.progress![j] = 0; pc.state![j] = state; pc.levels![j] = levels;
      active[c]!++;
    }
  }
}

function mainStratum(type: number): number {
  const jobs = _PMS[type]![0]!.jobs;
  let best = 0;
  for (let s = 0; s < _N_STRATA; s++) if (jobs[s]! > jobs[best]!) best = s;
  return best;
}
