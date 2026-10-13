// Client game session: fixed-step input sampling, client-side movement prediction with server
// reconciliation, remote entity interpolation, client-side projectile hit detection ("favour the
// shooter", validated by the server), recoil/spread/ADS gunplay, camera feel, audio + VFX events,
// interaction targeting and the HUD bridge.

import * as THREE from 'three';
import { buildMap } from '../shared/map.js';
import { createMoveState, stepMovement, copyMoveState, eyeHeight, playerHeight, MEV } from '../shared/movement.js';
import { SIM_DT, BTN, INTERP_DELAY, SHIELD_COLORS, SHIELD_TIERS, MOVE, TEAM_COLORS } from '../shared/constants.js';
import { WEAPONS, fireInterval, currentSpread, magSize } from '../shared/weapons.js';
import { ATTACHMENTS, itemName, itemRarity, RARITY } from '../shared/items.js';
import { LEGENDS } from '../shared/legends.js';
import { speedMul } from '../shared/mods.js';
import { rayPlayer } from '../shared/physics.js';
import { DEG, clamp, dirFromAngles, wrapAngle, lerp } from '../shared/util.js';
import { WorldView } from './world.js';
import { Avatar } from './avatars.js';
import { ViewModel } from './viewmodel.js';
import { FX } from './fx.js';
import { LootView } from './lootview.js';
import { audio } from './audio.js';
import { settings } from './input.js';

const PELLET_PATTERN = [[0, 0], [1, 0], [0.5, 0.87], [-0.5, 0.87], [-1, 0], [-0.5, -0.87], [0.5, -0.87], [0.45, 0.2], [-0.45, 0.2], [0, -0.45], [0, 0.45]];

export class Game {
  constructor(app, transport, welcome) {
    this.app = app;
    this.net = transport;
    this.input = app.input;
    this.hud = app.hud;
    this.renderer = app.renderer;
    this.myId = welcome.you;
    this.mode = welcome.mode;
    this.map = buildMap(welcome.seed);
    this.world = this.map.world;
    this.meta = new Map(welcome.players.map((p) => [p.id, p]));
    const mine = this.meta.get(this.myId);
    this.mySquad = mine.squad;
    this.myLegend = mine.legend;
    this.shipInfo = welcome.ship;

    this.view = new WorldView(this.renderer, this.map);
    this.scene = this.view.scene;
    this.camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.05, 4000);
    this.fx = new FX(this.scene, this.camera, this.world);
    this.loot = new LootView(this.scene);
    this.loot.set(welcome.loot);
    this.vm = new ViewModel();
    this.binsOpened = welcome.bins.slice();

    this.pred = createMoveState(welcome.ship.ax, 300, welcome.ship.az);
    this.prev = copyMoveState(this.pred);
    this.corr = new THREE.Vector3();
    this.pending = [];
    this.seq = 0;
    this.acc = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.latch = 0;

    this.remotes = new Map();
    this.timeOffset = null;
    this.lastSnapAt = 0;
    this.meView = null;
    this.me = null;
    this.inv = null;
    this.ring = null;
    this.aliveCount = 100;
    this.squadsLeft = 33;
    this.squadInfo = [];
    this.entityList = [];
    this.pings = [];
    this.phase = 'ship';

    // weapon feel state
    this.localMag = 0;
    this.lastFireT = -9;
    this.fireCd = 0;
    this.recoilIdx = 0;
    this.bloom = 0;
    this.adsAmt = 0;
    this.localReload = null;
    this.localSwitch = 0;
    this.shotSeq = 1;
    this.bullets = [];
    this.trauma = 0;
    this.landDip = 0;
    this.fovKick = 0;
    this.time = 0;
    this.stepDist = 0;
    this.lastUlt = 1;
    this.warnT = 0;
    this.hbT = 0;
    this.boxOpen = null;
    this.invOpen = false;
    this.mapOpen = false;
    this.ended = false;
    this.spectating = false;
    this.fps = 0;
    this.fpsAcc = 0; this.fpsN = 0;
    this.pingMs = 0;
    this.showStats = settings.showFps;
    this.prompt = null;
    this.tmpBoxes = [];
    this.tmpV = new THREE.Vector3();
    this.lastWeaponKey = null;
    this.hud.show(true);
    audio.loop('wind', 'wind', 0.25);
  }

  // =================================================================== network in
  onMessage(m) {
    switch (m.t) {
      case 'snap': this._snap(m); break;
      case 'inv': this.inv = m; this._invChanged(); break;
      case 'box': this._openBox(m); break;
      case 'toast': this.hud.toast(m.msg); break;
      case 'squadout': this._squadOut(m); break;
      case 'end': this._end(m); break;
      case 'respawned': this.hud.announce('YOU HAVE BEEN RESPAWNED', 3); this.spectating = false; break;
      case 'pong': this.pingMs = Math.round(performance.now() - m.c); break;
    }
  }

  _invChanged() {
    if (this.invOpen) this._renderInv();
    const w = this.inv.weapons[this.inv.active];
    const key = w ? w.id + ':' + w.tier : null;
    if (key !== this.lastWeaponKey) {
      this.lastWeaponKey = key;
      if (w) this.localMag = w.mag;
      audio.play('draw', null, { vol: 0.6 });
      this.recoilIdx = 0;
    }
  }

  _serverNow() {
    return performance.now() / 1000 + (this.timeOffset || 0);
  }

  _snap(s) {
    const now = performance.now() / 1000;
    const off = s.time - now;
    if (this.timeOffset === null || Math.abs(off - this.timeOffset) > 1) this.timeOffset = off;
    else this.timeOffset += (off - this.timeOffset) * (off > this.timeOffset ? 0.3 : 0.05);
    this.lastSnapAt = now;
    this.phase = s.phase;
    this.ring = s.ring;
    this.aliveCount = s.alive;
    this.squadsLeft = s.squads;
    this.squadInfo = s.sq;
    this.shipNow = s.ship;
    this.heartbeat = s.hb;
    if (s.warn && this.myLegend === 'phantom' && this.time - this.warnT > 4) {
      this.warnT = this.time;
      audio.play('warn', null, { vol: 0.7 });
      this.hud.toast('ENEMY IS AIMING AT YOU');
    }
    const prevMe = this.me;
    this.me = s.me;
    this.spectating = !s.me.alive && !!s.spec;
    this.meView = this.spectating ? s.spec : s.me;
    if (prevMe && prevMe.ult > 0 && s.me.ult <= 0 && s.me.alive) audio.play('ult_ready', null, { vol: 0.6 });

    // remote players
    const seen = new Set();
    const rt = s.time;
    for (const row of s.ps) {
      const id = row[0];
      if (id === this.myId && s.me.alive) continue;
      seen.add(id);
      let r = this.remotes.get(id);
      if (!r) {
        const meta = this.meta.get(id) || { name: '?', legend: 'jolt', squad: -1 };
        r = { id, meta, buf: [], avatar: null, lastSeen: rt, step: 0, pos: new THREE.Vector3(), fl: 0, crouch: 0, sh: 0, armor: 0 };
        this.remotes.set(id, r);
      }
      r.lastSeen = rt;
      const last = r.buf[r.buf.length - 1];
      if (last && Math.hypot(last.x - row[1], last.z - row[3]) > 12) r.buf.length = 0; // teleport
      r.buf.push({ t: rt, x: row[1], y: row[2], z: row[3], yaw: row[4], pitch: row[5], fl: row[6], crouch: row[7], weapon: row[8], hp: row[9], sh: row[10], armor: row[11], vx: row[12], vz: row[13], rev: row[14] === 1 });
      if (r.buf.length > 30) r.buf.shift();
    }
    for (const [id, r] of this.remotes) {
      if (!seen.has(id) && rt - r.lastSeen > 0.6) {
        if (r.avatar) r.avatar.dispose();
        this.remotes.delete(id);
      }
    }

    // entities
    this.entityList = s.es;
    this.fx.syncEntities(s.es, this.time, this.mySquad);
    this.world.pads.length = 0;
    for (const e of s.es) if (e.k === 'jumppad') this.world.pads.push(e);

    // reconcile local prediction
    this._reconcile(s);
    // events
    for (const ev of s.ev) this._event(ev);
  }

  _reconcile(s) {
    const me = s.me;
    const sm = me.ms;
    if (!me.alive || me.inShip) {
      copyMoveState(sm, this.pred);
      copyMoveState(sm, this.prev);
      this.pending.length = 0;
      this.corr.set(0, 0, 0);
      if (me.inShip) { this.pred.mode = 'ship'; }
      return;
    }
    // drop acknowledged commands
    let i = 0;
    while (i < this.pending.length && this.pending[i].seq <= s.ack) i++;
    this.pending.splice(0, i);
    const bx = this.pred.x, by = this.pred.y, bz = this.pred.z;
    copyMoveState(sm, this.pred);
    for (const c of this.pending) {
      this._mods(c);
      stepMovement(this.pred, c, SIM_DT, this.world);
    }
    const dx = this.pred.x - bx, dy = this.pred.y - by, dz = this.pred.z - bz;
    const err = Math.hypot(dx, dy, dz);
    if (err > 0.001) {
      this.prev.x += dx; this.prev.y += dy; this.prev.z += dz;
      if (err < 3) this.corr.set(this.corr.x - dx, this.corr.y - dy, this.corr.z - dz);
      else this.corr.set(0, 0, 0);
    }
  }

  _mods(c) {
    const me = this.me;
    if (!me) return;
    const w = this.inv && this.inv.weapons[this.inv.active];
    this.pred.speedMul = speedMul(me.st || {}, me.heal, w ? w.id : null, c.buttons, this.myLegend);
    this.pred.downed = me.down ? 1 : 0;
    if (me.heal && c.buttons & BTN.SPRINT) c.buttons &= ~BTN.SPRINT;
  }

  // =================================================================== events
  _name(id) {
    const m = this.meta.get(id);
    return m ? m.name : '?';
  }

  _isMate(id) {
    const m = this.meta.get(id);
    return m && m.squad === this.mySquad;
  }

  _event(ev) {
    const pos = ev.x !== undefined ? { x: ev.x, y: ev.y ?? 0, z: ev.z } : null;
    const camP = this.camera.position;
    switch (ev.e) {
      case 'shot': {
        if (ev.id === this.myId) break;
        const w = WEAPONS[ev.w];
        const o = { x: ev.o[0], y: ev.o[1], z: ev.o[2] };
        audio.gunshot(ev.w, o, false);
        const enemy = !this._isMate(ev.id);
        for (const d of ev.d) {
          const b = this.fx.spawnBullet(o, { x: d[0], y: d[1], z: d[2] }, w.speed, w.drop, enemy ? '#ff9c5a' : '#ffe08a', w.pellets ? 0.6 : 1);
          b.silent = Math.hypot(o.x - camP.x, o.z - camP.z) > 120;
          if (enemy) {
            // near-miss whiz + crack
            const vx = camP.x - o.x, vy = camP.y - o.y, vz = camP.z - o.z;
            const t = vx * d[0] + vy * d[1] + vz * d[2];
            if (t > 3 && t < 300) {
              const cx = o.x + d[0] * t - camP.x, cy = o.y + d[1] * t - camP.y, cz = o.z + d[2] * t - camP.z;
              const miss = Math.hypot(cx, cy, cz);
              if (miss < 3 && Math.random() < (w.pellets ? 0.2 : 1)) {
                audio.play('whiz', { x: camP.x + cx, y: camP.y + cy, z: camP.z + cz }, { vol: 0.9, var: 0.1, delay: t / w.speed, ref: 1 });
                this.trauma = Math.min(1, this.trauma + 0.05);
              }
            }
          }
        }
        this.fx.flashLight(o.x, o.y, o.z, 6, 0.05, '#ffbb66');
        break;
      }
      case 'hit': {
        if (ev.a === this.myId && ev.v !== this.myId) {
          const tier = ev.tier;
          const onShield = ev.sd > 0;
          const color = onShield ? SHIELD_COLORS[tier] : ev.part === 'head' ? '#ffd23f' : '#ffffff';
          this.fx.damageNumber(ev.x, ev.y, ev.z, ev.dmg, color, ev.part === 'head', ev.v);
          if (ev.src) { // explosive/ability damage: no client-side marker was shown yet
            this.hud.hitmarker('body');
            audio.play(onShield ? 'hit_shield' : 'hit_flesh', null, { vol: 0.8 });
          }
          if (ev.brk) {
            audio.play('shield_break', null, { vol: 0.9, important: true });
            this.fx.shieldBreak(ev.x, ev.y, ev.z, tier);
          }
          if (ev.knock) { audio.play('knock', null, { vol: 1, important: true }); this.hud.hitmarker('kill'); }
        }
        const viewing = this.spectating ? this.meView.id : this.myId;
        if (ev.v === viewing) {
          if (ev.a) {
            const ang = Math.atan2(-(ev.ax - this.pred.x), -(ev.az - this.pred.z));
            this.hud.damageFrom(ang);
          }
          this.trauma = Math.min(1, this.trauma + Math.min(0.5, ev.dmg / 60));
          audio.play(ev.sd > 0 ? 'hit_shield' : 'hit_flesh', null, { vol: 0.7, rate: 0.62, var: 0.05 });
          if (ev.brk) audio.play('shield_break', null, { vol: 0.7, rate: 0.8 });
        }
        if (ev.v !== this.myId && ev.a !== this.myId) {
          this.fx.hitBurst(ev.x, ev.y, ev.z, ev.tier, ev.sd > 0, ev.part === 'head');
        }
        break;
      }
      case 'knock': {
        const mine = ev.a === this.myId;
        this.hud.killfeed(`<span class="${mine ? 'mine' : this._isMate(ev.a) ? 'sq' : ''}">${this._name(ev.a) || 'Ring'}</span><span class="w">⤓ ${ev.w || ''}</span><span class="${this._isMate(ev.v) ? 'sq' : ''}">${this._name(ev.v)}</span>`);
        if (mine) this.hud.toast(`KNOCKED DOWN ${this._name(ev.v)}`);
        if (ev.v === this.myId) { this.hud.announce('YOU ARE DOWN — CRAWL TO YOUR SQUAD', 3); audio.play('knock', null, { rate: 0.7 }); }
        break;
      }
      case 'kill': {
        const mine = ev.a === this.myId;
        const killer = ev.a ? this._name(ev.a) : 'RING';
        this.hud.killfeed(`<span class="${mine ? 'mine' : this._isMate(ev.a) ? 'sq' : ''}">${killer}</span><span class="w">✖ ${ev.w || ''}</span><span class="${this._isMate(ev.v) ? 'sq' : ''}">${this._name(ev.v)}</span>`);
        if (mine) {
          audio.play('kill', null, { vol: 1, important: true });
          this.hud.hitmarker('kill');
          this.hud.toast(`ELIMINATED ${this._name(ev.v)}`);
        }
        if (pos) this.fx.burst(pos.x, pos.y + 1, pos.z, '#ff3b3b', 30, 4, 0.18, 0.8);
        break;
      }
      case 'impact':
        this.fx.impact(ev.x, ev.y, ev.z, ev.n[0], ev.n[1], ev.n[2]);
        if (Math.hypot(ev.x - camP.x, ev.z - camP.z) < 25) audio.play('impact', ev, { vol: 0.5, var: 0.15 });
        break;
      case 'boom': {
        const d = Math.hypot(ev.x - camP.x, ev.y - camP.y, ev.z - camP.z);
        this.fx.explosion(ev.x, ev.y, ev.z, ev.r || 4);
        audio.play('boom', ev, { vol: ev.k === 'land' ? 0.6 : 1, var: 0.08, ref: 10, rolloff: 0.8, delay: d / 343, important: true, reverb: 0.3 });
        this.trauma = Math.min(1, this.trauma + Math.max(0, 1 - d / 30) * 0.8);
        break;
      }
      case 'abil': this._abilEvent(ev, pos); break;
      case 'mv': {
        if (ev.id === this.myId) break;
        const f = ev.f;
        if (f & MEV.SLIDE) audio.play('slidestart', pos, { vol: 0.8 });
        if (f & MEV.JUMP) audio.play('jump', pos, { vol: 0.6 });
        if (f & (MEV.WALLJUMP)) audio.play('wallkick', pos, { vol: 0.8 });
        if (f & MEV.MANTLE) audio.play('mantle', pos, { vol: 0.7 });
        if (f & MEV.SUPERGLIDE) audio.play('superglide', pos, { vol: 0.8 });
        if (f & MEV.PAD) audio.play('pad', pos, { vol: 1 });
        if (f & MEV.HARDLAND) audio.play('hardland', pos, { vol: 0.9 });
        break;
      }
      case 'reload': {
        if (ev.id === this.myId) break;
        audio.play('mag_out', pos, { vol: 0.6, delay: 0.25 });
        audio.play('mag_in', pos, { vol: 0.7, delay: 1.0 });
        break;
      }
      case 'heal': if (ev.id !== this.myId) audio.play('stim', pos, { vol: 0.25, rate: 1.5 }); break;
      case 'healed': audio.play('healed', null, { vol: 0.6 }); break;
      case 'pickup': audio.play(ev.item === 'armor' || ev.item === 'helmet' || ev.item === 'pack' ? 'pickup_armor' : 'pickup', null, { vol: 0.7 }); break;
      case 'evo':
        audio.play('evo', null, { vol: 0.9, important: true });
        this.hud.announce(`EVO SHIELD UPGRADED — LV ${ev.tier}`, 2.5);
        this.fx.ring(this.pred.x, this.pred.y + 1, this.pred.z, SHIELD_COLORS[ev.tier], 2);
        break;
      case 'ring':
        if (ev.s === 'close') { audio.play('ring_close', null, { vol: 0.8, important: true }); }
        break;
      case 'msg': this.hud.announce(ev.text.toUpperCase(), 3.5); break;
      case 'revive': if (this._isMate(ev.id)) this.hud.toast(`${this._name(ev.id)} was revived`); break;
      case 'respawn': if (this._isMate(ev.id)) audio.play('call', null, { vol: 0.5 }); break;
      case 'banner': if (ev.sq === this.mySquad) audio.play('pickup_armor', null, { vol: 0.5 }); break;
      case 'squadout':
        if (ev.sq !== this.mySquad) this.hud.toast(`SQUAD ELIMINATED · ${ev.place - 1} SQUADS REMAIN`);
        break;
      case 'loot+': this.loot.add(ev.items); break;
      case 'loot-': this.loot.remove(ev.ids); break;
      case 'bin':
        this.binsOpened[ev.i] = 1;
        audio.play('mag_in', pos, { vol: 0.6, rate: 0.6 });
        this.fx.burst(ev.x, ev.y + 0.5, ev.z, '#3fa9ff', 14, 2, 0.12, 0.5);
        break;
      case 'ping': {
        const color = ev.k === 'enemy' ? '#ff3b3b' : ev.k === 'loot' ? '#ffd23f' : LEGENDS[this.meta.get(ev.id)?.legend || 'jolt'].color;
        this.pings.push({ x: ev.x, y: ev.y, z: ev.z, t: 12, color, k: ev.k, who: this._name(ev.id), el: null });
        audio.play(ev.k === 'enemy' ? 'enemy_down_ping' : 'ping', null, { vol: 0.6 });
        break;
      }
    }
  }

  _abilEvent(ev, pos) {
    const map = {
      stim: 'stim', phase: 'phase', drone: 'drone', dome: 'dome', pulse: 'pulse', gastrap: 'throw', gas: 'gas', smoke: 'smoke',
      launch: 'launch', missiles: 'missiles', call: 'call', bombard: 'call', thunder: 'call', exhibit: 'pulse', riftstart: 'riftstart',
      riftopen: 'riftopen', portal: 'portal', carepkg: 'carepkg', jumppad: 'launch', throw: 'throw', skyward: 'skyward', dropjump: 'dropjump',
    };
    const name = map[ev.k];
    if (!name) return;
    const self = ev.id === this.myId;
    audio.play(name, self ? null : pos, { vol: self ? 0.8 : 1, ref: 6, important: true, reverb: 0.2 });
    if (ev.k === 'pulse' && pos) {
      for (let i = 0; i < 40; i++) {
        const a = Math.atan2(ev.dz, ev.dx) + (Math.random() - 0.5) * 1.3;
        const sp = 30 + Math.random() * 30;
        this.fx.sparks.emit(pos.x, pos.y + 1.2, pos.z, Math.cos(a) * sp, (Math.random() - 0.5) * 4, Math.sin(a) * sp, new THREE.Color('#ffd23f'), 0.4, 1.2, 0);
      }
      if (self) this.hud.toast(ev.n ? `PULSE: ${ev.n} ENEMIES REVEALED` : 'PULSE: NO CONTACTS');
    }
    if (ev.k === 'phase' && pos) this.fx.burst(pos.x, pos.y + 1, pos.z, '#9b6bff', 30, 3, 0.2, 0.6);
    if (ev.k === 'stim' && pos) this.fx.burst(pos.x, pos.y + 1, pos.z, '#ff7a1a', 12, 2, 0.12, 0.4);
    if (ev.k === 'portal' && pos) this.fx.burst(pos.x, pos.y + 1, pos.z, '#b48bff', 25, 3, 0.2, 0.5);
    if (ev.k === 'dome' && pos) this.fx.ring(pos.x, pos.y, pos.z, '#3fa9ff', 3);
    if ((ev.k === 'bombard' || ev.k === 'thunder') && pos) this.hud.toast(ev.k === 'bombard' ? 'INCOMING BOMBARDMENT' : 'ROLLING THUNDER INCOMING');
    if (ev.k === 'skyward' && pos) this.fx.burst(pos.x, pos.y, pos.z, '#ff4d6d', 60, 8, 0.3, 1);
  }

  _openBox(m) {
    this.boxOpen = m;
    const e = this.entityList.find((x) => x.id === m.id);
    const title = e && e.k === 'carepkg' ? 'CARE PACKAGE' : e ? `${(e.name || '').toUpperCase()}'S BOX` : 'DEATH BOX';
    this.hud.renderDeathbox(title, m.items, (i) => this.net.send({ t: 'act', a: 'boxtake', id: m.id, i }));
    document.getElementById('deathbox').classList.remove('hidden');
    this.input.unlock();
  }

  closeBox() {
    if (!this.boxOpen) return;
    this.boxOpen = null;
    document.getElementById('deathbox').classList.add('hidden');
    this.input.lock();
  }

  _squadOut(m) {
    this.squadDone = m;
    if (this.ended) return;
    // show placement right away; the player can keep spectating or leave
    this.input.unlock();
    const el = document.getElementById('endscreen');
    el.classList.remove('hidden');
    el.querySelector('.place').textContent = `#${m.place}`;
    el.querySelector('.place').classList.remove('win');
    el.querySelector('.sub').textContent = 'SQUAD ELIMINATED';
    el.querySelector('.stats').innerHTML = `<span>KILLS ${m.kills}</span><span>DAMAGE ${m.damage}</span><span>SQUAD KILLS ${m.squadKills}</span>`;
    document.getElementById('btn-spectate').style.display = '';
  }

  spectate() {
    document.getElementById('endscreen').classList.add('hidden');
    this.input.lock();
  }

  _end(m) {
    this.ended = true;
    this.input.unlock();
    const el = document.getElementById('endscreen');
    el.classList.remove('hidden');
    document.getElementById('btn-spectate').style.display = 'none';
    const place = el.querySelector('.place');
    place.textContent = m.win ? 'CHAMPIONS' : `#${m.place}`;
    place.classList.toggle('win', !!m.win);
    el.querySelector('.sub').textContent = m.win ? 'YOU ARE THE CHAMPIONS' : `CHAMPIONS: ${m.champs.join(' · ')}`;
    el.querySelector('.stats').innerHTML = `<span>KILLS ${m.kills}</span><span>DAMAGE ${m.damage}</span><span>SQUAD KILLS ${m.squadKills}</span>`;
    if (m.win) audio.play('victory', null, { vol: 0.9, important: true });
  }

  // =================================================================== helpers for HUD
  ammoCount(type) { return this.itemCount('a:' + type); }
  itemCount(key) {
    if (!this.inv) return 0;
    let n = 0;
    for (const s of this.inv.inv) if (s.item === key) n += s.n;
    return n;
  }

  activeWeapon() {
    if (!this.inv) return null;
    return this.inv.weapons[this.inv.active] || null;
  }

  // =================================================================== frame
  frame(dt) {
    this.time += dt;
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; this.net.send({ t: 'ping', c: performance.now() }); }
    const inp = this.input;
    const me = this.me;
    const panelOpen = this.invOpen || !!this.boxOpen || this.mapOpen;
    const alive = me && me.alive;

    // ---- mouse look
    const m = inp.consumeMouse();
    const w = this.activeWeapon();
    const def = w ? WEAPONS[w.id] : null;
    const zoom = this._zoom(def, w);
    const sensMul = 1 + (zoom - 1) * this.adsAmt;
    const sens = (settings.sens * 0.022 * DEG) * (this.adsAmt > 0.5 ? settings.adsSens : 1) / sensMul;
    if (!panelOpen) {
      this.yaw = wrapAngle(this.yaw - m.dx * sens);
      this.pitch = clamp(this.pitch - m.dy * sens * (settings.invertY ? -1 : 1), -1.55, 1.55);
    }

    // ---- discrete actions
    if (!this.ended) this._actions(m);

    // ---- fixed-step movement prediction
    this.acc += dt;
    let steps = 0;
    const newCmds = [];
    while (this.acc >= SIM_DT && steps < 8) {
      this.acc -= SIM_DT;
      steps++;
      const c = this._sampleCmd(panelOpen);
      newCmds.push(c);
      if (alive && !me.inShip) {
        copyMoveState(this.pred, this.prev);
        this._mods(c);
        stepMovement(this.pred, c, SIM_DT, this.world);
        this.pending.push(c);
        this._localMoveFx(this.pred);
      }
    }
    if (this.acc > SIM_DT * 4) this.acc = 0;
    if (newCmds.length && alive && !me.inShip) this.net.send({ t: 'in', cmds: newCmds });
    if (this.pending.length > 120) this.pending.splice(0, this.pending.length - 120);

    // ---- weapon logic
    this._weapons(dt, def, w, panelOpen);
    this._updateBullets(dt);

    // ---- remotes
    this._updateRemotes(dt);

    // ---- camera
    this._camera(dt, def, w, zoom);

    // ---- interaction targeting
    this._interact();

    // ---- audio loops
    this._audioLoops(dt);

    // ---- world + fx
    const cp = this.camera.position;
    this.view.update(dt, this.time, cp, this.ring, this.phase === 'ship' ? this.shipNow : null);
    this.fx.update(dt, this.time);
    this.loot.update(dt, this.time, cp.x, cp.z);
    this._updatePings(dt);

    // ---- viewmodel
    const ms = this.spectating ? this.meView.ms : this.pred;
    const specW = this.spectating ? this.meView.wpn : null;
    if (this.spectating) this.vm.setWeapon(specW, 0);
    else this.vm.setWeapon(alive && w && !me.inShip && this.pred.mode !== 'skydive' ? w.id : null, w ? w.tier : 0);
    this.vm.update(dt, {
      ads: this.adsWanted, adsTime: this._adsTime(def, w), sprint: this.sprinting, speed: Math.hypot(ms.vx, ms.vz), onGround: ms.onGround,
      slide: ms.mode === 'slide', mouseDX: m.dx, mouseDY: m.dy, healing: !!(me && me.heal), switching: this.localSwitch > 0,
      downed: me && me.down, aspect: innerWidth / innerHeight, hidden: ms.mode === 'skydive' || (me && me.inShip),
      scoped: zoom >= 3,
    });

    // ---- HUD
    this.viewYaw = this.yaw;
    this.viewPos = this.camera.position;
    this.skydiving = ms.mode === 'skydive';
    this.mapDots = this._mapDots();
    this.hud.update(dt, this);

    // ---- render
    const r = this.renderer;
    r.render(this.scene, this.camera);
    r.autoClear = false;
    r.clearDepth();
    r.render(this.vm.scene, this.vm.camera);
    r.autoClear = true;
    inp.endFrame();
  }

  _zoom(def, w) {
    if (!def) return 1;
    let z = def.adsFov;
    if (w && w.att && w.att.optic) z = Math.max(z, ATTACHMENTS[w.att.optic].zoom);
    return z;
  }

  _adsTime(def, w) {
    if (!def) return 0.2;
    const st = w && w.att ? [1, 0.85, 0.75, 0.65][w.att.stock || 0] : 1;
    return def.adsTime * st;
  }

  _sampleCmd(panelOpen) {
    const inp = this.input;
    let mx = 0, mz = 0, b = 0;
    const me = this.me;
    if (!panelOpen && inp.locked) {
      if (inp.down('forward')) mz += 1;
      if (inp.down('back')) mz -= 1;
      if (inp.down('right')) mx += 1;
      if (inp.down('left')) mx -= 1;
      if (inp.down('jump') || this.latch & BTN.JUMP) b |= BTN.JUMP;
      if (inp.down('crouch') || this.latch & BTN.CROUCH) b |= BTN.CROUCH;
      if (inp.down('sprint') || this.autoSprint) b |= BTN.SPRINT;
      if (inp.down('interact')) b |= BTN.INTERACT;
      if (this.adsWanted) b |= BTN.ADS;
      if (inp.mouse.left) b |= BTN.FIRE;
    }
    // firing cancels sprint
    if (this.time - this.lastFireT < 0.25) b &= ~BTN.SPRINT;
    this.latch = 0;
    this.sprinting = !!(b & BTN.SPRINT) && mz > 0.3 && this.pred.onGround && this.pred.crouch < 0.5 && !(b & BTN.ADS);
    return { seq: ++this.seq, mx, mz, yaw: this.yaw, pitch: this.pitch, buttons: b };
  }

  _localMoveFx(s) {
    const ev = s.events;
    if (ev) {
      if (ev & MEV.JUMP) audio.play('jump', null, { vol: 0.35, var: 0.1 });
      if (ev & MEV.LAND) { audio.play('land', null, { vol: 0.25 + Math.min(0.4, s.lastLandSpeed / 25) }); this.landDip = Math.min(0.12, s.lastLandSpeed * 0.012); }
      if (ev & MEV.HARDLAND) { audio.play('hardland', null, { vol: 0.7 }); this.landDip = 0.22; this.trauma = Math.min(1, this.trauma + 0.25); }
      if (ev & MEV.SLIDE) { audio.play('slidestart', null, { vol: 0.55 }); this.fovKick = 6; }
      if (ev & MEV.WALLJUMP) { audio.play('wallkick', null, { vol: 0.6 }); this.trauma = Math.min(1, this.trauma + 0.1); }
      if (ev & MEV.MANTLE) audio.play('mantle', null, { vol: 0.45 });
      if (ev & MEV.SUPERGLIDE) { audio.play('superglide', null, { vol: 0.8 }); this.fovKick = 10; this.hud.toast('SUPERGLIDE!'); }
      if (ev & MEV.PAD) { audio.play('pad', null, { vol: 0.8 }); this.fovKick = 10; }
    }
    // footsteps
    if (s.onGround && s.mode === 'ground') {
      const sp = Math.hypot(s.vx, s.vz);
      this.stepDist += sp * SIM_DT;
      const stride = sp > 6 ? 2.3 : 1.7;
      if (this.stepDist > stride && sp > 1.2 && s.crouch < 0.5) {
        this.stepDist = 0;
        audio.play(['step', 'step2', 'step3'][Math.floor(Math.random() * 3)], null, { vol: sp > 6 ? 0.28 : 0.16, var: 0.1 });
      }
    }
  }

  _actions(m) {
    const inp = this.input, me = this.me;
    if (!me) return;
    const send = (a, extra = {}) => this.net.send({ t: 'act', a, ...extra });
    if (inp.hit('jump')) this.latch |= BTN.JUMP;
    if (inp.hit('crouch')) this.latch |= BTN.CROUCH;
    if (inp.hit('map')) this.toggleMap();
    if (inp.hit('inventory')) this.toggleInventory();
    if (!me.alive) {
      if (inp.hit('spectate') || inp.mousePressed.left) send('spect');
      return;
    }
    if (me.inShip) {
      if (inp.hit('jump') || inp.hit('interact')) send('jump');
      return;
    }
    if (this.invOpen || this.boxOpen) {
      if (this.boxOpen && (inp.hit('interact'))) this.closeBox();
      return;
    }
    const w = this.activeWeapon();
    if (inp.hit('reload')) this._reload();
    if (inp.hit('slot1')) this._switch(0);
    if (inp.hit('slot2')) this._switch(1);
    if (m.wheel) this._switch(1 - (this.inv ? this.inv.active : 0));
    if (inp.hit('tactical')) send('tac');
    if (inp.hit('ultimate')) send('ult');
    if (inp.hit('grenade')) send('throw');
    if (inp.hit('heal')) send('heal');
    if (inp.hit('shield')) send('heal', { item: this.itemCount('c:battery') && (this.me.sh < (SHIELD_TIERS[this.me.armor] || 0) - 30 || !this.itemCount('c:cell')) ? 'c:battery' : 'c:cell' });
    if (inp.hit('health')) send('heal', { item: this.itemCount('c:medkit') && (this.me.hp < 60 || !this.itemCount('c:syringe')) ? 'c:medkit' : 'c:syringe' });
    if (inp.hit('ping') || inp.mousePressed.middle) this._ping();
    if (inp.hit('interact') && this.prompt && this.prompt.tap) this.prompt.tap();
    // auto reload on empty click
    if (w && this.localMag <= 0 && inp.mousePressed.left && !this.localReload) {
      audio.play('dry', null, { vol: 0.6 });
      this._reload();
    }
  }

  _reload() {
    const w = this.activeWeapon();
    if (!w || this.localReload || !this.me.alive || this.me.down) return;
    const def = WEAPONS[w.id];
    if (this.localMag >= magSize(def, w.att.mag) || this.ammoCount(def.ammo) <= 0) return;
    const stockMul = [1, 0.92, 0.85, 0.78][w.att.stock || 0];
    const dur = (this.localMag === 0 ? def.reloadEmpty : def.reload) * stockMul;
    this.localReload = { t: dur, dur, empty: this.localMag === 0 };
    this.vm.startReload(dur);
    audio.play('mag_out', null, { vol: 0.6, delay: dur * 0.15 });
    audio.play('mag_in', null, { vol: 0.75, delay: dur * 0.6 });
    if (this.localMag === 0) audio.play('charge', null, { vol: 0.7, delay: dur * 0.82 });
    this.net.send({ t: 'act', a: 'reload' });
  }

  _switch(slot) {
    if (!this.inv || !this.inv.weapons[slot] || this.inv.active === slot) return;
    this.net.send({ t: 'act', a: 'slot', s: slot });
    this.inv.active = slot;
    const w = this.inv.weapons[slot];
    this.localSwitch = WEAPONS[w.id].deploy * 0.6;
    this.localMag = this.me.mags[slot];
    this.localReload = null;
    this.vm.cancelReload();
    this.recoilIdx = 0;
    this._invChanged();
  }

  _ping() {
    const d = dirFromAngles(this.yaw, this.pitch);
    const c = this.camera.position;
    let k = 'go';
    // enemy under crosshair?
    for (const r of this.remotes.values()) {
      if (r.meta.squad === this.mySquad || !r.avatar) continue;
      const p = r.avatar.root.position;
      const hit = rayPlayer(c.x, c.y, c.z, d.x, d.y, d.z, p.x, p.y, p.z, 1.8, 0.8, 300);
      if (hit) { this.net.send({ t: 'act', a: 'ping', x: p.x, y: p.y + 2, z: p.z, k: 'enemy' }); return; }
    }
    if (this.prompt && this.prompt.lootId) k = 'loot';
    const hit = this.world.raycast(c.x, c.y, c.z, d.x, d.y, d.z, 600, this.tmpBoxes, false);
    const t = hit ? hit.t : 300;
    this.net.send({ t: 'act', a: 'ping', x: c.x + d.x * t, y: c.y + d.y * t, z: c.z + d.z * t, k });
  }

  pingAt(x, z) {
    this.net.send({ t: 'act', a: 'ping', x, y: this.world.groundAt(x, z), z, k: 'go' });
  }

  toggleInventory() {
    if (this.boxOpen) { this.closeBox(); return; }
    this.invOpen = !this.invOpen;
    document.getElementById('inventory').classList.toggle('hidden', !this.invOpen);
    if (this.invOpen) { this._renderInv(); this.input.unlock(); }
    else this.input.lock();
  }

  _renderInv() {
    this.hud.renderInventory(this, (i) => this.net.send({ t: 'act', a: 'drop', i }), (s) => this.net.send({ t: 'act', a: 'dropw', s }));
  }

  toggleMap() {
    this.mapOpen = !this.mapOpen;
    document.getElementById('bigmap').classList.toggle('hidden', !this.mapOpen);
    if (this.mapOpen) this.input.unlock();
    else this.input.lock();
  }

  // =================================================================== weapons
  _weapons(dt, def, w, panelOpen) {
    const me = this.me;
    const inp = this.input;
    this.fireCd = Math.max(-0.05, this.fireCd - dt);
    this.bloom = Math.max(0, this.bloom - dt * 4);
    if (this.localSwitch > 0) this.localSwitch -= dt;
    if (this.localReload) {
      this.localReload.t -= dt;
      if (this.localReload.t <= -0.15 || (me && me.rl === 0 && this.localReload.t < this.localReload.dur - 0.4 && this.localReload.t < 0)) {
        this.localReload = null;
        if (me) this.localMag = me.mags[me.act];
      }
    }
    // resync mag with the server when idle
    if (me && w && this.time - this.lastFireT > 0.5 && !this.localReload) this.localMag = me.mags[me.act];
    if (this.time - this.lastFireT > fireInterval(def || { rpm: 600 }) + 0.25) this.recoilIdx = 0;
    const canAct = me && me.alive && !me.down && !me.inShip && this.pred.mode !== 'skydive' && !panelOpen && inp.locked;
    this.adsWanted = canAct && !!def && inp.ads() && !(me.heal) && this.pred.mode !== 'mantle';
    const adsT = this._adsTime(def, w);
    this.adsAmt += ((this.adsWanted ? 1 : 0) - this.adsAmt) * Math.min(1, dt / Math.max(0.04, adsT * 0.5));
    this.adsFull = this.adsAmt > 0.85;
    this.scoped = this.adsAmt > 0.9 && def && this._zoom(def, w) >= 3;
    // crosshair spread (pixels)
    if (def) {
      const spread = currentSpread(def, this.pred, this.adsAmt > 0.6, this.bloom);
      const fovRad = this.camera.fov * DEG;
      this.crosshairSpread = (Math.tan((spread * 0.5 * DEG)) / Math.tan(fovRad / 2)) * (innerHeight / 2);
    } else this.crosshairSpread = 6;
    if (!canAct || !def || me.st?.phase > 0) return;
    if (this.localReload || this.localSwitch > 0) return;
    const wantFire = def.mode === 'auto' ? inp.mouse.left : inp.mousePressed.left || (inp.mouse.left && def.mode === 'semi' && this._semiHeld);
    this._semiHeld = false;
    if (!wantFire) return;
    if (this.localMag <= 0) return;
    let shots = 0;
    while (this.fireCd <= 0 && this.localMag > 0 && shots < 3) {
      this._fire(def, w);
      this.fireCd += fireInterval(def);
      shots++;
      if (def.mode !== 'auto') break;
    }
  }

  _fire(def, w) {
    this.localMag--;
    this.lastFireT = this.time;
    const c = this.camera.position;
    const ads = this.adsAmt > 0.6;
    const spread = currentSpread(def, this.pred, ads, this.bloom);
    const dirs = [];
    const id = this.shotSeq++;
    const pellets = def.pellets || 1;
    const rot = Math.random() * Math.PI * 2;
    const hipOffA = Math.random() * Math.PI * 2, hipOffR = Math.sqrt(Math.random()) * spread * 0.5 * DEG;
    for (let i = 0; i < pellets; i++) {
      let dy = 0, dp = 0;
      if (def.pellets) {
        const pp = PELLET_PATTERN[i % PELLET_PATTERN.length];
        const r = def.pelletSpread * 0.5 * DEG * (ads ? 0.8 : 1);
        const px = pp[0] * Math.cos(rot) - pp[1] * Math.sin(rot), py = pp[0] * Math.sin(rot) + pp[1] * Math.cos(rot);
        dy = px * r + Math.cos(hipOffA) * hipOffR; dp = py * r + Math.sin(hipOffA) * hipOffR;
      } else {
        dy = Math.cos(hipOffA) * hipOffR; dp = Math.sin(hipOffA) * hipOffR;
      }
      const d = dirFromAngles(this.yaw + dy, this.pitch + dp);
      dirs.push([+d.x.toFixed(4), +d.y.toFixed(4), +d.z.toFixed(4)]);
      // logic bullet + tracer from muzzle
      const fwd = dirFromAngles(this.yaw, this.pitch);
      const right = { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
      const mOff = ads ? 0.02 : 0.2;
      const mx = c.x + fwd.x * 0.7 + right.x * mOff, my = c.y + fwd.y * 0.7 - (ads ? 0.05 : 0.14), mz = c.z + fwd.z * 0.7 + right.z * mOff;
      const aimPt = { x: c.x + d.x * 60, y: c.y + d.y * 60, z: c.z + d.z * 60 };
      const td = { x: aimPt.x - mx, y: aimPt.y - my, z: aimPt.z - mz };
      const tl = Math.hypot(td.x, td.y, td.z);
      const vis = this.fx.spawnBullet({ x: mx, y: my, z: mz }, { x: td.x / tl, y: td.y / tl, z: td.z / tl }, def.speed, def.drop, '#ffe7a8', def.pellets ? 0.6 : 1);
      vis.silent = true;
      this.bullets.push({ id, k: i, x: c.x, y: c.y, z: c.z, vx: d.x * def.speed, vy: d.y * def.speed, vz: d.z * def.speed, g: 6 * def.drop, life: 2, vis, dist: 0 });
    }
    this.net.send({ t: 'fire', id, slot: this.inv.active, o: [+c.x.toFixed(3), +c.y.toFixed(3), +c.z.toFixed(3)], dirs });
    // recoil (learnable pattern)
    const pat = def.recoil;
    const idx = this.recoilIdx < pat.length ? this.recoilIdx : pat.length - 4 + (this.recoilIdx % 4);
    const [kx, ky] = pat[Math.max(0, Math.min(pat.length - 1, idx))];
    const bm = w.att && w.att.barrel ? ATTACHMENTS.barrel.recoilMul[w.att.barrel] : 1;
    const am = ads ? 1 : 1.15;
    const rr = def.recoilRand;
    this.pitch = clamp(this.pitch + (ky + (Math.random() - 0.5) * rr) * DEG * bm * am, -1.55, 1.55);
    this.yaw -= (kx + (Math.random() - 0.5) * rr) * DEG * bm * am;
    this.recoilIdx++;
    this.bloom = Math.min(3, this.bloom + (def.mode === 'auto' ? 0.22 : 0.5));
    // feel
    audio.gunshot(w.id, null, true);
    const punch = def.sound.punch;
    this.vm.fire(def.pellets || def.cls === 'Sniper' ? 1.8 : def.cls === 'Pistol' && def.damage > 30 ? 1.5 : 1);
    this.trauma = Math.min(1, this.trauma + 0.04 * punch + (def.pellets ? 0.12 : 0) + (def.cls === 'Sniper' ? 0.2 : 0));
    this.fovKick = Math.max(this.fovKick, def.pellets || def.cls === 'Sniper' ? 2.5 : 0.6);
    this.fx.flashLight(c.x + Math.sin(-this.yaw) * 1, c.y, c.z - Math.cos(this.yaw) * 1, 4, 0.05, '#ffbb66');
    if (def.sound.pump) audio.play('pump', null, { vol: 0.7, delay: 0.32 });
    if (def.sound.bolt) audio.play('bolt', null, { vol: 0.7, delay: 0.45 });
    const max = magSize(def, w.att.mag);
    if (this.localMag <= Math.ceil(max * 0.25) && this.localMag > 0) audio.play('low_ammo', null, { vol: 0.5 });
    if (this.localMag === 0) setTimeout(() => this._reload(), 120);
    this.localReload = null;
  }

  _updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      b.vy -= b.g * dt;
      const sx = b.x, sy = b.y, sz = b.z;
      const dx = b.vx * dt, dy = b.vy * dt, dz = b.vz * dt;
      const len = Math.hypot(dx, dy, dz);
      const ux = dx / len, uy = dy / len, uz = dz / len;
      const wh = this.world.raycast(sx, sy, sz, ux, uy, uz, len, this.tmpBoxes);
      let best = wh ? wh.t : len, target = null, part = null;
      for (const r of this.remotes.values()) {
        if (!r.avatar || r.meta.squad === this.mySquad || r.fl & 8 || r.fl & 16) continue;
        const p = r.avatar.root.position;
        if (Math.abs(p.x - sx) > len + 3 || Math.abs(p.z - sz) > len + 3) continue;
        const h = r.fl & 1 ? 0.8 : MOVE.standHeight - (MOVE.standHeight - MOVE.crouchHeight) * r.crouch;
        const hit = rayPlayer(sx, sy, sz, ux, uy, uz, p.x, p.y, p.z, h, 0.45, best);
        if (hit && hit.t < best) { best = hit.t; target = r; part = hit.part; }
      }
      b.dist += best;
      if (target) {
        const hx = sx + ux * best, hy = sy + uy * best, hz = sz + uz * best;
        this.net.send({ t: 'hit', id: b.id, k: b.k, v: target.id, part, x: +hx.toFixed(2), y: +hy.toFixed(2), z: +hz.toFixed(2) });
        const onShield = target.sh > 0 && !(target.fl & 1);
        this.hud.hitmarker(part === 'head' ? 'head' : 'body');
        // one hit sound per shot per target (shotguns would otherwise stack 11 sounds)
        const hk = b.id + ':' + target.id;
        if (this.lastHitKey !== hk || part === 'head') audio.play(part === 'head' ? 'hit_head' : onShield ? 'hit_shield' : 'hit_flesh', null, { vol: 0.85, var: 0.04 });
        this.lastHitKey = hk;
        this.fx.hitBurst(hx, hy, hz, target.armor, onShield, part === 'head');
        this.fx.killBullet(b.vis, hx, hy, hz);
        this.bullets.splice(i, 1);
        continue;
      }
      if (wh || b.life <= 0) {
        if (wh && b.vis) this.fx.impact(sx + ux * best, sy + uy * best, sz + uz * best, wh.nx, wh.ny, wh.nz);
        if (wh && wh.blocker) this.fx.burst(sx + ux * best, sy + uy * best, sz + uz * best, '#3fa9ff', 6, 2, 0.1, 0.3);
        this.bullets.splice(i, 1);
        continue;
      }
      b.x += dx; b.y += dy; b.z += dz;
    }
  }

  // =================================================================== remotes
  _updateRemotes(dt) {
    const rt = this._serverNow() - INTERP_DELAY;
    const cam = this.camera.position;
    for (const r of this.remotes.values()) {
      const buf = r.buf;
      if (!buf.length) continue;
      let a = buf[0], b = buf[0];
      for (let i = buf.length - 1; i >= 0; i--) {
        if (buf[i].t <= rt) { a = buf[i]; b = buf[Math.min(buf.length - 1, i + 1)]; break; }
      }
      const span = b.t - a.t;
      const k = span > 0 ? clamp((rt - a.t) / span, 0, 1) : 1;
      const s = {
        x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k),
        yaw: a.yaw + wrapAngle(b.yaw - a.yaw) * k, pitch: lerp(a.pitch, b.pitch, k),
        fl: b.fl, crouch: lerp(a.crouch, b.crouch, k), weapon: b.weapon, vx: b.vx, vz: b.vz, revealed: b.rev,
      };
      r.fl = b.fl; r.crouch = s.crouch; r.sh = b.sh; r.armor = b.armor;
      const inShip = s.fl & 16;
      const dist = Math.hypot(s.x - cam.x, s.z - cam.z);
      if (!r.avatar && !inShip) r.avatar = new Avatar(this.scene, r.meta, r.meta.squad === this.mySquad);
      if (r.avatar) {
        r.avatar.root.visible = !inShip && dist < 500;
        if (r.avatar.root.visible) r.avatar.update(dt, s, this.time);
        else r.avatar.reveal.visible = false;
      }
      // remote footsteps
      if (!inShip && !(s.fl & 4) && !(s.fl & 2) && dist < 55) {
        const sp = Math.hypot(s.vx, s.vz);
        r.step += sp * dt;
        if (r.step > (sp > 6 ? 2.3 : 1.8) && sp > 2.5 && s.crouch < 0.5) {
          r.step = 0;
          const enemy = r.meta.squad !== this.mySquad;
          audio.play(['step', 'step2', 'step3'][Math.floor(Math.random() * 3)], { x: s.x, y: s.y, z: s.z }, { vol: enemy ? 1.2 : 0.5, var: 0.1, ref: 3, rolloff: 1.4 });
        }
      }
      if (s.fl & 2 && dist < 40) audio.loop('slide' + r.id, 'slide', 0.4, 1, { x: s.x, y: s.y, z: s.z });
      else audio.loop('slide' + r.id, 'slide', 0);
    }
  }

  // =================================================================== camera
  _camera(dt, def, w, zoom) {
    const cam = this.camera;
    const me = this.me;
    let x, y, z, yaw = this.yaw, pitch = this.pitch;
    this.corr.multiplyScalar(Math.exp(-dt * 12));
    const alpha = this.acc / SIM_DT;
    if (this.spectating && this.meView) {
      const ms = this.meView.ms;
      const tgt = this.remotes.get(this.meView.id);
      if (tgt && tgt.avatar) {
        const p = tgt.avatar.root.position;
        x = p.x; y = p.y + eyeHeight(ms); z = p.z;
        tgt.avatar.root.visible = false;
      } else { x = ms.x; y = ms.y + eyeHeight(ms); z = ms.z; }
      yaw = ms.yaw; pitch = ms.pitch;
      this.specYaw = yaw;
    } else if (me && me.inShip && this.shipNow) {
      // orbit camera around the drop ship
      const f = dirFromAngles(this.yaw, this.pitch);
      x = this.shipNow.x - f.x * 70; y = this.shipNow.y + 12 - f.y * 70; z = this.shipNow.z - f.z * 70;
    } else {
      const p = this.pred, q = this.prev;
      x = lerp(q.x, p.x, alpha) + this.corr.x;
      y = lerp(q.y, p.y, alpha) + this.corr.y;
      z = lerp(q.z, p.z, alpha) + this.corr.z;
      const eh = eyeHeight(p);
      y += eh;
    }
    // land dip
    this.landDip *= Math.exp(-dt * 9);
    y -= this.landDip;
    // shake
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const sh = this.trauma * this.trauma;
    const t = this.time * 40;
    const shakeYaw = sh * 0.025 * (Math.sin(t * 1.1) + Math.sin(t * 2.3) * 0.5);
    const shakePitch = sh * 0.025 * (Math.sin(t * 1.7 + 1) + Math.sin(t * 2.9) * 0.5);
    const roll = sh * 0.02 * Math.sin(t * 1.3 + 2);
    cam.position.set(x, y, z);
    // slide tilt
    const ms = this.spectating ? this.meView.ms : this.pred;
    const slideRoll = ms.mode === 'slide' ? 0.045 : 0;
    this.camRoll = lerp(this.camRoll || 0, slideRoll, Math.min(1, dt * 8));
    cam.rotation.set(0, 0, 0);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = yaw + shakeYaw;
    cam.rotation.x = pitch + shakePitch;
    cam.rotation.z = roll + this.camRoll;
    // FOV (Apex-style 4:3 horizontal FOV setting -> vertical)
    const baseV = 2 * Math.atan(Math.tan((settings.fov * DEG) / 2) * 0.75) / DEG;
    const hs = Math.hypot(ms.vx, ms.vz);
    let speedFov = 0;
    if (ms.mode === 'skydive') speedFov = 10;
    else if (this.sprinting || ms.mode === 'slide') speedFov = clamp((hs - 5) * 1.6, 0, 9);
    this.fovKick *= Math.exp(-dt * 5);
    this.speedFov = lerp(this.speedFov || 0, speedFov, Math.min(1, dt * 5));
    let fov = baseV + this.speedFov + this.fovKick;
    const zf = 1 + (zoom - 1) * this.adsAmt;
    fov = 2 * Math.atan(Math.tan((fov * DEG) / 2) / zf) / DEG;
    cam.fov = fov;
    cam.aspect = innerWidth / innerHeight;
    cam.updateProjectionMatrix();
    const f = dirFromAngles(yaw, pitch);
    audio.setListener(x, y, z, f.x, f.y, f.z);
  }

  // =================================================================== interaction
  _interact() {
    this.prompt = null;
    this.promptHtml = '';
    this.progress = null;
    this.centerMsg = '';
    this.loot.highlight = 0;
    const me = this.me;
    if (!me) return;
    if (me.inShip) {
      this.centerMsg = '<span style="color:#ff7a1a">[SPACE]</span> JUMP FROM DROP SHIP';
      return;
    }
    if (!me.alive) {
      if (this.spectating) {
        const el = document.getElementById('spectate');
        el.classList.remove('hidden');
        el.querySelector('.who').textContent = (this._name(this.meView.id) || '').toUpperCase();
      }
      return;
    }
    document.getElementById('spectate').classList.add('hidden');
    if (me.down) {
      this.centerMsg = `<span style="color:#ff3b3b">BLEEDING OUT</span> ${me.bleed}s`;
      return;
    }
    if (me.heal) this.progress = { label: itemName(me.heal.item).toUpperCase(), p: 1 - me.heal.t / me.heal.total };
    if (me.rev) this.progress = { label: 'REVIVING', p: me.rev };
    if (me.bcn) this.progress = { label: 'RESPAWNING SQUADMATES', p: me.bcn };
    if (this.localReload) this.centerMsg = '';
    if (me.rift) this.centerMsg = 'RIFT OPEN — PRESS [Z] TO PLACE EXIT';
    if (this.boxOpen) {
      const e = this.entityList.find((x) => x.id === this.boxOpen.id);
      if (!e || Math.hypot(e.x - this.pred.x, e.z - this.pred.z) > 4) this.closeBox();
    }
    const c = this.camera.position;
    const d = dirFromAngles(this.yaw, this.pitch);
    const px = this.pred.x, py = this.pred.y, pz = this.pred.z;
    const score = (x, y, z) => {
      const vx = x - c.x, vy = y - c.y, vz = z - c.z;
      const l = Math.hypot(vx, vy, vz) || 1;
      return (vx * d.x + vy * d.y + vz * d.z) / l;
    };
    let best = null, bs = 0.55;
    // downed squadmates (hold)
    for (const r of this.remotes.values()) {
      if (r.meta.squad !== this.mySquad || !(r.fl & 1) || !r.avatar) continue;
      const p = r.avatar.root.position;
      if (Math.hypot(p.x - px, p.z - pz) < 2.5) { best = { html: `HOLD <b>[E]</b> REVIVE ${r.meta.name.toUpperCase()}`, hold: true }; bs = 2; }
    }
    if (me.banners) {
      for (const b of this.map.beacons) {
        if (Math.hypot(b.x - px, b.z - pz) < 3.2) { best = { html: `HOLD <b>[E]</b> RESPAWN SQUAD (${me.banners})`, hold: true }; bs = 2; }
      }
    }
    if (bs < 2) {
      for (const it of this.loot.items.values()) {
        const dx = it.x - px, dz = it.z - pz;
        if (dx * dx + dz * dz > 2.8 * 2.8 || Math.abs(it.y - py) > 2.2) continue;
        const s = score(it.x, it.y + 0.3, it.z) + (dx * dx + dz * dz < 1 ? 0.3 : 0);
        if (s > bs) {
          bs = s;
          const col = RARITY[itemRarity(it.item, it.tier)];
          best = { html: `<b>[E]</b> ${itemName(it.item, it.tier)}${it.n > 1 ? ' x' + it.n : ''}`, color: col, lootId: it.id, tap: () => this.net.send({ t: 'act', a: 'pickup', id: it.id }) };
        }
      }
      this.map.bins.forEach((b, i) => {
        if (this.binsOpened[i]) return;
        if (Math.hypot(b.x - px, b.z - pz) > 2.6) return;
        const s = score(b.x, b.y, b.z) + 0.1;
        if (s > bs) { bs = s; best = { html: '<b>[E]</b> OPEN SUPPLY BIN', color: '#3fa9ff', tap: () => this.net.send({ t: 'act', a: 'bin', id: i }) }; }
      });
      for (const e of this.entityList) {
        if (e.k !== 'box' && !(e.k === 'carepkg' && e.landed)) continue;
        if (Math.hypot(e.x - px, e.z - pz) > 2.8) continue;
        const s = score(e.x, e.y + 0.4, e.z) + 0.15;
        if (s > bs) {
          bs = s;
          const label = e.k === 'carepkg' ? 'OPEN CARE PACKAGE' : e.ban && e.sq === this.mySquad ? `COLLECT ${e.name.toUpperCase()}'S BANNER` : `OPEN ${e.name.toUpperCase()}'S BOX`;
          best = { html: `<b>[E]</b> ${label}`, color: '#ffd23f', tap: () => this.net.send({ t: 'act', a: 'box', id: e.id }) };
        }
      }
    }
    if (best) {
      this.prompt = best;
      this.promptHtml = best.html;
      this.promptColor = best.color || '#fff';
      if (best.lootId) this.loot.highlight = best.lootId;
    }
  }

  // =================================================================== audio
  _audioLoops(dt) {
    const me = this.me;
    if (!me) return;
    const ms = this.spectating ? this.meView.ms : this.pred;
    const sp = Math.hypot(ms.vx, ms.vz);
    audio.loop('slide', 'slide', ms.mode === 'slide' ? clamp(sp / 10, 0.15, 0.6) : 0, 0.8 + sp / 20);
    const dive = ms.mode === 'skydive' ? clamp((Math.abs(ms.vy) + sp) / 60, 0.2, 1) : 0;
    audio.loop('skywind', 'skywind', dive * 0.8, 0.8 + dive * 0.5);
    audio.loop('ship', 'ship', me.inShip ? 0.6 : 0);
    audio.loop('jet', 'jet', ms.events & MEV.JET ? 0.35 : 0);
    audio.loop('burn', 'ring_burn', me.out && me.alive ? 0.5 : 0);
    audio.loop('healloop', 'heal_loop', me.heal ? 0.35 : 0);
    audio.loop('wind', 'wind', ms.mode === 'skydive' ? 0.05 : 0.22);
    // ring proximity hum
    if (this.ring && me.alive) {
      const dr = this.ring.r - Math.hypot(ms.x - this.ring.cx, ms.z - this.ring.cz);
      audio.loop('ringnear', 'ring_burn', dr > 0 && dr < 25 ? (1 - dr / 25) * 0.25 : 0, 0.6);
    }
    // echo heartbeat
    if (this.heartbeat > 0 && this.adsAmt > 0.5) {
      this.hbT -= dt;
      if (this.hbT <= 0) { audio.play('heartbeat', null, { vol: 0.6 }); this.hbT = 0.35 + (this.heartbeat / 40) * 0.9; }
    }
  }

  _updatePings(dt) {
    const layer = document.getElementById('dmgnums');
    const v = this.tmpV;
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      p.t -= dt;
      if (!p.el) {
        p.el = document.createElement('div');
        p.el.className = 'dmgnum';
        p.el.style.fontSize = '14px';
        layer.appendChild(p.el);
      }
      if (p.t <= 0) { p.el.remove(); this.pings.splice(i, 1); continue; }
      v.set(p.x, p.y, p.z).project(this.camera);
      if (v.z > 1) { p.el.style.display = 'none'; continue; }
      p.el.style.display = '';
      const dist = Math.round(Math.hypot(p.x - this.camera.position.x, p.z - this.camera.position.z));
      p.el.innerHTML = `<div style="color:${p.color};text-align:center">◆<br>${p.k === 'enemy' ? 'ENEMY' : p.k === 'loot' ? 'LOOT' : p.who} ${dist}m</div>`;
      p.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * innerWidth}px, ${(-v.y * 0.5 + 0.5) * innerHeight}px) translate(-50%,-100%)`;
    }
  }

  _mapDots() {
    const dots = [];
    const me = this.me;
    if (me && me.alive) dots.push({ x: this.pred.x, z: this.pred.z, color: '#ffffff', me: true, yaw: this.yaw });
    for (const r of this.remotes.values()) {
      const last = r.buf[r.buf.length - 1];
      if (!last) continue;
      if (r.meta.squad === this.mySquad) dots.push({ x: last.x, z: last.z, color: LEGENDS[r.meta.legend].color });
      else if (last.rev) dots.push({ x: last.x, z: last.z, color: '#ff2a2a' });
    }
    if (me && me.banners) for (const b of this.map.beacons) dots.push({ x: b.x, z: b.z, color: '#4fb3ff' });
    if (this.spectating && this.meView) dots.push({ x: this.meView.ms.x, z: this.meView.ms.z, color: '#fff', me: true, yaw: this.meView.ms.yaw });
    return dots;
  }

  dispose() {
    for (const r of this.remotes.values()) if (r.avatar) r.avatar.dispose();
    this.fx.clear();
    audio.stopAll();
    this.hud.show(false);
    for (const p of this.pings) if (p.el) p.el.remove();
    for (const id of ['inventory', 'deathbox', 'bigmap', 'spectate', 'endscreen']) document.getElementById(id).classList.add('hidden');
  }
}

export { TEAM_COLORS };
