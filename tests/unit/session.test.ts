import { expect, test } from "vitest";
import { GameSession } from "../../src/worker/session";
import { categoryIndex } from "../../src/sim/laws";

test("undo restores the world before the last command, only while time has not advanced", () => {
  const s = new GameSession(1, "europe", "GER");
  s.world.countries.cols.pp![s.player] = 500;
  const cat = categoryIndex("education");
  const before = s.snapshot().player.laws[cat];
  expect(s.command({ type: "set_law", payload: { category: cat, law: 2 } }).error).toBeNull();
  expect(s.snapshot().player.laws[cat]).toBe(2);
  expect(s.canUndo()).toBe(true);
  expect(s.undoLast()).toBe(true);
  expect(s.snapshot().player.laws[cat]).toBe(before);
  s.command({ type: "set_law", payload: { category: cat, law: 2 } });
  s.advance(1);
  expect(s.canUndo()).toBe(false);
});

test("previews return greyed reasons and effects", () => {
  const s = new GameSession(1, "europe", "USA" /* not in Europe: falls back to country 0 */);
  const [p] = s.preview([{ type: "raise_stability", payload: {} }]);
  expect(p!.effects.length).toBeGreaterThan(0);
  const snap = s.snapshot();
  expect(snap.player.why.stability!.length).toBeGreaterThan(0);
});
