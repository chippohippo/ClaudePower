// World state: struct-of-arrays tables keyed by integer IDs.
import type { RngState } from "./rng";
import { seedRng } from "./rng";
import type { SimDate } from "./date";
import type { Modifier } from "./modifiers";

export type CountryId = number;
export type ProvinceId = number;

export interface Table { size: number; cols: Record<string, Float64Array | Int32Array> }
type ColSpec = Record<string, "f64" | "i32">;

export function makeTable(size: number, cols: ColSpec): Table {
  const out: Table["cols"] = {};
  for (const [k, t] of Object.entries(cols)) out[k] = t === "f64" ? new Float64Array(size) : new Int32Array(size);
  return { size, cols: out };
}

/** Grow every column of a table to at least `cap` rows (keeps `size`). */
export function ensureCapacity(t: Table, cap: number): void {
  for (const [k, a] of Object.entries(t.cols)) {
    if (a.length >= cap) continue;
    const next = new (a.constructor as Float64ArrayConstructor | Int32ArrayConstructor)(Math.max(cap, a.length * 2));
    next.set(a);
    t.cols[k] = next;
  }
}

/** Typed column accessor (columns are always present for a known table). */
export const col = (t: Table, k: string) => t.cols[k]!;

export const COUNTRY_COLS: ColSpec = {
  treasury: "f64", stability: "f64", capital: "i32", debt: "f64", priceLevel: "f64", inflation: "f64",
  gdp: "f64", taxRate: "f64", income: "f64", expense: "f64", investPool: "f64", population: "f64",
  minted: "f64", printed: "f64", borrowed: "f64", plYearAgo: "f64", lifeExp: "f64", urban: "f64", literacy: "f64",
  sol: "f64", unemployment: "f64", gdpYear: "f64", gdpAcc: "f64", tfr: "f64", money: "f64", pensionRate: "f64", debtFlow: "f64",
  adm: "f64", dip: "f64", mil: "f64", pp: "f64", manpower: "f64", automation: "i32",
  law0: "i32", law1: "i32", law2: "i32", law3: "i32",
  overlord: "i32", bloc: "i32", warExhaustion: "f64", equip: "f64", prestige: "f64", nukes: "i32", armyPower: "f64",
  government: "i32", head: "i32", heir: "i32", academy: "f64", nextElection: "i32", lastCoup: "i32",
  ideoDem: "f64", ideoFas: "f64", ideoCom: "f64", ideoNon: "f64",
  wage0: "f64", wage1: "f64", wage2: "f64", wage3: "f64", wage4: "f64", wage5: "f64", wage6: "f64",
};
export const PROVINCE_COLS: ColSpec = { owner: "i32", population: "f64", development: "f64", terrain: "i32", sol: "f64", unemployment: "f64", region: "i32", res: "i32", devTax: "f64", devProd: "f64", devMan: "f64", unrest: "f64", controller: "i32", siege: "f64" };
export const POP_COLS: ColSpec = {
  prov: "i32", culture: "i32", religion: "i32", stratum: "i32",
  a0: "f64", a1: "f64", a2: "f64", female: "f64", literacy: "f64", health: "f64", cash: "f64",
  sol: "f64", ideoDem: "f64", ideoFas: "f64", ideoCom: "f64", ideoNon: "f64", consciousness: "f64", militancy: "f64",
  employed: "f64", income: "f64", subsistence: "f64",
};
export const BUILDING_COLS: ColSpec = {
  prov: "i32", type: "i32", level: "i32", pm: "i32", cash: "f64", staffing: "f64", inputSat: "f64",
  revenue: "f64", profit: "f64", wages: "f64",
};
export const MARKET_COLS: ColSpec = { price: "f64", supply: "f64", demand: "f64", sold: "f64", bought: "f64" };
/** Treasury flows of the current month by category (signed cents), for the budget panel. */
export const BUDGET_LINES = ["income_tax", "profit_tax", "consumption_tax", "other_income", "purchases", "payroll", "pensions", "interest", "borrowing", "printing", "seigniorage", "repayment", "other"] as const;
export type BudgetLine = (typeof BUDGET_LINES)[number];
export const BUDGET_COLS: ColSpec = Object.fromEntries(BUDGET_LINES.map((k) => [k, "f64"]));
/** Characters: one row each (dead ones stay for the chronicle). Strings live in World.characterNames. */
export const CHARACTER_COLS: ColSpec = {
  country: "i32", role: "i32", slot: "i32", born: "i32", died: "i32", alive: "i32",
  adm: "f64", dip: "f64", mil: "f64", trait0: "i32", trait1: "i32", trait2: "i32",
  ideology: "i32", ig: "i32", loyalty: "f64", ambition: "f64", popularity: "f64", health: "f64", seed: "i32",
};
/** Interest groups: row = country * 8 + ig. */
export const IG_COLS: ColSpec = { clout: "f64", approval: "f64", radicalism: "f64", leader: "i32", privileges: "i32", support: "f64", strikes: "f64", favour: "f64" };
/** Pairwise diplomacy: row = a * nCountries + b. guarantee: a guarantees b. truce: day until. */
export const DIPLO_COLS: ColSpec = { rel: "f64", alliance: "i32", guarantee: "i32", trade: "i32", truce: "i32", claim: "i32" };
/** Armies (stacks of divisions of 10k). target = destination province; objective = enemy country (auto). */
export const ARMY_COLS: ColSpec = {
  country: "i32", prov: "i32", strength: "f64", org: "f64", target: "i32", next: "i32", progress: "f64",
  objective: "i32", auto: "i32", general: "i32", entrench: "f64", battle: "i32", alive: "i32",
};
export const PROJECT_COLS: ColSpec = { country: "i32", prov: "i32", type: "i32", progress: "f64", state: "i32", levels: "i32" };

/** Money ledger: all cents created or destroyed outside closed transfers. */
export interface Ledger { minted: number; destroyed: number; born: number; died: number; migratedOut: number; migratedIn: number }

export interface War {
  id: number; name: string; attackers: number[]; defenders: number[]; start: number; end: number;
  /** Attacker-side war score, −100…+100. */
  score: number; battleScore: number; goal: { type: "claim" | "ideology" | "independence" | "conquest"; province: number };
  monthsStalemate: number; outcome: string;
}
export interface BattleReport {
  id: number; war: number; prov: number; start: number; end: number;
  attacker: number; defender: number; aStart: number; dStart: number; aEnd: number; dEnd: number;
  winner: "attacker" | "defender" | "ongoing"; modifiers: { label: string; attacker: number; defender: number }[];
  firstDayLoss: number;
}
export interface EventBinding { province?: number; ig?: number; leader?: number; other?: number }

export interface History { year: number[]; series: Record<string, number[][]> }

export interface World {
  version: number;
  seed: number;
  date: SimDate;
  rng: RngState;
  /** Tag lookup — strings only at the data boundary. */
  countryTags: string[];
  countries: Table;
  provinces: Table;
  provinceNames: string[];
  /** CSR adjacency: cols.offset has size+1 entries into cols.list. */
  adjacency: Table;
  cultures: string[];
  religions: string[];
  pops: Table;
  buildings: Table;
  /** country × good (row = country * nGoods + good). */
  markets: Table;
  /** one row per good; world price and residual trade. */
  worldMarket: Table;
  projects: Table;
  budget: Table;
  characters: Table;
  characterNames: string[];
  igs: Table;
  /** Global flags (consistency engine): name → date set. */
  flags: Record<string, number>;
  /** Per-country flags: name → date set. */
  countryFlags: Record<string, number>[];
  /** Per-country focus state. */
  focus: { tree: string; current: string | null; progress: number; done: string[] }[];
  /** Events awaiting a choice (player) — AI resolves immediately. */
  pendingEvents: { id: number; country: number; event: string; bind: EventBinding; date: number }[];
  /** Last fire date per "country:event" (cooldowns, once-only). */
  eventLog: Record<string, number>;
  /** Ambitions per country: id + completion date (−1 open). */
  ambitions: { id: string; done: number }[][];
  nextEventId: number;
  diplo: Table;
  armies: Table;
  /** Claims: country → provinces it claims. */
  claims: number[][];
  wars: War[];
  battles: BattleReport[];
  blocs: { id: number; name: string; leader: number; founded: number }[];
  /** Rivals per country (up to 3). */
  rivals: number[][];
  nextWarId: number;
  nextBattleId: number;
  /** Chronicle of notable events (deaths, elections, coups, strikes), newest last. */
  chronicle: { date: number; country: number; kind: string; text: string }[];
  ledger: Ledger;
  history: History;
  modifiers: Modifier[];
  /** Base values per scope ("c:3", "p:12") and stat key. */
  base: Record<string, Record<string, number>>;
}

export const WORLD_VERSION = 7;
export const TABLE_KEYS = ["countries", "provinces", "adjacency", "pops", "buildings", "markets", "worldMarket", "projects", "budget", "characters", "igs", "diplo", "armies"] as const;

export function createEmptyWorld(seed: number, nCountries = 0, nProvinces = 0): World {
  return {
    version: WORLD_VERSION,
    seed,
    date: 0,
    rng: seedRng(seed),
    countryTags: Array.from({ length: nCountries }, (_, i) => `C${i.toString().padStart(2, "0")}`),
    countries: makeTable(nCountries, COUNTRY_COLS),
    provinces: makeTable(nProvinces, PROVINCE_COLS),
    provinceNames: Array.from({ length: nProvinces }, (_, i) => `P${i}`),
    adjacency: { size: nProvinces, cols: { offset: new Int32Array(nProvinces + 1), list: new Int32Array(0) } },
    cultures: [],
    religions: [],
    pops: makeTable(0, POP_COLS),
    buildings: makeTable(0, BUILDING_COLS),
    markets: makeTable(0, MARKET_COLS),
    worldMarket: makeTable(0, MARKET_COLS),
    projects: makeTable(0, PROJECT_COLS),
    budget: makeTable(nCountries, BUDGET_COLS),
    characters: makeTable(0, CHARACTER_COLS),
    characterNames: [],
    igs: makeTable(nCountries * 8, IG_COLS),
    chronicle: [],
    flags: {},
    countryFlags: Array.from({ length: nCountries }, () => ({})),
    focus: Array.from({ length: nCountries }, () => ({ tree: "", current: null, progress: 0, done: [] })),
    pendingEvents: [],
    eventLog: {},
    ambitions: Array.from({ length: nCountries }, () => []),
    nextEventId: 1,
    diplo: makeTable(nCountries * nCountries, DIPLO_COLS),
    armies: makeTable(0, ARMY_COLS),
    claims: Array.from({ length: nCountries }, () => []),
    wars: [], battles: [], blocs: [], rivals: Array.from({ length: nCountries }, () => []),
    nextWarId: 1, nextBattleId: 1,
    ledger: { minted: 0, destroyed: 0, born: 0, died: 0, migratedOut: 0, migratedIn: 0 },
    history: { year: [], series: {} },
    modifiers: [],
    base: {},
  };
}
