// Cover faces: the sides of cover boxes and parked cars a soldier can put his back to (the cover
// system: MovementController's `cover` mode). A face runs A -> B along the ground, its normal (nx,
// nz) pointing out of the cover toward where you'd crouch behind it; (tx, tz) is the unit way
// along it, len its length, top its height, src what it belongs to (a box, or a car).

const SKIP = new Set(['pole', 'kerb', 'hfloor', 'hroof', 'roof', 'trap', 'tree']);   // (floors, posts, anti-tank hedgehogs you can see through)

function face(out, ax, az, bx, bz, nx, nz, base, top, src) {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.6) return;
  out.push({ ax, az, bx, bz, nx, nz, tx: (bx - ax) / len, tz: (bz - az) / len, len, base, top, src });
}

/** An axis-aligned cover box's four sides (things you can't take cover behind left out: poles, floors). */
export function boxFaces(b, out) {
  if (SKIP.has(b.kind) || b.st?.gone || b.st?.doomed) return;
  const { min: m, max: M } = b;
  face(out, m.x, m.z, M.x, m.z, 0, -1, m.y, M.y, b);   // the -z side
  face(out, M.x, M.z, m.x, M.z, 0, 1, m.y, M.y, b);    // +z
  face(out, m.x, M.z, m.x, m.z, -1, 0, m.y, M.y, b);   // -x
  face(out, M.x, m.z, M.x, M.z, 1, 0, m.y, M.y, b);    // +x
}

/**
 * A box turned by `yaw` (a car: half sizes hx across, hz along, forward is -z at yaw 0): its sides.
 */
export function orientedFaces(cx, cz, yaw, hx, hz, base, top, src, out) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const c = (a, f) => [cx + rx * a + fx * f, cz + rz * a + fz * f];
  const [p0x, p0z] = c(-hx, -hz), [p1x, p1z] = c(hx, -hz), [p2x, p2z] = c(hx, hz), [p3x, p3z] = c(-hx, hz);
  face(out, p0x, p0z, p1x, p1z, -fx, -fz, base, top, src);   // the back
  face(out, p1x, p1z, p2x, p2z, rx, rz, base, top, src);     // the right side
  face(out, p2x, p2z, p3x, p3z, fx, fz, base, top, src);     // the front
  face(out, p3x, p3z, p0x, p0z, -rx, -rz, base, top, src);   // the left side
}

/**
 * The face to take cover against from (x, z): one you're in front of (or just off the end of),
 * within reach, tall enough to hide behind, standing on the ground, with room to crouch behind it;
 * the nearest, favouring one you're facing.
 * @param {object} o { yaw (where you're looking), reach, minHeight, ground(x, z) -> y, free(x, z) -> bool, radius }
 * @returns {{ face, u, d } | null}  u: how far along it you are, d: how far out from it
 */
export function pickFace(faces, x, z, { yaw, reach, minHeight, ground, free, radius }) {
  const lx = -Math.sin(yaw), lz = -Math.cos(yaw);
  let best = null, score = Infinity;
  for (const F of faces) {
    const px = x - F.ax, pz = z - F.az;
    const d = px * F.nx + pz * F.nz, u = px * F.tx + pz * F.tz;
    if (d < -0.1 || d > reach || u < -0.35 || u > F.len + 0.35) continue;
    const uc = Math.max(0.15, Math.min(F.len - 0.15, u));
    const gx = F.ax + F.tx * uc + F.nx * (radius + 0.05), gz = F.az + F.tz * uc + F.nz * (radius + 0.05);
    const g = ground(gx, gz);
    if (F.top - g < minHeight || F.base > g + 0.45) continue;
    // Facing it is better (it's between you and where you're looking).
    const s = d - 0.8 * Math.max(0, -(lx * F.nx + lz * F.nz));
    if (s >= score || !free(gx, gz)) continue;
    best = { face: F, u: uc, d }; score = s;
  }
  return best;
}
