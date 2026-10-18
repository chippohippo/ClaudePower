// RagdollDrive: muscles for the particle ragdoll (physics/Ragdoll.js), so a falling soldier moves
// like a person and not a sack (NaturalMotion Euphoria and Red Dead Redemption 2 are the model).
// Tuning: data/movement.json `ragdoll.drive`.
//
// Each tick, before the ragdoll's constraint passes, the drive pulls particles toward targets set
// in the body's own frames. Every pull acts between a joint and the joint it hangs from (shared by
// mass), so muscles bend the body but never push it through the air. Per situation:
//  * Dying (shotRelax): the body keeps its shape for a moment and lets go. The legs give way first
//    (relax.lower), then the trunk (relax.upper), so a shot man folds at the knees, drops and
//    topples instead of falling like a plank. A head shot or a mangling hit is lights-out: limp
//    at once.
//  * Thrown, still alive, in the air: arms windmill, legs pedal, the chin tucks. Falling on purpose
//    (brace: a dive off a drop), the arms go out ahead and down for the ground instead and the legs
//    hold together.
//  * Going down, still alive (catchFall): both hands reach for the ground ahead of the fall, the
//    elbows give, the head stays up off the ground.
//  * On the ground, still alive (writhe): knees draw up in turn, one hand presses on the wound,
//    then the body settles so the downed crawl or the get-up can take over.
//  * Clutch: whenever there's a wound, the hand on its side (the other one for a wounded arm)
//    goes to it.
// Simulation code: plain arithmetic, deterministic, a few µs per body per tick.

import { J } from './Ragdoll.js';

const { PELVIS: P, NECK: NK, HEAD: H, HIP_L: HL, HIP_R: HR, KNEE_L: KL, KNEE_R: KR, ANKLE_L: AL, ANKLE_R: AR,
  SHOULDER_L: SL, SHOULDER_R: SR, ELBOW_L: EL, ELBOW_R: ER, HAND_L: WL, HAND_R: WR, CHEST: C } = J;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Pose-hold chains: [joint, anchor, frame ('p' pelvis | 'c' chest), group].
const HOLD = [
  [C, P, 'p', 'spine'], [NK, P, 'p', 'spine'], [SL, P, 'p', 'spine'], [SR, P, 'p', 'spine'], [H, NK, 'p', 'head'],
  [KL, HL, 'p', 'legs'], [AL, KL, 'p', 'legs'], [KR, HR, 'p', 'legs'], [AR, KR, 'p', 'legs'],
  [EL, SL, 'c', 'arms'], [WL, EL, 'c', 'arms'], [ER, SR, 'c', 'arms'], [WR, ER, 'c', 'arms'],
];

export class RagdollDrive {
  /** @param {object} cfg data/movement.json `ragdoll.drive` */
  constructor(cfg) {
    this.cfg = cfg;
    this.on = false;
    this.pose = null;            // body-local [right, up, forward] per joint (the stance it went limp in)
    this.vital = 'dead';         // 'alive' | 'downed' | 'dead': set by the owner every tick
    this.t = 0; this.deadT = -1; this.groundT = 0; this.airT = 0;
    this.tone = 0;               // 0..1: muscle at the start (dead bodies fade from it)
    this.limp = false;           // lights out: no muscle at all
    this.wound = null;           // { anchor: C | P, local: [r, d, n], side: -1 | 1, arm: bool }
    this.brace = false;          // it saw the fall coming: arms out for the ground, no flailing
    this.phase = 'shock';
  }

  /**
   * A body goes limp (Ragdoll.init has just placed it).
   * @param {Ragdoll} rd
   * @param {object} o { pose: rows [right, up, forward], vital, limp (lights out), wound: { x, y, z, site } (world point),
   *                    brace: falling on purpose (a dive off a drop) }
   */
  start(rd, { pose, vital = 'dead', limp = false, wound = null, brace = false } = {}) {
    this.on = true; this.pose = pose; this.rel = holdOffsets(pose); this.vital = vital; this.limp = limp; this.brace = brace && !limp;
    this.t = 0; this.deadT = vital === 'dead' ? 0 : -1; this.groundT = 0; this.airT = 0; this.landed = false;
    this.tone = limp ? 0 : vital === 'dead' ? this.cfg.tone.dead : this.cfg.tone.alive;
    this.phase = 'shock';
    this.wound = null;
    if (wound) this.setWound(rd, wound);
    // Which knee goes first (the wounded side's, else the one the body leans over): a dying body
    // twists down onto one side instead of squatting straight down.
    const f = rd.frames();
    this.first = this.wound?.side ?? ((rd.x[C] - rd.x[P]) * f.pelvis.r[0] + (rd.z[C] - rd.z[P]) * f.pelvis.r[2] < 0 ? -1 : 1);
  }

  /** Where it hurts (a world point on the body): the hand on that side goes there. */
  setWound(rd, { x, y, z, site = null }) {
    const f = rd.frames(), low = site === 'gut' || site === 'legL' || site === 'legR';
    const a = low ? P : C, F = low ? f.pelvis : f.chest;
    const dx = x - rd.x[a], dy = y - rd.y[a], dz = z - rd.z[a];
    const local = [dx * F.r[0] + dy * F.r[1] + dz * F.r[2], dx * F.d[0] + dy * F.d[1] + dz * F.d[2], dx * F.n[0] + dy * F.n[1] + dz * F.n[2]];
    const arm = site === 'armL' || site === 'armR', limb = arm || site === 'legL' || site === 'legR';
    const side = site === 'armL' || site === 'legL' ? -1 : site === 'armR' || site === 'legR' ? 1 : local[0] < 0 ? -1 : 1;
    // A hand can't get round to a wound in the back (reaching for it levers the body about).
    if (!limb && local[2] < -0.02 * rd.scale) { this.wound = null; return; }
    // The wounded arm can't press on itself: the other hand comes across.
    this.wound = { anchor: a, local, side: arm ? -side : side, arm };
  }

  /** One tick, before the constraint passes. @param {Ragdoll} rd */
  apply(rd, dt, collider) {
    if (!this.on || !this.pose) return;
    const cfg = this.cfg;
    this.t += dt;
    if (this.vital === 'dead' && this.deadT < 0) this.deadT = 0;   // died while down: let go from here
    if (this.deadT >= 0) this.deadT += dt;
    const f = rd.frames(), x = rd.x, y = rd.y, z = rd.z;
    const g0 = collider ? collider.groundAt(x[C], z[C]) : 0;
    const chestUp = y[C] - g0, chestVy = (y[C] - rd.py[C]) / dt;
    if (rd.grounded) this.airT = 0; else this.airT += dt;

    // ---- strengths per group
    let spine = 0, legs = 0, arms = 0, head = 0, clutch = 0;
    if (!this.limp) {
      if (this.deadT >= 0) {
        // Dying: the shape holds, then goes; legs first. Hands drop off the wound as it goes.
        const k = this.tone, R = cfg.relax;
        legs = k * clamp(1 - this.deadT / R.lower, 0, 1);
        this.legsFirst = k * clamp(1 - this.deadT / (R.lower * 0.55), 0, 1);   // that knee goes first
        spine = k * clamp(1 - this.deadT / R.upper, 0, 1);
        head = spine; arms = spine * 0.25;
        clutch = this.wound ? cfg.clutch * clamp(1 - this.deadT / (R.upper * 0.7), 0, 1) : 0;
        this.phase = this.deadT < R.upper ? 'dying' : 'dead';
      } else {
        // Alive (downed or thrown): shock, then air / catch until the trunk is down and still,
        // then writhe on the ground, then settle (groundT: how long it's been down).
        const W = cfg.writhe, k = this.tone;
        // Down once the trunk is low and still (thrown up again, it's falling again).
        if (!this.landed && rd.grounded && chestUp < cfg.catch.down && chestVy > -0.6) this.landed = true;
        if (this.landed && this.airT > 0.15 && chestUp > cfg.catch.height) { this.landed = false; this.groundT = 0; }
        if (this.landed) this.groundT += dt;
        // (A braced fall is a man who's landed, not a wounded one: he gets his breath and gets up.)
        const wt = this.brace ? W.time * 0.25 : W.time;
        const settle = this.groundT > wt ? clamp(1 - (this.groundT - wt) / cfg.settle, 0, 1) : 1;
        this.phase = this.t < cfg.shock && !this.brace ? 'shock'
          : !this.landed && this.airT > 0.08 && chestUp > cfg.catch.height ? 'air'
          : !this.landed ? 'catch'
          : settle < 1 ? 'settle' : 'writhe';
        const down = this.phase === 'writhe' || this.phase === 'settle';
        spine = k * settle * (down ? 0.3 : this.phase === 'air' ? (this.brace ? 0.6 : 0.4) : 0.6);
        legs = k * settle * (down ? 0.06 : this.phase === 'catch' ? 0.25 : this.brace ? 0.45 : 0.3);   // lying: the legs lie where they fall
        head = k * settle * 0.8;
        arms = this.phase === 'shock' ? k * 0.5 : 0;
        // Both hands break the fall (the reflex beats the wound); then one goes back to it.
        clutch = this.wound && this.phase !== 'catch' && this.phase !== 'air' ? cfg.clutch * settle : 0;
      }
    }
    if (spine + legs + arms + head + clutch <= 0.001) return;
    const gain = cfg.gain;

    // ---- hold the shape it fell in (relative to the pelvis and chest frames)
    const rel = this.rel ?? (this.rel = holdOffsets(this.pose));
    const firstLeg = this.deadT >= 0 ? (this.first < 0 ? KL : KR) : -1, firstAnkle = this.deadT >= 0 ? (this.first < 0 ? AL : AR) : -1;
    for (let h = 0; h < HOLD.length; h++) {
      const [i, a, fr, grp] = HOLD[h];
      const s = grp === 'spine' ? spine : grp === 'legs' ? (i === firstLeg || i === firstAnkle ? this.legsFirst : legs) : grp === 'arms' ? arms : head;
      if (s <= 0) continue;
      const F = fr === 'p' ? f.pelvis : f.chest;
      const [lr, lu, lf] = rel[h], sc = rd.scale;
      pull(rd, i, a,
        x[a] + (F.r[0] * lr + F.d[0] * lu + F.n[0] * lf) * sc,
        y[a] + (F.r[1] * lr + F.d[1] * lu + F.n[1] * lf) * sc,
        z[a] + (F.r[2] * lr + F.d[2] * lu + F.n[2] * lf) * sc, s * gain);
    }

    // ---- the living: what the arms and legs do
    if (this.deadT < 0 && !this.limp) {
      const k = this.tone, Fc = f.chest, Fp = f.pelvis, sc = rd.scale;
      if (this.phase === 'air' && this.brace && cfg.brace) {
        // Braced for it: both arms out ahead of the shoulders the way it's going and down toward
        // the ground, a little apart, elbows nearly straight; the chin up off the ground to come.
        const Bc = cfg.brace, s = Bc.strength * k * gain;
        let dx = rd.x[C] - rd.px[C], dz = rd.z[C] - rd.pz[C];
        const l = Math.hypot(dx, dz);
        if (l > 1e-4) { dx /= l; dz /= l; } else { dx = Fc.n[0]; dz = Fc.n[2]; const m = Math.hypot(dx, dz) || 1; dx /= m; dz /= m; }
        const reach = Bc.reach * sc, down = Bc.down * sc, spread = Bc.spread * sc;
        // The trunk held out along the way it's going, the nose dipping as it falls (a man diving
        // off a wall goes down head first onto his hands, not end over end).
        const a = Math.min(Bc.dip, this.airT * Bc.dipRate), ca = Math.cos(a), sa = Math.sin(a);
        const tl = Math.hypot(x[C] - x[P], y[C] - y[P], z[C] - z[P]);
        pull(rd, C, P, x[P] + dx * ca * tl, y[P] - sa * tl, z[P] + dz * ca * tl, Bc.level * k * gain);
        // Held steady: the trunk's and the legs' swing about the hips bleeds off (no wobble end to end).
        steady(rd, C, P, Bc.steady * k); steady(rd, KL, P, Bc.steady * k); steady(rd, KR, P, Bc.steady * k);
        for (const side of [-1, 1]) {
          const sh = side < 0 ? SL : SR, el = side < 0 ? EL : ER, hand = side < 0 ? WL : WR;
          pull(rd, hand, sh, x[sh] + dx * reach + Fc.r[0] * side * spread, y[sh] - down, z[sh] + dz * reach + Fc.r[2] * side * spread, s);
          const mx = (x[sh] + x[hand]) * 0.5, my = (y[sh] + y[hand]) * 0.5, mz = (z[sh] + z[hand]) * 0.5, b = 0.04 * sc;
          pull(rd, el, sh, mx + Fc.r[0] * side * b, my + b, mz + Fc.r[2] * side * b, s * 0.8);
        }
        const hl = 0.21 * sc, ux = Fc.d[0] * 0.55, uy = Fc.d[1] * 0.55 + 0.45, uz = Fc.d[2] * 0.55, ul = Math.hypot(ux, uy, uz) || 1;
        pull(rd, H, NK, x[NK] + (ux / ul) * hl, y[NK] + (uy / ul) * hl, z[NK] + (uz / ul) * hl, head * gain);
      } else if (this.phase === 'air') {
        // Windmill the arms (each hand round its shoulder, half a turn apart), pedal the legs.
        const A = cfg.air, s = A.strength * k * gain;
        for (const side of [-1, 1]) {
          const sh = side < 0 ? SL : SR, hand = side < 0 ? WL : WR, hip = side < 0 ? HL : HR, knee = side < 0 ? KL : KR;
          const ph = this.t * A.windmill + (side < 0 ? 0 : Math.PI), r = 0.5 * sc;
          const cu = Math.cos(ph) * r, cf = Math.sin(ph) * r, out = side * 0.18 * sc;
          pull(rd, hand, sh, x[sh] + Fc.d[0] * cu + Fc.n[0] * cf + Fc.r[0] * out, y[sh] + Fc.d[1] * cu + Fc.n[1] * cf + Fc.r[1] * out, z[sh] + Fc.d[2] * cu + Fc.n[2] * cf + Fc.r[2] * out, s);
          const pk = this.t * A.pedal + (side < 0 ? 0 : Math.PI), l = 0.42 * sc;
          const ku = -Math.cos(pk * 0.5 + 0.6) * l, kf = Math.max(0, Math.sin(pk)) * l * 0.8;
          pull(rd, knee, hip, x[hip] + Fp.d[0] * ku + Fp.n[0] * kf, y[hip] + Fp.d[1] * ku + Fp.n[1] * kf, z[hip] + Fp.d[2] * ku + Fp.n[2] * kf, s * 0.6);
        }
      } else if (this.phase === 'catch' || this.phase === 'shock') {
        // Both hands for the ground ahead of where the body is going, shoulder-width apart.
        const Cc = cfg.catch;
        if (chestUp < Cc.height) {
          let dx = rd.x[C] - rd.px[C], dz = rd.z[C] - rd.pz[C], l = Math.hypot(dx, dz);
          if (l < 0.5 * dt) { dx = x[C] - x[P]; dz = z[C] - z[P]; l = Math.hypot(dx, dz); }   // slow: the way it's tipping
          if (l < 1e-6) { dx = Fc.n[0]; dz = Fc.n[2]; l = Math.hypot(dx, dz) || 1; }
          dx /= l; dz /= l;
          const s = Cc.strength * k * gain * (this.phase === 'shock' ? 0.5 : 1);
          // Going over backward the hands go down low and wide beside the hips (reaching far
          // behind would twist the body round onto its face).
          const backward = dx * Fc.n[0] + dz * Fc.n[2] < -0.3, reach = (backward ? 0.12 : Cc.reach) * sc, spread = (backward ? Cc.spread * 1.8 : Cc.spread) * sc;
          for (const side of [-1, 1]) {
            const sh = side < 0 ? SL : SR, el = side < 0 ? EL : ER, hand = side < 0 ? WL : WR;
            if (this.phase === 'shock' && this.wound && side === this.wound.side) continue;   // that hand's on the wound
            const hx = x[C] + dx * reach + Fc.r[0] * side * spread, hz = z[C] + dz * reach + Fc.r[2] * side * spread;
            const gy = collider ? collider.groundAt(hx, hz) : 0;
            pull(rd, hand, sh, hx, gy + rd.r[hand] + 0.02, hz, s);
            // Braced: the elbow kept nearly straight, so the arm takes the weight like a strut
            // (it gives a little: the elbow sits just off the shoulder-hand line, out and back).
            const mx = (x[sh] + x[hand]) * 0.5, my = (y[sh] + y[hand]) * 0.5, mz = (z[sh] + z[hand]) * 0.5, b = 0.05 * sc;
            pull(rd, el, sh, mx + (Fc.r[0] * side - Fc.n[0]) * b, my + (Fc.r[1] * side - Fc.n[1]) * b, mz + (Fc.r[2] * side - Fc.n[2]) * b, Cc.brace * k * gain);
          }
        }
        // Chin up: the head lifts away from the ground it's falling toward.
        const hl = 0.21 * sc, ux = Fc.d[0] * 0.55, uy = Fc.d[1] * 0.55 + 0.45, uz = Fc.d[2] * 0.55, ul = Math.hypot(ux, uy, uz) || 1;
        pull(rd, H, NK, x[NK] + (ux / ul) * hl, y[NK] + (uy / ul) * hl, z[NK] + (uz / ul) * hl, head * gain);
      } else if (this.phase === 'writhe' && Fc.n[1] > 0.4 && Fp.n[1] > 0.2) {
        // On the back: knees drawn up in turn, toward the sky and the chest. (Face down, the
        // head stays up and the hand on the wound; nothing kicks.)
        const W = cfg.writhe, s = W.strength * k * gain;
        let fx = -Fp.d[0], fz = -Fp.d[2];
        const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;   // along the ground toward the feet
        for (const side of [-1, 1]) {
          const hip = side < 0 ? HL : HR, knee = side < 0 ? KL : KR;
          const draw = 0.5 + 0.5 * Math.sin(this.t * W.rate + (side < 0 ? 0 : 2.2));
          const up = (0.1 + 0.28 * draw) * sc, along = (0.4 - 0.2 * draw) * sc;
          pull(rd, knee, hip, x[hip] + fx * along, y[hip] + up, z[hip] + fz * along, s);
        }
      }
    }

    // ---- a hand on the wound
    if (this.wound && clutch > 0) {
      const W = this.wound, a = W.anchor, F = a === C ? f.chest : f.pelvis, [lr, lu, lf] = W.local;
      const hand = W.side < 0 ? WL : WR, sh = W.side < 0 ? SL : SR;
      // On the surface, not in it: out from the trunk's axis by the hand's radius.
      const out = Math.hypot(lr, lf) || 1, push = (rd.r[hand] + 0.02) / out;
      const tr = lr * (1 + push), tf = lf * (1 + push);
      const tx = x[a] + F.r[0] * tr + F.d[0] * lu + F.n[0] * tf, ty = y[a] + F.r[1] * tr + F.d[1] * lu + F.n[1] * tf, tz = z[a] + F.r[2] * tr + F.d[2] * lu + F.n[2] * tf;
      // Only a wound it can get at: one the body is lying on is out of reach (a hand forced
      // under the hips would lever the body up off the ground).
      const floor = (collider ? collider.groundAt(tx, tz) : 0) + rd.r[hand] + 0.02;
      if (ty >= floor - 0.04) pull(rd, hand, sh, tx, Math.max(ty, floor), tz, clutch * gain);
    }
  }

  serialize() {
    return { on: this.on, pose: this.pose, vital: this.vital, t: this.t, deadT: this.deadT, groundT: this.groundT, airT: this.airT, landed: this.landed, tone: this.tone, limp: this.limp, wound: this.wound, brace: this.brace, phase: this.phase, first: this.first, legsFirst: this.legsFirst };
  }
  restore(o) { Object.assign(this, o); this.rel = this.pose ? holdOffsets(this.pose) : null; }
}

/**
 * Each held joint's offset from its anchor, as the hold maps it through the body's pelvis or chest
 * frame. The pose rows are [right, up, forward] about a root standing on the ground: for an upright
 * pose that's the body's own frame near enough (a slight lean the drive's tuning counts on), so the
 * rows are used as they are. A lying pose's spine runs along "forward", so its rows are re-expressed
 * in its own pelvis and chest frames, built the way Ragdoll builds the body's (right: hip to hip or
 * shoulder to shoulder; up: the spine); taken as they are, they'd curl the body over onto its face.
 */
function holdOffsets(pose) {
  const W = (j) => [pose[j][0], pose[j][1], -pose[j][2]];   // as world axes at yaw 0 (forward is -z)
  const frame = (r0, r1, u0, u1) => {
    const a = W(r0), b = W(r1), c = W(u0), e = W(u1);
    let ux = e[0] - c[0], uy = e[1] - c[1], uz = e[2] - c[2], l = Math.hypot(ux, uy, uz) || 1;
    ux /= l; uy /= l; uz /= l;
    let rx = b[0] - a[0], ry = b[1] - a[1], rz = b[2] - a[2];
    const k = rx * ux + ry * uy + rz * uz;
    rx -= ux * k; ry -= uy * k; rz -= uz * k; l = Math.hypot(rx, ry, rz) || 1;
    rx /= l; ry /= l; rz /= l;
    return { r: [rx, ry, rz], d: [ux, uy, uz], n: [uy * rz - uz * ry, uz * rx - ux * rz, ux * ry - uy * rx] };
  };
  const Fp = frame(HL, HR, P, C), Fc = frame(SL, SR, C, NK);
  if (Fp.d[1] > 0.7) return HOLD.map(([i, a]) => [pose[i][0] - pose[a][0], pose[i][1] - pose[a][1], pose[i][2] - pose[a][2]]);
  const dot = (v, w) => v[0] * w[0] + v[1] * w[1] + v[2] * w[2];
  return HOLD.map(([i, a, fr]) => {
    const F = fr === 'p' ? Fp : Fc, p = W(i), q = W(a), d = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
    return [dot(d, F.r), dot(d, F.d), dot(d, F.n)];
  });
}

/** Bleed off `k` of joint i's velocity relative to joint a (shared by mass: momentum is kept). */
function steady(rd, i, a, k) {
  const rvx = (rd.x[i] - rd.px[i]) - (rd.x[a] - rd.px[a]), rvy = (rd.y[i] - rd.py[i]) - (rd.y[a] - rd.py[a]), rvz = (rd.z[i] - rd.pz[i]) - (rd.z[a] - rd.pz[a]);
  const wi = rd.w[i] / (rd.w[i] + rd.w[a]), wa = rd.w[a] / (rd.w[i] + rd.w[a]);
  rd.px[i] += rvx * k * wi; rd.py[i] += rvy * k * wi; rd.pz[i] += rvz * k * wi;
  rd.px[a] -= rvx * k * wa; rd.py[a] -= rvy * k * wa; rd.pz[a] -= rvz * k * wa;
}

/**
 * Pull joint i toward (tx, ty, tz) by `k` of the way, sharing the move with the joint it hangs
 * from (a muscle between them: the body bends, its centre of mass doesn't go anywhere). Half of
 * the move is taken off the velocity it would add (muscles are damped).
 */
function pull(rd, i, a, tx, ty, tz, k) {
  const x = rd.x, y = rd.y, z = rd.z, w = rd.w;
  const dx = (tx - x[i]) * k, dy = (ty - y[i]) * k, dz = (tz - z[i]) * k;
  const wi = w[i] / (w[i] + w[a]), wa = w[a] / (w[i] + w[a]);
  x[i] += dx * wi; y[i] += dy * wi; z[i] += dz * wi;
  x[a] -= dx * wa; y[a] -= dy * wa; z[a] -= dz * wa;
  const damp = 0.5;
  rd.px[i] += dx * wi * damp; rd.py[i] += dy * wi * damp; rd.pz[i] += dz * wi * damp;
  rd.px[a] -= dx * wa * damp; rd.py[a] -= dy * wa * damp; rd.pz[a] -= dz * wa * damp;
}
