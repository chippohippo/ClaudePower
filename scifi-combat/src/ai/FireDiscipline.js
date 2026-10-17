// FireDiscipline: friendly fire is on (data/rules.json), so every bot that pulls a trigger, throws
// a grenade or lays a gun checks first that no teammate stands in the line of fire (a body's
// width either side of it) or inside the blast round the aim point. A person steps aside for a
// clean line; so do the bots (CombatBotBrain picks a new strafe when this says no).

/**
 * @param {CombatWorld} world
 * @param {number} team          the shooter's team (its teammates are what we look for)
 * @param {{x,y,z}} from         the muzzle (or eye)
 * @param {{x,y,z}} to           the aim point
 * @param {object} o { width: m either side of the line, splash: blast radius at `to`, exclude: an entity to ignore (the shooter) }
 * @returns {boolean} true when nobody on our side is in the way
 */
export function lineClearOfFriends(world, team, from, to, { width = 0.9, splash = 0, exclude = null } = {}) {
  if (!world.harm) return true;
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, l = Math.hypot(dx, dy, dz) || 1;
  const ux = dx / l, uy = dy / l, uz = dz / l, w2 = width * width;
  let ok = true;
  _c.x = from.x + dx / 2; _c.y = from.y; _c.z = from.z + dz / 2;
  world.fightersNear(_c, l / 2 + splash + 2, (e) => {
    if (!ok || e === exclude || e.team !== team || e.health.dead || e.isVehicle || (e.vehicle && !e.vehicle.exposed)) return;
    const p = e.movement.state.position, px = p.x - from.x, py = p.y + 1.0 - from.y, pz = p.z - from.z;
    const t = px * ux + py * uy + pz * uz;
    if (t > 0.4 && t < l + 0.6) {
      const cx = px - ux * t, cy = py - uy * t, cz = pz - uz * t;
      if (cx * cx + cz * cz + cy * cy * 0.4 < w2) ok = false;              // in the line of fire
    }
    if (splash > 0 && Math.hypot(p.x - to.x, p.z - to.z) < splash + 1.5) ok = false;   // in the blast
  });
  return ok;
}
const _c = { x: 0, y: 0, z: 0 };
