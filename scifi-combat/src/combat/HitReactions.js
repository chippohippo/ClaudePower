// HitReactions: what a hit does to the body (HD2 rules; tuning in data/movement.json `ragdoll`).
//  * Critical hits throw the target as a full ragdoll along the shot: one hit that takes
//    criticalFraction of the health pool (shield included), a headshot taking headFraction, a
//    clean heavy melee blow, or a vehicle ram. The more of the pool it took, the harder the throw.
//  * A hit that downs or kills drops the body limp, pushed gently the way the shot went: a real
//    collapse instead of a canned death pose.
//  * Explosions and mines push bodies themselves (CombatWorld.explode, DeployableSystem), and
//    burns, falls and crashes don't push at all: those only collapse the body when they down or kill.
// Simulation code: called by Health after every damage application (entity.onHit).

const PUSHLESS = new Set(['explosion', 'splash', 'status', 'fall', 'crash', 'ramSelf', 'vehicleExplosion', 'deployable']);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * @param {object} e     the fighter that was hit
 * @param {object} res   Health.damage result: { dealt, killed, downed }
 * @param {object} info  damage info: { kind, zone, point, dir, poise }
 * @param {object} by    attacker entity (or { id } for projectiles)
 */
export function reactToHit(e, res, info = {}, by = null) {
  const mv = e.movement;
  if (!mv?.startRagdoll || e.isVehicle || e.vehicle || !res || !(res.dealt > 0)) return;
  const R = mv.t.ragdoll;
  const kind = info.kind ?? (info.poise !== undefined ? 'melee' : 'hit');
  const fell = res.killed || res.downed;
  if (PUSHLESS.has(kind)) {
    if (fell && mv.state.mode !== 'ragdoll') mv.startRagdoll(0, 0, 0, { cause: res.killed ? 'death' : 'downed' });
    return;
  }
  const pool = (e.health.max + (e.health.maxShield ?? 0)) || 100;
  const frac = res.dealt / pool;
  const critical = frac >= R.criticalFraction || (info.zone === 'head' && frac >= R.headFraction)
    || (kind === 'melee' && (info.poise ?? 0) >= 50) || kind === 'ram';
  if (!critical && !fell) return;

  // Direction of the hit along the ground: given, or attacker → victim, or backward.
  const p = e.movement.state.position;
  let dx = 0, dz = 0;
  if (info.dir) { dx = info.dir.x ?? info.dir[0]; dz = info.dir.z ?? info.dir[2]; }
  else if (by?.movement) { dx = p.x - by.movement.state.position.x; dz = p.z - by.movement.state.position.z; }
  let l = Math.hypot(dx, dz);
  if (l < 1e-6) { const y = mv.state.bodyYaw; dx = Math.sin(y); dz = Math.cos(y); l = 1; }
  dx /= l; dz /= l;
  const [lo, hi] = critical ? R.criticalSpeed : R.collapseSpeed;
  const speed = lo + (hi - lo) * clamp((frac - (critical ? R.criticalFraction : 0)) / 0.5, 0, 1);
  const lift = critical ? R.hitLift : 0.2;
  const at = info.point ? { x: info.point.x ?? info.point[0], y: info.point.y ?? info.point[1], z: info.point.z ?? info.point[2] }
    : { x: p.x, y: p.y + (info.zone === 'head' ? 1.6 : 1.15), z: p.z };
  const cause = critical ? 'critical' : res.killed ? 'death' : 'downed';
  if (mv.state.mode === 'ragdoll') mv.impulse(dx * speed, lift, dz * speed, { at, focus: R.hitFocus, cause });
  else mv.startRagdoll(dx * speed, lift, dz * speed, { at, focus: R.hitFocus, cause });
}
