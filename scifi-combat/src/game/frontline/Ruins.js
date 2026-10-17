// Ruins: shelled village buildings for close-quarters fighting (deterministic per map seed).
//
// A ruin is a rectangle of walls 0.4 m thick with doorways in its outer walls, and interior walls
// (with their own doorways) splitting it into 2-4 rooms. Some wall stretches are broken down to
// chest or knee height (firing slits and vault-throughs); there's no roof, so the fight inside is
// readable from the third-person camera. Each room is recorded with its bounds and doorways: the
// squad AI stacks on a doorway, clears the room it opens on, and marks it cleared.

const T = 0.4;          // wall thickness
const DOOR = 1.5;       // doorway width

/**
 * @param {object} b  map builder: { R, rand, boxRect }
 * @param {object} o  { id, x, z, w, d }  centre and size (w along X, d along Z)
 * @returns {{ id, min, max, rooms: { min, max, doors }[], doors }}
 */
export function buildRuin(b, { id, x, z, w, d }) {
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
  const height = () => (b.rand() < 0.22 ? b.R(0.9, 1.4) : b.R(2.5, 3.3));       // broken stretches: shoot or vault through
  // Wall along X at z (from xa to xb) or along Z at x, with gaps at the given centres.
  const wall = (axis, at, a, bnd, gaps) => {
    const cuts = gaps.map((g) => [g - DOOR / 2, g + DOOR / 2]).sort((p, q) => p[0] - q[0]);
    let s = a;
    const pieces = [];
    for (const [g0, g1] of cuts) { if (g0 > s + 0.3) pieces.push([s, g0]); s = Math.max(s, g1); }
    if (bnd > s + 0.3) pieces.push([s, bnd]);
    for (const [p0, p1] of pieces) {
      // Long stretches break into ~2.5 m panels of differing height (shell damage).
      for (let q = p0; q < p1 - 0.05; q += 2.5) {
        const q1 = Math.min(p1, q + 2.5), h = height();
        if (axis === 'x') b.boxRect(q, at - T / 2, q1, at + T / 2, h, { surface: 'concrete', kind: 'ruin', destructible: h < 1.5 });
        else b.boxRect(at - T / 2, q, at + T / 2, q1, h, { surface: 'concrete', kind: 'ruin', destructible: h < 1.5 });
      }
    }
  };

  // Rooms: split along the long axis into 2-3 rooms, the largest of them sometimes split again.
  const along = w >= d ? 'x' : 'z', len = along === 'x' ? w : d;
  const n = len > 12 ? 3 : 2;
  const cutsAt = [];
  for (let k = 1; k < n; k++) cutsAt.push((along === 'x' ? x0 : z0) + (len * k) / n + b.R(-0.8, 0.8));
  const rooms = [];
  const edges = [along === 'x' ? x0 : z0, ...cutsAt, along === 'x' ? x1 : z1];
  for (let k = 0; k < edges.length - 1; k++) {
    const r = along === 'x' ? { min: { x: edges[k], z: z0 }, max: { x: edges[k + 1], z: z1 } } : { min: { x: x0, z: edges[k] }, max: { x: x1, z: edges[k + 1] } };
    rooms.push({ ...r, doors: [] });
  }
  // Interior walls with a doorway each (between room k and k + 1).
  cutsAt.forEach((c, k) => {
    const span0 = along === 'x' ? z0 : x0, span1 = along === 'x' ? z1 : x1;
    const g = b.R(span0 + 1.4, span1 - 1.4);
    wall(along === 'x' ? 'z' : 'x', c, span0, span1, [g]);
    const door = along === 'x' ? { x: c, z: g, nx: 1, nz: 0 } : { x: g, z: c, nx: 0, nz: 1 };
    rooms[k].doors.push(door); rooms[k + 1].doors.push({ ...door, nx: -door.nx, nz: -door.nz });
  });
  // Outer walls: doorways for the rooms each wall bounds (on 2-3 chosen walls), at least two
  // overall, so a squad can stack on one and a defender can be flanked through another.
  const doors = [];
  const sides = [['x', z0, x0, x1, 0, -1], ['x', z1, x0, x1, 0, 1], ['z', x0, z0, z1, -1, 0], ['z', x1, z0, z1, 1, 0]];
  const gaps = sides.map(() => []);
  const order = [0, 1, 2, 3].sort(() => b.rand() - 0.5);
  const touches = (r, [axis, at, , , nx, nz]) => (axis === 'x' ? Math.abs((nz < 0 ? r.min.z : r.max.z) - at) < 0.01 : Math.abs((nx < 0 ? r.min.x : r.max.x) - at) < 0.01);
  const addDoor = (si, r) => {
    const [axis, at, , , nx, nz] = sides[si];
    const lo = axis === 'x' ? r.min.x : r.min.z, hi = axis === 'x' ? r.max.x : r.max.z;
    if (hi - lo < DOOR + 1.2 || gaps[si].some((g) => g > lo && g < hi)) return false;
    const g = b.R(lo + DOOR / 2 + 0.5, hi - DOOR / 2 - 0.5);
    gaps[si].push(g);
    const door = axis === 'x' ? { x: g, z: at, nx, nz } : { x: at, z: g, nx, nz };
    r.doors.push(door); doors.push(door);
    return true;
  };
  const want = 2 + (b.rand() < 0.5 ? 1 : 0);
  for (const si of order.slice(0, want)) for (const r of rooms) if (touches(r, sides[si]) && b.rand() > 0.35) addDoor(si, r);
  for (const si of order) { if (doors.length >= 2) break; for (const r of rooms) if (doors.length < 2 && touches(r, sides[si])) addDoor(si, r); }
  sides.forEach(([axis, at, a, bnd], si) => wall(axis, at, a - T / 2, bnd + T / 2, gaps[si]));
  return { id, min: { x: x0, z: z0 }, max: { x: x1, z: z1 }, rooms, doors };
}
