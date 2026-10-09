// npm run headless -- --years N --seed S [--scope europe] [--tags GER,USA]
import { loadContent } from "../src/sim/content";
import { createWorld, type StartScope } from "../src/sim/setup";
import { tickDay } from "../src/sim/tick";
import { toYmd } from "../src/sim/date";
import { worldSummary } from "./summary";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1]! : d; };
const years = Number(arg("--years", "1")), seed = Number(arg("--seed", "1"));
const { world: w } = createWorld(seed, loadContent(), arg("--scope", "world") as StartScope);
const tags = arg("--tags", "GBR,USA,GER,SOV,JAP,CHI,RAJ,BRA").split(",");
const t0 = performance.now();
const end = toYmd(0).year + years;
let lastYear = 1936;
while (toYmd(w.date).year < end) {
  tickDay(w);
  const y = toYmd(w.date).year;
  if (y !== lastYear && (y - 1936) % Math.max(1, Math.floor(years / 9)) === 0) console.log(worldSummary(w, tags));
  lastYear = y;
}
console.log(worldSummary(w, tags));
console.log(`${years} years in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
