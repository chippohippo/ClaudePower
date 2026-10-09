// Worker entry: owns the World and the game clock, receives Commands, posts snapshots (≤10/s).
import type { World } from "../sim/world";
import { tickDay } from "../sim/tick";
import { validateCommand, type Command } from "../sim/commands";
import { formatDate } from "../sim/date";
import { createWorld, neighborsOf } from "../sim/setup";
import { loadContent } from "../sim/content";
import { MAX_SPEED, SPEED_DAYS_PER_SEC } from "../sim/speed";
import type { FromWorker, Snapshot, ToWorker } from "./protocol";

let world: World | null = null;
let pending: Command[] = [];
let paused = true;
let speed = 3;
let carry = 0;
let last = performance.now();
let dirty = true;

const post = (m: FromWorker) => postMessage(m);
const snapshot = (w: World): Snapshot => ({
  date: w.date, dateLabel: formatDate(w.date), paused, speed,
  treasury: Array.from(w.countries.cols.treasury!),
  owner: Array.from(w.provinces.cols.owner!),
  development: Array.from(w.provinces.cols.development!),
});

function advance(days: number) {
  if (!world) return;
  for (let i = 0; i < days; i++) { tickDay(world, pending); pending = []; }
  if (days > 0) dirty = true;
}

setInterval(() => {
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;
  if (world && !paused) {
    carry += dt * SPEED_DAYS_PER_SEC[speed]!;
    const whole = Math.floor(carry);
    carry -= whole;
    advance(whole);
  }
  if (world && dirty) { dirty = false; post({ kind: "snapshot", snap: snapshot(world) }); }
}, 100);

onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  switch (m.kind) {
    case "init": {
      const start = createWorld(m.seed, loadContent(), m.scope);
      world = start.world;
      paused = true;
      post({ kind: "setup", info: {
        srcProvinceIds: start.srcProvinceIds,
        provinceNames: world.provinceNames,
        terrain: Array.from(world.provinces.cols.terrain!),
        neighbors: world.provinceNames.map((_, i) => Array.from(neighborsOf(world!, i))),
        countries: start.countries.map((c, i) => ({ tag: c.tag, name: c.name, color: c.color, capital: world!.countries.cols.capital![i]! })),
      } });
      break;
    }
    case "command": {
      if (!world) return;
      const cmd = { ...m.cmd, issuedOn: world.date };
      const v = validateCommand(cmd, world);
      if (!v.ok) return post({ kind: "rejected", reason: v.reason });
      pending.push(cmd);
      if (paused) advance(0);
      break;
    }
    case "step": advance(m.days); break;
    case "setSpeed": speed = Math.max(1, Math.min(MAX_SPEED, m.speed)); break;
    case "setPaused": paused = m.paused; carry = 0; break;
  }
  dirty = true;
};
