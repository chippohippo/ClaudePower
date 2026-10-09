import { expect, test } from "vitest";
import { createEmptyWorld } from "../../src/sim/world";
import { getStat } from "../../src/sim/modifiers";

test("getStat returns value and sorted breakdown, clamped", () => {
  const w = createEmptyWorld(1, 1);
  w.base["c:0"] = { tax_efficiency: 0.5 };
  w.modifiers.push(
    { target: "tax_efficiency", scope: "c:0", add: 0.1, source: "advisor" },
    { target: "tax_efficiency", scope: "c:0", mult: 0.5, source: "law" },
    { target: "tax_efficiency", scope: "c:1", add: 9, source: "other" },
  );
  const s = getStat(w, "c:0", "tax_efficiency");
  expect(s.value).toBeCloseTo(0.9);
  expect(s.contributors.map((c) => c.source)).toEqual(["law", "advisor"]);
  w.modifiers.push({ target: "tax_efficiency", scope: "c:0", add: 5, source: "cheat" });
  expect(getStat(w, "c:0", "tax_efficiency").value).toBe(2);
});

test("expired modifiers are ignored", () => {
  const w = createEmptyWorld(1, 1);
  w.modifiers.push({ target: "stability", scope: "c:0", add: 1, source: "event", expires: 10 });
  expect(getStat(w, "c:0", "stability").value).toBe(1);
  w.date = 10;
  expect(getStat(w, "c:0", "stability").value).toBe(0);
});
