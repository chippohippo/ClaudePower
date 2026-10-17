// Ragdoll: a deterministic particle-and-constraint body for blasts, critical hits, downs and
// deaths. HD2: an explosion throws a soldier as a full ragdoll, and where the body lands is
// where you are. Simulation code: plain arithmetic on typed arrays, so the server and every
// client throw the same body the same way (~3 µs per body per tick).
//
// 16 particles at the procedural rig's joints (ProceduralHumanoid's `j`, plus the chest), so the
// view can draw the body straight from them. Each tick: verlet integration, then position-based
// constraint passes:
//  * bones (rigid): spine, neck, hips, shoulders, thighs, shins, upper arms, forearms;
//  * braces (soft): the torso's sides and diagonals and the head's, so the trunk can twist a
//    little but never folds flat;
//  * limits (one-sided): knees and elbows hinge one way only, hips don't hyperextend or cross,
//    limbs don't fold through each other or the trunk, the head stays above the neck.
// Collision: the terrain heightfield and cover boxes, with friction and no bounce. It sleeps once
// it rests (or after `maxTime`), and impulses wake it.
//
// Poses (data/movement.json ragdoll.poses) are body-local [right, up, forward] joint positions
// taken from the rig in each stance (tests keep them in sync), so a body starts limp in exactly
// the shape it was animated in.
// `drive` (optional, physics/RagdollDrive.js): muscles. They pull the joints each tick before the
// constraint passes, so the falling body folds, reaches for the ground, clutches its wound.

export const J = Object.freeze({
  PELVIS: 0, NECK: 1, HEAD: 2, HIP_L: 3, HIP_R: 4, KNEE_L: 5, KNEE_R: 6, ANKLE_L: 7, ANKLE_R: 8,
  SHOULDER_L: 9, SHOULDER_R: 10, ELBOW_L: 11, ELBOW_R: 12, HAND_L: 13, HAND_R: 14, CHEST: 15,
});
const N = 16;
// Relative masses and collision radii per particle (J order).
const MASS = [10, 7, 4, 5, 5, 4, 4, 2.5, 2.5, 4, 4, 2, 2, 1, 1, 10];
const RADIUS = [0.14, 0.12, 0.12, 0.09, 0.09, 0.07, 0.07, 0.06, 0.06, 0.08, 0.08, 0.06, 0.06, 0.05, 0.05, 0.15];
const { PELVIS: P, NECK: NK, HEAD: H, HIP_L: HL, HIP_R: HR, KNEE_L: KL, KNEE_R: KR, ANKLE_L: AL, ANKLE_R: AR,
  SHOULDER_L: SL, SHOULDER_R: SR, ELBOW_L: EL, ELBOW_R: ER, HAND_L: WL, HAND_R: WR, CHEST: C } = J;

// [a, b, stiffness]: equality constraints. Rest lengths come from the stand pose.
const LINKS = [
  // spine and head
  [P, C, 1], [C, NK, 1], [P, NK, 0.6], [NK, H, 1],
  // pelvis and shoulder girdles
  [P, HL, 1], [P, HR, 1], [HL, HR, 1], [C, HL, 0.8], [C, HR, 0.8],
  [NK, SL, 1], [NK, SR, 1], [SL, SR, 1], [C, SL, 0.9], [C, SR, 0.9],
  // trunk braces: sides stiff, diagonals soft (a little twist), head on the shoulders (a little nod)
  [HL, SL, 0.5], [HR, SR, 0.5], [HL, SR, 0.25], [HR, SL, 0.25], [H, SL, 0.35], [H, SR, 0.35],
  // limbs
  [HL, KL, 1], [KL, AL, 1], [HR, KR, 1], [KR, AR, 1],
  [SL, EL, 1], [EL, WL, 1], [SR, ER, 1], [ER, WR, 1],
];
// [a, b, min distance]: things that must not fold into each other.
const SPREAD = [
  [HL, AL, 0.3], [HR, AR, 0.3],            // knees fold to ~140° at most
  [SL, WL, 0.13], [SR, WR, 0.13],          // elbows fold to ~150°
  [KL, KR, 0.15], [AL, AR, 0.13],          // legs don't pass through each other
  [H, P, 0.5],                             // neck and spine flexion
  [KL, C, 0.28], [KR, C, 0.28],            // thighs don't fold into the chest
  [WL, C, 0.16], [WR, C, 0.16], [EL, C, 0.16], [ER, C, 0.16], // arms stay outside the trunk
  [KL, H, 0.35], [KR, H, 0.35], [AL, H, 0.35], [AR, H, 0.35],
];

// Flat copies of the tables for the inner loops (no destructuring per constraint per iteration).
const LA = Int32Array.from(LINKS, (l) => l[0]), LB = Int32Array.from(LINKS, (l) => l[1]), LS = Float64Array.from(LINKS, (l) => l[2]);
const SA = Int32Array.from(SPREAD, (l) => l[0]), SB = Int32Array.from(SPREAD, (l) => l[1]);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Ragdoll {
  /** @param {object} cfg data/movement.json `ragdoll` */
  constructor(cfg) {
    this.cfg = cfg;
    this.x = new Float64Array(N); this.y = new Float64Array(N); this.z = new Float64Array(N);
    this.px = new Float64Array(N); this.py = new Float64Array(N); this.pz = new Float64Array(N);
    this.sx = new Float64Array(N); this.sy = new Float64Array(N); this.sz = new Float64Array(N); // positions at the start of the last step (render interpolation)
    this.w = Float64Array.from(MASS, (m) => 1 / m);                   // inverse masses
    this.r = Float64Array.from(RADIUS);
    this.rest = new Float64Array(LINKS.length);
    this.minD = new Float64Array(SPREAD.length);
    this.cn = new Float64Array(N * 3);                                 // contact normal per particle (0 = none)
    this.contact = new Uint8Array(N);
    this.scale = 1;
    this.time = 0; this.restT = 0; this.asleep = true;
    this.grounded = false;
    this.lims = { thigh: 0.45, upperArm: 0.29 };
    // Body frames, refreshed by #frames(): pelvis (r, d, n) and chest (r, d, n), plus each
    // frame's right axis pointing out of the left and right side (for the side limits).
    this.fp = { r: [0, 0, 0], d: [0, 0, 0], n: [0, 0, 0] };
    this.fc = { r: [0, 0, 0], d: [0, 0, 0], n: [0, 0, 0] };
    this.out = { p: [[0, 0, 0], [0, 0, 0]], c: [[0, 0, 0], [0, 0, 0]] };
    this.near = [];
  }

  // ---------------------------------------------------------------- setup
  /**
   * Place the body in a stance pose and give it a velocity.
   * @param {string} pose  'stand' | 'crouch' | 'prone' | 'supine'
   * @param {{x,y,z}} root ground point under the body
   * @param {number} yaw   body yaw (forward at yaw 0 is -Z)
   * @param {number} scale silhouette scale
   * @param {{x,y,z}} vel  initial velocity (m/s)
   * @param {object} collider { groundAt(x, z) }
   */
  init(pose, root, yaw, scale = 1, vel = null, collider = null) {
    const cfg = this.cfg, tpl = local(cfg.poses[pose] ?? cfg.poses.stand), stand = local(cfg.poses.stand);
    this.scale = scale;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const dt = 1 / 60;
    for (let i = 0; i < N; i++) {
      const [a, u, f] = tpl[i];
      this.r[i] = RADIUS[i] * scale;
      let x = root.x + (rx * a + fx * f) * scale, y = root.y + u * scale, z = root.z + (rz * a + fz * f) * scale;
      const g = collider ? collider.groundAt(x, z) : -Infinity;
      if (y - this.r[i] < g) y = g + this.r[i];   // the rig lets prone hands dip into the ground
      this.x[i] = x; this.y[i] = y; this.z[i] = z;
      this.px[i] = x - (vel?.x ?? 0) * dt; this.py[i] = y - (vel?.y ?? 0) * dt; this.pz[i] = z - (vel?.z ?? 0) * dt;
      this.sx[i] = x; this.sy[i] = y; this.sz[i] = z;
    }
    // Rest lengths from the stand pose: every stance has the same bones; the trunk straightens.
    const d = (p, q) => Math.hypot(stand[p][0] - stand[q][0], stand[p][1] - stand[q][1], stand[p][2] - stand[q][2]) * scale;
    LINKS.forEach(([a, b], k) => { this.rest[k] = d(a, b); });
    SPREAD.forEach(([, , m], k) => { this.minD[k] = m * scale; });
    this.lims.thigh = d(HL, KL); this.lims.upperArm = d(SL, EL);
    this.time = 0; this.restT = 0; this.asleep = false; this.grounded = false;
    this.contact.fill(0);
    this.origin = { x: this.x[P], y: this.y[P], z: this.z[P] };   // pelvis where it went limp (views blend from here)
  }

  /**
   * Add a velocity change (m/s). With `at`, particles near that point get more of it (a bullet
   * spins the body, a blast at the feet sweeps the legs out); `focus` 0..1 is how concentrated
   * it is (0 = uniform push). The body's mean velocity change is exactly (vx, vy, vz).
   */
  applyImpulse(vx, vy, vz, at = null, focus = 0.4) {
    const dt = 1 / 60;
    let total = 0, wsum = 0;
    const k = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let w = 1;
      if (at) {
        const dd = Math.hypot(this.x[i] - at.x, this.y[i] - at.y, this.z[i] - at.z);
        w = (1 - focus) + focus * (2 / (1 + (dd / 0.45) ** 2));
      }
      k[i] = w; total += w / this.w[i]; wsum += 1 / this.w[i];
    }
    const norm = wsum / total;
    for (let i = 0; i < N; i++) {
      const f = k[i] * norm * dt;
      this.px[i] -= vx * f; this.py[i] -= vy * f; this.pz[i] -= vz * f;
    }
    this.asleep = false; this.restT = 0;
  }

  // ---------------------------------------------------------------- step
  /**
   * One fixed tick.
   * @param {number} dt
   * @param {object} collider { groundAt(x, z), nearBoxes(minX, minZ, maxX, maxZ) -> boxes[] }
   */
  step(dt, collider) {
    if (this.asleep) return;
    const cfg = this.cfg, x = this.x, y = this.y, z = this.z, px = this.px, py = this.py, pz = this.pz;
    this.time += dt;
    const g = cfg.gravity * dt * dt, keep = 1 - cfg.damping, vmax = cfg.maxSpeed * dt;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < N; i++) {
      this.sx[i] = x[i]; this.sy[i] = y[i]; this.sz[i] = z[i];
      let vx = (x[i] - px[i]) * keep, vy = (y[i] - py[i]) * keep, vz = (z[i] - pz[i]) * keep;
      const sp2 = vx * vx + vy * vy + vz * vz;
      if (sp2 > vmax * vmax) { const s = vmax / Math.sqrt(sp2); vx *= s; vy *= s; vz *= s; }
      px[i] = x[i]; py[i] = y[i]; pz[i] = z[i];
      x[i] += vx; y[i] += vy - g; z[i] += vz;
      const lo = vx < 0 ? x[i] : px[i], hi = vx < 0 ? px[i] : x[i], lz = vz < 0 ? z[i] : pz[i], hz = vz < 0 ? pz[i] : z[i];
      if (lo < minX) minX = lo; if (hi > maxX) maxX = hi; if (lz < minZ) minZ = lz; if (hz > maxZ) maxZ = hz;
    }
    const boxes = collider?.nearBoxes ? collider.nearBoxes(minX - 0.3, minZ - 0.3, maxX + 0.3, maxZ + 0.3) : [];
    this.drive?.apply(this, dt, collider);   // muscles (RagdollDrive): before the bones settle it all
    this.contact.fill(0);
    for (let it = 0; it < cfg.iterations; it++) {
      this.#links();
      this.#spread();
      this.#frames();
      this.#limits();
      this.#collide(collider, boxes);
    }
    this.#friction(cfg.friction);
    // Rest detection: slow everywhere (and touching something) for sleepTime, or out of time.
    let vm2 = 0, any = false;
    for (let i = 0; i < N; i++) {
      const dx = x[i] - px[i], dy = y[i] - py[i], dz = z[i] - pz[i], d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > vm2) vm2 = d2;
      if (this.contact[i]) any = true;
    }
    this.grounded = any;
    const sleepD = cfg.sleepSpeed * dt;
    if (any && vm2 < sleepD * sleepD) this.restT += dt; else this.restT = 0;
    if (this.restT >= cfg.sleepTime || this.time >= cfg.maxTime) {
      this.asleep = true;
      for (let i = 0; i < N; i++) { px[i] = x[i]; py[i] = y[i]; pz[i] = z[i]; }
    }
  }

  #links() {
    const x = this.x, y = this.y, z = this.z, w = this.w, rest = this.rest;
    for (let k = 0; k < LA.length; k++) {
      const a = LA[k], b = LB[k];
      const dx = x[b] - x[a], dy = y[b] - y[a], dz = z[b] - z[a];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-9) continue;
      const s = ((d - rest[k]) / (d * (w[a] + w[b]))) * LS[k];
      x[a] += dx * s * w[a]; y[a] += dy * s * w[a]; z[a] += dz * s * w[a];
      x[b] -= dx * s * w[b]; y[b] -= dy * s * w[b]; z[b] -= dz * s * w[b];
    }
  }

  #spread() {
    const x = this.x, y = this.y, z = this.z, w = this.w, minD = this.minD;
    for (let k = 0; k < SA.length; k++) {
      const a = SA[k], b = SB[k], m = minD[k];
      const dx = x[b] - x[a], dy = y[b] - y[a], dz = z[b] - z[a];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= m * m || d2 < 1e-18) continue;
      const d = Math.sqrt(d2);
      const s = (d - m) / (d * (w[a] + w[b]));
      x[a] += dx * s * w[a]; y[a] += dy * s * w[a]; z[a] += dz * s * w[a];
      x[b] -= dx * s * w[b]; y[b] -= dy * s * w[b]; z[b] -= dz * s * w[b];
    }
  }

  /** Pelvis and chest frames (right, up along the spine, front) from the particles. */
  #frames() {
    const x = this.x, y = this.y, z = this.z, o = this.out;
    frameFrom(x[HR] - x[HL], y[HR] - y[HL], z[HR] - z[HL], x[C] - x[P], y[C] - y[P], z[C] - z[P], this.fp);
    frameFrom(x[SR] - x[SL], y[SR] - y[SL], z[SR] - z[SL], x[NK] - x[C], y[NK] - y[C], z[NK] - z[C], this.fc);
    for (let k = 0; k < 3; k++) {
      o.p[0][k] = -this.fp.r[k]; o.p[1][k] = this.fp.r[k];
      o.c[0][k] = -this.fc.r[k]; o.c[1][k] = this.fc.r[k];
    }
  }

  #limits() {
    const fp = this.fp, fc = this.fc, L = this.lims, o = this.out;
    for (let side = 0; side < 2; side++) {
      const hip = side ? HR : HL, knee = side ? KR : KL, ankle = side ? AR : AL;
      const sh = side ? SR : SL, el = side ? ER : EL, hand = side ? WR : WL;
      // Knee hinge: the knee stays in front of the hip-ankle line (no hyperextension).
      this.#hinge(hip, knee, ankle, fp.n, 0.01, 1);
      // Hip: the thigh doesn't swing far behind the body or across the other leg.
      this.#halfSpace(knee, hip, fp.n, -0.35 * L.thigh);
      this.#halfSpace(knee, hip, o.p[side], -0.12 * L.thigh);
      // Elbow hinge: the elbow never points forward (the forearm folds toward the front). Arms
      // may cross in front of the chest (a rifle's support hand does); SPREAD keeps them out of it.
      this.#hinge(sh, el, hand, fc.n, -0.02, -1);
    }
    // Neck: the head stays on the far side of the neck from the chest.
    this.#halfSpace(H, NK, fc.d, 0.05 * this.scale);
  }

  /**
   * Keep joint `b` on the `sign` side of the line a-c along direction n: sign * (b - m)·n >= min,
   * where m is the closest point to b on segment a-c. Moves b (and a, c by mass).
   */
  #hinge(a, b, c, n, min, sign) {
    const x = this.x, y = this.y, z = this.z;
    const ex = x[c] - x[a], ey = y[c] - y[a], ez = z[c] - z[a];
    const e2 = ex * ex + ey * ey + ez * ez;
    if (e2 < 1e-9) return;
    const t = clamp(((x[b] - x[a]) * ex + (y[b] - y[a]) * ey + (z[b] - z[a]) * ez) / e2, 0, 1);
    const mx = x[a] + ex * t, my = y[a] + ey * t, mz = z[a] + ez * t;
    const off = sign * ((x[b] - mx) * n[0] + (y[b] - my) * n[1] + (z[b] - mz) * n[2]);
    const bad = min * this.scale - off;
    if (bad <= 0) return;
    const w = this.w, wb = w[b], wac = (w[a] + w[c]) * 0.5, k = bad / (wb + wac);
    const nx = n[0] * sign, ny = n[1] * sign, nz = n[2] * sign;
    x[b] += nx * k * wb; y[b] += ny * k * wb; z[b] += nz * k * wb;
    const ka = k * w[a] * 0.5, kc = k * w[c] * 0.5;
    x[a] -= nx * ka; y[a] -= ny * ka; z[a] -= nz * ka;
    x[c] -= nx * kc; y[c] -= ny * kc; z[c] -= nz * kc;
  }

  /** Keep (b - a)·n >= min by moving b along n (a limit relative to a parent joint). */
  #halfSpace(b, a, n, min) {
    const x = this.x, y = this.y, z = this.z;
    const off = (x[b] - x[a]) * n[0] + (y[b] - y[a]) * n[1] + (z[b] - z[a]) * n[2];
    const bad = min - off;
    if (bad <= 0) return;
    const w = this.w, k = bad / (w[a] + w[b]);
    x[b] += n[0] * k * w[b]; y[b] += n[1] * k * w[b]; z[b] += n[2] * k * w[b];
    x[a] -= n[0] * k * w[a]; y[a] -= n[1] * k * w[a]; z[a] -= n[2] * k * w[a];
  }

  #collide(collider, boxes) {
    const x = this.x, y = this.y, z = this.z, r = this.r;
    for (let i = 0; i < N; i++) {
      // Terrain (or the flat ground): push straight up.
      const g = collider ? collider.groundAt(x[i], z[i]) : 0;
      if (y[i] - r[i] < g) { y[i] = g + r[i]; this.#touch(i, 0, 1, 0); }
      // Cover boxes: out along the nearest face.
      for (const b of boxes) {
        const cx = clamp(x[i], b.min.x, b.max.x), cy = clamp(y[i], b.min.y, b.max.y), cz = clamp(z[i], b.min.z, b.max.z);
        const dx = x[i] - cx, dy = y[i] - cy, dz = z[i] - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r[i] * r[i]) continue;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2), s = (r[i] - d) / d;
          x[i] += dx * s; y[i] += dy * s; z[i] += dz * s;
          this.#touch(i, dx / d, dy / d, dz / d);
        } else {
          // Centre inside the box: leave through the closest face.
          const pen = [x[i] - b.min.x, b.max.x - x[i], y[i] - b.min.y, b.max.y - y[i], z[i] - b.min.z, b.max.z - z[i]];
          let best = 3; // prefer the top: bodies end up lying on cover, not stuck in it
          for (let k = 0; k < 6; k++) if (pen[k] < pen[best] - 0.05) best = k;
          const axis = best >> 1, dir = best & 1 ? 1 : -1, push = pen[best] + r[i];
          if (axis === 0) x[i] += dir * push; else if (axis === 1) y[i] += dir * push; else z[i] += dir * push;
          this.#touch(i, axis === 0 ? dir : 0, axis === 1 ? dir : 0, axis === 2 ? dir : 0);
        }
      }
    }
  }

  #touch(i, nx, ny, nz) {
    this.contact[i] = 1;
    this.cn[i * 3] = nx; this.cn[i * 3 + 1] = ny; this.cn[i * 3 + 2] = nz;
  }

  /** Contacts: no bounce (the normal velocity is dropped) and tangential speed loses `mu` per tick. */
  #friction(mu) {
    const x = this.x, y = this.y, z = this.z, px = this.px, py = this.py, pz = this.pz, cn = this.cn;
    for (let i = 0; i < N; i++) {
      if (!this.contact[i]) continue;
      const nx = cn[i * 3], ny = cn[i * 3 + 1], nz = cn[i * 3 + 2];
      const vx = x[i] - px[i], vy = y[i] - py[i], vz = z[i] - pz[i];
      const vn = vx * nx + vy * ny + vz * nz;
      const tx = vx - vn * nx, ty = vy - vn * ny, tz = vz - vn * nz;
      const keepN = vn > 0 ? vn : 0; // separating motion survives, approach is absorbed
      px[i] = x[i] - (tx * (1 - mu) + keepN * nx);
      py[i] = y[i] - (ty * (1 - mu) + keepN * ny);
      pz[i] = z[i] - (tz * (1 - mu) + keepN * nz);
    }
  }

  // ---------------------------------------------------------------- queries
  get(i, out) { return out.set(this.x[i], this.y[i], this.z[i]); }
  /** Interpolated position between the last two ticks (alpha 0 = previous tick). */
  lerp(i, alpha, out) {
    return out.set(this.sx[i] + (this.x[i] - this.sx[i]) * alpha, this.sy[i] + (this.y[i] - this.sy[i]) * alpha, this.sz[i] + (this.z[i] - this.sz[i]) * alpha);
  }
  /** Velocity of a particle over the last tick (m/s). */
  velocity(i, out, dt = 1 / 60) { return out.set((this.x[i] - this.px[i]) / dt, (this.y[i] - this.py[i]) / dt, (this.z[i] - this.pz[i]) / dt); }
  /** Lowest point of the body (bottom of its lowest particle). */
  lowest() { let m = Infinity; for (let i = 0; i < N; i++) m = Math.min(m, this.y[i] - this.r[i]); return m; }
  /** Facing up (on its back)? The chest's front points to the sky. */
  faceUp() { this.#frames(); return this.fc.n[1] > 0; }
  /** Yaw of the head direction along the ground (pelvis → neck), forward at yaw 0 being -Z. */
  headYaw() { return Math.atan2(-(this.x[NK] - this.x[P]), -(this.z[NK] - this.z[P])); }
  /** Pelvis and chest frames: { r, d, n } arrays (right, along the spine, front). */
  frames() { this.#frames(); return { pelvis: this.fp, chest: this.fc }; }

  // ---------------------------------------------------------------- netcode
  serialize() {
    return {
      x: [...this.x], y: [...this.y], z: [...this.z], px: [...this.px], py: [...this.py], pz: [...this.pz],
      scale: this.scale, rest: [...this.rest], minD: [...this.minD], lims: { ...this.lims },
      time: this.time, restT: this.restT, asleep: this.asleep, grounded: this.grounded,
      drive: this.drive?.serialize() ?? null,
    };
  }
  restore(o) {
    for (const k of ['x', 'y', 'z', 'px', 'py', 'pz', 'rest', 'minD']) this[k].set(o[k]);
    this.sx.set(o.x); this.sy.set(o.y); this.sz.set(o.z);
    this.scale = o.scale; this.lims = { ...o.lims };
    for (let i = 0; i < N; i++) this.r[i] = RADIUS[i] * o.scale;
    this.time = o.time; this.restT = o.restT; this.asleep = o.asleep; this.grounded = o.grounded;
    if (o.drive && this.drive) this.drive.restore(o.drive);
  }
}

/** Template rows [right, up, forward] for J order; the chest (not in the rig's joint list) sits 68% up the spine. */
export function local(tpl) {
  if (tpl.length > C) return tpl;
  const p = tpl[P], n = tpl[NK];
  return [...tpl, [p[0] + (n[0] - p[0]) * 0.68, p[1] + (n[1] - p[1]) * 0.68, p[2] + (n[2] - p[2]) * 0.68]];
}

/** Orthonormal frame from a right-ish vector and an up-ish vector: d = up, r ⟂ d, n = d × r (front). */
function frameFrom(rx, ry, rz, ux, uy, uz, F) {
  let l = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
  const dx = ux / l, dy = uy / l, dz = uz / l;
  const k = rx * dx + ry * dy + rz * dz;
  rx -= dx * k; ry -= dy * k; rz -= dz * k;
  l = Math.sqrt(rx * rx + ry * ry + rz * rz);
  if (l < 1e-9) { rx = 1; ry = 0; rz = 0; l = 1; }
  rx /= l; ry /= l; rz /= l;
  F.d[0] = dx; F.d[1] = dy; F.d[2] = dz;
  F.r[0] = rx; F.r[1] = ry; F.r[2] = rz;
  F.n[0] = dy * rz - dz * ry; F.n[1] = dz * rx - dx * rz; F.n[2] = dx * ry - dy * rx;
}
