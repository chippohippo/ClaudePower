// Interest groups (monthly): clout from pops, approval from laws/privileges/SoL/cabinet, radicalism,
// strikes, and PP effects. Design test: industrialising while ignoring Trade Unions must bite.
import { IGS, IG_IDEOLOGY, IG_POWER, IG_STRATA, N_IGS, hasPrivilege, igRow, lawScore } from "../igs";
import { STRATUM } from "../defs";
import { popSize } from "../pops";
import { Role, chronicle, findRole } from "../characters";
import type { World } from "../world";

export const APPROVAL_SMOOTH = 0.08, RADICALISM_SMOOTH = 0.04;
export const LAW_WEIGHT = 12, PRIVILEGE_BONUS = 30, OTHER_PRIVILEGE_MALUS = 4, CABINET_BONUS = 12, IDEOLOGY_MATCH = 10;
export const STRIKE_RADICALISM = 40, STRIKE_CLOUT = 0.08;
export const DEMAND_CLOUT = 0.15, DEMAND_WEIGHT = 160;
const _STRATUM = STRATUM, _N = N_IGS;
const IRRELIGIOUS = new Set(["Irreligious"]);

/** Political weight of a pop: size × wealth factor × (0.3 + literacy). */
export function politicalWeight(size: number, cashPerCap: number, meanCashPerCap: number, literacy: number): number {
  const wealth = meanCashPerCap > 0 ? Math.min(5, Math.sqrt(Math.max(0, cashPerCap) / meanCashPerCap)) : 1;
  return size * (0.3 + wealth) * (0.3 + literacy);
}

export interface IgMonth { members: Float64Array /* row → weight */; provMembers: Float64Array /* prov*N + ig */; memberSol: Float64Array }

export function computeClout(w: World): IgMonth {
  const r = computeCloutInner(w);
  lastMonth = r;
  return r;
}
function computeCloutInner(w: World): IgMonth {
  const nC = w.countries.size, p = w.pops.cols, n = w.pops.size;
  const members = new Float64Array(nC * _N), memberSol = new Float64Array(nC * _N), provMembers = new Float64Array(w.provinces.size * _N);
  const cashSum = new Float64Array(nC), popSum = new Float64Array(nC);
  for (let i = 0; i < n; i++) { const c = w.provinces.cols.owner![p.prov![i]!]!; cashSum[c]! += Math.max(0, p.cash![i]!); popSum[c]! += popSize(w, i); }
  const devout = IGS.findIndex((g) => g.religious);
  const att = new Float64Array(_N);
  for (let i = 0; i < n; i++) {
    const size = popSize(w, i);
    if (size < 1) continue;
    const prov = p.prov![i]!, c = w.provinces.cols.owner![prov]!, st = p.stratum![i]!;
    const wgt = politicalWeight(size, p.cash![i]! / size, cashSum[c]! / Math.max(1, popSum[c]!), p.literacy![i]!);
    let tot = 0;
    for (let g = 0; g < _N; g++) { att[g] = IG_STRATA[g]![st]!; tot += att[g]!; }
    const norm = tot;
    if (devout >= 0 && !IRRELIGIOUS.has(w.religions[p.religion![i]!] ?? "")) { const d = 0.25 * (1 - p.literacy![i]!); att[devout]! += d; tot += d; }
    if (tot <= 0) continue;
    for (let g = 0; g < _N; g++) {
      if (!att[g]) continue;
      const m = ((wgt * att[g]!) / tot) * IG_POWER[g]!, r = igRow(c, g);
      members[r]! += m; memberSol[r]! += m * p.sol![i]!; provMembers[prov * _N + g]! += m;
    }
  }
  const ic = w.igs.cols;
  for (let c = 0; c < nC; c++) {
    let total = 0;
    for (let g = 0; g < _N; g++) total += members[igRow(c, g)]!;
    for (let g = 0; g < _N; g++) {
      const r = igRow(c, g);
      ic.clout![r] = total > 0 ? members[r]! / total : 0;
      memberSol[r] = members[r]! > 0 ? memberSol[r]! / members[r]! : 45;
    }
  }
  return { members, provMembers, memberSol };
}

/** Approval target parts for one IG (sum clamps to −100…+100); shown in tooltips. */
/** Per-country: head's ideology and which IGs sit in government (one pass over characters). */
export function govInfo(w: World): { headIdeo: Int32Array; inGov: Uint8Array } {
  const n = w.countries.size, headIdeo = new Int32Array(n).fill(-1), inGov = new Uint8Array(n * _N), cc = w.characters.cols;
  for (let i = 0; i < w.characters.size; i++) {
    if (!cc.alive![i]) continue;
    const c = cc.country![i]!, r = cc.role![i]!;
    if (r === Role.Head) headIdeo[c] = cc.ideology![i]!;
    if ((r === Role.Cabinet || r === Role.Head) && cc.ig![i]! >= 0) inGov[c * _N + cc.ig![i]!] = 1;
  }
  return { headIdeo, inGov };
}

export function approvalParts(w: World, c: number, g: number, memberSol: number, gi = govInfo(w)): { label: string; value: number }[] {
  let others = 0;
  for (let h = 0; h < _N; h++) if (h !== g && hasPrivilege(w, c, h)) others++;
  const headIdeo = gi.headIdeo[c]!, inGov = gi.inGov[c * _N + g] === 1;
  const parts = [
    { label: "Laws in force", value: LAW_WEIGHT * lawScore(w, c, g) },
    { label: "Own privilege", value: hasPrivilege(w, c, g) ? PRIVILEGE_BONUS : 0 },
    { label: "Privileges for rivals", value: -OTHER_PRIVILEGE_MALUS * others },
    { label: "Members' standard of living", value: 0.5 * (memberSol - 50) },
    // Growing IGs demand their privilege: ignoring a big group (e.g. unions during industrialisation) hurts.
    { label: "Unmet demand for privilege", value: hasPrivilege(w, c, g) ? 0 : -DEMAND_WEIGHT * Math.max(0, w.igs.cols.clout![igRow(c, g)]! - DEMAND_CLOUT) },
    { label: "Represented in government", value: inGov ? CABINET_BONUS : 0 },
    { label: "Head's ideology", value: headIdeo >= 0 ? (headIdeo === IG_IDEOLOGY[g] ? IDEOLOGY_MATCH : -IDEOLOGY_MATCH / 2) : 0 },
    { label: "Co-opted / suppressed (fading)", value: w.igs.cols.favour![igRow(c, g)]! },
  ];
  return parts.map((x) => ({ label: x.label, value: Math.round(x.value * 10) / 10 }));
}

export function runIgs(w: World): void {
  const m = computeClout(w), ic = w.igs.cols, cc = w.countries.cols, nC = w.countries.size, gi = govInfo(w);
  for (let c = 0; c < nC; c++) {
    let ppDelta = 0;
    for (let g = 0; g < _N; g++) {
      const r = igRow(c, g);
      const target = Math.max(-100, Math.min(100, approvalParts(w, c, g, m.memberSol[r]!, gi).reduce((s, x) => s + x.value, 0)));
      ic.approval![r] = ic.approval![r]! + (target - ic.approval![r]!) * APPROVAL_SMOOTH;
      ic.favour![r] = ic.favour![r]! * 0.95;
      // Radicalism follows anger, scaled by how many members the IG has (big unhappy IGs radicalise).
      const radTarget = Math.max(0, Math.min(100, -ic.approval![r]! * (0.6 + 2 * ic.clout![r]!)));
      ic.radicalism![r] = ic.radicalism![r]! + (radTarget - ic.radicalism![r]!) * RADICALISM_SMOOTH;
      // Loyal IGs lend political power; angry ones drain it (scaled by clout).
      ppDelta += (ic.clout![r]! * ic.approval![r]!) / 25;
      // Strikes and protests from radical IGs with real weight.
      const was = ic.strikes![r]!;
      ic.strikes![r] = ic.radicalism![r]! > STRIKE_RADICALISM && ic.clout![r]! > STRIKE_CLOUT ? Math.min(1, (ic.radicalism![r]! - STRIKE_RADICALISM) / 40) : 0;
      if (was === 0 && ic.strikes![r]! > 0) chronicle(w, c, "strike", `${IGS[g]!.name} ${g === TU ? "call a general strike" : "take to the streets"} (radicalism ${ic.radicalism![r]!.toFixed(0)}).`);
    }
    cc.pp![c] = Math.max(0, cc.pp![c]! + ppDelta);
  }
  // Strikes raise unrest where the IG's members live (unrest already cuts output).
  const pc = w.provinces.cols;
  for (let p = 0; p < w.provinces.size; p++) {
    const c = pc.owner![p]!;
    let tot = 0, hit = 0;
    for (let g = 0; g < _N; g++) { const mem = m.provMembers[p * _N + g]!; tot += mem; hit += mem * ic.strikes![igRow(c, g)]!; }
    if (tot > 0 && hit > 0) pc.unrest![p] = Math.min(10, pc.unrest![p]! + 4 * (hit / tot));
  }
  lastMonth = m;
}
const TU = IGS.findIndex((g) => g.id === "trade_unions");
let lastMonth: IgMonth | null = null;
export const lastIgMonth = () => lastMonth;
void _STRATUM;
