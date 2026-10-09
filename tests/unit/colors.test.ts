import { expect, test } from "vitest";
import { developmentColor, hexToNum, lighten } from "../../src/map/colors";

test("map colours", () => {
  expect(hexToNum("#ff0000")).toBe(0xff0000);
  expect(developmentColor(0)).not.toBe(developmentColor(20));
  expect(lighten(0x000000, 1)).toBe(0xffffff);
});
