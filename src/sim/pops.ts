// Pop-group helpers over the struct-of-arrays pop table.
import { col, ensureCapacity, type World } from "./world";

export const popSize = (w: World, i: number): number => {
  const p = w.pops.cols;
  return p.a0![i]! + p.a1![i]! + p.a2![i]!;
};

export interface NewPop { prov: number; culture: number; religion: number; stratum: number; a0: number; a1: number; a2: number; literacy: number; health: number; cash: number }

export function addPop(w: World, n: NewPop): number {
  const t = w.pops;
  ensureCapacity(t, t.size + 1);
  const i = t.size++;
  for (const a of Object.values(t.cols)) a[i] = 0;
  const c = t.cols;
  c.prov![i] = n.prov; c.culture![i] = n.culture; c.religion![i] = n.religion; c.stratum![i] = n.stratum;
  c.a0![i] = n.a0; c.a1![i] = n.a1; c.a2![i] = n.a2; c.female![i] = 0.5;
  c.literacy![i] = n.literacy; c.health![i] = n.health; c.cash![i] = n.cash;
  c.sol![i] = 30; c.ideoNon![i] = 1;
  return i;
}

const key = (prov: number, cul: number, rel: number, st: number) => ((prov * 4096 + cul) * 64 + rel) * 8 + st;

/** Index of pop groups by (province, culture, religion, stratum). Rebuild after adding pops. */
export function popIndex(w: World): Map<number, number> {
  const c = w.pops.cols, m = new Map<number, number>();
  for (let i = 0; i < w.pops.size; i++) m.set(key(c.prov![i]!, c.culture![i]!, c.religion![i]!, c.stratum![i]!), i);
  return m;
}

/**
 * Move `frac` of pop `from` into the group with the given key overrides, creating it if needed.
 * Moves people (by age band), cash, and averages literacy/health/sol/ideology by size.
 */
export function transferPop(w: World, idx: Map<number, number>, from: number, frac: number,
  to: { prov?: number; culture?: number; religion?: number; stratum?: number }): number {
  const c = w.pops.cols;
  if (frac <= 0) return -1;
  frac = Math.min(1, frac);
  const prov = to.prov ?? c.prov![from]!, cul = to.culture ?? c.culture![from]!, rel = to.religion ?? c.religion![from]!, st = to.stratum ?? c.stratum![from]!;
  const k = key(prov, cul, rel, st);
  let dst = idx.get(k);
  if (dst === undefined) {
    dst = addPop(w, { prov, culture: cul, religion: rel, stratum: st, a0: 0, a1: 0, a2: 0, literacy: 0, health: 0, cash: 0 });
    idx.set(k, dst);
  }
  if (dst === from) return dst;
  const cc = w.pops.cols; // ensureCapacity may have replaced arrays
  const moved = popSize(w, from) * frac, have = popSize(w, dst);
  const wt = moved + have > 0 ? moved / (moved + have) : 0;
  for (const f of ["literacy", "health", "sol", "ideoDem", "ideoFas", "ideoCom", "ideoNon", "consciousness", "militancy", "female"]) {
    const a = col(w.pops, f);
    a[dst] = a[dst]! * (1 - wt) + a[from]! * wt;
  }
  for (const f of ["a0", "a1", "a2"]) {
    const a = col(w.pops, f), m = a[from]! * frac;
    a[from] = a[from]! - m; a[dst] = a[dst]! + m;
  }
  const cash = Math.round(cc.cash![from]! * frac);
  cc.cash![from] = cc.cash![from]! - cash; cc.cash![dst] = cc.cash![dst]! + cash;
  return dst;
}

/** Remove empty pop groups (size < 1) after merging their cash into a same-province group. Keeps table compact. */
export function compactPops(w: World): void {
  const c = w.pops.cols;
  let out = 0;
  const leftover = new Map<number, number>();
  for (let i = 0; i < w.pops.size; i++) {
    if (popSize(w, i) < 1) { w.ledger.died += popSize(w, i); leftover.set(c.prov![i]!, (leftover.get(c.prov![i]!) ?? 0) + c.cash![i]!); continue; }
    if (out !== i) for (const a of Object.values(w.pops.cols)) a[out] = a[i]!;
    out++;
  }
  w.pops.size = out;
  // Return orphaned cash to the largest group in the province so money is conserved.
  if (leftover.size) {
    const best = new Map<number, number>();
    for (let i = 0; i < out; i++) { const p = c.prov![i]!; const b = best.get(p); if (b === undefined || popSize(w, i) > popSize(w, b)) best.set(p, i); }
    for (const [p, cash] of leftover) {
      const b = best.get(p);
      if (b !== undefined) c.cash![b] = c.cash![b]! + cash;
      else w.ledger.destroyed += cash;
    }
  }
}

export const MERGE_BELOW = 1000;
export const MAX_GROUPS_PER_PROVINCE = 40;

/**
 * Keep pop counts bounded: merge groups below MERGE_BELOW people (or the smallest groups beyond
 * MAX_GROUPS_PER_PROVINCE) into the largest group of the same province and stratum.
 */
export function mergeSmallPops(w: World): void {
  const c = w.pops.cols, n = w.pops.size;
  const biggest = new Map<number, number>(); // prov*8+stratum → pop
  const perProv = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const k = c.prov![i]! * 8 + c.stratum![i]!;
    const b = biggest.get(k);
    if (b === undefined || popSize(w, i) > popSize(w, b)) biggest.set(k, i);
    (perProv.get(c.prov![i]!) ?? perProv.set(c.prov![i]!, []).get(c.prov![i]!)!).push(i);
  }
  const idx = popIndex(w);
  const absorb = (i: number) => {
    const dst = biggest.get(c.prov![i]! * 8 + c.stratum![i]!)!;
    if (dst === i) return;
    transferPop(w, idx, i, 1, { culture: c.culture![dst]!, religion: c.religion![dst]! });
  };
  for (const list of perProv.values()) {
    const sorted = [...list].sort((a, b) => popSize(w, a) - popSize(w, b));
    sorted.forEach((i, rank) => {
      if (popSize(w, i) < 1) return;
      if (popSize(w, i) < MERGE_BELOW || list.length - rank > MAX_GROUPS_PER_PROVINCE) absorb(i);
    });
  }
  compactPops(w);
}
