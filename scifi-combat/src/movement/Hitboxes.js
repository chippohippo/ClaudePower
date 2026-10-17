// Hitboxes: stance- and state-aware hit spheres. Going prone, sliding or diving really does
// lower your profile, as in Helldivers 2, because these spheres are what bullets test against.
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

function layoutFor(e) {
  const s = e.movement.state;
  if (e.vehicle) return { a: LAYOUTS.seated };
  switch (s.mode) {
    case 'dive': return { a: s.dive?.kind === 'back' ? LAYOUTS.diveBack : LAYOUTS.dive };
    case 'slide': return { a: s.slide?.kind === 'belly' ? (s.slide.from === 'back' ? LAYOUTS.supine : LAYOUTS.prone) : LAYOUTS.slide };
    case 'knockdown': return { a: s.knock?.phase === 'air' ? LAYOUTS.dive : s.knock?.phase === 'getup' ? LAYOUTS.crouch : LAYOUTS.prone };
    default:
      if (s.stanceT) return { a: layoutOf(s.stanceT.from, s), b: layoutOf(s.stanceT.to, s), t: Math.min(1, s.stanceT.t / s.stanceT.dur) };
      return { a: layoutOf(s.stance, s) };
  }
}

/**
 * World-space hit spheres for a fighter (reused objects: copy what you keep).
 * @returns {{x,y,z,r,zone}[]}
 */
export function hitSpheres(e) {
  const s = e.movement.state;
  const { a, b, t = 0 } = layoutFor(e);
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

/** Centre of mass for line-of-sight checks and AI aim (the "chest" sphere). */
export function chestPoint(e, out) {
  const s = hitSpheres(e)[1];
  return out.set(s.x, s.y, s.z);
}
