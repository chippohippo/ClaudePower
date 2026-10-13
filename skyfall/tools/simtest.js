// Headless smoke test: runs a full 100-player bot match and reports performance + outcome.
import { Match } from '../src/sim/match.js';

const mode = process.argv[2] || 'trios';
const seconds = +(process.argv[3] || 900);
const m = new Match({ seed: 1234, mode });
m.setupSquads([]);
m.start();
const dt = 1 / 30;
let t0 = performance.now(), worst = 0, ticks = 0;
let lastReport = 0;
for (let i = 0; i < seconds * 30 && !m.over; i++) {
  const a = performance.now();
  m.tick(dt);
  const e = performance.now() - a;
  worst = Math.max(worst, e);
  ticks++;
  if (m.time - lastReport >= 60) {
    lastReport = m.time;
    const kills = m.list.reduce((s, p) => s + p.kills, 0);
    const armed = m.list.filter((p) => p.alive && p.weapons.some(Boolean)).length;
    const states = {};
    for (const p of m.list) if (p.alive && p.bot) states[p.bot.state] = (states[p.bot.state] || 0) + 1;
    console.log(`t=${m.time.toFixed(0)}s alive=${m.alive} squads=${m.squads.filter((s) => s.alive).length} kills=${kills} armed=${armed} ring=${m.ring.idx}/${m.ring.state} r=${m.ring.r.toFixed(0)} avgTick=${((performance.now() - t0) / ticks).toFixed(2)}ms worst=${worst.toFixed(1)}ms`, JSON.stringify(states));
  }
}
const w = m.squads.find((s) => s.alive);
console.log('over', m.over, 'time', m.time.toFixed(0), 'winner squad', w && w.idx, 'avg tick ms', ((performance.now() - t0) / ticks).toFixed(2));
