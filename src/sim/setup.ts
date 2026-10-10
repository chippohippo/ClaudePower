// Builds a starting World from validated content (countries, provinces, pops, buildings).
import { BUDGET_COLS, COUNTRY_COLS, MARKET_COLS, createEmptyWorld, ensureCapacity, makeTable, type World } from "./world";
import { TERRAINS, type CountryDef, type ProvinceDef } from "./schemas";
import type { z } from "zod";
import type { CountriesStartFile, ResourcesFile, StartLawsFile, StartPopsFile } from "./schemas";
import { LAWS, enactLaw } from "./laws";
import { BASE_PRICE, BUILDINGS, N_GOODS, PMS } from "./defs";
import { addPop } from "./pops";
import { regionOfLonLat } from "./regions";

export type StartScope = "world" | "europe";
export const inEurope = (p: { lon: number; lat: number }) => p.lon >= -25 && p.lon <= 45 && p.lat >= 34 && p.lat <= 72;

export interface StartData {
  countries: CountryDef[]; provinces: ProvinceDef[]; capitals: Record<string, number>;
  pops: z.infer<typeof StartPopsFile>; start: z.infer<typeof CountriesStartFile>; resources: z.infer<typeof ResourcesFile>;
  laws: z.infer<typeof StartLawsFile>;
}
export interface StartInfo { world: World; srcProvinceIds: number[]; countries: CountryDef[] }

export const AUTO_DEVELOP = 1, AUTO_BUILD = 2, AUTO_BUDGET = 4, AUTO_ALL = 7;
export const RES_OIL = 1, RES_COAL = 2, RES_IRON = 4;
export const STARTING_TAX = 0.12;

export function createWorld(seed: number, data: StartData, scope: StartScope = "world"): StartInfo {
  const provs = scope === "europe" ? data.provinces.filter(inEurope) : data.provinces;
  const ownerTags = new Set(provs.map((p) => p.owner));
  const countries = data.countries.filter((c) => ownerTags.has(c.tag));
  const tagId = new Map(countries.map((c, i) => [c.tag, i]));
  const newId = new Map(provs.map((p, i) => [p.id, i]));

  const w = createEmptyWorld(seed, countries.length, provs.length);
  w.countries = makeTable(countries.length, COUNTRY_COLS);
  w.budget = makeTable(countries.length, BUDGET_COLS);
  w.countryTags = countries.map((c) => c.tag);
  w.provinceNames = provs.map((p) => p.name);
  w.cultures = [...data.pops.cultures];
  w.religions = [...data.pops.religions];
  const pc = w.provinces.cols;
  const offset = w.adjacency.cols.offset!;
  const list: number[] = [];
  const inBoxes = (boxes: number[][], p: ProvinceDef) => boxes.some(([a, b, c, d]) => p.lon >= a! && p.lon <= c! && p.lat >= b! && p.lat <= d!);
  provs.forEach((p, i) => {
    pc.owner![i] = tagId.get(p.owner)!;
    pc.development![i] = p.development;
    pc.terrain![i] = TERRAINS.indexOf(p.terrain);
    pc.region![i] = regionOfLonLat(p.lon, p.lat);
    pc.devTax![i] = pc.devProd![i] = pc.devMan![i] = p.development / 3;
    pc.res![i] = (inBoxes(data.resources.oil, p) ? RES_OIL : 0) | (inBoxes(data.resources.coal, p) ? RES_COAL : 0) | (inBoxes(data.resources.iron, p) ? RES_IRON : 0);
    for (const n of p.neighbors) { const j = newId.get(n); if (j !== undefined) list.push(j); }
    offset[i + 1] = list.length;
  });
  w.adjacency.cols.list = Int32Array.from(list);

  for (const [prov, cul, rel, st, a0, a1, a2, lit, health, cash] of data.pops.pops) {
    const p = newId.get(prov);
    if (p === undefined) continue;
    addPop(w, { prov: p, culture: cul, religion: rel, stratum: st, a0, a1, a2, literacy: lit, health, cash });
  }

  // Buildings: start with the earliest PM; cash buffer ≈ two months of inputs plus one of wages.
  ensureCapacity(w.buildings, data.pops.buildings.length);
  for (const [prov, type, level] of data.pops.buildings) {
    const p = newId.get(prov);
    if (p === undefined) continue;
    const i = w.buildings.size++;
    const b = w.buildings.cols;
    b.prov![i] = p; b.type![i] = type; b.level![i] = level; b.pm![i] = 0; b.staffing![i] = 1; b.inputSat![i] = 1;
    const pm = PMS[type]![0]!;
    let inVal = 0, outVal = 0;
    for (let g = 0; g < N_GOODS; g++) { inVal += pm.inputs[g]! * BASE_PRICE[g]!; outVal += pm.outputs[g]! * BASE_PRICE[g]!; }
    b.cash![i] = BUILDINGS[type]!.owner === "state" ? 0 : Math.round(level * (2 * inVal + 0.5 * Math.max(0, outVal - inVal)));
  }

  w.markets = makeTable(countries.length * N_GOODS, MARKET_COLS);
  w.worldMarket = makeTable(N_GOODS, MARKET_COLS);
  for (let g = 0; g < N_GOODS; g++) {
    w.worldMarket.cols.price![g] = BASE_PRICE[g]!;
    for (let c = 0; c < countries.length; c++) w.markets.cols.price![c * N_GOODS + g] = BASE_PRICE[g]!;
  }

  const cc = w.countries.cols;
  countries.forEach((c, i) => {
    const cap = newId.get(data.capitals[c.tag] ?? -1) ?? provs.findIndex((p) => p.owner === c.tag);
    cc.capital![i] = cap;
    cc.priceLevel![i] = 1;
    cc.taxRate![i] = STARTING_TAX;
    const s = data.start[c.tag]!;
    // Treasury ≈ two months of a 12%-of-GDP budget.
    cc.treasury![i] = Math.round(s.population * 1e6 * s.gdpPerCapita * 100 * 0.12 * (2 / 12));
    w.base[`c:${i}`] = { fertility_mult: 1 };
    cc.adm![i] = cc.dip![i] = cc.mil![i] = 100; cc.pp![i] = 100;
    cc.automation![i] = AUTO_ALL;
    const laws = { ...data.laws._default, ...data.laws[c.tag] };
    LAWS.forEach((cat, k) => enactLaw(w, i, k, Math.max(0, cat.laws.findIndex((l) => l.id === laws[cat.id]))));
    const wages = [0.5, 1, 1.5, 3, 10, 1, 1.5];
    wages.forEach((x, k) => { cc[`wage${k}`]![i] = Math.round(((s.gdpPerCapita * 100) / 12) * x * 0.9); });
  });
  return { world: w, srcProvinceIds: provs.map((p) => p.id), countries };
}

export function neighborsOf(w: World, p: number): Int32Array {
  const o = w.adjacency.cols.offset!;
  return (w.adjacency.cols.list as Int32Array).subarray(o[p]!, o[p + 1]!);
}
