// Small geometry helpers shared by sim systems (no Three.js scene objects).

/**
 * Ray vs. a yaw-rotated box whose base sits at `base` (y = 0 in local space is the floor of the box).
 * half = { x, y (full height), z }. Returns { t, local: {x,y,z} } or null.
 * Local axes: x = right, y = up, z = back (forward is -z, matching the rest of the codebase).
 */
export function rayYawBox(o, dir, base, yaw, half, max) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const dx = o.x - base.x, dz = o.z - base.z;
  const ox = dx * cy - dz * sy, oy = o.y - base.y, oz = dx * sy + dz * cy;
  const vx = dir.x * cy - dir.z * sy, vy = dir.y, vz = dir.x * sy + dir.z * cy;
  // Slabs, unrolled (this runs for every projectile against every nearby hull: no allocation
  // unless it hits).
  let tmin = 0, tmax = max, t1, t2, s;
  if (Math.abs(vx) < 1e-8) { if (ox < -half.x || ox > half.x) return null; }
  else { t1 = (-half.x - ox) / vx; t2 = (half.x - ox) / vx; if (t1 > t2) { s = t1; t1 = t2; t2 = s; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return null; }
  if (Math.abs(vy) < 1e-8) { if (oy < 0 || oy > half.y) return null; }
  else { t1 = -oy / vy; t2 = (half.y - oy) / vy; if (t1 > t2) { s = t1; t1 = t2; t2 = s; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return null; }
  if (Math.abs(vz) < 1e-8) { if (oz < -half.z || oz > half.z) return null; }
  else { t1 = (-half.z - oz) / vz; t2 = (half.z - oz) / vz; if (t1 > t2) { s = t1; t1 = t2; t2 = s; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return null; }
  return { t: tmin, local: { x: ox + vx * tmin, y: oy + vy * tmin, z: oz + vz * tmin } };
}

/** Rotate a local offset [x, y, z] by yaw (three.js convention) into world space and add it to `base`. */
export function localToWorld(out, base, yaw, [x, y, z]) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return out.set(base.x + x * c + z * s, base.y + y, base.z - x * s + z * c);
}

/** Shortest signed angle from a to b (radians). */
export const angleDelta = (a, b) => ((((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
