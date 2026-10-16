// Small geometry helpers shared by sim systems (no Three.js scene objects).

/**
 * Ray vs. a yaw-rotated box whose base sits at `base` (y = 0 in local space is the floor of the box).
 * half = { x, y (full height), z }. Returns { t, local: {x,y,z} } or null.
 * Local axes: x = right, y = up, z = back (forward is -z, matching the rest of the codebase).
 */
export function rayYawBox(o, dir, base, yaw, half, max) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const dx = o.x - base.x, dz = o.z - base.z;
  const lo = { x: dx * cy - dz * sy, y: o.y - base.y, z: dx * sy + dz * cy };
  const ld = { x: dir.x * cy - dir.z * sy, y: dir.y, z: dir.x * sy + dir.z * cy };
  let tmin = 0, tmax = max;
  for (const a of ['x', 'y', 'z']) {
    const lo_ = a === 'y' ? 0 : -half[a], hi = half[a];
    if (Math.abs(ld[a]) < 1e-8) { if (lo[a] < lo_ || lo[a] > hi) return null; continue; }
    let t1 = (lo_ - lo[a]) / ld[a], t2 = (hi - lo[a]) / ld[a];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return { t: tmin, local: { x: lo.x + ld.x * tmin, y: lo.y + ld.y * tmin, z: lo.z + ld.z * tmin } };
}

/** Rotate a local offset [x, y, z] by yaw (three.js convention) into world space and add it to `base`. */
export function localToWorld(out, base, yaw, [x, y, z]) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return out.set(base.x + x * c + z * s, base.y + y, base.z - x * s + z * c);
}

/** Shortest signed angle from a to b (radians). */
export const angleDelta = (a, b) => ((((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
