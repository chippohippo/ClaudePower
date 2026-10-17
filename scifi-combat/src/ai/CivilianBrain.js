// CivilianBrain: a civilian in a city at war (Neutrals). He wants to live through it. Produces
// the same Command a player's input does, so he moves, crouches and shoots through the same
// systems as everyone else.
//  * Calm (before the fighting reaches him): at his shelter, looking about; one out in the
//    street or at a market goes about between a few spots near it (civ.haunt), walking.
//  * Alarmed (shots or a blast heard, an armed stranger near): gets down where he is if that's
//    indoors; out in the open, runs for the safest shelter he knows (away from the trouble, near,
//    indoors if he can: a house's rooms, a ruin, behind a market stall) and gets down there.
//  * In danger (hurt, an armed stranger in sight and close, rounds or a blast right by him): runs,
//    at a sprint along a nav route, to a shelter away from it; not twice in a few seconds. A
//    group holds its shelter together (only hurt does one run).
//  * Hiding: stays down, hands over his head (e.cower: the rig's pose), flat under fire; back on
//    his feet when it has been quiet a while.
//  * Brave, after the fighting has come near and with nothing close: goes for a gun lying near
//    (WeaponDrops) and takes it. Never armed any other way.
//  * Armed: shoots from where he hides at whoever he's fighting (Teams.civilianFights: an armed
//    stranger close, or someone whose side hurt him or his people), badly, in bursts; while he
//    does, that side fights him back.
//  * Down: crawls away from the trouble.

import { Vector3 } from 'three';
import { emptyCommand } from '../input/InputManager.js';
import { Buttons } from './CombatBotBrain.js';
import { CIVILIAN, ENGAGED } from '../combat/Teams.js';

const PERCEIVE = 0.35;          // s between looks round

export class CivilianBrain {
  /**
   * @param {object} self      the civilian (Neutrals: e.civ { foes, engaged, defend, brave, group, home, haunt, hitFrom })
   * @param {CombatWorld} world
   * @param {Neutrals} people  (the shelters, what's been heard, the guns lying about)
   */
  constructor(self, world, people, { seed = 1 } = {}) {
    this.self = self; this.world = world; this.people = people;
    let s = (seed * 2246822519) >>> 0 || 7;
    this.rand = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s % 1e6) / 1e6; };
    this.btn = new Buttons();
    this.time = 0; this.lookT = this.rand() * PERCEIVE;
    this.state = 'calm';
    this.shelter = self.civ.home;
    this.path = null;
    this.calmT = 999;           // s since the last trouble (none yet)
    this.alarmed = false;       // has the fighting come near him yet?
    this.threat = null;         // { x, z } the trouble he's getting away from
    this.target = null;         // whom he's shooting at (armed)
    this.fledAt = -99;
    this.yaw = self.movement.state.yaw; this.idleT = 0;
    this.goT = 4 + this.rand() * 10;   // calm: s until he goes to another spot
    this.burst = 0; this.pause = 0;
    this.stuck = { t: 0, x: 0, z: 0, n: 0, climb: 0 };
  }

  dispose() {}

  think(dt, tick) {
    this.time += dt;
    const cmd = emptyCommand();
    cmd.tick = tick;
    const self = this.self, ms = self.movement.state, me = ms.position, C = this.people.C;
    if (self.health.dead) { self.cower = false; this.btn.finalize(cmd); return cmd; }
    cmd.yaw = this.yaw; cmd.pitch = 0;

    // ---- look round now and then: what's close, what's been heard, a gun lying near
    if ((this.lookT -= dt) <= 0) {
      this.lookT = PERCEIVE * (0.8 + this.rand() * 0.4);
      this.#perceive(C);
    }
    this.calmT += dt;
    self.cower = false;

    if (self.health.downed) { this.#crawl(cmd, dt); this.btn.finalize(cmd); return cmd; }

    // ---- armed and in a fight: shoot back from here
    if (self.weapons.current && this.target) {
      this.#shoot(cmd, dt);
      this.#stance(ms, 'crouch');
      this.btn.finalize(cmd);
      return cmd;
    }

    // ---- the state's own business
    if (this.state === 'flee') {
      if (this.#follow(cmd, dt, true)) { this.state = 'hide'; this.path = null; }
    } else if (this.state === 'fetch') {
      const d = this.gun && this.world.drops?.list.includes(this.gun) ? this.gun : null;
      if (!d) { this.state = 'hide'; this.path = null; this.gun = null; }
      else if (Math.hypot(d.pos.x - me.x, d.pos.z - me.z) < 1.2) {
        if (this.world.drops.take(self, d)) this.world.barks?.say(self, 'armed');
        this.state = 'hide'; this.path = null; this.gun = null;
      } else if (this.#follow(cmd, dt, false)) { this.path = null; this.#route(d.pos.x, d.pos.z); }
    } else if (this.state === 'hide') {
      // Down where he is: low while it's been close lately, flat under fire, hands over his head.
      const low = this.calmT < 25;
      this.#stance(ms, low ? (this.underFire ? 'prone' : 'crouch') : 'stand');
      self.cower = low && !self.weapons.current;
      if (this.calmT > 40) this.state = 'calm';
      this.#idleLook(cmd, dt, low ? 0.6 : 2.4);
      this.#keepTo(cmd, dt, this.shelter);
    } else {
      // Calm: stand about; one with spots to go to walks between them now and then.
      this.#stance(ms, 'stand');
      const H = self.civ.haunt;
      if (H?.length && !this.alarmed && (this.goT -= dt) <= 0) {
        this.goT = 8 + this.rand() * 14;
        this.spot = H[Math.floor(this.rand() * H.length)];
        this.#route(this.spot.x, this.spot.z);
      }
      if (this.path) { if (this.#follow(cmd, dt, false)) this.path = null; }
      else { this.#idleLook(cmd, dt, 2.4); if (!this.spot) this.#keepTo(cmd, dt, this.shelter); }
    }
    this.btn.finalize(cmd);
    return cmd;
  }

  // ---------------------------------------------------------------- perception
  #perceive(C) {
    const self = this.self, me = self.movement.state.position, w = this.world, civ = self.civ;
    // Who's close and armed (not his own people), and whom he'd shoot (armed, in sight).
    let near = null, nd = C.see ?? 28, foe = null, fd = Infinity;
    w.fightersNear(me, nd, (e) => {
      if (e === self || e.team === CIVILIAN || e.health?.dead || e.isDeployable) return;
      const armed = e.isVehicle || !!e.weapons?.current;
      if (!armed) return;
      const q = e.movement.state.position, d = Math.hypot(q.x - me.x, q.z - me.z);
      if (Math.abs(q.y - me.y) > 6) return;
      if (d < nd) { nd = d; near = e; }
      if (self.weapons.current && w.hostile(self, e) && d < fd && this.#sees(e)) { fd = d; foe = e; }
    });
    this.target = foe;
    const heard = this.people.heard(me, C.hear ?? 45, 4);
    const hurt = self.health.sinceDamage < 2.5;
    const hd = heard ? heard.d : Infinity, loud = heard?.loud ?? 0;
    // How bad it is: danger (run), alarm (get down, or get inside), nothing.
    const seen = near && nd < (C.panic ?? 10) && this.#sees(near);
    const danger = hurt || seen || hd < 5 + loud * 4;
    const alarm = danger || (near && nd < 20) || !!heard;
    this.underFire = hurt || hd < 12;
    const src = hurt ? civ.hitFrom ?? me : seen || (near && nd < 20) ? near.movement.state.position : heard;
    if (alarm && src) { this.calmT = 0; this.threat = { x: src.x, z: src.z }; this.alarmed = true; this.spot = null; }
    if (foe) { this.calmT = 0; this.threat = { x: foe.movement.state.position.x, z: foe.movement.state.position.z }; this.state = 'hide'; this.path = null; return; }
    const sh = this.shelter, atShelter = sh && Math.hypot(sh.x - me.x, sh.z - me.z) < 2.5;
    // A group holds its shelter together: only the hurt one runs.
    const holds = civ.group && atShelter && !hurt;
    if (this.state === 'calm' && alarm) {
      if (danger && !holds) this.#flee();
      else if (atShelter && (sh.indoor || civ.group)) { this.state = 'hide'; this.path = null; }
      else this.#flee();
    } else if (this.state === 'hide' && danger && !holds && this.time - this.fledAt > 6) this.#flee();
    else if (this.state === 'flee' && danger && this.time - this.fledAt > 3 && this.path && this.threat) {
      // Running into it: the trouble's nearer where he's going than he is. Pick again.
      const g = this.path.goal;
      if (Math.hypot(g.x - this.threat.x, g.z - this.threat.z) < Math.hypot(me.x - this.threat.x, me.z - this.threat.z)) this.#flee();
    } else if (this.state === 'fetch' && danger) this.#flee();
    // Brave, the fighting near (but nothing close), unarmed: a gun lying near?
    if (!self.weapons.current && civ.brave && this.alarmed && !danger && this.state === 'hide' && (!near || nd > 18)) {
      const d = w.drops?.nearest(me, C.fetch ?? 20);
      if (d && (!this.threat || Math.hypot(d.pos.x - this.threat.x, d.pos.z - this.threat.z) > 12)) { this.gun = d; this.state = 'fetch'; this.#route(d.pos.x, d.pos.z); }
    }
  }

  #sees(e) {
    const me = this.self.movement.state.position, q = e.movement.state.position;
    const from = { x: me.x, y: me.y + 1.5, z: me.z }, dx = q.x - from.x, dy = q.y + 1.1 - from.y, dz = q.z - from.z, l = Math.hypot(dx, dy, dz);
    if (l < 0.5) return true;
    return !this.world.sight?.(_v.set(from.x, from.y, from.z), _u.set(dx / l, dy / l, dz / l), l - 0.4);
  }

  // ---------------------------------------------------------------- running and hiding
  /** Pick the safest shelter he can get to (away from the trouble, not far, indoors best) and run. */
  #flee() {
    const me = this.self.movement.state.position, t = this.threat ?? me;
    let best = null, bs = -Infinity;
    for (const q of this.people.shelters) {
      const d = Math.hypot(q.x - me.x, q.z - me.z);
      if (d > 90) continue;
      const away = Math.hypot(q.x - t.x, q.z - t.z);
      if (away < 14) continue;
      // Running toward the trouble to get there is no good.
      const toward = ((q.x - me.x) * (t.x - me.x) + (q.z - me.z) * (t.z - me.z)) / Math.max(1, d * Math.hypot(t.x - me.x, t.z - me.z));
      const s = Math.min(away, 60) * 1.2 - d * 0.8 - toward * 25 + (q.indoor ? 18 : 0) + (q === this.shelter ? -6 : 0) + this.rand() * 4;
      if (s > bs) { bs = s; best = q; }
    }
    if (!best) { this.state = 'hide'; return; }
    this.shelter = best;
    this.state = 'flee'; this.fledAt = this.time;
    this.#route(best.x, best.z);
    this.world.barks?.say(this.self, 'scared');
  }

  #route(x, z, n = 0) {
    const me = this.self.movement.state.position, nav = this.world.nav;
    const r = nav?.path ? nav.path(me.x, me.z, x, z, { maxExpand: 2500 }) : null;
    this.path = { pts: r?.pts?.length ? r.pts : [x, z], i: 0, goal: { x, z } };
    this.stuck = { t: 0, x: me.x, z: me.z, n, climb: 0 };
  }

  /** Walk (or run) the route; true when at its end. */
  #follow(cmd, dt, run) {
    const P = this.path, me = this.self.movement.state.position;
    if (!P) return true;
    while (P.i < P.pts.length - 2 && Math.hypot(P.pts[P.i] - me.x, P.pts[P.i + 1] - me.z) < 0.7) P.i += 2;
    const tx = P.pts[P.i], tz = P.pts[P.i + 1], d = Math.hypot(tx - me.x, tz - me.z);
    if (P.i >= P.pts.length - 2 && d < 0.8) return true;
    this.yaw = Math.atan2(-(tx - me.x), -(tz - me.z));
    cmd.yaw = this.yaw; cmd.moveY = run || d > 0.4 ? 1 : d / 0.4;
    if (run) this.btn.hold('sprint');
    this.#stance(this.self.movement.state, 'stand');
    // Not getting anywhere: a hop, then a climb over (holding jump), then a fresh route; nearly
    // there, that'll do; still stuck after all that, he stops where he is.
    const S = this.stuck;
    S.t += dt;
    if (S.climb > 0) { S.climb -= dt; this.btn.hold('jump'); }
    if (S.t > 1.5) {
      if (Math.hypot(me.x - S.x, me.z - S.z) < 0.5) {
        S.n++;
        const left = Math.hypot(P.goal.x - me.x, P.goal.z - me.z);
        if (S.n >= 5 || (S.n >= 3 && left < 3.5)) return true;
        if (S.n === 1) this.btn.press('jump');
        else if (S.n === 2) S.climb = 0.7;
        else this.#route(P.goal.x, P.goal.z, S.n);
      } else S.n = 0;
      S.t = 0; S.x = me.x; S.z = me.z;
    }
    return false;
  }

  /** Back to a spot if he's drifted off it (pushed, stepped aside). */
  #keepTo(cmd, dt, h) {
    const me = this.self.movement.state.position;
    if (!h || Math.hypot(h.x - me.x, h.z - me.z) < 1.5) return;
    if (!this.path) this.#route(h.x, h.z);
    if (this.#follow(cmd, dt, false)) this.path = null;
  }

  /** Looking about: a turn of the head and shoulders every few seconds (quicker when scared). */
  #idleLook(cmd, dt, every) {
    if ((this.idleT -= dt) <= 0) {
      this.idleT = every * (0.6 + this.rand() * 1.2);
      // Scared, he keeps an eye toward the trouble.
      const t = this.threat, me = this.self.movement.state.position;
      this.yaw = t && this.calmT < 25 && this.rand() < 0.6 ? Math.atan2(-(t.x - me.x), -(t.z - me.z)) + (this.rand() - 0.5) * 0.8 : this.yaw + (this.rand() - 0.5) * 2.4;
    }
    cmd.yaw = this.yaw;
  }

  #crawl(cmd) {
    const me = this.self.movement.state.position, t = this.threat;
    if (!t) return;
    this.yaw = Math.atan2(-(me.x - t.x), -(me.z - t.z));     // away from it
    cmd.yaw = this.yaw; cmd.moveY = 1;
  }

  #stance(ms, want) {
    if (ms.mode !== 'ground' || ms.stanceT || ms.crouchPress) return;
    const cur = ms.stance;
    if (cur === want) return;
    if (want === 'prone') { this.btn.press('prone'); return; }
    if (cur === 'prone') { this.btn.press(want === 'stand' ? 'jump' : 'crouch'); return; }
    if (this.btn.down.has('sprint')) return;
    this.btn.press('crouch');
  }

  // ---------------------------------------------------------------- shooting (armed)
  #shoot(cmd, dt) {
    const self = this.self, w = self.weapons.current, me = self.movement.state.position, t = this.target;
    const q = t.movement.state.position, dx = q.x - me.x, dz = q.z - me.z, h = Math.hypot(dx, dz);
    // Untrained: the aim wanders.
    const err = 0.06 + 0.04 * Math.sin(this.time * 2.3 + self.id);
    this.yaw = Math.atan2(-dx, -dz) + (this.rand() - 0.5) * err;
    cmd.yaw = this.yaw;
    cmd.pitch = Math.atan2(q.y + (t.isVehicle ? 1 : 1.1) - (me.y + 1.45), Math.max(0.5, h)) + (this.rand() - 0.5) * err;
    if (w.mag <= 0 && !w.usesHeat) { this.btn.press('reload'); return; }
    // Bursts: a second or so on the trigger, a breath off it.
    if (this.pause > 0) { this.pause -= dt; return; }
    this.btn.hold('light');
    this.burst += dt;
    if (this.burst > 0.5 + this.rand() * 0.8) { this.burst = 0; this.pause = 0.5 + this.rand() * 0.9; }
    // While he fires, that side fights him back.
    self.civ.engaged[t.team] = this.world.time + ENGAGED;
  }
}

const _v = new Vector3(), _u = new Vector3();
