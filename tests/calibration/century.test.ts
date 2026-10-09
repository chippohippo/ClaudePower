// §6.4 calibration: one AI-free 1936→2026 run (state construction auto-managed).
// The simulation is deterministic; with no AI or random events yet, every seed produces the same run,
// so the "10% of runs" inflation criterion is checked on this run directly.
import { beforeAll, expect, test } from "vitest";
import { loadContent } from "../../src/sim/content";
import { createWorld } from "../../src/sim/setup";
import { tickDay } from "../../src/sim/tick";
import { toYmd } from "../../src/sim/date";
import type { World } from "../../src/sim/world";

interface Snap { pop: number; urban: number; richLE: number; minTfr: number; zeroProvinces: number }
const snaps: Record<number, Snap> = {};
let w: World;

function snapshot(w: World): Snap {
  const cc = w.countries.cols;
  let pop = 0, urb = 0, minTfr = Infinity;
  const rich: [number, number][] = [];
  for (let c = 0; c < w.countries.size; c++) {
    const p = cc.population![c]!;
    pop += p; urb += cc.urban![c]! * p;
    if (p > 5e6) { minTfr = Math.min(minTfr, cc.tfr![c]!); rich.push([cc.gdpYear![c]! / p, cc.lifeExp![c]!]); }
  }
  rich.sort((a, b) => b[0] - a[0]);
  const top = rich.slice(0, 8);
  let zero = 0;
  for (let p = 0; p < w.provinces.size; p++) if (w.provinces.cols.population![p]! < 1) zero++;
  return { pop, urban: urb / pop, richLE: top.reduce((s, [, le]) => s + le, 0) / top.length, minTfr, zeroProvinces: zero };
}

beforeAll(() => {
  w = createWorld(1936, loadContent()).world;
  let year = 1936;
  while (toYmd(w.date).year < 2027) {
    tickDay(w);
    const y = toYmd(w.date).year;
    if (y !== year) { year = y; if (y === 1937 || y === 2026) snaps[y] = snapshot(w); }
  }
}, 300_000);

test("world population ~2.2B (1936) → 5–9B (2026)", () => {
  expect(snaps[1937]!.pop).toBeGreaterThan(2.0e9);
  expect(snaps[1937]!.pop).toBeLessThan(2.45e9);
  expect(snaps[2026]!.pop).toBeGreaterThan(5e9);
  expect(snaps[2026]!.pop).toBeLessThan(9e9);
});

test("rich-country life expectancy ~60 → 75–85", () => {
  expect(snaps[1937]!.richLE).toBeGreaterThan(50);
  expect(snaps[1937]!.richLE).toBeLessThan(66);
  expect(snaps[2026]!.richLE).toBeGreaterThan(75);
  expect(snaps[2026]!.richLE).toBeLessThan(85);
});

test("global urbanisation ~30% → 45–65%", () => {
  expect(snaps[1937]!.urban).toBeGreaterThan(0.24);
  expect(snaps[1937]!.urban).toBeLessThan(0.36);
  expect(snaps[2026]!.urban).toBeGreaterThan(0.45);
  expect(snaps[2026]!.urban).toBeLessThan(0.65);
});

test("some countries reach below-replacement fertility", () => {
  expect(snaps[2026]!.minTfr).toBeLessThan(2.1);
});

test("no province reaches zero population", () => {
  expect(snaps[2026]!.zeroProvinces).toBe(0);
});

test("no country above 60% inflation for more than 5 consecutive years", () => {
  const infl = w.history.series.inflation!;
  for (const series of infl) {
    let run = 0;
    for (const x of series) { run = x > 0.6 ? run + 1 : 0; expect(run).toBeLessThanOrEqual(5); }
  }
});
