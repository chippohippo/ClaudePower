// Economy sanity: no negative stocks, prices in clamp, budgets balance to the cent,
// money changes only through the ledger, population changes only through births/deaths.
import { beforeAll, expect, test } from "vitest";
import { loadContent } from "../../src/sim/content";
import { createWorld } from "../../src/sim/setup";
import { tickDay } from "../../src/sim/tick";
import { toYmd } from "../../src/sim/date";
import { totalMoney } from "../../src/sim/money";
import { popSize } from "../../src/sim/pops";
import { BASE_PRICE, N_GOODS } from "../../src/sim/defs";
import { PRICE_MAX, PRICE_MIN } from "../../src/sim/systems/market";
import type { World } from "../../src/sim/world";

const failures: string[] = [];
let w: World;
const worldPop = (w: World) => { let s = 0; for (let i = 0; i < w.pops.size; i++) s += popSize(w, i); return s; };

beforeAll(() => {
  w = createWorld(7, loadContent()).world;
  const money0 = totalMoney(w), pop0 = worldPop(w);
  for (let m = 0; m < 30; m++) {
    const treas0 = Float64Array.from(w.countries.cols.treasury!.subarray(0, w.countries.size));
    const start = toYmd(w.date).month;
    while (toYmd(w.date).month === start) tickDay(w);
    const cc = w.countries.cols;
    for (let c = 0; c < w.countries.size; c++) {
      const delta = cc.treasury![c]! - treas0[c]!, booked = cc.income![c]! - cc.expense![c]! + cc.debtFlow![c]!;
      if (delta !== booked) failures.push(`budget ${w.countryTags[c]} month ${m}: Δ${delta} vs booked ${booked}`);
      if (!Number.isInteger(cc.treasury![c]!)) failures.push(`treasury not integer cents ${w.countryTags[c]}`);
      if (cc.investPool![c]! < 0) failures.push(`negative pool ${w.countryTags[c]}`);
    }
    const money = totalMoney(w);
    if (money - money0 !== w.ledger.minted - w.ledger.destroyed) failures.push(`money month ${m}: Δ${money - money0} vs ledger ${w.ledger.minted - w.ledger.destroyed}`);
    for (let i = 0; i < w.pops.size; i++) {
      if (w.pops.cols.cash![i]! < 0) failures.push(`negative pop cash ${i}`);
      for (const k of ["a0", "a1", "a2"]) if (w.pops.cols[k]![i]! < 0) failures.push(`negative ${k} ${i}`);
    }
    for (let i = 0; i < w.buildings.size; i++) if (w.buildings.cols.cash![i]! < 0) failures.push(`negative building cash ${i}`);
    for (let k = 0; k < w.markets.size; k++) {
      const g = k % N_GOODS, c = (k - g) / N_GOODS, base = BASE_PRICE[g]! * w.countries.cols.priceLevel![c]!;
      const p = w.markets.cols.price![k]!;
      if (p < base * PRICE_MIN * 0.999 || p > base * PRICE_MAX * 1.001) failures.push(`price out of clamp ${k}`);
    }
    const pop = worldPop(w), expected = pop0 + w.ledger.born - w.ledger.died;
    if (Math.abs(pop - expected) > 1e-6 * pop0) failures.push(`population month ${m}: ${pop} vs ${expected}`);
  }
}, 120_000);

test("economy sanity over 30 months", () => {
  expect(failures.slice(0, 10)).toEqual([]);
});
