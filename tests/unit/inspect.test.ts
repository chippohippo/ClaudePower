import { expect, test } from "vitest";
import { loadContent } from "../../src/sim/content";
import { createWorld } from "../../src/sim/setup";
import { runDays } from "../../src/sim/tick";
import { inspectCountry } from "../../src/sim/inspect";

test("country report traces numbers to the model", () => {
  const { world: w } = createWorld(3, loadContent(), "europe");
  runDays(w, 400);
  const r = inspectCountry(w, w.countryTags.indexOf("GER"));
  expect(r.stats.population).toBeGreaterThan(5e7);
  expect(r.strata.reduce((s, x) => s + x.size, 0)).toBeCloseTo(r.stats.population!, -3);
  expect(r.market).toHaveLength(14);
  expect(r.budget.length).toBeGreaterThan(0);
  expect(r.explain.tfr!.length).toBeGreaterThan(3);
  expect(r.history.years.length).toBe(1);
});
