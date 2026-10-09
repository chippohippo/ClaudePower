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
  wage0: "f64", wage1: "f64", wage2: "f64", wage3: "f64", wage4: "f64", wage5: "f64", wage6: "f64",
};
export const PROVINCE_COLS: ColSpec = { owner: "i32", population: "f64", development: "f64", terrain: "i32", sol: "f64", unemployment: "f64", region: "i32", res: "i32" };
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
export const PROJECT_COLS: ColSpec = { country: "i32", prov: "i32", type: "i32", progress: "f64", state: "i32", levels: "i32" };

/** Money ledger: all cents created or destroyed outside closed transfers. */
export interface Ledger { minted: number; destroyed: number; born: number; died: number; migratedOut: number; migratedIn: number }

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
  ledger: Ledger;
  history: History;
  modifiers: Modifier[];
  /** Base values per scope ("c:3", "p:12") and stat key. */
  base: Record<string, Record<string, number>>;
}

export const WORLD_VERSION = 3;
export const TABLE_KEYS = ["countries", "provinces", "adjacency", "pops", "buildings", "markets", "worldMarket", "projects"] as const;

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
    ledger: { minted: 0, destroyed: 0, born: 0, died: 0, migratedOut: 0, migratedIn: 0 },
    history: { year: [], series: {} },
    modifiers: [],
    base: {},
  };
}
