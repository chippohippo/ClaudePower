// All money is integer cents held in f64 columns. Every movement goes through these helpers so that
// budgets balance to the cent and Σmoney changes only by ledger.minted − ledger.destroyed.
import type { BudgetLine, World } from "./world";

let category: BudgetLine = "other";
/** Systems label treasury flows before moving money; every treasury flow is booked under this line. */
export function budgetLine(c: BudgetLine): void { category = c; }

export const enum Acct { Pop = 0, Building = 1, Treasury = 2, Pool = 3 }

function arr(w: World, k: Acct): Float64Array {
  switch (k) {
    case Acct.Pop: return w.pops.cols.cash as Float64Array;
    case Acct.Building: return w.buildings.cols.cash as Float64Array;
    case Acct.Treasury: return w.countries.cols.treasury as Float64Array;
    case Acct.Pool: return w.countries.cols.investPool as Float64Array;
  }
}

/** Debit/credit bookkeeping for treasuries: income/expense columns track every treasury flow except debt. */
function book(w: World, k: Acct, id: number, delta: number, debt: boolean) {
  if (k !== Acct.Treasury) return;
  const line = w.budget.cols[category];
  if (line) line[id]! += delta;
  if (debt) { w.countries.cols.debtFlow![id]! += delta; return; }
  if (delta > 0) w.countries.cols.income![id]! += delta;
  else w.countries.cols.expense![id]! -= delta;
}

export function transfer(w: World, fk: Acct, fid: number, tk: Acct, tid: number, cents: number): void {
  if (!Number.isInteger(cents)) throw new Error(`non-integer transfer ${cents}`);
  if (cents <= 0) return;
  const f = arr(w, fk), t = arr(w, tk);
  f[fid]! -= cents; t[tid]! += cents;
  book(w, fk, fid, -cents, false); book(w, tk, tid, cents, false);
}

/** Create money (borrowing, printing, debug). `debt` marks it as a loan rather than income. */
export function mint(w: World, k: Acct, id: number, cents: number, debt = false): void {
  if (!Number.isInteger(cents)) throw new Error(`non-integer mint ${cents}`);
  if (cents <= 0) return;
  arr(w, k)[id]! += cents;
  w.ledger.minted += cents;
  book(w, k, id, cents, debt);
}

/** Destroy money (interest to foreign creditors, debt repayment). */
export function burn(w: World, k: Acct, id: number, cents: number, debt = false): void {
  if (!Number.isInteger(cents)) throw new Error(`non-integer burn ${cents}`);
  if (cents <= 0) return;
  arr(w, k)[id]! -= cents;
  w.ledger.destroyed += cents;
  book(w, k, id, -cents, debt);
}

/**
 * Split integer `total` cents by weights (sum is exact). Floors each share, then hands the leftover
 * cents (fewer than the number of recipients) one each to recipients in index order — O(n), deterministic.
 */
export function apportion(total: number, weights: ArrayLike<number>): number[] {
  const n = weights.length;
  let W = 0;
  for (let i = 0; i < n; i++) if (weights[i]! > 0) W += weights[i]!;
  const out = new Array<number>(n).fill(0);
  if (W <= 0 || total <= 0) return out;
  let given = 0;
  for (let i = 0; i < n; i++) if (weights[i]! > 0) { out[i] = Math.floor((total * weights[i]!) / W); given += out[i]!; }
  let left = total - given;
  for (let i = 0; left > 0; i = (i + 1) % n) if (weights[i]! > 0) { out[i]!++; left--; }
  return out;
}

export function totalMoney(w: World): number {
  let s = 0;
  for (const k of [Acct.Pop, Acct.Building, Acct.Treasury, Acct.Pool]) {
    const a = arr(w, k), n = k === Acct.Pop ? w.pops.size : k === Acct.Building ? w.buildings.size : w.countries.size;
    for (let i = 0; i < n; i++) s += a[i]!;
  }
  return s;
}

/**
 * Escrow for many-to-many flows (market clearing, wage pools): collect exact cents from payers,
 * then pay out exactly the same total. `settle` throws if anything is left over.
 */
export class Escrow {
  private held = 0;
  constructor(private w: World) {}
  take(k: Acct, id: number, cents: number): void {
    if (cents <= 0) return;
    if (!Number.isInteger(cents)) throw new Error(`non-integer escrow ${cents}`);
    arr(this.w, k)[id]! -= cents; book(this.w, k, id, -cents, false); this.held += cents;
  }
  give(k: Acct, id: number, cents: number): void {
    if (cents <= 0) return;
    if (!Number.isInteger(cents)) throw new Error(`non-integer escrow ${cents}`);
    arr(this.w, k)[id]! += cents; book(this.w, k, id, cents, false); this.held -= cents;
  }
  get balance(): number { return this.held; }
  /** Spendable balance of an account (never lets pops, buildings or pools go negative). */
  available(k: Acct, id: number): number { return Math.max(0, arr(this.w, k)[id]!); }
  settle(): void { if (this.held !== 0) throw new Error(`escrow not settled: ${this.held}`); }
}
