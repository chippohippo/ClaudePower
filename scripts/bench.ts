// Monthly-tick benchmark (budget: < 50 ms per world month).
import { createEmptyWorld } from "../src/sim/world";
import { runDays } from "../src/sim/tick";

const w = createEmptyWorld(1, 60, 250);
const t0 = performance.now();
runDays(w, 365 * 10);
const ms = (performance.now() - t0) / 120;
console.log(`monthly tick: ${ms.toFixed(3)} ms (budget 50)`);
