// RigidWorld: rigid bodies for what comes off a building (world/Structures.js). A wall or a floor
// torn loose swings on what still holds it, sags, tears free, falls, tumbles, smashes and comes
// to rest as rubble. Simulation code: plain arithmetic in a fixed order, so the server and every
// client bring the same building down the same way.
//
//  * Bodies are boxes, or compounds of boxes fixed together (a wall's piers and bands), each with
//    its mass and full inertia tensor from its boxes' sizes and densities.
//  * XPBD (Müller et al. 2020, "Detailed Rigid Body Simulation with Extended Position Based
//    Dynamics"): substeps (6 a tick), a constraint pass each; positions are corrected directly
//    and velocities derived from them, then a velocity pass adds friction and bounce.
//  * Contacts: box on box by separating axes (the incident face clipped against the reference
//    face, up to four points; or edge on edge), for bodies against each other and against the
//    static cover (axis-aligned boxes); bodies' corners and edge points against the terrain.
//    Found once a tick, a little ahead of where the bodies are going (by how far they move in a
//    tick), and measured again every substep from the bodies' poses.
//  * Joints: elastic ball joints from a body to the world or to another body, each with a
//    compliance (how far it stretches per kN) and a strength (the pull it tears at). They tear
//    pulled apart or sheared across the face they hold (`normal`, out of what they're fixed to),
//    never pressed together: concrete takes that. Loaded past its `tire` share of its strength
//    (40%, unless said otherwise) a joint tires and gets weaker while what it holds hangs (its
//    joints carry most of its weight): a body hanging doesn't sleep, so it comes down in the end;
//    one resting on something as well (a ramp onto the floor below) does, and stays.
//    Set at the corners of where a piece was fixed on, they make hinges: a floor
//    let go on three sides tears along its top first (bending pulls the top apart and presses the
//    bottom together) and swings down on its bottom corners.
//  * Bodies at rest sleep: they cost nothing, and touched hard, pushed by a blast or let go of,
//    they wake. One still moving after MAX_T is put to sleep where it is.
// Units: m, s, t (tonnes), kN (so energies are in kJ).

const G = 9.8;
const SUB = 6;                   // substeps a tick (fewer when a lot is moving)
const SLOP = 0.001;              // m of penetration left alone (resting contacts don't jitter)
const CAP = 0.012;               // m a contact corrects per substep at most: an overlap comes apart gently, not explosively
const MU_S = 0.75, MU_D = 0.6;   // friction: concrete on concrete
const BOUNCE = 0.12;
const SLEEP_V = 0.1, SLEEP_W = 0.12, SLEEP_T = 0.45;
const MAX_T = 20;                // s awake at most
const TIRE = 1.4;                // how fast an overloaded joint weakens (per s, per unit of load past its tiring share)
const SHEAR = 0.6;               // a joint's load sheared across its face, against pulled straight off it
const HUNG = 0.65;               // share of its weight its joints hold up, past which a body hangs (its joints tire, it doesn't sleep)
const DAMP_V = 0.02, DAMP_W = 0.15, DAMP_HUNG = 1.5;   // per s; a body hanging from joints swings to a stop
const ROLL = 1.5;                // per s: spin lost while resting on something (a chunk on two points doesn't rock for ever)
const JOINT_DAMP = 40;           // per s: the stretch of a joint doesn't ring
const EDGE = 1.5;                // m between the points along a box's edges that meet the terrain

// ---------------------------------------------------------------- scratch (no allocation in the loops)
const _cp = new Float64Array(9 * 8);    // contact points from obb(): pa, pb, n (from b to a)
const _R = new Float64Array(9), _AR = new Float64Array(9), _t = new Float64Array(3);
const _pa = new Float64Array(48), _pb = new Float64Array(48), _dep = new Float64Array(16);
const _ra = new Float64Array(3), _rb = new Float64Array(3), _qa = new Float64Array(3), _qb = new Float64Array(3);
const _sc = new Float64Array(3), _se = new Float64Array(3), _nrm = new Float64Array(3);
const IDENT = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/** v rotated by quaternion q (x, y, z, w), into out at o. */
function rot(q, vx, vy, vz, out, o = 0) {
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  out[o] = vx + qw * tx + (qy * tz - qz * ty);
  out[o + 1] = vy + qw * ty + (qz * tx - qx * tz);
  out[o + 2] = vz + qw * tz + (qx * ty - qy * tx);
}
/** The rotation matrix of q, row-major. */
function matrix(q, R) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  R[0] = 1 - 2 * (y * y + z * z); R[1] = 2 * (x * y - z * w); R[2] = 2 * (x * z + y * w);
  R[3] = 2 * (x * y + z * w); R[4] = 1 - 2 * (x * x + z * z); R[5] = 2 * (y * z - x * w);
  R[6] = 2 * (x * z - y * w); R[7] = 2 * (y * z + x * w); R[8] = 1 - 2 * (x * x + y * y);
}
function normalize(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l;
}
/** Inverse of a symmetric 3x3 (row-major), into out. */
function inverse3(m, out) {
  const [a, b, c, , e, f, , , i] = m, d = b, g = c, h = f;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1e-12;
  out[0] = A / det; out[1] = -(b * i - c * h) / det; out[2] = (b * f - c * e) / det;
  out[3] = B / det; out[4] = (a * i - c * g) / det; out[5] = -(a * f - c * d) / det;
  out[6] = C / det; out[7] = -(a * h - b * g) / det; out[8] = (a * e - b * d) / det;
}

class Body {
  constructor(id) {
    this.id = id;
    this.boxes = [];                           // { c: local centre, h: half size, rho, meta, pts: terrain points (local), wc: world centre, bb: world bounds, hit }
    this.x = new Float64Array(3); this.q = new Float64Array([0, 0, 0, 1]);
    this.v = new Float64Array(3); this.w = new Float64Array(3);
    this.px = new Float64Array(3); this.pq = new Float64Array(4);   // pose before the substep
    this.rx = new Float64Array(3); this.rq = new Float64Array(4);   // pose before the tick (the views interpolate from it)
    this.v0 = new Float64Array(3); this.w0 = new Float64Array(3);   // velocity before the tick (what a fracture's pieces keep)
    this.m = 0; this.im = 0;
    this.I = new Float64Array(9); this.Ii = new Float64Array(9);    // inertia tensor and its inverse, in the body's frame
    this.Iw = new Float64Array(9);                                    // inverse inertia in the world's
    this.R = new Float64Array(9);                                     // rotation matrix (per substep)
    this.ax = new Float64Array(9);                                    // its axes in the world (rows), for the box tests (per tick)
    this.r = 0;                                                       // bounding radius about the centre of mass
    this.aabb = new Float64Array(6);
    this.margin = 0;
    this.asleep = false; this.sleepT = 0; this.age = 0;
    this.joints = [];
    this.ignore = null;                        // static boxes it doesn't collide with (what it was fixed to, until it's clear of them)
    this.skip = null;                          // bodies it doesn't collide with (the pieces it came away with, until it's clear of them)
    this.ke0 = 0; this.vn = 0;                 // energy before the tick; fastest it hit anything this tick
    this.lift = 0; this.hung = false;          // how hard its joints held it up this tick (summed over substeps); hanging from them
    this.removed = false;
    this.data = null;                          // the host's
  }

  /** Kinetic energy (kJ). */
  get energy() {
    const v = this.v, w = this.w, R = this.R, I = this.I;
    // w in the body's frame: Rᵀ w
    const bx = R[0] * w[0] + R[3] * w[1] + R[6] * w[2], by = R[1] * w[0] + R[4] * w[1] + R[7] * w[2], bz = R[2] * w[0] + R[5] * w[1] + R[8] * w[2];
    const rotE = bx * (I[0] * bx + I[1] * by + I[2] * bz) + by * (I[3] * bx + I[4] * by + I[5] * bz) + bz * (I[6] * bx + I[7] * by + I[8] * bz);
    return 0.5 * this.m * (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) + 0.5 * rotE;
  }

  /** World position of local point (lx, ly, lz) into out. */
  toWorld(lx, ly, lz, out, o = 0) { rot(this.q, lx, ly, lz, out, o); out[o] += this.x[0]; out[o + 1] += this.x[1]; out[o + 2] += this.x[2]; return out; }
  /** Local position of world point p into out. */
  toLocal(px, py, pz, out) {
    const q = this.q, x = px - this.x[0], y = py - this.x[1], z = pz - this.x[2];
    const iq = _iq; iq[0] = -q[0]; iq[1] = -q[1]; iq[2] = -q[2]; iq[3] = q[3];
    rot(iq, x, y, z, out);
    return out;
  }
  /** Velocity of the body at world point p into out. */
  velocityAt(px, py, pz, out) {
    const rx = px - this.x[0], ry = py - this.x[1], rz = pz - this.x[2], w = this.w, v = this.v;
    out[0] = v[0] + w[1] * rz - w[2] * ry; out[1] = v[1] + w[2] * rx - w[0] * rz; out[2] = v[2] + w[0] * ry - w[1] * rx;
    return out;
  }
}
const _iq = new Float64Array(4);

/** The generalized inverse mass of b at world offset r along direction n (0 for the world). */
function invMass(b, rx, ry, rz, nx, ny, nz) {
  if (!b) return 0;
  const cx = ry * nz - rz * ny, cy = rz * nx - rx * nz, cz = rx * ny - ry * nx, W = b.Iw;
  return b.im + cx * (W[0] * cx + W[1] * cy + W[2] * cz) + cy * (W[3] * cx + W[4] * cy + W[5] * cz) + cz * (W[6] * cx + W[7] * cy + W[8] * cz);
}
/** A positional impulse p at world offset r: moves and turns b. */
function shove(b, rx, ry, rz, px, py, pz) {
  const x = b.x, im = b.im, W = b.Iw, q = b.q;
  x[0] += px * im; x[1] += py * im; x[2] += pz * im;
  const cx = ry * pz - rz * py, cy = rz * px - rx * pz, cz = rx * py - ry * px;
  const ox = 0.5 * (W[0] * cx + W[1] * cy + W[2] * cz), oy = 0.5 * (W[3] * cx + W[4] * cy + W[5] * cz), oz = 0.5 * (W[6] * cx + W[7] * cy + W[8] * cz);
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  q[0] = qx + ox * qw + oy * qz - oz * qy;
  q[1] = qy + oy * qw + oz * qx - ox * qz;
  q[2] = qz + oz * qw + ox * qy - oy * qx;
  q[3] = qw - ox * qx - oy * qy - oz * qz;
  // (Not normalized here: these turns are small, and #velocities normalizes once a substep.)
}
/** A velocity impulse p at world offset r. */
function kick(b, rx, ry, rz, px, py, pz) {
  const v = b.v, w = b.w, im = b.im, W = b.Iw;
  v[0] += px * im; v[1] += py * im; v[2] += pz * im;
  const cx = ry * pz - rz * py, cy = rz * px - rx * pz, cz = rx * py - ry * px;
  w[0] += W[0] * cx + W[1] * cy + W[2] * cz; w[1] += W[3] * cx + W[4] * cy + W[5] * cz; w[2] += W[6] * cx + W[7] * cy + W[8] * cz;
}

// ---------------------------------------------------------------- box against box
/**
 * Contacts between oriented boxes a (centre ca, axes ua: three unit rows, half sizes ea) and b,
 * a little apart allowed (margin): writes [pa, pb, n] per point to _cp (pa on a, pb on b, n from b
 * to a: (pb - pa)·n is how deep they're into each other) and returns how many (0 to 4).
 */
function obb(ca, ua, ea, cb, ub, eb, margin) {
  const Tx = cb[0] - ca[0], Ty = cb[1] - ca[1], Tz = cb[2] - ca[2], R = _R, AR = _AR, t = _t;
  for (let i = 0; i < 3; i++) {
    const ax = ua[i * 3], ay = ua[i * 3 + 1], az = ua[i * 3 + 2];
    t[i] = Tx * ax + Ty * ay + Tz * az;
    for (let j = 0; j < 3; j++) { const r = ax * ub[j * 3] + ay * ub[j * 3 + 1] + az * ub[j * 3 + 2]; R[i * 3 + j] = r; AR[i * 3 + j] = Math.abs(r) + 1e-6; }
  }
  let fa = -Infinity, ia = 0, fb = -Infinity, jb = 0, fe = -Infinity, ei = 0, ej = 0;
  for (let i = 0; i < 3; i++) {
    const s = Math.abs(t[i]) - ea[i] - (eb[0] * AR[i * 3] + eb[1] * AR[i * 3 + 1] + eb[2] * AR[i * 3 + 2]);
    if (s > margin) return 0;
    if (s > fa) { fa = s; ia = i; }
  }
  for (let j = 0; j < 3; j++) {
    const s = Math.abs(t[0] * R[j] + t[1] * R[3 + j] + t[2] * R[6 + j]) - (ea[0] * AR[j] + ea[1] * AR[3 + j] + ea[2] * AR[6 + j]) - eb[j];
    if (s > margin) return 0;
    if (s > fb) { fb = s; jb = j; }
  }
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const len = Math.sqrt(Math.max(0, 1 - R[i * 3 + j] * R[i * 3 + j]));   // |a_i × b_j|
    if (len < 1e-3) continue;                                           // parallel edges: the faces have it
    const i1 = (i + 1) % 3, i2 = (i + 2) % 3, j1 = (j + 1) % 3, j2 = (j + 2) % 3;
    const ra = ea[i1] * AR[i2 * 3 + j] + ea[i2] * AR[i1 * 3 + j], rb = eb[j1] * AR[i * 3 + j2] + eb[j2] * AR[i * 3 + j1];
    const s = (Math.abs(t[i2] * R[i1 * 3 + j] - t[i1] * R[i2 * 3 + j]) - ra - rb) / len;
    if (s > margin) return 0;
    if (s > fe) { fe = s; ei = i; ej = j; }
  }
  // Faces make a steadier footing than edges: an edge wins only when it's clearly the way apart.
  if (fe > Math.max(fa, fb) + 0.01) return edgeEdge(ca, ua, ea, cb, ub, eb, ei, ej, Tx, Ty, Tz);
  if (fb > fa + 0.005) {
    const sg = t[0] * R[jb] + t[1] * R[3 + jb] + t[2] * R[6 + jb] > 0 ? -1 : 1;   // b's face towards a
    return faceContacts(cb, ub, eb, jb, sg, ca, ua, ea, margin, true);
  }
  return faceContacts(ca, ua, ea, ia, t[ia] > 0 ? 1 : -1, cb, ub, eb, margin, false);
}

/**
 * The reference box's face (axis k, side sg) against the other box's face most turned towards it,
 * clipped to the reference face. `swap`: the reference is b (points written the other way round).
 */
function faceContacts(cr, ur, er, k, sg, ci, ui, ei, margin, swap) {
  const nx = sg * ur[k * 3], ny = sg * ur[k * 3 + 1], nz = sg * ur[k * 3 + 2];   // out of the reference face
  // The incident face: the other box's face whose normal is most against n.
  let jm = 0, best = -1;
  for (let j = 0; j < 3; j++) { const d = Math.abs(ui[j * 3] * nx + ui[j * 3 + 1] * ny + ui[j * 3 + 2] * nz); if (d > best) { best = d; jm = j; } }
  const s2 = ui[jm * 3] * nx + ui[jm * 3 + 1] * ny + ui[jm * 3 + 2] * nz > 0 ? -1 : 1;
  const j1 = (jm + 1) % 3, j2 = (jm + 2) % 3;
  const fx = ci[0] + s2 * ei[jm] * ui[jm * 3], fy = ci[1] + s2 * ei[jm] * ui[jm * 3 + 1], fz = ci[2] + s2 * ei[jm] * ui[jm * 3 + 2];
  const ux = ui[j1 * 3] * ei[j1], uy = ui[j1 * 3 + 1] * ei[j1], uz = ui[j1 * 3 + 2] * ei[j1];
  const vx = ui[j2 * 3] * ei[j2], vy = ui[j2 * 3 + 1] * ei[j2], vz = ui[j2 * 3 + 2] * ei[j2];
  let P = _pa, Q = _pb, n = 4;
  P[0] = fx + ux + vx; P[1] = fy + uy + vy; P[2] = fz + uz + vz;
  P[3] = fx - ux + vx; P[4] = fy - uy + vy; P[5] = fz - uz + vz;
  P[6] = fx - ux - vx; P[7] = fy - uy - vy; P[8] = fz - uz - vz;
  P[9] = fx + ux - vx; P[10] = fy + uy - vy; P[11] = fz + uz - vz;
  // Clip to the reference face's sides (Sutherland-Hodgman, four planes).
  for (let s = 1; s <= 2; s++) {
    const a = (k + s) % 3, ax = ur[a * 3], ay = ur[a * 3 + 1], az = ur[a * 3 + 2], c0 = ax * cr[0] + ay * cr[1] + az * cr[2], e = er[a];
    for (let side = -1; side <= 1; side += 2) {
      let m = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const di = side * (P[i * 3] * ax + P[i * 3 + 1] * ay + P[i * 3 + 2] * az - c0) - e, dj = side * (P[j * 3] * ax + P[j * 3 + 1] * ay + P[j * 3 + 2] * az - c0) - e;
        if (di <= 0) { Q[m * 3] = P[i * 3]; Q[m * 3 + 1] = P[i * 3 + 1]; Q[m * 3 + 2] = P[i * 3 + 2]; m++; }
        if ((di <= 0) !== (dj <= 0)) {
          const u = di / (di - dj);
          Q[m * 3] = P[i * 3] + (P[j * 3] - P[i * 3]) * u; Q[m * 3 + 1] = P[i * 3 + 1] + (P[j * 3 + 1] - P[i * 3 + 1]) * u; Q[m * 3 + 2] = P[i * 3 + 2] + (P[j * 3 + 2] - P[i * 3 + 2]) * u;
          m++;
        }
      }
      const T = P; P = Q; Q = T; n = m;
      if (!n) return 0;
    }
  }
  // How deep each point is under the reference face; keep those touching or nearly.
  const off = nx * cr[0] + ny * cr[1] + nz * cr[2] + er[k];
  let m = 0;
  for (let i = 0; i < n; i++) {
    const d = off - (nx * P[i * 3] + ny * P[i * 3 + 1] + nz * P[i * 3 + 2]);
    if (d < -margin) continue;
    P[m * 3] = P[i * 3]; P[m * 3 + 1] = P[i * 3 + 1]; P[m * 3 + 2] = P[i * 3 + 2]; _dep[m] = d; m++;
  }
  const keep = reduce(P, m, nx, ny, nz);
  for (let k2 = 0; k2 < keep.length; k2++) {
    const i = keep[k2], o = k2 * 9, d = _dep[i], px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
    // The incident point, and where it is on the reference face.
    const rx = px + nx * d, ry = py + ny * d, rz = pz + nz * d;
    if (!swap) { _cp[o] = rx; _cp[o + 1] = ry; _cp[o + 2] = rz; _cp[o + 3] = px; _cp[o + 4] = py; _cp[o + 5] = pz; _cp[o + 6] = -nx; _cp[o + 7] = -ny; _cp[o + 8] = -nz; }
    else { _cp[o] = px; _cp[o + 1] = py; _cp[o + 2] = pz; _cp[o + 3] = rx; _cp[o + 4] = ry; _cp[o + 5] = rz; _cp[o + 6] = nx; _cp[o + 7] = ny; _cp[o + 8] = nz; }
  }
  return keep.length;
}

const _keep = [];
/** At most four of the n points: the deepest, the furthest from it, and the furthest either side of the line through those. */
function reduce(P, n, nx, ny, nz) {
  _keep.length = 0;
  if (n <= 4) { for (let i = 0; i < n; i++) _keep.push(i); return _keep; }
  let a = 0;
  for (let i = 1; i < n; i++) if (_dep[i] > _dep[a]) a = i;
  let b = -1, bd = -1;
  for (let i = 0; i < n; i++) { const d = (P[i * 3] - P[a * 3]) ** 2 + (P[i * 3 + 1] - P[a * 3 + 1]) ** 2 + (P[i * 3 + 2] - P[a * 3 + 2]) ** 2; if (d > bd) { bd = d; b = i; } }
  let c = -1, cs = 0, e = -1, es = 0;
  const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
  for (let i = 0; i < n; i++) {
    const wx = P[i * 3] - P[a * 3], wy = P[i * 3 + 1] - P[a * 3 + 1], wz = P[i * 3 + 2] - P[a * 3 + 2];
    const s = (uy * wz - uz * wy) * nx + (uz * wx - ux * wz) * ny + (ux * wy - uy * wx) * nz;
    if (s > cs) { cs = s; c = i; }
    if (s < es) { es = s; e = i; }
  }
  _keep.push(a, b);
  if (c >= 0) _keep.push(c);
  if (e >= 0) _keep.push(e);
  return _keep;
}

/** Edge a_i of a against edge b_j of b: one point, the closest two points of the two edges. */
function edgeEdge(ca, ua, ea, cb, ub, eb, i, j, Tx, Ty, Tz) {
  const aix = ua[i * 3], aiy = ua[i * 3 + 1], aiz = ua[i * 3 + 2], bjx = ub[j * 3], bjy = ub[j * 3 + 1], bjz = ub[j * 3 + 2];
  let Lx = aiy * bjz - aiz * bjy, Ly = aiz * bjx - aix * bjz, Lz = aix * bjy - aiy * bjx;
  const l = Math.hypot(Lx, Ly, Lz) || 1;
  Lx /= l; Ly /= l; Lz /= l;
  if (Tx * Lx + Ty * Ly + Tz * Lz < 0) { Lx = -Lx; Ly = -Ly; Lz = -Lz; }   // from a towards b
  // a's edge furthest towards b, b's furthest towards a.
  let pax = ca[0], pay = ca[1], paz = ca[2], pbx = cb[0], pby = cb[1], pbz = cb[2];
  for (let k = 0; k < 3; k++) {
    if (k !== i) { const s = ua[k * 3] * Lx + ua[k * 3 + 1] * Ly + ua[k * 3 + 2] * Lz > 0 ? ea[k] : -ea[k]; pax += ua[k * 3] * s; pay += ua[k * 3 + 1] * s; paz += ua[k * 3 + 2] * s; }
    if (k !== j) { const s = ub[k * 3] * Lx + ub[k * 3 + 1] * Ly + ub[k * 3 + 2] * Lz > 0 ? -eb[k] : eb[k]; pbx += ub[k * 3] * s; pby += ub[k * 3 + 1] * s; pbz += ub[k * 3 + 2] * s; }
  }
  // Closest points of the lines pa + s a_i and pb + u b_j, held to the edges.
  const rx = pax - pbx, ry = pay - pby, rz = paz - pbz;
  const b = aix * bjx + aiy * bjy + aiz * bjz, c = aix * rx + aiy * ry + aiz * rz, f = bjx * rx + bjy * ry + bjz * rz;
  const den = 1 - b * b;
  let s = den > 1e-9 ? (b * f - c) / den : 0;
  s = Math.max(-ea[i], Math.min(ea[i], s));
  let u = Math.max(-eb[j], Math.min(eb[j], b * s + f));
  s = Math.max(-ea[i], Math.min(ea[i], b * u - c));
  _cp[0] = pax + aix * s; _cp[1] = pay + aiy * s; _cp[2] = paz + aiz * s;
  _cp[3] = pbx + bjx * u; _cp[4] = pby + bjy * u; _cp[5] = pbz + bjz * u;
  _cp[6] = -Lx; _cp[7] = -Ly; _cp[8] = -Lz;
  return 1;
}

// ---------------------------------------------------------------- the world
export class RigidWorld {
  /**
   * @param {object} o
   *   ground(x, z): the terrain's height (none: flat at 0); normal(x, z, out): its normal;
   *   statics(x0, z0, x1, z1, cb): calls cb(box) for the static boxes ({min, max}) over a rectangle
   *   (a box with `body` set is a resting body's own stand-in, and is skipped).
   */
  constructor({ ground = null, normal = null, statics = null, substeps = SUB } = {}) {
    this.ground = ground; this.normal = normal; this.statics = statics;
    this.sub = substeps;
    this.bodies = [];             // all of them, awake and asleep (sorted along x each tick)
    this.awake = [];
    this.joints = [];
    this.cs = [];                 // contacts (a pool: the first nc are this tick's)
    this.nc = 0;
    this.version = 0;             // bumped when a body is added or removed (the views resync)
    this.nextId = 1;
    this.time = 0;
    // What happened, for the host (it empties them): bodies that went to sleep and woke, joints
    // torn, and hits ({ b, energy: kJ it lost, speed: m/s it came in at, at, statics: the static boxes it hit }).
    this.slept = []; this.woke = []; this.torn = []; this.hits = [];
    this.wakeNext = [];
  }

  // ---------------------------------------------------------------- bodies
  /**
   * A body of boxes, given as world boxes ({ min, max, density (t/m³), meta }) at rest. Returns it.
   * @param {object} o { v, w: initial velocity and spin, ignore: static boxes not to collide with }
   */
  addBody(boxes, { v = null, w = null, ignore = null, data = null } = {}) {
    const local = boxes.map((b) => ({
      c: [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2],
      h: [(b.max.x - b.min.x) / 2, (b.max.y - b.min.y) / 2, (b.max.z - b.min.z) / 2], rho: b.density ?? 2.4, meta: b.meta ?? null,
    }));
    const body = this.#make(local, [0, 0, 0], [0, 0, 0, 1]);
    if (v) body.v.set(v);
    if (w) body.w.set(w);
    if (ignore?.length) body.ignore = new Set(ignore);
    body.data = data;
    return body;
  }

  /** A body from boxes in a frame at (o, q): its centre of mass, inertia, and the boxes about it. */
  #make(boxes, o, q) {
    const b = new Body(this.nextId++);
    let m = 0, cx = 0, cy = 0, cz = 0;
    for (const k of boxes) { k.m = 8 * k.h[0] * k.h[1] * k.h[2] * k.rho; m += k.m; cx += k.m * k.c[0]; cy += k.m * k.c[1]; cz += k.m * k.c[2]; }
    m = Math.max(m, 1e-3); cx /= m; cy /= m; cz /= m;
    const I = b.I;
    let r = 0;
    for (const k of boxes) {
      const [hx, hy, hz] = k.h, dx = k.c[0] - cx, dy = k.c[1] - cy, dz = k.c[2] - cz, d2 = dx * dx + dy * dy + dz * dz;
      I[0] += (k.m * (hy * hy + hz * hz)) / 3 + k.m * (d2 - dx * dx); I[4] += (k.m * (hx * hx + hz * hz)) / 3 + k.m * (d2 - dy * dy); I[8] += (k.m * (hx * hx + hy * hy)) / 3 + k.m * (d2 - dz * dz);
      I[1] -= k.m * dx * dy; I[2] -= k.m * dx * dz; I[5] -= k.m * dy * dz;
      const c = [dx, dy, dz];
      b.boxes.push({ c, h: k.h.slice(), rho: k.rho, m: k.m, meta: k.meta, pts: points(c, k.h), wc: new Float64Array(3), bb: new Float64Array(6), hit: false });
      r = Math.max(r, Math.sqrt(d2) + Math.hypot(hx, hy, hz));
    }
    I[3] = I[1]; I[6] = I[2]; I[7] = I[5];
    inverse3(I, b.Ii);
    b.m = m; b.im = 1 / m; b.r = r;
    b.q.set(q);
    rot(b.q, cx, cy, cz, b.x);
    b.x[0] += o[0]; b.x[1] += o[1]; b.x[2] += o[2];
    b.rx.set(b.x); b.rq.set(b.q); b.px.set(b.x); b.pq.set(b.q);
    this.#frame(b);
    this.bodies.push(b);
    this.awake.push(b);
    this.version++;
    return b;
  }

  /** a and b don't collide while they touch (they were one piece): they're held together by joints, if anything. */
  apart(a, b) { (a.skip ??= new Set()).add(b); (b.skip ??= new Set()).add(a); }

  /** Take a body out (and the joints on it). */
  remove(b) {
    if (b.removed) return;
    b.removed = true;
    if (b.skip) for (const o of b.skip) o.skip?.delete(b);
    for (const j of b.joints) this.#drop(j);
    b.joints.length = 0;
    const i = this.bodies.indexOf(b); if (i >= 0) this.bodies.splice(i, 1);
    const k = this.awake.indexOf(b); if (k >= 0) this.awake.splice(k, 1);
    this.version++;
  }

  wake(b) {
    if (!b.asleep || b.removed) return;
    b.asleep = false; b.sleepT = 0; b.age = Math.min(b.age, MAX_T * 0.5);
    this.awake.push(b);
    this.woke.push(b);
    for (const j of b.joints) { const o = j.a === b ? j.b : j.a; if (o?.asleep) this.wake(o); }
  }

  /**
   * Break body b into pieces, each a list of boxes in b's frame ({ c, h, rho, meta }). A piece that
   * was in this tick's impact moves on as b does now; one that wasn't, as b was moving before it
   * (the end of a wall that hit the ground first carries on over). Joints go with the piece their
   * point is in. Returns the pieces.
   */
  fracture(b, pieces, { hit = null } = {}) {
    if (b.removed) return [];
    const out = [];
    const v = new Float64Array(3);
    for (const boxes of pieces) {
      const p = this.#make(boxes.map((k) => ({ c: k.c.slice(), h: k.h.slice(), rho: k.rho, meta: k.meta })), b.x, b.q);
      // (#make put its centre of mass in the world from b's frame.)
      const struck = hit ? hit(boxes) : true;
      const V = struck ? b.v : b.v0, W = struck ? b.w : b.w0;
      const rx = p.x[0] - b.x[0], ry = p.x[1] - b.x[1], rz = p.x[2] - b.x[2];
      v[0] = V[0] + W[1] * rz - W[2] * ry; v[1] = V[1] + W[2] * rx - W[0] * rz; v[2] = V[2] + W[0] * ry - W[1] * rx;
      p.v.set(v); p.w.set(W);
      // It was drawn where b was at the start of the tick: carry that on, so the view doesn't jump.
      const L = _ra; b.toLocal(p.x[0], p.x[1], p.x[2], L);
      rot(b.rq, L[0], L[1], L[2], p.rx); p.rx[0] += b.rx[0]; p.rx[1] += b.rx[1]; p.rx[2] += b.rx[2];
      p.rq.set(b.rq);
      if (b.ignore) p.ignore = new Set(b.ignore);
      if (b.skip) for (const o of b.skip) this.apart(p, o);
      p.data = b.data; p.age = b.age;
      out.push(p);
    }
    // Each joint on b goes to the piece nearest its point.
    for (const j of [...b.joints]) {
      const mine = j.a === b, la = mine ? j.la : j.lb, wp = b.toWorld(la[0], la[1], la[2], _qa);
      let best = null, bd = Infinity;
      for (const p of out) {
        const L = p.toLocal(wp[0], wp[1], wp[2], _qb);
        let d = Infinity;
        for (const k of p.boxes) d = Math.min(d, Math.max(Math.abs(L[0] - k.c[0]) - k.h[0], Math.abs(L[1] - k.c[1]) - k.h[1], Math.abs(L[2] - k.c[2]) - k.h[2]));
        if (d < bd) { bd = d; best = p; }
      }
      if (!best || bd > 0.3) { this.#drop(j); continue; }
      const L = best.toLocal(wp[0], wp[1], wp[2], new Float64Array(3));
      if (mine) { j.a = best; j.la = L; } else { j.b = best; j.lb = L; }
      best.joints.push(j);
    }
    b.joints.length = 0;
    this.remove(b);
    return out;
  }

  // ---------------------------------------------------------------- joints
  /**
   * An elastic ball joint at world point p between body a and body b (null: the world, there).
   * @param {object} o { strength: kN it tears at, stretch: m it stretches before it does (its
   *   compliance), normal: {x, y, z} out of what it's fixed to into a (none: any pull tears it),
   *   tire: the share of its strength past which it tires, box: the static box it's fixed to }
   */
  joint(a, p, b = null, { strength = 100, stretch = 0.02, normal = null, tire = 0.4, box = null, data = null } = {}) {
    const la = a.toLocal(p.x, p.y, p.z, new Float64Array(3));
    const lb = b ? b.toLocal(p.x, p.y, p.z, new Float64Array(3)) : new Float64Array([p.x, p.y, p.z]);
    // The face's normal, kept in b's frame (it turns with b) or the world's.
    const n = normal ? (b ? b.toLocal(b.x[0] + normal.x, b.x[1] + normal.y, b.x[2] + normal.z, new Float64Array(3)) : new Float64Array([normal.x, normal.y, normal.z])) : null;
    const j = { a, la, b, lb, n, S: strength, S0: strength, alpha: stretch / Math.max(strength, 1e-6), F: 0, load: 0, peak: 0, tire, box, broken: false, data };
    a.joints.push(j);
    b?.joints.push(j);
    this.joints.push(j);
    return j;
  }

  /** Tear a joint (it's reported in `torn`). */
  tear(j) { if (j.broken) return; this.#drop(j); this.torn.push(j); }

  #drop(j) {
    if (j.broken) return;
    j.broken = true;
    for (const b of [j.a, j.b]) if (b) { const i = b.joints.indexOf(j); if (i >= 0) b.joints.splice(i, 1); }
  }

  /** The static box these joints were fixed to is gone: they tear (and what hung from them wakes). */
  unanchor(box) {
    for (const j of this.joints) if (!j.broken && j.box === box) { this.wake(j.a); this.tear(j); }
  }

  /** The static box these joints were fixed to now moves with body b: they hold on to it. */
  reanchor(box, b) {
    for (const j of this.joints) {
      if (j.broken || j.box !== box || j.b) continue;
      if (j.a === b) { this.#drop(j); continue; }
      j.b = b; j.lb = b.toLocal(j.lb[0], j.lb[1], j.lb[2], new Float64Array(3)); j.box = null;
      if (j.n) j.n = b.toLocal(b.x[0] + j.n[0], b.x[1] + j.n[1], b.x[2] + j.n[2], new Float64Array(3));
      b.joints.push(j);
      this.wake(j.a);
    }
  }

  // ---------------------------------------------------------------- pushes
  /** A velocity impulse J (t·m/s) at world point p: a blast's push. Wakes the body. */
  push(b, p, J) {
    if (b.removed) return;
    this.wake(b);
    kick(b, p.x - b.x[0], p.y - b.x[1], p.z - b.x[2], J.x, J.y, J.z);
  }

  /** Is world point p within `pad` of one of b's boxes? Returns the box or null. */
  boxAt(b, px, py, pz, pad = 0) {
    const L = b.toLocal(px, py, pz, _qa);
    for (const k of b.boxes) if (Math.abs(L[0] - k.c[0]) <= k.h[0] + pad && Math.abs(L[1] - k.c[1]) <= k.h[1] + pad && Math.abs(L[2] - k.c[2]) <= k.h[2] + pad) return k;
    return null;
  }

  // ---------------------------------------------------------------- the step
  /** One tick (slept, woke, torn and hits gain what happened in it). */
  step(dt) {
    this.time += dt;
    for (const b of this.wakeNext) this.wake(b);
    this.wakeNext.length = 0;
    const awake = this.awake;
    if (!awake.length) return;
    for (const b of awake) {
      b.rx.set(b.x); b.rq.set(b.q); b.v0.set(b.v); b.w0.set(b.w);
      this.#frame(b);
      b.ke0 = b.energy; b.vn = 0; b.age += dt; b.lift = 0;
      for (const k of b.boxes) k.hit = false;
    }
    this.#collide(dt);
    // Fewer substeps when a lot is moving at once (a building coming down all over): softer, but the tick stays cheap.
    const sub = Math.max(4, Math.min(this.sub, this.sub - Math.floor((awake.length - 40) / 40)));
    const h = dt / sub, cs = this.cs, nc = this.nc, js = this.joints;
    this.substeps = sub;
    for (const j of js) j.peak = 0;
    for (let s = 0; s < sub; s++) {
      // How fast each contact was closing before this substep (for the bounce).
      for (let i = 0; i < nc; i++) this.#closing(cs[i]);
      for (const b of awake) this.#integrate(b, h);
      // Contacts there and back (solved in one order only, a box landing flat comes up on the
      // corner solved first, and turns).
      for (let i = 0; i < nc; i++) cs[i].lam = 0;
      for (let i = 0; i < nc; i++) this.#contact(cs[i], h);
      for (let i = nc - 1; i >= 0; i--) this.#contact(cs[i], h);
      for (const j of js) if (!j.broken) this.#joint(j, h);
      for (const b of awake) this.#velocities(b, h);
      for (let i = 0; i < nc; i++) if (cs[i].lam > 0) this.#friction(cs[i], h, 0.5);
      for (let i = nc - 1; i >= 0; i--) if (cs[i].lam > 0) this.#friction(cs[i], h, 0.5);
      for (const j of js) if (!j.broken) this.#jointDamp(j, h);
    }
    // What hangs from its joints (they hold up most of its weight); and those joints tire.
    for (const b of awake) b.hung = b.joints.length > 0 && b.lift / sub > HUNG * b.m * G;
    for (const j of js) {
      if (j.broken || !(j.a.hung || j.b?.hung)) continue;
      const load = j.peak / j.S;
      if (load > j.tire) j.S -= dt * TIRE * j.S * (load - j.tire);
    }
    if (js.length > 64 && js.some((j) => j.broken)) this.joints = js.filter((j) => !j.broken);
    // What hit what hard enough to matter: the energy it lost this tick.
    for (const b of awake) {
      this.#frame(b);
      const lost = b.ke0 - b.energy;
      if (b.vn > 1.5 && lost > 0.5) this.hits.push({ b, energy: lost, speed: b.vn, at: b.hitAt ?? [b.x[0], b.x[1], b.x[2]], statics: b.hitStatics ?? null });
      b.hitAt = null; b.hitStatics = null;
    }
    // At rest: asleep. Fallen out of the world: gone.
    for (let i = awake.length - 1; i >= 0; i--) {
      const b = awake[i], v = b.v, w = b.w;
      if (b.x[1] < -300) { this.remove(b); continue; }
      // (Hanging, it stays awake: its joints tire until it comes down.)
      const still = v[0] * v[0] + v[1] * v[1] + v[2] * v[2] < SLEEP_V * SLEEP_V && w[0] * w[0] + w[1] * w[1] + w[2] * w[2] < SLEEP_W * SLEEP_W;
      b.sleepT = still && !b.hung ? b.sleepT + dt : 0;
      if (b.sleepT > SLEEP_T || b.age > MAX_T) this.#sleep(b, i);
    }
  }

  #sleep(b, i) {
    b.asleep = true; b.sleepT = 0;
    b.v.fill(0); b.w.fill(0);
    b.rx.set(b.x); b.rq.set(b.q);
    this.#frame(b);
    this.awake.splice(i, 1);
    this.slept.push(b);
  }

  /** b's rotation, world inverse inertia, axes, and its boxes' world centres and bounds. */
  #frame(b) {
    const R = b.R, I = b.Ii, W = b.Iw, A = b.ax;
    matrix(b.q, R);
    // W = R I Rᵀ
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += R[r * 3 + k] * (I[k * 3] * R[c * 3] + I[k * 3 + 1] * R[c * 3 + 1] + I[k * 3 + 2] * R[c * 3 + 2]);
      W[r * 3 + c] = s;
    }
    A[0] = R[0]; A[1] = R[3]; A[2] = R[6]; A[3] = R[1]; A[4] = R[4]; A[5] = R[7]; A[6] = R[2]; A[7] = R[5]; A[8] = R[8];
    const bb = b.aabb;
    bb[0] = bb[1] = bb[2] = Infinity; bb[3] = bb[4] = bb[5] = -Infinity;
    for (const k of b.boxes) {
      const c = k.wc, [hx, hy, hz] = k.h, e = k.bb;
      c[0] = b.x[0] + R[0] * k.c[0] + R[1] * k.c[1] + R[2] * k.c[2];
      c[1] = b.x[1] + R[3] * k.c[0] + R[4] * k.c[1] + R[5] * k.c[2];
      c[2] = b.x[2] + R[6] * k.c[0] + R[7] * k.c[1] + R[8] * k.c[2];
      for (let a = 0; a < 3; a++) {
        const ext = Math.abs(R[a * 3]) * hx + Math.abs(R[a * 3 + 1]) * hy + Math.abs(R[a * 3 + 2]) * hz;
        e[a] = c[a] - ext; e[a + 3] = c[a] + ext;
        if (e[a] < bb[a]) bb[a] = e[a];
        if (e[a + 3] > bb[a + 3]) bb[a + 3] = e[a + 3];
      }
    }
  }

  #integrate(b, h) {
    b.px.set(b.x); b.pq.set(b.q);
    b.resting = false;
    const v = b.v, w = b.w, hung = b.joints.length > 0;
    v[1] -= G * h;
    const dv = 1 / (1 + h * DAMP_V), dw = 1 / (1 + h * (hung ? DAMP_HUNG : DAMP_W));
    v[0] *= dv; v[1] *= dv; v[2] *= dv; w[0] *= dw; w[1] *= dw; w[2] *= dw;
    b.x[0] += h * v[0]; b.x[1] += h * v[1]; b.x[2] += h * v[2];
    // Gyroscopic: in the body's frame, w += h I⁻¹ (-(w × I w)).
    const R = b.R, I = b.I, Ii = b.Ii;
    const bx = R[0] * w[0] + R[3] * w[1] + R[6] * w[2], by = R[1] * w[0] + R[4] * w[1] + R[7] * w[2], bz = R[2] * w[0] + R[5] * w[1] + R[8] * w[2];
    const Lx = I[0] * bx + I[1] * by + I[2] * bz, Ly = I[3] * bx + I[4] * by + I[5] * bz, Lz = I[6] * bx + I[7] * by + I[8] * bz;
    const tx = -(by * Lz - bz * Ly), ty = -(bz * Lx - bx * Lz), tz = -(bx * Ly - by * Lx);
    const nx = bx + h * (Ii[0] * tx + Ii[1] * ty + Ii[2] * tz), ny = by + h * (Ii[3] * tx + Ii[4] * ty + Ii[5] * tz), nz = bz + h * (Ii[6] * tx + Ii[7] * ty + Ii[8] * tz);
    w[0] = R[0] * nx + R[1] * ny + R[2] * nz; w[1] = R[3] * nx + R[4] * ny + R[5] * nz; w[2] = R[6] * nx + R[7] * ny + R[8] * nz;
    // q += h/2 [w, 0] q
    const q = b.q, qx = q[0], qy = q[1], qz = q[2], qw = q[3], k = 0.5 * h;
    q[0] = qx + k * (w[0] * qw + w[1] * qz - w[2] * qy);
    q[1] = qy + k * (w[1] * qw + w[2] * qx - w[0] * qz);
    q[2] = qz + k * (w[2] * qw + w[0] * qy - w[1] * qx);
    q[3] = qw + k * (-w[0] * qx - w[1] * qy - w[2] * qz);
    normalize(q);
    matrix(q, R);
    const W = b.Iw;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let kk = 0; kk < 3; kk++) s += R[r * 3 + kk] * (Ii[kk * 3] * R[c * 3] + Ii[kk * 3 + 1] * R[c * 3 + 1] + Ii[kk * 3 + 2] * R[c * 3 + 2]);
      W[r * 3 + c] = s;
    }
  }

  #velocities(b, h) {
    const x = b.x, px = b.px, v = b.v, w = b.w, q = b.q, p = b.pq;
    normalize(q);
    v[0] = (x[0] - px[0]) / h; v[1] = (x[1] - px[1]) / h; v[2] = (x[2] - px[2]) / h;
    // dq = q ⊗ conj(p)
    const ax = q[0], ay = q[1], az = q[2], aw = q[3], bx = -p[0], by = -p[1], bz = -p[2], bw = p[3];
    const dx = aw * bx + ax * bw + ay * bz - az * by, dy = aw * by - ax * bz + ay * bw + az * bx, dz = aw * bz + ax * by - ay * bx + az * bw, dw = aw * bw - ax * bx - ay * by - az * bz;
    const s = ((dw < 0 ? -2 : 2) / h) / (b.resting ? 1 + h * ROLL : 1);
    w[0] = dx * s; w[1] = dy * s; w[2] = dz * s;
  }

  // ---------------------------------------------------------------- contacts
  #slot() {
    let c = this.cs[this.nc];
    if (!c) this.cs.push((c = { a: null, b: null, la: new Float64Array(3), lb: new Float64Array(3), n: new Float64Array(3), p0: new Float64Array(6), lam: 0, vn0: 0, ka: 0, sb: null, sleeper: null }));
    this.nc++;
    c.lam = 0; c.vn0 = 0; c.sb = null; c.sleeper = null;
    return c;
  }

  /** A contact from _cp[o..o+9] (world points): a against b (null: static or asleep). */
  #add(a, ka, b, o) {
    const c = this.#slot();
    c.a = a; c.b = b; c.ka = ka;
    a.toLocal(_cp[o], _cp[o + 1], _cp[o + 2], c.la);
    if (b) b.toLocal(_cp[o + 3], _cp[o + 4], _cp[o + 5], c.lb);
    else { c.lb[0] = _cp[o + 3]; c.lb[1] = _cp[o + 4]; c.lb[2] = _cp[o + 5]; }
    c.n[0] = _cp[o + 6]; c.n[1] = _cp[o + 7]; c.n[2] = _cp[o + 8];
    return c;
  }

  /** This tick's contacts: every pair of boxes that are touching, or will be before the tick is out. */
  #collide(dt) {
    this.nc = 0;
    const awake = this.awake;
    for (const b of awake) {
      const sp = Math.hypot(b.v[0], b.v[1], b.v[2]) + Math.hypot(b.w[0], b.w[1], b.w[2]) * b.r;
      b.margin = Math.min(0.6, sp * dt * 1.5 + 0.02);
    }
    // Against the static cover.
    for (const b of awake) {
      const A = b.aabb, m = b.margin;
      this.statics?.(A[0] - m, A[2] - m, A[3] + m, A[5] + m, (s) => {
        if (s.body || s.max.y < A[1] - m || s.min.y > A[4] + m) return;
        if (b.ignore?.has(s)) {
          // Clear of what it was fixed to: it collides with that from now on.
          if (s.max.x < A[0] - 0.02 || s.min.x > A[3] + 0.02 || s.max.y < A[1] - 0.02 || s.min.y > A[4] + 0.02 || s.max.z < A[2] - 0.02 || s.min.z > A[5] + 0.02) b.ignore.delete(s);
          return;
        }
        _sc[0] = (s.min.x + s.max.x) / 2; _sc[1] = (s.min.y + s.max.y) / 2; _sc[2] = (s.min.z + s.max.z) / 2;
        _se[0] = (s.max.x - s.min.x) / 2; _se[1] = (s.max.y - s.min.y) / 2; _se[2] = (s.max.z - s.min.z) / 2;
        for (let k = 0; k < b.boxes.length; k++) {
          const e = b.boxes[k].bb;
          if (e[0] > s.max.x + m || e[3] < s.min.x - m || e[1] > s.max.y + m || e[4] < s.min.y - m || e[2] > s.max.z + m || e[5] < s.min.z - m) continue;
          const n = obb(b.boxes[k].wc, b.ax, b.boxes[k].h, _sc, IDENT, _se, m);
          for (let i = 0; i < n; i++) this.#add(b, k, null, i * 9).sb = s;
        }
      });
    }
    // Against the terrain: each box's corners and edge points.
    for (const b of awake) {
      if (this.ground && b.aabb[1] > this.ground(b.x[0], b.x[2]) + b.r + b.margin + 2) continue;
      const m = b.margin, R = b.R;
      for (let k = 0; k < b.boxes.length; k++) {
        const P = b.boxes[k].pts;
        for (let i = 0; i < P.length; i += 3) {
          const px = b.x[0] + R[0] * P[i] + R[1] * P[i + 1] + R[2] * P[i + 2];
          const py = b.x[1] + R[3] * P[i] + R[4] * P[i + 1] + R[5] * P[i + 2];
          const pz = b.x[2] + R[6] * P[i] + R[7] * P[i + 1] + R[8] * P[i + 2];
          const g = this.ground ? this.ground(px, pz) : 0;
          if (py - g > m) continue;
          const c = this.#slot();
          c.a = b; c.b = null; c.ka = k;
          c.la[0] = P[i]; c.la[1] = P[i + 1]; c.la[2] = P[i + 2];
          c.lb[0] = px; c.lb[1] = g; c.lb[2] = pz;
          if (this.normal) this.normal(px, pz, c.n); else { c.n[0] = 0; c.n[1] = 1; c.n[2] = 0; }
        }
      }
    }
    // Against each other: a sweep along x over everything (the asleep only against the awake).
    const all = this.bodies;
    for (const b of all) if (b.asleep) b.margin = 0;
    all.sort((p, q) => p.aabb[0] - q.aabb[0] || p.id - q.id);
    for (let i = 0; i < all.length; i++) {
      const A = all[i];
      for (let j = i + 1; j < all.length; j++) {
        const B = all[j];
        const m = A.margin + B.margin;
        if (B.aabb[0] > A.aabb[3] + m) break;
        if (A.asleep && B.asleep) continue;
        const a = A.aabb, c = B.aabb;
        if (c[1] > a[4] + m || c[4] < a[1] - m || c[2] > a[5] + m || c[5] < a[2] - m) continue;
        if (A.skip?.has(B)) {
          if (c[0] > a[3] + 0.02 || c[3] < a[0] - 0.02 || c[1] > a[4] + 0.02 || c[4] < a[1] - 0.02 || c[2] > a[5] + 0.02 || c[5] < a[2] - 0.02) { A.skip.delete(B); B.skip?.delete(A); }
          else continue;
        }
        // (A body is never against itself; one asleep stays asleep under a light touch.)
        let P = A, Q = B;
        if (P.asleep) { P = B; Q = A; }
        if (Q.asleep) {
          const sp = Math.hypot(P.v[0], P.v[1], P.v[2]) + Math.hypot(P.w[0], P.w[1], P.w[2]) * P.r;
          if (sp > 1.2 && P.m > 0.15 * Q.m) this.wakeNext.push(Q);
        }
        this.#pair(P, Q, m, Q.asleep);
      }
    }
  }

  /** Contacts between the boxes of P (awake) and Q (awake, or asleep: then it's held still this tick). */
  #pair(P, Q, m, still) {
    for (let k = 0; k < P.boxes.length; k++) {
      const e = P.boxes[k].bb;
      for (let l = 0; l < Q.boxes.length; l++) {
        const f = Q.boxes[l].bb;
        if (e[0] > f[3] + m || e[3] < f[0] - m || e[1] > f[4] + m || e[4] < f[1] - m || e[2] > f[5] + m || e[5] < f[2] - m) continue;
        const n = obb(P.boxes[k].wc, P.ax, P.boxes[k].h, Q.boxes[l].wc, Q.ax, Q.boxes[l].h, m);
        for (let i = 0; i < n; i++) { const c = this.#add(P, k, still ? null : Q, i * 9); if (still) c.sleeper = Q; }
      }
    }
  }

  /** Before the substep: how fast the contact is closing (for the bounce), and where its two points are (for friction). */
  #closing(c) {
    const A = c.a, B = c.b, n = c.n, p = c.p0;
    rot(A.q, c.la[0], c.la[1], c.la[2], _ra);
    let vx = A.v[0] + A.w[1] * _ra[2] - A.w[2] * _ra[1], vy = A.v[1] + A.w[2] * _ra[0] - A.w[0] * _ra[2], vz = A.v[2] + A.w[0] * _ra[1] - A.w[1] * _ra[0];
    p[0] = A.x[0] + _ra[0]; p[1] = A.x[1] + _ra[1]; p[2] = A.x[2] + _ra[2];
    if (B) {
      rot(B.q, c.lb[0], c.lb[1], c.lb[2], _rb);
      vx -= B.v[0] + B.w[1] * _rb[2] - B.w[2] * _rb[1]; vy -= B.v[1] + B.w[2] * _rb[0] - B.w[0] * _rb[2]; vz -= B.v[2] + B.w[0] * _rb[1] - B.w[1] * _rb[0];
      p[3] = B.x[0] + _rb[0]; p[4] = B.x[1] + _rb[1]; p[5] = B.x[2] + _rb[2];
    }
    c.vn0 = vx * n[0] + vy * n[1] + vz * n[2];
  }

  /** Push the two apart along the contact's normal, and hold them where they touch if friction can. */
  #contact(c, h) {
    const A = c.a, B = c.b, n = c.n, nx = n[0], ny = n[1], nz = n[2];
    rot(A.q, c.la[0], c.la[1], c.la[2], _ra);
    let rbx = 0, rby = 0, rbz = 0, pbx = c.lb[0], pby = c.lb[1], pbz = c.lb[2];
    if (B) { rot(B.q, c.lb[0], c.lb[1], c.lb[2], _rb); rbx = _rb[0]; rby = _rb[1]; rbz = _rb[2]; pbx = B.x[0] + rbx; pby = B.x[1] + rby; pbz = B.x[2] + rbz; }
    const rax = _ra[0], ray = _ra[1], raz = _ra[2];
    const d = (pbx - A.x[0] - rax) * nx + (pby - A.x[1] - ray) * ny + (pbz - A.x[2] - raz) * nz - SLOP;
    if (d <= 0) return;
    const corr = Math.min(d, CAP);
    const wa = invMass(A, rax, ray, raz, nx, ny, nz), wb = invMass(B, rbx, rby, rbz, nx, ny, nz);
    const dl = corr / (wa + wb);
    c.lam += dl;
    A.resting = true; if (B) B.resting = true;
    shove(A, rax, ray, raz, dl * nx, dl * ny, dl * nz);
    if (B) shove(B, rbx, rby, rbz, -dl * nx, -dl * ny, -dl * nz);
    // Who and where for the host: the hardest hit of the tick.
    const k = A.boxes[c.ka]; if (k) k.hit = true;
    if (-c.vn0 > A.vn) { A.vn = -c.vn0; A.hitAt = [A.x[0] + rax, A.x[1] + ray, A.x[2] + raz]; }
    if (c.sb && -c.vn0 > 1.5) (A.hitStatics ??= new Set()).add(c.sb);
    if (B && -c.vn0 > B.vn) { B.vn = -c.vn0; B.hitAt = [pbx, pby, pbz]; }
    // Static friction: undo the sliding of the two points this substep, if the push holds it.
    const p0 = c.p0;
    rot(A.q, c.la[0], c.la[1], c.la[2], _ra);
    let dx = A.x[0] + _ra[0] - p0[0], dy = A.x[1] + _ra[1] - p0[1], dz = A.x[2] + _ra[2] - p0[2];
    if (B) {
      rot(B.q, c.lb[0], c.lb[1], c.lb[2], _rb);
      dx -= B.x[0] + _rb[0] - p0[3]; dy -= B.x[1] + _rb[1] - p0[4]; dz -= B.x[2] + _rb[2] - p0[5];
    }
    const dn = dx * nx + dy * ny + dz * nz;
    dx -= dn * nx; dy -= dn * ny; dz -= dn * nz;
    const lt = Math.hypot(dx, dy, dz);
    if (lt < 1e-9) return;
    const tx = dx / lt, ty = dy / lt, tz = dz / lt;
    const wta = invMass(A, _ra[0], _ra[1], _ra[2], tx, ty, tz), wtb = B ? invMass(B, _rb[0], _rb[1], _rb[2], tx, ty, tz) : 0;
    const dlt = lt / (wta + wtb);
    if (dlt > MU_S * c.lam) return;
    shove(A, _ra[0], _ra[1], _ra[2], -dlt * tx, -dlt * ty, -dlt * tz);
    if (B) shove(B, _rb[0], _rb[1], _rb[2], dlt * tx, dlt * ty, dlt * tz);
  }

  /** Sliding friction and the bounce, on the velocities (a share k of them: it's done there and back). */
  #friction(c, h, k = 1) {
    const A = c.a, B = c.b, n = c.n;
    rot(A.q, c.la[0], c.la[1], c.la[2], _ra);
    let vx = A.v[0] + A.w[1] * _ra[2] - A.w[2] * _ra[1], vy = A.v[1] + A.w[2] * _ra[0] - A.w[0] * _ra[2], vz = A.v[2] + A.w[0] * _ra[1] - A.w[1] * _ra[0];
    if (B) {
      rot(B.q, c.lb[0], c.lb[1], c.lb[2], _rb);
      vx -= B.v[0] + B.w[1] * _rb[2] - B.w[2] * _rb[1]; vy -= B.v[1] + B.w[2] * _rb[0] - B.w[0] * _rb[2]; vz -= B.v[2] + B.w[0] * _rb[1] - B.w[1] * _rb[0];
    }
    const vn = vx * n[0] + vy * n[1] + vz * n[2];
    const tx = vx - vn * n[0], ty = vy - vn * n[1], tz = vz - vn * n[2], vt = Math.hypot(tx, ty, tz);
    // Sliding: friction takes off at most mu times the push holding them together (lam / h, an impulse).
    if (vt > 1e-9) {
      const ux = -tx / vt, uy = -ty / vt, uz = -tz / vt;
      const w = invMass(A, _ra[0], _ra[1], _ra[2], ux, uy, uz) + (B ? invMass(B, _rb[0], _rb[1], _rb[2], ux, uy, uz) : 0);
      const p = k * Math.min(MU_D * (c.lam / h), vt / w);
      kick(A, _ra[0], _ra[1], _ra[2], ux * p, uy * p, uz * p);
      if (B) kick(B, _rb[0], _rb[1], _rb[2], -ux * p, -uy * p, -uz * p);
    }
    // The bounce: a little of how fast it came in, unless it was only resting there.
    const e = Math.abs(c.vn0) > 8 * G * h ? BOUNCE : 0;
    const dn = -vn + Math.max(-e * c.vn0, 0);
    if (Math.abs(dn) < 1e-9) return;
    const w = invMass(A, _ra[0], _ra[1], _ra[2], n[0], n[1], n[2]) + (B ? invMass(B, _rb[0], _rb[1], _rb[2], n[0], n[1], n[2]) : 0);
    const p = (k * dn) / w;
    kick(A, _ra[0], _ra[1], _ra[2], n[0] * p, n[1] * p, n[2] * p);
    if (B) kick(B, _rb[0], _rb[1], _rb[2], -n[0] * p, -n[1] * p, -n[2] * p);
  }

  // ---------------------------------------------------------------- joints
  #joint(j, h) {
    const A = j.a, B = j.b;
    if (A.asleep && (!B || B.asleep)) return;
    const a = A.asleep ? null : A, b = B && !B.asleep ? B : null;
    rot(A.q, j.la[0], j.la[1], j.la[2], _ra);
    let pbx = j.lb[0], pby = j.lb[1], pbz = j.lb[2], rbx = 0, rby = 0, rbz = 0;
    if (B) { rot(B.q, j.lb[0], j.lb[1], j.lb[2], _rb); rbx = _rb[0]; rby = _rb[1]; rbz = _rb[2]; pbx = B.x[0] + rbx; pby = B.x[1] + rby; pbz = B.x[2] + rbz; }
    const dx = A.x[0] + _ra[0] - pbx, dy = A.x[1] + _ra[1] - pby, dz = A.x[2] + _ra[2] - pbz;
    const C = Math.hypot(dx, dy, dz);
    if (C < 1e-7) { j.F = 0; return; }
    const nx = dx / C, ny = dy / C, nz = dz / C;
    const wa = invMass(a, _ra[0], _ra[1], _ra[2], nx, ny, nz), wb = invMass(b, rbx, rby, rbz, nx, ny, nz);
    const at = j.alpha / (h * h);
    if (wa + wb < 1e-12) return;
    const dl = -C / (wa + wb + at);
    if (a) shove(a, _ra[0], _ra[1], _ra[2], dl * nx, dl * ny, dl * nz);
    if (b) shove(b, rbx, rby, rbz, -dl * nx, -dl * ny, -dl * nz);
    j.F = -dl / (h * h);
    // What tears it: the pull straight off its face, and some of the shear across it.
    let load = j.F, hang = 1;
    if (j.n) {
      if (B) rot(B.q, j.n[0], j.n[1], j.n[2], _qb); else { _qb[0] = j.n[0]; _qb[1] = j.n[1]; _qb[2] = j.n[2]; }
      const cos = nx * _qb[0] + ny * _qb[1] + nz * _qb[2], sin = Math.sqrt(Math.max(0, 1 - cos * cos));
      load = j.F * (Math.max(cos, 0) + SHEAR * sin);
      if (cos < 0) hang = sin;
    }
    // How much it holds them up by hanging on (pressed together, it's only something to stand on).
    const up = (dl * ny * hang) / (h * h);
    if (a) a.lift += up;
    if (b) b.lift -= up;
    j.load = load;
    if (load > j.peak) j.peak = load;
    if (load > j.S) this.tear(j);
  }

  /** The joint's stretch doesn't ring: the two points' relative velocity, damped. */
  #jointDamp(j, h) {
    const A = j.a, B = j.b;
    const a = A.asleep ? null : A, b = B && !B.asleep ? B : null;
    if (!a && !b) return;
    rot(A.q, j.la[0], j.la[1], j.la[2], _ra);
    let vx = a ? A.v[0] + A.w[1] * _ra[2] - A.w[2] * _ra[1] : 0, vy = a ? A.v[1] + A.w[2] * _ra[0] - A.w[0] * _ra[2] : 0, vz = a ? A.v[2] + A.w[0] * _ra[1] - A.w[1] * _ra[0] : 0;
    if (b) {
      rot(B.q, j.lb[0], j.lb[1], j.lb[2], _rb);
      vx -= B.v[0] + B.w[1] * _rb[2] - B.w[2] * _rb[1]; vy -= B.v[1] + B.w[2] * _rb[0] - B.w[0] * _rb[2]; vz -= B.v[2] + B.w[0] * _rb[1] - B.w[1] * _rb[0];
    }
    const k = Math.min(1, JOINT_DAMP * h), dv = Math.hypot(vx, vy, vz) * k;
    if (dv < 1e-9) return;
    const s = Math.hypot(vx, vy, vz), ux = -vx / s, uy = -vy / s, uz = -vz / s;
    const wa = invMass(a, _ra[0], _ra[1], _ra[2], ux, uy, uz), wb = b ? invMass(b, _rb[0], _rb[1], _rb[2], ux, uy, uz) : 0;
    if (wa + wb < 1e-12) return;
    const p = dv / (wa + wb);
    if (a) kick(a, _ra[0], _ra[1], _ra[2], ux * p, uy * p, uz * p);
    if (b) kick(b, _rb[0], _rb[1], _rb[2], -ux * p, -uy * p, -uz * p);
  }
}

/** A box's corners and points along its edges (local, about the body's centre), where it meets the terrain. */
function points(c, h) {
  const out = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push(c[0] + sx * h[0], c[1] + sy * h[1], c[2] + sz * h[2]);
  for (let a = 0; a < 3; a++) {
    const len = 2 * h[a], n = Math.ceil(len / EDGE) - 1;
    if (n < 1) continue;
    const b = (a + 1) % 3, d = (a + 2) % 3;
    for (let i = 1; i <= n; i++) {
      const t = -h[a] + (len * i) / (n + 1);
      for (const sb of [-1, 1]) for (const sd of [-1, 1]) {
        const p = [0, 0, 0];
        p[a] = c[a] + t; p[b] = c[b] + sb * h[b]; p[d] = c[d] + sd * h[d];
        out.push(...p);
      }
    }
  }
  return Float64Array.from(out);
}
