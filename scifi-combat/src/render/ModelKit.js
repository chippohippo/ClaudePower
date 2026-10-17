// ModelKit: procedural hard-surface modeling for the art direction's assets (troopers, guns,
// props; docs/ART_DIRECTION.md). No modeling tool, no files: every asset is code, so it's
// deterministic, tweakable and costs nothing to download.
//
// A Part is a non-indexed triangle soup with four attributes:
//   position, normal
//   aUv   vec2: decal space (stencilled numbers, cape emblem), 0 elsewhere
//   aMat  vec4: paint channel (CH), edge wear (0..1, where paint chips to bare metal), dirt
//         (0..1, dust climbing the boots), bone (which rig bone the vertex follows)
// Primitives compute their own wear (rounded boxes chip on their edges, plates on their rims),
// so a part is painted once in its own frame and then shaped, placed, mirrored and merged.
//
// Primitives: rbox (superellipsoid: rounded box to pebble), shell (a curved armor plate with a
// bevelled rim, on a grid so it bends cleanly), plate (any outline extruded with a bevel), cyl,
// lathe, tube, torus, quad (decal).
// Shaping: move, rot, scale, bendY / bendX (wrap around an axis), taper, warp (any vertex
// function), mirrorX. merge() turns parts into one BufferGeometry.

import * as THREE from 'three';

/** Paint channels: the trooper shader looks each one up in the faction palette. */
export const CH = {
  armor: 0, shade: 1, black: 2, suit: 3, gear: 4, webbing: 5, metal: 6, stencil: 7,
  hazard: 8, glass: 9, visor: 10, cape: 11, trim: 12, lamp: 13, rubber: 14, white: 15,
  number: 16, emblem: 17,     // decals: a stencilled number, the faction's cape emblem (drawn from aUv)
};
export const NCH = 18;

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Matrix4(), _nm = new THREE.Matrix3(), _e = new THREE.Euler();
const sgnPow = (x, p) => Math.sign(x) * Math.abs(x) ** p;

export class Part {
  constructor(pos, nor, uv = null, mat = null) {
    this.pos = pos; this.nor = nor;
    const n = pos.length / 3;
    this.uv = uv ?? new Float32Array(n * 2);
    this.mat = mat ?? new Float32Array(n * 4);
  }

  get count() { return this.pos.length / 3; }

  /** From any BufferGeometry (indexed or not). wear: 'edge' | 'rim' | number. */
  static from(geo, wear = 'edge') {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = new Part(Float32Array.from(g.attributes.position.array), Float32Array.from(g.attributes.normal.array));
    const P = p.pos, N = p.nor;
    for (let i = 0; i < N.length; i += 3) {
      if (Math.abs(Math.hypot(N[i], N[i + 1], N[i + 2]) - 1) < 1e-3) continue;
      const t = Math.floor(i / 9) * 9;   // a degenerate normal (a lathe's pole): use its triangle's
      const ax = P[t + 3] - P[t], ay = P[t + 4] - P[t + 1], az = P[t + 5] - P[t + 2], bx = P[t + 6] - P[t], by = P[t + 7] - P[t + 1], bz = P[t + 8] - P[t + 2];
      _n.set(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
      if (_n.lengthSq() < 1e-20) _n.set(0, 1, 0);
      _n.normalize(); N[i] = _n.x; N[i + 1] = _n.y; N[i + 2] = _n.z;
    }
    p.autoWear(wear);
    return p;
  }

  clone() { return new Part(this.pos.slice(), this.nor.slice(), this.uv.slice(), this.mat.slice()); }

  /** Edge wear from the normals in the part's own frame. */
  autoWear(mode = 'edge', k = 1) {
    const N = this.nor, M = this.mat;
    for (let i = 0, n = this.count; i < n; i++) {
      const x = Math.abs(N[i * 3]), y = Math.abs(N[i * 3 + 1]), z = Math.abs(N[i * 3 + 2]);
      let w;
      if (typeof mode === 'number') w = mode;
      else if (mode === 'rim') w = 1 - z;                                 // a plate's rim and bevel
      else w = Math.min(1, (1 - Math.max(x, y, z)) * 3.2);                // a rounded box's edges
      M[i * 4 + 1] = Math.max(0, Math.min(1, w * k));
    }
    return this;
  }

  /** Paint: channel, and optionally dirt (number or fn(x, y, z)), bone and wear scale. */
  paint(ch, { dirt = null, bone = null, wear = null } = {}) {
    const M = this.mat, P = this.pos;
    for (let i = 0, n = this.count; i < n; i++) {
      M[i * 4] = ch;
      if (wear !== null) M[i * 4 + 1] = typeof wear === 'function' ? wear(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], M[i * 4 + 1]) : M[i * 4 + 1] * wear;
      if (dirt !== null) M[i * 4 + 2] = typeof dirt === 'function' ? dirt(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]) : dirt;
      if (bone !== null) M[i * 4 + 3] = bone;
    }
    return this;
  }

  /** Set a field of aMat on every vertex: 2 = dirt, 3 = bone. */
  set(field, value) { for (let i = 0, n = this.count; i < n; i++) this.mat[i * 4 + field] = value; return this; }

  transform(m) {
    _nm.getNormalMatrix(m);
    const P = this.pos, N = this.nor;
    for (let i = 0; i < P.length; i += 3) {
      _v.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(m); P[i] = _v.x; P[i + 1] = _v.y; P[i + 2] = _v.z;
      _n.set(N[i], N[i + 1], N[i + 2]).applyMatrix3(_nm).normalize(); N[i] = _n.x; N[i + 1] = _n.y; N[i + 2] = _n.z;
    }
    if (m.determinant() < 0) this.#flip();
    return this;
  }
  move(x, y, z) { return this.transform(_m.makeTranslation(x, y, z)); }
  /** Rotate (radians, XYZ order). */
  rot(x, y = 0, z = 0) { return this.transform(_m.makeRotationFromEuler(_e.set(x, y, z))); }
  scale(x, y = x, z = x) { return this.transform(_m.makeScale(x, y, z)); }
  mirrorX() { return this.transform(_m.makeScale(-1, 1, 1)); }

  #flip() {   // reverse each triangle's winding (after a mirror)
    const sw = (A, k) => { for (let t = 0; t < A.length; t += 3 * k) for (let c = 0; c < k; c++) { const a = A[t + k + c]; A[t + k + c] = A[t + 2 * k + c]; A[t + 2 * k + c] = a; } };
    sw(this.pos, 3); sw(this.nor, 3); sw(this.uv, 2); sw(this.mat, 4);
  }

  /**
   * Any vertex function: fn(p: Vector3) moves p in place. Normals are recomputed from a finite
   * difference of fn along each normal's tangent plane (so bulges and dents light correctly).
   */
  warp(fn) {
    const P = this.pos, N = this.nor, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), h = 1e-3;
    for (let i = 0; i < P.length; i += 3) {
      const p = new THREE.Vector3(P[i], P[i + 1], P[i + 2]), n = new THREE.Vector3(N[i], N[i + 1], N[i + 2]);
      t1.set(1, 0, 0); if (Math.abs(n.x) > 0.9) t1.set(0, 1, 0);
      t1.addScaledVector(n, -t1.dot(n)).normalize(); t2.crossVectors(n, t1);
      a.copy(p); fn(a);
      b.copy(p).addScaledVector(t1, h); fn(b);
      c.copy(p).addScaledVector(t2, h); fn(c);
      b.sub(a); c.sub(a);
      const nn = new THREE.Vector3().crossVectors(b, c);
      if (nn.lengthSq() > 1e-14) { nn.normalize(); if (nn.dot(n) < 0) nn.negate(); N[i] = nn.x; N[i + 1] = nn.y; N[i + 2] = nn.z; }
      P[i] = a.x; P[i + 1] = a.y; P[i + 2] = a.z;
    }
    return this;
  }

  /** Wrap around a vertical axis at z = +radius (a plate curving around a torso, its face toward -Z). */
  bendY(radius) {
    const P = this.pos, N = this.nor;
    for (let i = 0; i < P.length; i += 3) {
      const th = P[i] / radius, rho = radius - P[i + 2], s = Math.sin(th), c = Math.cos(th);
      P[i] = rho * s; P[i + 2] = radius - rho * c;
      const nx = N[i], nz = N[i + 2];
      N[i] = nx * c - nz * s; N[i + 2] = nx * s + nz * c;              // the normal turns with the surface
    }
    return this;
  }

  /** Wrap around a horizontal (X) axis at z = +radius: a plate curving over the top and under. */
  bendX(radius) {
    const P = this.pos, N = this.nor;
    for (let i = 0; i < P.length; i += 3) {
      const th = P[i + 1] / radius, rho = radius - P[i + 2], s = Math.sin(th), c = Math.cos(th);
      P[i + 1] = rho * s; P[i + 2] = radius - rho * c;
      const ny = N[i + 1], nz = N[i + 2];
      N[i + 1] = ny * c - nz * s; N[i + 2] = ny * s + nz * c;
    }
    return this;
  }

  /** Scale x and z by f(y) (a limb guard narrowing toward the ankle, a helmet flaring out). */
  taper(f) {
    const P = this.pos, N = this.nor;
    for (let i = 0; i < P.length; i += 3) {
      const k = f(P[i + 1]);
      P[i] *= k; P[i + 2] *= k;
      _n.set(N[i] / k, N[i + 1], N[i + 2] / k).normalize(); N[i] = _n.x; N[i + 1] = _n.y; N[i + 2] = _n.z;
    }
    return this;
  }

  /** Split triangles until no edge is longer than `maxEdge` (so a plate can bend smoothly). */
  tessellate(maxEdge) {
    const out = { p: [], n: [], u: [], m: [] }, m2 = maxEdge * maxEdge;
    const P = this.pos, N = this.nor, U = this.uv, M = this.mat;
    const vert = (i) => ({ p: [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], n: [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]], u: [U[i * 2], U[i * 2 + 1]], m: [M[i * 4], M[i * 4 + 1], M[i * 4 + 2], M[i * 4 + 3]] });
    const mid = (a, b) => {
      const n = a.n.map((x, k) => x + b.n[k]), l = Math.hypot(...n) || 1;
      return { p: a.p.map((x, k) => (x + b.p[k]) / 2), n: n.map((x) => x / l), u: a.u.map((x, k) => (x + b.u[k]) / 2), m: [a.m[0], (a.m[1] + b.m[1]) / 2, (a.m[2] + b.m[2]) / 2, a.m[3]] };
    };
    const d2 = (a, b) => (a.p[0] - b.p[0]) ** 2 + (a.p[1] - b.p[1]) ** 2 + (a.p[2] - b.p[2]) ** 2;
    const stack = [];
    for (let t = 0; t < this.count; t += 3) stack.push([vert(t), vert(t + 1), vert(t + 2)]);
    while (stack.length) {
      const [a, b, c] = stack.pop();
      const ab = d2(a, b), bc = d2(b, c), ca = d2(c, a), mx = Math.max(ab, bc, ca);
      if (mx <= m2) { for (const v of [a, b, c]) { out.p.push(...v.p); out.n.push(...v.n); out.u.push(...v.u); out.m.push(...v.m); } continue; }
      if (mx === ab) { const d = mid(a, b); stack.push([a, d, c], [d, b, c]); }
      else if (mx === bc) { const d = mid(b, c); stack.push([a, b, d], [a, d, c]); }
      else { const d = mid(c, a); stack.push([a, b, d], [d, b, c]); }
    }
    this.pos = Float32Array.from(out.p); this.nor = Float32Array.from(out.n); this.uv = Float32Array.from(out.u); this.mat = Float32Array.from(out.m);
    return this;
  }

  /** Decal space for the shader (stencils, emblems): uv = fn(x, y, z) -> [u, v]. */
  mapUv(fn) {
    const P = this.pos, U = this.uv;
    for (let i = 0, n = this.count; i < n; i++) { const [u, v] = fn(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); U[i * 2] = u; U[i * 2 + 1] = v; }
    return this;
  }
}

// ---------------------------------------------------------------- primitives

/**
 * Superellipsoid centred on the origin, full sizes sx, sy, sz. Exponents near 0 give a box with
 * crisp rounded edges, 1 an ellipsoid, 2 a diamond; e1 shapes the profile top to bottom, e2 the
 * section around. Normals are exact.
 */
export function rbox(sx, sy, sz, { e1 = 0.25, e2 = 0.25, ws = 16, hs = 10, top = 1, bottom = -1 } = {}) {
  const a = sx / 2, b = sy / 2, c = sz / 2, P = [], N = [];
  const at = (th, ph) => {
    const ct = Math.cos(th), st = Math.sin(th), cp = Math.cos(ph), sp = Math.sin(ph);
    const p = [a * sgnPow(ct, e1) * sgnPow(cp, e2), b * sgnPow(st, e1), c * sgnPow(ct, e1) * sgnPow(sp, e2)];
    const n = [sgnPow(ct, 2 - e1) * sgnPow(cp, 2 - e2) / a, sgnPow(st, 2 - e1) / b, sgnPow(ct, 2 - e1) * sgnPow(sp, 2 - e2) / c];
    const l = Math.hypot(...n) || 1;
    return [p, n.map((x) => x / l)];
  };
  // top/bottom (fractions of the half-height, -1..1) cut the shape: a dome is bottom = 0.
  const t0 = Math.asin(sgnPow(bottom, 1 / e1)), t1 = Math.asin(sgnPow(top, 1 / e1));
  for (let j = 0; j < hs; j++) {
    const ta = t0 + ((t1 - t0) * j) / hs, tb = t0 + ((t1 - t0) * (j + 1)) / hs;
    for (let i = 0; i < ws; i++) {
      const pa = -Math.PI + (2 * Math.PI * i) / ws, pb = -Math.PI + (2 * Math.PI * (i + 1)) / ws;
      const v00 = at(ta, pa), v10 = at(ta, pb), v01 = at(tb, pa), v11 = at(tb, pb);
      for (const [p, n] of [v00, v11, v10, v00, v01, v11]) { P.push(...p); N.push(...n); }
    }
  }
  // Boxy shapes chip on their edges; round ones (exponents near 1) have no edges to chip.
  return new Part(Float32Array.from(P), Float32Array.from(N)).autoWear('edge', Math.max(0, 1 - Math.max(e1, e2)) * 1.3);
}

/** Cylinder along +Y from y = 0 to h (radius r0 at the bottom, r1 at the top). */
export function cyl(r0, r1, h, { seg = 12, caps = true, open = false } = {}) {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1, open || !caps).translate(0, h / 2, 0);
  return Part.from(g, 'edge').autoWear('rim', 0);
}

/** Revolve a profile [[r, y], ...] around +Y. */
export function lathe(profile, { seg = 16, phi0 = 0, phiLen = Math.PI * 2 } = {}) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg, phi0, phiLen);
  return Part.from(g).autoWear(0.12);   // round: the shader's noise does its wear
}

/**
 * A curved armor plate: w by h, `d` thick, corners chamfered by `corner` (a number or per corner
 * [tl, tr, br, bl]), a `bevel` round its face, its face toward -Z and its back at z = 0. Built as
 * a structured grid (nu by nv) so it bends cleanly: curveY wraps it around a vertical axis
 * (a chest plate round a torso), curveX around a horizontal one (over a shoulder); both give a
 * dome. back: false leaves the back open (a plate that sits on the body).
 */
export function shell(w, h, d, { corner = 0.02, bevel = 0.008, nu = 10, nv = 8, curveY = 0, curveX = 0, back = true } = {}) {
  const [tl, tr, br, bl] = Array.isArray(corner) ? corner : [corner, corner, corner, corner];
  const X = w / 2, Y = h / 2;
  // Grid point (i, j) on the outline inset by `ins`, corners pulled onto their chamfer lines.
  const at = (i, j, ins) => {
    let x = (-1 + (2 * i) / nu) * (X - ins), y = (-1 + (2 * j) / nv) * (Y - ins);
    const c = Math.max(0, (x < 0 ? (y < 0 ? bl : tl) : (y < 0 ? br : tr)) - 0.586 * ins);   // the chamfer, inset with the outline
    const e = (Math.abs(x) + Math.abs(y) - (X + Y - 2 * ins - c)) / 2;                     // how far past the chamfer line
    if (c > 0 && e > 0) { x -= Math.sign(x) * e; y -= Math.sign(y) * e; }
    return [x, y];
  };
  const P = [], N = [], W = [];
  const tri = (a, b, c, wear = 0) => { for (const v of [a, b, c]) { P.push(v[0], v[1], v[2]); N.push(v[3], v[4], v[5]); W.push(wear); } };
  const face = (z, ins, nz, flip) => {
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = [...at(i, j, ins), z, 0, 0, nz], b = [...at(i + 1, j, ins), z, 0, 0, nz], c = [...at(i + 1, j + 1, ins), z, 0, 0, nz], e = [...at(i, j + 1, ins), z, 0, 0, nz];
      if (flip) { tri(a, b, c); tri(a, c, e); } else { tri(a, c, b); tri(a, e, c); }
    }
  };
  // The boundary loop of the grid, counter-clockwise seen from the front (-Z).
  const loop = [];
  for (let i = 0; i < nu; i++) loop.push([i, 0]);
  for (let j = 0; j < nv; j++) loop.push([nu, j]);
  for (let i = nu; i > 0; i--) loop.push([i, nv]);
  for (let j = nv; j > 0; j--) loop.push([0, j]);
  const outward = (k, ins) => {   // the outline's outward normal at loop point k (in XY)
    const p0 = at(...loop[(k + loop.length - 1) % loop.length], ins), p1 = at(...loop[(k + 1) % loop.length], ins);
    const tx = p1[0] - p0[0], ty = p1[1] - p0[1], l = Math.hypot(tx, ty) || 1;
    return [ty / l, -tx / l];
  };
  const ring = (z0, ins0, z1, ins1, nzA, nzB, wear) => {
    for (let k = 0; k < loop.length; k++) {
      const k1 = (k + 1) % loop.length;
      const [ox0, oy0] = outward(k, ins0), [ox1, oy1] = outward(k1, ins0);
      const sA = Math.sqrt(Math.max(0, 1 - nzA * nzA)), sB = Math.sqrt(Math.max(0, 1 - nzB * nzB));
      const a = [...at(...loop[k], ins0), z0, ox0 * sA, oy0 * sA, nzA], b = [...at(...loop[k1], ins0), z0, ox1 * sA, oy1 * sA, nzA];
      const c = [...at(...loop[k1], ins1), z1, ox1 * sB, oy1 * sB, nzB], e = [...at(...loop[k], ins1), z1, ox0 * sB, oy0 * sB, nzB];
      tri(a, b, c, wear); tri(a, c, e, wear);
    }
  };
  const bv = Math.min(bevel, d * 0.45);
  face(-d, bv, -1, false);                                        // the face
  ring(-d, bv, -d + bv * 0.3, bv * 0.3, -0.92, -0.38, 1);          // its rounded bevel (the edge that chips)
  ring(-d + bv * 0.3, bv * 0.3, -d + bv, 0, -0.38, 0, 0.85);
  ring(-d + bv, 0, 0, 0, 0, 0, 0.35);                             // the side wall
  if (back) face(0, 0, 1, true);
  const p = new Part(Float32Array.from(P), Float32Array.from(N));
  for (let i = 0; i < W.length; i++) p.mat[i * 4 + 1] = W[i];
  if (curveY) p.bendY(curveY);
  if (curveX) p.bendX(curveX);
  return p;
}

/**
 * A plate: outline [[x, y], ...] (metres, counter-clockwise, in the XY plane) extruded `depth`
 * with a bevel, its face toward -Z (the back at z = 0), tessellated to `maxEdge` so it bends.
 */
export function plate(outline, depth, { bevel = 0.006, maxEdge = 0, bevelSegs = 2 } = {}) {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(1e-4, depth - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: bevelSegs, curveSegments: 4 });
  g.translate(0, 0, bevel);
  const p = Part.from(g, 'rim');
  p.scale(1, 1, -1);                 // the face toward -Z (mirror; winding fixed by transform)
  if (maxEdge) p.tessellate(maxEdge);
  return p;
}

/** A tube along a polyline (Catmull-Rom smoothed): straps, cables, hoses, piping. */
export function tube(points, r, { seg = 24, radial = 6, closed = false } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed);
  return Part.from(new THREE.TubeGeometry(curve, seg, r, radial, closed)).autoWear(0.15);
}

/** Torus in the XZ plane (a ring around +Y): collars, belts, rims. arc < 2π for an open ring. */
export function torus(R, r, { seg = 24, radial = 6, arc = Math.PI * 2 } = {}) {
  return Part.from(new THREE.TorusGeometry(R, r, radial, seg, arc).rotateX(Math.PI / 2)).autoWear(0.3);
}

/** A flat quad facing -Z, w by h, centred, uv 0..1 (decals: stencils, emblems). */
export function quad(w, h) {
  const P = [], N = [], U = [];
  const v = [[-w / 2, -h / 2, 0, 0], [w / 2, -h / 2, 1, 0], [w / 2, h / 2, 1, 1], [-w / 2, h / 2, 0, 1]];
  for (const k of [0, 2, 1, 0, 3, 2]) { P.push(v[k][0], v[k][1], 0); N.push(0, 0, -1); U.push(v[k][2], v[k][3]); }
  return new Part(Float32Array.from(P), Float32Array.from(N), Float32Array.from(U));
}

/** A chamfered rectangle outline (w by h, corners cut by c; per-corner [tl, tr, br, bl] allowed). */
export function chamfer(w, h, c) {
  const [tl, tr, br, bl] = Array.isArray(c) ? c : [c, c, c, c], x = w / 2, y = h / 2;
  return [[-x + bl, -y], [x - br, -y], [x, -y + br], [x, y - tr], [x - tr, y], [-x + tl, y], [-x, y - tl], [-x, -y + bl]];
}

/** Merge parts into one BufferGeometry (position, normal, aUv, aMat). */
export function merge(parts) {
  let n = 0;
  for (const p of parts) n += p.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), mat = new Float32Array(n * 4);
  let o = 0;
  for (const p of parts) { pos.set(p.pos, o * 3); nor.set(p.nor, o * 3); uv.set(p.uv, o * 2); mat.set(p.mat, o * 4); o += p.count; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aUv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aMat', new THREE.BufferAttribute(mat, 4));
  g.computeBoundingSphere();
  return g;
}

/** Triangle count of a geometry or of parts. */
export const tris = (x) => (Array.isArray(x) ? x.reduce((s, p) => s + p.count, 0) : x instanceof Part ? x.count : x.attributes.position.count) / 3;
