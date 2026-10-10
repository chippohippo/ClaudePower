// M4 exit test: industrialising while ignoring the Trade Unions produces strikes or radicalism within
// 20 years; accommodating them (privilege + interventionism) keeps them calmer.
import { expect, test } from "vitest";
import { loadContent } from "../../src/sim/content";
import { createWorld, AUTO_DEVELOP, AUTO_BUDGET, AUTO_ADVISORS } from "../../src/sim/setup";
import { applyCommand } from "../../src/sim/commands";
import "../../src/sim/commands/player";
import "../../src/sim/commands/politics";
import { runDays } from "../../src/sim/tick";
import { buildingIndex } from "../../src/sim/defs";
import { igIndex, igRow } from "../../src/sim/igs";
import { categoryIndex } from "../../src/sim/laws";

function play(accommodate: boolean) {
  const w = createWorld(11, loadContent(), "europe").world, c = w.countryTags.indexOf("GBR");
  const cmd = (type: string, payload: unknown) => applyCommand({ type, actor: c, payload, issuedOn: w.date }, w);
  cmd("set_automation", { flags: AUTO_DEVELOP | AUTO_BUDGET | AUTO_ADVISORS });
  const tu = igIndex("trade_unions");
  if (accommodate) {
    w.countries.cols.pp![c] = 1000;
    cmd("grant_privilege", { ig: tu });
    cmd("set_law", { category: categoryIndex("economic"), law: 1 });
  }
  const factories = ["consumer_factory", "steel_mill", "tool_works", "textile_mill"].map(buildingIndex);
  let maxRad = 0, strikes = 0;
  for (let year = 0; year < 20; year++) {
    // Industrialise: big factory programmes in the largest provinces every year.
    for (let k = 0; k < 4; k++) {
      let best = -1;
      for (let p = 0; p < w.provinces.size; p++) if (w.provinces.cols.owner![p] === c && (best < 0 || w.provinces.cols.population![p]! > w.provinces.cols.population![best]!)) best = p;
      w.countries.cols.treasury![c] = Math.max(w.countries.cols.treasury![c]!, 0);
      cmd("build", { province: best, type: factories[k]!, levels: 60 });
    }
    runDays(w, 365);
    maxRad = Math.max(maxRad, w.igs.cols.radicalism![igRow(c, tu)]!);
    if (w.igs.cols.strikes![igRow(c, tu)]! > 0) strikes++;
  }
  const strikeEvents = w.chronicle.filter((e) => e.country === c && e.kind === "strike").length;
  return { maxRad, strikes, strikeEvents };
}

test("ignoring Trade Unions during industrialisation → strikes or radicalism; accommodating them → calmer", () => {
  const ignored = play(false), accommodated = play(true);
  if (process.env.SHOW) console.log(JSON.stringify({ ignored, accommodated }));
  expect(ignored.maxRad >= 40 || ignored.strikeEvents > 0).toBe(true);
  expect(accommodated.maxRad).toBeLessThan(ignored.maxRad);
  expect(accommodated.strikes).toBeLessThanOrEqual(ignored.strikes);
}, 300_000);
