// FrontlineHud: the battle HUD for 64-128 players. DOM + one canvas, updated at render rate.
//  * Top: reinforcement tickets per team and the sector strip (who holds what, where each
//    front is, which sectors are being fought over, and how close a sector is to falling).
//  * Your orders: attack/defend which point, with distance, from your squad's commander order.
//  * Point markers: every capturable point on screen (or pinned to the screen edge), with the
//    owner's color, capture progress and a pulse while contested.
//  * Minimap: sectors, points, allies, you, and enemies that gave themselves away by firing.
//  * HD2 reticles: the camera crosshair plus a second ring where the gun actually points
//    (ergonomics drag and recoil make them separate), status bars, ammo, killfeed and banners.
//  * Downs: your bleed-out, the give-up hold and revive progress while you're down; a revive
//    prompt beside a downed teammate; red crosses over downed teammates nearby (and on the map).
//  * Your squad: each squadmate's state and what they're doing (covering you, bounding, stacking
//    on a door...), the whistle when a wave goes over the top, digging progress, and the screen
//    edges darkening while you're under heavy fire (suppression).

import * as THREE from 'three';
import { bus } from '../core/EventBus.js';

const TEAM_COL = ['#ffcf6b', '#b994ff'];
const NEUTRAL_COL = '#d8dde6';
const TEAM_NAME = ['SOLARI', 'VOID'];
const _v = new THREE.Vector3();
const bar = (k, col) => `<span class="pbar"><i style="width:${(Math.min(1, Math.max(0, k)) * 100).toFixed(0)}%;background:${col}"></i></span>`;

export class FrontlineHud {
  constructor(root, session, player) {
    this.s = session; this.player = player; this.team = player.team;
    this.root = root;
    root.innerHTML = `
      <div id="fl-top"><div class="tk" id="fl-tk0"></div><div id="fl-strip"></div><div class="tk" id="fl-tk1"></div></div>
      <div id="fl-orders"></div>
      <div id="fl-markers"></div>
      <canvas id="fl-map" width="300" height="120"></canvas>
      <div id="fl-reticle"></div><div id="fl-gun"></div>
      <div id="fl-status"></div>
      <div id="fl-feed"></div>
      <div id="fl-banner"></div>
      <div id="fl-respawn"></div>
      <div id="fl-prompt"></div>
      <div id="fl-downs"></div>
      <div id="fl-squad"></div>
      <div id="fl-suppress"></div>`;
    this.el = Object.fromEntries([...root.querySelectorAll('[id^="fl-"]')].map((e) => [e.id.slice(3), e]));
    this.ctx = this.el.map.getContext('2d');
    // The minimap keeps the map's proportions (a 4v4 outpost is squarer than a 64v64 front).
    const B = session.map.bounds, aspect = (B.maxZ - B.minZ) / (B.maxX - B.minX);
    this.el.map.height = Math.round(this.el.map.width * aspect);
    this.el.map.style.height = `${Math.round(300 * aspect)}px`;
    this.markers = session.map.points.map((p) => {
      const d = document.createElement('div');
      d.className = 'mk';
      d.innerHTML = `<b>${p.name}</b><i></i><span></span>`;
      this.el.markers.appendChild(d);
      return d;
    });
    this.spotted = new Map();   // enemy id -> time (fired recently: shows on the minimap)
    this.downMarks = [];        // pooled red crosses over downed teammates
    this.feed = [];
    this.bannerUntil = 0;
    this.time = 0;
    // Kills by turrets, mines and vehicles credit the owner or driver ("rigger's turret").
    const fighter = (id) => session.fighters.find((f) => f.id === id);
    const name = (id) => {
      const f = fighter(id);
      if (f) return f.name;
      const x = session.world.entity(id);
      if (x?.isDeployable) { const o = fighter(x.ownerId); return o ? `${o.name}'s ${x.kind}` : x.kind; }
      if (x?.isVehicle) { const d = x.seats?.find((st) => st.occupant)?.occupant; return d ? d.name : (x.def?.name ?? 'vehicle'); }
      return '?';
    };
    const teamOf = (id) => fighter(id)?.team ?? session.world.entity(id)?.team ?? -1;
    this.off = [
      bus.on('weapon:fire', (e) => { const f = session.world.entity(e.id); if (f && f.team !== this.team) this.spotted.set(e.id, this.time); }),
      bus.on('entity:death', (e) => {
        const vt = teamOf(e.id);
        if (vt < 0) return;
        const kt = teamOf(e.by);
        this.feed.unshift({ html: `<span style="color:${TEAM_COL[kt] ?? '#aaa'}">${e.by === player.id ? 'You' : e.by ? name(e.by) : 'World'}</span> ▸ <span style="color:${TEAM_COL[vt]}">${e.id === player.id ? 'You' : name(e.id)}</span>`, t: this.time });
        this.feed.length = Math.min(this.feed.length, 6);
      }),
      bus.on('entity:downed', (e) => {
        const vt = teamOf(e.id);
        if (vt < 0) return;
        const kt = teamOf(e.by);
        this.feed.unshift({ html: `<span style="opacity:.75"><span style="color:${TEAM_COL[kt] ?? '#aaa'}">${e.by === player.id ? 'You' : e.by ? name(e.by) : 'World'}</span> ▾ <span style="color:${TEAM_COL[vt]}">${e.id === player.id ? 'You' : name(e.id)}</span> <i>down</i></span>`, t: this.time });
        this.feed.length = Math.min(this.feed.length, 6);
      }),
      bus.on('mode:point', (e) => {
        const p = session.mode.points[e.point];
        if (e.owner === this.team) this.banner(`${p.name} CAPTURED`, TEAM_COL[this.team]);
        else if (e.from === this.team) this.banner(`${p.name} LOST`, '#ff6b81');
      }),
      bus.on('mode:sector', (e) => {
        const letter = String.fromCharCode(64 + e.sector);
        this.banner(e.team === this.team ? `SECTOR ${letter} TAKEN · THE LINE MOVES UP` : `SECTOR ${letter} LOST · FALL BACK`, e.team === this.team ? TEAM_COL[this.team] : '#ff6b81', 3);
      }),
      bus.on('squad:whistle', (e) => {
        const p = player.movement.state.position, near = Math.hypot(e.x - p.x, e.z - p.z) < 160;
        if (e.team === this.team && (near || e.squads.includes(player.squad?.id))) this.banner('WHISTLES · OVER THE TOP!', TEAM_COL[this.team], 2.5);
        else if (e.team !== this.team && near) this.banner('ENEMY WHISTLES · THEY ARE COMING OVER', '#ff6b81', 2.5);
      }),
      bus.on('fort:dig', (e) => { if (e.id === player.id) this.dig = { stage: e.stage, k: e.progress, t: this.time }; }),
      bus.on('fort:built', (e) => { const p = player.movement.state.position; if (e.team === this.team && Math.hypot(e.x - p.x, e.z - p.z) < 3) this.dig = { stage: -1, kind: e.kind, t: this.time }; }),
      bus.on('mode:victory', (e) => this.banner(e.team === this.team ? `VICTORY · ${e.reason.toUpperCase()}` : `DEFEAT · ${e.reason.toUpperCase()}`, e.team === this.team ? TEAM_COL[this.team] : '#ff6b81', 999)),
    ];
  }

  dispose() { this.off.forEach((f) => f()); }

  banner(text, color, seconds = 2) {
    this.el.banner.textContent = text; this.el.banner.style.color = color; this.el.banner.style.opacity = 1;
    this.bannerUntil = this.time + seconds;
  }

  update(dt, camera) {
    this.time += dt;
    const s = this.s, mode = s.mode, me = this.player, team = this.team;
    // ---- tickets and the sector strip
    this.el.tk0.innerHTML = `<b style="color:${TEAM_COL[0]}">${TEAM_NAME[0]}</b> ${mode.tickets[0]}`;
    this.el.tk1.innerHTML = `${mode.tickets[1]} <b style="color:${TEAM_COL[1]}">${TEAM_NAME[1]}</b>`;
    this.el.strip.innerHTML = mode.sectors.map((sec, i) => {
      const col = sec.owner >= 0 ? TEAM_COL[sec.owner] : NEUTRAL_COL;
      const attacked = mode.isAttacked(i), fall = Math.max(...sec.secure) / mode.cfg.secureTime;
      const label = sec.kind === 'hq' ? 'HQ' : String.fromCharCode(64 + i);
      const front = mode.front[0] === i ? '◆' : mode.front[1] === i ? '◆' : '';
      return `<div class="sec ${attacked ? 'hot' : ''}" style="border-color:${col};color:${col}"><span>${label}</span>${front ? `<em style="color:${TEAM_COL[mode.front[0] === i ? 0 : 1]}">${front}</em>` : ''}${fall > 0 ? `<i style="width:${(fall * 100).toFixed(0)}%"></i>` : ''}</div>`;
    }).join('');
    // ---- orders
    const sq = me.squad, obj = sq ? mode.points[sq.objective] : null;
    const mp = me.movement.state.position;
    this.el.orders.innerHTML = obj ? `<b style="color:${sq.role === 'attack' ? '#ff9a5c' : '#7fd6ff'}">${sq.role === 'attack' ? 'ATTACK' : 'DEFEND'} ${obj.name}</b> · ${mp.distanceTo(obj.pos).toFixed(0)} m` : '';
    // ---- point markers
    const w = innerWidth, h = innerHeight;
    camera.updateMatrixWorld();
    for (const [i, el] of this.markers.entries()) {
      const p = mode.points[i];
      const live = mode.capturable(p);
      el.style.display = live ? 'block' : 'none';
      if (!live) continue;
      _v.copy(p.pos); _v.y += 4;
      const dist = _v.distanceTo(camera.position);
      _v.project(camera);
      let x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
      const behind = _v.z > 1;
      if (behind) { x = w - x; y = h - 30; }
      x = Math.min(w - 30, Math.max(30, x)); y = Math.min(h - 30, Math.max(60, y));
      el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
      const col = p.owner >= 0 ? TEAM_COL[p.owner] : NEUTRAL_COL;
      el.style.color = col;
      el.classList.toggle('contested', p.contested);
      el.classList.toggle('mine', sq?.objective === p.id);
      el.querySelector('i').style.background = `conic-gradient(${p.progress >= 0 ? TEAM_COL[0] : TEAM_COL[1]} ${(Math.abs(p.progress) * 360).toFixed(0)}deg, #0006 0)`;
      el.querySelector('span').textContent = `${dist.toFixed(0)} m`;
    }
    // ---- minimap
    this.#minimap();
    // ---- reticles: camera centre, and where the gun really points
    const wc = me.weapons, gunMode = me.mode === 'gun' && !me.health.dead && !me.health.downed && !me.vehicle;
    this.el.reticle.style.display = this.el.gun.style.display = gunMode ? 'block' : 'none';
    if (gunMode) {
      const cy = Math.cos(wc.aimYaw), sy = Math.sin(wc.aimYaw), cp = Math.cos(wc.aimPitch), sp = Math.sin(wc.aimPitch);
      _v.set(mp.x - sy * cp * 60, mp.y + 1.5 + sp * 60, mp.z - cy * cp * 60).project(camera);
      if (_v.z < 1) this.el.gun.style.transform = `translate(${((_v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-_v.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
    }
    // ---- status, ammo
    const hp = me.health, st = me.movement.state, cw = wc.current;
    const ammo = cw ? (cw.usesHeat ? `HEAT ${cw.heat.toFixed(0)}%` : cw.usesBattery ? `${cw.battery.toFixed(0)}%` : `${cw.mag} / ${cw.reserve}`) : '';
    this.el.status.innerHTML = `
      <div class="bar"><i style="width:${(hp.hp / hp.max * 100).toFixed(0)}%;background:#e8f1ff"></i></div>
      ${hp.maxShield ? `<div class="bar sm"><i style="width:${(hp.shield / hp.maxShield * 100).toFixed(0)}%;background:#7fd6ff"></i></div>` : ''}
      <div class="bar sm"><i style="width:${st.stamina.toFixed(0)}%;background:${st.exhausted ? '#ff6b6b' : '#c8d47a'}"></i></div>
      <div class="wpn">${me.mode === 'gun' ? `${cw?.s.name ?? ''} · <b>${ammo}</b>${wc.phase === 'reloading' ? ' · RELOADING' : ''}` : `${me.melee.w.name ?? 'Sword'} · heat ${me.melee.heat.toFixed(0)}`} · ${st.stance.toUpperCase()}</div>`;
    this.el.feed.innerHTML = this.feed.filter((k) => this.time - k.t < 8).map((k) => k.html).join('<br>');
    // ---- respawn, downed, revives and banners
    const dead = me.health.dead && mode.winner < 0, rv = s.world.revives;
    this.el.respawn.style.display = dead || hp.downed ? 'block' : 'none';
    if (dead) {
      const wait = Math.max(0, me.respawnAt - s.time);
      this.el.respawn.innerHTML = wait > 0 ? `REINFORCEMENTS IN <b>${wait.toFixed(1)}</b>` : 'PRESS <b>SPACE</b> TO DEPLOY';
    } else if (hp.downed) {
      const helper = rv.reviverOf(me.id), job = helper && rv.jobOf(helper.id);
      let near = Infinity, medic = false;
      for (const f of s.fighters) if (f !== me && f.team === team && f.health.up) { const d = f.movement.state.position.distanceTo(mp); if (d < near) { near = d; medic = rv.isMedic(f); } }
      this.el.respawn.innerHTML = job
        ? `<span style="color:#7fffb0">BEING REVIVED</span> ${bar(job.t / job.need, '#7fffb0')}`
        : `<span style="color:#ff6b6b">DOWNED</span> · bleeding out <b>${Math.max(0, hp.bleed).toFixed(0)}</b>s<br><small>${near < 60 ? `${medic ? 'medic' : 'teammate'} ${near.toFixed(0)} m · ` : 'nobody close · '}hold <b>SPACE</b> to give up</small>`;
    }
    const myJob = rv.jobOf(me.id), patient = !hp.downed && !me.health.dead && !myJob ? rv.patientFor?.(me) : null;
    const D = this.dig && this.time - this.dig.t < 0.25 ? this.dig : this.dig?.stage === -1 && this.time - this.dig.t < 1.5 ? this.dig : null;
    this.el.prompt.innerHTML = myJob ? `REVIVING ${bar(myJob.t / myJob.need, '#7fffb0')}`
      : D ? (D.stage === -1 ? `${D.kind === 'foxhole' ? 'FOXHOLE DUG' : D.kind === 'sandbags' ? 'SANDBAGS UP' : 'TRENCH CUT'}` : `${['DIGGING A FOXHOLE', 'FILLING SANDBAGS', 'DIGGING A TRENCH'][D.stage]} ${bar(D.k, '#d9b77a')}`)
      : patient ? `HOLD <b>X</b> TO REVIVE ${patient.name ?? ''}` : '';
    this.#squad(me);
    this.el.suppress.style.opacity = Math.min(1, (me.suppression ?? 0) * 1.1).toFixed(2);
    this.#downMarkers(camera, w, h);
    if (this.time > this.bannerUntil) this.el.banner.style.opacity = 0;
  }

  /** Your squad: what the squad is doing and what each squadmate is up to. */
  #squad(me) {
    const sq = me.squad;
    if (!sq || sq.members.length < 2) { this.el.squad.innerHTML = ''; return; }
    const T = sq.tactics, now = this.time;
    if (this.squadT && now - this.squadT < 0.2) return;   // 5 Hz is plenty for text
    this.squadT = now;
    const PHASE = { follow: 'ON YOU', advance: 'ADVANCING', contact: 'BOUNDING · IN CONTACT', jumpoff: 'IN THE TRENCH · WAITING FOR THE WHISTLE', assault: 'ASSAULTING THE POINT', clear: 'CLEARING A BUILDING', hold: 'HOLDING THE LINE', charge: 'CHARGE!', regroup: 'REGROUPING', down: 'SQUAD DOWN' };
    const rows = sq.members.filter((m) => m !== me).map((m) => {
      const h = m.health, o = m.brain?.order;
      const state = h.dead ? 'dead' : h.downed ? 'down' : '';
      const what = h.dead ? 'redeploying' : h.downed ? 'DOWN' : m.vehicle ? 'in a vehicle' : o?.why ?? '';
      return `<div class="m ${state}"><span>${m.name}</span><em>${what}</em></div>`;
    }).join('');
    this.el.squad.innerHTML = `<div class="hd" style="color:${TEAM_COL[this.team]}">SQUAD ${sq.id + 1} · ${PHASE[T?.phase] ?? ''}</div>${rows}`;
  }

  /** Red crosses over downed teammates within 60 m (pooled DOM nodes). */
  #downMarkers(camera, w, h) {
    const me = this.player, mp = me.movement.state.position;
    let n = 0;
    for (const f of this.s.fighters) {
      if (f === me || f.team !== this.team || !f.health.downed) continue;
      const p = f.movement.state.position, d = p.distanceTo(mp);
      if (d > 60) continue;
      _v.copy(p); _v.y += 1.0; _v.project(camera);
      if (_v.z > 1) continue;
      const el = this.downMarks[n] ?? this.el.downs.appendChild(Object.assign(document.createElement('div'), { className: 'dn' }));
      this.downMarks[n++] = el;
      el.style.display = 'block';
      el.style.transform = `translate(${((_v.x * 0.5 + 0.5) * w).toFixed(0)}px, ${((-_v.y * 0.5 + 0.5) * h).toFixed(0)}px)`;
      el.innerHTML = `✚<span>${d.toFixed(0)} m · ${Math.max(0, f.health.bleed).toFixed(0)}s</span>`;
      el.classList.toggle('helped', f.health.reviving > 0);
    }
    for (let i = n; i < this.downMarks.length; i++) this.downMarks[i].style.display = 'none';
  }

  #minimap() {
    const c = this.ctx, s = this.s, b = s.map.bounds, mode = s.mode;
    const W = c.canvas.width, H = c.canvas.height;
    const sx = W / (b.maxX - b.minX), sz = H / (b.maxZ - b.minZ);
    const X = (x) => (x - b.minX) * sx, Z = (z) => (z - b.minZ) * sz;
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#0b0d12cc'; c.fillRect(0, 0, W, H);
    for (const sec of s.map.sectors) {
      const owner = mode.sectors[sec.index].owner;
      c.fillStyle = owner === 0 ? '#ffcf6b1a' : owner === 1 ? '#b994ff1a' : '#ffffff0d';
      c.fillRect(X(sec.x0), 0, (sec.x1 - sec.x0) * sx, H);
      c.strokeStyle = mode.isAttacked(sec.index) ? '#ffffff55' : '#ffffff18';
      c.strokeRect(X(sec.x0) + 0.5, 0.5, (sec.x1 - sec.x0) * sx - 1, H - 1);
    }
    for (const p of mode.points) {
      c.fillStyle = p.owner >= 0 ? TEAM_COL[p.owner] : NEUTRAL_COL;
      c.globalAlpha = mode.capturable(p) ? 1 : 0.4;
      c.beginPath(); c.arc(X(p.pos.x), Z(p.pos.z), 3.5, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
    for (const f of s.fighters) {
      if (f.health.dead || f === this.player) continue;
      const ally = f.team === this.team;
      if (!ally && this.time - (this.spotted.get(f.id) ?? -99) > 2) continue;
      const p = f.movement.state.position;
      if (ally && f.health.downed) {
        // Downed teammates: a small red cross, so the medics know where to go.
        c.fillStyle = '#ff5a5a';
        c.fillRect(X(p.x) - 2.5, Z(p.z) - 0.75, 5, 1.5); c.fillRect(X(p.x) - 0.75, Z(p.z) - 2.5, 1.5, 5);
        continue;
      }
      c.fillStyle = ally ? '#9fd3ff' : '#ff4d6d';
      c.fillRect(X(p.x) - 1, Z(p.z) - 1, 2, 2);
    }
    const p = this.player.movement.state.position, yaw = this.player.movement.state.yaw;
    c.save(); c.translate(X(p.x), Z(p.z)); c.rotate(-yaw);
    c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(0, -5); c.lineTo(3.5, 4); c.lineTo(-3.5, 4); c.closePath(); c.fill();
    c.restore();
  }
}
