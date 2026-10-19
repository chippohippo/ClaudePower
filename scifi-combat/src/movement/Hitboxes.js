// Hitboxes: stance- and state-aware hit spheres. Going prone, sliding or diving really does
// lower your profile, as in Helldivers 2, because these spheres are what bullets test against.
// A ragdolling body is hit where its particles are (what you see is what you hit, mid-air too).
//
// Layout rows: [forward offset, height, radius, zone] along the body axis (the way the head points).
// Stance transitions blend between layouts, so a soldier half-way up from prone is half-way tall.
// The axis follows the same sim facts the animation rig uses: the head leads in the dive
// direction, supine bodies (back dives, backward knockdowns) have the head behind, and side-dive
// landings roll onto the belly over dive.belly.rollTime.

// Rows match the procedural rig's head, chest, lower torso and legs in each pose (checked by
// tests/animation.test.mjs), so what you see is what you hit.
const LAYOUTS = {
  stand:    [[0.04, 1.65, 0.22, 'head'], [0.02, 1.28, 0.30, 'body'], [0.01, 1.00, 0.28, 'body'], [0.08, 0.50, 0.26, 'limb']],
  crouch:   [[0.30, 1.15, 0.22, 'head'], [0.16, 0.83, 0.30, 'body'], [0.05, 0.60, 0.28, 'body'], [0.28, 0.30, 0.24, 'limb']],
  prone:    [[0.54, 0.40, 0.21, 'head'], [0.26, 0.24, 0.27, 'body'], [0.00, 0.20, 0.26, 'body'], [-0.55, 0.12, 0.22, 'limb']],
  supine:   [[0.44, 0.46, 0.21, 'head'], [0.23, 0.25, 0.27, 'body'], [0.00, 0.18, 0.26, 'body'], [-0.56, 0.20, 0.22, 'limb']],
  slide:    [[-0.36, 0.94, 0.22, 'head'], [-0.27, 0.60, 0.30, 'body'], [-0.15, 0.40, 0.28, 'body'], [0.40, 0.28, 0.24, 'limb']],
  dive:     [[0.47, 0.72, 0.22, 'head'], [0.19, 0.55, 0.30, 'body'], [-0.05, 0.48, 0.28, 'body'], [-0.60, 0.35, 0.24, 'limb']],
  diveBack: [[0.35, 0.90, 0.22, 'head'], [0.17, 0.65, 0.30, 'body'], [-0.05, 0.55, 0.28, 'body'], [-0.46, 0.78, 0.24, 'limb']],
  seated:   [[0, 0.85, 0.22, 'head'], [0, 0.50, 0.30, 'body'], [0.10, 0.25, 0.28, 'body'], [0.30, 0.10, 0.24, 'limb']],
  // A speeder's rider, crouched over the bars from the seat point (tilted with the hull's bank and pitch).
  ride:     [[0.345, 0.69, 0.22, 'head'], [0.16, 0.38, 0.30, 'body'], [0.03, 0.17, 0.28, 'body'], [0.25, 0.02, 0.24, 'limb']],
  // Reeling from a blow at its deepest (REEL_FULL): doubled over, the knees giving.
  folded:   [[0.50, 1.28, 0.22, 'head'], [0.24, 1.07, 0.30, 'body'], [0.06, 0.88, 0.28, 'body'], [0.06, 0.46, 0.26, 'limb']],
};

/** How deep a reel's fold has gone at `u` (0..1 of the stumble): in over 10–32%, out over the last 30%. Rig and spheres share it. */
export const REEL_FULL = 0.95;
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function reelCurve(u) { return ss(0.1, 0.32, u) * (1 - ss(0.7, 1, u)); }

/**
 * How far a sidestep's lean has gone at `u` (0..1 of the evade): thrown out by 45% (ease-out, it
 * reads at once), held, back up by the end (TLOU2: out at 0.13 s, recovered by 0.25 s). Rig and
 * spheres share it.
 */
export function evadeCurve(u) { const a = Math.min(1, Math.max(0, u / 0.45)); return (1 - (1 - a) * (1 - a)) * (1 - ss(0.62, 1, u)); }
// At the sidestep's full lean: how far each sphere has gone along the dodge, and down (m).
const SIDESTEP = [[0.46, 0.28], [0.19, 0.165], [-0.05, 0.08], [-0.15, 0]];

// Aiming up or down moves the head along the aim (it pitches with the look) and, with the gun up,
// the chest too (the rig bends the upper back: body.aimBend). Per rad of the aim's pitch (down
// positive): [head forward, head up per rad, head up per rad², chest forward] (m), standing and
// crouched, gun down and up; measured on the rig (tests/feel-tlou2).
const AIM = {
  stand: { lowered: [0.116, 0.0165, -0.0435, 0], raised: [0.25, 0.0245, -0.0655, 0.059] },
  crouch: { lowered: [0.115, 0.029, -0.043, 0], raised: [0.24, 0.0935, -0.0615, 0.055] },
};

const pool = Array.from({ length: 4 }, () => ({ x: 0, y: 0, z: 0, r: 0, zone: 'body' }));
const angleDelta = (a, b) => ((((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

/** Silhouette scale shared by hitboxes and every view, so what you see is what you hit. */
export function silhouetteScale(e) { return e.transform?.def?.movement?.scale ?? 1; }

/** Yaw of the body axis (the direction the head points along the ground). */
export function bodyAxisYaw(e) {
  const s = e.movement.state, body = s.bodyYaw ?? s.yaw;
  if (e.vehicle) return riding(e) ? e.vehicle.veh.yaw : body;
  if (s.mode === 'dive' && s.dive) return s.dive.dirYaw;
  if (s.mode === 'slide' && s.slide?.kind === 'belly') {
    const from = s.slide.from ?? 'forward';
    if (from === 'back') return body + Math.PI;
    if (from === 'left' || from === 'right') {
      const k = Math.min(1, s.slide.t / (e.movement.t?.dive?.belly?.rollTime ?? 0.35));
      return s.slide.dirYaw + angleDelta(s.slide.dirYaw, body) * k;
    }
    return body;
  }
  if (s.mode === 'knockdown' && s.knock?.supine && s.knock.phase !== 'getup') return body + Math.PI;
  if (s.supine && s.stance === 'prone') return body + Math.PI;
  return body;
}

const layoutOf = (stance, s) => (stance === 'prone' && s.supine ? LAYOUTS.supine : LAYOUTS[stance] ?? LAYOUTS.stand);
/** The driver of a speeder (rides it: the rig's ride pose). */
const riding = (e) => e.vehicle?.veh?.def?.model === 'hover' && e.vehicle.veh.seats?.[e.vehicle.seat]?.def?.role === 'driver';

// The layout (or the two being blended) for a fighter's state, in a reused object: hit spheres
// are built for every soldier along every bullet's path.
const _lay = { a: null, b: null, t: 0 };
const lay = (a, b = null, t = 0) => { _lay.a = a; _lay.b = b; _lay.t = t; return _lay; };
function layoutFor(e) {
  const s = e.movement.state;
  if (e.vehicle) return lay(e.vehicle.pose === 'stand' ? LAYOUTS.stand : riding(e) ? LAYOUTS.ride : LAYOUTS.seated);   // a ring-mount gunner stands
  switch (s.mode) {
    case 'dive': return lay(s.dive?.kind === 'back' ? LAYOUTS.diveBack : LAYOUTS.dive);
    case 'slide': return lay(s.slide?.kind === 'belly' ? (s.slide.from === 'back' ? LAYOUTS.supine : LAYOUTS.prone) : LAYOUTS.slide);
    case 'knockdown': return lay(s.knock?.phase === 'air' ? LAYOUTS.dive : s.knock?.phase === 'getup' ? LAYOUTS.crouch : LAYOUTS.prone);
    case 'roll': return lay(LAYOUTS.crouch);   // curled up, rolling
    case 'stagger':
      if (s.stagger?.kind === 'buckle') return lay(LAYOUTS.crouch);   // down on one knee
      if (s.stagger?.kind === 'reel') {   // doubled over as far as the rig shows it
        const f = reelCurve(s.stagger.t / s.stagger.dur) * (s.stagger.fold ?? 0) / REEL_FULL;
        if (f > 1e-3) return lay(layoutOf(s.stance, s), LAYOUTS.folded, Math.min(1, f));
      }
    // falls through: a stumble keeps the stance's layout
    default:
      if (s.stanceT) return lay(layoutOf(s.stanceT.from, s), layoutOf(s.stanceT.to, s), Math.min(1, s.stanceT.t / s.stanceT.dur));
      return lay(layoutOf(s.stance, s));
  }
}

// A ragdoll's spheres sit on its particles: head, chest, pelvis, and between the knees.
const RAG = [[2, 2, 0.6, 0.21, 'head'], [15, 15, 0.5, 0.29, 'body'], [0, 0, 0.5, 0.27, 'body'], [5, 6, 0.5, 0.22, 'limb']];
function ragdollSpheres(rd) {
  const sc = rd.scale;
  for (let i = 0; i < 4; i++) {
    const [a, b, , r, zone] = RAG[i], o = pool[i];
    o.x = (rd.x[a] + rd.x[b]) * 0.5; o.y = (rd.y[a] + rd.y[b]) * 0.5; o.z = (rd.z[a] + rd.z[b]) * 0.5;
    o.r = r * sc; o.zone = zone;
  }
  return pool;
}

/**
 * World-space hit spheres for a fighter (reused objects: copy what you keep).
 * @returns {{x,y,z,r,zone}[]}
 */
export function hitSpheres(e) {
  const s = e.movement.state;
  if (s.mode === 'ragdoll' && e.movement.ragdoll) return ragdollSpheres(e.movement.ragdoll);
  const { a, b, t } = layoutFor(e);
  const scale = silhouetteScale(e);
  const axis = bodyAxisYaw(e);
  const fx = -Math.sin(axis), fz = -Math.cos(axis);
  const p = s.position;
  // Leaning out of a blow: the spheres go the way the dodge goes, as far as the rig draws it.
  const ev = s.mode === 'dodge' && s.dodgeStyle === 'sidestep' ? evadeCurve(s.modeTime / (e.movement.t?.evade?.sidestep?.duration ?? 0.26)) * scale : 0;
  for (let i = 0; i < 4; i++) {
    const ra = a[i], rb = b ? b[i] : ra;
    const fwd = (ra[0] + (rb[0] - ra[0]) * t) * scale;
    const o = pool[i];
    o.x = p.x + fx * fwd;
    o.z = p.z + fz * fwd;
    o.y = p.y + (ra[1] + (rb[1] - ra[1]) * t) * scale;
    o.r = (ra[2] + (rb[2] - ra[2]) * t) * scale;
    o.zone = ra[3];
    if (ev > 0) { const L = SIDESTEP[i], d = s.dodgeDir; o.x += d.x * L[0] * ev; o.z += d.z * L[0] * ev; o.y -= L[1] * ev; }
  }
  // A speeder's rider tilts with its hull about the seat point: banked (+ right), then nose up.
  const veh = riding(e) ? e.vehicle.veh : null;
  if (veh && (veh.bank || veh.pitch)) {
    const cb = Math.cos(veh.bank), sb = Math.sin(veh.bank), cp = Math.cos(veh.pitch), sn = Math.sin(veh.pitch), rx = -fz, rz = fx;
    for (let i = 0; i < 4; i++) {
      const o = pool[i], dx = o.x - p.x, dy = o.y - p.y, dz = o.z - p.z;
      const r = dx * rx + dz * rz, f = dx * fx + dz * fz;
      const r1 = r * cb + dy * sb, u1 = -r * sb + dy * cb, f2 = f * cp - u1 * sn, u2 = f * sn + u1 * cp;
      o.x = p.x + rx * r1 + fx * f2; o.y = p.y + u2; o.z = p.z + rz * r1 + fz * f2;
    }
  }
  // On your feet, the head (and with the gun up, the chest) goes along a high or low aim.
  const ap = e.weapons?.aimPitch ?? 0, set = (s.mode === 'ground' || s.mode === 'cover') && !s.stanceT && !e.vehicle ? AIM[s.stance] : null;
  if (set && ap !== 0) {
    const row = e.mode === 'gun' && s.weaponReady !== false ? set.raised : set.lowered;
    const p = Math.max(-1, Math.min(1, ap)), yaw = e.weapons?.aimYaw ?? s.aimYaw ?? axis;
    const ax = -Math.sin(yaw) * scale, az = -Math.cos(yaw) * scale, h = -p * row[0], c = -p * row[3];
    pool[0].x += ax * h; pool[0].z += az * h; pool[0].y += (row[1] * p + row[2] * p * p) * scale;
    pool[1].x += ax * c; pool[1].z += az * c;
  }
  return pool;
}

/**
 * A sphere around all of a standing, crouched, prone, sliding or diving soldier's hit spheres
 * (not a ragdoll's: its limbs can be anywhere), for a cheap first test: [height of its centre
 * above the feet, radius], times the silhouette scale.
 */
export const BOUND = [0.9, 1.3];

/** Centre of mass for line-of-sight checks and AI aim (the "chest" sphere). */
export function chestPoint(e, out) {
  const s = hitSpheres(e)[1];
  return out.set(s.x, s.y, s.z);
}
