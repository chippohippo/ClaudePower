// Production: buildings post output (sell) and input (buy) orders for the monthly market.
import { N_GOODS, PMS } from "../defs";
import { Acct } from "../money";
import type { World } from "../world";
import { toYmd } from "../date";
import type { OrderBook } from "./orders";
import { isStateBuilding } from "./labour";
// Local aliases: avoid cross-module live-binding getters in hot loops (tsx/esbuild).
const _N_GOODS = N_GOODS, _PMS = PMS;

/** Exogenous productivity growth until the tech system (M7): ~1.2%/year. */
export const ERA_GROWTH = 1.012;
export const eraProductivity = (year: number) => ERA_GROWTH ** (year - 1936);
export const provinceProductivity = (dev: number) => 0.4 + 0.6 * Math.min(2, dev / 14);

export interface ProductionOrders { inFirst: Int32Array; inCount: Int32Array; outFirst: Int32Array; outCount: Int32Array; wanted: Float64Array }

export function postProduction(w: World, book: OrderBook): ProductionOrders {
  const n = w.buildings.size, b = w.buildings.cols;
  const year = toYmd(w.date).year, era = eraProductivity(year);
  const res: ProductionOrders = { inFirst: new Int32Array(n).fill(-1), inCount: new Int32Array(n), outFirst: new Int32Array(n).fill(-1), outCount: new Int32Array(n), wanted: new Float64Array(n * _N_GOODS) };
  const mk = w.markets.cols.price!, wp = w.worldMarket.cols.price!;
  for (let i = 0; i < n; i++) {
    const t = b.type![i]!, pm = _PMS[t]![b.pm![i]!]!, prov = b.prov![i]!, country = w.provinces.cols.owner![prov]!;
    const scale = b.level![i]! * b.staffing![i]!;
    if (scale <= 0) continue;
    const prod = scale * b.inputSat![i]! * era * provinceProductivity(w.provinces.cols.development![prov]!);
    for (let g = 0; g < _N_GOODS; g++) {
      if (!pm.outputs[g]) continue;
      const o = book.sell(country, g, pm.outputs[g]! * prod, Acct.Building, i);
      if (o < 0) continue;
      if (res.outFirst[i]! < 0) res.outFirst[i] = o;
      res.outCount[i]!++;
    }
    // State buildings buy inputs from the treasury (posted by the budget system), not their own cash.
    if (isStateBuilding(t)) continue;
    let planCost = 0;
    for (let g = 0; g < _N_GOODS; g++) if (pm.inputs[g]) planCost += pm.inputs[g]! * scale * Math.min(mk[country * _N_GOODS + g]!, wp[g]!);
    const afford = planCost > 0 ? Math.min(1, b.cash![i]! / planCost) : 1;
    for (let g = 0; g < _N_GOODS; g++) {
      if (!pm.inputs[g]) continue;
      const q = pm.inputs[g]! * scale;
      res.wanted[i * _N_GOODS + g] = q;
      const o = book.buy(country, g, q * afford, Acct.Building, i, q * afford * Math.max(mk[country * _N_GOODS + g]!, wp[g]!) + 1);
      if (o < 0) continue;
      if (res.inFirst[i]! < 0) res.inFirst[i] = o;
      res.inCount[i]!++;
    }
  }
  return res;
}
