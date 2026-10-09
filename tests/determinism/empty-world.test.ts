import { expect, test } from "vitest";
import { createEmptyWorld } from "../../src/sim/world";
import { runDays } from "../../src/sim/tick";
import { saveWorld } from "../../src/sim/save";
import { Rng } from "../../src/sim/rng";

test("same seed → identical world after 5 years", () => {
  const a = createEmptyWorld(7, 2, 4), b = createEmptyWorld(7, 2, 4);
  runDays(a, 1826); runDays(b, 1826);
  expect(saveWorld(a)).toEqual(saveWorld(b));
});

test("rng is seeded and reproducible", () => {
  const r1 = new Rng(createEmptyWorld(9).rng), r2 = new Rng(createEmptyWorld(9).rng), r3 = new Rng(createEmptyWorld(10).rng);
  const s1 = Array.from({ length: 5 }, () => r1.nextU32());
  expect(s1).toEqual(Array.from({ length: 5 }, () => r2.nextU32()));
  expect(s1).not.toEqual(Array.from({ length: 5 }, () => r3.nextU32()));
});
