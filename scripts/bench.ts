// Monthly-tick benchmark on the 1936 world (budget: < 50 ms per world month).
import { loadContent } from "../src/sim/content";
import { createWorld } from "../src/sim/setup";
import { runDays } from "../src/sim/tick";

const { world } = createWorld(1, loadContent());
const t0 = performance.now();
runDays(world, 365 * 10);
console.log(`monthly tick: ${((performance.now() - t0) / 120).toFixed(3)} ms (budget 50) · ${world.provinces.size} provinces`);
