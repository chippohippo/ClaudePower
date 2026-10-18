// CommandView: the commander's seat (start menu: Commander; one per side, and the AI's when no
// person takes it). The battle from above, your squads, what the team knows of the enemy, and the
// orders. Presentation and input only: an order goes to the team's FrontlineCommander at the start
// of the next sim tick (queued), as a person's order (`by: 'human'`), and the squads take it the
// way they take any order: most of the time at once; a squad in a firefight or pinned down may
// finish it first, says so, and goes when it can.
//
//  * The view: the front from above at 60°, your side at the bottom of the screen and the enemy's
//    at the top. WASD or the arrows pan (faster zoomed out), the wheel zooms (60 m out to the whole map), the middle
//    button drags the map, Home goes back to the front.
//  * On the map: the capture points (owner's colour, the capture ring, CONTESTED), both front
//    lines, your soldiers, each squad's marker (its number and men up; amber while it hasn't gone
//    yet, grey while it falls back) with a line to where it's been sent, your scouts and the ground
//    they watch, fire missions as they land, and the ground nobody has watched lately darkened (the
//    fog of war). Enemies only where the team sees them now, and where they were last seen, fading.
//  * Squads: click one (Shift: several; 1-9; Ctrl+A: all). The cards on the left say what each is
//    doing, and under whose orders.
//  * Orders to the selected squads: right-click the map to take the point there (hold it, if it's
//    ours) or hold the ground there. Or arm one and left-click: T take, H hold, R scout (one man
//    goes ahead to get eyes on it, for the guns). B falls back, X hands the squad back to standing
//    orders (both at once). F arms a fire mission (no squad needed): every gun in range shells the
//    spot; where nobody has eyes on it, the rounds scatter. Esc disarms.
//  * The radio on the right: every order, refusal, report and fire mission.
// The 3D view keeps the same fog of war: the crowd shows an enemy soldier only while the team sees
// him (shows()).

import * as THREE from 'three';
import { bus } from '../core/EventBus.js';

const US = '#5ab4ff', THEM = '#ff4d4d', NEUTRAL = '#aab1bd', AMBER = '#ffc94d', SCOUT = '#7fffb0', GREY = '#8a909c';
const DIR = [1, -1];
const PITCH = 1.05;             // rad below the horizon the view looks down
const ZOOM = [60, 1400];        // m from the ground point looked at (out to about the whole map)
const ARM = { KeyT: 'take', KeyH: 'hold', KeyR: 'scout', KeyF: 'fire' };
const LABEL = { take: 'TAKE', hold: 'HOLD', scout: 'SCOUT', fire: 'FIRE MISSION', fallback: 'FALL BACK', auto: 'STANDING ORDERS', line: 'HOLD' };
const PHASE = { follow: 'WITH YOU', advance: 'ADVANCING', contact: 'IN CONTACT', jumpoff: 'IN THE TRENCH', assault: 'ASSAULTING', clear: 'CLEARING', hold: 'HOLDING', charge: 'CHARGING', regroup: 'REGROUPING', down: 'ALL DOWN' };
const RADIO = { order: US, fallback: GREY, refuse: AMBER, scout: SCOUT, eyes: SCOUT, secured: '#ffe08a', fire: THEM };
const FIRE_R = 16;              // m: a fire mission's radius
const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

const CSS = `
#hud.commanding #fl-compass, #hud.commanding #fl-squad, #hud.commanding #fl-markers, #hud.commanding #fl-reticle,
#hud.commanding #fl-gun, #hud.commanding #fl-status, #hud.commanding #fl-right, #hud.commanding #fl-kill,
#hud.commanding #fl-dead, #hud.commanding #fl-respawn, #hud.commanding #fl-prompt, #hud.commanding #fl-downs,
#hud.commanding #fl-foes, #hud.commanding #fl-suppress, #hud.commanding #fl-mind { display: none !important; }
#cv-map { position: fixed; inset: 0; width: 100%; height: 100%; z-index: 4; cursor: default; }
#cv-map.armed { cursor: crosshair; }
.cv-panel { position: fixed; z-index: 5; font-family: var(--text); color: #e8ecf4; pointer-events: auto; }
#cv-left { left: 16px; top: calc(var(--lb) + 74px); width: calc(270px * var(--hz)); max-height: calc(100% - var(--lb) * 2 - 190px); overflow-y: auto; }
#cv-left h3 { margin: 0 0 6px; font: 700 calc(13px * var(--hz)) var(--disp); letter-spacing: .12em; color: #ffc94d; }
.cv-sq { background: #0b0d14cc; border-left: 3px solid ${US}; margin-bottom: 4px; padding: 4px 8px; cursor: pointer; font-size: calc(13px * var(--hz)); line-height: 1.25; }
.cv-sq:hover { background: #151a26e0; }
.cv-sq.sel { border-left-color: #fff; background: #1c2436f0; box-shadow: inset 0 0 0 1px #ffffff40; }
.cv-sq .hd { display: flex; gap: 6px; align-items: baseline; font-weight: 700; }
.cv-sq .hd .k { font: 700 calc(11px * var(--hz)) var(--disp); color: #9fb3d6; min-width: 1.2em; }
.cv-sq .hd .n { margin-left: auto; font: 700 calc(11px * var(--hz)) var(--disp); }
.cv-sq .od { color: #9fd3ff; font-size: calc(12px * var(--hz)); }
.cv-sq .st { color: #aab1bd; font-size: calc(11.5px * var(--hz)); }
.cv-sq .wait { color: ${AMBER}; }
.cv-sq .hb { height: 3px; background: #ffffff1a; margin-top: 3px; } .cv-sq .hb i { display: block; height: 100%; background: ${US}; }
#cv-orders { left: 50%; transform: translateX(-50%); bottom: calc(var(--lb) + 14px); display: flex; gap: 6px; }
#cv-orders button { font: 700 calc(12px * var(--hz)) var(--disp); letter-spacing: .06em; color: #e8ecf4; background: #0b0d14d9; border: 1px solid #ffffff30; padding: 7px 11px; cursor: pointer; }
#cv-orders button kbd { color: #ffc94d; margin-right: 6px; font: inherit; }
#cv-orders button:hover { border-color: #ffffff80; }
#cv-orders button.on { background: #ffc94d; color: #10131c; } #cv-orders button.on kbd { color: #10131c; }
#cv-orders button:disabled { opacity: .35; cursor: default; }
#cv-radio { right: 16px; top: calc(var(--lb) + 74px); width: calc(340px * var(--hz)); font-size: calc(13px * var(--hz)); }
#cv-radio h3 { margin: 0 0 6px; font: 700 calc(13px * var(--hz)) var(--disp); letter-spacing: .12em; color: #ffc94d; text-align: right; }
#cv-radio div { background: #0b0d14b0; padding: 3px 8px; margin-bottom: 2px; border-right: 2px solid #ffffff30; }
#cv-radio div b { font-weight: 700; margin-right: 4px; } #cv-radio div i { font-style: normal; opacity: .5; margin-right: 6px; font-size: .85em; }
#cv-hint { left: 50%; transform: translateX(-50%); bottom: calc(var(--lb) + 56px); font-size: calc(12px * var(--hz)); color: #cfd6e4; background: #0b0d1499; padding: 3px 10px; white-space: nowrap; pointer-events: none; }
`;

export class CommandView {
  /**
   * @param {HTMLElement} hud  the HUD root (#hud): the panels go in it, its soldier's panels hide
   * @param {object} o { session, team, aspect }
   */
  constructor(hud, { session, team, aspect = 16 / 9 }) {
    this.s = session; this.team = team; this.hud = hud;
    this.cmd = session.commanders[team];
    this.intel = session.world.intel?.[team] ?? null;
    this.map = session.map; this.mode = session.mode;
    this.camera = new THREE.PerspectiveCamera(50, aspect, 1, 6000);
    this.target = new THREE.Vector3();
    const b = this.map.bounds ?? { minX: -300, maxX: 300, minZ: -150, maxZ: 150 };
    this.far = Math.max(250, Math.min(ZOOM[1], Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) * 0.8));
    this.dist = Math.min(320, this.far);
    this.home();
    this.listenYaw = team === 0 ? -Math.PI / 2 : Math.PI / 2;   // (the input's yaw convention: facing the enemy)
    this.selected = new Set();
    this.armed = null;          // 'take' | 'hold' | 'scout' | 'fire'
    this.queue = [];            // orders for the next sim tick
    this.pings = [];            // { x, z, t, col }: an order just given, there
    this.missions = [];         // { x, z, r, t, observed }: our fire missions, as they go in
    this.impacts = [];          // { x, z, t }: shells landing
    this.mouse = { x: 0, y: 0, in: false, drag: null };
    this.keys = new Set();
    this.time = 0;
    // The ground's height at each fog-of-war cell's corners (the terrain doesn't move).
    const I = this.intel;
    if (I) {
      const t = this.map.terrain, cs = I.cell;
      this.fogY = new Float32Array((I.nx + 1) * (I.nz + 1));
      for (let j = 0; j <= I.nz; j++) for (let i = 0; i <= I.nx; i++) this.fogY[j * (I.nx + 1) + i] = t ? t.height(I.x0 + i * cs, I.z0 + j * cs) : 0;
    }
    this.#dom();
    hud.classList.add('commanding');
    this.off = [
      bus.on('command:fire', (e) => { if (e.team === team) this.missions.push({ x: e.x, z: e.z, r: e.r, observed: e.observed, t: this.time }); }),
      bus.on('artillery:impact', (e) => { this.impacts.push({ x: e.point[0], z: e.point[2], t: this.time }); if (this.impacts.length > 60) this.impacts.shift(); }),
    ];
  }

  /** Back over our front line, looking across it. */
  home() {
    const M = this.mode, sec = M.map.sectors[M.front[this.team]], b = this.map.bounds ?? { minZ: -150, maxZ: 150 };
    const x = sec ? (this.team === 0 ? sec.x1 : sec.x0) : 0;
    this.target.set(x + DIR[this.team] * 30, 0, (b.minZ + b.maxZ) / 2);
    this.target.y = this.map.terrain?.height(this.target.x, this.target.z) ?? 0;
  }

  dispose() { this.off.forEach((f) => f()); this.root.forEach((e) => e.remove()); this.hud.classList.remove('commanding'); }

  /** The sim tick: the orders given since the last one go out. */
  tick() {
    const q = this.queue;
    this.queue = [];
    for (const f of q) f(this.cmd);
  }

  /** The 3D view's fog of war: an enemy soldier only while the team sees him. */
  shows(f) {
    if (f.team === this.team || !(f.team === 0 || f.team === 1) || f.health.dead || !this.intel) return true;
    return this.intel.sees(f, 1.5);
  }

  /** Esc: disarm an order (true) or let the options open (false). */
  escape() { if (!this.armed) return false; this.#arm(null); return true; }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    this.time += dt;
    // Pan (faster zoomed out), keeping to the map.
    const k = this.keys, sp = this.dist * 1.1 * dt, f = DIR[this.team];
    let fx = 0, fz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) fx += f;
    if (k.has('KeyS') || k.has('ArrowDown')) fx -= f;
    if (k.has('KeyA') || k.has('ArrowLeft')) fz -= f;
    if (k.has('KeyD') || k.has('ArrowRight')) fz += f;
    if (fx || fz) this.#pan(fx * sp, fz * sp);
    this.#place();
    this.#draw();
    this.#panels();
  }

  resize(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

  #pan(dx, dz) {
    const b = this.map.bounds ?? { minX: -500, maxX: 500, minZ: -500, maxZ: 500 }, T = this.target;
    T.x = Math.max(b.minX, Math.min(b.maxX, T.x + dx));
    T.z = Math.max(b.minZ, Math.min(b.maxZ, T.z + dz));
    T.y = this.map.terrain?.height(T.x, T.z) ?? 0;
  }

  /** The camera: behind the ground point (our side) and above it, looking at it. */
  #place() {
    const T = this.target, c = this.camera, h = Math.cos(PITCH) * this.dist;
    c.position.set(T.x - DIR[this.team] * h, T.y + Math.sin(PITCH) * this.dist, T.z);
    c.up.set(0, 1, 0);
    c.lookAt(T);
    c.updateMatrixWorld();
  }

  /** World to screen (CSS px): { x, y } or null behind the camera. */
  #screen(x, y, z, out) {
    _v.set(x, y, z).project(this.camera);
    if (_v.z > 1 || _v.z < -1) return null;
    out.x = (_v.x * 0.5 + 0.5) * this.W; out.y = (-_v.y * 0.5 + 0.5) * this.H;
    return out;
  }

  /** The ground under a screen point (CSS px), or null. */
  ground(sx, sy) {
    const c = this.camera, t = this.map.terrain;
    _a.set((sx / this.W) * 2 - 1, -(sy / this.H) * 2 + 1, 0.5).unproject(c).sub(c.position).normalize();
    const o = c.position, h = (s) => o.y + _a.y * s - (t ? t.height(o.x + _a.x * s, o.z + _a.z * s) : 0);
    let lo = 0;
    for (let s = 4; s < 6000; s += Math.max(3, s * 0.015)) {
      if (h(s) <= 0) {
        let a = lo, b = s;
        for (let i = 0; i < 18; i++) { const m = (a + b) / 2; if (h(m) <= 0) b = m; else a = m; }
        return { x: o.x + _a.x * b, y: o.y + _a.y * b, z: o.z + _a.z * b };
      }
      lo = s;
    }
    return null;
  }

  // ---------------------------------------------------------------- the map
  #draw() {
    const cv = this.canvas, dpr = Math.min(2, devicePixelRatio || 1);
    this.W = innerWidth; this.H = innerHeight;
    if (cv.width !== Math.round(this.W * dpr) || cv.height !== Math.round(this.H * dpr)) { cv.width = Math.round(this.W * dpr); cv.height = Math.round(this.H * dpr); }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    this.#fog(g);
    this.#fronts(g);
    this.#points(g);
    this.#orders(g);
    this.#soldiers(g);
    this.#enemies(g);
    this.#fire(g);
    this.#squads(g);
    this.#scouts(g);
    this.#cursor(g);
  }

  /** Ground nobody on our side has watched for a while: darker the longer it's been. */
  #fog(g) {
    const I = this.intel;
    if (!I) return;
    const cs = I.cell, nx1 = I.nx + 1, P = [{}, {}, {}, {}];
    g.fillStyle = '#05070c';
    for (let j = 0; j < I.nz; j++) for (let i = 0; i < I.nx; i++) {
      const age = I.time - I.cells[j * I.nx + i], a = Math.min(0.5, Math.max(0, (age - 12) / 40));
      if (a < 0.03) continue;
      const x0 = I.x0 + i * cs, z0 = I.z0 + j * cs;
      const ok = this.#screen(x0, this.fogY[j * nx1 + i], z0, P[0]) && this.#screen(x0 + cs, this.fogY[j * nx1 + i + 1], z0, P[1])
        && this.#screen(x0 + cs, this.fogY[(j + 1) * nx1 + i + 1], z0 + cs, P[2]) && this.#screen(x0, this.fogY[(j + 1) * nx1 + i], z0 + cs, P[3]);
      if (!ok) continue;
      if (Math.max(P[0].x, P[1].x, P[2].x, P[3].x) < 0 || Math.min(P[0].x, P[1].x, P[2].x, P[3].x) > this.W || Math.max(P[0].y, P[1].y, P[2].y, P[3].y) < 0 || Math.min(P[0].y, P[1].y, P[2].y, P[3].y) > this.H) continue;
      g.globalAlpha = a;
      g.beginPath(); g.moveTo(P[0].x, P[0].y); g.lineTo(P[1].x, P[1].y); g.lineTo(P[2].x, P[2].y); g.lineTo(P[3].x, P[3].y); g.closePath(); g.fill();
    }
    g.globalAlpha = 1;
  }

  /** Both front lines, across the map. */
  #fronts(g) {
    const M = this.mode, b = this.map.bounds ?? { minZ: -150, maxZ: 150 }, t = this.map.terrain, p = {};
    for (const team of [0, 1]) {
      const sec = M.map.sectors[M.front[team]];
      if (!sec) continue;
      const x = team === 0 ? sec.x1 : sec.x0;
      g.strokeStyle = team === this.team ? US : THEM; g.lineWidth = 2; g.setLineDash([10, 6]); g.globalAlpha = 0.8;
      g.beginPath();
      let pen = false;
      for (let z = b.minZ; z <= b.maxZ; z += 12) {
        const q = this.#screen(x, (t?.height(x, z) ?? 0) + 0.5, z, p);
        if (!q) { pen = false; continue; }
        if (pen) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y);
        pen = true;
      }
      g.stroke();
    }
    g.setLineDash([]); g.globalAlpha = 1;
  }

  #points(g) {
    const M = this.mode, t = this.map.terrain, p = {}, c = {};
    g.font = `700 ${Math.round(13 * this.#hz())}px HudDisplay, Bahnschrift, sans-serif`; g.textAlign = 'center';
    for (const P of M.points) {
      const live = M.capturable(P);
      const col = P.owner === this.team ? US : P.owner >= 0 ? THEM : NEUTRAL;
      if (!this.#screen(P.pos.x, P.pos.y + 0.5, P.pos.z, c)) continue;
      // The ring on the ground.
      g.beginPath();
      for (let k = 0; k <= 32; k++) {
        const a = (k / 32) * Math.PI * 2, x = P.pos.x + Math.cos(a) * P.radius, z = P.pos.z + Math.sin(a) * P.radius;
        const q = this.#screen(x, (t?.height(x, z) ?? P.pos.y) + 0.4, z, p);
        if (!q) continue;
        if (k === 0) g.moveTo(q.x, q.y); else g.lineTo(q.x, q.y);
      }
      g.globalAlpha = live ? 0.18 : 0.08; g.fillStyle = col; g.fill();
      g.globalAlpha = live ? 0.95 : 0.4; g.strokeStyle = col; g.lineWidth = live ? 2 : 1; g.stroke();
      g.globalAlpha = 1;
      // The label: the name, the capture going on.
      const k = Math.abs(P.progress), by = P.progress >= 0 ? 0 : 1;
      const r = 13 * this.#hz();
      g.fillStyle = '#0b0d14d0'; g.beginPath(); g.arc(c.x, c.y - 24, r, 0, Math.PI * 2); g.fill();
      if (live && k > 0.01) { g.strokeStyle = by === this.team ? US : THEM; g.lineWidth = 3; g.beginPath(); g.arc(c.x, c.y - 24, r, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); g.stroke(); }
      g.fillStyle = col; g.fillText(P.name, c.x, c.y - 19);
      if (live && P.contested && Math.floor(this.time * 3) % 2 === 0) { g.fillStyle = AMBER; g.fillText('CONTESTED', c.x, c.y - 44); }
    }
  }

  /** Each squad's line to where it's been sent (dashed while it hasn't gone yet). */
  #orders(g) {
    const a = {}, b = {};
    for (const s of this.cmd.squads) {
      const o = this.cmd.target(s.objective);
      if (!o || !s.center(_c)) continue;
      if (!this.#screen(_c.x, _c.y + 1, _c.z, a) || !this.#screen(o.pos.x, o.pos.y + 1, o.pos.z, b)) continue;
      const human = s.order?.by === 'human', sel = this.selected.has(s);
      g.strokeStyle = s.pending ? AMBER : human ? '#ffffff' : US;
      g.globalAlpha = sel ? 0.95 : human ? 0.6 : 0.3; g.lineWidth = sel ? 2 : 1.4;
      g.setLineDash(s.pending ? [5, 5] : []);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      // The arrow head.
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      g.setLineDash([]); g.beginPath();
      g.moveTo(b.x, b.y); g.lineTo(b.x - Math.cos(ang - 0.4) * 9, b.y - Math.sin(ang - 0.4) * 9);
      g.moveTo(b.x, b.y); g.lineTo(b.x - Math.cos(ang + 0.4) * 9, b.y - Math.sin(ang + 0.4) * 9);
      g.stroke();
    }
    g.globalAlpha = 1; g.setLineDash([]);
  }

  #soldiers(g) {
    const p = {};
    for (const f of this.s.fighters) {
      if (f.team !== this.team || f.health.dead || f.offField) continue;
      const q = f.movement.state.position;
      if (!this.#screen(q.x, q.y + 1, q.z, p)) continue;
      g.fillStyle = f.health.downed ? AMBER : f.duty ? '#9fd3ff' : US;
      g.beginPath(); g.arc(p.x, p.y, f.health.downed ? 2.2 : 2.8, 0, Math.PI * 2); g.fill();
    }
  }

  /** Enemies the team sees now (solid), and where the rest were last seen (fading). */
  #enemies(g) {
    const I = this.intel, p = {};
    if (!I) return;
    for (const c of I.contacts.values()) {
      const age = I.time - c.t;
      if (age < 1.5 && !c.e.health?.dead) {
        const q = c.e.movement.state.position;
        if (!this.#screen(q.x, q.y + 1, q.z, p)) continue;
        g.fillStyle = THEM; g.beginPath(); g.arc(p.x, p.y, 3.2, 0, Math.PI * 2); g.fill();
        if (c.scout) { g.strokeStyle = SCOUT; g.lineWidth = 1; g.beginPath(); g.arc(p.x, p.y, 6, 0, Math.PI * 2); g.stroke(); }
      } else if (age < 30) {
        if (!this.#screen(c.x, c.y + 1, c.z, p)) continue;
        g.globalAlpha = 0.75 * (1 - age / 30); g.strokeStyle = THEM; g.lineWidth = 1.4;
        g.beginPath(); g.arc(p.x, p.y, 4, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
      }
    }
  }

  /** Fire missions going in (dashed: fired blind), and the shells landing. */
  #fire(g) {
    const p = {}, e = {};
    this.missions = this.missions.filter((m) => this.time - m.t < 25);
    for (const m of this.missions) {
      if (!this.#screen(m.x, (this.map.terrain?.height(m.x, m.z) ?? 0) + 0.5, m.z, p) || !this.#screen(m.x + m.r * (m.observed ? 1 : 2), (this.map.terrain?.height(m.x, m.z) ?? 0) + 0.5, m.z, e)) continue;
      const r = Math.max(6, Math.hypot(e.x - p.x, e.y - p.y));
      g.strokeStyle = THEM; g.lineWidth = 2; g.globalAlpha = 0.9 * (1 - (this.time - m.t) / 25);
      g.setLineDash(m.observed ? [] : [6, 5]);
      g.beginPath(); g.ellipse(p.x, p.y, r, r * Math.sin(PITCH), 0, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(p.x - 7, p.y); g.lineTo(p.x + 7, p.y); g.moveTo(p.x, p.y - 7); g.lineTo(p.x, p.y + 7); g.stroke();
    }
    g.setLineDash([]);
    this.impacts = this.impacts.filter((m) => this.time - m.t < 1.2);
    for (const m of this.impacts) {
      if (!this.#screen(m.x, this.map.terrain?.height(m.x, m.z) ?? 0, m.z, p)) continue;
      const k = (this.time - m.t) / 1.2;
      g.globalAlpha = 1 - k; g.fillStyle = '#ffb04d';
      g.beginPath(); g.arc(p.x, p.y, 3 + k * 14, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  }

  #squads(g) {
    const p = {}, hz = this.#hz();
    g.font = `700 ${Math.round(11 * hz)}px HudDisplay, Bahnschrift, sans-serif`; g.textAlign = 'center';
    this.marks = [];
    this.cmd.squads.forEach((s, i) => {
      if (!s.members.length || !s.center(_c) || !this.#screen(_c.x, _c.y + 2, _c.z, p)) return;
      const up = s.alive, sel = this.selected.has(s), broken = s.tactics?.broken && s.tactics.time < s.tactics.broken.until;
      const col = !up ? GREY : s.pending ? AMBER : broken ? GREY : US, w = 30 * hz, h = 18 * hz;
      g.fillStyle = '#0b0d14e0'; g.fillRect(p.x - w / 2, p.y - h - 6, w, h);
      g.strokeStyle = sel ? '#ffffff' : col; g.lineWidth = sel ? 2.2 : 1.4; g.strokeRect(p.x - w / 2, p.y - h - 6, w, h);
      g.fillStyle = col; g.fillText(`${i + 1}·${up}`, p.x, p.y - 6 - h * 0.28);
      g.beginPath(); g.moveTo(p.x - 4, p.y - 6); g.lineTo(p.x + 4, p.y - 6); g.lineTo(p.x, p.y); g.closePath(); g.fill();
      this.marks.push({ s, x: p.x, y: p.y - h / 2 - 6, r: Math.max(w, h) * 0.75 });
    });
    // Orders just given: a ring where they're going.
    this.pings = this.pings.filter((q) => this.time - q.t < 1);
    for (const q of this.pings) {
      if (!this.#screen(q.x, q.y, q.z, p)) continue;
      const k = this.time - q.t;
      g.strokeStyle = q.col; g.globalAlpha = 1 - k; g.lineWidth = 2;
      g.beginPath(); g.ellipse(p.x, p.y, 6 + k * 26, (6 + k * 26) * Math.sin(PITCH), 0, 0, Math.PI * 2); g.stroke();
    }
    g.globalAlpha = 1;
  }

  /** Scouts: where each man is, what he's watching, and how far he can see from there. */
  #scouts(g) {
    const p = {}, e = {};
    for (const task of this.cmd.scouts.values()) {
      if (task.done) continue;
      const q = task.member.movement.state.position;
      if (!this.#screen(q.x, q.y + 1.5, q.z, p)) continue;
      g.strokeStyle = SCOUT; g.fillStyle = SCOUT; g.lineWidth = 1.6;
      // An eye.
      g.beginPath(); g.ellipse(p.x, p.y - 12, 8, 4.5, 0, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(p.x, p.y - 12, 2, 0, Math.PI * 2); g.fill();
      if (task.state === 'watching' && this.#screen(q.x + task.range, q.y, q.z, e)) {
        const r = Math.hypot(e.x - p.x, e.y - p.y);
        g.globalAlpha = 0.35; g.setLineDash([4, 6]);
        g.beginPath(); g.ellipse(p.x, p.y, r, r * Math.sin(PITCH), 0, 0, Math.PI * 2); g.stroke();
        g.setLineDash([]); g.globalAlpha = 1;
      }
      if (task.state === 'going' && this.#screen(task.vantage.x, q.y, task.vantage.z, e)) {
        g.globalAlpha = 0.5; g.setLineDash([3, 4]);
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(e.x, e.y); g.stroke();
        g.setLineDash([]); g.globalAlpha = 1;
      }
    }
  }

  /** The armed order under the cursor; what's under it otherwise. */
  #cursor(g) {
    const m = this.mouse;
    if (!m.in || m.drag) return;
    const at = this.ground(m.x, m.y);
    if (!at) return;
    const hz = this.#hz();
    g.font = `700 ${Math.round(12 * hz)}px HudDisplay, Bahnschrift, sans-serif`; g.textAlign = 'left';
    if (this.armed === 'fire') {
      const p = {}, e = {};
      if (this.#screen(at.x, at.y, at.z, p) && this.#screen(at.x + FIRE_R, at.y, at.z, e)) {
        const r = Math.hypot(e.x - p.x, e.y - p.y), seen = this.#observed(at.x, at.z);
        g.strokeStyle = THEM; g.lineWidth = 2; g.setLineDash(seen ? [] : [6, 5]);
        g.beginPath(); g.ellipse(p.x, p.y, seen ? r : r * 2, (seen ? r : r * 2) * Math.sin(PITCH), 0, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
        g.fillStyle = THEM; g.fillText(seen ? 'FIRE MISSION · OBSERVED' : 'FIRE MISSION · BLIND (NO EYES ON IT)', m.x + 16, m.y - 10);
      }
      return;
    }
    const what = this.#under(at);
    const label = this.armed ? `${LABEL[this.armed]} ${what.name}` : this.selected.size ? `${what.point && what.point.owner !== this.team ? 'TAKE' : 'HOLD'} ${what.name}  [RMB]` : what.name;
    g.fillStyle = this.armed ? AMBER : '#e8ecf4';
    g.fillText(label, m.x + 16, m.y - 10);
  }

  /** What's at a spot: the capture point there, else a place named from the nearest point. */
  #under(at) {
    for (const P of this.mode.points) if (Math.hypot(P.pos.x - at.x, P.pos.z - at.z) < P.radius + 4) return { point: P, name: P.name };
    return { point: null, name: this.cmd.where(at.x, at.z) };
  }

  #observed(x, z) {
    const I = this.intel;
    return !!I && (I.near(x, z, FIRE_R + 10, 8) > 0 || I.staleness(x, z, FIRE_R) < 10);
  }

  #hz() { return Math.min(1.5, Math.max(0.8, innerHeight / 1080)); }

  // ---------------------------------------------------------------- orders
  #order(kind, at) {
    const team = this.team;
    if (kind === 'fire') {
      if (!at) return;
      this.queue.push((cmd) => cmd.fire({ x: at.x, z: at.z, r: FIRE_R, rounds: 4, by: 'human' }));
      this.pings.push({ x: at.x, y: at.y, z: at.z, t: this.time, col: THEM });
      return;
    }
    const squads = [...this.selected].filter((s) => s.members.length);
    if (!squads.length) return;
    if (kind === 'fallback' || kind === 'auto') { for (const s of squads) this.queue.push((cmd) => cmd.give(s, { kind, by: 'human' })); return; }
    if (!at) return;
    const what = this.#under(at);
    const o = what.point ? { point: what.point.id } : { at: { x: at.x, z: at.z } };
    // Taking our own point is holding it; holding theirs is taking it.
    let k = kind;
    if (what.point && kind === 'take' && what.point.owner === team) k = 'hold';
    if (what.point && kind === 'hold' && what.point.owner !== team && this.mode.capturable(what.point)) k = 'take';
    if (k === 'scout') for (const s of squads.slice(0, 1)) this.queue.push((cmd) => cmd.give(s, { kind: 'scout', at: { x: at.x, z: at.z }, name: what.name, by: 'human' }));
    else for (const s of squads) this.queue.push((cmd) => cmd.give(s, { kind: k, ...o, by: 'human' }));
    this.pings.push({ x: at.x, y: at.y, z: at.z, t: this.time, col: k === 'scout' ? SCOUT : '#ffffff' });
  }

  #arm(kind) {
    this.armed = this.armed === kind ? null : kind;
    this.canvas.classList.toggle('armed', !!this.armed);
  }

  #select(s, add) {
    if (!add) this.selected.clear();
    if (s) { if (add && this.selected.has(s)) this.selected.delete(s); else this.selected.add(s); }
  }

  // ---------------------------------------------------------------- panels
  #dom() {
    if (!document.getElementById('cv-css')) document.head.appendChild(Object.assign(document.createElement('style'), { id: 'cv-css', textContent: CSS }));
    const cv = this.canvas = Object.assign(document.createElement('canvas'), { id: 'cv-map' });
    this.ctx = cv.getContext('2d');
    this.W = innerWidth; this.H = innerHeight;
    document.body.appendChild(cv);
    const left = Object.assign(document.createElement('div'), { id: 'cv-left', className: 'cv-panel' });
    left.innerHTML = `<h3>COMMAND · ${this.team === 0 ? 'SOLARI' : 'VOID'}</h3><div id="cv-squads"></div>`;
    const orders = Object.assign(document.createElement('div'), { id: 'cv-orders', className: 'cv-panel' });
    const B = [['take', 'T', 'TAKE'], ['hold', 'H', 'HOLD'], ['scout', 'R', 'SCOUT'], ['fire', 'F', 'FIRE MISSION'], ['fallback', 'B', 'FALL BACK'], ['auto', 'X', 'STANDING ORDERS']];
    orders.innerHTML = B.map(([k, key, name]) => `<button data-k="${k}"><kbd>${key}</kbd>${name}</button>`).join('');
    const radio = Object.assign(document.createElement('div'), { id: 'cv-radio', className: 'cv-panel' });
    radio.innerHTML = '<h3>RADIO</h3><div id="cv-log"></div>';
    const hint = Object.assign(document.createElement('div'), { id: 'cv-hint', className: 'cv-panel' });
    hint.textContent = 'LMB select · Shift add · RMB take / hold there · WASD pan · wheel zoom · middle-drag · 1-9 squads · Home: the front · Esc options';
    for (const e of [left, orders, radio, hint]) this.hud.appendChild(e);
    this.root = [cv, left, orders, radio, hint];
    this.el = { squads: left.querySelector('#cv-squads'), orders, log: radio.querySelector('#cv-log') };
    this.html = new Map();
    // Cards: click selects (Shift adds).
    this.el.squads.addEventListener('click', (e) => {
      const c = e.target.closest('.cv-sq');
      if (!c) return;
      const s = this.cmd.squads[+c.dataset.i];
      this.#select(s, e.shiftKey);
      if (e.detail === 2 && s.center(_c)) this.#pan(_c.x - this.target.x, _c.z - this.target.z);   // double-click: go to it
    });
    orders.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      const k = b.dataset.k;
      if (k === 'fallback' || k === 'auto') this.#order(k, null); else this.#arm(k);
    });
    // The map: select, order, pan, zoom.
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointermove', (e) => {
      const m = this.mouse;
      if (m.drag) {
        const a = this.ground(m.drag.x, m.drag.y), b = this.ground(e.clientX, e.clientY);
        if (a && b) this.#pan(a.x - b.x, a.z - b.z);
        m.drag.x = e.clientX; m.drag.y = e.clientY;
      }
      m.x = e.clientX; m.y = e.clientY; m.in = true;
    });
    cv.addEventListener('pointerleave', () => { this.mouse.in = false; });
    cv.addEventListener('pointerdown', (e) => {
      if (e.button === 1) { e.preventDefault(); this.mouse.drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture?.(e.pointerId); return; }
      const at = this.ground(e.clientX, e.clientY);
      if (e.button === 2) {
        if (this.armed) { this.#arm(null); return; }
        if (!at || !this.selected.size) return;
        const what = this.#under(at);
        this.#order(what.point && what.point.owner !== this.team ? 'take' : 'hold', at);
        return;
      }
      if (e.button !== 0) return;
      if (this.armed) {
        this.#order(this.armed, at);
        if (!e.shiftKey) this.#arm(null);   // (Shift: keep it armed)
        return;
      }
      // A squad's marker under the click?
      let hit = null, bd = Infinity;
      for (const k of this.marks ?? []) { const d = Math.hypot(k.x - e.clientX, k.y - e.clientY); if (d < k.r && d < bd) { bd = d; hit = k.s; } }
      this.#select(hit, e.shiftKey);
    });
    addEventListener('pointerup', (e) => { if (e.button === 1) this.mouse.drag = null; });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.dist = Math.max(ZOOM[0], Math.min(this.far, this.dist * Math.exp(e.deltaY * 0.0012))); }, { passive: false });
    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      this.keys.add(e.code);
      if (ARM[e.code]) { this.#arm(ARM[e.code]); return; }
      if (e.code === 'KeyB') { this.#order('fallback', null); return; }
      if (e.code === 'KeyX') { this.#order('auto', null); return; }
      if (e.code === 'Home') { this.home(); return; }
      if (e.code === 'KeyA' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); for (const s of this.cmd.squads) this.selected.add(s); return; }
      const n = /^Digit([1-9])$/.exec(e.code);
      if (n) { const s = this.cmd.squads[+n[1] - 1]; if (s) this.#select(s, e.shiftKey); }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  #set(el, html) { if (this.html.get(el) !== html) { this.html.set(el, html); el.innerHTML = html; } }

  #panels() {
    const cmd = this.cmd, hp = (s) => {
      let h = 0, n = 0;
      for (const m of s.members) { n++; if (!m.health.dead) h += m.health.downed ? 0.15 : (m.health.hp + m.health.shield) / (m.health.max + m.health.maxShield); }
      return n ? h / n : 0;
    };
    this.#set(this.el.squads, cmd.squads.map((s, i) => {
      const o = cmd.target(s.objective), T = s.tactics, sel = this.selected.has(s);
      const scout = cmd.scouts.get(s), broken = T?.broken && T.time < T.broken.until;
      const what = s.order ? `${LABEL[s.order.kind] ?? 'HOLD'} ${s.order.obj.name ?? ''}${s.order.by === 'human' ? '' : ' · AI'}` : `STANDING ORDERS · ${o ? `${s.role === 'attack' ? 'TAKE' : 'HOLD'} ${o.name}` : '—'}`;
      const state = !s.alive ? 'ALL DOWN · REINFORCING' : broken ? 'FALLING BACK · REGROUPING' : PHASE[T?.phase] ?? '';
      const wait = s.pending ? `<div class="wait">${(s.pending.why ?? 'busy').toUpperCase()} · WILL GO WHEN ABLE</div>` : '';
      const sc = scout && !scout.done ? `<div class="st" style="color:${SCOUT}">SCOUT ${scout.state === 'watching' ? `WATCHING ${scout.at.name ?? ''} · ${scout.seen} SEEN` : scout.state === 'going' ? `GOING TO ${scout.at.name ?? 'THE VANTAGE'}` : 'COMING BACK'}</div>` : '';
      return `<div class="cv-sq ${sel ? 'sel' : ''}" data-i="${i}"><div class="hd"><span class="k">${i < 9 ? i + 1 : ''}</span>${s.callsign.toUpperCase()}<span class="n">${s.alive}/${s.members.length}</span></div>`
        + `<div class="od">${what}</div><div class="st">${state}</div>${wait}${sc}<div class="hb"><i style="width:${(hp(s) * 100).toFixed(0)}%"></i></div></div>`;
    }).join(''));
    const t = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
    this.#set(this.el.log, cmd.log.slice(-10).map((e) => `<div style="border-right-color:${RADIO[e.kind] ?? '#ffffff30'}"><i>${t(e.t)}</i><b style="color:${RADIO[e.kind] ?? '#e8ecf4'}">${e.callsign}</b>${e.text}</div>`).join(''));
    // Orders that need squads are off without any.
    const none = !this.selected.size;
    for (const b of this.el.orders.querySelectorAll('button')) {
      const k = b.dataset.k;
      b.disabled = k !== 'fire' && none;
      b.classList.toggle('on', this.armed === k);
    }
  }
}
