// FieldManual: teaching the game while it's played (docs/FRONTLINE.md, "Learning the game"). The
// reviews' commonest complaint about big team shooters is that they're opaque to a newcomer; the
// fix that works is telling him the one thing he needs at the moment he needs it.
//  * The briefing, as the battle starts: the battlefield, your side's job right now (attack sector
//    B: take B1 and B2; or hold), your squad, and the verbs that matter first.
//  * Hints when each is first useful, one at a time, a few seconds each, never two close together:
//    ping your squad, revive a teammate down near you, being downed, call-ins, an empty vehicle,
//    shells landing near, low ammo, digging in under fire, taking a point, the scoreboard. Each
//    stops once you've done the thing (or after it's been shown three times), across matches: the
//    career keeps it (Career.js `hints`). The options can turn them off.

import { bus } from '../core/EventBus.js';
import { lowOnAmmo } from '../combat/Stratagems.js';

export const HINTS = {
  ping:    { keys: ['MMB', 'Y'], text: 'Ping: mark an enemy for your whole side, or send your squad to a point or a place. Tap twice for danger; hold for the wheel.', learn: 'ping' },
  revive:  { keys: ['X'], text: 'A teammate is down near you. Hold X beside them to get them back up.', learn: 'revive' },
  downed:  { keys: ['W', 'A', 'S', 'D'], text: 'You\'re down. Crawl into cover and wait for a medic, or hold Space to give up and redeploy.', max: 2 },
  callin:  { keys: ['Tab'], text: 'Your call-ins are ready. Hold Tab, type the code with W A S D, then throw the beacon.', learn: 'callin' },
  vehicle: { keys: ['X'], text: 'An empty vehicle. X to get in; guns and supply trucks want crews too.', learn: 'vehicle' },
  shells:  { keys: [], text: 'Shells whistle before they land. Get into a trench, or behind something solid.', max: 2 },
  ammo:    { keys: ['MMB'], text: 'Low on ammo. Hold the ping key for the wheel and ask for some, or find an engineer\'s pack.', learn: 'ammo' },
  dig:     { keys: ['H'], text: 'Under fire in the open? Hold H to dig in: a foxhole, then sandbags, then a trench.', learn: 'dig' },
  capture: { keys: [], text: 'Stay inside the circle to take the point. More of you take it faster.', max: 2 },
  score:   { keys: ['P'], text: 'Hold P for the scoreboard: everyone\'s score, kills, revives and captures.', learn: 'score' },
};
const ORDER = ['downed', 'revive', 'shells', 'ammo', 'callin', 'vehicle', 'capture', 'dig', 'ping', 'score'];
const SHOW = 7;          // s a hint stays up
const GAP = 14;          // s between two hints
const MAX = 3;           // times a hint is shown before it's taken as known

/** Whether hint `id` may still be shown: not learned, not over its count, not already this match. */
export function wants(state, id, thisMatch) {
  const h = state[id] ?? {};
  return !h.learned && (h.seen ?? 0) < (HINTS[id].max ?? MAX) && !thisMatch.has(id);
}

/**
 * The hint to show now, or null. `ctx`: { t (s into the match), downed, mateDown, callins, vehicle,
 * shells, lowAmmo, dig, capture } (what's true right now); `state`: the career's hints; `thisMatch`:
 * the ones shown this match; `last`: when the last one went up.
 */
export function nextHint(ctx, state, thisMatch, last) {
  if (ctx.t - last < GAP && last > -1e9) return null;
  const now = {
    downed: ctx.downed, revive: ctx.mateDown, shells: ctx.shells, ammo: ctx.lowAmmo, callin: ctx.callins && ctx.t > 40,
    vehicle: ctx.vehicle, capture: ctx.capture, dig: ctx.dig, ping: ctx.t > 14, score: ctx.t > 120,
  };
  for (const id of ORDER) if (now[id] && wants(state, id, thisMatch)) return id;
  return null;
}

const CSS = `
#fm-brief { position: absolute; left: 50%; top: calc(var(--lb) + 92px); transform: translateX(-50%) scale(var(--hz)); transform-origin: top center; width: 760px; text-align: center;
  background: linear-gradient(90deg, #0b0d1400, #0b0d14d8 18%, #0b0d14d8 82%, #0b0d1400); padding: 14px 40px 12px; opacity: 0; transition: opacity .6s; pointer-events: none; }
#fm-brief.on { opacity: 1; }
#fm-brief .m { font: 700 12px var(--disp); letter-spacing: .3em; color: #aab3c3; }
#fm-brief .o { font: 900 26px var(--disp); letter-spacing: .14em; margin: 6px 0 4px; }
#fm-brief .t { font: 600 16px var(--text); color: #e3e8f0; }
#fm-brief .k { margin-top: 10px; display: flex; justify-content: center; gap: 16px; flex-wrap: wrap; font: 600 14px var(--text); color: #c9d0dc; }
.fm-key { display: inline-block; min-width: 18px; padding: 1px 6px; margin-right: 5px; border: 1px solid #ffffff55; border-bottom-width: 2px; font: 700 11px var(--disp); color: #fff; background: #ffffff10; }
#fm-hint { position: absolute; left: 50%; bottom: calc(var(--lb) + 132px); transform: translateX(-50%) scale(var(--hz)); transform-origin: bottom center; max-width: 620px; display: flex; gap: 12px; align-items: center;
  background: #0b0d14e0; border: 1px solid #ffffff22; border-left: 3px solid #ffc94d; padding: 9px 16px 9px 12px; opacity: 0; transition: opacity .35s, transform .35s; pointer-events: none; }
#fm-hint.on { opacity: 1; }
#fm-hint .tag { font: 800 10px var(--disp); letter-spacing: .2em; color: #ffc94d; white-space: nowrap; }
#fm-hint .ks { flex: none; white-space: nowrap; }
#fm-hint .tx { font: 600 15px/1.35 var(--text); color: #eef2f8; }
`;

export class FieldManual {
  /**
   * @param {HTMLElement} hud
   * @param {object} o { session, player, team, input, enabled, state: the career's hints (changed in place), save() }
   */
  constructor(hud, { session, player, team, input, enabled = true, state = {}, save = () => {}, mapLabel = '' }) {
    this.s = session; this.player = player; this.team = team; this.input = input; this.enabled = enabled; this.state = state; this.save = save;
    this.time = 0; this.last = -1e9; this.next = 0; this.shown = new Set(); this.shellAt = -1e9; this.until = 0;
    if (!document.getElementById('fm-css')) document.head.appendChild(Object.assign(document.createElement('style'), { id: 'fm-css', textContent: CSS }));
    this.brief = Object.assign(document.createElement('div'), { id: 'fm-brief' });
    this.hint = Object.assign(document.createElement('div'), { id: 'fm-hint' });
    hud.append(this.brief, this.hint);
    const me = player.id;
    const learn = (id) => { const h = (this.state[id] ??= {}); if (!h.learned) { h.learned = true; this.save(); } };
    this.off = [
      bus.on('ping:add', (e) => { if (e.by === me) { learn('ping'); if (e.kind === 'ammo') learn('ammo'); } }),
      bus.on('entity:revived', (e) => { if (e.by === me && e.fromDown) learn('revive'); }),
      bus.on('stratagem:thrown', (e) => { if (e.id === me) learn('callin'); }),
      bus.on('fort:built', (e) => { if (e.by === me) learn('dig'); }),
      bus.on('artillery:impact', (e) => {
        const p = e.point, q = player.movement.state.position;
        if (p && Math.hypot((p.x ?? p[0]) - q.x, (p.z ?? p[2]) - q.z) < 40) this.shellAt = this.time;
      }),
    ];
    this.#briefing(mapLabel);
  }

  dispose() { this.off.forEach((f) => f()); this.brief.remove(); this.hint.remove(); }

  #briefing(mapLabel) {
    const M = this.s.mode, team = this.team, O = M.objectives(team);
    const side = team === 0 ? 'SOLARI DIRECTORATE' : 'VOID LEGION', col = '#5ab4ff';   // (your side is blue on your screen)
    const letter = (pts) => (pts[0] ? String.fromCharCode(64 + pts[0].sector) : '');
    const names = (pts) => pts.map((p) => p.name).join(pts.length > 2 ? ', ' : ' and ').replace(/, ([^,]*)$/, ' and $1');
    const job = O.attack.length ? `ATTACK SECTOR ${letter(O.attack)}` : 'HOLD THE LINE';
    const how = O.attack.length ? `Take ${names(O.attack)} to move the front.` : 'Hold every point you have.';
    const sq = this.player.squad?.callsign;
    this.brief.innerHTML = `<div class="m">${side} · ${mapLabel.toUpperCase()}</div><div class="o" style="color:${col}">${job}</div>`
      + `<div class="t">${how}${sq ? ` You lead ${sq.toUpperCase()}: they follow you and cover you when you stop.` : ''}</div>`
      + `<div class="k"><span><i class="fm-key">MMB</i>ping your squad</span><span><i class="fm-key">TAB</i>call-ins</span><span><i class="fm-key">X</i>revive</span><span><i class="fm-key">P</i>scoreboard</span><span><i class="fm-key">F1</i>controls</span></div>`;
    requestAnimationFrame(() => this.brief.classList.add('on'));
    this.briefUntil = 10;
  }

  /** Per frame. */
  update(dt) {
    this.time += dt;
    if (this.briefUntil != null && this.time > this.briefUntil) { this.brief.classList.remove('on'); this.briefUntil = null; }
    if (this.input?.keys?.has('KeyP') && !this.state.score?.learned) { (this.state.score ??= {}).learned = true; this.save(); }
    if (this.hint.classList.contains('on') && this.time > this.until) this.hint.classList.remove('on');
    if (!this.enabled || this.time < this.next || this.s.mode.winner >= 0) return;
    this.next = this.time + 0.5;
    const me = this.player, h = me.health, p = me.movement.state.position;
    if (h.dead || me.offField) return;
    let mateDown = false, vehicle = false, capture = false;
    if (h.up && !me.vehicle) {
      this.s.world.fightersNear(p, 15, (f) => { if (!mateDown && f !== me && f.team === me.team && f.health?.downed && !f.isVehicle && f.movement.state.position.distanceTo(p) < 15) mateDown = true; });
      const v = this.s.world.vehicles?.nearestEnterable?.(me);
      vehicle = !!v && v.team === me.team;
      for (const pt of this.s.mode.points) if (pt.owner !== me.team && this.s.mode.capturable(pt) && Math.hypot(pt.pos.x - p.x, pt.pos.z - p.z) < pt.radius) capture = true;
    }
    const ctx = {
      t: this.time, downed: h.downed, mateDown, vehicle, capture,
      callins: !!me.stratagems && h.up, shells: this.time - this.shellAt < 3, lowAmmo: h.up && !me.vehicle && lowOnAmmo(me),
      dig: this.s.map.theme === 'trench' && h.up && !me.vehicle && h.sinceDamage < 2,
    };
    const id = nextHint(ctx, this.state, this.shown, this.last);
    if (!id) return;
    const H = HINTS[id];
    this.shown.add(id); this.last = this.time; this.until = this.time + SHOW;
    const s = (this.state[id] ??= {}); s.seen = (s.seen ?? 0) + 1; this.save();
    this.hint.innerHTML = `<span class="tag">FIELD MANUAL</span><span class="ks">${H.keys.map((k) => `<i class="fm-key">${k}</i>`).join('')}</span><span class="tx">${H.text}</span>`;
    this.hint.classList.add('on');
  }
}
