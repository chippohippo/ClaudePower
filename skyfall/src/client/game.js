// Client game session: fixed-step input sampling, client-side movement prediction with server
// reconciliation, remote entity interpolation, client-side projectile hit detection ("favour the
// shooter", validated by the server), recoil/spread/ADS gunplay, camera feel, audio + VFX events,
// interaction targeting and the HUD bridge.

import * as THREE from 'three';
import { buildMap } from '../shared/map.js';
import { createMoveState, stepMovement, copyMoveState, eyeHeight, playerHeight, MEV } from '../shared/movement.js';
import { SIM_DT, BTN, INTERP_DELAY, SHIELD_COLORS, SHIELD_TIERS, MOVE, TEAM_COLORS } from '../shared/constants.js';
import { WEAPONS, fireInterval, currentSpread, magSize, GUNPLAY } from '../shared/weapons.js';
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
import { FEEL } from './tuning.js';

// shield hits ring lower as the armor tier rises (white → red)
const SHIELD_PITCH = [1, 1.12, 1.0, 0.9, 0.8];
const SURFACE = { container: 'metal', bin: 'metal', beacon: 'metal', floor: 'concrete', roof: 'concrete', stair: 'concrete', wall: 'concrete', rock: 'concrete', crate: 'concrete', tree: 'dirt' };

const speedOf = (s) => Math.hypot(s.vx, s.vz);
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
    this.vm = new ViewModel(this.renderer);
    this.binsOpened = welcome.bins.slice();
    this.binsOpened.forEach((o, i) => o && this.view.setBinOpened(i));

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
    this.remoteBursts = new Map();
    this.lastCombatT = -99;
    this.muffleT = 0;
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
        const dist = Math.hypot(o.x - camP.x, o.y - camP.y, o.z - camP.z);
        const occluded = dist < 140 && this._occluded(o);
        // auto weapons get their tail when the burst ends; single shots carry it immediately
        const auto = w.mode === 'auto';
        audio.gunshot(ev.w, o, false, { occluded, tail: !auto });
        if (auto) this.remoteBursts.set(ev.id, { w: ev.w, x: o.x, y: o.y, z: o.z, t: this.time, occluded });
        const enemy = !this._isMate(ev.id);
        if (enemy && dist > 55 && dist < 650) this.hud.gunfireCue(Math.atan2(-(o.x - camP.x), -(o.z - camP.z)), dist);
        if (enemy) this.lastCombatT = this.time;
        for (const d of ev.d) {
          const b = this.fx.spawnBullet(o, { x: d[0], y: d[1], z: d[2] }, w.speed, w.drop, enemy ? '#ff9c5a' : '#ffe08a', w.pellets ? 0.6 : 1);
          b.silent = dist > 120;
          if (enemy) {
            // near-miss whiz + supersonic crack, delayed by travel time
            const vx = camP.x - o.x, vy = camP.y - o.y, vz = camP.z - o.z;
            const t = vx * d[0] + vy * d[1] + vz * d[2];
            if (t > 3 && t < 300) {
              const cx = o.x + d[0] * t - camP.x, cy = o.y + d[1] * t - camP.y, cz = o.z + d[2] * t - camP.z;
              const miss = Math.hypot(cx, cy, cz);
              if (miss < 3 && Math.random() < (w.pellets ? 0.2 : 1)) {
                audio.play('whiz', { x: camP.x + cx, y: camP.y + cy, z: camP.z + cz }, { vol: 0.9, var: 0.12, delay: t / w.speed, ref: 1 });
                this.punch(0.06, 0);
                this.lastCombatT = this.time;
              }
            }
          }
        }
        this.fx.muzzleFlashWorld(o, ev.d[0], w);
        break;
      }
      case 'hit': {
        const M = FEEL.mix, C = FEEL.camera;
        if (ev.a === this.myId && ev.v !== this.myId) {
          const tier = ev.tier;
          const onShield = ev.sd > 0;
          const head = ev.part === 'head';
          const color = onShield ? SHIELD_COLORS[tier] : head ? '#ffd23f' : '#ffffff';
          this.fx.damageNumber(ev.x, ev.y, ev.z, ev.dmg, color, head, ev.v, onShield && !ev.brk);
          this.lastCombatT = this.time;
          if (ev.src) { // explosive/ability damage: no client-side marker was shown yet
            this.hud.hitmarker('body');
            audio.play(onShield ? 'hit_shield' : 'hit_flesh', null, { vol: M.hit * 0.85, rate: SHIELD_PITCH[tier] || 1 });
          }
          // armor crack: a 25-point shield segment just shattered (but not the whole shield)
          const before = (ev.rs ?? 0) + ev.sd;
          if (onShield && !ev.brk && Math.ceil(before / 25) > Math.ceil((ev.rs ?? 0) / 25)) {
            audio.play('shield_crack', null, { vol: M.shieldCrack, rate: SHIELD_PITCH[tier] || 1, var: 0.05 });
          }
          if (ev.brk) {
            audio.play('shield_break', null, { vol: M.shieldBreak, important: true, rate: SHIELD_PITCH[tier] || 1 });
            this.fx.shieldBreak(ev.x, ev.y, ev.z, tier);
            this.hud.edgeFlash(SHIELD_COLORS[tier], FEEL.hit.shieldBreakFlash);
            this.hud.hitmarker('break');
            this.punch(C.shieldBreakTrauma, C.shieldBreakFov);
          } else this.punch(C.hitDealtTrauma, 0);
          if (ev.knock) {
            audio.play('knock', null, { vol: M.knock, important: true });
            this.hud.hitmarker('kill');
            this.hud.edgeFlash('#ff7a1a', 0.45);
            this.punch(C.killTrauma * 0.7, C.killFov * 0.7);
          }
        }
        const viewing = this.spectating ? this.meView.id : this.myId;
        if (ev.v === viewing) {
          if (ev.a) {
            const ang = Math.atan2(-(ev.ax - this.pred.x), -(ev.az - this.pred.z));
            this.hud.damageFrom(ang, ev.sd > 0 ? SHIELD_COLORS[ev.tier] : '#ff2a2a');
          }
          this.lastCombatT = this.time;
          this.punch(Math.min(C.hitTakenMax, ev.dmg * C.hitTakenTrauma), C.hitTakenFovPunch * Math.min(1, ev.dmg / 25));
          this.hud.edgeFlash(ev.sd > 0 ? SHIELD_COLORS[ev.tier] : '#ff1a1a', FEEL.hit.edgeFlashTaken * Math.min(1, 0.4 + ev.dmg / 40));
          audio.play(ev.sd > 0 ? 'hit_shield' : 'hit_flesh', null, { vol: 0.75, rate: 0.6, var: 0.05 });
          if (ev.brk) { audio.play('shield_break', null, { vol: 0.75, rate: 0.75 }); this.hud.toast('YOUR SHIELD IS BROKEN'); }
        }
        if (ev.v !== this.myId && ev.a !== this.myId) {
          this.fx.hitBurst(ev.x, ev.y, ev.z, ev.tier, ev.sd > 0, ev.part === 'head');
        }
        break;
      }
      case 'knock': {
        const mine = ev.a === this.myId;
        this.hud.killfeed(ev, 'knock', this);
        if (mine) this.hud.toast(`KNOCKED DOWN ${this._name(ev.v)}`);
        if (ev.v === this.myId) { this.hud.announce('YOU ARE DOWN — CRAWL TO YOUR SQUAD', 3); audio.play('knock', null, { rate: 0.7 }); this.punch(0.6, 6); }
        const r = this.remotes.get(ev.v);
        if (r && r.avatar) r.avatar.knockT = 0;
        break;
      }
      case 'kill': {
        const mine = ev.a === this.myId;
        this.hud.killfeed(ev, 'kill', this);
        if (mine) {
          audio.play('kill', null, { vol: FEEL.mix.kill, important: true });
          this.hud.hitmarker('kill');
          this.hud.killConfirm(this._name(ev.v));
          this.hud.edgeFlash('#ff2a2a', FEEL.hit.killFlash);
          this.punch(FEEL.camera.killTrauma, FEEL.camera.killFov);
        }
        const r = this.remotes.get(ev.v);
        if (r && r.avatar) this.fx.ragdoll(r.avatar, ev);
        if (pos) this.fx.deathBurst(pos.x, pos.y + 1, pos.z, mine);
        break;
      }
      case 'impact': {
        const d = Math.hypot(ev.x - camP.x, ev.z - camP.z);
        this.fx.impact(ev.x, ev.y, ev.z, ev.n[0], ev.n[1], ev.n[2]);
        if (d < 30) {
          const metal = this.surfaceAt(ev.x - ev.n[0] * 0.05, ev.y - ev.n[1] * 0.05, ev.z - ev.n[2] * 0.05) === 'metal';
          audio.play(metal ? 'impact_metal' : Math.random() < 0.18 ? 'ricochet' : 'impact', ev, { vol: 0.55, var: 0.15 });
        }
        break;
      }
      case 'boom': {
        const d = Math.hypot(ev.x - camP.x, ev.y - camP.y, ev.z - camP.z);
        this.fx.explosion(ev.x, ev.y, ev.z, ev.r || 4);
        if (ev.k === 'land') this.fx.ring(ev.x, ev.y, ev.z, '#ffd23f', 6);
        if (d < 140) audio.play('boom', ev, { vol: ev.k === 'land' ? 0.6 : 1, var: 0.08, ref: 10, rolloff: 0.8, delay: d / 343, important: true, reverb: 0.3, occluded: this._occluded(ev) });
        else audio.play('boom_far', ev, { vol: 1, ref: 60, rolloff: 0.5, delay: Math.min(2, d / 343) });
        const C = FEEL.camera;
        const k = Math.max(0, 1 - d / C.explosionRadius);
        if (k > 0) this.punch(k * C.explosionTrauma, k * 6);
        if (d < 7 && ev.k !== 'land') { audio.play('tinnitus', null, { vol: 0.5 }); this.muffleT = 1.6; }
        if (d < 300) this.lastCombatT = this.time;
        break;
      }
      case 'abil': this._abilEvent(ev, pos); break;
      case 'shell': this.fx.incomingShell(ev.x, ev.y, ev.z, ev.tt); break;
      case 'mv': {
        if (ev.id === this.myId) break;
        const f = ev.f;
        if (f & MEV.SLIDE) audio.play('slidestart', pos, { vol: 0.8 });
        if (f & MEV.JUMP) audio.play('jump', pos, { vol: 0.6 });
        if (f & (MEV.WALLJUMP)) audio.play('wallkick', pos, { vol: 0.8 });
        if (f & MEV.MANTLE) audio.play('mantle', pos, { vol: 0.7 });
        if (f & MEV.SUPERGLIDE) audio.play('superglide', pos, { vol: 0.8 });
        if (f & MEV.PAD) { audio.play('pad', pos, { vol: 1 }); this.fx.padBurst(pos.x, pos.y, pos.z); }
        if (f & MEV.ZIP) audio.play('zip_attach', pos, { vol: 0.8 });
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
      case 'banner': if (ev.sq === this.mySquad) audio.play('banner', null, { vol: 0.6 }); break;
      case 'squadout':
        if (ev.sq !== this.mySquad) this.hud.toast(`SQUAD ELIMINATED · ${ev.place - 1} SQUADS REMAIN`);
        break;
      case 'loot+': this.loot.add(ev.items); break;
      case 'loot-': this.loot.remove(ev.ids); break;
      case 'bin':
        this.binsOpened[ev.i] = 1;
        this.view.setBinOpened(ev.i);
        audio.play('bin_open', pos, { vol: 0.8, ref: 5 });
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
    const ra = !self && this.remotes.get(ev.id);
    if (ra && ra.avatar && ev.k !== 'portal') ra.avatar.cast();
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
    this.hud.roster(m.squad);
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
    this.hud.roster(m.squad);
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
    this.view.setBeaconHighlight(!!(me && me.banners), this.time);
    this.view.setAtmosphere(this.ring ? Math.max(0, this.ring.idx) / 6 : 0, !!(me && me.alive && me.out), dt);
    this.fx.update(dt, this.time);
    this.loot.update(dt, this.time, cp.x, cp.z);
    this._updatePings(dt);

    // ---- viewmodel
    const ms = this.spectating ? this.meView.ms : this.pred;
    const specW = this.spectating ? this.meView.wpn : null;
    if (this.spectating) this.vm.setWeapon(specW, 0);
    else this.vm.setWeapon(alive && w && !me.inShip && this.pred.mode !== 'skydive' && this.pred.mode !== 'zip' ? w.id : null, w ? w.tier : 0, w ? w.att : null);
    this.vm.update(dt, {
      ads: this.adsWanted, adsTime: this._adsTime(def, w), sprint: this.sprinting, speed: Math.hypot(ms.vx, ms.vz), onGround: ms.onGround,
      slide: ms.mode === 'slide', mouseDX: m.dx, mouseDY: m.dy, healing: !!(me && me.heal), switching: this.localSwitch > 0,
      downed: me && me.down, aspect: innerWidth / innerHeight, hidden: ms.mode === 'skydive' || (me && me.inShip),
      scoped: zoom >= 3,
      vSide: ms.vx * Math.cos(ms.yaw) - ms.vz * Math.sin(ms.yaw), vy: ms.onGround ? 0 : ms.vy,
      landImpulse: this.vmLand || 0,
    });
    this.vmLand = 0;

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
    const C = FEEL.camera;
    if (ev) {
      const surf = this.surfaceAt(s.x, s.y, s.z);
      if (ev & MEV.JUMP) audio.play('jump', null, { vol: 0.35, var: 0.1 });
      if (ev & MEV.LAND && !(ev & MEV.HARDLAND)) {
        audio.play('land', null, { vol: 0.25 + Math.min(0.4, s.lastLandSpeed / 25) });
        audio.play(`step_${surf}${(Math.random() * 3) | 0}`, null, { vol: 0.35, rate: 0.85 });
        this.landDip = Math.min(0.12, s.lastLandSpeed * 0.012);
        this.vmLand = s.lastLandSpeed;
      }
      if (ev & MEV.HARDLAND) { audio.play('hardland', null, { vol: 0.75 }); this.landDip = 0.24; this.punch(C.landTrauma, 2); this.fx.dust(s.x, s.y, s.z, 1.4); }
      if (ev & MEV.SLIDE) { audio.play('slidestart', null, { vol: 0.6 }); this.fovKick = Math.max(this.fovKick, C.slideFov); this.fx.dust(s.x, s.y, s.z, 0.6); }
      if (ev & MEV.WALLJUMP) { audio.play('wallkick', null, { vol: 0.7 }); this.punch(0.14, 3); this.fx.dust(s.x - s.wallNx * 0.4, s.y + 1, s.z - s.wallNz * 0.4, 0.5); }
      if (ev & MEV.MANTLE) audio.play('mantle', null, { vol: 0.5, var: 0.06 });
      if (ev & MEV.SUPERGLIDE) { audio.play('superglide', null, { vol: 0.85 }); this.fovKick = C.superglideFov; this.hud.toast('SUPERGLIDE!'); }
      if (ev & MEV.PAD) { audio.play('pad', null, { vol: 0.85 }); this.fovKick = 10; this.punch(0.2, 0); this.fx.padBurst(s.x, s.y, s.z); }
      if (ev & MEV.ZIP) audio.play('zip_attach', null, { vol: 0.7 });
    }
    // surface-aware footsteps
    if (s.onGround && s.mode === 'ground') {
      const sp = Math.hypot(s.vx, s.vz);
      this.stepDist += sp * SIM_DT;
      const stride = sp > 6 ? 2.3 : 1.7;
      if (this.stepDist > stride && sp > 1.2 && s.crouch < 0.5) {
        this.stepDist = 0;
        const surf = this.surfaceAt(s.x, s.y, s.z);
        audio.play(`step_${surf}${(Math.random() * 3) | 0}`, null, { vol: FEEL.mix.footstepSelf * (sp > 6 ? 1.3 : 0.75), var: 0.08 });
      }
    }
  }

  // What the player is standing on (drives footsteps, slide scrape and impact sounds).
  surfaceAt(x, y, z) {
    const b = this.world.boxAt ? this.world.boxAt(x, y, z, this.tmpBoxes) : null;
    if (b) return SURFACE[b.kind] || 'concrete';
    for (const p of this.map.pois) if ((p.x - x) ** 2 + (p.z - z) ** 2 < (p.r * 0.95) ** 2) return 'concrete';
    return 'dirt';
  }

  // Is there solid geometry between the listener and a sound source?
  _occluded(p) {
    const c = this.camera.position;
    const dx = p.x - c.x, dy = (p.y ?? 0) + 1 - c.y, dz = p.z - c.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 2) return false;
    return !!this.world.raycast(c.x, c.y, c.z, dx / d, dy / d, dz / d, d - 1, this.tmpBoxes, false);
  }

  // Camera trauma + FOV punch, scaled by the player's shake setting.
  punch(trauma, fov) {
    const k = settings.shake ?? 1;
    this.trauma = Math.min(1, this.trauma + trauma * k);
    if (fov) this.fovKick = Math.max(this.fovKick, fov * Math.min(1, k));
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
    this.bloom = Math.max(0, this.bloom - dt * GUNPLAY.bloomDecay);
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
    this.bloom = Math.min(GUNPLAY.bloomMax, this.bloom + (def.mode === 'auto' ? GUNPLAY.bloomPerShotAuto : GUNPLAY.bloomPerShotSemi));
    // feel: per-class shake, FOV punch and viewmodel kick (all in tuning.js)
    const cls = def.sound.cls;
    const C = FEEL.camera;
    const auto = def.mode === 'auto';
    audio.gunshot(w.id, null, true, { tail: !auto });
    this.burstWeapon = auto ? w.id : null;
    this.vm.fire(C.fireKick[cls] || 1);
    this.punch(C.fireTrauma[cls] || 0.05, (C.fireFovPunch[cls] || 0.6) * (ads ? 0.6 : 1));
    this.fx.flashLight(c.x + Math.sin(-this.yaw) * 1, c.y, c.z - Math.cos(this.yaw) * 1, 5, 0.05, def.sound.zap ? '#b7ff6a' : '#ffbb66');
    this.lastCombatT = this.time;
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
        r.avatar.root.visible = !inShip && dist < 500 && !r.avatar.dead;
        if (r.avatar.root.visible) r.avatar.update(dt, s, this.time);
        else r.avatar.reveal.visible = false;
      }
      // ability trails: jetpack flame, stim afterburn
      if (r.avatar && r.avatar.root.visible && dist < 150) {
        if (s.fl & 2048) this.fx.jetTrail(s.x, s.y + 0.9, s.z, s.yaw);
        if (s.fl & 256 && speedOf(s) > 4) this.fx.stimTrail(s.x, s.y + 1, s.z);
      }
      // remote footsteps
      if (!inShip && !(s.fl & 4) && !(s.fl & 2) && dist < 55) {
        const sp = Math.hypot(s.vx, s.vz);
        r.step += sp * dt;
        if (r.step > (sp > 6 ? 2.3 : 1.8) && sp > 2.5 && s.crouch < 0.5) {
          r.step = 0;
          const enemy = r.meta.squad !== this.mySquad;
          const sp3 = { x: s.x, y: s.y, z: s.z };
          const surf = this.surfaceAt(s.x, s.y, s.z);
          audio.play(`step_${surf}${(Math.random() * 3) | 0}`, sp3, { vol: (enemy ? FEEL.mix.footstepEnemy : FEEL.mix.footstepMate) * (sp > 6 ? 1.15 : 0.8), var: 0.08, ref: 3, rolloff: 1.3, occluded: enemy && this._occluded(sp3) });
        }
      }
      if (s.fl & 2 && dist < 40) audio.loop('rslide' + r.id, 'slide_' + this.surfaceAt(s.x, s.y, s.z), 0.45, 1, { x: s.x, y: s.y, z: s.z });
      else audio.loop('rslide' + r.id, null, 0);
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
    const CF = FEEL.camera;
    this.trauma = Math.max(0, this.trauma - dt * CF.traumaDecay);
    const sh = this.trauma * this.trauma;
    const t = this.time * CF.shakeFreq;
    // layered sines ≈ smooth noise; squared trauma keeps small hits subtle and big ones violent
    const shakeYaw = sh * CF.shakeAngle * (Math.sin(t * 1.1) + Math.sin(t * 2.3 + 0.7) * 0.5 + Math.sin(t * 4.7) * 0.25);
    const shakePitch = sh * CF.shakeAngle * (Math.sin(t * 1.7 + 1) + Math.sin(t * 2.9) * 0.5 + Math.sin(t * 5.3 + 2) * 0.25);
    const roll = sh * CF.shakeRoll * Math.sin(t * 1.3 + 2);
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
        this.hud.spectator(this);
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
    // ziplines: prompt when a cable is within reach
    if (this.pred.mode === 'zip') best = { html: '<b>[SPACE]</b> ZIP JUMP · <b>[C]</b> DROP' };
    else if (bs < 2 && this.world.zips.length) {
      const cx = px, cy = py + 1.2, cz = pz;
      for (const z of this.world.zips) {
        const dx = z.bx - z.ax, dy = z.by - z.ay, dz = z.bz - z.az, L2 = dx * dx + dy * dy + dz * dz;
        const t = Math.max(0.02, Math.min(0.98, ((cx - z.ax) * dx + (cy - z.ay) * dy + (cz - z.az) * dz) / L2));
        if (Math.hypot(z.ax + dx * t - cx, z.ay + dy * t - 1 - cy, z.az + dz * t - cz) < 1.8) { best = { html: '<b>[E]</b> ZIPLINE', color: '#ffb347' }; break; }
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
    const M = FEEL.mix;
    const ms = this.spectating ? this.meView.ms : this.pred;
    const sp = Math.hypot(ms.vx, ms.vz);
    // slide scrape on the surface we're on (swap buffer when the surface changes)
    const slideSurf = ms.mode === 'slide' ? this.surfaceAt(ms.x, ms.y, ms.z) : this.slideSurf;
    if (slideSurf !== this.slideSurf && this.slideSurf) audio.loop('slide', null, 0);
    this.slideSurf = slideSurf;
    if (slideSurf) audio.loop('slide', 'slide_' + slideSurf, ms.mode === 'slide' ? clamp(sp / 10, 0.15, 0.65) : 0, 0.8 + sp / 25);
    const dive = ms.mode === 'skydive' ? clamp((Math.abs(ms.vy) + sp) / 60, 0.2, 1) : 0;
    audio.loop('skywind', 'skywind', dive * 0.8, 0.8 + dive * 0.5);
    audio.loop('ship', 'ship', me.inShip ? 0.6 : 0);
    audio.loop('jet', 'jet', ms.events & MEV.JET ? 0.4 : 0);
    audio.loop('zip', 'zipline', ms.mode === 'zip' ? 0.45 : 0, 0.9 + sp / 30);
    audio.loop('burn', 'ring_burn', me.out && me.alive ? 0.55 : 0);
    audio.loop('healloop', 'heal_loop', me.heal ? 0.35 : 0);
    audio.loop('wind', 'wind', ms.mode === 'skydive' ? 0.05 : M.ambience);

    // ring wall: positional hum at the closest point of the wall
    if (this.ring && this.ring.r < 3000) {
      const R = this.ring, c = this.camera.position;
      const dx = c.x - R.cx, dz = c.z - R.cz, dc = Math.hypot(dx, dz) || 1;
      const wallDist = Math.abs(dc - R.r);
      const wp = { x: R.cx + (dx / dc) * R.r, y: c.y, z: R.cz + (dz / dc) * R.r };
      audio.loop('ringwall', 'ring_wall', wallDist < 180 ? (1 - wallDist / 180) * 0.6 : 0, 1, wp);
    }

    // tension bed: rises with ring stage, lobby size and recent combat
    const R = this.ring;
    const stage = R ? Math.max(0, R.idx) / 6 : 0;
    const late = 1 - this.aliveCount / 100;
    const combat = clamp(1 - (this.time - (this.lastCombatT ?? -99)) / 8, 0, 1);
    const closing = R && R.st === 'close' ? 0.25 : 0;
    const tension = clamp(stage * 0.4 + late * 0.35 + closing + combat * 0.35, 0, 1);
    const alive = me.alive && !me.inShip;
    audio.loop('tension_low', 'tension_low', alive ? M.tension * (0.25 + tension * 0.75) : 0);
    audio.loop('tension_high', 'tension_high', alive ? M.tension * 0.8 * Math.max(0, tension - 0.45) * 1.8 * (0.4 + combat * 0.6) : 0);

    // master muffle: knocked / low health / phased / explosion tinnitus
    this.muffleT = Math.max(0, (this.muffleT || 0) - dt);
    let mf = 20000;
    if (me.down) mf = M.downedLowpass;
    else if (me.alive && me.hp < 30) mf = M.lowHpLowpass;
    if (me.st && me.st.phase > 0) mf = Math.min(mf, 2200);
    if (this.muffleT > 0) mf = Math.min(mf, 700 + (1.6 - this.muffleT) * 6000);
    audio.setMuffle(mf);

    // burst tails: when an automatic weapon stops firing, play its reverb tail
    if (this.burstWeapon) {
      const def = WEAPONS[this.burstWeapon];
      if (this.time - this.lastFireT > fireInterval(def) * 1.7) {
        audio.play('guntail_' + this.burstWeapon, null, { vol: M.gunTailLocal, var: 0.03, reverb: 0.3 });
        this.burstWeapon = null;
      }
    }
    for (const [id, b] of this.remoteBursts) {
      if (this.time - b.t > 0.18) {
        const d = Math.hypot(b.x - this.camera.position.x, b.z - this.camera.position.z);
        if (d < 70) audio.play('guntail_' + b.w, b, { vol: 0.5, ref: 10, rolloff: 0.7, occluded: b.occluded, delay: d / 343 });
        this.remoteBursts.delete(id);
      }
    }

    // ability entities: travel, linger and warning loops
    const keep = new Set();
    const c = this.camera.position;
    const E = (id, name, vol, pos, rate = 1) => {
      if ((pos.x - c.x) ** 2 + (pos.z - c.z) ** 2 > 120 * 120) return;
      keep.add(id);
      audio.loop(id, name, vol * M.ability, rate, pos);
    };
    for (const e of this.entityList) {
      const p = { x: e.x, y: e.y + 1, z: e.z };
      switch (e.k) {
        case 'dome': E('ent' + e.id, 'dome_hum', 0.5, p); break;
        case 'gas': E('ent' + e.id, 'gas_loop', 0.55, p); break;
        case 'smoke': E('ent' + e.id, 'smoke_loop', 0.35, p); break;
        case 'drone': E('ent' + e.id, 'drone_hum', 0.35, p); break;
        case 'jumppad': E('ent' + e.id, 'pad_hum', 0.3, p); break;
        case 'exhibit': E('ent' + e.id, 'exhibit_drone', 0.25, p); break;
        case 'portal':
          E('ent' + e.id, 'portal_hum', 0.5, p);
          if (e.open) E('ent' + e.id + 'b', 'portal_hum', 0.5, { x: e.x2, y: e.y2 + 1, z: e.z2 });
          break;
        case 'mortar': case 'thunder': E('ent' + e.id, 'incoming', 0.6, { x: e.x, y: e.y + 30, z: e.z }); break;
        case 'proj':
          if (e.pk === 'missile') E('ent' + e.id, 'missile_loop', 0.5, p, 1.2);
          else if (e.pk === 'arc') E('ent' + e.id, 'arc_hum', 0.4, p);
          else if (e.pk === 'frag') {
            this.nadeTicks = this.nadeTicks || new Map();
            const last = this.nadeTicks.get(e.id) || 0;
            if (this.time - last > 0.45) { this.nadeTicks.set(e.id, this.time); audio.play('nade_tick', p, { vol: 0.8, ref: 3 }); }
          }
          break;
      }
    }
    audio.sweepLoops('ent', keep);

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
