// npm run headless -- --years N --seed S
import { loadContent } from "../src/sim/content";
import { createWorld } from "../src/sim/setup";
import { runDays } from "../src/sim/tick";
import { formatDate } from "../src/sim/date";

const arg = (k: string, d: number) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const w = createWorld(arg("--seed", 1), loadContent()).world;
const t0 = performance.now();
runDays(w, Math.round(arg("--years", 1) * 365.25));
console.log(`${formatDate(w.date)} in ${(performance.now() - t0).toFixed(0)} ms`);
