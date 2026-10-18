// HitReactions: what a hit does to the body (Red Dead Redemption 2 and NaturalMotion's Euphoria in
// spirit, HD2's rules; tuning in data/movement.json `ragdoll`, `ragdoll.drive` and `stagger`).
//  * Where it landed (woundSite): head, chest, gut, an arm or a leg, by side. The falling body's
//    hand goes to it (RagdollDrive), and a soldier revived from it limps on it (Health.injury).
//  * Critical hits throw the target as a full ragdoll along the shot: one hit that takes
//    criticalFraction of the health pool (shield included), a headshot taking headFraction, a
//    clean heavy melee blow, or a vehicle ram. The more of the pool it took, the harder the throw.
//  * A hit that kills or downs without throwing: a stumble along the shot first (stagger.die),
//    then the knees go and the body falls (its muscles fold it while it dies, or it catches
//    itself on its hands if it's only down). A killing head shot or a mangling hit is
//    lights-out: limp at once, pushed the way the shot went.
//  * A hit that does neither but takes stagger.fraction of the pool rocks you: a stumble, the gun
//    off target. One to a leg taking stagger.buckle drops you onto that knee for a moment.
//  * Explosions and mines push bodies themselves (CombatWorld.explode, DeployableSystem), and
//    burns, falls and crashes don't push at all: those only collapse the body when they down or
//    kill (limp if it was mangled).
// Simulation code: called by Health after every damage application (entity.onHit).

import { silhouetteScale } from '../movement/Hitboxes.js';

const PUSHLESS = new Set(['explosion', 'splash', 'status', 'fall', 'crash', 'ramSelf', 'vehicleExplosion', 'deployable']);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Where on the body a hit landed: 'head', 'chest', 'gut', 'armL' / 'armR', 'legL' / 'legR', or
 * null when it can't tell. `info.part` is the hit sphere (head, chest, lower torso, legs; a
 * ragdoll's head, chest, pelvis, knees), `info.point` where along the body's width it went in.
 */
export function woundSite(e, info) {
  if (info.zone === 'head' || info.part === 0) return 'head';
  const part = info.part ?? (info.zone === 'limb' ? 3 : info.zone === 'body' ? 1 : -1);
  if (part < 0) return null;
  let lat = 0;
  const p = info.point, s = e.movement?.state;
  if (p && s) {
    const yaw = s.bodyYaw ?? s.yaw ?? 0;
    lat = ((p.x ?? p[0]) - s.position.x) * Math.cos(yaw) - ((p.z ?? p[2]) - s.position.z) * Math.sin(yaw);   // along the body's right
  }
  if (part === 3) return lat < 0 ? 'legL' : 'legR';
  if (part === 2) return 'gut';
  return Math.abs(lat) > 0.22 * silhouetteScale(e) ? (lat < 0 ? 'armL' : 'armR') : 'chest';
}

/**
 * @param {object} e     the fighter that was hit
 * @param {object} res   Health.damage result: { dealt, killed, downed, mangled }
 * @param {object} info  damage info: { kind, zone, part, site, point, dir, poise }
 * @param {object} by    attacker entity (or { id } for projectiles)
 */
export function reactToHit(e, res, info = {}, by = null) {
  const mv = e.movement;
  if (!mv?.startRagdoll || e.isVehicle || e.vehicle || !res || !(res.dealt > 0)) return;
  const R = mv.t.ragdoll, S = mv.t.stagger;
  const kind = info.kind ?? (info.poise !== undefined ? 'melee' : 'hit');
  const fell = res.killed || res.downed;
  const site = info.site ?? woundSite(e, info);
  const limp = res.killed && (site === 'head' || !!res.mangled);   // lights out
  if (PUSHLESS.has(kind)) {
    if (fell && mv.state.mode !== 'ragdoll') mv.startRagdoll(0, 0, 0, { cause: res.killed ? 'death' : 'downed', limp: res.killed && !!res.mangled });
    return;
  }
  const pool = (e.health.max + (e.health.maxShield ?? 0)) || 100;
  const frac = res.dealt / pool;
  // A blade or a fist doesn't throw a man however hard it lands: he reels (below), unless it was
  // a knockdown blow (stagger.melee.knockdown poise).
  const M = S?.melee, poise = info.poise ?? 0;
  const critical = kind === 'melee'
    ? (M ? poise >= M.knockdown || !!info.knockdown : poise >= 50)
    : frac >= R.criticalFraction || (info.zone === 'head' && frac >= R.headFraction) || kind === 'ram';

  // Direction of the hit along the ground: given, or attacker → victim, or backward.
  const p = e.movement.state.position;
  let dx = 0, dz = 0;
  if (info.dir) { dx = info.dir.x ?? info.dir[0]; dz = info.dir.z ?? info.dir[2]; }
  else if (by?.movement) { dx = p.x - by.movement.state.position.x; dz = p.z - by.movement.state.position.z; }
  let l = Math.hypot(dx, dz);
  if (l < 1e-6) { const y = mv.state.bodyYaw; dx = Math.sin(y); dz = Math.cos(y); l = 1; }
  dx /= l; dz /= l;
  const at = info.point ? { x: info.point.x ?? info.point[0], y: info.point.y ?? info.point[1], z: info.point.z ?? info.point[2] }
    : { x: p.x, y: p.y + (info.zone === 'head' ? 1.6 : 1.15), z: p.z };
  const wound = info.point ? { ...at, site } : null;

  if (critical || fell) {
    const [lo, hi] = critical ? R.criticalSpeed : R.collapseSpeed;
    const speed = lo + (hi - lo) * clamp((frac - (critical ? R.criticalFraction : 0)) / 0.5, 0, 1);
    const lift = critical ? R.hitLift : 0.2;
    const cause = critical ? 'critical' : res.killed ? 'death' : 'downed';
    const fall = { at, focus: R.hitFocus, cause, wound, limp };
    // Thrown, already limp, or lights out: the body goes now. Otherwise a stumble along the
    // shot, then the knees go (the stumble carries the fall).
    if (critical || limp || !S || mv.state.mode === 'ragdoll') {
      if (mv.state.mode === 'ragdoll') mv.impulse(dx * speed, lift, dz * speed, fall);
      else mv.startRagdoll(dx * speed, lift, dz * speed, fall);
      return;
    }
    const k = clamp(frac / 0.5, 0, 1), D = S.die;
    mv.stagger(dx, dz, lerp(D.speed[0], D.speed[1], k), { dur: lerp(D.time[0], D.time[1], k), fall: { focus: R.hitFocus, cause, wound, limp } });
    return;
  }

  // Still up: rocked by it?
  if (!S || mv.state.mode === 'ragdoll') return;
  if ((site === 'legL' || site === 'legR') && frac >= S.buckle) {
    mv.stagger(dx, dz, S.speed[0] * 0.6, { dur: S.time[1], kind: 'buckle', side: site === 'legL' ? -1 : 1 });
    return;
  }
  if (kind === 'melee' && M && poise >= M.poise[0]) {
    // Reeling: thrown along the blow, then folded over and stumbling with it.
    const k = clamp((poise - M.poise[0]) / (M.poise[1] - M.poise[0]), 0, 1);
    mv.stagger(dx, dz, lerp(M.speed[0], M.speed[1], k), { dur: lerp(M.time[0], M.time[1], k), kind: 'reel', fold: lerp(M.fold[0], M.fold[1], k) });
    return;
  }
  if (frac >= S.fraction || (kind === 'melee' && (info.poise ?? 0) >= 25)) {
    const k = clamp((frac - S.fraction) / 0.25, 0, 1);
    mv.stagger(dx, dz, lerp(S.speed[0], S.speed[1], k), { dur: lerp(S.time[0], S.time[1], k) });
  }
}
