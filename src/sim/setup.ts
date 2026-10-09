// Builds a starting World from validated content (countries + generated provinces).
import { createEmptyWorld, type World } from "./world";
import { TERRAINS, type CountryDef, type ProvinceDef } from "./schemas";

export type StartScope = "world" | "europe";
export const inEurope = (p: { lon: number; lat: number }) => p.lon >= -25 && p.lon <= 45 && p.lat >= 34 && p.lat <= 72;

export interface StartData { countries: CountryDef[]; provinces: ProvinceDef[]; capitals: Record<string, number> }
export interface StartInfo { world: World; srcProvinceIds: number[]; countries: CountryDef[] }

export function createWorld(seed: number, data: StartData, scope: StartScope = "world"): StartInfo {
  const provs = scope === "europe" ? data.provinces.filter(inEurope) : data.provinces;
  const ownerTags = new Set(provs.map((p) => p.owner));
  const countries = data.countries.filter((c) => ownerTags.has(c.tag));
  const tagId = new Map(countries.map((c, i) => [c.tag, i]));
  const newId = new Map(provs.map((p, i) => [p.id, i]));

  const w = createEmptyWorld(seed, countries.length, provs.length);
  w.countryTags = countries.map((c) => c.tag);
  w.provinceNames = provs.map((p) => p.name);
  const { owner, development, terrain } = w.provinces.cols;
  const offset = w.adjacency.cols.offset!;
  const list: number[] = [];
  provs.forEach((p, i) => {
    owner![i] = tagId.get(p.owner)!;
    development![i] = p.development;
    terrain![i] = TERRAINS.indexOf(p.terrain);
    for (const n of p.neighbors) { const j = newId.get(n); if (j !== undefined) list.push(j); }
    offset[i + 1] = list.length;
  });
  w.adjacency.cols.list = Int32Array.from(list);
  countries.forEach((c, i) => {
    const cap = newId.get(data.capitals[c.tag] ?? -1) ?? provs.findIndex((p) => p.owner === c.tag);
    w.countries.cols.capital![i] = cap;
    w.base[`c:${i}`] = { stability: 0 };
  });
  return { world: w, srcProvinceIds: provs.map((p) => p.id), countries };
}

export function neighborsOf(w: World, p: number): Int32Array {
  const o = w.adjacency.cols.offset!;
  return (w.adjacency.cols.list as Int32Array).subarray(o[p]!, o[p + 1]!);
}
