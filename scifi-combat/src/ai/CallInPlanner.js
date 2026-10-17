// CallInPlanner: a bot's stratagems (docs/GAMEPLAY_PLAN.md §2): when to call one in, where to
// throw it, and the typing, with the same buttons a player presses at a quick hand's pace.
//
// When (each a reason a person would call it in, each careful of its own side):
//  * Strikes: a cluster of enemies it can see (data `bots.cluster`: 3+, a vehicle counting 3; 4+
//    for a barrage) caught in the payload's footprint (Stratagems.footprint: a barrage's circle,
//    a run walked through the cluster from its near side, a stick of bombs across it), within a
//    throw, with no teammate within `clear` m of that footprint (downed ones included: they
//    can't move) and the thrower `selfClear` m outside it. Never on a cluster another of our
//    strikes is already coming down on. With the beacon in hand it follows the cluster (from
//    where it last saw it, one enemy fewer will do) and puts the beacon away only if the cluster
//    is gone or one of ours has walked into the danger.
//  * Supply drop: its ammo below a third of a full load, no supply pod or beacon of ours within
//    40 m, no enemy close. Thrown 7 m off to a side that's clear of teammates (a pod crushes).
//    A bot short of ammo walks to one of our landed pods within 30 m and takes its mags.
//  * Smoke: crossing open ground (a move, a bound, a charge, over the top) under fire, with the
//    enemy in sight 20-80 m ahead: a screen thrown up to 40% of the way, across the line of fire.
//  * Sentry: holding (man, hold, overwatch) with an enemy in sight 15-45 m out: dropped beside
//    it and a step back, on nobody.
//  * Battle points (data `bots.buy`): a strike that's cooling down is bought again only by a bot
//    that keeps `reserve` points after paying; a vehicle is dropped beside a bot that likes them,
//    on foot with its objective more than `far` m off, no fight close and no ride of ours near
//    (the tank if it can keep its reserve, else the recon vehicle; the pilot boards it); the hero
//    is bought in a fight.
// How often: each soldier has its own cooldowns and uses (data), and each side spends call-ins
// from a budget that grows with its size (StratagemSystem.spendBot), so a 4v4 sees a few and a
// 200v200 front lights up without every bot calling everything at once.
// Typing: hold the call-in, an arrow every `arrowTime` (+ up to 40%), then the beacon in hand:
// aim the lob (the beacon's lift and our own drift taken out, the bot's aim error put in) and
// throw a moment later. Rushed by an enemy at close range, it lets go or puts the beacon away;
// a strike's cluster gone by the time the beacon is in hand, it puts it away.

import { CIVILIAN } from '../combat/Teams.js';
import { Vector3 } from 'three';
import { ARROW_KEYS, capsuleDist, lowOnAmmo } from '../combat/Stratagems.js';
import { ballisticPitch } from './AbilityPlanner.js';
import { hyp } from '../core/geom.js';

const STRIKE = new Set(['strike']);
const MOVING = new Set(['move', 'bound', 'charge', 'assault', 'regroup']);
const HOLDING = new Set(['man', 'hold', 'overwatch']);
const P = new Vector3(), _o = new Vector3(), _d = new Vector3();

export class CallInPlanner {
  /** @param {object} brain  the CombatBotBrain (its self, world, buttons, aim override, clock, dice) */
  constructor(brain) {
    this.b = brain;
    this.job = null;        // { slot, kind, at: {x,y,z}, step: 'type' | 'aim', i, next, throwAt }
    this.nextLook = 0;      // when to consider a call-in again
  }

  get busy() { return !!this.job; }

  /** Each think, last (after the gun and the moves): start a call-in, or carry one on. */
  update(ctx) {
    const b = this.b, self = b.self, S = self.stratagems, sys = b.world.stratagems;
    if (!S || !sys?.data || self.vehicle || self.health.downed || self.health.dead || b.duty) { this.job = null; return; }
    if (this.job) { this.#work(ctx); return; }
    if (S.state !== 'idle' || b.time < this.nextLook) return;
    this.nextLook = b.time + 0.5 + b.rand() * 0.5;
    if (ctx.target && ctx.los && ctx.dist < 12) return;                  // rushed: nothing but the gun
    const plan = this.#supply(ctx) ?? this.#strike(ctx) ?? this.#hero(ctx) ?? this.#sentry(ctx) ?? this.#smoke(ctx) ?? this.#vehicle(ctx);
    if (!plan || !sys.spendBot(self.team, plan.kind)) return;
    this.job = { ...plan, step: 'type', i: 0, next: b.time + 0.15 + b.rand() * 0.15, throwAt: 0 };
    b.log.push([b.time.toFixed(2), 'callin', plan.slot.id]);
  }

  // ---------------------------------------------------------------- the typing and the throw
  #work(ctx) {
    const b = this.b, S = b.self.stratagems, J = this.job, A = b.world.stratagems.data.arrowTime ?? 0.16;
    if (ctx.target && ctx.los && ctx.dist < 9) { this.#abort(); return; }
    if (J.step === 'type') {
      if (S.state === 'armed') { J.step = 'aim'; J.throwAt = b.time + 0.22 + b.rand() * 0.15; }
      else if (S.state === 'idle' && J.i > 0) { this.job = null; return; }   // a wrong arrow, or knocked over: start again later
      else if (J.i >= J.slot.def.code.length && J.slot.def.payload.kind === 'instant') { this.job = null; return; }   // done as the code went in: let go
      else {
        b.btn.hold('stratagem');
        if (b.time >= J.next && J.i < J.slot.def.code.length) {
          b.btn.press(ARROW_KEYS[J.slot.def.code[J.i]]);
          J.i++; J.next = b.time + A * (1 + b.rand() * 0.4);
        }
        return;
      }
    }
    if (S.state !== 'armed') { this.job = null; return; }
    // A strike follows its cluster while the beacon is in hand; if it's gone, the beacon goes away.
    if (STRIKE.has(J.kind)) {
      const again = this.#strike(ctx, J);
      if (!again) { b.btn.press('stratagem'); this.job = null; this.nextLook = b.time + 2; return; }
      J.at = again.at; J.center = again.center;
    }
    b.btn.down.delete('light');                                            // the trigger finger is on the beacon
    const aim = this.#lob(J.at);
    b.aimOverride = { yaw: aim.yaw, pitch: aim.pitch, until: b.time + 0.15 };
    if (b.time >= J.throwAt) {
      b.btn.press('light');
      b.log.push([b.time.toFixed(2), 'throw', J.slot.id]);
      this.job = null;
      this.nextLook = b.time + 1.5;
    }
  }

  #abort() {
    const b = this.b, S = b.self.stratagems;
    if (S.state === 'armed') b.btn.press('stratagem');                    // put it away (costs nothing)
    this.job = null;                                                       // typing: letting go closes it
    this.nextLook = b.time + 3;
  }

  /** The lob that lands the beacon at `at`: the beacon's lift taken out, our drift and aim error put in. */
  #lob(at) {
    const b = this.b, s = b.self.movement.state, me = s.position, B = b.world.stratagems.data.beacon;
    const up = s.stance === 'prone' ? 0.45 : s.stance === 'crouch' ? 1.15 : 1.55;
    let tx = at.x, tz = at.z, th = 0;
    for (let k = 0; k < 2; k++) {                                          // half our velocity rides along with the beacon
      const d = Math.max(1, hyp(tx - me.x, tz - me.z));
      th = ballisticPitch(d, at.y - (me.y + up), B.speed, B.gravity);
      const tf = d / (B.speed * Math.cos(th));
      tx = at.x - s.velocity.x * 0.5 * tf; tz = at.z - s.velocity.z * 0.5 * tf;
    }
    const err = ((b.diff.aimError ?? 1.8) * Math.PI) / 180;
    J_ERR.y = (b.rand() - 0.5) * 2 * err; J_ERR.p = (b.rand() - 0.5) * err;
    return { yaw: Math.atan2(-(tx - me.x), -(tz - me.z)) + J_ERR.y, pitch: Math.min(1.0, th - B.lift + J_ERR.p) };
  }

  // ---------------------------------------------------------------- decisions
  /**
   * The best ready strike on a cluster it can see, or null. With `keep` (the job, beacon in hand),
   * re-plan that one round the cluster as last seen, content with one enemy fewer.
   */
  #strike(ctx, keep = null) {
    const b = this.b, self = b.self, S = self.stratagems, sys = b.world.stratagems, B = sys.data.bots ?? {};
    if (!keep && (!ctx.target || !ctx.los || ctx.target.e.health.downed || ctx.target.isObject)) return null;
    const me = self.movement.state.position, maxThrow = B.maxThrow ?? 40;
    let best = null;
    for (const slot of keep ? [keep.slot] : S.slots) {
      if (slot.def.kind !== 'strike' || (!keep && !this.#can(slot))) continue;
      const need = Math.max(2, (B.cluster?.[slot.id] ?? 3) - (keep ? 1 : 0));
      // The cluster round the target we can see (or where we last saw it), and its centre.
      const c = this.#cluster(keep?.center ?? ctx.target.pos, slot.def.payload.kind === 'shells' ? Math.max(6, slot.def.payload.spread * 0.8) : 9);
      if (c.n < need) continue;
      // A run is walked through the cluster from its near side; everything else lands on its centre.
      const P = slot.def.payload;
      let ax = c.x, az = c.z;
      if (P.kind === 'line' && !P.across) { const l = hyp(c.x - me.x, c.z - me.z) || 1; ax -= ((c.x - me.x) / l) * 6; az -= ((c.z - me.z) / l) * 6; }
      const d = hyp(ax - me.x, az - me.z);
      if (d > maxThrow || d < 6) continue;
      const at = { x: ax, y: b.world.groundHeight?.(posOf(ax, az)) ?? c.y, z: az };
      const zone = sys.footprint(slot.def, at, me);
      // What it would catch, and who of ours.
      const caught = this.#count(zone, 1);
      if (caught < need) continue;
      // In hand, 3 m of slack: a teammate drifting along the edge doesn't flip the decision.
      if (capsuleDist(zone, me.x, me.z) < (B.selfClear ?? 5) || !this.#clearOfFriends(zone, (B.clear ?? 15) - (keep ? 3 : 0))) continue;
      if (sys.live(self.team).some((x) => x.kind === 'strike' && capsuleDist(x.zone, c.x, c.z) < 0)) continue;   // already coming down on them
      const score = caught - (slot.def.cooldown ?? 0) * 0.002;
      if (!best || score > best.score) best = { slot, kind: 'strike', at, center: { x: c.x, y: c.y, z: c.z }, score };
    }
    return best;
  }

  /** In a fight with the hero to spare: the super, charged now (the ability planner takes it from there). */
  #hero(ctx) {
    const b = this.b, S = b.self.stratagems;
    const slot = S.slots.find((x) => x.def.kind === 'hero');
    if (!slot || !ctx.target || !ctx.los || ctx.dist > 40 || ctx.target.isObject || !this.#can(slot)) return null;
    return { slot, kind: 'hero', at: null };
  }

  /** On foot, far from where it's going, nothing close: a vehicle dropped beside it. */
  #vehicle(ctx) {
    const b = this.b, self = b.self, S = self.stratagems, w = b.world, buy = w.stratagems.data.bots?.buy ?? {};
    if (b.persona.usesVehicles === 'never' || self.transform || ctx.vehicleNearby || ctx.enemiesNear > 0 || (ctx.target && ctx.los && ctx.dist < 40)) return null;
    const goal = b.objective?.pos ?? b.order?.pos, me = self.movement.state.position;
    if (!goal || hyp(goal.x - me.x, goal.z - me.z) < (buy.far ?? 120)) return null;
    if (w.vehicles.list.some((v) => v.calledBy === self.id && !v.removed)) return null;
    if (w.stratagems.beacons.some((x) => x.ownerId === self.id && x.def.kind === 'vehicle')) return null;
    const slots = S.slots.filter((x) => x.def.kind === 'vehicle' && this.#can(x)).sort((x, y) => y.def.bp - x.def.bp);
    for (const slot of slots) {
      const at = this.#spot(8, [Math.PI / 2, -Math.PI / 2, Math.PI], (slot.def.payload.crush ?? 2) + 1.5);
      if (at) return { slot, kind: 'vehicle', at };
    }
    return null;
  }

  /** Ready, or worth paying battle points for: the bot keeps `reserve` after paying. */
  #can(slot) {
    const S = this.b.self.stratagems;
    if (S.ready(slot)) return true;
    if (!S.callable(slot)) return false;
    const bp = this.b.world.bp?.points(this.b.self) ?? 0;
    return bp - S.price(slot) >= (this.b.world.stratagems.data.bots?.buy?.reserve ?? 400);
  }

  /** Low on ammo, nothing of ours to resupply from near: a supply drop off to the side. */
  #supply(ctx) {
    const b = this.b, self = b.self, S = self.stratagems, sys = b.world.stratagems;
    const slot = S.slot('supply_drop');
    if (!slot || !S.ready(slot) || !lowOnAmmo(self) || ctx.enemiesNear > 0 || (ctx.target && ctx.los && ctx.dist < 20)) return null;
    const me = self.movement.state.position;
    if (sys.pods.some((p) => p.team === self.team && p.contents === 'supply' && hyp(p.pos.x - me.x, p.pos.z - me.z) < 40)) return null;
    if (sys.beacons.some((x) => x.team === self.team && x.def.kind === 'supply' && hyp(x.pos.x - me.x, x.pos.z - me.z) < 40)) return null;
    const at = this.#spot(7, [Math.PI / 2, -Math.PI / 2, Math.PI, 0.6, -0.6]);
    return at ? { slot, kind: 'supply', at } : null;
  }

  /** Holding a position with the enemy in sight out there: a sentry beside us. */
  #sentry(ctx) {
    const b = this.b, S = b.self.stratagems, o = b.order;
    const slot = S.slot('sentry');
    if (!slot || !S.ready(slot) || !o || !HOLDING.has(o.kind) || !ctx.target || !ctx.los || ctx.dist < 15 || ctx.dist > 45) return null;
    if (b.world.deployables.list.some((d) => d.ownerId === b.self.id && d.kind === 'turret' && !d.removed)) return null;
    const at = this.#spot(4, [Math.PI / 2 + 0.35, -Math.PI / 2 - 0.35, Math.PI]);
    return at ? { slot, kind: 'sentry', at } : null;
  }

  /** Crossing open ground under fire with the enemy ahead: a screen across the line of fire. */
  #smoke(ctx) {
    const b = this.b, self = b.self, S = self.stratagems, o = b.order;
    const slot = S.slot('smoke_screen');
    if (!slot || !S.ready(slot) || !o || !(MOVING.has(o.kind) || o.overTop) || !ctx.target || !ctx.los || ctx.dist < 20 || ctx.dist > 80) return null;
    if (!ctx.underFire && (self.suppression ?? 0) < 0.4) return null;
    const me = self.movement.state.position, t = ctx.target.pos, k = Math.min(b.world.stratagems.data.bots?.maxThrow ?? 40, ctx.dist * 0.4) / ctx.dist;
    const x = me.x + (t.x - me.x) * k, z = me.z + (t.z - me.z) * k;
    if (b.world.zones.zones.some((zn) => zn.blocksVision && hyp(zn.center.x - x, zn.center.z - z) < 15)) return null;
    if (b.world.stratagems.beacons.some((x2) => x2.team === self.team && x2.def.kind === 'smoke' && hyp(x2.pos.x - x, x2.pos.z - z) < 20)) return null;
    return { slot, kind: 'smoke', at: { x, y: b.world.groundHeight?.(posOf(x, z)) ?? me.y, z } };
  }

  /** One of our landed supply pods within 30 m to fetch ammo from, when short of it and not in a close fight. */
  podToFetch(ctx) {
    const b = this.b, self = b.self, sys = b.world.stratagems;
    if (!sys?.pods.length || self.vehicle || !lowOnAmmo(self) || (ctx.target && ctx.los && ctx.dist < 20)) return null;
    const me = self.movement.state.position;
    let best = null, bd = 30;
    for (const p of sys.pods) {
      if (!p.landed || p.team !== self.team || p.contents !== 'supply' || p.grabs <= 0) continue;
      const d = hyp(p.pos.x - me.x, p.pos.z - me.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // ---------------------------------------------------------------- helpers
  /** Enemies standing within `r` of p (a vehicle counts 3): their count and centre. */
  #cluster(p, r) {
    const self = this.b.self;
    let n = 0, sx = 0, sy = 0, sz = 0, w = 0;
    this.b.world.fightersNear(p, r, (e) => {
      if (!this.b.world.hostile(self, e) || e.health.dead || e.health.downed || e.isDeployable) return;
      const q = e.movement.state.position;
      if (hyp(q.x - p.x, q.z - p.z) > r) return;
      const k = e.isVehicle ? 3 : 1;
      n += k; w += k; sx += q.x * k; sy += q.y * k; sz += q.z * k;
    });
    return w ? { n, x: sx / w, y: sy / w, z: sz / w } : { n: 0, x: p.x, y: p.y, z: p.z };
  }

  /** Enemies standing inside a footprint (a vehicle counts 3), with `pad` m to spare. */
  #count(zone, pad) {
    const self = this.b.self, L = hyp(zone.bx - zone.ax, zone.bz - zone.az);
    let n = 0;
    this.b.world.fightersNear(posOf((zone.ax + zone.bx) / 2, (zone.az + zone.bz) / 2), zone.r + pad + L / 2, (e) => {
      if (!this.b.world.hostile(self, e) || e.health.dead || e.health.downed || e.isDeployable) return;
      const q = e.movement.state.position;
      if (capsuleDist(zone, q.x, q.z) < pad) n += e.isVehicle ? 3 : 1;
    });
    return n;
  }

  /** No teammate (but the thrower, checked apart) within `clear` m of the footprint. */
  #clearOfFriends(zone, clear) {
    const self = this.b.self, L = hyp(zone.bx - zone.ax, zone.bz - zone.az);
    let ok = true;
    this.b.world.fightersNear(posOf((zone.ax + zone.bx) / 2, (zone.az + zone.bz) / 2), zone.r + clear + L / 2, (e) => {
      if (!ok || e === self || !(e.team === self.team || (e.team === CIVILIAN && !this.b.world.hostile(self, e))) || e.health.dead || e.isDeployable) return;   // (nor a civilian under it)
      const q = e.movement.state.position;
      if (capsuleDist(zone, q.x, q.z) < clear) ok = false;
    });
    return ok;
  }

  /**
   * A spot `d` m away at one of `turns` (radians off our facing) with no teammate within `clear` m
   * of it and that the beacon can be thrown to (no wall in the way), or null.
   */
  #spot(d, turns, clear = 3.5) {
    const b = this.b, self = b.self, s = self.movement.state, me = s.position, w = b.world;
    for (const t of turns) {
      const yaw = s.yaw + t, x = me.x - Math.sin(yaw) * d, z = me.z - Math.cos(yaw) * d;
      let taken = false;                                                     // a pod crushes: nobody of ours on or near the spot
      w.fightersNear(posOf(x, z), clear + 1, (e) => { if (!taken && e !== self && (e.team === self.team || e.team === CIVILIAN) && !e.health.dead && hyp(e.movement.state.position.x - x, e.movement.state.position.z - z) < clear) taken = true; });
      if (taken) continue;
      const y = w.groundHeight?.(posOf(x, z)) ?? me.y;
      _o.set(me.x, me.y + 1.5, me.z); _d.set(x - me.x, y + 0.5 - _o.y, z - me.z);
      const l = _d.length();
      if (w.sight?.(_o, _d.divideScalar(l), l - 0.5)) continue;
      return { x, y, z };
    }
    return null;
  }
}

const J_ERR = { y: 0, p: 0 };
/** A scratch point for the spatial queries (they read x, y, z). */
function posOf(x, z) { P.x = x; P.y = 0; P.z = z; return P; }
