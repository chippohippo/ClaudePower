// FrontlineHud: the battle HUD for 8 to 400 players. DOM + one canvas, updated at render rate.
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
//  * The supply war (12v12 and up): the forward depot's stock and the HQ dump's, trucks on the
//    road, shortages and depot moves as banners, the preparation barrage before a whistle;
//    on the minimap our depots, guns and trucks, enemy guns we've located, and where shells land.
//    Prompts to crew a gun or drive a vehicle (FireControl draws the gun panel itself).
//  * Support roles: your class passive and items on the status panel (stims, ammo packs), prompts
//    to stim the teammate in front of you or repair the vehicle beside you, enemies a spotter
//    has revealed on the minimap, and (Mindread) the abilities of the enemy in your sights.
//  * The city's people: civilians near you grey on the minimap (red while one shoots at your
//    side), a gang's raiders orange when they give themselves away, a banner as you walk into a
//    gang's turf, and the killfeed's CIVILIAN tag on a civilian killed who wasn't fighting.

import * as THREE from 'three';
import { RIGHT_TIME } from '../vehicles/VehicleSystem.js';
import { bus } from '../core/EventBus.js';
import { CIVILIAN, BANDIT, civilianEngaging } from '../combat/Teams.js';

const TEAM_COL = ['#ffcf6b', '#b994ff', '#d8d4cc', '#ff7a4d'];   // Solari, Void, the city's civilians, its gangs
const NEUTRAL_COL = '#d8dde6';
const TEAM_NAME = ['SOLARI', 'VOID'];
const _v = new THREE.Vector3();
const SHORT = { ammo: 'AMMO', shells: 'SHELLS', sandbags: 'SANDBAGS', tank: 'TANKS', hoverbike: 'BIKES', howitzer: 'GUNS', rockets: 'ROCKETS', at: 'AT GUNS' };
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
      <div id="fl-supply"></div>
      <div id="fl-suppress"></div>
      <div id="fl-mind"></div>`;
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
    this.impacts = [];          // { x, z, t } artillery rounds landing (minimap flashes)
    this.saidAt = new Map();    // banner kind -> time (shortage banners don't spam)
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
        const kt = teamOf(e.by), tk = kt === vt && e.by && e.by !== e.id && vt !== CIVILIAN;   // friendly fire: a teamkill
        // A civilian who wasn't shooting at the side that killed him.
        const v = fighter(e.id), innocent = vt === CIVILIAN && kt !== CIVILIAN && kt >= 0 && !(v && civilianEngaging(session.world, v, kt));
        this.feed.unshift({ html: `<span style="color:${TEAM_COL[kt] ?? '#aaa'}">${e.by === player.id ? 'You' : e.by ? name(e.by) : 'World'}</span> ▸ <span style="color:${TEAM_COL[vt]}">${e.id === player.id ? 'You' : name(e.id)}</span>${tk ? ' <b style="color:#ff4d40">TEAMKILL</b>' : innocent ? ' <b style="color:#ffb36b">CIVILIAN</b>' : ''}`, t: this.time });
        this.feed.length = Math.min(this.feed.length, 6);
        if (tk && e.by === player.id) this.#say('tk', 'TEAMKILL · CHECK YOUR FIRE', '#ff4d40', 2, 4);
        if (innocent && e.by === player.id) this.#say('civ', 'CIVILIAN KILLED · CHECK YOUR FIRE', '#ff4d40', 2, 4);
      }),
      // Friendly fire: your rounds in a teammate, or a teammate's in you.
      bus.on('weapon:hit', (e) => {
        if (!e.friendly) return;
        if (e.attacker === player.id) this.#say('ff', 'FRIENDLY FIRE', '#ff4d40', 1.1, 2.5);
        else if (e.victim === player.id) this.#say('ffIn', `${name(e.attacker).toUpperCase()} · WATCH YOUR FIRE`, '#ffb36b', 1.2, 4);
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
      bus.on('artillery:impact', (e) => { this.impacts.push({ x: e.point[0], z: e.point[2], t: this.time }); if (this.impacts.length > 60) this.impacts.shift(); }),
      bus.on('support:prep', (e) => { if (e.team === this.team) this.#say('prep', 'ARTILLERY PREPARATION · STAND BY FOR THE WHISTLE', TEAM_COL[this.team], 2.5, 25); }),
      bus.on('logistics:short', (e) => { if (e.team === this.team) this.#say(`short:${e.what}`, `FRONT SHORT OF ${SHORT[e.what] ?? 'SUPPLIES'} · RUN THE TRUCKS`, '#ffb36b', 2, 30); }),
      bus.on('logistics:moved', (e) => { if (e.team === this.team) this.banner(e.advanced ? 'FORWARD DEPOT MOVED UP' : 'FORWARD DEPOT OVERRUN · FALL BACK', e.advanced ? TEAM_COL[this.team] : '#ff6b81', 2.2); }),
      bus.on('mode:victory', (e) => this.banner(e.team === this.team ? `VICTORY · ${e.reason.toUpperCase()}` : `DEFEAT · ${e.reason.toUpperCase()}`, e.team === this.team ? TEAM_COL[this.team] : '#ff6b81', 999)),
    ];
  }

  dispose() { this.off.forEach((f) => f()); }

  /** A banner at most once every `every` seconds per kind. */
  #say(kind, text, color, seconds, every) {
    if (this.time - (this.saidAt.get(kind) ?? -1e9) < every) return;
    this.saidAt.set(kind, this.time);
    this.banner(text, color, seconds);
  }

  banner(text, color, seconds = 2) {
    this.el.banner.textContent = text; this.el.banner.style.color = color; this.el.banner.style.opacity = 1;
    this.bannerUntil = this.time + seconds;
  }

  update(dt, camera) {
    this.time += dt;
    const s = this.s, mode = s.mode, me = this.player, team = this.team;
    // ---- a gang's turf: said once as you walk into it (they shoot whoever comes in)
    if (s.neutrals?.gangs.length) {
      const p = me.movement.state.position;
      const turf = s.neutrals.gangs.find((g) => Math.hypot(g.x - p.x, g.z - p.z) < g.r && g.members.some((m) => !m.health.dead)) ?? null;
      if (turf && turf !== this.turf && !me.health.dead) this.banner(`${turf.name.toUpperCase()} TURF · THEY SHOOT ON SIGHT`, TEAM_COL[BANDIT], 2.5);
      this.turf = turf;
    }
    // ---- tickets and the sector strip
    this.el.tk0.innerHTML = `<b style="color:${TEAM_COL[0]}">${TEAM_NAME[0]}</b> ${mode.tickets[0]}`;
    this.el.tk1.innerHTML = `${mode.tickets[1]} <b style="color:${TEAM_COL[1]}">${TEAM_NAME[1]}</b>`;
    this.el.strip.classList.toggle('many', mode.sectors.length > 9);   // the Extreme Warfront's thirteen sectors
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
    // Ammo: the mag, and the reserve as whole magazines (a pip each); shells are counted.
    const per = cw?.s.mag ?? 30, mags = cw ? Math.ceil(cw.reserve / per) : 0;
    const reserve = !cw ? '' : cw.s.reload?.style === 'shell' ? `${cw.reserve}` : mags ? `${'▮'.repeat(Math.min(mags, 10))}${mags > 10 ? `+${mags - 10}` : ''}` : 'NO MAGS';
    const ammo = cw ? (cw.usesHeat ? `HEAT ${cw.heat.toFixed(0)}%` : cw.usesBattery ? `${cw.battery.toFixed(0)}%` : `${cw.mag}${cw.magOut ? ' MAG OUT' : ''} · ${reserve}`) : '';
    const reloading = wc.phase === 'reloading' ? (st.sprinting ? ' · RELOAD HELD' : ` · RELOADING ${Math.min(99, Math.round((wc.phaseTime / Math.max(0.01, wc.phaseDuration)) * 100))}%`) : '';
    this.el.status.innerHTML = `
      <div class="bar"><i style="width:${(hp.hp / hp.max * 100).toFixed(0)}%;background:#e8f1ff"></i></div>
      ${hp.maxShield ? `<div class="bar sm"><i style="width:${(hp.shield / hp.maxShield * 100).toFixed(0)}%;background:#7fd6ff"></i></div>` : ''}
      <div class="bar sm"><i style="width:${st.stamina.toFixed(0)}%;background:${st.exhausted ? '#ff6b6b' : '#c8d47a'}"></i></div>
      <div class="wpn">${me.mode === 'gun' ? `${cw?.s.name ?? ''} · <b>${ammo}</b>${reloading}` : `${me.melee.w.name ?? 'Sword'} · heat ${me.melee.heat.toFixed(0)}`} · ${st.stance.toUpperCase()}</div>
      ${this.#kit(me)}
      ${s.bp ? `<div class="wpn" style="color:#ffe14d">★ <b>${s.bp.points(me)}</b> BATTLE POINTS</div>` : ''}`;
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
    const sup = s.world.support, fixing = me.repairing?.target;
    const fin = me.reviveJob?.finish ? me.reviveJob : null, victim = !fin && !patient && !myJob && !hp.downed && !me.health.dead ? rv.victimFor?.(me) : null;
    this.el.prompt.innerHTML = myJob ? `REVIVING ${bar(myJob.t / myJob.need, '#7fffb0')}`
      : fin ? `<span style="color:#ff6b5c">FINISHING</span> ${bar(fin.t / fin.need, '#ff6b5c')}`
      : victim ? `HOLD <b>X</b> TO FINISH ${(victim.name ?? '').toUpperCase()}`
      : fixing ? `REPAIRING ${bar(fixing.health.hp / fixing.health.max, '#9fd3ff')}`
      : D ? (D.stage === -1 ? `${D.kind === 'foxhole' ? 'FOXHOLE DUG' : D.kind === 'sandbags' ? 'SANDBAGS UP' : 'TRENCH CUT'}` : `${['DIGGING A FOXHOLE', 'FILLING SANDBAGS', 'DIGGING A TRENCH'][D.stage]} ${bar(D.k, '#d9b77a')}`)
      : patient ? `HOLD <b>X</b> TO REVIVE ${patient.name ?? ''}${this.#stimPrompt(me, sup) ? ` · <b>3</b> STIM` : ''}`
      : this.#repairPrompt(me, sup) || this.#stimPrompt(me, sup) || this.#boardPrompt(me);
    this.#mindread(me, camera, w, h);
    this.#squad(me);
    this.#supply();
    this.el.suppress.style.opacity = Math.min(1, (me.suppression ?? 0) * 1.1).toFixed(2);
    this.#downMarkers(camera, w, h);
    if (this.time > this.bannerUntil) this.el.banner.style.opacity = 0;
  }

  /** Your class passive and your items (stims, ammo packs) on the status panel. */
  #kit(me) {
    const P = me.passive ? this.s.world.passives.defs[me.passive]?.name : null, I = me.items;
    if (!P && !I) return '';
    const items = I ? `${I.kind === 'stim' ? 'STIMS' : 'AMMO PACKS'} <b>${'✚'.repeat(I.left)}${'·'.repeat(Math.max(0, I.max - I.left))}</b> <small>[3]</small>` : '';
    return `<div class="wpn" style="color:#9fd3ff">${P ? P.toUpperCase() : ''}${P && I ? ' · ' : ''}${items}</div>`;
  }

  /** A medic with stims facing a hurt or downed teammate in reach. */
  #stimPrompt(me, sup) {
    if (me.items?.kind !== 'stim' || me.items.left <= 0 || !me.health.up || me.vehicle) return '';
    const t = sup.stimTarget(me, me.movement.state.yaw);
    return t ? `<b>3</b> STIM ${(t.name ?? '').toUpperCase()}${t.health.downed ? ' (UP IN 1 S)' : ''}` : '';
  }

  /** An engineer beside a damaged friendly vehicle or turret. */
  #repairPrompt(me, sup) {
    if (!sup.data?.repair?.roles.includes(me.role) || !me.health.up || me.vehicle) return '';
    const t = sup.repairTarget(me);
    return t ? `HOLD <b>H</b> TO REPAIR THE ${(t.def?.name ?? t.kind ?? 'turret').toUpperCase()} ${bar(t.health.hp / t.health.max, '#9fd3ff')}` : '';
  }

  /** Mindread: the abilities of the enemy you've held in your sights, beside him on screen. */
  #mindread(me, camera, w, h) {
    const M = me.mindread, el = this.el.mind;
    const t = M && M.until > this.s.world.passives.time ? this.s.world.entity(M.id) : null;
    if (!t || t.health?.dead || !t.abilities) { if (el.style.display !== 'none') el.style.display = 'none'; return; }
    _v.copy(t.movement.state.position); _v.y += 2.3; _v.project(camera);
    if (_v.z > 1) { el.style.display = 'none'; return; }
    const keys = { ability1: 'Q', ability2: 'E', grenade: 'G' };
    const parts = Object.entries(keys).filter(([k]) => t.abilities.slots[k]).map(([k, key]) => { const s = t.abilities.slots[k]; return `${key} ${s.charges > 0 ? '<b style="color:#7fffb0">READY</b>' : `${Math.ceil(s.cooldown)}s`}`; });
    const sup = Math.round((t.abilities.superEnergy / Math.max(1, t.abilities.superCost)) * 100);
    parts.push(`SUPER ${sup >= 100 ? '<b style="color:#ff6b6b">READY</b>' : `${sup}%`}`);
    el.style.cssText = `position:absolute;left:${((_v.x * 0.5 + 0.5) * w).toFixed(0)}px;top:${((-_v.y * 0.5 + 0.5) * h).toFixed(0)}px;transform:translate(-50%,-100%);font:700 11px system-ui;color:#c9b6ff;text-shadow:0 0 4px #000;white-space:nowrap;pointer-events:none;letter-spacing:.05em`;
    el.innerHTML = `${(t.name ?? '').toUpperCase()} · ${parts.join(' · ')}`;
  }

  /**
   * "X: crew the Sunhammer Field Gun" beside a vehicle you could take; "HOLD X" beside one of our
   * cars on its roof (with how far over it is); in a car, its controls.
   */
  #boardPrompt(me) {
    if (me.health.dead || me.health.downed) return '';
    if (me.vehicle) {
      const v = me.vehicle.veh, role = v.seats[me.vehicle.seat].def.role;
      if (!v.car) return '';
      if (v.wreck) return `<span style="color:#ff6b5c">ON FIRE: GET OUT</span> · <b>X</b>`;
      return role === 'driver' ? '<b>W S</b> DRIVE · <b>A D</b> STEER · <b>SPACE</b> HANDBRAKE · <b>X</b> GET OUT' : '<b>X</b> GET OUT (AT SPEED YOU TUMBLE)';
    }
    const flipped = this.s.world.vehicles.flippedNear(me);
    if (flipped) {
      const k = me.righting?.car === flipped ? me.righting.t / RIGHT_TIME : 0;
      return `HOLD <b>X</b> TO PUSH THE ${flipped.def.name.toUpperCase()} BACK OVER${k > 0 ? ` ${bar(k, '#d9b77a')}` : ''}`;
    }
    const v = this.s.world.vehicles.nearestEnterable(me);
    if (!v) return '';
    const crew = !!v.def.gun && v.def.model === 'gun';
    return `<b>X</b> ${crew ? 'CREW' : 'TAKE'} THE ${v.def.name.toUpperCase()}`;
  }

  /** Supply: the forward depot's stock (and the HQ dump's), and the trucks on the road. */
  #supply() {
    const L = this.s.logistics;
    if (!L) { this.el.supply.innerHTML = ''; return; }
    if (this.supplyT && this.time - this.supplyT < 0.25) return;
    this.supplyT = this.time;
    const snap = L.snapshot(this.team), k = snap.front / snap.frontCap;
    const loaded = snap.trucks.filter((t) => t.cargo > 0).length;
    this.el.supply.innerHTML = `SUPPLY <b style="color:${k < 0.1 ? '#ff6b6b' : '#d9b77a'}">${snap.front}</b>${bar(k, k < 0.1 ? '#ff6b6b' : '#d9b77a')}<br><small>HQ dump ${snap.hq} · ${snap.trucks.length} trucks (${loaded} loaded)</small>`;
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
    const mp = this.player.movement.state.position;
    for (const f of s.fighters) {
      if (f.health.dead || f === this.player) continue;
      const ally = f.team === this.team, p = f.movement.state.position;
      // The city's civilians: the ones near you, grey (red while one shoots at your side).
      if (f.team === CIVILIAN) {
        const hostile = civilianEngaging(s.world, f, this.team);
        if (!hostile && Math.hypot(p.x - mp.x, p.z - mp.z) > 60) continue;
        c.fillStyle = hostile ? '#ff4d6d' : '#cfd4dc';
        c.fillRect(X(p.x) - 1, Z(p.z) - 1, 2, 2);
        continue;
      }
      const marked = !ally && f.status?.has('revealed');           // a spotter's mark: shown while it lasts
      if (!ally && !marked && this.time - (this.spotted.get(f.id) ?? -99) > 2) continue;
      if (marked) { c.strokeStyle = '#ff4d6d'; c.strokeRect(X(p.x) - 2.5, Z(p.z) - 2.5, 5, 5); }
      if (ally && f.health.downed) {
        // Downed teammates: a small red cross, so the medics know where to go.
        c.fillStyle = '#ff5a5a';
        c.fillRect(X(p.x) - 2.5, Z(p.z) - 0.75, 5, 1.5); c.fillRect(X(p.x) - 0.75, Z(p.z) - 2.5, 1.5, 5);
        continue;
      }
      c.fillStyle = ally ? '#9fd3ff' : f.team === BANDIT ? TEAM_COL[BANDIT] : '#ff4d6d';
      c.fillRect(X(p.x) - 1, Z(p.z) - 1, 2, 2);
    }
    // The supply war: our depots, guns and trucks; enemy guns we've located; rounds landing.
    const L = s.logistics;
    if (L) {
      for (const d of L.depots) {
        if (d.team !== this.team) continue;
        c.strokeStyle = '#d9b77a'; c.fillStyle = '#d9b77a';
        if (d.kind === 'front') c.fillRect(X(d.pos.x) - 3, Z(d.pos.z) - 3, 6, 6); else c.strokeRect(X(d.pos.x) - 3.5, Z(d.pos.z) - 3.5, 7, 7);
      }
      for (const v of s.world.vehicles.list) {
        if (v.removed || v.team !== this.team || !(v.def.gun || v.def.cargo)) continue;
        const q = v.movement.state.position;
        c.fillStyle = v.def.cargo ? '#d9b77a' : TEAM_COL[this.team];
        if (v.def.cargo) c.fillRect(X(q.x) - 2, Z(q.z) - 1, 4, 2);
        else { c.beginPath(); c.moveTo(X(q.x), Z(q.z) - 3); c.lineTo(X(q.x) + 2.5, Z(q.z) + 2); c.lineTo(X(q.x) - 2.5, Z(q.z) + 2); c.closePath(); c.fill(); }
      }
      const located = s.support?.[this.team]?.enemyGuns;
      c.strokeStyle = '#ff4d6d'; c.lineWidth = 1.5;
      for (const [id, g] of located ?? []) {
        const v = s.world.entity(id);
        if (!v || v.removed || g.shots < 2) continue;
        const q = v.movement.state.position;
        c.beginPath(); c.moveTo(X(q.x) - 3, Z(q.z) - 3); c.lineTo(X(q.x) + 3, Z(q.z) + 3); c.moveTo(X(q.x) + 3, Z(q.z) - 3); c.lineTo(X(q.x) - 3, Z(q.z) + 3); c.stroke();
      }
      c.lineWidth = 1;
    }
    for (const im of this.impacts) {
      const age = this.time - im.t;
      if (age > 1.5) continue;
      c.strokeStyle = `rgba(255,150,70,${(1 - age / 1.5).toFixed(2)})`;
      c.beginPath(); c.arc(X(im.x), Z(im.z), 2 + age * 6, 0, Math.PI * 2); c.stroke();
    }
    const p = this.player.movement.state.position, yaw = this.player.movement.state.yaw;
    c.save(); c.translate(X(p.x), Z(p.z)); c.rotate(-yaw);
    c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(0, -5); c.lineTo(3.5, 4); c.lineTo(-3.5, 4); c.closePath(); c.fill();
    c.restore();
  }
}
