// Monthly order book (transient scratch, rebuilt every month; never saved). Typed arrays for speed.
import type { Acct } from "../money";

function grow<T extends Float64Array | Int32Array>(a: T, n: number): T {
  if (a.length >= n) return a;
  const b = new (a.constructor as new (n: number) => T)(Math.max(n, a.length * 2));
  b.set(a);
  return b;
}

export class OrderBook {
  nS = 0; nB = 0;
  sCountry = new Int32Array(1024); sGood = new Int32Array(1024); sQty = new Float64Array(1024); sAcct = new Int32Array(1024); sId = new Int32Array(1024);
  sSold = new Float64Array(1024); sRevenue = new Float64Array(1024);
  bCountry = new Int32Array(4096); bGood = new Int32Array(4096); bQty = new Float64Array(4096); bAcct = new Int32Array(4096); bId = new Int32Array(4096);
  bBudget = new Float64Array(4096); bGot = new Float64Array(4096); bPaid = new Float64Array(4096);

  /** Reuse the arrays across months. */
  reset(): this { this.nS = 0; this.nB = 0; return this; }

  sell(country: number, good: number, qty: number, acct: Acct, id: number): number {
    if (!(qty > 0)) return -1;
    const i = this.nS++;
    if (i >= this.sQty.length) {
      const n = i + 1;
      this.sCountry = grow(this.sCountry, n); this.sGood = grow(this.sGood, n); this.sQty = grow(this.sQty, n); this.sAcct = grow(this.sAcct, n);
      this.sId = grow(this.sId, n); this.sSold = grow(this.sSold, n); this.sRevenue = grow(this.sRevenue, n);
    }
    this.sCountry[i] = country; this.sGood[i] = good; this.sQty[i] = qty; this.sAcct[i] = acct; this.sId[i] = id;
    this.sSold[i] = 0; this.sRevenue[i] = 0;
    return i;
  }

  /** `budget` caps total cents this order may spend. */
  buy(country: number, good: number, qty: number, acct: Acct, id: number, budget: number): number {
    if (!(qty > 0) || !(budget > 0)) return -1;
    const i = this.nB++;
    if (i >= this.bQty.length) {
      const n = i + 1;
      this.bCountry = grow(this.bCountry, n); this.bGood = grow(this.bGood, n); this.bQty = grow(this.bQty, n); this.bAcct = grow(this.bAcct, n);
      this.bId = grow(this.bId, n); this.bBudget = grow(this.bBudget, n); this.bGot = grow(this.bGot, n); this.bPaid = grow(this.bPaid, n);
    }
    this.bCountry[i] = country; this.bGood[i] = good; this.bQty[i] = qty; this.bAcct[i] = acct; this.bId[i] = id;
    this.bBudget[i] = Math.floor(budget); this.bGot[i] = 0; this.bPaid[i] = 0;
    return i;
  }
}
