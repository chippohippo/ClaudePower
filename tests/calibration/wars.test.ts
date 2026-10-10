// M6 exit test: an AI-only run reaches 1950 with at least one major war that ends in a peace deal;
// no instant wipes (daily losses capped, nobody destroyed on day one); battle reports explain outcomes.
import { expect, test } from "vitest";
import { loadContent } from "../../src/sim/content";
import { createWorld } from "../../src/sim/setup";
import { runDays } from "../../src/sim/tick";
import { fromYmd } from "../../src/sim/date";
import { MAX_DAILY_LOSS } from "../../src/sim/systems/combat";

const MAJORS = ["GER", "SOV", "USA", "GBR", "FRA", "ITA", "JAP", "CHI"];

for (const seed of [1, 2]) test(`seed ${seed}: a major war ends in a peace deal by 1950; battles are readable`, () => {
  const w = createWorld(seed, loadContent()).world;
  runDays(w, fromYmd(1950, 1, 1));
  const major = w.wars.filter((x) => x.end >= 0 && x.outcome && [...x.attackers, ...x.defenders, ...x.name.split("–").map((t) => w.countryTags.indexOf(t.replace(/ War$/, "")))].some((c) => c >= 0 && MAJORS.includes(w.countryTags[c]!)));
  expect(major.length).toBeGreaterThan(0);
  expect(w.battles.length).toBeGreaterThan(0);
  for (const b of w.battles) {
    expect(b.firstDayLoss).toBeLessThanOrEqual(MAX_DAILY_LOSS + 1e-9);
    expect(b.modifiers.length).toBeGreaterThanOrEqual(6);
    if (b.winner !== "ongoing") expect(b.end - b.start).toBeGreaterThanOrEqual(0);
  }
}, 300_000);
