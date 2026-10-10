// M7 exit test: an AI-only run unlocks computers in the 1960s–70s and the internet in the 1990s (±15 years);
// laggards close the gap by diffusion; ideas get bought.
import { expect, test } from "vitest";
import { loadContent } from "../../src/sim/content";
import { createWorld } from "../../src/sim/setup";
import { runDays } from "../../src/sim/tick";
import { fromYmd, toYmd } from "../../src/sim/date";
import { N_TREES, techYear } from "../../src/sim/techs";

test("computers and internet arrive on schedule", () => {
  const w = createWorld(1, loadContent()).world;
  runDays(w, fromYmd(2006, 1, 1));
  const first = (flag: string) => Math.min(...w.countryFlags.map((f) => (flag in f ? toYmd(f[flag]!).year : 9999)));
  const comp = first("computers"), net = first("internet");
  console.log(`computers ${comp}, internet ${net}`);
  expect(Math.abs(comp - 1965)).toBeLessThanOrEqual(15);
  expect(Math.abs(net - 1995)).toBeLessThanOrEqual(15);
  const live = [...Array(w.countries.size).keys()].filter((c) => w.countries.cols.population![c]! > 0);
  const avg = (c: number) => { let s = 0; for (let k = 0; k < N_TREES; k++) s += techYear(w, c, k); return s / N_TREES; };
  const ys = live.map(avg).sort((a, b) => a - b);
  console.log(`tech year min ${ys[0]!.toFixed(1)} median ${ys[ys.length >> 1]!.toFixed(1)} max ${ys[ys.length - 1]!.toFixed(1)}`);
  expect(ys[ys.length - 1]!).toBeLessThan(2008);
  expect(ys[0]!).toBeGreaterThan(1975);
  expect(ys[0]!).toBeLessThan(ys[ys.length - 1]! - 3); // laggards stay visibly behind
  expect(w.ideas.filter((x) => x.length > 0).length).toBeGreaterThan(live.length / 2);
}, 300_000);
