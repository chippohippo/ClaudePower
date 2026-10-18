// DeployScreen: dead, and where you go next (Battlefield's deploy screen; docs/FRONTLINE.md,
// "Deploying"). Client only.
//  * The recap first: who got you, as what, with what, from how far, and how much he had left; the
//    damage you took this life by who did it.
//  * Then the front from above (the sectors in their owner's colour, the points, your side, the
//    enemies your side knows of, where you fell) with every place you can deploy numbered on it:
//    the HQ, your side's points while they're quiet, your squadmates while they're out of trouble
//    (the session's spawnOptions; closed ones say why). Click one, or 1 to 9.
//  * Your class for the next life: any of your army's (its weapon and kit shown).
//  * Space or DEPLOY when the reinforcements are in (the countdown). The default: your squad
//    leader if he's clear, else the point nearest the front, else the HQ.

import { bus } from '../core/EventBus.js';
import { ROLE_TAG } from './FrontlineHud.js';
import { classTitle } from './MatchFlow.js';

const US = '#5ab4ff', THEM = '#ff4d4d', AMBER = '#ffc94d', NEUTRAL = '#aab1bd';
const AFTER = 1.8;        // s of the death cam before the screen
const KIND = { gun: null, melee: 'a blade', explosion: 'an explosion', splash: 'an explosion', artillery: 'artillery', strike: 'a strike', fall: 'the fall', crash: 'a crash', ram: 'a vehicle', ramSelf: 'a crash', vehicleExplosion: 'a vehicle blowing up', status: 'burns', deployable: 'a deployable', bleedOut: 'bleeding out', giveUp: 'giving up' };
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const CSS = `
#dp { position: absolute; inset: 0; display: none; z-index: 25; pointer-events: auto; background: linear-gradient(0deg, #07080ee8, #07080ec0 40%, #07080ed0); font-family: var(--text); }
#hud.deploying #fl-respawn, #hud.deploying #fl-dead, #hud.deploying #fl-banner { display: none !important; }
#dp .wrap { position: absolute; left: 50%; top: calc(var(--lb) + 22px); width: 1300px; transform: translateX(-50%) scale(var(--hz)); transform-origin: top center; }
#dp .recap { display: flex; gap: 18px; align-items: stretch; margin-bottom: 14px; }
#dp .who { flex: 1; background: #1a0d10d8; border: 1px solid #ff4d4d55; border-left: 3px solid ${THEM}; padding: 10px 16px; }
#dp .who small { font: 700 11px var(--disp); letter-spacing: .2em; color: #ff8b80; } #dp .who b { display: block; font: 800 24px var(--disp); letter-spacing: .08em; color: #fff; margin: 3px 0; }
#dp .who span { font: 600 15px var(--text); color: #d6dbe5; }
#dp .dmg { width: 360px; background: #0b0d14d8; border: 1px solid #ffffff1a; padding: 10px 14px; }
#dp .dmg h4, #dp h4 { margin: 0 0 6px; font: 800 11px var(--disp); letter-spacing: .2em; color: ${AMBER}; }
#dp .dmg div { display: flex; justify-content: space-between; font: 600 14px var(--text); color: #dfe4ec; } #dp .dmg div b { color: #ff9d94; }
#dp .main { display: grid; grid-template-columns: 290px 1fr 300px; gap: 14px; }
#dp .panel { background: #0b0d14d8; border: 1px solid #ffffff1a; padding: 12px; }
#dp .sp { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; cursor: pointer; background: #ffffff08; border: 1px solid #ffffff14; color: #e8ecf4; padding: 7px 9px; margin-bottom: 5px; font: 600 14px var(--text); }
#dp .sp kbd { font: 800 12px var(--disp); color: ${AMBER}; min-width: 14px; } #dp .sp b { font: 700 14px var(--disp); letter-spacing: .06em; } #dp .sp em { margin-left: auto; font-style: normal; font: 700 10px var(--disp); letter-spacing: .1em; color: #8a93a5; }
#dp .sp:hover { border-color: #ffffff55; } #dp .sp.on { border-color: ${AMBER}; background: #ffc94d1c; box-shadow: inset 0 0 0 1px ${AMBER}; }
#dp .sp.shut { opacity: .45; cursor: not-allowed; } #dp .sp.shut em { color: #ff8b80; }
#dp canvas { width: 100%; height: auto; display: block; background: #0b0e16; border: 1px solid #ffffff1a; cursor: pointer; }
#dp .cls { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
#dp .cl { cursor: pointer; background: #ffffff08; border: 1px solid #ffffff14; color: #e8ecf4; padding: 6px 8px; text-align: left; font: 700 13px var(--text); }
#dp .cl small { display: block; font: 700 9px var(--disp); letter-spacing: .12em; color: #8a93a5; } #dp .cl:hover { border-color: #ffffff55; }
#dp .cl.on { border-color: ${AMBER}; background: #ffc94d1c; box-shadow: inset 0 0 0 1px ${AMBER}; } #dp .cl.cur small { color: ${US}; }
#dp .kit { margin-top: 8px; font: 600 13px/1.45 var(--text); color: #c9d0dc; } #dp .kit b { color: #fff; }
#dp .bar { display: flex; align-items: center; justify-content: flex-end; gap: 18px; margin-top: 14px; }
#dp .bar .t { font: 700 15px var(--disp); letter-spacing: .14em; color: #c9d0dc; } #dp .bar .t b { color: ${AMBER}; }
#dp .go { font: 900 18px var(--disp); letter-spacing: .3em; padding: 14px 40px; border: 0; cursor: pointer; background: linear-gradient(90deg, #f2b632, ${AMBER}); color: #1a1408; }
#dp .go:disabled { filter: grayscale(1) brightness(.6); cursor: default; } #dp .go kbd { font: 700 10px var(--disp); margin-left: 10px; letter-spacing: .1em; }
`;

export class DeployScreen {
  /**
   * @param {HTMLElement} hud
   * @param {object} o { session, player, team, data (classes, kits), gunName: Map(id -> name), footprints: () => { canvas, ppm } | null }
   */
  constructor(hud, { session, player, team, data, gunName = new Map(), footprints = () => null }) {
    this.s = session; this.player = player; this.team = team; this.data = data; this.gunName = gunName; this.footprints = footprints; this.hud = hud;
    this.time = 0; this.deadAt = null; this.open = false; this.want = false;
    this.pick = null;              // the spawn option id chosen
    this.cls = player.classId;     // the class for the next life
    this.life = new Map();         // attacker id -> { dmg, what } this life
    this.recap = null;
    if (!document.getElementById('dp-css')) document.head.appendChild(Object.assign(document.createElement('style'), { id: 'dp-css', textContent: CSS }));
    this.el = Object.assign(document.createElement('div'), { id: 'dp' });
    this.el.innerHTML = `<div class="wrap"><div class="recap"><div class="who"></div><div class="dmg"></div></div>
      <div class="main"><div class="panel"><h4>DEPLOY</h4><div class="list"></div></div><div><canvas width="1360" height="640"></canvas></div>
      <div class="panel"><h4>CLASS · NEXT LIFE</h4><div class="cls"></div><div class="kit"></div></div></div>
      <div class="bar"><div class="t"></div><button class="go">DEPLOY<kbd>SPACE</kbd></button></div></div>`;
    hud.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas'); this.ctx = this.canvas.getContext('2d');
    this.el.querySelector('.go').onclick = () => { this.want = true; };
    this.canvas.onclick = (e) => this.#click(e);
    addEventListener('keydown', this.onKey = (e) => {
      if (!this.open) return;
      const k = +e.key;
      if (k >= 1 && k <= 9) { const o = this.options[k - 1]; if (o?.ok) { this.pick = o.id; this.#render(); } }
    });
    // What hurt you this life (Health calls onHit after every kind of damage).
    const base = player.onHit;
    player.onHit = (res, info, by) => { this.#hurt(res, info, by); return base?.(res, info, by); };
    this.off = [
      bus.on('entity:death', (e) => { if (e.id === player.id) this.#died(e); }),
      bus.on('fighter:deploy', (e) => { if (e.id === player.id) this.#deployed(); }),
    ];
  }

  dispose() { this.off.forEach((f) => f()); removeEventListener('keydown', this.onKey); this.el.remove(); }

  /** The respawn the player asked for: { spawn, classId } (the session's respawn takes it). */
  choice() { return { spawn: this.pick, classId: this.cls !== this.player.classId ? this.cls : null }; }

  /** The DEPLOY button was pressed since the last tick (taken). */
  takeWant() { const w = this.want; this.want = false; return w; }

  update(dt) {
    this.time += dt;
    const me = this.player;
    if (!me.health.dead) { this.pool = this.#pool(); this.down = me.health.downed; }   // (heals, shields back, revives: between hits)
    if (!me.health.dead || this.s.mode.winner >= 0) { if (this.open) this.#close(); return; }
    if (!this.open && this.deadAt != null && this.time - this.deadAt >= AFTER) this.#show();
    if (!this.open) return;
    this.options = this.s.spawnOptions(me.id);
    if (!this.pick || !this.options.find((o) => o.id === this.pick)?.ok) this.pick = this.#default();
    if ((this.renderAt ?? 0) <= this.time) { this.renderAt = this.time + 0.2; this.#render(); }
  }

  /** What's left to take: shields and health, or the downed pool. */
  #pool() {
    const h = this.player.health;
    return h.downed ? Math.max(0, h.downHp ?? 0) : Math.max(0, h.hp) + (h.shield ?? 0) + (h.overshield ?? 0);
  }

  #hurt(res, info, by) {
    if (!(res?.dealt > 0)) return;
    // What the hit took of your shields and health, not what it carried (a shell on your last few
    // points took a few points). Down, there's no more to take: whoever finishes you did just that.
    const down = !!this.down;
    const after = this.#pool(), lost = down ? 0 : res.downed ? this.pool ?? res.dealt : Math.max(0, (this.pool ?? after + res.dealt) - after);
    this.pool = after; this.down = down || res.downed;
    const id = by?.id ?? -1, l = this.life.get(id) ?? { dmg: 0, what: null, name: by?.name ?? null };
    l.dmg += lost; l.what = this.#what(info, by) ?? l.what;
    if (down && res.killed) l.finished = true;
    this.life.set(id, l);
  }

  #what(info, by) {
    if (info?.weapon) return this.gunName.get(info.weapon) ?? null;
    if (by?.isVehicle) return by.def?.name ?? 'a vehicle';
    return KIND[info?.kind] ?? null;
  }

  #died(e) {
    this.deadAt = this.time;
    const me = this.player, k = e.by != null ? this.s.world.entity(e.by) : null;
    const pos = me.movement.state.position;
    this.fell = { x: pos.x, z: pos.z };
    const driver = k?.isVehicle ? k.seats?.find((s) => s.occupant)?.occupant : null;
    const who = driver ?? k;
    this.recap = {
      name: k ? (k.isVehicle ? `${k.def?.name ?? 'a vehicle'}${driver ? ` · ${driver.name}` : ''}` : k.name ?? 'an enemy') : null,
      team: who?.team ?? null, cls: who?.classId ? classTitle(who.classId) : null,
      what: this.#what(e.info, k) ?? this.life.get(e.by)?.what ?? null,
      dist: k?.movement ? Math.round(k.movement.state.position.distanceTo(pos)) : null,
      left: who?.health && !who.health.dead ? Math.round(100 * who.health.hp / who.health.max) : null,
      how: e.how, friendly: who && who.team === me.team && who !== me, self: who === me,
      hits: [...this.life.entries()].sort((a, b) => b[1].dmg - a[1].dmg).slice(0, 4),
    };
  }

  #show() {
    this.open = true; this.pick = null; this.cls = this.cls ?? this.player.classId;
    this.hud.classList.add('deploying');
    this.el.style.display = 'block';
    document.exitPointerLock?.();
    this.options = this.s.spawnOptions(this.player.id);
    this.pick = this.#default();
    this.#recap(); this.#classes(); this.#render();
  }

  #close() {
    this.open = false;
    this.hud.classList.remove('deploying');
    this.el.style.display = 'none';
  }

  #deployed() {
    this.#close();
    this.life.clear(); this.deadAt = null; this.pool = this.#pool(); this.down = false;
    this.cls = this.player.classId;
  }

  /** Your squad leader if he's clear, else the point nearest the front, else the HQ. */
  #default() {
    const O = this.options ?? [];
    const lead = O.find((o) => o.kind === 'squad' && o.leader && o.ok) ?? O.find((o) => o.kind === 'squad' && o.ok);
    if (lead) return lead.id;
    const dir = this.team === 0 ? 1 : -1;
    const pts = O.filter((o) => o.kind === 'point' && o.ok).sort((a, b) => dir * (b.pos.x - a.pos.x));
    return pts[0]?.id ?? 'hq';
  }

  #recap() {
    const R = this.recap ?? {}, who = this.el.querySelector('.who'), dmg = this.el.querySelector('.dmg');
    const by = R.self ? 'YOURSELF' : R.name ? R.name.toUpperCase() : null;
    const head = R.how === 'gaveUp' ? 'YOU GAVE UP' : R.how === 'bledOut' && !by ? 'YOU BLED OUT' : R.friendly ? 'KILLED BY A TEAMMATE' : 'ELIMINATED BY';
    const line = [R.cls, R.what, R.dist != null ? `${R.dist} m` : null].filter(Boolean).map(esc).join(' · ');
    who.innerHTML = `<small>${head}</small><b style="color:${R.friendly ? AMBER : R.team === this.team ? US : THEM}">${esc(by ?? (R.what ? R.what.toUpperCase() : 'THE BATTLE'))}</b><span>${line}${R.left != null ? ` · ${R.left}% health left` : ''}</span>`;
    const hits = (R.hits ?? []).filter(([, l]) => l.dmg >= 1 || l.finished);
    dmg.innerHTML = `<h4>DAMAGE TAKEN</h4>${hits.length ? hits.map(([, l]) => `<div><span>${esc(l.name ?? 'the battle')}${l.what ? ` · ${esc(l.what)}` : ''}</span><b>${l.dmg >= 1 ? Math.round(l.dmg) : ''}${l.finished ? `${l.dmg >= 1 ? ' · ' : ''}FINISHED YOU` : ''}</b></div>`).join('') : '<div><span>—</span></div>'}`;
  }

  #classes() {
    const file = this.data.classes[this.team], box = this.el.querySelector('.cls');
    box.innerHTML = (file?.classes ?? []).map((c) => `<button class="cl${c.id === this.cls ? ' on' : ''}${c.id === this.player.classId ? ' cur' : ''}" data-c="${c.id}">${esc(classTitle(c.id))}<small>${ROLE_TAG[c.role] ?? ''}${c.id === this.player.classId ? ' · NOW' : ''}</small></button>`).join('');
    for (const b of box.querySelectorAll('.cl')) b.onclick = () => { this.cls = b.dataset.c; this.#classes(); };
    const c = file?.classes?.find((x) => x.id === this.cls), k = this.data.kits?.[this.cls] ?? {};
    const guns = (c?.loadout?.primary ?? []).map((w) => esc(this.gunName.get(w) ?? w)).join(' or ');
    const kit = [['Q', k.ability1], ['E', k.ability2], ['G', k.grenade], ['Z', k.super]].filter(([, a]) => a).map(([key, a]) => `${key} ${esc(a.name)}`).join(' · ');
    this.el.querySelector('.kit').innerHTML = c ? `<b>${esc(classTitle(c.id))}</b> · ${c.health} health${c.shield ? `, ${c.shield} shield` : ''}<br>${guns}<br>${kit}<br><span style="opacity:.8">${esc(c.passive?.desc ?? '')}</span>` : '';
  }

  /** World x, z to the map canvas: your side on the left whichever army you are. */
  #xf() {
    const b = this.s.map.bounds, W = this.canvas.width, H = this.canvas.height, pad = 24;
    const k = Math.min((W - 2 * pad) / (b.maxX - b.minX), (H - 2 * pad) / (b.maxZ - b.minZ));
    const ox = (W - k * (b.maxX - b.minX)) / 2, oz = (H - k * (b.maxZ - b.minZ)) / 2, flip = this.team === 1;
    return { k, b, ox, oz, flip, to: (x, z) => [ox + k * (flip ? b.maxX - x : x - b.minX), oz + k * (z - b.minZ)] };
  }

  #render() {
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height, X = this.#xf(), { k, b } = X;
    const mode = this.s.mode, team = this.team;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H);
    c.fillStyle = '#0b0e16'; c.fillRect(0, 0, W, H);
    // The sectors in their owner's colour, the buildings, the sector lines.
    for (const sec of this.s.map.sectors) {
      const o = mode.sectors[sec.index].owner;
      const [x0] = X.to(sec.x0, b.minZ), [x1, y1] = X.to(sec.x1, b.maxZ), [, y0] = X.to(sec.x0, b.minZ);
      if (o >= 0) { c.fillStyle = o === team ? '#5ab4ff1c' : '#ff4d4d1c'; c.fillRect(Math.min(x0, x1), y0, Math.abs(x1 - x0), y1 - y0); }
      c.strokeStyle = mode.isAttacked?.(sec.index) ? '#ffffff55' : '#ffffff1a'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0, y1); c.stroke();
    }
    const F = this.footprints?.();
    if (F?.canvas) {
      c.save(); c.globalAlpha = 0.8;
      c.translate(X.ox + (X.flip ? k * (b.maxX - b.minX) : 0), X.oz); c.scale(X.flip ? -k : k, k);
      c.drawImage(F.canvas, 0, 0, F.canvas.width / F.ppm, F.canvas.height / F.ppm);
      c.restore();
    }
    // Your side; the enemies your side knows of.
    for (const f of this.s.fighters) {
      if (f.health.dead || f.offField || !(f.team === 0 || f.team === 1)) continue;
      const known = f.team === team || this.s.intel?.[team]?.sees?.(f) || f.status?.has('revealed');
      if (!known) continue;
      const q = f.movement.state.position, [x, y] = X.to(q.x, q.z);
      c.fillStyle = f.team === team ? (f.squad === this.player.squad ? '#9fd3ff' : US) : THEM;
      c.beginPath(); c.arc(x, y, f.squad === this.player.squad ? 4.5 : 3, 0, Math.PI * 2); c.fill();
    }
    // The points.
    c.font = '700 15px HudDisplay, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const p of mode.points) {
      const [x, y] = X.to(p.pos.x, p.pos.z), col = p.owner === team ? US : p.owner >= 0 ? THEM : NEUTRAL;
      c.fillStyle = '#0b0d14e0'; c.strokeStyle = col; c.lineWidth = 2.5;
      c.beginPath(); c.arc(x, y, 15, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = col; c.fillText(p.name, x, y + 1);
    }
    // Where you fell.
    if (this.fell) { const [x, y] = X.to(this.fell.x, this.fell.z); c.strokeStyle = THEM; c.lineWidth = 3; c.beginPath(); c.moveTo(x - 7, y - 7); c.lineTo(x + 7, y + 7); c.moveTo(x + 7, y - 7); c.lineTo(x - 7, y + 7); c.stroke(); }
    // Where you can deploy, numbered.
    this.hits = [];
    (this.options ?? []).forEach((o, i) => {
      const [x, y] = X.to(o.pos.x, o.pos.z), on = o.id === this.pick, r = o.kind === 'point' ? 24 : 15;
      const dy = o.kind === 'point' ? 0 : -24;
      c.lineWidth = on ? 4 : 2; c.strokeStyle = on ? AMBER : o.ok ? '#e8ecf4' : '#ff8b80';
      c.setLineDash(o.ok ? [] : [4, 4]);
      c.beginPath(); c.arc(x, y + dy, r, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      c.fillStyle = on ? AMBER : o.ok ? '#e8ecf4' : '#ff8b80'; c.font = '800 13px HudDisplay, sans-serif';
      c.fillText(String(i + 1), x + r * 0.75, y + dy - r * 0.75);
      if (o.kind !== 'point') { c.font = '700 12px HudText, sans-serif'; c.fillText(o.kind === 'hq' ? 'HQ' : (o.label ?? '').toUpperCase(), x, y + dy); }
      this.hits.push({ id: o.id, ok: o.ok, x, y: y + dy, r: r + 6 });
    });
    // The list beside it.
    const list = this.el.querySelector('.list');
    list.innerHTML = (this.options ?? []).map((o, i) => {
      const name = o.kind === 'hq' ? 'HQ' : o.kind === 'point' ? `POINT ${o.label}` : `${(o.label ?? '').toUpperCase()}${o.leader ? ' · LEADER' : ''}`;
      return `<button class="sp${o.id === this.pick ? ' on' : ''}${o.ok ? '' : ' shut'}" data-id="${o.id}"><kbd>${i + 1}</kbd><b>${esc(name)}</b><em>${o.ok ? (o.kind === 'hq' ? 'REAR' : o.kind === 'point' ? 'SECURE' : 'SQUAD') : esc(o.why)}</em></button>`;
    }).join('');
    for (const el of list.querySelectorAll('.sp')) el.onclick = () => { const o = this.options.find((x) => x.id === el.dataset.id); if (o?.ok) { this.pick = o.id; this.#render(); } };
    const wait = Math.max(0, this.player.respawnAt - this.s.time);
    this.el.querySelector('.bar .t').innerHTML = wait > 0 ? `REINFORCEMENTS IN <b>${wait.toFixed(1)}</b>` : 'REINFORCEMENTS READY';
    this.el.querySelector('.go').disabled = wait > 0;
  }

  #click(e) {
    const r = this.canvas.getBoundingClientRect(), sx = this.canvas.width / r.width, sy = this.canvas.height / r.height;
    const x = (e.clientX - r.left) * sx, y = (e.clientY - r.top) * sy;
    const h = (this.hits ?? []).find((t) => Math.hypot(t.x - x, t.y - y) < t.r);
    if (h?.ok) { this.pick = h.id; this.#render(); }
  }
}
