import { expect, test } from "vitest";
import { loadContent } from "../../src/sim/content";
import { createWorld } from "../../src/sim/setup";
import { loadWorld, saveWorld } from "../../src/sim/save";
import { runDays } from "../../src/sim/tick";

test("1936 world round-trips through save/load and stays deterministic", () => {
  const { world: a } = createWorld(5, loadContent());
  runDays(a, 90);
  const b = loadWorld(saveWorld(a));
  expect(b).toEqual(a);
  runDays(a, 400); runDays(b, 400);
  expect(saveWorld(b)).toEqual(saveWorld(a));
});
