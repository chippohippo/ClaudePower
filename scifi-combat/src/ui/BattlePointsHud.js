// BattlePointsHud: what your battle points are doing (docs/GAMEPLAY_PLAN.md §5). A column of
// "+100 TAKEDOWN" lines under the crosshair, one per thing you did, each fading after 2.5 s;
// repeats of the same thing within 2 s add up on one line ("+150 ASSIST ×3"), so holding a
// point ticks up one DEFENDING line instead of a stream. What you spend and what dying costs
// you show in the same column. (The total is on the status panel.)

import { bus } from '../core/EventBus.js';

const LABEL = {
  kill: 'Takedown', finish: 'Finished', assist: 'Assist', vehicle: 'Vehicle destroyed', object: 'Deployable destroyed',
  revive: 'Revive', resupply: 'Resupply', heal: 'Heal', build: 'Dug in', repair: 'Repair', capture: 'Point captured',
  neutralize: 'Point neutralized', defend: 'Defending', deliver: 'Supplies delivered', spot: 'Spot assist', teamkill: 'Teamkill',
};
const CSS = `
#bp-pop { position: absolute; left: calc(50% + 48px); top: calc(50% + 34px); pointer-events: none; font: 800 12px system-ui;
  letter-spacing: .08em; text-transform: uppercase; text-shadow: 0 0 6px #000, 0 0 2px #000; }
#bp-pop div { white-space: nowrap; line-height: 17px; }
#bp-pop b { color: #ffe14d; margin-right: 6px; }
#bp-pop .neg b, #bp-pop .neg { color: #ff6b5c; }
#bp-pop .spend b { color: #9fd3ff; }
`;

export class BattlePointsHud {
  /** @param {HTMLElement} root the HUD @param {object} o { player, world } */
  constructor(root, { player, world }) {
    this.player = player; this.world = world;
    this.time = 0;
    if (!document.getElementById('bp-css')) document.head.appendChild(Object.assign(document.createElement('style'), { id: 'bp-css', textContent: CSS }));
    this.el = Object.assign(document.createElement('div'), { id: 'bp-pop' });
    root.appendChild(this.el);
    this.lines = [];                       // { key, text, amount, n, t, cls }
    const mine = (e) => e.id === player.id;
    this.off = [
      bus.on('bp:earn', (e) => { if (mine(e)) this.#add(e.why, LABEL[e.why] ?? e.why, e.amount, e.amount < 0 ? 'neg' : ''); }),
      bus.on('bp:spend', (e) => { if (mine(e)) this.#add(`spend:${e.what}`, world.stratagems?.defs[e.what]?.name ?? e.what, -e.amount, 'spend'); }),
      bus.on('bp:death', (e) => { if (mine(e)) this.#add('death', 'Lost on death', -e.lost, 'neg'); }),
    ];
  }

  dispose() { this.off.forEach((f) => f()); this.el.remove(); }

  #add(key, text, amount, cls) {
    const last = this.lines.find((l) => l.key === key && this.time - l.t < 2);
    if (last) { last.amount += amount; last.n++; last.t = this.time; }
    else this.lines.unshift({ key, text, amount, n: 1, t: this.time, cls });
    this.lines.length = Math.min(this.lines.length, 5);
    this.dirty = true;
  }

  update(dt) {
    this.time += dt;
    const live = this.lines.filter((l) => this.time - l.t < 2.5);
    if (live.length !== this.lines.length) { this.lines = live; this.dirty = true; }
    if (this.dirty) {
      this.el.innerHTML = this.lines.map((l) => `<div class="${l.cls}"><b>${l.amount > 0 ? '+' : '−'}${Math.abs(l.amount)}</b>${l.text}${l.n > 1 && l.key !== 'defend' ? ` ×${l.n}` : ''}</div>`).join('');
      this.dirty = false;
    }
    // Each line fades over its last half second.
    this.lines.forEach((l, i) => { const el = this.el.children[i]; if (el) el.style.opacity = Math.min(1, (2.5 - (this.time - l.t)) * 2).toFixed(2); });
  }
}
