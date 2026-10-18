// MatchFlow: the scoreboard, ribbons as they're earned, and the after-action report (docs/FRONTLINE.md,
// "Match flow"). Client only: it reads the session's MatchStats and keeps your career (Career.js).
//  * Hold P: the scoreboard. Both sides, best score first: place, squad, class, name, score, kills,
//    deaths, assists, revives, captures; you highlighted, the dead greyed. A big battle shows each
//    side's top 20, and you wherever you are.
//  * A ribbon you earn (MatchStats' ribbon:earn): its bar, its name and what it was for, under the
//    crosshair for a few seconds.
//  * The match over: five seconds on the battlefield, then the after-action report. Who won and
//    how; the tickets over the match with the sectors as they fell; your battle (score and place on
//    your side, the counts, the ribbons, the experience it earned and your rank's bar filling, a
//    rank or a medal gained); both sides' MVPs and boards. PLAY AGAIN (the same battle on the next
//    seed), MAIN MENU, KEEP WATCHING (and the report back from a button). The match goes into your
//    career once.

import { bus } from '../core/EventBus.js';
import { RIBBONS } from '../game/MatchStats.js';
import { loadCareer, saveCareer, recordMatch } from '../game/Career.js';
import { ROLE_TAG } from './FrontlineHud.js';
import { ribbonSvg } from './Ribbons.js';

const US = '#5ab4ff', THEM = '#ff4d4d', AMBER = '#ffc94d';
const SIDE = ['SOLARI DIRECTORATE', 'VOID LEGION'], SHORT = ['SOLARI', 'VOID'];
const HOW = {
  breakthrough: (w) => `${w} broke through to the enemy HQ`,
  tickets: (w) => `${w} ran the enemy out of reinforcements`,
  time: (w) => `${w} held more of the front when time ran out`,
};
const BIG = 20;          // rows a side shows on the scoreboard in a big battle (and you)
const AAR_ROWS = 10;     // ...and in the after-action report
const AFTER = 5;         // s on the battlefield after the end before the report
const TOAST = 3.6;       // s a ribbon stays up

/** lancer -> Lancer, prism_adept -> Prism Adept. */
export const classTitle = (id) => (id ? id.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : '');
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const CSS = `
#mf-board, #mf-aar { position: absolute; inset: 0; display: none; z-index: 30; }
#mf-board { pointer-events: none; }
#mf-board .wrap { position: absolute; left: 50%; top: calc(var(--lb) + 74px); transform: translateX(-50%) scale(var(--hz)); transform-origin: top center;
  width: 1180px; background: #090b12e8; border: 1px solid #ffffff1c; box-shadow: 0 10px 40px #000a; padding: 14px 16px 12px; }
.mf-head { display: flex; align-items: baseline; gap: 14px; font: 700 13px var(--disp); letter-spacing: .14em; color: #aab3c3; margin-bottom: 10px; }
.mf-head b { color: #fff; font-size: 16px; } .mf-head .sp { flex: 1; }
.mf-sides { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.mf-side h4 { margin: 0 0 4px; font: 800 15px var(--disp); letter-spacing: .16em; display: flex; justify-content: space-between; }
.mf-side h4 small { font: 700 12px var(--disp); opacity: .8; }
.mf-t { width: 100%; border-collapse: collapse; font: 600 14px var(--text); }
.mf-t th { font: 700 10px var(--disp); letter-spacing: .1em; color: #8a93a5; text-align: right; padding: 2px 5px; border-bottom: 1px solid #ffffff1c; }
.mf-t th:nth-child(-n+4) { text-align: left; }
.mf-t td { padding: 2px 5px; text-align: right; white-space: nowrap; border-bottom: 1px solid #ffffff08; }
.mf-t td:nth-child(-n+4) { text-align: left; }
.mf-t td.n { color: #7f889a; width: 20px; } .mf-t td.sq { font: 700 10px var(--disp); color: #8a93a5; width: 64px; overflow: hidden; text-overflow: ellipsis; max-width: 64px; }
.mf-t td.cl { font: 700 10px var(--disp); color: #9fb3d6; width: 30px; } .mf-t td.nm { max-width: 170px; overflow: hidden; text-overflow: ellipsis; }
.mf-t td.sc { font-weight: 700; color: #fff; }
.mf-t tr.me td { background: #ffc94d22; color: #ffe7a6; } .mf-t tr.me td.sc { color: #ffc94d; }
.mf-t tr.dead td { opacity: .45; } .mf-t tr.gap td { text-align: center; color: #677; padding: 0; line-height: .8; }
.mf-t .you { font: 700 9px var(--disp); color: #10131c; background: ${AMBER}; padding: 0 4px; margin-left: 5px; }
.mf-t .mvp { font: 700 9px var(--disp); color: #10131c; background: #e9eef2; padding: 0 4px; margin-left: 5px; }
.mf-keys { margin-top: 8px; font: 600 12px var(--text); color: #7f889a; text-align: right; }
#mf-toasts { position: absolute; left: 50%; top: 58%; transform: translateX(-50%) scale(var(--hz)); transform-origin: top center; display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: none; }
.mf-toast { display: flex; align-items: center; gap: 10px; background: #0b0d14d0; border: 1px solid #ffffff22; padding: 6px 14px 6px 8px; animation: mf-in .25s ease-out; }
.mf-toast b { font: 800 14px var(--disp); letter-spacing: .14em; color: #fff; } .mf-toast small { display: block; font: 600 12px var(--text); color: #aeb6c6; }
.mf-toast i { font: 700 12px var(--disp); color: ${AMBER}; font-style: normal; }
.mf-toast.out { opacity: 0; transition: opacity .4s; }
@keyframes mf-in { from { transform: translateY(8px) scale(.96); opacity: 0; } to { transform: none; opacity: 1; } }
#mf-aar { background: radial-gradient(ellipse at 50% 0%, #1b2236e6 0%, #07080ef2 70%); backdrop-filter: blur(6px); overflow: auto; }
#mf-aar .wrap { width: 1240px; margin: 0 auto; padding: calc(var(--lb) + 34px) 0 30px; transform: scale(var(--hz)); transform-origin: top center; }
.mf-res { text-align: center; }
.mf-res h1 { margin: 0; font: 900 64px/1 var(--disp); letter-spacing: .24em; }
.mf-res p { margin: 10px 0 0; font: 700 15px var(--disp); letter-spacing: .16em; color: #c8cfdc; text-transform: uppercase; }
.mf-tix { display: flex; justify-content: center; align-items: center; gap: 18px; margin: 16px 0 22px; font: 800 26px var(--disp); }
.mf-tix span { font: 700 12px var(--disp); letter-spacing: .14em; color: #aab3c3; }
.mf-cols { display: grid; grid-template-columns: 360px 1fr; gap: 18px; }
.mf-card { background: #0b0e16d9; border: 1px solid #ffffff1a; padding: 14px 16px; }
.mf-card h3 { margin: 0 0 10px; font: 800 13px var(--disp); letter-spacing: .2em; color: ${AMBER}; }
.mf-big { display: flex; align-items: baseline; gap: 12px; } .mf-big b { font: 900 38px var(--disp); color: #fff; } .mf-big span { font: 700 13px var(--disp); color: #aab3c3; letter-spacing: .1em; }
.mf-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 10px; margin: 12px 0; }
.mf-grid div { background: #ffffff08; padding: 6px 8px; } .mf-grid b { display: block; font: 800 20px var(--disp); color: #fff; } .mf-grid span { font: 700 10px var(--disp); letter-spacing: .12em; color: #8a93a5; }
.mf-ribs { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0 4px; min-height: 18px; } .mf-ribs .r { display: flex; align-items: center; gap: 6px; font: 700 12px var(--text); color: #dfe5ef; }
.mf-none { font: 600 13px var(--text); color: #7f889a; }
.mf-xp { margin-top: 12px; } .mf-xp .row { display: flex; justify-content: space-between; font: 600 13px var(--text); color: #c3cad7; padding: 1px 0; } .mf-xp .row.t { font: 800 14px var(--disp); color: #fff; border-top: 1px solid #ffffff1a; margin-top: 4px; padding-top: 5px; }
.mf-rank { margin-top: 12px; } .mf-rank .nm { display: flex; justify-content: space-between; font: 800 14px var(--disp); letter-spacing: .1em; } .mf-rank .nm span { color: #8a93a5; font-size: 11px; }
.mf-bar { height: 8px; background: #ffffff14; margin-top: 6px; position: relative; overflow: hidden; } .mf-bar i { position: absolute; left: 0; top: 0; bottom: 0; background: linear-gradient(90deg, #f2b632, ${AMBER}); transition: width 1.6s cubic-bezier(.2,.7,.2,1); }
.mf-up { margin-top: 8px; font: 800 13px var(--disp); letter-spacing: .16em; color: ${AMBER}; }
.mf-chart { margin-top: 4px; } .mf-chart text { font: 700 9px sans-serif; fill: #8a93a5; }
.mf-mvps { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 14px; }
.mf-mvp { display: flex; align-items: center; gap: 12px; } .mf-mvp .tag { font: 800 11px var(--disp); letter-spacing: .14em; color: #10131c; background: #e9eef2; padding: 3px 6px; }
.mf-mvp b { font: 800 17px var(--disp); } .mf-mvp span { font: 600 13px var(--text); color: #aab3c3; }
.mf-btns { display: flex; justify-content: center; gap: 12px; margin-top: 22px; }
.mf-btns button { font: 800 15px var(--disp); letter-spacing: .2em; padding: 13px 26px; cursor: pointer; border: 1px solid #ffffff3a; background: #0b0d14e0; color: #e8ecf4; }
.mf-btns button:hover { border-color: #ffffffa0; } .mf-btns button.go { background: linear-gradient(90deg, #f2b632, ${AMBER}); color: #1a1408; border-color: transparent; }
#mf-reopen { position: absolute; right: 18px; bottom: calc(var(--lb) + 18px); z-index: 29; display: none; font: 800 12px var(--disp); letter-spacing: .16em; padding: 9px 14px; cursor: pointer; border: 1px solid #ffffff3a; background: #0b0d14e0; color: #e8ecf4; }
`;

export class MatchFlow {
  /**
   * @param {HTMLElement} hud  the HUD root (#hud)
   * @param {object} o  { session, player, team, meta: { map, size, classId } (for your career) }
   */
  constructor(hud, { session, player, team, meta = {} }) {
    this.s = session; this.player = player; this.team = team; this.meta = meta; this.hud = hud;
    this.time = 0; this.endAt = null; this.shown = false; this.recorded = false; this.boardAt = 0;
    this.byId = new Map(session.fighters.map((f) => [f.id, f]));
    this.roles = new Map();
    for (const file of session.data.classes ?? []) for (const c of file.classes ?? []) this.roles.set(c.id, c.role);
    if (!document.getElementById('mf-css')) document.head.appendChild(Object.assign(document.createElement('style'), { id: 'mf-css', textContent: CSS }));
    const el = (id, html = '') => { const d = Object.assign(document.createElement('div'), { id }); d.innerHTML = html; hud.appendChild(d); return d; };
    this.el = { board: el('mf-board', '<div class="wrap"></div>'), toasts: el('mf-toasts'), aar: el('mf-aar') };
    this.el.reopen = Object.assign(document.createElement('button'), { id: 'mf-reopen', textContent: 'AFTER ACTION REPORT' });
    this.el.reopen.onclick = () => this.#showAAR();
    hud.appendChild(this.el.reopen);
    this.toasts = [];
    this.off = [
      bus.on('ribbon:earn', (e) => { if (e.id === player.id) this.#toast(e); }),
      bus.on('mode:victory', () => { this.endAt = this.time + AFTER; }),
    ];
  }

  dispose() { this.off.forEach((f) => f()); for (const e of Object.values(this.el)) e.remove(); }

  /** Per frame. `held`: the scoreboard key is down. */
  update(dt, { held = false } = {}) {
    this.time += dt;
    const show = held && !this.shown;
    this.el.board.style.display = show ? 'block' : 'none';
    if (show && this.time >= this.boardAt) { this.boardAt = this.time + 0.25; this.#board(); }
    for (const t of this.toasts) if (!t.out && this.time - t.at > TOAST) { t.out = true; t.el.classList.add('out'); setTimeout(() => t.el.remove(), 450); }
    this.toasts = this.toasts.filter((t) => this.time - t.at < TOAST + 1);
    if (this.endAt != null && !this.shown && !this.dismissed && this.time >= this.endAt) this.#showAAR();
  }

  // ---------------------------------------------------------------- the scoreboard
  #rows(team, limit, { mvp = null } = {}) {
    const board = this.s.match.board(team), me = this.player;
    let rows = board.map((l, i) => ({ l, i }));
    if (rows.length > limit) {
      const mine = rows.find((r) => r.l.id === me.id);
      rows = rows.slice(0, limit);
      if (mine && mine.i >= limit) rows.push({ gap: true }, mine);
    }
    return rows.map((r) => {
      if (r.gap) return '<tr class="gap"><td colspan="10">· · ·</td></tr>';
      const l = r.l, f = this.byId.get(l.id), you = l.id === me.id;
      const dead = f?.health.dead && !f.offField;
      const tag = ROLE_TAG[this.roles.get(l.classId)] ?? '';
      return `<tr class="${you ? 'me' : ''}${dead ? ' dead' : ''}"><td class="n">${r.i + 1}</td><td class="sq">${esc((l.squad ?? '').toUpperCase())}</td><td class="cl">${tag}</td>`
        + `<td class="nm">${esc(l.name)}${you ? '<span class="you">YOU</span>' : ''}${mvp && mvp.id === l.id ? '<span class="mvp">MVP</span>' : ''}</td>`
        + `<td class="sc">${fmt(l.score)}</td><td>${l.kills}</td><td>${l.deaths}</td><td>${l.assists}</td><td>${l.revives}</td><td>${l.captures}</td></tr>`;
    }).join('');
  }

  #table(team, limit, o) {
    return `<table class="mf-t"><tr><th>#</th><th>SQUAD</th><th></th><th>NAME</th><th>SCORE</th><th>K</th><th>D</th><th>A</th><th>REV</th><th>CAP</th></tr>${this.#rows(team, limit, o)}</table>`;
  }

  #board() {
    const M = this.s.mode, us = this.team, them = 1 - us;
    const left = Math.max(0, (M.cfg?.timeLimit ?? 0) - M.time);
    const side = (t) => `<div class="mf-side"><h4 style="color:${t === us ? US : THEM}">${SIDE[t]}<small>${fmt(M.tickets[t])} TICKETS</small></h4>${this.#table(t, BIG)}</div>`;
    this.el.board.firstChild.innerHTML = `<div class="mf-head"><b>SCOREBOARD</b><span>${esc(this.meta.mapName ?? '')}</span><span class="sp"></span><span>${clock(left)} LEFT</span></div>`
      + `<div class="mf-sides">${side(us)}${side(them)}</div><div class="mf-keys">K kills (downs count) · D deaths · A assists · REV revives · CAP points taken</div>`;
  }

  // ---------------------------------------------------------------- ribbons
  #toast(e) {
    const R = RIBBONS[e.ribbon];
    const d = Object.assign(document.createElement('div'), { className: 'mf-toast' });
    d.innerHTML = `${ribbonSvg(e.ribbon, 54, 16)}<div><b>${esc(R?.name.toUpperCase() ?? e.ribbon)} RIBBON</b>${e.count > 1 ? ` <i>×${e.count}</i>` : ''}<small>${esc(R?.desc ?? '')}</small></div>`;
    this.el.toasts.appendChild(d);
    this.toasts.push({ el: d, at: this.time });
  }

  // ---------------------------------------------------------------- the after-action report
  #showAAR() {
    this.shown = true; this.dismissed = false;
    document.exitPointerLock?.();
    this.el.board.style.display = 'none'; this.el.reopen.style.display = 'none';
    const rep = this.s.match.report(this.player.id), us = this.team, them = 1 - us;
    const me = rep.me ?? this.s.match.line(this.player);
    const won = rep.winner === us, mvp = !!me && rep.mvp[us]?.id === me.id;
    if (!this.recorded && me) {
      const c = loadCareer();
      this.result = recordMatch(c, me, { won, mvp, meta: { ...this.meta, side: us, at: Date.now() } });
      saveCareer(c);
      this.recorded = true;
    }
    const R = this.result;
    const how = (HOW[rep.reason] ?? ((w) => `${w} won`))(rep.winner >= 0 ? `The ${SIDE[rep.winner].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}` : 'Nobody');
    const ribs = Object.entries(me?.ribbons ?? {}).filter(([, n]) => n > 0);
    const xp = R?.xp, bf = R ? (R.before.span ? R.before.into / R.before.span : 1) : 0, af = R ? (R.after.span ? R.after.into / R.after.span : 1) : 0;
    const up = R && R.after.rank > R.before.rank;
    const card = me ? `<div class="mf-card"><h3>YOUR BATTLE</h3>
      <div class="mf-big"><b>${fmt(me.score)}</b><span>SCORE · #${rep.place || '—'} ON YOUR SIDE${mvp ? ' · MVP' : ''}</span></div>
      <div class="mf-grid">${[['KILLS', me.kills], ['DEATHS', me.deaths], ['ASSISTS', me.assists], ['REVIVES', me.revives], ['CAPTURES', me.captures], ['VEHICLES', me.vehicles]].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')}</div>
      <h3>RIBBONS</h3><div class="mf-ribs">${ribs.length ? ribs.map(([id, n]) => `<div class="r" title="${esc(RIBBONS[id]?.desc)}">${ribbonSvg(id)}${esc(RIBBONS[id]?.name ?? id)}${n > 1 ? ` ×${n}` : ''}</div>`).join('') : '<span class="mf-none">None this time.</span>'}</div>
      ${xp ? `<div class="mf-xp">${[['Score', xp.score], ['Saw it through', xp.finish], ['Victory', xp.win], ['Ribbons', xp.ribbons], ['MVP', xp.mvp]].filter(([, v]) => v).map(([k, v]) => `<div class="row"><span>${k}</span><span>+${fmt(v)}</span></div>`).join('')}<div class="row t"><span>EXPERIENCE</span><span>+${fmt(xp.total)}</span></div></div>
      <div class="mf-rank"><div class="nm">${esc((up ? R.after : R.before).title.toUpperCase())}<span>${R.after.span ? `${fmt(R.after.into)} / ${fmt(R.after.span)} XP` : 'TOP RANK'}</span></div><div class="mf-bar"><i style="width:${(up ? 0 : bf) * 100}%"></i></div>
      ${up ? `<div class="mf-up">RANK UP · ${esc(R.after.title.toUpperCase())}</div>` : ''}${R.medals.map((m) => `<div class="mf-up">${m.medal.toUpperCase()} MEDAL · ${esc((RIBBONS[m.ribbon]?.name ?? m.ribbon).toUpperCase())}</div>`).join('')}</div>` : ''}
    </div>` : '';
    const mvpCard = (t) => { const m = rep.mvp[t]; return `<div class="mf-mvp"><span class="tag">MVP</span><div><b style="color:${t === us ? US : THEM}">${esc(m?.name ?? '—')}</b><br><span>${m ? `${esc(classTitle(m.classId))} · ${fmt(m.score)} · ${m.kills} K · ${m.revives} REV` : SIDE[t]}</span></div></div>`; };
    this.el.aar.innerHTML = `<div class="wrap">
      <div class="mf-res"><h1 style="color:${won ? US : THEM}">${won ? 'VICTORY' : 'DEFEAT'}</h1><p>${esc(how)} · ${clock(rep.duration)}</p></div>
      <div class="mf-tix"><span>${SHORT[us]}</span><b style="color:${US}">${fmt(rep.tickets[us])}</b><span>TICKETS</span><b style="color:${THEM}">${fmt(rep.tickets[them])}</b><span>${SHORT[them]}</span></div>
      <div class="mf-cols"><div>${card}<div class="mf-card" style="margin-top:14px"><h3>THE BATTLE</h3>${this.#chart(rep)}</div></div>
      <div class="mf-card"><div class="mf-mvps">${mvpCard(us)}${mvpCard(them)}</div><div class="mf-sides">
        <div class="mf-side"><h4 style="color:${US}">${SIDE[us]}</h4>${this.#table(us, AAR_ROWS, { mvp: rep.mvp[us] })}</div>
        <div class="mf-side"><h4 style="color:${THEM}">${SIDE[them]}</h4>${this.#table(them, AAR_ROWS, { mvp: rep.mvp[them] })}</div></div></div></div>
      <div class="mf-btns"><button class="go" data-a="again">PLAY AGAIN</button><button data-a="menu">MAIN MENU</button><button data-a="watch">KEEP WATCHING</button></div></div>`;
    this.el.aar.style.display = 'block';
    this.el.aar.querySelector('[data-a="again"]').onclick = () => { const q = new URLSearchParams(location.search); q.set('seed', String((+q.get('seed') || 1) + 1)); location.href = `index.html?${q}`; };
    this.el.aar.querySelector('[data-a="menu"]').onclick = () => { location.href = 'start.html'; };
    this.el.aar.querySelector('[data-a="watch"]').onclick = () => { this.el.aar.style.display = 'none'; this.el.reopen.style.display = 'block'; this.shown = false; this.dismissed = true; };
    // The rank bar fills (from where it was to where it is) once it's on screen.
    const bar = this.el.aar.querySelector('.mf-bar i');
    if (bar) requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = `${af * 100}%`; }));
  }

  /** The tickets over the match, both sides, with the sectors as they changed hands. */
  #chart(rep) {
    const W = 328, H = 120, P = 6, us = this.team;
    const S = rep.samples, T = Math.max(1, rep.duration), top = Math.max(1, ...S.flatMap((s) => s.tickets));
    const x = (t) => P + (W - 2 * P) * Math.min(1, t / T), y = (v) => H - 14 - (H - 26) * (v / top);
    const line = (team, c) => `<polyline fill="none" stroke="${c}" stroke-width="2" points="${S.map((s) => `${x(s.t).toFixed(1)},${y(s.tickets[team]).toFixed(1)}`).join(' ')}"/>`;
    const flips = rep.flips.map((f) => `<line x1="${x(f.t).toFixed(1)}" x2="${x(f.t).toFixed(1)}" y1="6" y2="${H - 14}" stroke="${f.team === us ? US : THEM}" stroke-opacity=".55" stroke-dasharray="3 3"/>`
      + `<text x="${x(f.t).toFixed(1)}" y="${H - 3}" text-anchor="middle">${String.fromCharCode(64 + f.sector)}</text>`).join('');
    return `<svg class="mf-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect x="${P}" y="6" width="${W - 2 * P}" height="${H - 20}" fill="#ffffff05"/>${flips}${line(1 - us, THEM)}${line(us, US)}</svg>`
      + `<div class="mf-none">Tickets over ${clock(rep.duration)}; the dashed lines are sectors taken (blue yours, red theirs).</div>`;
  }
}

