import { expect, test } from "vitest";
import { loadContent } from "../../src/sim/content";
import { createWorld, AUTO_BUILD, AUTO_DEVELOP } from "../../src/sim/setup";
import { applyCommand, previewCommand } from "../../src/sim/commands";
import { runDays } from "../../src/sim/tick";
import { getStat } from "../../src/sim/modifiers";
import { categoryIndex, activeLaw } from "../../src/sim/laws";
import { computeAlerts } from "../../src/sim/alerts";
import { buildingIndex } from "../../src/sim/defs";
import "../../src/sim/commands/player";

const fresh = () => createWorld(1, loadContent(), "europe").world;
const cmd = (type: string, actor: number, payload: unknown) => ({ type, actor, payload, issuedOn: 0 });

test("points accrue monthly and develop spends them", () => {
  const w = fresh(), ger = w.countryTags.indexOf("GER");
  w.countries.cols.automation![ger] = 0;
  runDays(w, 62);
  expect(w.countries.cols.adm![ger]).toBeCloseTo(110, 0);
  const prov = w.countries.cols.capital![ger]!;
  const pv = previewCommand(cmd("develop", ger, { province: prov, kind: 0 }), w);
  expect(pv.ok).toBe(true);
  expect(pv.effects[0]).toMatch(/ADM/);
  const dev0 = w.provinces.cols.development![prov]!;
  applyCommand(cmd("develop", ger, { province: prov, kind: 0 }), w);
  expect(w.provinces.cols.development![prov]).toBe(dev0 + 1);
  w.countries.cols.adm![ger] = 0;
  const v = previewCommand(cmd("develop", ger, { province: prov, kind: 0 }), w);
  expect(v.ok).toBe(false);
  expect(v.reason).toMatch(/Requires \d+ ADM/);
});

test("laws change modifiers and cost PP; greyed reason when short", () => {
  const w = fresh(), ger = w.countryTags.indexOf("GER"), cat = categoryIndex("mobilisation");
  const before = getStat(w, `c:${ger}`, "mobilisation").value;
  w.countries.cols.pp![ger] = 500;
  const r = applyCommand(cmd("set_law", ger, { category: cat, law: 3 }), w);
  expect(r[0]!.type).toBe("law_enacted");
  expect(activeLaw(w, ger, cat)).toBe(3);
  expect(getStat(w, `c:${ger}`, "mobilisation").value).toBeGreaterThan(before);
  w.countries.cols.pp![ger] = 0;
  expect(previewCommand(cmd("set_law", ger, { category: cat, law: 0 }), w).reason).toMatch(/political power/);
});

test("state construction by hand when auto-build is off", () => {
  const w = fresh(), ger = w.countryTags.indexOf("GER");
  applyCommand(cmd("set_automation", ger, { flags: AUTO_DEVELOP }), w);
  expect(w.countries.cols.automation![ger]! & AUTO_BUILD).toBe(0);
  const prov = w.countries.cols.capital![ger]!, t = buildingIndex("tool_works");
  const ev = applyCommand(cmd("build", ger, { province: prov, type: t, levels: 20 }), w);
  expect(ev[0]!.type).toBe("construction_started");
  let lv0 = 0;
  for (let i = 0; i < w.buildings.size; i++) if (w.buildings.cols.prov![i] === prov && w.buildings.cols.type![i] === t) lv0 = w.buildings.cols.level![i]!;
  runDays(w, 365);
  let lv1 = 0;
  for (let i = 0; i < w.buildings.size; i++) if (w.buildings.cols.prov![i] === prov && w.buildings.cols.type![i] === t) lv1 = w.buildings.cols.level![i]!;
  expect(lv1).toBe(lv0 + 20);
  expect(computeAlerts(w, ger).some((a) => a.type === "construction_idle")).toBe(true);
});

test("tax rate needs auto-budget off", () => {
  const w = fresh(), ger = w.countryTags.indexOf("GER");
  expect(previewCommand(cmd("set_tax_rate", ger, { rate: 0.2 }), w).reason).toMatch(/automatic budget/);
  applyCommand(cmd("set_automation", ger, { flags: 0 }), w);
  applyCommand(cmd("set_tax_rate", ger, { rate: 0.2 }), w);
  expect(w.countries.cols.taxRate![ger]).toBe(0.2);
});
