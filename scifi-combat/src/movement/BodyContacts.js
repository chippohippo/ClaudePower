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
//    stumbles with it if it was hard enough (the movement's stagger), the one who gave it is
//    checked; a lighter man running into a heavier one comes off worse.
//  * Pressed into a teammate who isn't moving, for a moment: you turn your shoulders and squeeze
//    past (`squeeze`, for a second or two, a much thinner body between the two of you), so a
//    trench or a doorway never jams for good. Enemies don't squeeze past each other.
//  * Each body's `press` (which way and how hard it's pushing into another, smoothed) is for the
//    rig (a hand out, a lean) and the AI (a teammate pressing into you: make way).
// Deterministic: the same order (the session's), the same arithmetic, no randomness.

import { bus } from '../core/EventBus.js';

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
    this.time = 0;
    this.stats = { bodies: 0, pairs: 0, contacts: 0, bumps: 0, ms: 0 };
  }

  /** The body a fighter has right now (or null: in a vehicle, off the field, flung through the air, climbing). */
  shapeOf(f) {
    const B = this.B, m = f.movement, s = m?.state;
    if (!s || f.offField || f.vehicle || f.isVehicle || f.removed) return null;
    const mode = s.mode, p = s.position;
    const armor = m.mods?.armor ?? 'medium';
    const vx = s.velocity.x, vz = s.velocity.z;
    if (f.health?.dead) return null;   // (the dead are corpses: corpses())
    if (mode === 'vehicle' || mode === 'mantle' || mode === 'wallrun' || mode === 'air' || mode === 'ragdoll') return null;
    const down = !!f.health?.downed || s.downed;
    const lying = down || s.stance === 'prone' || mode === 'dive' || (mode === 'slide' && s.slide?.kind === 'belly') || (mode === 'knockdown' && s.knock?.phase !== 'getup');
    if (lying) {
      const mass = (B.mass[armor] ?? B.mass.medium) * (down ? B.massMul.downed : B.massMul.prone);
      return record(f.id, f.team, p.x, p.y, p.z, s.bodyYaw, true, B, B.lying.radius, B.height.low, mass, 'low', vx, vz, f);
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
    const grid = this.grid;
    for (const v of grid.values()) v.length = 0;
    for (let i = 0; i < list.length; i++) {
      const b = list[i], r = b.r;
      const x0 = Math.floor((Math.min(b.ax, b.bx) - r) / CELL), x1 = Math.floor((Math.max(b.ax, b.bx) + r) / CELL);
      const z0 = Math.floor((Math.min(b.az, b.bz) - r) / CELL), z1 = Math.floor((Math.max(b.az, b.bz) + r) / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const k = (cx + 32768) * 65536 + (cz + 32768);
        let cell = grid.get(k);
        if (!cell) grid.set(k, (cell = []));
        if (cell.length === 0 || cell[cell.length - 1] !== i) cell.push(i);
      }
    }
    const touching = new Set();
    let pairs = 0, contacts = 0;
    this.bumps = 0;
    const seen = new Set();
    // Two passes: a crowd settles in a couple of ticks rather than one man at a time.
    for (let pass = 0; pass < 2; pass++) {
      seen.clear();
      for (const cell of grid.values()) {
        for (let u = 0; u < cell.length; u++) for (let w = u + 1; w < cell.length; w++) {
          const i = cell[u], j = cell[w];
          const key = i * 65536 + j;
          if (seen.has(key)) continue;
          seen.add(key);
          pairs++;
          const A = list[i], C = list[j];
          if (A.kind === 'dead' && C.kind === 'dead') continue;
          if (A.y1 < C.y0 || C.y1 < A.y0) continue;   // (one above the other: a balcony, a floor up)
          if (this.#pair(A, C, pass, touching, dt)) contacts++;
        }
      }
    }
    // Apply each body's push through the world; record how hard each was pressing, for the rig and the AI.
    for (const b of list) {
      const f = b.ref;
      if (!f) continue;
      const s = f.movement.state;
      if (b.dx || b.dz) push(f, b.dx, b.dz);
      const k = 1 - Math.exp(-dt * 10);
      const press = s.press ?? (s.press = { x: 0, z: 0, k: 0, by: null });
      if (b.press > 0) { const l = Math.hypot(b.px, b.pz) || 1; press.x += (b.px / l - press.x) * k; press.z += (b.pz / l - press.z) * k; }
      press.k += ((b.press > 0 ? Math.min(1, b.press) : 0) - press.k) * k;
      press.by = b.pressBy ?? null;
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
      if (v > 0.2) { b.press += v / 4; b.px -= sx; b.pz -= sz; b.pressBy = other.id; }
      // Pressed against a teammate who's standing his ground: count it (squeeze past soon).
      if (sameTeam && v > 0.4 && other.kind === 'up' && (other.planted || Math.hypot(other.vx, other.vz) < 0.6)) b.blockedBy = other.id;
    };
    into(A, nx, nz, C); into(C, -nx, -nz, A);
    if (vn > 0) {
      // Who ran into whom: the one carrying more speed toward the other.
      const towardA = va ? -(va.x * nx + va.z * nz) : 0, towardC = vc ? vc.x * nx + vc.z * nz : 0;
      // The speed into each other is taken off both, by share (an inelastic bump): slide along, not through.
      const j = vn / sum;
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
    // Each is shoved by the share of the closing speed the other side carried in.
    const hit = (b, sx, sz, share) => {
      const m = b.ref?.movement;
      if (!m || b.kind !== 'up') return;
      const v = vn * share;
      if (v >= B.bump.stumble) m.stagger(sx, sz, v * B.bump.shove, { dur: Math.min(0.6, 0.25 + v * 0.05) });
    };
    hit(A, nx, nz, shareA);
    hit(C, -nx, -nz, shareC);
    const mx = (A.ax + C.ax) / 2, mz = (A.az + C.az) / 2;
    bus.emit('body:bump', { a: A.id, b: C.id, by, speed: vn, x: mx, z: mz, dir: [nx, nz], friendly: A.team === C.team });
  }
}
