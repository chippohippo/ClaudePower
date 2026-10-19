// BodyContacts: soldiers are solid to each other (docs/MOVEMENT.md, "Bodies"). Every tick, after
// everyone has moved, each body's shape is its stance's (data/movement.json `bodies`):
//  * on his feet, a round body as wide as his armor (heavies are broader); crouched, a little wider
//    (knees out) and lower; lying (prone, sliding on the belly, diving, downed, knocked flat, a
//    corpse), a capsule from his feet to his head along the way he's lying, a hand's breadth high.
//  * Two bodies that overlap are pushed apart, each by its share (the heavier and the braced move
//    less: crouched, prone, at cover, down), through the world (a push never goes into a wall), and
//    the speed one carried into the other is taken off both, so you slide along a man instead of
//    through him: shoulder to shoulder, crouch to crouch, prone side by side.
//  * Walking into someone lying down isn't a wall: you step over (or round) him, slower while
//    you're over him (the legs lift: the rig reads `overBody`), nudged off to the side he's
//    nearer; crawling into someone's legs stops you.
//  * Coming together fast (a sprint into a man) is a bump: `body:bump`, and the one who took it
//    stumbles with it if it was hard enough (the movement's stagger); the one who gave it only
//    loses his speed, unless he ran into a man a good deal heavier than he is.
//  * Pressed into a teammate who isn't moving, for a moment: you turn your shoulders and squeeze
//    past (`squeeze`, for a second or two, a much thinner body between the two of you), so a
//    trench or a doorway never jams for good. Enemies don't squeeze past each other.
//  * Each body's `press` (which way and how hard it's pushing into another, smoothed) is for the
//    rig (a hand out, a lean) and the AI (a teammate pressing into you: make way).
// Deterministic: the same order (the session's), the same arithmetic, no randomness.

import { bus } from '../core/EventBus.js';
import { bodyAxisYaw } from './Hitboxes.js';
import { CIVILIAN } from '../combat/Teams.js';

const CELL = 2;    // m: the contact grid (bodies are at most ~1.9 m long)

/** Closest points between segments p1-q1 and p2-q2 in the ground plane (Ericson). Writes { s, t, x1, z1, x2, z2, d2 } into `out`. */
export function closestSegSeg(p1x, p1z, q1x, q1z, p2x, p2z, q2x, q2z, out) {
  const d1x = q1x - p1x, d1z = q1z - p1z, d2x = q2x - p2x, d2z = q2z - p2z, rx = p1x - p2x, rz = p1z - p2z;
  const a = d1x * d1x + d1z * d1z, e = d2x * d2x + d2z * d2z, f = d2x * rx + d2z * rz;
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) { s = 0; t = 0; }
  else if (a <= 1e-9) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = d1x * rx + d1z * rz;
    if (e <= 1e-9) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = d1x * d2x + d1z * d2z, den = a * e - b * b;
      s = den > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  out.s = s; out.t = t;
  out.x1 = p1x + d1x * s; out.z1 = p1z + d1z * s;
  out.x2 = p2x + d2x * t; out.z2 = p2z + d2z * t;
  const dx = out.x1 - out.x2, dz = out.z1 - out.z2;
  out.d2 = dx * dx + dz * dz;
  return out;
}

const _c = { s: 0, t: 0, x1: 0, z1: 0, x2: 0, z2: 0, d2: 0 };

/**
 * One body this tick. `lie`: lying (a capsule along `yaw`, `head` m ahead of the root and `feet`
 * behind); else upright (a circle). `kind`: 'up' (on his feet or crouched), 'low' (lying, alive),
 * 'dead'. `inv`: 1 / mass (0: doesn't move: a corpse).
 */
function record(id, team, x, y, z, yaw, lie, B, r, h, mass, kind, vx, vz, ref) {
  let ax = x, az = z, bx = x, bz = z;
  if (lie) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    ax = x + fx * B.lying.head; az = z + fz * B.lying.head;
    bx = x - fx * B.lying.feet; bz = z - fz * B.lying.feet;
  }
  return { id, team, ax, az, bx, bz, r, y0: y - 0.1, y1: y + h, inv: mass > 0 ? 1 / mass : 0, kind, vx, vz, dx: 0, dz: 0, ref, press: 0, px: 0, pz: 0 };
}

export class BodyContacts {
  /** @param {object} B data/movement.json `bodies` */
  constructor(B) {
    this.B = B;
    this.touching = new Set();   // pair keys in contact last tick (bumps are on the first touch)
    this.lastBump = new Map();   // fighter id -> time of its last bump
    this.grid = new Map();
    this.list = [];
    this.stamp = []; this.qn = 0;   // (steer's query marks)
    this.time = 0;
    this.stats = { bodies: 0, pairs: 0, contacts: 0, bumps: 0, ms: 0 };
  }

  /** The body a fighter has right now (or null: in a vehicle, off the field, a limp body flying, climbing). */
  shapeOf(f) {
    const B = this.B, m = f.movement, s = m?.state;
    if (!s || !m.nudge || f.offField || f.vehicle || f.isVehicle || f.isDeployable || f.removed) return null;   // (soldiers only: not turrets, vehicles' proxies)
    const mode = s.mode, p = s.position;
    const armor = m.armor ?? 'medium';
    const vx = s.velocity.x, vz = s.velocity.z;
    if (f.health?.dead) return null;   // (the dead are corpses: the session's corpses())
    // (In the air he's still a body: a hop doesn't carry you through a man, only over what's low.)
    if (mode === 'vehicle' || mode === 'mantle' || mode === 'wallrun' || mode === 'ragdoll') return null;
    const down = !!f.health?.downed || s.downed;
    const lying = down || s.stance === 'prone' || mode === 'dive' || (mode === 'slide' && s.slide?.kind === 'belly') || (mode === 'knockdown' && s.knock?.phase !== 'getup');
    if (lying) {
      const mass = (B.mass[armor] ?? B.mass.medium) * (down ? B.massMul.downed : B.massMul.prone);
      // Head to feet along the way he's lying (on his back, the head's behind where he faces).
      return record(f.id, f.team, p.x, p.y, p.z, bodyAxisYaw(f), true, B, B.lying.radius, B.height.low, mass, 'low', vx, vz, f);
    }
    const crouched = s.stance === 'crouch' || mode === 'slide' || mode === 'roll' || (mode === 'cover' && !s.cover?.high);
    const r = (B.radius[armor] ?? B.radius.medium) + (crouched ? B.crouchExtra : 0);
    let mass = B.mass[armor] ?? B.mass.medium;
    if (crouched) mass *= B.massMul.crouch;
    if (mode === 'cover') mass *= B.massMul.cover;
    // Not trying to go anywhere, he stands his ground: you push past him, not him down the trench.
    const planted = (s.wishMag ?? 0) < 0.15 && (mode === 'ground' || mode === 'cover');
    const b = record(f.id, f.team, p.x, p.y, p.z, s.bodyYaw, false, B, r, crouched ? B.height.crouch : B.height.up, planted ? mass * B.massMul.planted : mass, 'up', vx, vz, f);
    b.planted = planted; b.inv0 = 1 / mass;   // (a body check knocks a man standing still about all the same)
    return b;
  }

  /**
   * One tick, after everyone has moved. `fighters`: the session's, in its order; `corpses`: the
   * dead lying still ({ id, ax, az, bx, bz, y }: head to feet); `push(f, dx, dz)`: moves a fighter
   * through the world (never into a wall).
   */
  step(fighters, corpses, dt, push) {
    const t0 = performance.now?.() ?? 0;
    const B = this.B;
    this.time += dt;
    const list = this.list; list.length = 0;
    for (const f of fighters) { const b = this.shapeOf(f); if (b) list.push(b); }
    for (const c of corpses) {
      // A corpse lies as it fell: head to feet.
      const b = record(-1 - (c.id ?? 0), -1, c.ax, c.y, c.az, 0, false, B, B.lying.radius * 0.9, B.height.dead, 0, 'dead', 0, 0, null);
      b.bx = c.bx; b.bz = c.bz;
      list.push(b);
    }
    // The grid: every body in each cell its capsule touches.
    // Only the cells somebody is in this tick (a big map's thousands of empty ones aren't walked).
    const grid = this.grid, active = this.active ?? (this.active = []);
    for (const cell of active) cell.length = 0;
    active.length = 0;
    if (grid.size > 4096) grid.clear();   // (a battle that's moved on: forget the old ground)
    for (let i = 0; i < list.length; i++) {
      const b = list[i], r = b.r;
      const x0 = Math.floor((Math.min(b.ax, b.bx) - r) / CELL), x1 = Math.floor((Math.max(b.ax, b.bx) + r) / CELL);
      const z0 = Math.floor((Math.min(b.az, b.bz) - r) / CELL), z1 = Math.floor((Math.max(b.az, b.bz) + r) / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const k = (cx + 32768) * 65536 + (cz + 32768);
        let cell = grid.get(k);
        if (!cell) grid.set(k, (cell = []));
        if (cell.length === 0) active.push(cell);
        if (cell[cell.length - 1] !== i) cell.push(i);
      }
    }
    const touching = new Set();
    let pairs = 0, contacts = 0;
    this.bumps = 0;
    const seen = this.seen ?? (this.seen = new Set());
    // Two passes: a crowd settles in a couple of ticks rather than one man at a time.
    for (let pass = 0; pass < 2; pass++) {
      seen.clear();
      for (const cell of active) {
        if (cell.length < 2) continue;
        for (let u = 0; u < cell.length; u++) for (let w = u + 1; w < cell.length; w++) {
          const i = cell[u], j = cell[w];
          const key = i * 65536 + j;
          if (seen.has(key)) continue;
          seen.add(key);
          pairs++;
          const A = list[i], C = list[j];
          if (A.kind === 'dead' && C.kind === 'dead') continue;
          if (A.y1 < C.y0 || C.y1 < A.y0) continue;   // (one above the other: a balcony, a floor up)
          // Kneeling over a man to revive (or finish) him is meant to be close: they don't push.
          if (A.ref && C.ref && (A.ref.reviveJob?.patient === C.ref || C.ref.reviveJob?.patient === A.ref)) continue;
          if (this.#pair(A, C, pass, touching, dt)) contacts++;
        }
      }
    }
    // Apply each body's push through the world; record how hard each was pressing, for the rig and the AI.
    for (const b of list) {
      const f = b.ref;
      if (!f) continue;
      const s = f.movement.state;
      if (Math.abs(b.dx) + Math.abs(b.dz) > 5e-4) push(f, b.dx, b.dz);   // (under half a millimetre: not worth a trip through the world)
      const k = 1 - Math.exp(-dt * 10);
      const press = s.press ?? (s.press = { x: 0, z: 0, k: 0, by: null });
      if (b.press > 0) { const l = Math.hypot(b.px, b.pz) || 1; press.x += (b.px / l - press.x) * k; press.z += (b.pz / l - press.z) * k; }
      press.k += ((b.press > 0 ? Math.min(1, b.press) : 0) - press.k) * k;
      press.by = b.pressBy ?? null;
      if (b.pushedBy != null) s.pressedBy = { id: b.pushedBy, x: b.pushX, z: b.pushZ, v: b.pushV, at: this.time };
      s.overBody = b.over ? B.stepOver.hold : Math.max(0, (s.overBody ?? 0) - dt);
      s.squeeze = Math.max(0, (s.squeeze ?? 0) - dt);
      // Pressed into a teammate who isn't going anywhere: after a moment, squeeze past him.
      if (b.blockedBy != null) {
        s.blocked = (s.blocked ?? 0) + dt;
        if (s.blocked >= B.squeeze.after && !s.squeeze) { s.squeeze = B.squeeze.time; s.blocked = 0; bus.emit('body:squeeze', { id: f.id, by: b.blockedBy }); }
      } else s.blocked = Math.max(0, (s.blocked ?? 0) - dt * 2);
    }
    this.touching = touching;
    this.stats = { bodies: list.length, pairs, contacts, bumps: this.bumps, ms: (performance.now?.() ?? 0) - t0 };
  }

  /**
   * Which way to go round the bodies ahead (the bots: CombatBotBrain), from last tick's: `f` going
   * (dx, dz) (unit); `out` = that, or turned off toward a side. Round a man standing in the way or
   * coming at you (an even split: to the right, as he'll do too), round someone lying on the ground;
   * not round a man going your way as fast as you (you're following him), one of the enemy's on
   * his feet (you're fighting him: up to a bayonet's or a blade's reach and into him), or `ignore`
   * (the one you're walking up to: a man to revive or finish).
   */
  steer(f, dx, dz, out, ignore = null) {
    out.x = dx; out.z = dz; out.slow = 1;
    const list = this.list, B = this.B, s = f.movement.state, p = s.position;
    if (!list.length) return out;
    const myR = (B.radius[f.movement.armor] ?? B.radius.medium) + (s.stance === 'crouch' ? B.crouchExtra : 0);
    const look = Math.min(3.4, 1 + Math.max(1.5, s.speed) * 0.4);   // (2.6 m at a jog)
    const rx = -dz, rz = dx;   // (right of the way he's going)
    const q = ++this.qn, st = this.stamp;
    let acc = 0;
    const c0x = Math.floor((p.x - look - 1) / CELL), c1x = Math.floor((p.x + look + 1) / CELL);
    const c0z = Math.floor((p.z - look - 1) / CELL), c1z = Math.floor((p.z + look + 1) / CELL);
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      const cell = this.grid.get((cx + 32768) * 65536 + (cz + 32768));
      if (!cell || !cell.length) continue;
      for (const i of cell) {
        if (st[i] === q) continue;
        st[i] = q;
        const b = list[i];
        if (b.ref === f || (ignore && b.ref === ignore)) continue;
        if (b.kind === 'up' && b.team !== f.team && b.team !== CIVILIAN) continue;
        if (b.y1 < p.y - 0.1 || b.y0 > p.y + 1.7) continue;   // (a floor up or down)
        // The nearest point of its spine, ahead of us or to the side.
        const ex = b.bx - b.ax, ez = b.bz - b.az, ll = ex * ex + ez * ez;
        let t = ll > 1e-6 ? ((p.x - b.ax) * ex + (p.z - b.az) * ez) / ll : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ox = b.ax + ex * t - p.x, oz = b.az + ez * t - p.z;
        const ahead = ox * dx + oz * dz, lat = ox * rx + oz * rz;
        const reach = myR + b.r + (b.kind === 'up' ? 0.15 : 0.1);
        if (ahead < -0.1 || ahead > look || Math.abs(lat) >= reach) continue;
        let away = 0;
        if (b.ref) { const v = b.ref.movement.state.velocity; away = v.x * dx + v.z * dz; if (away > Math.max(1.2, s.speed * 0.75)) continue; }
        const w = (1 - Math.max(0, ahead) / look) * (1 - Math.abs(lat) / reach);
        acc += (lat > 0.05 ? -1 : 1) * w;   // (it's on our right: go left; on our left or dead ahead: go right)
        // Square in the way and close, a man up (not someone to step over): ease off and don't run into him.
        if (b.kind === 'up' && Math.abs(lat) < reach * 0.7) out.slow = Math.min(out.slow, Math.max(0.3, (ahead - reach * 0.6) / 1.4 + Math.max(0, away) / 4.5));
      }
    }
    if (acc === 0) return out;
    const ang = Math.max(-1.25, Math.min(1.25, acc * 1.5)), c = Math.cos(ang), sn = Math.sin(ang);   // (out.slow: how much of the speed to keep)
    out.x = dx * c + rx * sn; out.z = dz * c + rz * sn;
    return out;
  }

  /** Every body of last tick's whose cells touch the rectangle (each once), lying ones only if `lying`. */
  #each(x0, z0, x1, z1, lying, fn) {
    const list = this.list, q = ++this.qn, st = this.stamp;
    for (let cx = Math.floor(Math.min(x0, x1) / CELL) - 1, cx1 = Math.floor(Math.max(x0, x1) / CELL) + 1; cx <= cx1; cx++) {
      for (let cz = Math.floor(Math.min(z0, z1) / CELL) - 1, cz1 = Math.floor(Math.max(z0, z1) / CELL) + 1; cz <= cz1; cz++) {
        const cell = this.grid.get((cx + 32768) * 65536 + (cz + 32768));
        if (!cell) continue;
        for (const i of cell) {
          if (st[i] === q) continue;
          st[i] = q;
          const b = list[i];
          if (!lying || b.kind !== 'up') fn(b);
        }
      }
    }
  }

  /**
   * The rig's foot about to land at `p` (a Vector3, changed in place) on someone lying there: on
   * past him along the way it's going (dx, dz), or short of him, whichever's nearer. `self`: the
   * walker's id (not his own body); `also`: one more to leave out (the man he's kneeling over).
   */
  offBody(p, dx, dz, self, also = null) {
    this.#each(p.x - 1, p.z - 1, p.x + 1, p.z + 1, true, (b) => {
      if (b.id === self || b.id === also) return;
      closestSegSeg(b.ax, b.az, b.bx, b.bz, p.x, p.z, p.x, p.z, _c);
      const r = b.r + 0.07;
      if (_c.d2 >= r * r) return;
      // Across the spine along the way of travel: to the far side if we're past it, else the near.
      const ex = b.bx - b.ax, ez = b.bz - b.az, l = Math.hypot(ex, ez) || 1;
      let nx = -ez / l, nz = ex / l;
      if (nx * dx + nz * dz < 0) { nx = -nx; nz = -nz; }
      const side = (p.x - _c.x1) * nx + (p.z - _c.z1) * nz;   // (+: already past the spine)
      const to = side >= 0 ? r : -r;
      p.x += nx * (to - side); p.z += nz * (to - side);
    });
    return p;
  }

  /** How high a foot has to lift to clear a body lying across its swing (x0, z0) to (x1, z1) (0: none). */
  lyingAcross(x0, z0, x1, z1, self, also = null) {
    let h = 0;
    this.#each(x0, z0, x1, z1, true, (b) => {
      if (b.id === self || b.id === also) return;
      closestSegSeg(b.ax, b.az, b.bx, b.bz, x0, z0, x1, z1, _c);
      if (_c.d2 < (b.r + 0.05) ** 2) h = Math.max(h, b.kind === 'dead' ? 0.3 : 0.36);
    });
    return h;
  }

  /** Two bodies: apart if they overlap. True if they touched. */
  #pair(A, C, pass, touching, dt) {
    const B = this.B;
    closestSegSeg(A.ax + A.dx, A.az + A.dz, A.bx + A.dx, A.bz + A.dz, C.ax + C.dx, C.az + C.dz, C.bx + C.dx, C.bz + C.dz, _c);
    const sameTeam = A.team === C.team && A.team >= 0;
    let reach = A.r + C.r;
    const squeezing = sameTeam && ((A.ref?.movement.state.squeeze ?? 0) > 0 || (C.ref?.movement.state.squeeze ?? 0) > 0);
    if (squeezing) reach *= B.squeeze.radiusMul;
    if (_c.d2 >= reach * reach) return false;
    const d = Math.sqrt(_c.d2);
    let nx, nz;   // from C to A
    if (d > 1e-5) { nx = (_c.x1 - _c.x2) / d; nz = (_c.z1 - _c.z2) / d; }
    else {
      // Exactly on top of each other (two men spawned on one spot): apart along a direction their ids pick.
      const a = ((A.id * 2654435761 + C.id * 40503) % 6283) / 1000;
      nx = Math.cos(a); nz = Math.sin(a);
    }
    const pen = reach - d;
    const key = Math.min(A.id, C.id) * 100003 + Math.max(A.id, C.id);
    touching.add(key);
    if (squeezing) {
      // Squeezing past: shoulders turned, each eases to his own side (sideways to the way the one
      // squeezing is going), nobody's shoved along the trench.
      const sq = (A.ref?.movement.state.squeeze ?? 0) > 0 ? A : C, v = sq.ref.movement.state.velocity, l = Math.hypot(v.x, v.z);
      if (l > 0.2) {
        let sx = -v.z / l, sz = v.x / l;   // (the squeezer's left)
        let side = (A.ax - C.ax) * sx + (A.az - C.az) * sz;   // A to C's left (+) or right
        if (Math.abs(side) < 1e-3) side = A.id < C.id ? 1 : -1;
        if (side < 0) { sx = -sx; sz = -sz; }
        const wa = A.inv, wc = C.inv, sum = wa + wc || 1, m = pen * 0.5;
        A.dx += sx * m * (2 * wa / sum); A.dz += sz * m * (2 * wa / sum);
        C.dx -= sx * m * (2 * wc / sum); C.dz -= sz * m * (2 * wc / sum);
      }
      return true;
    }
    // Who gives way, and how.
    let wa = A.inv, wc = C.inv;
    let soft = false;
    if (A.kind === 'dead' || C.kind === 'dead') { soft = true; if (A.kind === 'dead') wa = 0; else wc = 0; }
    else if (A.kind !== C.kind) {
      // On his feet against someone lying down: the walker steps over him (soft), unless it's the
      // one lying down who's crawling into the walker's legs (that stops him).
      const low = A.kind === 'low' ? A : C, up = low === A ? C : A;
      const tx = up === A ? nx : -nx, tz = up === A ? nz : -nz;   // (from the one lying to the one standing)
      const crawlingIn = low.vx * tx + low.vz * tz > 0.15;
      if (crawlingIn) { if (up === A) wa = 0; else wc = 0; }
      else { soft = true; if (low === A) wa = 0; else wc = 0; }
    }
    const sum = wa + wc;
    if (sum <= 0) return true;
    if (soft) {
      // Stepping over someone lying there: not pushed back, only off to the side you're nearer
      // (walking across him you go straight over; walking along him you're eased off him).
      const walker = wa > 0 ? A : C, sgn = walker === A ? 1 : -1;
      const v = walker.ref?.movement.state.velocity, l = v ? Math.hypot(v.x, v.z) : 0;
      let ex = sgn * nx, ez = sgn * nz;
      if (l > 0.3) { const ux = v.x / l, uz = v.z / l, d = ex * ux + ez * uz; ex -= d * ux; ez -= d * uz; }
      const m = pen * B.stepOver.nudge;
      walker.dx += ex * m; walker.dz += ez * m;
      if (pass === 0) walker.over = true;
      return true;
    }
    const ma = (wa / sum) * pen, mc = (wc / sum) * pen;
    A.dx += nx * ma; A.dz += nz * ma;
    C.dx -= nx * mc; C.dz -= nz * mc;
    if (pass > 0) return true;
    // Once a tick (the first pass): pressing, blocked, the speed into each other, a bump.
    const va = A.ref?.movement.state.velocity, vc = C.ref?.movement.state.velocity;
    const rvx = (va?.x ?? 0) - (vc?.x ?? 0), rvz = (va?.z ?? 0) - (vc?.z ?? 0);
    const vn = -(rvx * nx + rvz * nz);   // closing speed (> 0: coming together)
    // Who's pushing into whom (for the rig's hand and the AI's making way).
    const into = (b, sx, sz, other) => {
      const v = -(b.vx * sx + b.vz * sz);
      if (v > 0.2) {
        b.press += v / 4; b.px -= sx; b.pz -= sz; b.pressBy = other.id;
        if (v > (other.pushV ?? 0)) { other.pushedBy = b.id; other.pushX = -sx; other.pushZ = -sz; other.pushV = v; }   // (the other side: who's pushing into him, which way)
      }
      // Pressed against a teammate who's standing his ground: count it (squeeze past soon).
      if (sameTeam && v > 0.4 && other.kind === 'up' && (other.planted || Math.hypot(other.vx, other.vz) < 0.6)) b.blockedBy = other.id;
    };
    into(A, nx, nz, C); into(C, -nx, -nz, A);
    if (vn > 0) {
      // Who ran into whom: the one carrying more speed toward the other.
      const towardA = va ? -(va.x * nx + va.z * nz) : 0, towardC = vc ? vc.x * nx + vc.z * nz : 0;
      // The speed into each other is taken off both, by share (an inelastic bump): slide along, not
      // through. Over a few ticks rather than one (bodies give a little), so the stop isn't a jolt.
      const j = (vn / sum) * 0.55;
      const ref = (b, s) => { const m = b.ref?.movement.state; if (m) { m.velocity.x += nx * j * s; m.velocity.z += nz * j * s; } };
      ref(A, wa); ref(C, -wc);
      // A bump: the first touch, fast.
      const fresh = !this.touching.has(key);
      if (fresh && vn >= B.bump.speed) { const ia = A.inv0 ?? A.inv, ic = C.inv0 ?? C.inv; this.#bump(A, C, nx, nz, vn, ia / (ia + ic), ic / (ia + ic), towardA >= towardC ? A.id : C.id); }
    }
    return true;
  }

  /** Coming together fast: the event, and a stumble for whoever took more of it than he can stand. */
  #bump(A, C, nx, nz, vn, shareA, shareC, by) {
    const B = this.B, t = this.time;
    const cool = (b) => b.ref && t - (this.lastBump.get(b.id) ?? -9) >= B.bump.cooldown;
    if (!cool(A) && !cool(C)) return;
    this.bumps++;
    if (A.ref) this.lastBump.set(A.id, t);
    if (C.ref) this.lastBump.set(C.id, t);
    // Each is shoved by the share of the closing speed the other side carried in. The one who ran
    // in saw it coming: he only stumbles off a man a good deal heavier than he is.
    const hit = (b, sx, sz, share) => {
      const m = b.ref?.movement;
      if (!m || b.kind !== 'up' || m.state.mode === 'stagger') return;   // (already stumbling: a bump doesn't put him over)
      if (b.id === by && share < 0.6) return;
      const v = vn * share;
      if (v >= B.bump.stumble) m.stagger(sx, sz, v * B.bump.shove, { dur: Math.min(0.6, 0.25 + v * 0.05) });
    };
    hit(A, nx, nz, shareA);
    hit(C, -nx, -nz, shareC);
    const mx = (A.ax + C.ax) / 2, mz = (A.az + C.az) / 2;
    bus.emit('body:bump', { a: A.id, b: C.id, by, speed: vn, x: mx, z: mz, dir: [nx, nz], friendly: A.team === C.team });
  }
}
