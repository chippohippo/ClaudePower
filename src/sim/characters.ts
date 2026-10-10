// Characters: heads of state, cabinet (4), high command (3), IG leaders and a candidate pool.
// Stats and traits feed the modifier system (source "char:<role>:<slot>"), so tooltips explain them.
import traitsJson from "../../data/traits.json";
import namesJson from "../../data/names.json";
import { NamesFile, TraitsFile, IDEOLOGIES } from "./schemas";
import { addModifier, removeModifiersWhere } from "./modifiers";
import { ensureCapacity, type World } from "./world";
import { Rng } from "./rng";
import { fromYmd, toYmd } from "./date";

export const TRAITS = TraitsFile.parse(traitsJson);
const NAMES = NamesFile.parse(namesJson) as Record<string, { first: string[]; last: string[] } | Record<string, string>>;
/** Set by the IG module (avoids an import cycle). */
let IG_IDEOLOGY_OF: (ig: number) => number = () => 3;
export const setIgIdeologyLookup = (f: (ig: number) => number) => { IG_IDEOLOGY_OF = f; };
export const traitIndex = (id: string) => TRAITS.findIndex((t) => t.id === id);

export const enum Role { Pool = 0, Head = 1, Cabinet = 2, HighCommand = 3, IgLeader = 4, Retired = 5 }
export const ROLE_NAMES = ["Candidate", "Head of Government", "Minister", "High Command", "IG Leader", "Retired"];
export const CABINET_SLOTS = ["Finance", "Interior", "Foreign Affairs", "Economy"] as const;
export const HIGH_COMMAND_SLOTS = ["Chief of Staff", "Army", "Navy"] as const;
export const POOL_SIZE = 6;

export interface NewCharacter {
  name: string; country: number; role: Role; slot?: number; born: number; adm: number; dip: number; mil: number;
  traits: number[]; ideology: number; ig: number;
}

export function addCharacter(w: World, n: NewCharacter, rng: Rng): number {
  const t = w.characters;
  ensureCapacity(t, t.size + 1);
  const i = t.size++;
  const c = t.cols;
  for (const a of Object.values(c)) a[i] = 0;
  c.country![i] = n.country; c.role![i] = n.role; c.slot![i] = n.slot ?? -1; c.born![i] = n.born; c.alive![i] = 1; c.died![i] = -1;
  c.adm![i] = n.adm; c.dip![i] = n.dip; c.mil![i] = n.mil;
  c.trait0![i] = n.traits[0] ?? -1; c.trait1![i] = n.traits[1] ?? -1; c.trait2![i] = n.traits[2] ?? -1;
  c.ideology![i] = n.ideology; c.ig![i] = n.ig;
  c.loyalty![i] = 50 + rng.int(-20, 30); c.ambition![i] = rng.int(10, 90); c.popularity![i] = 50; c.health![i] = 1;
  c.seed![i] = rng.nextU32() & 0x7fffffff;
  w.characterNames[i] = n.name;
  return i;
}

function nameList(w: World, country: number) {
  const tags = NAMES._tags as Record<string, string>;
  const key = tags[w.countryTags[country]!] ?? "generic";
  return (NAMES[key] ?? NAMES.generic) as { first: string[]; last: string[] };
}

/** A procedural character from the country's name list; quality rises with the leadership academy. */
export function generateCharacter(w: World, country: number, role: Role, rng: Rng, ig = -1, kind: "leader" | "minister" | "general" = "minister"): number {
  const names = nameList(w, country);
  const year = toYmd(w.date).year;
  const academy = w.countries.cols.academy![country]!;
  const stat = () => Math.min(6, Math.max(0, rng.int(0, 3) + rng.int(0, 2) + (rng.chance(academy / 10) ? 1 : 0)));
  const pool = TRAITS.map((t, k) => [t, k] as const).filter(([t]) => t.kind === kind || (kind === "leader" && t.kind === "minister"));
  const traits: number[] = [];
  const nTraits = rng.int(1, 2);
  while (traits.length < nTraits) { const [, k] = pool[rng.int(0, pool.length - 1)]!; if (!traits.includes(k)) traits.push(k); }
  return addCharacter(w, {
    name: `${names.first[rng.int(0, names.first.length - 1)]} ${names.last[rng.int(0, names.last.length - 1)]}`,
    country, role, born: fromYmd(year - rng.int(38, 66), 1, 1) - 0, adm: stat(), dip: stat(), mil: role === Role.HighCommand ? stat() + 1 : stat(),
    // Ideology follows the character's interest group (pool characters lean to the centre).
    traits, ideology: ig >= 0 ? IG_IDEOLOGY_OF(ig) : rng.chance(0.7) ? IDEOLOGIES.indexOf("non") : IDEOLOGIES.indexOf("dem"), ig,
  }, rng);
}

export const ageOf = (w: World, i: number) => (w.date - w.characters.cols.born![i]!) / 365.25;

/** Annual mortality by age (Gompertz-like), worse when sickly, better when robust. */
export function annualMortality(w: World, i: number): number {
  const age = ageOf(w, i);
  let m = 0.001 * Math.exp(0.085 * (age - 30));
  const traits = [w.characters.cols.trait0![i]!, w.characters.cols.trait1![i]!, w.characters.cols.trait2![i]!];
  if (traits.includes(SICKLY)) m *= 2;
  if (traits.includes(ROBUST)) m *= 0.6;
  return Math.min(0.9, m);
}
const SICKLY = traitIndex("sickly"), ROBUST = traitIndex("robust");

export function findRole(w: World, country: number, role: Role, slot = -1): number {
  const c = w.characters.cols;
  for (let i = 0; i < w.characters.size; i++) {
    if (c.alive![i] && c.country![i] === country && c.role![i] === role && (slot < 0 || c.slot![i] === slot)) return i;
  }
  return -1;
}

export function charactersOf(w: World, country: number, role?: Role): number[] {
  const c = w.characters.cols, out: number[] = [];
  for (let i = 0; i < w.characters.size; i++) if (c.alive![i] && c.country![i] === country && (role === undefined || c.role![i] === role)) out.push(i);
  return out;
}

/**
 * Rebuild a country's character modifiers: head stats add 0–6 to ADM/DIP/MIL gain; ministers add a
 * quarter of their stats; high command adds a third of MIL; all their traits apply.
 */
export function syncCharacterModifiers(w: World, country: number): void {
  const scope = `c:${country}`;
  removeModifiersWhere(w, (m) => m.scope === scope && m.source.startsWith("char:"));
  const c = w.characters.cols;
  for (let i = 0; i < w.characters.size; i++) {
    if (!c.alive![i] || c.country![i] !== country) continue;
    const role = c.role![i]!, name = w.characterNames[i]!;
    let k = 0;
    if (role === Role.Head) k = 1;
    else if (role === Role.Cabinet) k = 0.25;
    else if (role === Role.HighCommand) k = 0;
    else continue;
    const source = `char:${name}`;
    if (k > 0) for (const [stat, col] of [["adm_gain", "adm"], ["dip_gain", "dip"], ["mil_gain", "mil"]] as const) {
      const v = Math.round(c[col]![i]! * k * 100) / 100;
      if (v) addModifier(w, { target: stat, scope, source, add: v });
    }
    if (role === Role.HighCommand) addModifier(w, { target: "mil_gain", scope, source, add: Math.round((c.mil![i]! / 3) * 100) / 100 });
    for (const tc of ["trait0", "trait1", "trait2"]) {
      const t = c[tc]![i]!;
      if (t < 0) continue;
      for (const m of TRAITS[t]!.modifiers) addModifier(w, { target: m.target, scope, source: `${source} (${TRAITS[t]!.name})`, ...(m.add !== undefined ? { add: m.add } : {}), ...(m.mult !== undefined ? { mult: m.mult } : {}) });
    }
  }
}

export function chronicle(w: World, country: number, kind: string, text: string): void {
  w.chronicle.push({ date: w.date, country, kind, text });
  if (w.chronicle.length > 2000) w.chronicle.splice(0, w.chronicle.length - 2000);
}

export function kill(w: World, i: number, cause: string): void {
  const c = w.characters.cols;
  c.alive![i] = 0; c.died![i] = w.date;
  const country = c.country![i]!, role = c.role![i]!;
  if (role === Role.Head || role === Role.Cabinet || role === Role.HighCommand) chronicle(w, country, "death", `${w.characterNames[i]} (${ROLE_NAMES[role]}) ${cause} aged ${Math.floor(ageOf(w, i))}.`);
}
