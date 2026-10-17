// Small, allocation-free math for the procedural rig: easing, table lookup, body frames and
// two-bone IK. Everything works on caller-owned objects so 128 rigs a frame create no garbage.

import { Vector3 } from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const easeOut = (t) => { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t); };
export const easeIn = (t) => { t = clamp(t, 0, 1); return t * t; };
export const wrap01 = (x) => x - Math.floor(x);
export const angleDelta = (a, b) => ((((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
export const lerpAngle = (a, b, t) => a + angleDelta(a, b) * t;
/** Exponential approach factor for a rate (1/s): frame-rate independent smoothing. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * dt);

/** Piecewise-linear lookup in rows [[x, y], ...] sorted by x. Clamps at both ends. */
export function table(rows, x) {
  if (typeof rows === 'number') return rows;
  if (x <= rows[0][0]) return rows[0][1];
  for (let i = 1; i < rows.length; i++) {
    const [x1, y1] = rows[i];
    if (x <= x1) { const [x0, y0] = rows[i - 1]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
  }
  return rows[rows.length - 1][1];
}

/** Forward (-Z at yaw 0) and right vectors of a yaw on the ground plane. */
export const forwardOf = (yaw, out) => out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
export const rightOf = (yaw, out) => out.set(Math.cos(yaw), 0, -Math.sin(yaw));

/**
 * Orthonormal body frame.
 *   d = along the spine (up when standing), n = front (the way the chest faces), r = right.
 * Built in this order, so the parameters stay meaningful for any posture:
 *   yaw   about world up (positive turns left, like movement yaw)
 *   pitch about the right axis: 0 upright, +PI/2 face down with the head forward (prone, dive),
 *         -PI/2 face up with the head back (supine, back dive)
 *   spin  about the spine (positive turns the chest left)
 *   lean  about the front axis (positive tilts the spine toward the right: side dives, banking)
 */
export function bodyFrame(yaw, pitch, spin, lean, F) {
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  let dx = -sy * sp, dy = cp, dz = -cy * sp;      // u cos(p) + f sin(p)
  let nx = -sy * cp, ny = -sp, nz = -cy * cp;     // f cos(p) - u sin(p)
  let rx = cy, ry = 0, rz = -sy;                  // unchanged by pitch
  if (spin) {
    const c = Math.cos(spin), s = Math.sin(spin);
    const nx2 = nx * c - rx * s, ny2 = ny * c - ry * s, nz2 = nz * c - rz * s;
    rx = rx * c + nx * s; ry = ry * c + ny * s; rz = rz * c + nz * s;
    nx = nx2; ny = ny2; nz = nz2;
  }
  if (lean) {
    const c = Math.cos(lean), s = Math.sin(lean);
    const dx2 = dx * c + rx * s, dy2 = dy * c + ry * s, dz2 = dz * c + rz * s;
    rx = rx * c - dx * s; ry = ry * c - dy * s; rz = rz * c - dz * s;
    dx = dx2; dy = dy2; dz = dz2;
  }
  F.d.set(dx, dy, dz); F.n.set(nx, ny, nz); F.r.set(rx, ry, rz);
  return F;
}
export const makeFrame = () => ({ d: new Vector3(0, 1, 0), n: new Vector3(0, 0, -1), r: new Vector3(1, 0, 0) });

/** origin + frame-local [right, up(d), front(n)] → out (world). */
export function frameToWorld(F, origin, x, y, z, out) {
  return out.set(
    origin.x + F.r.x * x + F.d.x * y + F.n.x * z,
    origin.y + F.r.y * x + F.d.y * y + F.n.y * z,
    origin.z + F.r.z * x + F.d.z * y + F.n.z * z,
  );
}
/** Frame-local direction → world direction (not normalized). */
export function frameDir(F, x, y, z, out) {
  return out.set(F.r.x * x + F.d.x * y + F.n.x * z, F.r.y * x + F.d.y * y + F.n.y * z, F.r.z * x + F.d.z * y + F.n.z * z);
}
/** World point → frame-local [right, up, front] relative to origin. */
export function worldToFrame(F, origin, p, out) {
  const x = p.x - origin.x, y = p.y - origin.y, z = p.z - origin.z;
  return out.set(F.r.x * x + F.r.y * y + F.r.z * z, F.d.x * x + F.d.y * y + F.d.z * z, F.n.x * x + F.n.y * y + F.n.z * z);
}

const _axis = new Vector3();
const _pole = new Vector3();

/**
 * Two-bone IK (hip-knee-ankle, shoulder-elbow-hand).
 * Solves the middle joint toward the `pole` direction and writes the reached end point.
 * Targets past full reach are clamped to 99.95% of the chain (no knee snapping).
 * @returns {number} how far the target was out of reach (0 when reached)
 */
export function twoBoneIK(root, target, l1, l2, pole, midOut, endOut) {
  _axis.subVectors(target, root);
  let dist = _axis.length();
  const maxR = (l1 + l2) * 0.9995, minR = Math.abs(l1 - l2) + 1e-3;
  const err = Math.max(0, dist - maxR);
  if (dist < 1e-6) { _axis.set(0, -1, 0); dist = 1e-6; } else _axis.divideScalar(dist);
  const d = clamp(dist, minR, maxR);
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  _pole.copy(pole).addScaledVector(_axis, -pole.dot(_axis));
  if (_pole.lengthSq() < 1e-10) { _pole.set(_axis.y, -_axis.x, 0); if (_pole.lengthSq() < 1e-10) _pole.set(1, 0, 0); }
  _pole.normalize();
  midOut.copy(root).addScaledVector(_axis, x).addScaledVector(_pole, h);
  endOut.copy(root).addScaledVector(_axis, d);
  return err;
}
