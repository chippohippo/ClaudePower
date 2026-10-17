// StratagemPanel: the call-in HUD (docs/GAMEPLAY_PLAN.md §2), in the art direction's UI language
// (yellow and white on dark clipped panels, uppercase).
//  * While the call-in is held: every stratagem in your loadout with its code as arrows; the
//    arrows you've typed light up on the codes that still match, the rest dim; cooldowns and
//    uses (and the rearm) where a stratagem isn't ready.
//  * Beacon in hand: which one, and how to throw it or put it away.
//  * Every live beacon of your side on screen (or pinned to the edge): its name, a countdown to
//    the payload, and DANGER CLOSE in red when you're inside a strike's radius.
//  * Grabbing at a supply cache: a prompt when you're beside one.

import * as THREE from 'three';
import { bus } from '../core/EventBus.js';
import { capsuleDist } from '../combat/Stratagems.js';

const GLYPH = { U: '▲', D: '▼', L: '◀', R: '▶' };
const KIND_COL = { strike: '#ff6a4d', supply: '#6cc3ff', sentry: '#7dff9a', smoke: '#e6e2da' };
const _v = new THREE.Vector3();

const CSS = `
#sg-panel { position: absolute; left: calc(50% - 360px); top: 50%; transform: translateY(-50%); min-width: 250px; display: none;
  background: rgba(11,12,14,0.82); padding: 8px 10px 6px; border-left: 3px solid #ffe14d; font: 600 12px system-ui; letter-spacing: .05em;
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%); }
#sg-panel h4 { margin: 0 0 6px; font: 800 11px system-ui; letter-spacing: .14em; color: #ffe14d; text-transform: uppercase; }
#sg-panel .row { display: flex; align-items: center; gap: 8px; padding: 3px 0; text-transform: uppercase; }
#sg-panel .row .ic { width: 6px; height: 18px; }
#sg-panel .row .nm { flex: 1; color: #f4f1e8; }
#sg-panel .row .cd { font-size: 15px; letter-spacing: 2px; color: #a9a49a; }
#sg-panel .row .cd b { color: #ffe14d; }
#sg-panel .row.dead { opacity: .32; }
#sg-panel .row .st { font-size: 10px; color: #a9a49a; min-width: 56px; text-align: right; }
#sg-panel .tip { margin-top: 6px; font-size: 10px; color: #a9a49a; text-transform: uppercase; }
.sg-mark { position: absolute; transform: translate(-50%, -100%); text-align: center; font: 800 11px system-ui; letter-spacing: .08em;
  text-transform: uppercase; text-shadow: 0 0 6px #000, 0 0 2px #000; white-space: nowrap; pointer-events: none; }
.sg-mark .t { font-size: 15px; }
.sg-mark .dc { color: #ff4d40; font-size: 10px; }
#sg-prompt { position: absolute; left: 50%; top: 62%; transform: translateX(-50%); font: 700 13px system-ui; color: #6cc3ff; text-shadow: 0 0 8px #000; display: none; text-transform: uppercase; letter-spacing: .06em; }
`;

export class StratagemPanel {
  /**
   * @param {HTMLElement} root  the HUD
   * @param {object} o { world, player, colors: by payload kind (palette.json `stratagem`) }
   */
  constructor(root, { world, player, colors = {} }) {
    this.world = world; this.player = player;
    this.col = { ...KIND_COL, ...colors };
    if (!document.getElementById('sg-css')) document.head.appendChild(Object.assign(document.createElement('style'), { id: 'sg-css', textContent: CSS }));
    this.el = Object.assign(document.createElement('div'), { id: 'sg-panel' });
    this.prompt = Object.assign(document.createElement('div'), { id: 'sg-prompt' });
    this.marks = Object.assign(document.createElement('div'), { style: 'position:absolute;inset:0;pointer-events:none' });
    root.append(this.el, this.prompt, this.marks);
    this.pool = [];
    this.flash = 0;                         // a wrong arrow flashes the panel red
    this.off = [bus.on('stratagem:error', (e) => { if (e.id === player.id) this.flash = 0.25; })];
  }

  dispose() { this.off.forEach((f) => f()); this.el.remove(); this.prompt.remove(); this.marks.remove(); }

  update(dt, camera) {
    const S = this.player.stratagems;
    this.flash = Math.max(0, this.flash - dt);
    if (S && S.state !== 'idle' && !this.player.health.dead) this.#panel(S);
    else this.el.style.display = 'none';
    this.#beacons(camera);
    this.#supplyPrompt();
  }

  #panel(S) {
    const typed = S.code;
    let html = `<h4>${S.state === 'armed' ? 'Beacon ready' : 'Call-in'}</h4>`;
    if (S.state === 'armed') {
      const d = S.armed.def;
      html += `<div class="row"><i class="ic" style="background:${this.col[d.kind] ?? '#ffe14d'}"></i><span class="nm">${d.name}</span></div>`;
      html += `<div class="tip">LMB throw · Tab put away</div>`;
    } else {
      for (const s of S.slots) {
        const ready = S.ready(s), match = ready && s.def.code.startsWith(typed);
        const code = [...s.def.code].map((c, i) => (match && i < typed.length ? `<b>${GLYPH[c]}</b>` : GLYPH[c])).join('');
        const st = s.cooldown > 0 ? `${Math.ceil(s.cooldown)}s` : s.rearm > 0 ? `rearm ${Math.ceil(s.rearm)}s` : Number.isFinite(s.uses) ? `${s.uses}/${s.def.uses}` : '';
        html += `<div class="row${match ? '' : ' dead'}"><i class="ic" style="background:${this.col[s.def.kind] ?? '#ffe14d'}"></i><span class="nm">${s.def.name}</span><span class="cd">${code}</span><span class="st">${st}</span></div>`;
      }
      html += `<div class="tip">Hold Tab · type with WASD or the arrows</div>`;
    }
    this.el.innerHTML = html;
    this.el.style.display = 'block';
    this.el.style.borderLeftColor = this.flash > 0 ? '#ff4d40' : '#ffe14d';
  }

  /** Markers over our live beacons: name, countdown, DANGER CLOSE inside a strike's radius. */
  #beacons(camera) {
    const team = this.player.team, live = this.world.stratagems?.live(team) ?? [];
    const me = this.player.movement.state.position;
    let n = 0;
    for (const b of live) {
      _v.copy(b.pos); _v.y += 2.2; _v.project(camera);
      if (_v.z > 1) continue;
      const el = this.pool[n] ?? (this.pool[n] = this.marks.appendChild(Object.assign(document.createElement('div'), { className: 'sg-mark' })));
      n++;
      const x = Math.max(24, Math.min(innerWidth - 24, (_v.x * 0.5 + 0.5) * innerWidth)), y = Math.max(40, Math.min(innerHeight - 20, (-_v.y * 0.5 + 0.5) * innerHeight));
      const def = this.world.stratagems.defs[b.stratagem];
      const close = b.kind === 'strike' && capsuleDist(b.zone, me.x, me.z) < 3;   // inside its footprint, or 3 m from it
      el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.color = this.col[b.kind] ?? '#ffe14d'; el.style.display = 'block';
      el.innerHTML = `${def?.name ?? b.stratagem}<br><span class="t">${b.eta > 0 ? b.eta.toFixed(1) : '▼'}</span>${close ? '<br><span class="dc">Danger close</span>' : ''}`;
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].style.display = 'none';
  }

  #supplyPrompt() {
    const me = this.player.movement.state.position;
    const near = (this.world.stratagems?.pods ?? []).find((p) => p.landed && p.contents === 'supply' && p.grabs > 0 && Math.hypot(p.pos.x - me.x, p.pos.z - me.z) < 2.4);
    this.prompt.style.display = near && !this.player.health.dead ? 'block' : 'none';
    if (near) this.prompt.textContent = `X · take supplies (${near.grabs} left)`;
  }
}
