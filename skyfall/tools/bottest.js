// Bot quality metrics: looting efficiency, stuck events, path usage, movement tech use.
import { Match } from '../src/sim/match.js';
import { Bot } from '../src/sim/bot.js';
import { MEV } from '../src/shared/movement.js';

const m = new Match({ seed: +(process.argv[2] || 1234), mode: 'trios' });
if (process.env.NONAV) m.nav = null;
m.setupSquads([]);
m.start();
let paths = 0, pathOk = 0, slides = 0, wallJumps = 0, stuck = 0;
const rp = Bot.prototype._requestPath;
Bot.prototype._requestPath = function (...a) { paths++; const r = rp.apply(this, a); if (r) pathOk++; return r; };
const prevStuck = new Map();
// count movement tech from the per-substep movement events the match already broadcasts
const me = m._moveEvents.bind(m);
m._moveEvents = (p) => { if (p.bot) { if (p.ms.events & MEV.SLIDE) slides++; if (p.ms.events & MEV.WALLJUMP) wallJumps++; } me(p); };
for (let i = 0; i < 30 * 150; i++) {
  m.tick(1 / 30);
  for (const p of m.list) {
    if (!p.bot || !p.alive) continue;
    const n = p.bot.stuck.n, pn = prevStuck.get(p.id) || 0;
    if (n > pn) stuck++;
    prevStuck.set(p.id, n);
  }
  if (i === 30 * 90) {
    const armed = m.list.filter((p) => p.alive && p.weapons.some(Boolean)).length;
    const armored = m.list.filter((p) => p.alive && p.armor > 0).length;
    console.log(`t=90s alive=${m.alive} armed=${armed} armored=${armored}`);
  }
}
const alive = m.list.filter((p) => p.alive);
console.log(`t=150s alive=${m.alive} kills=${m.list.reduce((s, p) => s + p.kills, 0)} stuckEvents=${stuck} pathRequests=${paths} pathsFound=${pathOk} slides=${slides} wallJumps=${wallJumps}`);
