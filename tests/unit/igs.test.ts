import { expect, test } from "vitest";
import { loadContent } from "../../src/sim/content";
import { createWorld } from "../../src/sim/setup";
import { IGS, N_IGS, igIndex, igRow, lawSupport, setPrivilege } from "../../src/sim/igs";
import { approvalParts, computeClout, politicalWeight } from "../../src/sim/systems/igs";
import { categoryIndex } from "../../src/sim/laws";

const w = createWorld(2, loadContent(), "europe").world;
const GBR = w.countryTags.indexOf("GBR");

test("political weight grows with size, wealth and literacy", () => {
  expect(politicalWeight(2000, 100, 100, 0.5)).toBeGreaterThan(politicalWeight(1000, 100, 100, 0.5));
  expect(politicalWeight(1000, 400, 100, 0.5)).toBeGreaterThan(politicalWeight(1000, 100, 100, 0.5));
  expect(politicalWeight(1000, 100, 100, 0.9)).toBeGreaterThan(politicalWeight(1000, 100, 100, 0.1));
});

test("clout sums to 1 per country and follows strata", () => {
  computeClout(w);
  for (let c = 0; c < w.countries.size; c++) {
    let s = 0;
    for (let g = 0; g < N_IGS; g++) s += w.igs.cols.clout![igRow(c, g)]!;
    if (s > 0) expect(s).toBeCloseTo(1, 6);
  }
  // Industrial Britain: unions outweigh landowners.
  expect(w.igs.cols.clout![igRow(GBR, igIndex("trade_unions"))]).toBeGreaterThan(w.igs.cols.clout![igRow(GBR, igIndex("landowners"))]!);
});

test("approval: privilege +30, rivals −4 each, laws matter", () => {
  const tu = igIndex("trade_unions"), ind = igIndex("industrialists");
  const sum = (g: number) => approvalParts(w, GBR, g, 50).reduce((s, x) => s + x.value, 0);
  const tu0 = sum(tu), ind0 = sum(ind);
  setPrivilege(w, GBR, tu, true);
  expect(sum(tu) - tu0).toBeCloseTo(30 + 160 * Math.max(0, w.igs.cols.clout![igRow(GBR, tu)]! - 0.15), 0);
  expect(sum(ind) - ind0).toBeCloseTo(-4, 1);
  setPrivilege(w, GBR, tu, false);
  // Laissez-faire → command economy: unions for, industrialists against.
  const sup = lawSupport(w, GBR, categoryIndex("economic"), 2);
  expect(sup.by[tu]!.delta).toBeGreaterThan(0);
  expect(sup.by[ind]!.delta).toBeLessThan(0);
  expect(IGS[tu]!.name).toBe("Trade Unions");
});
