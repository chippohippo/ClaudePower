// Worker entry: wraps a GameSession with the real-time clock and message protocol (snapshots ≤10/s).
import { GameSession } from "./session";
import { inspectCountry } from "../sim/inspect";
import { MAX_SPEED, SPEED_DAYS_PER_SEC } from "../sim/speed";
import type { FromWorker, ToWorker } from "./protocol";

let s: GameSession | null = null;
let carry = 0, last = performance.now(), dirty = true;
let inspecting: number | null = null, lastReport = 0;
const post = (m: FromWorker) => postMessage(m);

setInterval(() => {
  const now = performance.now(), dt = (now - last) / 1000;
  last = now;
  if (s && !s.paused) {
    carry += dt * SPEED_DAYS_PER_SEC[s.speed]!;
    const whole = Math.floor(carry);
    carry -= whole;
    if (whole > 0) { s.advance(whole); dirty = true; }
  }
  if (s && dirty) {
    dirty = false;
    post({ kind: "snapshot", snap: s.snapshot() });
    if (inspecting !== null && now - lastReport > 500) { lastReport = now; post({ kind: "report", report: inspectCountry(s.world, inspecting) }); }
  }
}, 100);

onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  switch (m.kind) {
    case "init":
      s = new GameSession(m.seed, m.scope, m.player);
      post({ kind: "setup", info: s.setup() });
      break;
    case "command": {
      if (!s) return;
      const r = s.command(m.cmd);
      if (r.error) post({ kind: "rejected", reason: r.error });
      else post({ kind: "events", events: r.events });
      lastReport = 0;
      break;
    }
    case "undo": if (s?.undoLast()) lastReport = 0; break;
    case "preview": if (s) post({ kind: "previews", id: m.id, results: s.preview(m.cmds) }); return;
    case "step": s?.advance(m.days); break;
    case "setSpeed": if (s) s.speed = Math.max(1, Math.min(MAX_SPEED, m.speed)); break;
    case "setPaused": if (s) { s.paused = m.paused; carry = 0; } break;
    case "inspect": inspecting = m.country; lastReport = 0; break;
  }
  dirty = true;
};
