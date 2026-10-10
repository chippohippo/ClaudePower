// Migration (yearly): internal toward higher SoL and jobs; international toward rich, open countries.
// Migrants carry their savings; people are conserved (tracked in the ledger).
import { popIndex, popSize, transferPop } from "../pops";
import type { World } from "../world";
import { STRATUM } from "../defs";
import { countryStat } from "../modifiers";
// Local aliases: avoid cross-module live-binding getters in hot loops (tsx/esbuild).
const _STRATUM = STRATUM;

export const INTERNAL_RATE = 0.02;      // per year at a 50-point SoL gap
export const INTERNATIONAL_RATE = 0.0012;
export const OPEN_REGIONS = new Set([1, 2, 5]); // the Americas and Oceania start open to immigration

export function runMigration(w: World): void {
  const p = w.pops.cols, nP = w.provinces.size, nC = w.countries.size;
  const provSol = new Float64Array(nP), provPop = new Float64Array(nP), provUnemp = new Float64Array(nP), provAdults = new Float64Array(nP);
  for (let i = 0; i < w.pops.size; i++) {
    const pr = p.prov![i]!, s = popSize(w, i);
    provSol[pr]! += p.sol![i]! * s; provPop[pr]! += s;
    provAdults[pr]! += p.a1![i]!;
    if (p.stratum![i] !== _STRATUM.peasants) provUnemp[pr]! += p.a1![i]! - p.employed![i]!;
  }
  const attract = new Float64Array(nP);
  for (let pr = 0; pr < nP; pr++) {
    if (provPop[pr]! > 0) provSol[pr] = provSol[pr]! / provPop[pr]!;
    attract[pr] = provSol[pr]! - 60 * (provAdults[pr]! > 0 ? provUnemp[pr]! / provAdults[pr]! : 0);
  }
  // Best destination per country (internal) and the international destination list.
  const bestProv = new Int32Array(nC).fill(-1);
  for (let pr = 0; pr < nP; pr++) {
    const c = w.provinces.cols.owner![pr]!;
    if (bestProv[c]! < 0 || attract[pr]! > attract[bestProv[c]!]!) bestProv[c] = pr;
  }
  const countrySol = w.countries.cols.sol!;
  const destinations: number[] = [];
  const imm = countryStat(w, "immigration");
  for (let c = 0; c < nC; c++) {
    const cap = w.countries.cols.capital![c]!;
    const open = imm[c]! >= 1 || (imm[c]! > -0.5 && cap >= 0 && OPEN_REGIONS.has(w.provinces.cols.region![cap]!));
    if (open && countrySol[c]! > 55 && bestProv[c]! >= 0) destinations.push(c);
  }
  const idx = popIndex(w), n = w.pops.size;
  for (let i = 0; i < n; i++) {
    const pr = p.prov![i]!, c = w.provinces.cols.owner![pr]!, to = bestProv[c]!;
    if (to >= 0 && to !== pr) {
      const gap = attract[to]! - attract[pr]!;
      if (gap > 5) transferPop(w, idx, i, INTERNAL_RATE * Math.min(1, gap / 50), { prov: to });
    }
    if (!destinations.length || countrySol[c]! > 45) continue;
    // International: choose the destination with the best SoL gap (deterministic).
    let d = -1, dg = 0;
    for (const dc of destinations) { const g = countrySol[dc]! - countrySol[c]!; if (dc !== c && g > dg) { dg = g; d = dc; } }
    if (d < 0 || dg < 20) continue;
    const before = popSize(w, i);
    transferPop(w, idx, i, INTERNATIONAL_RATE * Math.min(1, dg / 50) * (0.5 + p.literacy![i]!), { prov: bestProv[d]! });
    const moved = before - popSize(w, i);
    w.ledger.migratedOut += moved; w.ledger.migratedIn += moved;
  }
}
