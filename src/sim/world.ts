// World state: struct-of-arrays tables keyed by integer IDs.
import type { RngState } from "./rng";
import { seedRng } from "./rng";
import type { SimDate } from "./date";
import type { Modifier } from "./modifiers";

export type CountryId = number;
export type ProvinceId = number;

export interface Table { size: number; cols: Record<string, Float64Array | Int32Array> }

export function makeTable<K extends string>(size: number, cols: Record<K, "f64" | "i32">): Table {
  const out: Table["cols"] = {};
  for (const [k, t] of Object.entries(cols) as [K, "f64" | "i32"][]) out[k] = t === "f64" ? new Float64Array(size) : new Int32Array(size);
  return { size, cols: out };
}

export interface World {
  version: number;
  seed: number;
  date: SimDate;
  rng: RngState;
  /** Tag lookup — strings only at the data boundary. */
  countryTags: string[];
  countries: Table; // treasury (integer cents), stability
  provinces: Table; // owner, population, development
  modifiers: Modifier[];
  /** Base values per scope ("c:3", "p:12") and stat key. */
  base: Record<string, Record<string, number>>;
}

export const WORLD_VERSION = 1;

export function createEmptyWorld(seed: number, nCountries = 0, nProvinces = 0): World {
  return {
    version: WORLD_VERSION,
    seed,
    date: 0,
    rng: seedRng(seed),
    countryTags: Array.from({ length: nCountries }, (_, i) => `C${i.toString().padStart(2, "0")}`),
    countries: makeTable(nCountries, { treasury: "i32", stability: "f64" }),
    provinces: makeTable(nProvinces, { owner: "i32", population: "f64", development: "f64" }),
    modifiers: [],
    base: {},
  };
}
