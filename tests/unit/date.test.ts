import { expect, test } from "vitest";
import { formatDate, fromYmd, toYmd } from "../../src/sim/date";

test("calendar round-trips across leap years", () => {
  for (const d of [0, 59, 60, 365, 366, 33238]) expect(fromYmd(toYmd(d).year, toYmd(d).month, toYmd(d).day)).toBe(d);
  expect(formatDate(0)).toBe("1 Jan 1936");
  expect(fromYmd(1935, 1, 1)).toBe(-365);
  expect(fromYmd(1882, 1, 1)).toBeLessThan(-54 * 365);
  expect(formatDate(fromYmd(2026, 12, 31))).toBe("31 Dec 2026");
});
