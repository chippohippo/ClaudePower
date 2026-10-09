// Market clearing: national markets first, residual demand/supply cleared on the world market.
// Price = base × priceLevel × clamp((demand/supply)^0.6, 0.25, 4), smoothed to ±10%/month.
import { BASE_PRICE, N_GOODS } from "../defs";
import { Escrow, apportion, type Acct } from "../money";
import type { World } from "../world";
import type { OrderBook } from "./orders";
// Local aliases: avoid cross-module live-binding getters in hot loops (tsx/esbuild).
const _N_GOODS = N_GOODS, _BASE_PRICE = BASE_PRICE;

export const PRICE_ELASTICITY = 0.6;
export const PRICE_MIN = 0.25, PRICE_MAX = 4;
export const PRICE_SMOOTH = 0.1;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Clear one set of buy/sell order indices at price p. Returns totals. */
function clear(w: World, book: OrderBook, buys: number[], sells: number[], p: number, residual: boolean) {
  let S = 0, D = 0;
  for (const s of sells) S += book.sQty[s]! - (residual ? book.sSold[s]! : 0);
  for (const b of buys) D += book.bQty[b]! - (residual ? book.bGot[b]! : 0);
  if (S <= 0 || D <= 0 || p <= 0) return { S, D };
  const fillB = Math.min(1, S / D);
  const esc = new Escrow(w);
  let got = 0;
  for (const b of buys) {
    const want = (book.bQty[b]! - (residual ? book.bGot[b]! : 0)) * fillB;
    const budgetLeft = book.bBudget[b]! - book.bPaid[b]!;
    const pay = Math.max(0, Math.min(Math.floor(want * p), budgetLeft, esc.available(book.bAcct[b]! as Acct, book.bId[b]!)));
    if (pay <= 0) continue;
    esc.take(book.bAcct[b]! as Acct, book.bId[b]!, pay);
    const q = pay / p;
    book.bPaid[b]! += pay; book.bGot[b]! += q; got += q;
  }
  const remaining = sells.map((s) => book.sQty[s]! - (residual ? book.sSold[s]! : 0));
  const revenue = apportion(esc.balance, remaining);
  sells.forEach((s, j) => {
    esc.give(book.sAcct[s]! as Acct, book.sId[s]!, revenue[j]!);
    book.sRevenue[s]! += revenue[j]!;
    book.sSold[s]! += (got * remaining[j]!) / S;
  });
  esc.settle();
  return { S, D };
}

export function clearMarkets(w: World, book: OrderBook): void {
  const nC = w.countries.size, nM = nC * _N_GOODS;
  const buys: number[][] = Array.from({ length: nM }, () => []), sells: number[][] = Array.from({ length: nM }, () => []);
  for (let b = 0; b < book.nB; b++) buys[book.bCountry[b]! * _N_GOODS + book.bGood[b]!]!.push(b);
  for (let s = 0; s < book.nS; s++) sells[book.sCountry[s]! * _N_GOODS + book.sGood[s]!]!.push(s);
  const m = w.markets.cols, pl = w.countries.cols.priceLevel!;

  for (let k = 0; k < nM; k++) {
    const { S, D } = clear(w, book, buys[k]!, sells[k]!, m.price![k]!, false);
    m.supply![k] = S; m.demand![k] = D;
  }
  // World market on residuals.
  const wm = w.worldMarket.cols;
  for (let g = 0; g < _N_GOODS; g++) {
    const wb: number[] = [], ws: number[] = [];
    for (let c = 0; c < nC; c++) { wb.push(...buys[c * _N_GOODS + g]!); ws.push(...sells[c * _N_GOODS + g]!); }
    const { S, D } = clear(w, book, wb, ws, wm.price![g]!, true);
    wm.supply![g] = S; wm.demand![g] = D;
  }
  // Record trade volumes and update prices.
  for (let k = 0; k < nM; k++) {
    let sold = 0, bought = 0;
    for (const s of sells[k]!) sold += book.sSold[s]!;
    for (const b of buys[k]!) bought += book.bGot[b]!;
    m.sold![k] = sold; m.bought![k] = bought;
    const g = k % _N_GOODS, c = (k - g) / _N_GOODS;
    m.price![k] = nextPrice(m.price![k]!, _BASE_PRICE[g]! * pl[c]!, m.demand![k]!, m.supply![k]!);
  }
  let totS = new Float64Array(_N_GOODS), totD = new Float64Array(_N_GOODS);
  for (let k = 0; k < nM; k++) { totS[k % _N_GOODS]! += m.supply![k]!; totD[k % _N_GOODS]! += m.demand![k]!; }
  for (let g = 0; g < _N_GOODS; g++) wm.price![g] = nextPrice(wm.price![g]!, _BASE_PRICE[g]!, totD[g]!, totS[g]!);
  totS = totD = new Float64Array(0);
}

export function nextPrice(p: number, base: number, D: number, S: number): number {
  let target: number;
  if (S <= 0 && D <= 0) target = base;
  else if (S <= 0) target = base * PRICE_MAX;
  else target = base * clamp((D / S) ** PRICE_ELASTICITY, PRICE_MIN, PRICE_MAX);
  const next = clamp(target, p * (1 - PRICE_SMOOTH), p * (1 + PRICE_SMOOTH));
  return clamp(next, base * PRICE_MIN, base * PRICE_MAX);
}
