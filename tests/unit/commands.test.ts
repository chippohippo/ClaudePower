import { expect, test } from "vitest";
import { createEmptyWorld } from "../../src/sim/world";
import { applyCommand, validateCommand } from "../../src/sim/commands";
import { tickDay } from "../../src/sim/tick";

test("dummy command validates and applies", () => {
  const w = createEmptyWorld(1, 2);
  const cmd = { type: "debug_add_treasury", actor: 0, payload: { cents: 500 }, issuedOn: 0 };
  expect(validateCommand(cmd, w)).toEqual({ ok: true });
  expect(validateCommand({ ...cmd, payload: { cents: -1 } }, w)).toEqual({ ok: false, reason: "Insufficient funds" });
  expect(validateCommand({ ...cmd, type: "nope" }, w).ok).toBe(false);
  expect(applyCommand(cmd, w)[0]!.type).toBe("treasury_changed");
  tickDay(w, [cmd]);
  expect(w.countries.cols.treasury![0]).toBe(1000);
});
