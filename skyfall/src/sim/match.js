// Authoritative match simulation. Environment-agnostic: runs on the Node server for online play
// and inside a Web Worker for offline practice. Communicates only through `send(playerId, msg)`.

import { buildMap } from '../shared/map.js';
import { createMoveState, stepMovement, playerHeight, eyeHeight, MEV } from '../shared/movement.js';
import {
  SIM_DT, SNAPSHOT_RATE, MODES, MAX_PLAYERS, SHIELD_TIERS, EVO_THRESHOLDS, BLEEDOUT_TIME, DOWNED_HP,
  REVIVE_TIME, BANNER_TIME, BTN, MAP_HALF,
} from '../shared/constants.js';
import { WEAPONS, falloff, fireInterval, magSize, currentSpread } from '../shared/weapons.js';
import { CONSUMABLES, GRENADES, HELMET_HEAD_REDUCTION, rollLoot } from '../shared/items.js';
import { LEGENDS, LEGEND_IDS } from '../shared/legends.js';
import { makeRng, dirFromAngles, clamp } from '../shared/util.js';
import { rayPlayer } from '../shared/physics.js';
import { speedMul } from '../shared/mods.js';
import { makeWeapon, pickup, countItem, takeItem, addStack, reloadAmount } from './inventory.js';
import { useTactical, useUltimate, updateEntity, passiveTick } from './abilities.js';
import { Bot, BOT_NAMES } from './bot.js';

export const RING_PHASES = [
  { wait: 60, close: 45, radius: 560, dmg: 2 },
  { wait: 45, close: 40, radius: 340, dmg: 3 },
  { wait: 35, close: 35, radius: 200, dmg: 5 },
  { wait: 30, close: 30, radius: 110, dmg: 8 },
  { wait: 25, close: 25, radius: 55, dmg: 12 },
  { wait: 20, close: 25, radius: 20, dmg: 16 },
  { wait: 15, close: 35, radius: 0, dmg: 25 },
];

const SHIP_ALT = 300;
const SHIP_SPEED = 62;
const HIST = 40;
const CELL = 32;

export class Match {
  constructor({ seed = (Math.random() * 1e9) | 0, mode = 'trios', send = () => {}, log = () => {}, practice = false } = {}) {
    this.seed = seed;
    this.practice = practice;
    this.mode = mode;
    this.squadSize = MODES[mode].squadSize;
    this.send = send;
    this.log = log;
    this.rng = makeRng(seed ^ 0x5eed);
    this.map = buildMap(seed);
    this.world = this.map.world;
    this.time = 0;
    this.players = new Map();
    this.list = [];
    this.squads = [];
    this.entities = new Map();
    this.loot = new Map();
    this.projectiles = [];
    this.events = [];
    this.nextEnt = 1000;
    this.nextLoot = 1;
    this.snapAcc = 0;
    this.phase = 'lobby';
    this.over = false;
    this.binsOpened = new Uint8Array(this.map.bins.length);
    this.lootGrid = new Map();
    this.grid = new Map();
    this.smokes = [];
    this.tmp = [];
    this._spawnLoot();
    // drop ship path
    const a = this.rng() * Math.PI * 2;
    const off = this.rng.range(-200, 200);
    const nx = Math.cos(a + Math.PI / 2) * off, nz = Math.sin(a + Math.PI / 2) * off;
    const L = MAP_HALF * 1.15;
    this.ship = {
      ax: nx - Math.cos(a) * L, az: nz - Math.sin(a) * L,
      bx: nx + Math.cos(a) * L, bz: nz + Math.sin(a) * L,
      t: 0, dur: (2 * L) / SHIP_SPEED, x: 0, z: 0, y: SHIP_ALT, dirx: Math.cos(a), dirz: Math.sin(a),
    };
    this.ship.x = this.ship.ax; this.ship.z = this.ship.az;
    this.ring = { cx: 0, cz: 0, r: MAP_HALF * 1.5, fromX: 0, fromZ: 0, fromR: MAP_HALF * 1.5, nx: 0, nz: 0, nr: 0, idx: -1, state: 'wait', t: 0, dmg: 1 };
    this._nextRing();
  }

  // ---------------------------------------------------------------- setup
  _spawnLoot() {
    const r = makeRng(this.seed ^ 0x10075);
    for (const lp of this.map.lootPoints) {
      const l = rollLoot(r, lp.tier);
      this._addLoot(l, lp.x, lp.y, lp.z, false);
    }
  }

  _addLoot(l, x, y, z, announce = true) {
    const id = this.nextLoot++;
    const wi = { id, item: l.item, n: l.n, tier: l.tier || 0, x, y, z };
    if (l.mag !== undefined) wi.mag = l.mag;
    if (l.att) wi.att = l.att;
    if (l.charge !== undefined) wi.charge = l.charge;
    if (l.evo !== undefined) wi.evo = l.evo;
    this.loot.set(id, wi);
    const gk = lootKey(x, z);
    let cell = this.lootGrid.get(gk);
    if (!cell) this.lootGrid.set(gk, (cell = new Set()));
    cell.add(wi);
    if (announce) this.events.push({ e: 'loot+', items: [wi], g: 1 });
    return wi;
  }

  _removeLoot(id) {
    const wi = this.loot.get(id);
    if (!wi) return;
    this.loot.delete(id);
    this.lootGrid.get(lootKey(wi.x, wi.z))?.delete(wi);
    this.events.push({ e: 'loot-', ids: [id], g: 1 });
  }

  lootNear(x, z, r, out = []) {
    out.length = 0;
    const c0x = Math.floor((x - r + 800) / 16), c1x = Math.floor((x + r + 800) / 16);
    const c0z = Math.floor((z - r + 800) / 16), c1z = Math.floor((z + r + 800) / 16);
    for (let cx = c0x; cx <= c1x; cx++)
      for (let cz = c0z; cz <= c1z; cz++) {
        const cell = this.lootGrid.get(cx * 1000 + cz);
        if (cell) for (const wi of cell) out.push(wi);
      }
    return out;
  }

  // parties: [{ members: [{id, name, legend, human:true}] }]
  setupSquads(parties) {
    const used = new Set();
    let pid = 1;
    const addPlayer = (sq, m, isBot) => {
      const p = this._makePlayer(pid++, m.name, m.legend, sq.idx, isBot);
      if (!isBot) p.clientId = m.id;
      sq.members.push(p.id);
      return p;
    };
    // exactly 100 players: trios = 32 squads of 3 + 2 of 2; sixes = 15 squads of 6 + 2 of 5
    const squadCount = this.practice ? 4 : Math.ceil(MAX_PLAYERS / this.squadSize);
    const fullSquads = MAX_PLAYERS - squadCount * (this.squadSize - 1);
    for (let i = 0; i < squadCount; i++) {
      const cap = this.practice || i < fullSquads ? this.squadSize : this.squadSize - 1;
      const sq = { idx: i, members: [], alive: true, placement: 0, kills: 0 };
      this.squads.push(sq);
      const party = parties[i];
      const taken = new Set();
      if (party) {
        for (const m of party.members.slice(0, cap)) {
          // unique legend within a squad
          let lg = m.legend && LEGENDS[m.legend] && !taken.has(m.legend) ? m.legend : LEGEND_IDS.find((l) => !taken.has(l));
          taken.add(lg);
          addPlayer(sq, { ...m, legend: lg }, false);
        }
      }
      while (sq.members.length < cap) {
        const free = LEGEND_IDS.filter((l) => !taken.has(l));
        const lg = free.length ? free[Math.floor(this.rng() * free.length)] : LEGEND_IDS[Math.floor(this.rng() * LEGEND_IDS.length)];
        taken.add(lg);
        let name;
        do name = BOT_NAMES[Math.floor(this.rng() * BOT_NAMES.length)] + (this.rng() < 0.4 ? Math.floor(this.rng() * 99) : '');
        while (used.has(name));
        used.add(name);
        addPlayer(sq, { name, legend: lg }, true);
      }
    }
    return this.list.filter((p) => !p.isBot).map((p) => ({ clientId: p.clientId, id: p.id }));
  }

  _makePlayer(id, name, legend, squad, isBot) {
    const ms = createMoveState(this.ship.x, SHIP_ALT, this.ship.z);
    ms.jetpack = legend === 'spectre' ? 1 : 0;
    const p = {
      id, name, legend, squad, isBot, ms,
      hp: 100, shield: 0, armor: 0, evoDmg: 0, helmet: 0, pack: 0,
      weapons: [null, null], active: 0, inv: [],
      inShip: true, alive: true, downed: false, bleed: 0, eliminated: false,
      tacCd: 0, ultCd: LEGENDS[legend].ultimate.cd * 0.5,
      status: {}, healing: null, reloading: null, switchT: 0, fireT: 0,
      lastHurt: -99, lastFire: -99, kills: 0, assists: 0, damage: 0, knocks: 0,
      cmds: [], ack: 0, hist: [], shots: new Map(),
      reviveT: 0, reviveTarget: 0, revivedBy: 0, banners: [], beaconT: 0,
      spect: 0, killer: 0, abil: {}, bot: null, interactHeld: false,
    };
    if (isBot) p.bot = new Bot(this, p);
    this.players.set(id, p);
    this.list.push(p);
    return p;
  }

  start() {
    this.phase = 'ship';
    this.time = 0;
    if (this.practice) this._setupPractice();
    for (const p of this.list) {
      if (!p.isBot) this.send(p.id, this._welcome(p));
    }
    if (this.practice) this.announce('Firing range — dummies respawn, ring disabled');
    else this.announce('The drop ship is inbound. Pick your landing!');
  }

  // Firing range: no ring, no drop ship, passive target dummies and a full weapon rack.
  _setupPractice() {
    this.phase = 'play';
    // find an open 70 m square so the range is clear of buildings
    let cx = 0, cz = 0;
    for (let i = 0; i < 400; i++) {
      const x = this.rng.range(-500, 500), z = this.rng.range(-500, 500);
      if (!this.world.query(x - 30, z - 45, x + 30, z + 15, this.tmp).length) { cx = x; cz = z; break; }
    }
    this.rangeSpot = { x: cx, z: cz };
    let i = 0;
    for (const p of this.list) {
      p.inShip = false;
      p.ms.mode = 'ground';
      p.ms.onGround = false;
      if (!p.isBot) {
        p.ms.x = cx; p.ms.y = 2; p.ms.z = cz;
        p.armor = 3; p.shield = 100; p.helmet = 2; p.pack = 3;
        p.ultCd = 0;
        p.inv = [
          { item: 'a:light', n: 60, tier: 0 }, { item: 'a:heavy', n: 60, tier: 0 }, { item: 'a:energy', n: 60, tier: 0 },
          { item: 'a:shotgun', n: 16, tier: 0 }, { item: 'a:sniper', n: 24, tier: 0 }, { item: 'c:battery', n: 2, tier: 0 },
          { item: 'c:medkit', n: 2, tier: 0 }, { item: 'g:frag', n: 2, tier: 0 }, { item: 'g:arc', n: 2, tier: 0 },
        ];
        p.weapons = [makeWeapon('talon', 1), makeWeapon('breacher', 1)];
        this.invDirty(p);
      } else {
        // dummies in a fan in front of the player
        const a = (i - 5) * 0.16, d = 14 + (i % 4) * 9;
        p.home = { x: cx + Math.sin(a) * d, z: cz - Math.cos(a) * d };
        p.ms.x = p.home.x; p.ms.z = p.home.z; p.ms.y = 2;
        p.armor = 1 + (i % 3); p.shield = SHIELD_TIERS[p.armor];
        p.dummy = true;
        i++;
      }
    }
    // weapon rack: every gun at purple tier
    let k = 0;
    for (const id of Object.keys(WEAPONS)) {
      this._addLoot({ item: 'w:' + id, n: 1, tier: 2 }, cx - 9 + k * 2, 0.05, cz + 4);
      k++;
    }
    for (const it of ['x:optic2', 'x:optic3', 'x:barrel', 'x:stock', 'x:mag']) this._addLoot({ item: it, n: 1, tier: 3 }, cx - 9 + k++ * 2, 0.05, cz + 4);
    this.ring.r = 5000; this.ring.nr = 5000; this.ring.state = 'final';
  }

  _welcome(p) {
    return {
      t: 'welcome', you: p.id, seed: this.seed, mode: this.mode,
      players: this.list.map((q) => ({ id: q.id, name: q.name, legend: q.legend, squad: q.squad, bot: q.isBot })),
      loot: [...this.loot.values()],
      bins: [...this.binsOpened],
      ship: this.ship,
      ringPhases: RING_PHASES,
    };
  }

  // ---------------------------------------------------------------- ring
  _nextRing() {
    const R = this.ring;
    R.idx++;
    const ph = RING_PHASES[R.idx];
    if (!ph) { R.state = 'final'; return; }
    R.fromX = R.cx; R.fromZ = R.cz; R.fromR = R.r;
    const maxOff = Math.max(0, R.r - ph.radius) * (R.idx === 0 ? 0.55 : 0.8);
    const a = this.rng() * Math.PI * 2, d = Math.sqrt(this.rng()) * maxOff;
    R.nx = clamp(R.cx + Math.cos(a) * d, -MAP_HALF + ph.radius * 0.5, MAP_HALF - ph.radius * 0.5);
    R.nz = clamp(R.cz + Math.sin(a) * d, -MAP_HALF + ph.radius * 0.5, MAP_HALF - ph.radius * 0.5);
    R.nr = ph.radius;
    R.state = 'wait';
    R.t = ph.wait + (R.idx === 0 ? 30 : 0);
    R.total = R.t;
    R.dmg = R.idx === 0 ? 1 : RING_PHASES[R.idx - 1].dmg;
  }

  _updateRing(dt) {
    const R = this.ring;
    if (R.state === 'final' || this.practice) return;
    R.t -= dt;
    const ph = RING_PHASES[R.idx];
    if (R.state === 'wait' && R.t <= 0) {
      R.state = 'close';
      R.t = ph.close;
      R.total = ph.close;
      R.dmg = ph.dmg;
      this.events.push({ e: 'ring', s: 'close', g: 1 });
      this.announce(`Ring ${R.idx + 1} closing!`);
      // care package with each ring after the first
      if (R.idx >= 1 && R.idx <= 4) {
        const a = this.rng() * Math.PI * 2, d = this.rng() * R.nr * 0.7;
        this.spawnCarePackage(R.nx + Math.cos(a) * d, R.nz + Math.sin(a) * d, 3);
      }
    } else if (R.state === 'close') {
      const k = 1 - Math.max(0, R.t) / ph.close;
      R.cx = R.fromX + (R.nx - R.fromX) * k;
      R.cz = R.fromZ + (R.nz - R.fromZ) * k;
      R.r = R.fromR + (R.nr - R.fromR) * k;
      if (R.t <= 0) {
        this._nextRing();
        this.events.push({ e: 'ring', s: 'wait', g: 1 });
      }
    }
  }

  // ---------------------------------------------------------------- messages
  handle(pid, msg) {
    const p = this.players.get(pid);
    if (!p) return;
    switch (msg.t) {
      case 'in':
        for (const c of msg.cmds) {
          if (c.seq > p.ack && p.cmds.length < 30) p.cmds.push(c);
        }
        break;
      case 'fire': this._humanFire(p, msg); break;
      case 'hit': this._humanHit(p, msg); break;
      case 'act': this.action(p, msg); break;
    }
  }

  action(p, m) {
    if (m.a === 'jump') return this._jumpFromShip(p);
    if (m.a === 'spect') return this._cycleSpectate(p);
    if (!p.alive || p.eliminated) return;
    switch (m.a) {
      case 'pickup': return this._pickup(p, m.id);
      case 'reload': return this._startReload(p);
      case 'slot': if (m.s === 0 || m.s === 1) this._switch(p, m.s); return;
      case 'swap': this._switch(p, 1 - p.active); return;
      case 'heal': return this._startHeal(p, m.item);
      case 'tac': return this.useTac(p, m);
      case 'ult': return this.useUlt(p, m);
      case 'throw': return this._throwGrenade(p, m.g);
      case 'drop': return this._dropInv(p, m.i);
      case 'dropw': return this._dropWeapon(p, m.s);
      case 'bin': return this._openBin(p, m.id);
      case 'box': return this._openBox(p, m.id);
      case 'boxtake': return this._boxTake(p, m.id, m.i);
      case 'ping': this.events.push({ e: 'ping', id: p.id, x: m.x, y: m.y, z: m.z, k: m.k || 'go', sq: p.squad, g: 1 }); return;
      case 'cancel': p.healing = null; return;
    }
  }

  useTac(p, m = {}) {
    if (p.downed || p.tacCd > 0 || p.inShip || p.ms.mode === 'skydive') return;
    if (useTactical(this, p, m)) {
      p.tacCd = LEGENDS[p.legend].tactical.cd;
      p.healing = null;
    }
  }

  useUlt(p, m = {}) {
    if (p.downed || p.inShip || p.ms.mode === 'skydive') return;
    if (p.ultCd > 0 && !p.abil.riftOpen) return;
    if (useUltimate(this, p, m)) {
      if (!p.abil.riftOpen) p.ultCd = LEGENDS[p.legend].ultimate.cd;
      p.healing = null;
    }
  }

  _jumpFromShip(p) {
    if (!p.inShip || this.phase !== 'ship') return;
    p.inShip = false;
    p.cmds.length = 0;
    p.ms.x = this.ship.x + (this.rng() - 0.5) * 4;
    p.ms.z = this.ship.z + (this.rng() - 0.5) * 4;
    p.ms.y = SHIP_ALT - 4;
    p.ms.mode = 'skydive';
    p.ms.vx = this.ship.dirx * 15;
    p.ms.vz = this.ship.dirz * 15;
    p.ms.vy = 0;
    this.events.push({ e: 'abil', k: 'dropjump', id: p.id, x: p.ms.x, y: p.ms.y, z: p.ms.z });
    // squad bots follow a human jumpmaster
    if (!p.isBot) {
      for (const mid of this.squads[p.squad].members) {
        const q = this.players.get(mid);
        if (q.isBot && q.inShip) q.bot.followJump(p);
      }
    }
  }

  // ---------------------------------------------------------------- inventory actions
  _pickup(p, lootId) {
    const wi = this.loot.get(lootId);
    if (!wi) return;
    const dx = wi.x - p.ms.x, dy = wi.y - p.ms.y, dz = wi.z - p.ms.z;
    if (dx * dx + dz * dz > 3.2 * 3.2 || Math.abs(dy) > 3) return;
    const drops = pickup(p, wi);
    if (!drops) { this.sendTo(p, { t: 'toast', msg: 'Inventory full' }); return; }
    this._removeLoot(lootId);
    for (const d of drops) {
      if (d.keepId) { this._addLoot({ ...d }, wi.x, wi.y, wi.z); continue; }
      this._addLoot(d, p.ms.x + (this.rng() - 0.5), p.ms.y + 0.05, p.ms.z + (this.rng() - 0.5));
    }
    this.events.push({ e: 'pickup', id: p.id, item: wi.item, to: [p.id] });
    this.invDirty(p);
  }

  _dropInv(p, i) {
    const s = p.inv[i];
    if (!s) return;
    p.inv.splice(i, 1);
    this._addLoot({ item: s.item, n: s.n, tier: s.tier }, p.ms.x, p.ms.y + 0.05, p.ms.z);
    this.invDirty(p);
  }

  _dropWeapon(p, slot) {
    const w = p.weapons[slot];
    if (!w) return;
    if (w.mag > 0) addStack(p, 'a:' + WEAPONS[w.id].ammo, w.mag);
    p.weapons[slot] = null;
    this._addLoot({ item: 'w:' + w.id, n: 1, tier: w.tier, mag: 0, att: w.att }, p.ms.x, p.ms.y + 0.05, p.ms.z);
    if (!p.weapons[p.active] && p.weapons[1 - p.active]) p.active = 1 - p.active;
    this.invDirty(p);
  }

  _openBin(p, idx) {
    const b = this.map.bins[idx];
    if (!b || this.binsOpened[idx]) return;
    if ((b.x - p.ms.x) ** 2 + (b.z - p.ms.z) ** 2 > 3.5 * 3.5) return;
    this.binsOpened[idx] = 1;
    const n = 2 + Math.floor(this.rng() * 2);
    for (let i = 0; i < n; i++) {
      const l = rollLoot(this.rng, b.tier + 1);
      this._addLoot(l, b.x + (i - 1) * 0.45, b.y + 0.02, b.z);
    }
    this.events.push({ e: 'bin', i: idx, g: 1, x: b.x, y: b.y, z: b.z });
  }

  _openBox(p, id) {
    const e = this.entities.get(id);
    if (!e || (e.k !== 'box' && e.k !== 'carepkg')) return;
    if ((e.x - p.ms.x) ** 2 + (e.z - p.ms.z) ** 2 > 3.5 * 3.5) return;
    if (e.k === 'carepkg' && !e.landed) return;
    // grab banner of a squadmate
    if (e.k === 'box' && e.squad === p.squad && e.bannerUntil > this.time && !e.bannerTaken) {
      e.bannerTaken = true;
      p.banners.push(e.owner);
      this.events.push({ e: 'banner', id: p.id, v: e.owner, sq: p.squad });
      this.announceSquad(p.squad, `${p.name} picked up ${this.players.get(e.owner).name}'s banner`);
    }
    this.sendTo(p, { t: 'box', id, items: e.items });
  }

  _boxTake(p, id, i) {
    const e = this.entities.get(id);
    if (!e || !e.items || !e.items[i]) return;
    if ((e.x - p.ms.x) ** 2 + (e.z - p.ms.z) ** 2 > 3.5 * 3.5) return;
    const it = e.items[i];
    const drops = pickup(p, it);
    if (!drops) { this.sendTo(p, { t: 'toast', msg: 'Inventory full' }); return; }
    e.items.splice(i, 1);
    for (const d of drops) {
      if (d.keepId) e.items.push({ item: d.item, n: d.n, tier: d.tier });
      else e.items.push(d);
    }
    this.events.push({ e: 'pickup', id: p.id, item: it.item, to: [p.id] });
    this.invDirty(p);
    this.sendTo(p, { t: 'box', id, items: e.items });
  }

  invDirty(p) {
    p.invDirty = true;
  }

  _sendInv(p) {
    p.invDirty = false;
    if (p.isBot) return;
    this.sendTo(p, {
      t: 'inv', weapons: p.weapons, active: p.active, inv: p.inv, armor: p.armor, helmet: p.helmet, pack: p.pack,
    });
  }

  _switch(p, slot) {
    if (!p.weapons[slot] || slot === p.active) return;
    p.active = slot;
    p.reloading = null;
    p.switchT = WEAPONS[p.weapons[slot].id].deploy * 0.6;
    this.invDirty(p);
  }

  _startReload(p) {
    const w = p.weapons[p.active];
    if (!w || p.reloading || p.downed) return;
    if (reloadAmount(p, w) <= 0) return;
    const def = WEAPONS[w.id];
    const stockMul = [1, 0.92, 0.85, 0.78][w.att.stock || 0];
    p.reloading = { t: (w.mag === 0 ? def.reloadEmpty : def.reload) * stockMul, slot: p.active };
    p.healing = null;
    this.events.push({ e: 'reload', id: p.id, w: w.id, x: p.ms.x, y: p.ms.y, z: p.ms.z });
  }

  _startHeal(p, item) {
    if (p.downed || p.healing) return;
    if (!item) item = this.bestHeal(p);
    if (!item) return;
    const c = CONSUMABLES[item.split(':')[1]];
    if (!c || countItem(p, item) <= 0) return;
    if (c.shield && !c.heal && (p.armor === 0 || p.shield >= SHIELD_TIERS[p.armor])) return;
    if (c.heal && !c.shield && p.hp >= 100) return;
    if (c.heal && c.shield && p.hp >= 100 && p.shield >= SHIELD_TIERS[p.armor]) return;
    const mul = p.legend === 'halo' ? 0.75 : 1;
    p.healing = { item, t: c.time * mul, total: c.time * mul };
    p.reloading = null;
    this.events.push({ e: 'heal', id: p.id, item, x: p.ms.x, y: p.ms.y, z: p.ms.z });
  }

  bestHeal(p) {
    const maxS = SHIELD_TIERS[p.armor];
    const has = (k) => countItem(p, 'c:' + k) > 0;
    const sMiss = maxS - p.shield, hMiss = 100 - p.hp;
    if (sMiss > 0 && hMiss > 0 && sMiss + hMiss > 120 && has('phoenix')) return 'c:phoenix';
    if (sMiss > 0) {
      if (sMiss > 40 && has('battery')) return 'c:battery';
      if (has('cell')) return 'c:cell';
      if (has('battery')) return 'c:battery';
    }
    if (hMiss > 0) {
      if (hMiss > 40 && has('medkit')) return 'c:medkit';
      if (has('syringe')) return 'c:syringe';
      if (has('medkit')) return 'c:medkit';
    }
    if ((sMiss > 0 || hMiss > 0) && has('phoenix')) return 'c:phoenix';
    return null;
  }

  _throwGrenade(p, g) {
    if (p.downed) return;
    const key = 'g:' + (g || (countItem(p, 'g:frag') ? 'frag' : 'arc'));
    if (countItem(p, key) <= 0) return;
    takeItem(p, key, 1);
    this.invDirty(p);
    const kind = key.split(':')[1];
    const G = GRENADES[kind];
    const d = dirFromAngles(p.ms.yaw, p.ms.pitch + 0.12);
    const eye = eyeHeight(p.ms);
    this.throwProjectile(p, kind, p.ms.x + d.x * 0.6, p.ms.y + eye, p.ms.z + d.z * 0.6, d.x * 22 + p.ms.vx * 0.5, d.y * 22 + 2, d.z * 22 + p.ms.vz * 0.5, {
      fuse: G.fuse, sticky: G.sticky,
      onExplode: (pr) => {
        this.explode(pr.x, pr.y, pr.z, G.radius, G.damage, p, kind);
        if (G.slow) this._slowArea(pr.x, pr.y, pr.z, G.radius, p, 2.5);
      },
    });
    this.events.push({ e: 'abil', k: 'throw', id: p.id, x: p.ms.x, y: p.ms.y, z: p.ms.z });
  }

  // ---------------------------------------------------------------- combat
  _humanFire(p, m) {
    if (!p.alive || p.downed || p.inShip || p.status.phase > 0) return;
    const w = p.weapons[m.slot];
    if (!w || m.slot !== p.active) return;
    const def = WEAPONS[w.id];
    if (w.mag <= 0) return;
    const interval = fireInterval(def);
    if (this.time - p.fireT < interval * 0.6 - 0.05) return; // tolerate jitter
    p.fireT = this.time;
    w.mag--;
    p.reloading = null;
    p.healing = null;
    p.lastFire = this.time;
    p.shots.set(m.id, { t: this.time, w: w.id, pellets: m.dirs.length, used: new Set(), ox: m.o[0], oy: m.o[1], oz: m.o[2] });
    if (p.shots.size > 60) {
      const first = p.shots.keys().next().value;
      p.shots.delete(first);
    }
    this.events.push({ e: 'shot', id: p.id, w: w.id, o: m.o, d: m.dirs, sq: p.squad, x: m.o[0], y: m.o[1], z: m.o[2], r: 450, ex: p.id });
    this._alertNearby(p, m.o[0], m.o[2]);
  }

  _humanHit(p, m) {
    const shot = p.shots.get(m.id);
    if (!shot || shot.used.has(m.k) || m.k >= shot.pellets) return;
    if (this.time - shot.t > 3) return;
    const v = this.players.get(m.v);
    if (!v || !v.alive || v.eliminated || v.inShip) return;
    // lag-compensated validation: target must have been near the claimed point
    let ok = false;
    for (let i = v.hist.length - 1; i >= 0; i--) {
      const h = v.hist[i];
      if (h.t < this.time - 1.0) break;
      const dx = h.x - m.x, dz = h.z - m.z, dy = m.y - h.y;
      if (dx * dx + dz * dz < 2.2 * 2.2 && dy > -0.8 && dy < 2.8) { ok = true; break; }
    }
    if (!ok) return;
    // line of sight from shooter origin to hit point
    const dx = m.x - shot.ox, dy = m.y - shot.oy, dz = m.z - shot.oz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 1) {
      const hit = this.world.raycast(shot.ox, shot.oy, shot.oz, dx / dist, dy / dist, dz / dist, dist - 0.3, this.tmp);
      if (hit) return;
    }
    shot.used.add(m.k);
    const def = WEAPONS[shot.w];
    const part = m.part === 'head' || m.part === 'legs' ? m.part : 'body';
    this.applyWeaponDamage(p, v, def, part, dist, m.x, m.y, m.z);
  }

  applyWeaponDamage(a, v, def, part, dist, x, y, z) {
    let dmg = def.damage * falloff(def, dist);
    if (part === 'head') dmg *= 1 + (def.headMul - 1) * (1 - HELMET_HEAD_REDUCTION[v.helmet]);
    else if (part === 'legs') dmg *= def.legMul;
    this.damage(v, dmg, a, { part, weapon: def.name, x, y, z });
  }

  // Core damage resolution: shields, evo progress, knockdowns, eliminations.
  damage(v, amount, a, info = {}) {
    if (!v.alive || v.eliminated || v.inShip) return 0;
    if (v.status.phase > 0) return 0;
    if (v.ms.mode === 'skydive' || v.ms.launchT > 0) return 0;
    if (a && a !== v && a.squad === v.squad && !info.self) return 0;
    if (v.legend === 'bastion') amount *= 0.85;
    amount = Math.round(amount);
    if (amount <= 0) return 0;
    v.lastHurt = this.time;
    if (a && a !== v) v.lastAttacker = a.id;
    v.healing = null;
    if (a && a !== v && v.bot) v.bot.onDamaged(a);
    if (v.legend === 'volt' && !v.downed) v.status.doubletime = 2;
    let shieldDmg = 0, hpDmg = 0, broke = false;
    if (v.downed) {
      hpDmg = Math.min(v.hp, amount);
      v.hp -= hpDmg;
    } else {
      if (!info.ignoreShield && v.shield > 0) {
        shieldDmg = Math.min(v.shield, amount);
        v.shield -= shieldDmg;
        if (v.shield <= 0) broke = true;
      }
      hpDmg = Math.min(v.hp, amount - shieldDmg);
      v.hp -= hpDmg;
    }
    const dealt = shieldDmg + hpDmg;
    if (a && a !== v) {
      a.damage += dealt;
      if (!v.downed || hpDmg > 0) this._evo(a, dealt);
      a.lastCombat = this.time;
    }
    v.lastCombat = this.time;
    const evt = {
      e: 'hit', a: a ? a.id : 0, v: v.id, dmg: dealt, sd: shieldDmg, part: info.part || 'body', brk: broke ? 1 : 0,
      tier: v.armor, x: info.x ?? v.ms.x, y: info.y ?? v.ms.y + 1.2, z: info.z ?? v.ms.z, src: info.src || 0,
      to: a ? [a.id, v.id] : [v.id], ax: a ? a.ms.x : 0, az: a ? a.ms.z : 0,
    };
    this.events.push(evt);
    if (v.hp <= 0) {
      if (v.downed) this.eliminate(v, a, info);
      else this._knock(v, a, info, evt);
    }
    return dealt;
  }

  _evo(a, dealt) {
    if (a.armor <= 0 || a.armor >= 4) return;
    a.evoDmg += dealt;
    const need = EVO_THRESHOLDS[a.armor];
    if (a.evoDmg >= need) {
      a.evoDmg -= need;
      a.armor++;
      a.shield = SHIELD_TIERS[a.armor];
      this.events.push({ e: 'evo', id: a.id, tier: a.armor, to: [a.id], x: a.ms.x, y: a.ms.y, z: a.ms.z });
      this.invDirty(a);
    }
  }

  _knock(v, a, info, evt) {
    if (this.practice) { this.eliminate(v, a, info); return; }
    const sq = this.squads[v.squad];
    const othersUp = sq.members.some((id) => {
      const q = this.players.get(id);
      return q !== v && q.alive && !q.eliminated && !q.downed && !q.inShip;
    });
    if (!othersUp) {
      // last one standing: whole squad goes
      this.eliminate(v, a, info);
      for (const id of sq.members) {
        const q = this.players.get(id);
        if (q.downed && q.alive) this.eliminate(q, a, { ...info, bleed: true });
      }
      return;
    }
    v.downed = true;
    v.ms.downed = 1;
    v.hp = DOWNED_HP;
    v.shield = 0;
    v.bleed = BLEEDOUT_TIME;
    v.healing = null;
    v.reloading = null;
    v.status.phase = 0;
    if (a) a.knocks++;
    evt.knock = 1;
    this.events.push({ e: 'knock', a: a ? a.id : 0, v: v.id, w: info.weapon || '', g: 1 });
  }

  eliminate(v, a, info = {}) {
    if (v.eliminated) return;
    v.alive = false;
    v.eliminated = true;
    v.downed = false;
    v.ms.downed = 0;
    v.hp = 0;
    v.killer = a ? a.id : 0;
    v.deathT = this.time;
    if (a && a !== v) {
      a.kills++;
      this.squads[a.squad].kills++;
    }
    this.events.push({ e: 'kill', a: a ? a.id : 0, v: v.id, w: info.weapon || (info.ring ? 'Ring' : ''), g: 1, x: v.ms.x, y: v.ms.y, z: v.ms.z });
    // death box with banner
    const items = [];
    for (const w of v.weapons) if (w) items.push({ item: 'w:' + w.id, n: 1, tier: w.tier, mag: w.mag, att: w.att });
    if (v.armor > 0) items.push({ item: 'armor', n: 1, tier: v.armor, charge: SHIELD_TIERS[v.armor], evo: v.evoDmg });
    if (v.helmet > 0) items.push({ item: 'helmet', n: 1, tier: v.helmet });
    if (v.pack > 0) items.push({ item: 'pack', n: 1, tier: v.pack });
    for (const s of v.inv) items.push({ ...s });
    const gy = this.world.groundAt(v.ms.x, v.ms.z, v.ms.y + 0.5, this.tmp);
    this.spawnEntity({
      k: 'box', x: v.ms.x, y: gy, z: v.ms.z, owner: v.id, squad: v.squad, items, dur: 9999,
      bannerUntil: this.time + BANNER_TIME, bannerTaken: false, name: v.name, tier: v.armor,
    });
    v.weapons = [null, null];
    v.inv = [];
    v.armor = 0; v.shield = 0; v.helmet = 0; v.pack = 0;
    v.cmds.length = 0;
    this.invDirty(v);
    // banners carried by v are lost
    v.banners = [];
    if (this.practice) {
      if (v.dummy) v.respawnAt = this.time + 3;
      else v.respawnAt = this.time + 2;
      return;
    }
    this._checkSquad(v.squad);
    // choose spectate target
    this._autoSpectate(v);
    for (const q of this.list) if (q.spect === v.id) this._autoSpectate(q);
  }

  _checkSquad(si) {
    const sq = this.squads[si];
    if (!sq.alive) return;
    const anyAlive = sq.members.some((id) => {
      const q = this.players.get(id);
      return q.alive && !q.eliminated;
    });
    // respawnable banners still count the squad alive if someone is up
    if (!anyAlive) {
      sq.alive = false;
      const left = this.squads.filter((s) => s.alive).length;
      sq.placement = left + 1;
      this.events.push({ e: 'squadout', sq: si, place: sq.placement, g: 1 });
      for (const id of sq.members) {
        const q = this.players.get(id);
        if (!q.isBot) this.sendTo(q, { t: 'squadout', place: sq.placement, kills: q.kills, damage: Math.round(q.damage), squadKills: sq.kills });
      }
      if (left <= 1) this._endMatch();
    }
  }

  _endMatch() {
    if (this.over) return;
    this.over = true;
    this.phase = 'over';
    const winner = this.squads.find((s) => s.alive);
    if (winner) winner.placement = 1;
    const champs = winner ? winner.members.map((id) => this.players.get(id).name) : [];
    for (const p of this.list) {
      if (p.isBot) continue;
      const sq = this.squads[p.squad];
      this.sendTo(p, {
        t: 'end', win: sq === winner, place: sq.placement, champs, kills: p.kills, damage: Math.round(p.damage),
        squadKills: sq.kills,
      });
    }
  }

  _autoSpectate(v) {
    const sq = this.squads[v.squad];
    const mate = sq.members.map((id) => this.players.get(id)).find((q) => q.alive && !q.eliminated && q !== v);
    if (mate) { v.spect = mate.id; return; }
    const k = this.players.get(v.killer);
    if (k && k.alive) { v.spect = k.id; return; }
    const any = this.list.find((q) => q.alive && !q.eliminated && !q.inShip);
    v.spect = any ? any.id : 0;
  }

  _cycleSpectate(p) {
    if (p.alive) return;
    const alive = this.list.filter((q) => q.alive && !q.eliminated && !q.inShip);
    if (!alive.length) return;
    const i = alive.findIndex((q) => q.id === p.spect);
    p.spect = alive[(i + 1) % alive.length].id;
  }

  // Server-side bullets (bots). Players fire from eye position.
  botFire(p, aimYaw, aimPitch, spreadDeg) {
    const w = p.weapons[p.active];
    if (!w) return false;
    const def = WEAPONS[w.id];
    if (w.mag <= 0 || p.reloading || p.switchT > 0 || p.downed || p.status.phase > 0) return false;
    if (this.time - p.fireT < fireInterval(def)) return false;
    p.fireT = this.time;
    w.mag--;
    p.lastFire = this.time;
    p.healing = null;
    const ex = p.ms.x, ey = p.ms.y + eyeHeight(p.ms) - 0.1, ez = p.ms.z;
    const pellets = def.pellets || 1;
    const dirs = [];
    for (let i = 0; i < pellets; i++) {
      const sp = (def.pellets ? def.pelletSpread : 0) + spreadDeg;
      const r = Math.sqrt(this.rng()) * sp * 0.5 * (Math.PI / 180), a = this.rng() * Math.PI * 2;
      const d = dirFromAngles(aimYaw + Math.cos(a) * r, aimPitch + Math.sin(a) * r);
      dirs.push([+d.x.toFixed(4), +d.y.toFixed(4), +d.z.toFixed(4)]);
      this.projectiles.push({
        k: 'bullet', owner: p, def, x: ex + d.x * 0.5, y: ey + d.y * 0.5, z: ez + d.z * 0.5,
        vx: d.x * def.speed, vy: d.y * def.speed, vz: d.z * def.speed, life: 2.0, dist: 0,
      });
    }
    this.events.push({ e: 'shot', id: p.id, w: w.id, o: [+ex.toFixed(2), +ey.toFixed(2), +ez.toFixed(2)], d: dirs, sq: p.squad, x: ex, y: ey, z: ez, r: 450 });
    this._alertNearby(p, ex, ez);
    if (w.mag === 0) this._startReload(p);
    return true;
  }

  _alertNearby(p, x, z) {
    // bots hear gunfire (third-party magnet)
    for (const q of this.queryPlayers(x, z, 160)) {
      if (q.bot && q.squad !== p.squad) q.bot.hearShot(p, x, z);
    }
  }

  _stepBullet(b, dt) {
    const g = 6 * b.def.drop;
    const sx = b.x, sy = b.y, sz = b.z;
    b.vy -= g * dt;
    const nx = sx + b.vx * dt, ny = sy + b.vy * dt, nz = sz + b.vz * dt;
    const dx = nx - sx, dy = ny - sy, dz = nz - sz;
    const len = Math.hypot(dx, dy, dz);
    const ux = dx / len, uy = dy / len, uz = dz / len;
    const wh = this.world.raycast(sx, sy, sz, ux, uy, uz, len, this.tmp);
    let best = wh ? wh.t : len, target = null, part = null;
    const cands = this.queryPlayers((sx + nx) / 2, (sz + nz) / 2, len / 2 + 2);
    for (const q of cands) {
      if (q === b.owner || !q.alive || q.inShip || q.squad === b.owner.squad || q.status.phase > 0) continue;
      const h = q.downed ? 0.8 : playerHeight(q.ms);
      const r = rayPlayer(sx, sy, sz, ux, uy, uz, q.ms.x, q.ms.y, q.ms.z, h, 0.45, best);
      if (r && r.t < best) { best = r.t; target = q; part = r.part; }
    }
    b.dist += best;
    if (target) {
      this.applyWeaponDamage(b.owner, target, b.def, part, b.dist, sx + ux * best, sy + uy * best, sz + uz * best);
      return true;
    }
    if (wh) {
      this.events.push({ e: 'impact', x: sx + ux * best, y: sy + uy * best, z: sz + uz * best, n: [wh.nx, wh.ny, wh.nz], r: 120 });
      return true;
    }
    // near-miss whiz for humans
    b.x = nx; b.y = ny; b.z = nz;
    return false;
  }

  explode(x, y, z, r, dmg, owner, src) {
    this.events.push({ e: 'boom', x, y, z, r, k: src, rr: 500 });
    for (const q of this.queryPlayers(x, z, r + 1)) {
      if (!q.alive || q.inShip) continue;
      const cx = q.ms.x, cy = q.ms.y + 1, cz = q.ms.z;
      const d = Math.hypot(cx - x, cy - y, cz - z);
      if (d > r) continue;
      // cover check
      const dd = Math.max(0.01, d);
      const hit = this.world.raycast(x, y + 0.3, z, (cx - x) / dd, (cy - y - 0.3) / dd, (cz - z) / dd, dd - 0.4, this.tmp);
      if (hit) continue;
      const fall = 1 - (d / r) * 0.6;
      const self = q === owner;
      this.damage(q, dmg * fall * (self ? 0.5 : 1), owner, { part: 'body', weapon: src, self, src: 1 });
    }
  }

  _slowArea(x, y, z, r, owner, dur) {
    for (const q of this.queryPlayers(x, z, r)) {
      if (q.squad === owner.squad || q.legend === 'bastion') continue;
      q.status.slow = Math.max(q.status.slow || 0, dur);
    }
  }

  throwProjectile(owner, k, x, y, z, vx, vy, vz, opts = {}) {
    const id = this.nextEnt++;
    const pr = { id, k, owner, x, y, z, vx, vy, vz, fuse: opts.fuse ?? 2, life: opts.life ?? 8, ...opts, landed: false, stuck: null };
    this.projectiles.push(pr);
    return pr;
  }

  _stepThrown(pr, dt) {
    pr.life -= dt;
    if (pr.stuck) {
      pr.x = pr.stuck.ms.x; pr.y = pr.stuck.ms.y + 1; pr.z = pr.stuck.ms.z;
    } else if (!pr.landed) {
      pr.vy -= (pr.gravity ?? 16) * dt;
      const sx = pr.x, sy = pr.y, sz = pr.z;
      const dx = pr.vx * dt, dy = pr.vy * dt, dz = pr.vz * dt;
      const len = Math.hypot(dx, dy, dz) || 1e-6;
      const hit = this.world.raycast(sx, sy, sz, dx / len, dy / len, dz / len, len, this.tmp, false);
      if (pr.sticky) {
        for (const q of this.queryPlayers(sx, sz, len + 2)) {
          if (q === pr.owner || !q.alive || q.inShip) continue;
          if (Math.hypot(q.ms.x - sx, q.ms.z - sz) < 0.8 && sy > q.ms.y && sy < q.ms.y + 2) { pr.stuck = q; break; }
        }
      }
      if (pr.k === 'missile') {
        for (const q of this.queryPlayers(sx, sz, len + 2)) {
          if (q.squad === pr.owner.squad || !q.alive || q.inShip) continue;
          if (Math.hypot(q.ms.x - sx, q.ms.z - sz) < 1 && sy > q.ms.y - 0.2 && sy < q.ms.y + 2.2) { pr.life = 0; break; }
        }
      }
      if (hit) {
        pr.x = sx + (dx / len) * (hit.t - 0.05);
        pr.y = sy + (dy / len) * (hit.t - 0.05);
        pr.z = sz + (dz / len) * (hit.t - 0.05);
        if (pr.sticky || pr.k === 'missile' || pr.impact) {
          pr.landed = true;
          if (pr.k === 'missile' || pr.impact) pr.life = 0;
        } else if (hit.ny > 0.5 && Math.abs(pr.vy) < 4) {
          pr.landed = true;
          pr.y = sy + (dy / len) * hit.t;
          if (pr.onLand) { pr.onLand(pr); if (!pr.onExplode) pr.life = 0; }
        } else {
          // bounce
          const k = 0.35;
          if (hit.nx) pr.vx = -pr.vx * k;
          if (hit.ny) pr.vy = -pr.vy * k;
          if (hit.nz) pr.vz = -pr.vz * k;
          pr.vx *= 0.7; pr.vz *= 0.7;
        }
      } else {
        pr.x += dx; pr.y += dy; pr.z += dz;
      }
    }
    pr.fuse -= dt;
    if (pr.fuse <= 0 || pr.life <= 0) {
      if (pr.onExplode) pr.onExplode(pr);
      else if (pr.onLand && !pr.landed) pr.onLand(pr);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- entities
  spawnEntity(e) {
    e.id = this.nextEnt++;
    e.t = 0;
    this.entities.set(e.id, e);
    return e;
  }

  removeEntity(e) {
    this.entities.delete(e.id);
    if (e.onRemove) e.onRemove(e);
  }

  spawnCarePackage(x, z, tier) {
    const y = this.world.groundAt(x, z, 500, this.tmp);
    const items = [];
    const wid = this.rng.pick(['sentinel', 'mauler', 'hornet', 'bulwark', 'breacher', 'viper', 'scout']);
    items.push({ item: 'w:' + wid, n: 1, tier: 3 });
    items.push({ item: 'helmet', n: 1, tier: 3 });
    items.push({ item: this.rng() < 0.5 ? 'c:battery' : 'c:phoenix', n: 2, tier: 0 });
    if (tier >= 3) items.push({ item: 'pack', n: 1, tier: 3 });
    const e = this.spawnEntity({ k: 'carepkg', x, y, z, items, dur: 9999, landT: 7, landed: false, alt: 220 });
    this.events.push({ e: 'abil', k: 'carepkg', x, y, z, g: 1 });
    return e;
  }

  // Ray from eye along view to world, returns hit point (or max-range point).
  aimPoint(p, maxDist) {
    const d = dirFromAngles(p.ms.yaw, p.ms.pitch);
    const ex = p.ms.x, ey = p.ms.y + eyeHeight(p.ms), ez = p.ms.z;
    const hit = this.world.raycast(ex, ey, ez, d.x, d.y, d.z, maxDist, this.tmp, false);
    const t = hit ? hit.t - 0.2 : maxDist;
    let x = ex + d.x * t, y = ey + d.y * t, z = ez + d.z * t;
    y = this.world.groundAt(x, z, y + 0.3, this.tmp);
    return { x, y, z, hit: !!hit, dx: d.x, dz: d.z };
  }

  // ---------------------------------------------------------------- spatial
  _rebuildGrid() {
    this.grid.clear();
    for (const p of this.list) {
      if (p.eliminated || p.inShip) continue;
      const k = Math.floor((p.ms.x + 800) / CELL) * 1000 + Math.floor((p.ms.z + 800) / CELL);
      let a = this.grid.get(k);
      if (!a) this.grid.set(k, (a = []));
      a.push(p);
    }
  }

  queryPlayers(x, z, r, out = []) {
    out.length = 0;
    const c0x = Math.floor((x - r + 800) / CELL), c1x = Math.floor((x + r + 800) / CELL);
    const c0z = Math.floor((z - r + 800) / CELL), c1z = Math.floor((z + r + 800) / CELL);
    const r2 = r * r;
    for (let cx = c0x; cx <= c1x; cx++)
      for (let cz = c0z; cz <= c1z; cz++) {
        const a = this.grid.get(cx * 1000 + cz);
        if (!a) continue;
        for (const p of a) if ((p.ms.x - x) ** 2 + (p.ms.z - z) ** 2 <= r2) out.push(p);
      }
    return out;
  }

  // ---------------------------------------------------------------- tick
  tick(dt) {
    if (this.phase === 'lobby' || this.over) return;
    this.time += dt;
    const S = this.ship;
    if (this.phase === 'ship') {
      S.t += dt;
      const k = Math.min(1, S.t / S.dur);
      S.x = S.ax + (S.bx - S.ax) * k;
      S.z = S.az + (S.bz - S.az) * k;
      for (const p of this.list) {
        if (p.inShip) { p.ms.x = S.x; p.ms.z = S.z; p.ms.y = SHIP_ALT; }
      }
      if (k >= 1) {
        for (const p of this.list) if (p.inShip) this._jumpFromShip(p);
        this.phase = 'play';
      }
    }
    this._rebuildGrid();
    this.alive = 0;
    for (const p of this.list) if (p.alive && !p.eliminated) this.alive++;

    // movement + per-player logic
    for (const p of this.list) {
      if (p.eliminated) {
        if (p.respawnAt && this.time >= p.respawnAt) this._practiceRespawn(p);
        continue;
      }
      this._statusTick(p, dt);
      if (p.isBot) {
        if (!p.inShip) {
          const inp = p.bot.update(dt);
          this._applyMods(p, inp);
          stepMovement(p.ms, inp, dt / 2, this.world);
          this._moveEvents(p);
          stepMovement(p.ms, inp, dt / 2, this.world);
          this._moveEvents(p);
          p.interactHeld = !!(inp.buttons & BTN.INTERACT);
        } else p.bot.update(dt);
      } else if (!p.inShip) {
        let n = 0;
        while (p.cmds.length && n < 8) {
          const c = p.cmds.shift();
          this._applyMods(p, c);
          stepMovement(p.ms, c, SIM_DT, this.world);
          this._moveEvents(p);
          p.ack = c.seq;
          p.interactHeld = !!(c.buttons & BTN.INTERACT);
          n++;
        }
      }
      this._playerTick(p, dt);
      p.hist.push({ t: this.time, x: p.ms.x, y: p.ms.y, z: p.ms.z });
      if (p.hist.length > HIST) p.hist.shift();
    }

    // projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      let done;
      if (pr.k === 'bullet') {
        pr.life -= dt;
        done = this._stepBullet(pr, dt) || pr.life <= 0;
      } else done = this._stepThrown(pr, dt);
      if (done) this.projectiles.splice(i, 1);
    }

    // ability entities
    this.world.bulletBlockers.length = 0;
    this.world.pads.length = 0;
    this.smokes.length = 0;
    for (const e of this.entities.values()) {
      e.t += dt;
      updateEntity(this, e, dt);
      if (e.dur !== undefined && e.t >= e.dur) this.removeEntity(e);
    }

    this._updateRing(dt);

    // inventory sync
    for (const p of this.list) if (p.invDirty) this._sendInv(p);

    // snapshots
    this.snapAcc += dt;
    if (this.snapAcc >= 1 / SNAPSHOT_RATE - 1e-4) {
      this.snapAcc = 0;
      this._broadcast();
    }
  }

  _applyMods(p, inp) {
    const w = p.weapons[p.active];
    p.ms.speedMul = speedMul(p.status, p.healing, w ? w.id : null, inp.buttons, p.legend);
    p.ms.downed = p.downed ? 1 : 0;
    if (p.healing && inp.buttons & BTN.SPRINT) inp.buttons &= ~BTN.SPRINT;
  }

  _moveEvents(p) {
    const ev = p.ms.events;
    if (!ev) return;
    if (ev & (MEV.SLIDE | MEV.JUMP | MEV.WALLJUMP | MEV.MANTLE | MEV.SUPERGLIDE | MEV.PAD | MEV.HARDLAND)) {
      this.events.push({ e: 'mv', id: p.id, f: ev, x: p.ms.x, y: p.ms.y, z: p.ms.z, ex: p.isBot ? 0 : p.id, r: 60 });
    }
  }

  _statusTick(p, dt) {
    for (const k in p.status) if (p.status[k] > 0) p.status[k] = Math.max(0, p.status[k] - dt);
    if (p.tacCd > 0) p.tacCd = Math.max(0, p.tacCd - dt);
    if (p.ultCd > 0 && !p.abil.riftOpen) p.ultCd = Math.max(0, p.ultCd - dt);
  }

  _playerTick(p, dt) {
    if (!p.alive || p.inShip) return;
    passiveTick(this, p, dt);
    if (p.switchT > 0) p.switchT = Math.max(0, p.switchT - dt);
    // reload
    if (p.reloading) {
      p.reloading.t -= dt;
      const w = p.weapons[p.reloading.slot];
      if (!w || p.reloading.slot !== p.active) p.reloading = null;
      else if (p.reloading.t <= 0) {
        const n = reloadAmount(p, w);
        takeItem(p, 'a:' + WEAPONS[w.id].ammo, n);
        w.mag += n;
        p.reloading = null;
        this.invDirty(p);
      }
    }
    // healing
    if (p.healing) {
      p.healing.t -= dt;
      if (p.downed) p.healing = null;
      else if (p.healing.t <= 0) {
        const c = CONSUMABLES[p.healing.item.split(':')[1]];
        if (takeItem(p, p.healing.item, 1)) {
          if (c.heal) p.hp = Math.min(100, p.hp + c.heal);
          if (c.shield) p.shield = Math.min(SHIELD_TIERS[p.armor], p.shield + c.shield);
          this.events.push({ e: 'healed', id: p.id, to: [p.id] });
        }
        p.healing = null;
        this.invDirty(p);
      }
    }
    // downed bleedout
    if (p.downed) {
      p.bleed -= dt;
      if (p.bleed <= 0) this.eliminate(p, this.players.get(p.lastAttacker) || null, { weapon: 'Bleed out', bleed: true });
    }
    // hold-interact: revive / respawn beacon
    if (p.interactHeld && !p.downed) this._holdInteract(p, dt);
    else { p.reviveT = 0; p.reviveTarget = 0; p.beaconT = 0; }
    // ring damage
    const R = this.ring;
    const dr = Math.hypot(p.ms.x - R.cx, p.ms.z - R.cz);
    p.outside = dr > R.r;
    if (p.outside) {
      p.ringAcc = (p.ringAcc || 0) + dt;
      if (p.ringAcc >= 1) {
        p.ringAcc -= 1;
        this.damage(p, R.dmg, null, { ignoreShield: true, part: 'body', weapon: 'Ring', ring: true });
        if (p.hp <= 0 && !p.eliminated && !p.downed) this.eliminate(p, null, { ring: true });
      }
    } else p.ringAcc = 0;
  }

  _holdInteract(p, dt) {
    // revive
    const sq = this.squads[p.squad];
    for (const id of sq.members) {
      const q = this.players.get(id);
      if (q === p || !q.downed || !q.alive) continue;
      if ((q.ms.x - p.ms.x) ** 2 + (q.ms.z - p.ms.z) ** 2 < 2.6 * 2.6 && Math.abs(q.ms.y - p.ms.y) < 1.5) {
        if (p.reviveTarget !== q.id) { p.reviveTarget = q.id; p.reviveT = 0; }
        p.reviveT += dt * (p.legend === 'halo' ? 2 : 1);
        p.healing = null;
        if (p.reviveT >= REVIVE_TIME) {
          q.downed = false; q.ms.downed = 0; q.hp = 30; q.shield = 0; q.bleed = 0;
          p.reviveT = 0; p.reviveTarget = 0;
          this.events.push({ e: 'revive', id: q.id, by: p.id, g: 1 });
        }
        return;
      }
    }
    p.reviveT = 0; p.reviveTarget = 0;
    // respawn beacon
    if (p.banners.length) {
      for (const b of this.map.beacons) {
        if ((b.x - p.ms.x) ** 2 + (b.z - p.ms.z) ** 2 < 3.2 * 3.2) {
          p.beaconT += dt;
          if (p.beaconT >= 5) {
            p.beaconT = 0;
            for (const vid of p.banners) this._respawn(this.players.get(vid), b);
            p.banners = [];
          }
          return;
        }
      }
    }
    p.beaconT = 0;
  }

  _practiceRespawn(p) {
    p.respawnAt = 0;
    p.alive = true; p.eliminated = false; p.downed = false; p.hp = 100;
    p.armor = p.dummy ? 1 + (p.id % 3) : 3; p.shield = SHIELD_TIERS[p.armor];
    p.status = {};
    p.ms.downed = 0;
    if (p.home) { p.ms.x = p.home.x; p.ms.z = p.home.z; p.ms.y = 1; }
    else {
      p.ms.x = this.rangeSpot.x; p.ms.z = this.rangeSpot.z; p.ms.y = 2;
      p.weapons = [makeWeapon('talon', 1), makeWeapon('breacher', 1)];
      p.inv = [{ item: 'a:light', n: 60, tier: 0 }, { item: 'a:shotgun', n: 16, tier: 0 }, { item: 'a:heavy', n: 60, tier: 0 }];
      p.helmet = 2; p.pack = 3;
      this.sendTo(p, { t: 'respawned' });
    }
    p.spect = 0;
    this.invDirty(p);
  }

  _respawn(v, b) {
    if (!v || !v.eliminated) return;
    const sq = this.squads[v.squad];
    v.alive = true; v.eliminated = false; v.downed = false;
    v.hp = 100; v.armor = 1; v.shield = 50; v.evoDmg = 0;
    v.weapons = [makeWeapon('p20', 0), null]; v.active = 0;
    v.inv = [{ item: 'a:light', n: 40, tier: 0 }, { item: 'c:syringe', n: 2, tier: 0 }];
    v.ms.x = b.x; v.ms.z = b.z; v.ms.y = 140; v.ms.mode = 'skydive'; v.ms.vx = 0; v.ms.vz = 0; v.ms.vy = 0; v.ms.downed = 0;
    v.status = {};
    v.spect = 0;
    v.cmds.length = 0;
    sq.alive = true;
    this.invDirty(v);
    this.events.push({ e: 'respawn', id: v.id, g: 1, x: b.x, y: b.y, z: b.z });
    this.announceSquad(v.squad, `${v.name} has been respawned!`);
    if (!v.isBot) this.sendTo(v, { t: 'respawned' });
  }

  // ---------------------------------------------------------------- networking out
  sendTo(p, msg) {
    if (!p.isBot) this.send(p.id, msg);
  }

  announce(text) {
    this.events.push({ e: 'msg', text, g: 1 });
  }

  announceSquad(sq, text) {
    for (const id of this.squads[sq].members) {
      const q = this.players.get(id);
      if (!q.isBot) this.sendTo(q, { t: 'toast', msg: text });
    }
  }

  _meState(p) {
    const w = p.weapons[p.active];
    return {
      id: p.id, ms: p.ms, hp: Math.round(p.hp), sh: Math.round(p.shield), armor: p.armor, evo: Math.round(p.evoDmg),
      helmet: p.helmet, alive: p.alive, down: p.downed, bleed: Math.round(p.bleed), elim: p.eliminated,
      st: p.status, tac: +p.tacCd.toFixed(1), ult: +p.ultCd.toFixed(1), heal: p.healing, rl: p.reloading ? +p.reloading.t.toFixed(2) : 0,
      act: p.active, mags: [p.weapons[0]?.mag ?? 0, p.weapons[1]?.mag ?? 0], sw: p.switchT, inShip: p.inShip,
      rev: p.reviveT ? +(p.reviveT / REVIVE_TIME).toFixed(2) : 0, bcn: p.beaconT ? +(p.beaconT / 5).toFixed(2) : 0,
      banners: p.banners.length, rift: p.abil.riftOpen ? 1 : 0, out: p.outside ? 1 : 0, kills: p.kills, dmg: Math.round(p.damage),
      fuel: +p.ms.fuel.toFixed(2), wpn: w ? w.id : null, legend: p.legend,
    };
  }

  _broadcast() {
    const humans = this.list.filter((p) => !p.isBot);
    if (!humans.length) { this.events.length = 0; return; }
    // compact player rows
    const rows = new Map();
    for (const q of this.list) {
      if (q.eliminated) continue;
      const w = q.weapons[q.active];
      let fl = 0;
      if (q.downed) fl |= 1;
      if (q.ms.mode === 'slide') fl |= 2;
      if (!q.ms.onGround) fl |= 4;
      if (q.status.phase > 0) fl |= 8;
      if (q.inShip) fl |= 16;
      if (q.ms.mode === 'skydive') fl |= 32;
      if (q.healing) fl |= 64;
      if (q.reloading) fl |= 128;
      if (q.status.stim > 0) fl |= 256;
      if (q.ms.mode === 'mantle') fl |= 512;
      if (q.reviveT > 0) fl |= 1024;
      if (q.ms.events & MEV.JET) fl |= 2048;
      rows.set(q.id, [
        q.id, +q.ms.x.toFixed(2), +q.ms.y.toFixed(2), +q.ms.z.toFixed(2), +q.ms.yaw.toFixed(3), +q.ms.pitch.toFixed(3),
        fl, +q.ms.crouch.toFixed(2), w ? w.id : '', Math.round(q.hp), Math.round(q.shield), q.armor,
        +q.ms.vx.toFixed(1), +q.ms.vz.toFixed(1),
      ]);
    }
    const ents = [];
    for (const e of this.entities.values()) ents.push(e);
    const projs = this.projectiles.filter((p) => p.k !== 'bullet');
    const R = this.ring;
    const ringMsg = {
      cx: +R.cx.toFixed(1), cz: +R.cz.toFixed(1), r: +R.r.toFixed(1), nx: +R.nx.toFixed(1), nz: +R.nz.toFixed(1), nr: R.nr,
      st: R.state, t: +Math.max(0, R.t).toFixed(1), tot: R.total, idx: R.idx, dmg: R.dmg,
    };
    const squadsAlive = this.squads.filter((s) => s.alive).length;
    for (const h of humans) {
      const view = h.alive || !h.spect ? h : this.players.get(h.spect) || h;
      const vx = view.ms.x, vz = view.ms.z;
      const ps = [];
      for (const [id, row] of rows) {
        const q = this.players.get(id);
        const dx = q.ms.x - vx, dz = q.ms.z - vz;
        const near = dx * dx + dz * dz < 420 * 420;
        const rev = q.revealTo && q.revealTo[h.squad] > this.time;
        if (near || q.squad === h.squad || rev || q.inShip) {
          if (rev && q.squad !== h.squad) ps.push(row.concat([1]));
          else ps.push(row);
        }
      }
      const es = [];
      for (const e of ents) {
        const dx = e.x - vx, dz = e.z - vz;
        if (dx * dx + dz * dz < 350 * 350 || e.k === 'carepkg' || (e.k === 'box' && e.squad === h.squad)) es.push(entRow(e, this.time, h));
      }
      for (const p of projs) {
        const dx = p.x - vx, dz = p.z - vz;
        if (dx * dx + dz * dz < 250 * 250) es.push({ id: p.id, k: 'proj', pk: p.k, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) });
      }
      const evs = [];
      for (const ev of this.events) {
        if (ev.ex === h.id) continue;
        if (ev.to) { if (ev.to.includes(h.id) || (ev.e === 'hit' && view.id !== h.id && ev.to.includes(view.id))) evs.push(ev); continue; }
        if (ev.e === 'ping' && ev.sq !== h.squad) continue;
        if (ev.e === 'banner' && ev.sq !== h.squad) continue;
        if (ev.g) { evs.push(ev); continue; }
        const rr = ev.r || ev.rr || 300;
        if ((ev.x - vx) ** 2 + (ev.z - vz) ** 2 < rr * rr) evs.push(ev);
      }
      const sqm = this.squads[h.squad].members.map((id) => {
        const q = this.players.get(id);
        return {
          id, name: q.name, legend: q.legend, hp: Math.round(q.hp), sh: Math.round(q.shield), armor: q.armor,
          down: q.downed, elim: q.eliminated, x: Math.round(q.ms.x), z: Math.round(q.ms.z), bot: q.isBot,
          banner: q.eliminated ? this._bannerState(q) : 0, tac: q.tacCd, ult: q.ultCd,
        };
      });
      const msg = {
        t: 'snap', time: +this.time.toFixed(3), ack: h.ack, me: this._meState(h), ps, es, ev: evs, ring: ringMsg,
        alive: this.alive, squads: squadsAlive, sq: sqm, phase: this.phase,
        ship: this.phase === 'ship' ? { x: +this.ship.x.toFixed(1), z: +this.ship.z.toFixed(1), y: SHIP_ALT, dx: this.ship.dirx, dz: this.ship.dirz } : null,
        hb: h.legend === 'echo' ? this._heartbeat(h) : 0, warn: h.aimedAt > this.time ? 1 : 0,
      };
      if (view !== h) msg.spec = this._meState(view);
      this.send(h.id, msg);
    }
    this.events.length = 0;
  }

  _bannerState(q) {
    for (const e of this.entities.values()) {
      if (e.k === 'box' && e.owner === q.id) {
        if (e.bannerTaken) return 2;
        if (e.bannerUntil > this.time) return 1;
      }
    }
    return 0;
  }

  _heartbeat(h) {
    let best = 99;
    for (const q of this.queryPlayers(h.ms.x, h.ms.z, 40)) {
      if (q.squad === h.squad || !q.alive) continue;
      best = Math.min(best, Math.hypot(q.ms.x - h.ms.x, q.ms.z - h.ms.z));
    }
    return best < 40 ? +best.toFixed(1) : 0;
  }
}

function lootKey(x, z) {
  return Math.floor((x + 800) / 16) * 1000 + Math.floor((z + 800) / 16);
}

function entRow(e, now, h) {
  const r = { id: e.id, k: e.k, x: +e.x.toFixed(2), y: +e.y.toFixed(2), z: +e.z.toFixed(2), t: +(e.dur - e.t).toFixed(1) };
  if (e.r) r.r = e.r;
  if (e.squad !== undefined) r.sq = e.squad;
  if (e.k === 'box') {
    r.name = e.name;
    r.tier = e.tier;
    r.n = e.items.length;
    r.ban = !e.bannerTaken && e.bannerUntil > now ? 1 : 0;
    r.own = e.owner;
  }
  if (e.k === 'portal') { r.x2 = +e.x2.toFixed(2); r.y2 = +e.y2.toFixed(2); r.z2 = +e.z2.toFixed(2); r.open = e.open ? 1 : 0; }
  if (e.k === 'carepkg') { r.landed = e.landed ? 1 : 0; r.lt = +Math.max(0, e.landT).toFixed(2); r.n = e.items.length; }
  if (e.k === 'thunder' || e.k === 'mortar') { r.dx = e.dx; r.dz = e.dz; }
  if (e.k === 'gastrap') r.armed = e.triggered ? 0 : 1;
  return r;
}
