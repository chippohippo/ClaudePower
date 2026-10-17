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
};

const pool = Array.from({ length: 4 }, () => ({ x: 0, y: 0, z: 0, r: 0, zone: 'body' }));
const angleDelta = (a, b) => ((((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

/** Silhouette scale shared by hitboxes and every view, so what you see is what you hit. */
export function silhouetteScale(e) { return e.transform?.def?.movement?.scale ?? 1; }

/** Yaw of the body axis (the direction the head points along the ground). */
export function bodyAxisYaw(e) {
  const s = e.movement.state, body = s.bodyYaw ?? s.yaw;
  if (e.vehicle) return body;
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

// The layout (or the two being blended) for a fighter's state, in a reused object: hit spheres
// are built for every soldier along every bullet's path.
const _lay = { a: null, b: null, t: 0 };
const lay = (a, b = null, t = 0) => { _lay.a = a; _lay.b = b; _lay.t = t; return _lay; };
function layoutFor(e) {
  const s = e.movement.state;
  if (e.vehicle) return lay(LAYOUTS.seated);
  switch (s.mode) {
    case 'dive': return lay(s.dive?.kind === 'back' ? LAYOUTS.diveBack : LAYOUTS.dive);
    case 'slide': return lay(s.slide?.kind === 'belly' ? (s.slide.from === 'back' ? LAYOUTS.supine : LAYOUTS.prone) : LAYOUTS.slide);
    case 'knockdown': return lay(s.knock?.phase === 'air' ? LAYOUTS.dive : s.knock?.phase === 'getup' ? LAYOUTS.crouch : LAYOUTS.prone);
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
  for (let i = 0; i < 4; i++) {
    const ra = a[i], rb = b ? b[i] : ra;
    const fwd = (ra[0] + (rb[0] - ra[0]) * t) * scale;
    const o = pool[i];
    o.x = p.x + fx * fwd;
    o.z = p.z + fz * fwd;
    o.y = p.y + (ra[1] + (rb[1] - ra[1]) * t) * scale;
    o.r = (ra[2] + (rb[2] - ra[2]) * t) * scale;
    o.zone = ra[3];
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
