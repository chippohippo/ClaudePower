import { expect, test } from "vitest";
import { createEmptyWorld } from "../../src/sim/world";
import { runDays } from "../../src/sim/tick";
import { loadWorld, saveWorld } from "../../src/sim/save";

test("save/load round-trip", () => {
  const w = createEmptyWorld(42, 3, 5);
  w.countries.cols.treasury![1] = 12345;
  w.provinces.cols.population![2] = 1.5e6;
  w.modifiers.push({ target: "stability", scope: "c:1", add: 1, source: "law:x", expires: 400 });
  w.base["c:1"] = { stability: 0.5 };
  runDays(w, 100);
  const back = loadWorld(saveWorld(w));
  expect(back).toEqual(w);
  runDays(w, 50); runDays(back, 50);
  expect(saveWorld(back)).toEqual(saveWorld(w));
});
