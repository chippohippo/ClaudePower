// Armies: stacks of 10k-man divisions drawn from military pops; movement along land adjacency.
import { STRATUM } from "../defs";
import { neighborsOf } from "../setup";
import { popIndex, popSize, transferPop } from "../pops";
import { TERRAINS } from "../schemas";
import { allied, enemies, pair } from "../diplomacy";
import { Role, findRole } from "../characters";
import { ensureCapacity, type World } from "../world";

export const DIVISION = 10_000;
export const MOVE_DAYS = 8;
export const TERRAIN_MOVE: Record<string, number> = { plains: 1, desert: 1.3, forest: 1.3, hills: 1.3, tundra: 1.5, marsh: 1.6, jungle: 1.8, mountains: 2 };

export function addArmy(w: World, country: number, prov: number, strength: number): number {
  ensureCapacity(w.armies, w.armies.size + 1);
  const i = w.armies.size++, a = w.armies.cols;
  for (const col of Object.values(a)) col[i] = 0;
  a.country![i] = country; a.prov![i] = prov; a.strength![i] = strength; a.org![i] = 1; a.target![i] = -1; a.next![i] = -1;
  a.objective![i] = -1; a.auto![i] = 1; a.general![i] = findRole(w, country, Role.HighCommand, 1); a.battle![i] = -1; a.alive![i] = 1;
  return i;
}

/** Military pops by country (soldiers available for armies). */
export function soldiers(w: World): Float64Array {
  const out = new Float64Array(w.countries.size), p = w.pops.cols;
  for (let i = 0; i < w.pops.size; i++) if (p.stratum![i] === STRATUM.military) out[w.provinces.cols.owner![p.prov![i]!]!]! += p.a1![i]!;
  return out;
}
export function fielded(w: World): Float64Array {
  const out = new Float64Array(w.countries.size), a = w.armies.cols;
  for (let i = 0; i < w.armies.size; i++) if (a.alive![i]) out[a.country![i]!]! += a.strength![i]!;
  return out;
}

/** 1936 armies: the standing military split into a capital army and border armies. */
export function seedArmies(w: World): void {
  const sold = soldiers(w);
  for (let c = 0; c < w.countries.size; c++) {
    const men = sold[c]!;
    if (men < DIVISION) continue;
    const cap = w.countries.cols.capital![c]!;
    const border: number[] = [];
    for (let p = 0; p < w.provinces.size; p++) if (w.provinces.cols.owner![p] === c && neighborsOf(w, p).some((q) => w.provinces.cols.owner![q] !== c)) border.push(p);
    const stacks = Math.min(4, 1 + Math.floor(men / (30 * DIVISION)));
    const spots = [cap, ...border.slice(0, stacks - 1)];
    spots.forEach((p) => addArmy(w, c, p, men / spots.length));
  }
  updateArmyPower(w);
}

export function updateArmyPower(w: World): void {
  const f = fielded(w);
  for (let c = 0; c < w.countries.size; c++) w.countries.cols.armyPower![c] = f[c]!;
}

/**
 * Recruit: move working-age people into the military stratum (they then draw state pay and need arms),
 * limited by the manpower pool not already fielded.
 */
export function recruit(w: World, c: number, prov: number, divisions: number): number {
  const want = divisions * DIVISION;
  const available = Math.max(0, w.countries.cols.manpower![c]! - fielded(w)[c]!);
  const men = Math.min(want, available);
  if (men < DIVISION / 2) return -1;
  const idx = popIndex(w), p = w.pops.cols;
  const donors: number[] = [];
  for (let i = 0; i < w.pops.size; i++) if (w.provinces.cols.owner![p.prov![i]!] === c && (p.stratum![i] === STRATUM.peasants || p.stratum![i] === STRATUM.workers) && p.a1![i]! > 1000) donors.push(i);
  let adults = 0;
  for (const i of donors) adults += p.a1![i]!;
  if (adults <= 0) return -1;
  for (const i of donors) transferPop(w, idx, i, Math.min(0.5, (men * (p.a1![i]! / adults)) / Math.max(1, popSize(w, i))), { stratum: STRATUM.military });
  return addArmy(w, c, prov, men);
}

/** Can country c move through province p? Own, allied, puppet/overlord, or an enemy's. */
export function passable(w: World, c: number, p: number): boolean {
  const o = w.provinces.cols.owner![p]!;
  if (o === c || allied(w, c, o) || w.countries.cols.overlord![o] === c || w.countries.cols.overlord![c] === o) return true;
  return enemies(w, c).includes(o) || w.diplo.cols.guarantee![pair(w, c, o)] === 1;
}

/** Shortest land path (BFS) from a to b for country c; [] if unreachable. */
export function path(w: World, c: number, a: number, b: number): number[] {
  if (a === b) return [];
  const prev = new Int32Array(w.provinces.size).fill(-1);
  prev[a] = a;
  const q = [a];
  for (let h = 0; h < q.length; h++) {
    const p = q[h]!;
    for (const n of neighborsOf(w, p)) {
      if (prev[n] !== -1 || !passable(w, c, n)) continue;
      prev[n] = p;
      if (n === b) { const out = [b]; let x = p; while (x !== a) { out.push(x); x = prev[x]!; } return out.reverse(); }
      q.push(n);
    }
  }
  return [];
}

/** Daily movement: armies not in battle advance toward their target one province at a time. */
export function runMovement(w: World): void {
  const a = w.armies.cols;
  for (let i = 0; i < w.armies.size; i++) {
    if (!a.alive![i] || a.battle![i]! >= 0 || a.target![i]! < 0) continue;
    if (a.next![i]! < 0) {
      const route = path(w, a.country![i]!, a.prov![i]!, a.target![i]!);
      if (!route.length) { a.target![i] = -1; continue; }
      a.next![i] = route[0]!; a.progress![i] = 0;
    }
    const terrain = TERRAINS[w.provinces.cols.terrain![a.next![i]!]!]!;
    a.progress![i]! += 1 / (MOVE_DAYS * (TERRAIN_MOVE[terrain] ?? 1));
    if (a.progress![i]! >= 1) {
      a.prov![i] = a.next![i]!; a.next![i] = -1; a.progress![i] = 0; a.entrench![i] = 0;
      if (a.prov![i] === a.target![i]) a.target![i] = -1;
    }
  }
}

/** Merge same-country armies resting in the same province (keeps stack counts sane). */
export function mergeArmies(w: World): void {
  const a = w.armies.cols, seen = new Map<number, number>();
  for (let i = 0; i < w.armies.size; i++) {
    if (!a.alive![i] || a.battle![i]! >= 0 || a.target![i]! >= 0) continue;
    const k = a.country![i]! * 100000 + a.prov![i]!;
    const j = seen.get(k);
    if (j === undefined) { seen.set(k, i); continue; }
    const tot = a.strength![i]! + a.strength![j]!;
    a.org![j] = (a.org![j]! * a.strength![j]! + a.org![i]! * a.strength![i]!) / Math.max(1, tot);
    a.strength![j] = tot; a.alive![i] = 0;
  }
  // compact dead rows
  let out = 0;
  for (let i = 0; i < w.armies.size; i++) {
    if (!a.alive![i]) continue;
    if (out !== i) for (const col of Object.values(w.armies.cols)) col[out] = col[i]!;
    out++;
  }
  w.armies.size = out;
}

/** BFS distances (in provinces) from `a` for country c over passable land; −1 = unreachable. */
export function distances(w: World, c: number, a: number): Int32Array {
  const d = new Int32Array(w.provinces.size).fill(-1);
  d[a] = 0;
  const q = [a];
  for (let h = 0; h < q.length; h++) {
    const p = q[h]!;
    for (const n of neighborsOf(w, p)) if (d[n] === -1 && passable(w, c, n)) { d[n] = d[p]! + 1; q.push(n); }
  }
  return d;
}

/** Demobilise: soldiers go back to farms and factories (military pops → peasants/workers). */
export function demobilise(w: World, c: number, men: number): void {
  if (men <= 0) return;
  const p = w.pops.cols, idx = popIndex(w), ids: number[] = [];
  let tot = 0;
  for (let i = 0; i < w.pops.size; i++) if (p.stratum![i] === STRATUM.military && w.provinces.cols.owner![p.prov![i]!] === c) { ids.push(i); tot += p.a1![i]!; }
  if (tot <= 0) return;
  const k = Math.min(0.9, men / tot);
  for (const i of ids) transferPop(w, idx, i, k, { stratum: i % 2 ? STRATUM.workers : STRATUM.peasants });
}
