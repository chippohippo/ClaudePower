// Worker entry: owns the World, receives Commands, posts snapshots.
import { createEmptyWorld, type World } from "../sim/world";
import { tickDay } from "../sim/tick";
import { validateCommand, type Command } from "../sim/commands";
import { formatDate } from "../sim/date";
import type { FromWorker, Snapshot, ToWorker } from "./protocol";

let world: World = createEmptyWorld(1, 2, 4);
let pending: Command[] = [];

const snapshot = (): Snapshot => ({
  date: world.date, dateLabel: formatDate(world.date),
  treasury: Array.from(world.countries.cols.treasury!),
});
const post = (m: FromWorker) => postMessage(m);

onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.kind === "init") world = createEmptyWorld(m.seed, 2, 4);
  else if (m.kind === "command") {
    const cmd = { ...m.cmd, issuedOn: world.date };
    const v = validateCommand(cmd, world);
    if (!v.ok) return post({ kind: "rejected", reason: v.reason });
    pending.push(cmd);
    return;
  } else if (m.kind === "step") {
    for (let i = 0; i < m.days; i++) { tickDay(world, pending); pending = []; }
  }
  post({ kind: "snapshot", snap: snapshot() });
};
