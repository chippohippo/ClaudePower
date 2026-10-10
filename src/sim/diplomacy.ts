// Diplomacy: pair table (relations, alliances, guarantees, trade, truces), blocs, claims, puppets,
// casus belli. All helpers are pure functions over the World.
import type { World } from "./world";
import { neighborsOf } from "./setup";
import { Role, findRole } from "./characters";

export const pair = (w: World, a: number, b: number) => a * w.countries.size + b;
export const rel = (w: World, a: number, b: number) => w.diplo.cols.rel![pair(w, a, b)]!;
export function setRel(w: World, a: number, b: number, v: number): void {
  const x = Math.max(-200, Math.min(200, v));
  w.diplo.cols.rel![pair(w, a, b)] = x; w.diplo.cols.rel![pair(w, b, a)] = x;
}
export const addRel = (w: World, a: number, b: number, d: number) => setRel(w, a, b, rel(w, a, b) + d);
export const allied = (w: World, a: number, b: number) => w.diplo.cols.alliance![pair(w, a, b)] === 1 || (w.countries.cols.bloc![a]! >= 0 && w.countries.cols.bloc![a] === w.countries.cols.bloc![b]);
export const guarantees = (w: World, a: number, b: number) => w.diplo.cols.guarantee![pair(w, a, b)] === 1;
export const hasTrade = (w: World, a: number, b: number) => w.diplo.cols.trade![pair(w, a, b)] === 1;
export const truceWith = (w: World, a: number, b: number) => w.diplo.cols.truce![pair(w, a, b)]! > w.date;

export function setAlliance(w: World, a: number, b: number, on: boolean): void { w.diplo.cols.alliance![pair(w, a, b)] = w.diplo.cols.alliance![pair(w, b, a)] = on ? 1 : 0; }
export function setTrade(w: World, a: number, b: number, on: boolean): void { w.diplo.cols.trade![pair(w, a, b)] = w.diplo.cols.trade![pair(w, b, a)] = on ? 1 : 0; }
export function setTruce(w: World, a: number, b: number, days: number): void { w.diplo.cols.truce![pair(w, a, b)] = w.diplo.cols.truce![pair(w, b, a)] = w.date + days; }

/** Countries sharing a land border. */
export function borders(w: World, a: number, b: number): boolean { return neighbourCountries(w, a).includes(b); }
/** Countries bordering `a` or any of its puppets (overlords project power through their puppets). */
export function neighbourCountries(w: World, a: number): number[] {
  const own = w.provinces.cols.owner!, ol = w.countries.cols.overlord!, out = new Set<number>();
  const mine = (c: number) => c === a || ol[c] === a;
  for (let p = 0; p < w.provinces.size; p++) if (mine(own[p]!)) for (const n of neighborsOf(w, p)) if (!mine(own[n]!)) out.add(own[n]!);
  return [...out];
}

export const warBetween = (w: World, a: number, b: number) => w.wars.find((x) => x.end < 0 && ((x.attackers.includes(a) && x.defenders.includes(b)) || (x.attackers.includes(b) && x.defenders.includes(a))));
export const atWar = (w: World, a: number) => w.wars.some((x) => x.end < 0 && (x.attackers.includes(a) || x.defenders.includes(a)));
export const enemies = (w: World, a: number): number[] => {
  const out = new Set<number>();
  for (const x of w.wars) if (x.end < 0) { if (x.attackers.includes(a)) x.defenders.forEach((d) => out.add(d)); if (x.defenders.includes(a)) x.attackers.forEach((d) => out.add(d)); }
  return [...out];
};

/** Casus belli against `b`: a claim on one of b's provinces, independence (b is our overlord), or ideological rivalry. */
export function casusBelli(w: World, a: number, b: number): { type: "claim" | "independence" | "ideology"; province: number } | null {
  const own = w.provinces.cols.owner!;
  const claim = w.claims[a]!.find((p) => own[p] === b);
  if (claim !== undefined) return { type: "claim", province: claim };
  if (w.countries.cols.overlord![a] === b) return { type: "independence", province: w.countries.cols.capital![a]! };
  const ha = findRole(w, a, Role.Head), hb = findRole(w, b, Role.Head);
  const ia = ha >= 0 ? w.characters.cols.ideology![ha]! : 3, ib = hb >= 0 ? w.characters.cols.ideology![hb]! : 3;
  if ((ia === 1 || ia === 2) && ia !== ib && rel(w, a, b) < -100 && borders(w, a, b)) return { type: "ideology", province: w.countries.cols.capital![b]! };
  return null;
}

/** Country strength for AI and tooltips: army strength × equipment + 20% of manpower. */
/** Army quality from industrial capacity (until the tech system adds doctrine and equipment tiers). */
export function militaryQuality(w: World, c: number): number {
  const gdpPc = w.countries.cols.gdpYear![c]! / Math.max(1, w.countries.cols.population![c]!) / 100;
  return Math.max(0.3, Math.min(2, 0.2 + gdpPc / 3000));
}
export function militaryPower(w: World, c: number): number { return (w.countries.cols.armyPower![c]! * (0.5 + 0.5 * w.countries.cols.equip![c]!) + 0.2 * w.countries.cols.manpower![c]!) * militaryQuality(w, c); }
/** Power of a side including allies, bloc members and guarantors willing to help. */
export function coalitionPower(w: World, c: number): number {
  let p = militaryPower(w, c);
  for (let k = 0; k < w.countries.size; k++) if (k !== c && (allied(w, c, k) || guarantees(w, k, c) || w.countries.cols.overlord![c] === k)) p += 0.6 * militaryPower(w, k);
  return p;
}

/** 1936 starting diplomacy: relations by ideology and history, a few alliances, guarantees and puppets. */
export function seedDiplomacy(w: World): void {
  const n = w.countries.size, tag = (t: string) => w.countryTags.indexOf(t);
  const ideo = (c: number) => { const h = findRole(w, c, Role.Head); return h >= 0 ? w.characters.cols.ideology![h]! : 3; };
  for (let a = 0; a < n; a++) {
    w.countries.cols.overlord![a] = -1; w.countries.cols.bloc![a] = -1; w.countries.cols.equip![a] = 1;
    for (let b = a + 1; b < n; b++) setRel(w, a, b, ideo(a) === ideo(b) ? 20 : ideo(a) === 3 || ideo(b) === 3 ? 0 : -30);
  }
  for (let p = 0; p < w.provinces.size; p++) w.provinces.cols.controller![p] = w.provinces.cols.owner![p]!;
  const link = (a: string, b: string, kind: "alliance" | "guarantee" | "puppet", r = 60) => {
    const x = tag(a), y = tag(b);
    if (x < 0 || y < 0) return;
    setRel(w, x, y, r);
    if (kind === "alliance") setAlliance(w, x, y, true);
    else if (kind === "guarantee") w.diplo.cols.guarantee![pair(w, x, y)] = 1;
    else w.countries.cols.overlord![y] = x;
  };
  link("FRA", "CZE", "alliance"); link("FRA", "POL", "alliance", 40); link("FRA", "GBR", "alliance", 80);
  link("SOV", "MON", "puppet", 100); link("JAP", "MAN", "puppet", 100); link("GBR", "IRQ", "guarantee"); link("GBR", "EGY", "guarantee");
  link("USA", "CAN", "guarantee", 90); link("GBR", "AST", "alliance", 100); link("GBR", "NZL", "alliance", 100); link("GBR", "CAN", "alliance", 100); link("GBR", "SAF", "alliance", 80);
  const hostile = (a: string, b: string, r: number) => { const x = tag(a), y = tag(b); if (x >= 0 && y >= 0) setRel(w, x, y, r); };
  hostile("GER", "FRA", -80); hostile("GER", "POL", -60); hostile("GER", "CZE", -70); hostile("GER", "SOV", -100); hostile("JAP", "CHI", -150); hostile("ITA", "ETH", -150); hostile("JAP", "SOV", -80);
  hostile("GER", "ITA", 40); hostile("GER", "JAP", 30);
  // Historical claims in the slice: Italy on Ethiopia, Japan on China, Germany on Czech Sudetenland region.
  const claimBorder = (a: string, b: string, via = a) => {
    const x = tag(a), y = tag(b), v = tag(via);
    if (x < 0 || y < 0 || v < 0) return;
    for (let p = 0; p < w.provinces.size; p++) if (w.provinces.cols.owner![p] === y && neighborsOf(w, p).some((q) => w.provinces.cols.owner![q] === v)) w.claims[x]!.push(p);
  };
  claimBorder("ITA", "ETH"); claimBorder("JAP", "CHI", "MAN"); claimBorder("MAN", "CHI"); claimBorder("GER", "CZE");
  // Italy's East African colonies border Ethiopia; give a claim on the capital too.
  const eth = tag("ETH"), ita = tag("ITA");
  if (eth >= 0 && ita >= 0) w.claims[ita]!.push(w.countries.cols.capital![eth]!);
}
