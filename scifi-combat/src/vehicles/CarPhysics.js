// CarPhysics: wheeled vehicles you can roll (docs/VEHICLES.md). The reference is the Helldivers 2
// recon car as players describe it: light and floaty on soft springs, a rear-biased drive that
// oversteers, a handbrake for slides, no air control, a top speed near 75 km/h, rolling when it
// catches something at speed or lands badly, and throwing out whoever is exposed when it does.
//
// One rigid body per car (its mass, a box's inertia, orientation as a quaternion), integrated in
// two substeps a tick (deterministic: the same inputs give the same crash):
//  * four raycast wheels on spring-and-damper struts (soft: it squats under power, dives under
//    braking and leans into turns), touching the terrain and anything low enough to drive onto
//    (a kerb, rubble, a sandbag top)
//  * tire forces at each contact: the grip it takes to stop the wheel sliding sideways, up to a
//    friction limit that falls away past the peak slip angle (a hard turn or the handbrake breaks
//    the rear loose and it drifts), with drive, braking and rolling resistance along the wheel,
//    all inside a friction circle
//  * an engine whose push fades toward top speed, three quarters of it to the rear wheels; brakes
//    on all four; the handbrake locks the rears
//  * steering that ramps in (no twitchy keyboard) and narrows with speed
//  * nothing in the air: what the car was doing when it left the ground, it keeps doing
//  * the hull's corners and edges collide with the ground and with cover: impulses at the contact
//    point, with friction and a little bounce, so a wall hit at an angle spins it, a kerb caught
//    at speed or a bad landing rolls it, and a car on its roof slides to a stop on it
// Each step reports the hardest hit it took (the change in speed, m/s) and the speed before it,
// which VehicleSystem turns into damage, hurt occupants and people thrown out.
//
// Body frame: x right, y up, z back (forward is -z, as everywhere); the origin is the middle of
// the hull's base, the vehicle's `position` for everything else in the game.

import { Vector3, Quaternion, Matrix3 } from 'three';

const UP = new Vector3(0, 1, 0);
const _r = new Vector3(), _t = new Vector3(), _n = new Vector3(), _v = new Vector3(), _a = new Vector3(), _b = new Vector3();
const _f = new Vector3(), _s = new Vector3(), _p = new Vector3(), _q = new Quaternion(), _dq = new Quaternion();
const _R = new Matrix3(), _Rt = new Matrix3(), _I = new Matrix3();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class CarBody {
  /** @param {object} def a vehicles.json car (its `car` block) @param {Vector3} at base position @param {number} yaw */
  constructor(def, at, yaw) {
    const C = def.car, sz = def.size;
    this.def = def; this.C = C;
    this.m = C.mass;
    this.com = new Vector3(...(C.com ?? [0, 0.6, 0]));
    // A box's inertia (in the body frame), inverted.
    const w = sz.x, h = sz.y, d = sz.z, k = this.m / 12 * (C.inertia ?? 1);
    this.Iinv = new Vector3(1 / (k * (h * h + d * d)), 1 / (k * (w * w + d * d)), 1 / (k * (w * w + h * h)));
    this.q = new Quaternion().setFromAxisAngle(UP, yaw);
    this.c = new Vector3().copy(at).add(_v.copy(this.com).applyQuaternion(this.q));   // centre of mass, world
    this.vel = new Vector3();
    this.w = new Vector3();
    this.base = at.clone();
    const W = C.wheels;
    this.wheels = [[-1, W.zf], [1, W.zf], [-1, W.zr], [1, W.zr]].map(([sx, z], i) => ({
      i, front: i < 2, mount: new Vector3(sx * W.x, W.y, z), len: W.rest, contact: false, load: 0, spin: 0, steer: 0, slip: 0, kerb: 0,
    }));
    // The hull's collision points: a grid on the floor, the bumpers and the sides at mid height,
    // the roof of the cage; boxes poking in between them are caught by their own corners (#collide).
    const hx = sz.x / 2, hz = sz.z / 2, y0 = C.clearance ?? 0.35, y1 = sz.y, ym = (y0 + y1) / 2;
    this.dims = { hx, hz, y0, y1 };
    this.hull = [];
    for (const x of [-hx, 0, hx]) for (const z of [-hz, 0, hz]) this.hull.push(new Vector3(x, y0, z));
    for (const x of [-hx, -hx / 2, 0, hx / 2, hx]) for (const z of [-hz, hz]) this.hull.push(new Vector3(x, y0 + 0.35, z));
    for (const x of [-hx, hx]) for (const z of [-hz / 2, 0, hz / 2]) this.hull.push(new Vector3(x, ym, z));
    for (const x of [-hx * 0.8, hx * 0.8]) for (const z of [-hz * 0.5, hz * 0.6]) this.hull.push(new Vector3(x, y1, z));
    this.hull.push(new Vector3(0, y1, 0));
    this.P = this.hull.map(() => new Vector3());       // the hull points in the world, each substep
    this.steer = 0;
    this.airborne = 0;
    this.prevVel = new Vector3();
    this.#sync();
  }

  /** Heading (rad), as `yaw` everywhere: the body's forward projected on the ground. */
  get yaw() { _f.set(0, 0, -1).applyQuaternion(this.q); return Math.atan2(-_f.x, -_f.z); }
  /** How upright: 1 on its wheels, 0 on its side, -1 on its roof. */
  get upright() { return _v.set(0, 1, 0).applyQuaternion(this.q).y; }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  /** Speed along the body's forward axis (negative: reversing). */
  get forwardSpeed() { _f.set(0, 0, -1).applyQuaternion(this.q); return this.vel.dot(_f); }

  /** A body-frame point in the world. */
  point(local, out) { return out.copy(local).applyQuaternion(this.q).add(this.base); }
  /** How fast a body-frame point is moving (a rolling car's roof moves faster than its middle). */
  pointVelocity(local, out) { this.point(local, _pv); return out.copy(this.w).cross(_pv.sub(this.c)).add(this.vel); }

  /**
   * One tick. `input`: { throttle -1..1 (W/S: drive, brake, reverse), steer -1..1 (A/D, + right),
   * handbrake, dead (engine out) }. `world`: terrainHeight(x, z), groundHeight(p), coverIn(...).
   * Returns { impact (hardest hit, m/s of speed change), before (velocity before it), grounded }.
   */
  step(world, input, dt, handling = 1) {
    const out = this.out ??= { impact: 0, before: new Vector3(), grounded: false };
    out.impact = 0; out.grounded = false;
    const n = 2, h = dt / n;
    for (let k = 0; k < n; k++) {
      this.prevVel.copy(this.vel);
      this.#forces(world, input, h, handling, out);
      this.#integrate(h);
      this.#collide(world, h, out);
      this.#sync();
    }
    return out;
  }

  /** World inverse inertia applied to a vector: R Iinv Rᵀ x. */
  #iinv(x, out) {
    out.copy(x).applyQuaternion(_q.copy(this.q).invert());
    out.set(out.x * this.Iinv.x, out.y * this.Iinv.y, out.z * this.Iinv.z);
    return out.applyQuaternion(this.q);
  }

  /** Apply an impulse J (world) at a world point. */
  impulse(J, at) {
    this.vel.addScaledVector(J, 1 / this.m);
    _r.subVectors(at, this.c);
    this.w.add(this.#iinv(_a.crossVectors(_r, J), _b));
  }

  // ---------------------------------------------------------------- wheels and tires
  #forces(world, input, h, handling, out) {
    const C = this.C, W = C.wheels, E = C.engine, T = C.tire, m = this.m;
    // Steering ramps toward the stick and narrows with speed.
    const fwd = this.forwardSpeed, top = E.top;
    const maxSteer = C.steer.max + (C.steer.atSpeed - C.steer.max) * clamp(Math.abs(fwd) / top, 0, 1);
    const want = clamp(input.steer ?? 0, -1, 1) * maxSteer * handling;
    this.steer += clamp(want - this.steer, -C.steer.rate * h, C.steer.rate * h);
    const F = _F.set(0, -9.8 * m, 0);                     // gravity (applied at the centre of mass)
    const tau = _T.set(0, 0, 0);
    const down = _n.set(0, -1, 0).applyQuaternion(this.q);
    const forward = _s.set(0, 0, -1).applyQuaternion(this.q);
    let touching = 0;
    // Throttle: forward drive; back on the stick brakes while rolling forward, then reverses.
    const thr = input.dead ? 0 : clamp(input.throttle ?? 0, -1, 1);
    const braking = (thr < 0 && fwd > 1) || (thr > 0 && fwd < -1);
    const drive = braking ? 0 : thr > 0 ? thr * E.force * Math.max(0, 1 - (fwd / top) ** 2) : thr < 0 ? thr * E.force * 0.6 * Math.max(0, 1 - (fwd / -E.reverse) ** 2) : 0;
    for (const wh of this.wheels) {
      const M = this.point(wh.mount, _p);
      // The ground under the wheel: the terrain, or something low enough to drive onto.
      const reachY = M.y + down.y * (W.rest + W.radius);
      const g = world.groundHeight(_v.set(M.x, reachY - 1.0, M.z));
      const kerb = g - world.terrainHeight(M.x, M.z), rise = kerb - wh.kerb;   // a cover top under it, and how much higher than last step
      wh.kerb = kerb;
      wh.contact = false;
      if (down.y > -0.35) { wh.len = W.rest; continue; }   // on its side or roof: no wheel touches
      const t = (M.y - g) / -down.y;                       // along the strut to the ground
      const len = t - W.radius;
      if (len >= W.rest) { wh.len = W.rest; wh.load = 0; continue; }
      const x = W.rest - Math.max(0, len), xdot = clamp((x - (W.rest - wh.len)) / h, -6, 6);   // (a damper has its limits: a kerb is a jolt, not a launch)
      wh.len = Math.max(0, len);
      const N = Math.max(0, W.k * x + W.c * xdot);
      wh.load = N; wh.contact = true; touching++;
      // The contact point, and its velocity.
      const P = _t.copy(M).addScaledVector(down, t);
      _r.subVectors(P, this.c);
      const vp = _v.copy(this.w).cross(_r).add(this.vel);
      // The wheel's axes on the ground: forward (steered for the front pair), and to its right.
      wh.steer = wh.front ? this.steer : 0;
      const fw = _f.copy(forward); if (wh.steer) fw.applyAxisAngle(UP, -wh.steer);
      fw.y = 0; fw.normalize();
      const rt = _s2.crossVectors(fw, UP);                     // right of the wheel
      let vl = vp.dot(fw), vt = vp.dot(rt);
      wh.spin += (vl / W.radius) * h;
      // A kerb caught sideways: a step up under a wheel sliding across it stops the slide where
      // the tire touches, low under the centre of mass. That is what trips a car over.
      const T0 = C.trip ?? [0.06, 0.25];
      if (rise > T0[0] && Math.abs(vt) > 1.5) {
        const catchK = clamp((rise - T0[0]) / (T0[1] - T0[0]), 0, 1) * Math.abs(vt) / (Math.abs(vt) + Math.abs(vl));
        const rr = _a.crossVectors(_r, rt), kt = 1 / m + rt.dot(this.#iinv(rr, _b).cross(_r));
        const j = (-vt / kt) * catchK;
        this.impulse(_b.copy(rt).multiplyScalar(j), P);
        out.impact = Math.max(out.impact, Math.abs(j) / m);
        vp.copy(this.w).cross(_r).add(this.vel);
        vl = vp.dot(fw); vt = vp.dot(rt);
      }
      // Grip: what it takes to stop the sideways slide this step, up to the friction limit (which
      // falls off past the peak slip angle: a drift). The handbrake locks the rears.
      const mw = m / 4, mu = T.mu * handling;
      const hand = input.handbrake && !wh.front;
      const slipA = Math.atan2(Math.abs(vt), Math.max(2, Math.abs(vl)));
      wh.slip = slipA;
      const curve = slipA < T.peak ? 1 : Math.max(T.slide, 1 - ((slipA - T.peak) / T.peak) * (1 - T.slide));
      let capLat = mu * N * curve * (hand ? C.handbrake.rearMu : 1);
      let fl = clamp(-vt * mw / h, -capLat, capLat);
      // Along the wheel: drive (rear-biased), brakes, the handbrake's lock, rolling resistance.
      let fx = 0;
      if (hand) fx = -Math.sign(vl) * Math.min(Math.abs(vl) * mw / h, mu * N * C.handbrake.rearMu);
      else if (braking) fx = -Math.sign(vl) * Math.min(Math.abs(vl) * mw / h, E.brake / 4);
      else {
        fx = drive * (wh.front ? 1 - E.rearBias : E.rearBias) / 2;
        fx -= Math.sign(vl) * Math.min(Math.abs(vl) * mw / h, N * T.rollRes + (thr === 0 ? C.coast ?? 0 : 0));
      }
      // The friction circle: drive and grip share what the tire has.
      const cap = mu * N, mag = Math.hypot(fx, fl);
      if (mag > cap && mag > 0) { fx *= cap / mag; fl *= cap / mag; }
      // Spring along the strut, tire forces in the ground plane.
      _p.copy(down).multiplyScalar(-N).addScaledVector(fw, fx).addScaledVector(rt, fl);
      F.add(_p);
      tau.add(_v.crossVectors(_r, _p));
    }
    this.airborne = touching ? 0 : this.airborne + h;
    out.grounded ||= touching > 0;
    // Air drag (quadratic) and a little angular damping (more on the ground).
    const sp = this.vel.length();
    if (sp > 0) F.addScaledVector(this.vel, -C.drag * sp);
    this.vel.addScaledVector(F, h / m);
    this.w.add(this.#iinv(tau, _v).multiplyScalar(h));
    this.w.multiplyScalar(Math.exp(-(touching ? 0.6 : 0.08) * h));
  }

  #integrate(h) {
    this.c.addScaledVector(this.vel, h);
    const wl = this.w.length();
    if (wl > 1e-9) { _dq.setFromAxisAngle(_v.copy(this.w).divideScalar(wl), wl * h); this.q.premultiply(_dq).normalize(); }
  }

  /** The base (the vehicle's position) from the centre of mass. */
  #sync() { this.base.copy(this.com).applyQuaternion(this.q).negate().add(this.c); }

  // ---------------------------------------------------------------- the hull hitting things
  #collide(world, h, out) {
    const C = this.C, e = C.bounce ?? 0.15, mu = C.hullFriction ?? 0.55, P = this.P;
    for (let i = 0; i < P.length; i++) this.point(this.hull[i], P[i]);
    // The ground: hull points under the terrain (pushed out once, by the deepest; an impulse at each).
    let deep = 0;
    for (const p of P) deep = Math.max(deep, world.terrainHeight(p.x, p.z) - p.y);
    if (deep > 0) {
      this.c.y += Math.max(0, deep - 0.01) * 0.8;
      for (const p of P) {
        const g = world.terrainHeight(p.x, p.z);
        if (p.y < g) this.#contact(p, world.terrainNormal ? world.terrainNormal(p.x, p.z, _n) : _n.set(0, 1, 0), e, mu, out);
      }
      this.#sync();
    }
    // Cover: hull points inside a box leave by the face they came in through (the nearest, if
    // they were already in); a box's own corners inside the hull (a post, a bollard) push the
    // hull off them.
    const b0 = this.base, R = Math.hypot(this.def.size.x, this.def.size.z) / 2 + 0.5;
    const boxes = this._boxes ??= [];
    boxes.length = 0;
    world.coverIn(b0.x - R, b0.z - R, b0.x + R, b0.z + R, (b) => boxes.push(b));
    for (const b of boxes) {
      let best = 0, k = -1;
      const hits = this._hits ??= [];
      hits.length = 0;
      for (const p of P) {
        if (p.x <= b.min.x || p.x >= b.max.x || p.z <= b.min.z || p.z >= b.max.z || p.y <= b.min.y || p.y >= b.max.y) continue;
        _r.subVectors(p, this.c);
        const vp = _v.copy(this.w).cross(_r).add(this.vel), q = _t.copy(p).addScaledVector(vp, -h * 1.5);
        const d = [p.x - b.min.x, b.max.x - p.x, p.z - b.min.z, b.max.z - p.z, b.max.y - p.y];
        const came = [q.x <= b.min.x, q.x >= b.max.x, q.z <= b.min.z, q.z >= b.max.z, q.y >= b.max.y];
        let f = d[4] < 0.12 ? 4 : -1;                     // a lip just under the top: the hull rides up it
        for (let i = 0; i < 5 && f < 0; i++) if (came[i] && (f < 0 || d[i] < d[f])) f = i;
        if (f < 0) for (let i = 0; i < 5; i++) if (f < 0 || d[i] < d[f]) f = i;
        hits.push(p, f);
        if (d[f] > best) { best = d[f]; k = f; }
      }
      if (k >= 0) {
        this.c.addScaledVector(FACE[k], Math.max(0, best - 0.01) * 0.8);
        for (let i = 0; i < hits.length; i += 2) this.#contact(hits[i], FACE[hits[i + 1]], e, mu, out);
        this.#sync();
        continue;
      }
      this.#corners(b, e, mu, out);
    }
  }

  /** A box's vertical edges inside the hull: the hull is pushed off through its nearest side. */
  #corners(b, e, mu, out) {
    const { hx, hz, y0, y1 } = this.dims;
    const mid = this.point(_a.set(0, (y0 + y1) / 2, 0), _a).y;
    if (mid + 1.5 < b.min.y || mid - 1.5 > b.max.y) return;
    const qi = _qc.copy(this.q).invert();
    for (let i = 0; i < 4; i++) {
      const x = i & 1 ? b.max.x : b.min.x, z = i & 2 ? b.max.z : b.min.z;
      const P = _p.set(x, Math.max(b.min.y, Math.min(b.max.y, mid)), z);
      const L = _b.copy(P).sub(this.base).applyQuaternion(qi);
      if (Math.abs(L.x) >= hx || Math.abs(L.z) >= hz || L.y <= y0 || L.y >= y1) continue;
      const dx = hx - Math.abs(L.x), dz = hz - Math.abs(L.z);
      _n.set(dx < dz ? -Math.sign(L.x) : 0, 0, dx < dz ? 0 : -Math.sign(L.z)).applyQuaternion(this.q);
      this.c.addScaledVector(_n, Math.max(0, Math.min(dx, dz) - 0.01) * 0.8);
      this.#contact(P, _n, e, mu, out);
      this.#sync();
    }
  }

  /** One contact: an impulse at the point along the normal (with a little bounce), and friction. */
  #contact(P, nrm, e, mu, out) {
    _r.subVectors(P, this.c);
    const vp = _v.copy(this.w).cross(_r).add(this.vel);
    const vn = vp.dot(nrm);
    if (vn >= 0) return;
    const rn = _a.crossVectors(_r, nrm);
    const k = 1 / this.m + nrm.dot(_b.copy(this.#iinv(rn, _b)).cross(_r));
    const j = (-(1 + (vn < -1.5 ? e : 0)) * vn) / k;
    this.impulse(_t.copy(nrm).multiplyScalar(j), P);
    if (j / this.m > out.impact) { out.impact = j / this.m; out.before.copy(this.prevVel); }
    // Friction against the sliding along the surface.
    const vp2 = _v.copy(this.w).cross(_r).add(this.vel);
    const vt = vp2.addScaledVector(nrm, -vp2.dot(nrm));
    const vtl = vt.length();
    if (vtl < 1e-4) return;
    const tdir = vt.divideScalar(vtl);
    const rt = _a.crossVectors(_r, tdir);
    const kt = 1 / this.m + tdir.dot(_b.copy(this.#iinv(rt, _b)).cross(_r));
    const jt = Math.min(mu * j, vtl / kt);
    this.impulse(_t.copy(tdir).multiplyScalar(-jt), P);
  }

  /**
   * A blast nearby: an upward and outward shove at the hull point nearest the burst, so a big
   * enough one rocks a car, lifts it or turns it over (and turns a flipped one back).
   */
  blast(point, radius, knock) {
    let best = null, bd = Infinity;
    for (const L of this.hull) { const P = this.point(L, _p); const d = P.distanceToSquared(point); if (d < bd) { bd = d; best = L; } }
    const at = this.point(best, _t), dist = Math.sqrt(bd);
    if (dist > radius) return;
    const k = Math.max(0, (knock ?? 10) - 4) * (1 - dist / radius) * this.m * (this.C.blast ?? 0.3);   // a grenade rocks it, a shell or a strike turns it over
    const dir = _f.subVectors(at, point); dir.y = Math.max(0.6, dir.y + 0.8);
    this.impulse(dir.normalize().multiplyScalar(k), at);
  }

  /** Moved from outside (a relocation, a test): the body goes with it, as it was. */
  teleport(p) { this.c.add(_v.subVectors(p, this.base)); this.#sync(); }

  /** Put it back on its wheels where it lies (a crew pushing it over), a hand's height up. */
  rightIt() {
    this.q.setFromAxisAngle(UP, this.yaw);
    this.w.set(0, 0, 0); this.vel.set(0, 0, 0);
    this.c.y += 0.4;
    this.#sync();
  }

  /** The hub of a wheel in the body frame (for the views): the strut's length, steer and spin. */
  hub(wh, out) { return out.copy(wh.mount).setY(wh.mount.y - wh.len); }
}

const _s2 = new Vector3(), _qc = new Quaternion(), _F = new Vector3(), _T = new Vector3(), _pv = new Vector3();
/** The faces of a box a point can leave by: -x, +x, -z, +z, the top. */
const FACE = [new Vector3(-1, 0, 0), new Vector3(1, 0, 0), new Vector3(0, 0, -1), new Vector3(0, 0, 1), new Vector3(0, 1, 0)];
