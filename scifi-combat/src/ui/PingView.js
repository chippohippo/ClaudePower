// PingView: pings in the client (docs/FRONTLINE.md, "Pings"): what you press, the wheel, the marks.
//  * Middle mouse or Y, tapped: a ping on what's under the crosshair. An enemy (or one you can see
//    within a couple of degrees of it), a capture point (attack it, or defend it if it's ours), else
//    the ground there (move). Tapped twice: danger. Held: the wheel (move, attack, defend, regroup,
//    medic, ammo, danger), picked with the mouse (the view holds still), sent on release.
//  * Every ping of your side: its icon over it in the kind's colour, what it is (the enemy's name),
//    how far, and who pinged it if it wasn't you; fading in its last second. Off screen it's held in
//    a lane inside the screen's edge, with an arrow toward it: yours, your squad's, and orders and
//    calls for help (not every enemy the side calls out). A point pinged lights up the point's own
//    marker instead. (The minimap shows them too: FrontlineHud; the blip is the AudioDirector's.)

import * as THREE from 'three';

const HOLD = 0.25;          // s held: the wheel instead of a ping
const DOUBLE = 0.35;        // s between two taps: danger
const ASSIST = 2.5 * Math.PI / 180;   // an enemy this close to the crosshair counts
const RANGE = 320;
const COLOR = { enemy: '#ff4d4d', move: '#5ab4ff', attack: '#ffc94d', defend: '#5ab4ff', danger: '#ff8a3d', regroup: '#7fe0a0', medic: '#7fe0a0', ammo: '#ffc94d' };
const ICON = {
  enemy: 'M12 3l8 9-8 9-8-9z',
  move: 'M12 22s-7-7.5-7-12a7 7 0 0114 0c0 4.5-7 12-7 12zm0-15a3 3 0 100 6 3 3 0 000-6z',
  attack: 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 4a5 5 0 110 10 5 5 0 010-10zM12 1v5M12 18v5M1 12h5M18 12h5',
  defend: 'M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z',
  danger: 'M12 2l10 19H2zM12 9v6M12 17v2',
  regroup: 'M12 4a8 8 0 100 16 8 8 0 000-16zm0 5a3 3 0 100 6 3 3 0 000-6z',
  medic: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
  ammo: 'M6 21V9l2-5 2 5v12zM11 21V9l2-5 2 5v12zM16 21V9l2-5 2 5v12z',
};
const WHEEL = ['move', 'attack', 'defend', 'danger', 'ammo', 'medic', 'regroup'];
const SAY = { move: 'MOVE', attack: 'ATTACK', defend: 'DEFEND', danger: 'DANGER', ammo: 'AMMO', medic: 'MEDIC', regroup: 'REGROUP' };   // (on the wheel)
const svg = (k, c) => `<svg viewBox="0 0 24 24" width="22" height="22"><path d="${ICON[k]}" fill="${k === 'enemy' || k === 'medic' || k === 'defend' ? c : 'none'}" fill-opacity="${k === 'enemy' ? 0.85 : 0.25}" stroke="${c}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>`;

const CSS = `
#pg-marks { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.pg { position: absolute; left: 0; top: 0; display: flex; flex-direction: column; align-items: center; transform: translate(-50%, -100%); white-space: nowrap; filter: drop-shadow(0 1px 2px #000c); }
.pg .l { font: 700 11px var(--disp); letter-spacing: .12em; margin-top: 1px; }
.pg .d { font: 700 11px var(--text); color: #e8ecf4; } .pg .by { font: 600 10px var(--text); color: #c4cad6; }
.pg .ar { position: absolute; top: 9px; width: 0; height: 0; border: 6px solid transparent; }
.pg.new svg { animation: pg-pop .35s ease-out; }
@keyframes pg-pop { from { transform: scale(1.8); opacity: .2; } to { transform: none; opacity: 1; } }
#pg-wheel { position: absolute; left: 50%; top: 50%; width: 300px; height: 300px; margin: -150px 0 0 -150px; display: none; pointer-events: none; z-index: 25; }
#pg-wheel .ring { position: absolute; inset: 0; border-radius: 50%; background: radial-gradient(circle, #0b0d1400 34%, #0b0d14c8 35%, #0b0d14c8 70%, #0b0d1400 71%); }
#pg-wheel .opt { position: absolute; width: 74px; margin-left: -37px; margin-top: -26px; text-align: center; font: 700 10px var(--disp); letter-spacing: .1em; color: #c9d0dc; }
#pg-wheel .opt svg { display: block; margin: 0 auto 3px; width: 26px; height: 26px; }
#pg-wheel .opt.on { color: #fff; transform: scale(1.18); } #pg-wheel .opt.on svg { filter: drop-shadow(0 0 6px currentColor); }
#pg-wheel .dot { position: absolute; left: 50%; top: 50%; width: 8px; height: 8px; margin: -4px; border-radius: 50%; background: #fff; box-shadow: 0 0 6px #000; }
`;

export class PingView {
  /**
   * @param {HTMLElement} hud
   * @param {object} o { session, player, input, camera: () => THREE.Camera }
   */
  constructor(hud, { session, player, input, camera }) {
    this.s = session; this.world = session.world; this.player = player; this.input = input; this.camera = camera;
    if (!document.getElementById('pg-css')) document.head.appendChild(Object.assign(document.createElement('style'), { id: 'pg-css', textContent: CSS }));
    this.root = Object.assign(document.createElement('div'), { id: 'pg-marks' });
    this.wheel = Object.assign(document.createElement('div'), { id: 'pg-wheel' });
    this.wheel.innerHTML = '<div class="ring"></div>' + WHEEL.map((k, i) => {
      const a = (i / WHEEL.length) * Math.PI * 2 - Math.PI / 2, r = 110;
      return `<div class="opt" data-k="${k}" style="left:${150 + Math.cos(a) * r}px;top:${150 + Math.sin(a) * r}px;color:${COLOR[k]}">${svg(k, COLOR[k])}${SAY[k]}</div>`;
    }).join('') + '<div class="dot"></div>';
    hud.append(this.root, this.wheel);
    this.hud = hud;
    this.marks = new Map();    // ping id -> element
    this.down = null;          // when the ping key went down (s)
    this.lastTap = -1e9;
    this.time = 0;
    this._v = new THREE.Vector3(); this._d = new THREE.Vector3(); this._o = new THREE.Vector3();
  }

  dispose() { this.root.remove(); this.wheel.remove(); this.input.lookLock = null; }

  /** Each sim tick, with the sampled command (the ping button), while you're on the field. */
  tick(cmd, dt) {
    this.time += dt;
    const b = cmd.buttons.ping, me = this.player;
    if (me.health.dead || me.offField) { this.#closeWheel(); this.down = null; return; }
    if (b?.pressed) this.down = this.time;
    if (b?.down && this.down != null && !this.wheelOpen && this.time - this.down >= HOLD) this.#openWheel();
    if (b?.released && this.down != null) {
      if (this.wheelOpen) { const k = this.#closeWheel(); if (k) this.#send(k); }
      else if (this.time - this.lastTap < DOUBLE) { this.#send('danger'); this.lastTap = -1e9; }
      else { this.#send(null); this.lastTap = this.time; }
      this.down = null;
    }
  }

  /** What's under the crosshair: { enemy } or { point } or { at } (or {} looking at the sky). */
  aim() {
    const cam = this.camera(), me = this.player, w = this.world;
    const o = cam.getWorldPosition(this._o), d = cam.getWorldDirection(this._d);
    const hit = w.raycast(o, d, RANGE, me.id);
    const enemy = (e) => e && !e.health?.dead && (e.team === 0 || e.team === 1) && e.team !== me.team && !e.isDeployable;
    if (hit?.entity && enemy(hit.entity)) return { enemy: hit.entity };
    // An enemy you can see, a couple of degrees off the crosshair, counts.
    let best = null, ba = ASSIST;
    const consider = (e, y = 1.2) => {
      if (!enemy(e) || (e.vehicle && !e.isVehicle)) return;
      const p = this._v.copy(e.movement.state.position); p.y += e.isVehicle ? 1 : y;
      const to = p.sub(o), dist = to.length();
      if (dist > RANGE || dist < 1) return;
      const a = to.angleTo(d);
      if (a >= ba) return;
      const los = w.raycast(o, to.clone().normalize(), dist, me.id);
      if (los && los.entity !== e && los.distance < dist - 1.5) return;
      ba = a; best = e;
    };
    for (const f of this.s.fighters) if (!f.offField) consider(f);
    for (const v of w.vehicles?.list ?? []) if (!v.removed) consider(v);
    if (best) return { enemy: best };
    const at = hit?.point ?? null;
    if (!at) return {};
    for (const p of this.s.mode.points) {
      if (!this.s.mode.capturable?.(p) && p.owner === me.team) continue;
      if (Math.hypot(p.pos.x - at.x, p.pos.z - at.z) < p.radius + 6) return { point: p, at };
    }
    return { at };
  }

  #send(kind) {
    const P = this.world.pings, me = this.player;
    if (!P) return;
    const A = this.aim();
    if (!kind) {
      if (A.enemy) return P.ping(me, 'enemy', { target: A.enemy });
      if (A.point) return P.ping(me, A.point.owner === me.team ? 'defend' : 'attack', { point: A.point });
      if (A.at) return P.ping(me, 'move', { at: A.at });
      return null;
    }
    if (kind === 'attack' || kind === 'defend') {
      // The wheel's attack or defend: the point near where you're looking (else move there).
      const at = A.at ?? A.enemy?.movement.state.position;
      let pt = A.point ?? null;
      if (!pt && at) { let bd = 60; for (const p of this.s.mode.points) { const dd = Math.hypot(p.pos.x - at.x, p.pos.z - at.z); if (dd < bd) { bd = dd; pt = p; } } }
      if (pt) return P.ping(me, kind, { point: pt });
      return at ? P.ping(me, 'move', { at }) : null;
    }
    if (kind === 'regroup' || kind === 'medic' || kind === 'ammo') return P.ping(me, kind, {});
    const at = A.at ?? A.enemy?.movement.state.position;
    return at ? P.ping(me, kind, { at }) : null;
  }

  #openWheel() {
    this.wheelOpen = true; this.pick = null;
    this.input.lookLock = { x: 0, y: 0 };
    this.wheel.style.display = 'block';
  }

  /** Close the wheel; the kind picked (or null: the cursor never left the middle). */
  #closeWheel() {
    if (!this.wheelOpen) return null;
    this.wheelOpen = false;
    this.input.lookLock = null;
    this.wheel.style.display = 'none';
    return this.pick;
  }

  /** Per frame: the wheel's cursor, and every ping of your side over where it is. */
  update(dt, cam) {
    if (this.wheelOpen) {
      const L = this.input.lookLock, r = Math.hypot(L.x, L.y);
      if (r > 120) { L.x *= 120 / r; L.y *= 120 / r; }
      this.pick = r > 28 ? WHEEL[Math.round(((Math.atan2(L.y, L.x) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * WHEEL.length) % WHEEL.length] : null;
      for (const o of this.wheel.querySelectorAll('.opt')) o.classList.toggle('on', o.dataset.k === this.pick);
      this.wheel.querySelector('.dot').style.transform = `translate(${L.x * 0.9}px, ${L.y * 0.9}px)`;
    }
    const P = this.world.pings, me = this.player, team = me.team;
    const live = new Set();
    // Off screen, a mark is held in its own lane inside the edge (the points' markers have the
    // edge itself), below the compass and above the radio, with an arrow out toward it.
    const W = innerWidth, H = innerHeight, M = 46, L = 150, T = 150, B = H - 130, held = [];
    const safe = this.hud.safe;   // (down the sides, clear of the HUD's corner panels: FrontlineHud)
    const mp = me.offField ? null : me.movement.state.position;
    for (const p of P?.of(team) ?? []) {
      if (p.point != null) continue;   // (a point pinged lights up the point's own marker: FrontlineHud)
      live.add(p.id);
      const t = p.target, q = t?.movement?.state.position;
      let el = this.marks.get(p.id);
      if (!el) {
        el = Object.assign(document.createElement('div'), { className: 'pg new' });
        const c = COLOR[p.kind] ?? '#fff', by = p.by === me.id ? '' : this.world.entity(p.by)?.name ?? '';
        // An enemy by name (a vehicle by its type), as the HUD names the ones it marks.
        const label = p.kind === 'enemy' && t ? (t.isVehicle ? t.def?.short ?? t.def?.name ?? p.label : t.name ?? p.label).toUpperCase() : p.label;
        el.innerHTML = `${svg(p.kind, c)}<div class="l" style="color:${c}">${label}</div><div class="d"></div>${by ? `<div class="by">${by}</div>` : ''}<i class="ar"></i>`;
        this.root.appendChild(el); this.marks.set(p.id, el);
        setTimeout(() => el.classList.remove('new'), 400);
      }
      // Over the thing (a target that moves, its head), or the place.
      const v = this._v.set(q ? q.x : p.at[0], (q ? q.y : p.at[1]) + (t ? (t.isVehicle ? 3.2 : 2.3) : 1.2), q ? q.z : p.at[2]);
      const dist = mp ? Math.hypot(v.x - mp.x, v.z - mp.z) : null;
      v.project(cam);
      let x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
      const behind = v.z > 1;
      if (behind) { x = W - x; y = H - y; }
      const off = behind || x < M || x > W - M || y < M + 30 || y > H - M;
      // Off screen, only what's yours or your squad's, and orders and calls for help: the whole
      // side's callouts of enemies would line the edges.
      const ours = p.by === me.id || (me.squad && this.world.entity(p.by)?.squad === me.squad);
      el.style.display = off && p.kind === 'enemy' && !ours ? 'none' : '';
      const ar = el.lastChild;
      if (off) {
        const cx = W / 2, cy = (T + B) / 2, dx = x - cx, dy = (behind ? Math.max(y, cy + 1) : y) - cy;
        const k = Math.min((W / 2 - L) / Math.max(1e-3, Math.abs(dx)), ((B - T) / 2) / Math.max(1e-3, Math.abs(dy)));
        x = cx + dx * k; y = cy + dy * k;
        if (safe && (x <= L + 1 || x >= W - L - 1)) { const s = x <= L + 1 ? safe.l : safe.r; y = Math.min(s[1] + 24, Math.max(s[0] + 24, y)); }   // (the mark stands on its point)
        const ang = Math.atan2(dy, dx);
        ar.style.display = 'block';
        ar.style.transform = `translate(${Math.cos(ang) * 20}px, ${Math.sin(ang) * 20}px) rotate(${ang}rad)`;
        ar.style.borderLeftColor = COLOR[p.kind] ?? '#fff';
        if (el.style.display !== 'none') held.push({ el, x, y });
      } else ar.style.display = 'none';
      el.style.left = `${x.toFixed(1)}px`; el.style.top = `${y.toFixed(1)}px`;
      el.style.opacity = Math.min(1, Math.max(0, p.until - P.time)).toFixed(2);
      el.children[2].textContent = dist != null ? `${Math.round(dist)} m` : '';
    }
    // Marks held in the lane make room for each other (down the sides, along the top and bottom).
    held.sort((a, b) => a.y - b.y || a.x - b.x);
    for (let j = 1; j < held.length; j++) for (let k = 0; k < j; k++) {
      const a = held[k], b = held[j];
      if (Math.abs(a.x - b.x) > 70 || Math.abs(a.y - b.y) > 56) continue;
      if (b.x <= L + 1 || b.x >= W - L - 1) b.y = a.y + 56; else b.x = a.x + (b.x >= a.x ? 70 : -70);
      b.el.style.left = `${b.x.toFixed(1)}px`; b.el.style.top = `${b.y.toFixed(1)}px`;
    }
    for (const [id, el] of this.marks) if (!live.has(id)) { el.remove(); this.marks.delete(id); }
  }
}
