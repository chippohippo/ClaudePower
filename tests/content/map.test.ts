import { expect, test } from "vitest";
import { loadContent } from "../../src/sim/content";
import { createWorld, inEurope, neighborsOf } from "../../src/sim/setup";
import geometry from "../../data/generated/map-geometry.json";

const data = loadContent();

test("~250 provinces, dense in Europe, every one with geometry", () => {
  expect(data.provinces.length).toBeGreaterThanOrEqual(230);
  expect(data.provinces.length).toBeLessThanOrEqual(270);
  expect(data.provinces.filter(inEurope).length / data.provinces.length).toBeGreaterThan(0.4);
  expect(geometry.length).toBe(data.provinces.length);
  for (const g of geometry) expect(g.length).toBeGreaterThan(0);
});

test("every owner tag is a known country and every major owns ≥ 8 provinces", () => {
  const tags = new Set(data.countries.map((c) => c.tag));
  for (const p of data.provinces) expect(tags.has(p.owner)).toBe(true);
  for (const c of data.countries.filter((c) => c.major)) expect(data.provinces.filter((p) => p.owner === c.tag).length).toBeGreaterThanOrEqual(8);
});

test("adjacency is symmetric and capitals are owned by their country", () => {
  const { world: w } = createWorld(1, data);
  for (let p = 0; p < w.provinces.size; p++) for (const n of neighborsOf(w, p)) expect(Array.from(neighborsOf(w, n))).toContain(p);
  for (let c = 0; c < w.countries.size; c++) expect(w.provinces.cols.owner![w.countries.cols.capital![c]!]).toBe(c);
  expect(w.provinces.cols.owner![w.countries.cols.capital![w.countryTags.indexOf("GER")]!]).toBe(w.countryTags.indexOf("GER"));
});

test("Europe quick start keeps only European provinces and their owners", () => {
  const { world: w, srcProvinceIds } = createWorld(1, data, "europe");
  expect(w.provinces.size).toBe(data.provinces.filter(inEurope).length);
  expect(srcProvinceIds.every((id) => inEurope(data.provinces[id]!))).toBe(true);
  expect(w.countryTags).toContain("FRA");
  expect(w.countryTags).not.toContain("BRA");
});
