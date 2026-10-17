// Stratagems: call-ins typed as directional codes, thrown as beacons, delivered from the sky
// (docs/GAMEPLAY_PLAN.md §2, data/stratagems.json). Deterministic sim; the client only draws.
//
//  * StratagemComponent (per soldier): the loadout (two for everyone, two by role), cooldowns and
//    uses, and the input. Hold the call-in button and press arrows: a wrong arrow clears the code,
//    a full code puts the beacon in your hand, the fire button throws it, the call-in button again
//    puts it away. Your hands are busy while you type or hold a beacon: the gun, the sword and the
//    abilities don't get those ticks. Humans and bots send the same buttons.
//  * StratagemSystem (per world): beacons in flight stick to whatever they hit (and ride it), then
//    the countdown, then the payload at the beacon:
//      shells, line   rounds walked in from the sky as FieldGuns-style shells: they crater, blow
//                     sandbags away, scorch the ground, show in the incoming list (bots dive for
//                     cover in time, the HUD warns) and hurt everyone in the blast (friendly fire)
//      pod            falls on the beacon and crushes whoever is under it; a supply cache to grab
//                     ammo from (interact), or a sentry that shoots through whoever walks into its line
//      smoke          a screen of clouds across the throw that blocks sight (world.sight) for a while
//
// Events: stratagem:open / close { id }, stratagem:arrow { id, code, ch }, stratagem:error { id },
// stratagem:armed / stowed { id, stratagem }, stratagem:thrown { id, stratagem, beacon },
// stratagem:beacon { beacon, at, eta, team, stratagem, kind }, stratagem:incoming { at, eta, team, kind },
// stratagem:pod / land { beacon, at, contents }, stratagem:grab { id, pod, mags }, stratagem:smoke { at, radius, duration }.

import { Vector3 } from 'three';
import { bus } from '../core/EventBus.js';
import { stripButtons } from '../core/routing.js';

export const ARROWS = { arrowUp: 'U', arrowDown: 'D', arrowLeft: 'L', arrowRight: 'R' };
export const ARROW_KEYS = Object.fromEntries(Object.entries(ARROWS).map(([k, c]) => [c, k]));
/** What the hands can't do while typing a code or holding a beacon. */
const BUSY = ['light', 'heavy', 'guard', 'reload', 'swapWeapon', 'toggleMelee', 'ability1', 'ability2', 'grenade', 'super', 'interact', ...Object.keys(ARROWS)];
const _v = new Vector3(), _d = new Vector3();
let nextBeaconId = 1;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

export class StratagemComponent {
  /**
   * @param {object} owner  the soldier
   * @param {StratagemSystem} system
   * @param {string[]} loadout  stratagem ids (data/stratagems.json)
   */
  constructor(owner, system, loadout) {
    this.owner = owner; this.sys = system;
    this.slots = loadout.filter((id) => system.defs[id]).map((id) => {
      const def = system.defs[id];
      return { id, def, cooldown: 0, uses: def.uses ?? Infinity, rearm: 0 };
    });
    this.state = 'idle';     // idle | typing | armed
    this.code = '';
    this.armed = null;       // the slot whose beacon is in hand
  }

  /** Can this slot be typed now (off cooldown, uses left)? */
  ready(slot) { return slot.cooldown <= 0 && slot.uses > 0; }
  slot(id) { return this.slots.find((s) => s.id === id) ?? null; }

  /** Cooldowns run and spent uses rearm, typing or not. */
  #tick(dt) {
    for (const s of this.slots) {
      if (s.cooldown > 0) s.cooldown = Math.max(0, s.cooldown - dt);
      if (s.rearm > 0) {
        s.rearm = Math.max(0, s.rearm - dt);
        if (s.rearm === 0) { s.uses = s.def.uses; bus.emit('stratagem:rearmed', { id: this.owner.id, stratagem: s.id }); }
      }
    }
  }

  /**
   * Called every tick before the soldier moves and fights. Returns the command for the rest of
   * the tick: unchanged, or with the hands' buttons taken while a code is typed or a beacon held.
   */
  handleInput(cmd, dt) {
    this.#tick(dt);
    const e = this.owner, b = cmd.buttons, key = b.stratagem;
    const s = e.movement.state;
    const able = !e.health.dead && !e.health.downed && !e.vehicle && !e.transform && s.mode !== 'ragdoll' && s.mode !== 'knockdown';
    if (!able) { if (this.state !== 'idle') this.#reset('interrupted'); return cmd; }
    if (this.state === 'armed') {
      if (key?.pressed) { this.#reset('stowed'); return stripButtons(cmd, BUSY); }
      if (b.light?.pressed) this.#throw(cmd);
      return stripButtons(cmd, BUSY);
    }
    if (key?.down) {
      if (this.state !== 'typing') { this.state = 'typing'; this.code = ''; bus.emit('stratagem:open', { id: e.id }); }
      for (const [k, ch] of Object.entries(ARROWS)) if (b[k]?.pressed && this.state === 'typing') this.#arrow(ch);
      return stripButtons(cmd, BUSY);
    }
    if (this.state === 'typing') this.#reset('closed');
    if (b.interact?.pressed && this.sys.grab(e)) return stripButtons(cmd, ['interact']);
    return cmd;
  }

  #arrow(ch) {
    const id = this.owner.id;
    this.code += ch;
    const live = this.slots.filter((s) => this.ready(s) && s.def.code.startsWith(this.code));
    if (!live.length) { bus.emit('stratagem:error', { id, code: this.code }); this.code = ''; return; }
    bus.emit('stratagem:arrow', { id, code: this.code, ch });
    const done = live.find((s) => s.def.code === this.code);
    if (done) {
      this.state = 'armed'; this.armed = done; this.code = '';
      bus.emit('stratagem:armed', { id, stratagem: done.id });
    }
  }

  #throw(cmd) {
    const s = this.armed;
    this.armed = null; this.state = 'idle';
    s.cooldown = s.def.cooldown ?? 0;
    if (s.def.uses) { s.uses--; if (s.uses <= 0) s.rearm = s.def.rearm ?? 60; }
    this.sys.throwBeacon(this.owner, s, cmd.yaw, cmd.pitch);
  }

  #reset(why) {
    const was = this.state, armed = this.armed;
    this.state = 'idle'; this.code = ''; this.armed = null;
    if (was === 'armed') bus.emit('stratagem:stowed', { id: this.owner.id, stratagem: armed?.id, why });
    else if (was === 'typing') bus.emit('stratagem:close', { id: this.owner.id, why });
  }
}

export class StratagemSystem {
  /** @param {object} data  data/stratagems.json */
  constructor(world, data = null) {
    this.world = world;
    this.data = data;
    this.defs = data?.stratagems ?? {};
    this.shells = data?.shells ?? {};
    this.beacons = [];       // thrown and planted
    this.pods = [];          // falling and landed
    this.time = 0;
  }

  /** The loadout for a class role: the common pair, then the role's. */
  loadoutFor(role) {
    if (!this.data) return [];
    return [...(this.data.common ?? []), ...(this.data.loadouts?.[role] ?? this.data.loadouts?.default ?? [])];
  }

  /** A soldier throws a beacon along the look direction (a little lob). */
  throwBeacon(owner, slot, yaw, pitch) {
    const B = this.data.beacon, p = owner.movement.state.position, s = owner.movement.state;
    const up = s.stance === 'prone' ? 0.45 : s.stance === 'crouch' ? 1.15 : 1.55;
    const pt = Math.min(1.2, pitch + B.lift), cp = Math.cos(pt);
    const dir = new Vector3(-Math.sin(yaw) * cp, Math.sin(pt), -Math.cos(yaw) * cp);
    const beacon = {
      id: nextBeaconId++, owner, ownerId: owner.id, team: owner.team, stratagem: slot.id, def: slot.def,
      pos: new Vector3(p.x, p.y + up, p.z).addScaledVector(dir, 0.35), vel: dir.multiplyScalar(B.speed).add(_v.copy(s.velocity).multiplyScalar(0.5)),
      planted: false, on: null, offset: new Vector3(), at: 0, age: 0, plan: null, from: p.clone(), done: false,
    };
    this.beacons.push(beacon);
    bus.emit('stratagem:thrown', { id: owner.id, stratagem: slot.id, beacon: beacon.id, team: owner.team });
    return beacon;
  }

  update(dt) {
    this.time += dt;
    for (const b of this.beacons) this.#beacon(b, dt);
    if (this.beacons.some((b) => b.done)) this.beacons = this.beacons.filter((b) => !b.done);
    for (const p of this.pods) this.#pod(p, dt);
    if (this.pods.some((p) => p.done)) this.pods = this.pods.filter((p) => !p.done);
  }

  // ---------------------------------------------------------------- beacons
  #beacon(b, dt) {
    const w = this.world, B = this.data.beacon;
    b.age += dt;
    if (!b.planted) {
      // Flight: gravity, then a ray along this tick's path; it sticks to the first thing it meets.
      b.vel.y -= B.gravity * dt;
      _d.copy(b.vel).multiplyScalar(dt);
      const len = _d.length();
      const hit = len > 1e-6 ? w.raycast(b.pos, _v.copy(_d).divideScalar(len), len, b.ownerId, { team: b.team }) : null;
      if (hit) this.#plant(b, hit.point, hit.entity);
      else {
        b.pos.add(_d);
        const g = w.groundHeight?.(b.pos) ?? 0;
        if (b.pos.y < g) { b.pos.y = g; this.#plant(b, b.pos, null); }
        if (b.age > B.life) b.done = true;
      }
      return;
    }
    // Riding a soldier or a vehicle: the beacon (and the strike) follows it.
    if (b.on && !b.on.removed && !b.on.health?.dead) b.pos.copy(b.on.movement.state.position).add(b.offset);
    const t = this.time - b.at;
    for (const shot of b.plan) {
      if (shot.fired || t < shot.t) continue;
      shot.fired = true;
      this.#deliver(b, shot);
    }
    if (b.plan.every((s) => s.fired) && t > (b.def.delay ?? 0) + 0.5) b.done = true;
  }

  #plant(b, point, entity) {
    b.planted = true; b.at = this.time; b.pos.copy(point);
    if (entity && !entity.isDeployable) { b.on = entity; b.offset.subVectors(point, entity.movement.state.position); }
    b.plan = this.#plan(b);
    const eta = b.def.delay ?? 0;
    bus.emit('stratagem:beacon', { beacon: b.id, at: b.pos.toArray(), eta, team: b.team, stratagem: b.stratagem, kind: b.def.kind, ownerId: b.ownerId, radius: this.#radius(b.def) });
    // Strikes go on the incoming list where they'll land: the bots (either side) dive for cover,
    // the HUD and audio warn. (Riding beacons warn at the planting spot.)
    const incoming = this.world.vehicles?.guns?.incoming;
    for (const shot of b.plan) {
      if (!shot.round) continue;
      const land = this.time + shot.t + shot.fall;
      incoming?.push({ x: shot.x, y: shot.y, z: shot.z, at: land, radius: shot.round.damage?.splash ?? 0, team: b.team, kind: 'strike', gun: null });
    }
  }

  /** The payload's danger radius (for HUD rings and the bots' danger-close checks). */
  #radius(def) {
    const P = def.payload, sh = this.shells[P.shell];
    if (P.kind === 'shells') return (P.spread ?? 0) + (sh?.damage?.splash ?? 0);
    if (P.kind === 'line') return (P.across ? P.length / 2 : P.length) + (sh?.damage?.splash ?? 0);
    if (P.kind === 'pod') return P.crush ?? 1.5;
    return P.length / 2;
  }
  radiusOf(id) { return this.defs[id] ? this.#radius(this.defs[id]) : 0; }

  /**
   * Where and when each part of the payload arrives (seeded per beacon, so replays agree):
   * [{ t (s after planting the shot leaves the sky), fall (s in the air), x, y, z, round? }].
   */
  #plan(b) {
    const P = b.def.payload, delay = b.def.delay ?? 0, w = this.world;
    const rand = rng(b.id * 2654435761 + b.ownerId * 97);
    const out = [];
    const ground = (x, z) => w.groundHeight?.(_v.set(x, 0, z)) ?? 0;
    if (P.kind === 'shells' || P.kind === 'line') {
      const round = this.shells[P.shell];
      const fall = (P.height ?? 250) / (P.speed ?? 250);
      // The throw's direction on the ground: a strafing run flies along it, bombs fall across it.
      _d.set(b.pos.x - b.from.x, 0, b.pos.z - b.from.z);
      if (_d.lengthSq() < 1e-4) _d.set(-Math.sin(b.owner.movement.state.yaw), 0, -Math.cos(b.owner.movement.state.yaw));
      _d.normalize();
      const ax = P.across ? -_d.z : _d.x, az = P.across ? _d.x : _d.z;
      for (let i = 0; i < P.count; i++) {
        let x, z;
        if (P.kind === 'shells') {
          const r = (P.spread ?? 0) * Math.sqrt(rand()), a = rand() * Math.PI * 2;
          x = b.pos.x + Math.cos(a) * r; z = b.pos.z + Math.sin(a) * r;
        } else {
          // A run along the throw starts just short of the beacon and flies on away from you;
          // a stick of bombs across it is centred on the beacon.
          const k = P.count > 1 ? i / (P.count - 1) : 0, u = P.across ? k - 0.5 : k - 0.08;
          x = b.pos.x + ax * u * P.length + (rand() - 0.5) * 0.8; z = b.pos.z + az * u * P.length + (rand() - 0.5) * 0.8;
        }
        const t = delay - fall + (P.count > 1 ? (P.over ?? 0) * (P.kind === 'line' ? i : rand()) / (P.kind === 'line' ? P.count - 1 : 1) : 0);
        out.push({ t: Math.max(0, t), fall, x, y: ground(x, z), z, round, dir: P.kind === 'line' ? [ax, az] : null, fired: false });
      }
    } else if (P.kind === 'pod') {
      const fall = 1.3;
      out.push({ t: Math.max(0, delay - fall), fall, x: b.pos.x, y: b.pos.y, z: b.pos.z, pod: true, fired: false });
    } else if (P.kind === 'smoke') {
      // A screen across the throw, centred on the beacon.
      _d.set(b.pos.x - b.from.x, 0, b.pos.z - b.from.z);
      if (_d.lengthSq() < 1e-4) _d.set(1, 0, 0);
      _d.normalize();
      for (let i = 0; i < P.count; i++) {
        const u = P.count > 1 ? i / (P.count - 1) - 0.5 : 0, x = b.pos.x - _d.z * u * P.length, z = b.pos.z + _d.x * u * P.length;
        out.push({ t: delay + i * 0.08, fall: 0, x, y: ground(x, z), z, smoke: true, fired: false });
      }
    }
    return out;
  }

  /** One part of a payload arrives (or leaves the sky, for rounds). */
  #deliver(b, shot) {
    const w = this.world, P = b.def.payload;
    if (shot.round) {
      // From above (a line comes in from behind its run, low and fast): straight at the point.
      const h = P.height ?? 250, back = shot.dir ? 45 : 18;
      const ox = shot.x - (shot.dir ? shot.dir[0] : 0.4) * back, oz = shot.z - (shot.dir ? shot.dir[1] : 0.25) * back;
      const origin = new Vector3(ox, shot.y + h, oz);
      const dir = new Vector3(shot.x - ox, shot.y - origin.y, shot.z - oz);
      const dist = dir.length();
      dir.divideScalar(dist);
      w.spawnProjectile({
        weapon: shot.round, origin, dir, speed: dist / shot.fall, gravity: 0, maxAge: shot.fall + 4, highFly: true,
        ownerId: b.ownerId, team: b.team, damageMul: 1, splash: shot.round.damage?.splash ?? 0, deflectable: false, onHit: null,
      });
      bus.emit('stratagem:incoming', { at: [shot.x, shot.y, shot.z], eta: shot.fall, team: b.team, kind: b.def.kind, from: origin.toArray() });
    } else if (shot.pod) {
      const pod = { id: b.id, beacon: b, owner: b.owner, team: b.team, def: b.def, pos: new Vector3(shot.x, shot.y + 140, shot.z), ground: shot.y, vy: -140 / shot.fall, landed: false, grabs: P.grabs ?? 0, age: 0, done: false, contents: P.contents };
      this.pods.push(pod);
      bus.emit('stratagem:pod', { beacon: b.id, at: [shot.x, shot.y, shot.z], eta: shot.fall, team: b.team, contents: P.contents });
    } else if (shot.smoke) {
      w.spawnZone?.({
        kind: 'smoke', ability: b.stratagem, ownerId: b.ownerId, team: b.team, center: new Vector3(shot.x, shot.y, shot.z),
        radius: P.radius, lifetime: P.duration, blocksVision: true, smokeHeight: P.height ?? 7,
      });
      bus.emit('stratagem:smoke', { at: [shot.x, shot.y, shot.z], radius: P.radius, duration: P.duration, team: b.team });
    }
  }

  // ---------------------------------------------------------------- pods
  #pod(p, dt) {
    p.age += dt;
    if (!p.landed) {
      p.pos.y += p.vy * dt;
      if (p.pos.y > p.ground) return;
      p.pos.y = p.ground; p.landed = true; p.age = 0;
      this.#crush(p);
      if (p.contents === 'sentry') {
        const T = p.def.payload.turret;
        this.world.spawnDeployable?.({
          kind: 'turret', ability: p.beacon.stratagem, ownerId: p.owner.id, team: p.team, at: p.pos.clone(), yaw: p.owner.movement.state.yaw,
          hp: T.hp, dps: T.dps, range: T.range, turnRate: T.turnRate, lifetime: T.life, maxPerOwner: 3,
        });
        p.done = true;
      }
      bus.emit('stratagem:land', { beacon: p.id, at: p.pos.toArray(), contents: p.contents, team: p.team });
      return;
    }
    // A supply cache: bots short of ammo help themselves as they pass (people press interact).
    if (p.contents === 'supply') {
      if (p.age > (p.def.payload.life ?? 90) || p.grabs <= 0) { p.done = true; bus.emit('stratagem:podGone', { beacon: p.id }); return; }
      this.world.fightersNear(p.pos, 2.4, (e) => { if (e.brain && e.team === p.team && lowOnAmmo(e)) this.#grabFrom(e, p); });
    }
  }

  /** Landing on someone: whoever is under the pod is crushed, friend or foe (friendly fire). */
  #crush(p) {
    const w = this.world, r = p.def.payload.crush ?? 1.5;
    const under = [];
    w.fightersNear(p.pos, r + 1, (e) => {
      if (e.health.dead || e.vehicle) return;
      const q = e.movement.state.position;
      if (Math.hypot(q.x - p.pos.x, q.z - p.pos.z) <= r && Math.abs(q.y - p.pos.y) < 2.5) under.push(e);
    });
    for (const e of under) {
      const share = w.harm ? w.harm(p.team, e, 'explosion') : e.team === p.team ? 0 : 1;
      if (share > 0) e.health.damage(1500 * share, { kind: 'explosion', weapon: 'pod', ammoType: 'explosive', friendly: e.team === p.team, noDown: true }, p.owner);
    }
    w.cutWire?.(p.pos, 1.5);
  }

  /** A soldier at a supply cache takes his share (interact; bots as they pass). True if he took any. */
  grab(e) {
    for (const p of this.pods) {
      if (!p.landed || p.contents !== 'supply' || p.grabs <= 0) continue;
      const q = e.movement.state.position;
      if (Math.hypot(q.x - p.pos.x, q.z - p.pos.z) > 2.4) continue;
      return this.#grabFrom(e, p);
    }
    return false;
  }

  #grabFrom(e, p) {
    const got = e.weapons?.resupply?.(p.def.payload.mags ?? 2) ?? 0;
    if (!(got > 0)) return false;
    p.grabs--;
    bus.emit('stratagem:grab', { id: e.id, pod: p.id, mags: got, left: p.grabs });
    return true;
  }

  // ---------------------------------------------------------------- for the bots and the HUD
  /** Live beacons of a team (or all): { id, pos, stratagem, kind, eta, radius, team }. */
  live(team = null) {
    const out = [];
    for (const b of this.beacons) {
      if (!b.planted || (team !== null && b.team !== team)) continue;
      out.push({ id: b.id, pos: b.pos, stratagem: b.stratagem, kind: b.def.kind, eta: Math.max(0, (b.def.delay ?? 0) - (this.time - b.at)), radius: this.#radius(b.def), team: b.team });
    }
    return out;
  }
}

/** Below a third of a full load of ammo (bots help themselves at supply caches). */
function lowOnAmmo(e) {
  const w = e.weapons?.current;
  if (!w || w.usesHeat || w.usesBattery) return false;
  const full = (w.s.mag ?? 30) + (w.s.reserve ?? 180);
  return w.mag + w.reserve < full / 3;
}
