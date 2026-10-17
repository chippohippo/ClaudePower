// Hitboxes: stance- and state-aware hit spheres. Going prone, sliding or diving really does
// lower your profile, as in Helldivers 2, because these spheres are what bullets test against.
//
// Layout rows: [forward offset, height, radius, zone] in the body's frame (forward = bodyYaw).
// Stance transitions blend between layouts, so a soldier half-way up from prone is half-way tall.

const LAYOUTS = {
  stand:  [[0, 1.65, 0.22, 'head'], [0, 1.28, 0.30, 'body'], [0, 0.92, 0.28, 'body'], [0, 0.48, 0.26, 'limb']],
  crouch: [[0.12, 1.10, 0.22, 'head'], [0.05, 0.82, 0.30, 'body'], [0, 0.50, 0.28, 'body'], [0, 0.25, 0.24, 'limb']],
  prone:  [[0.80, 0.30, 0.22, 'head'], [0.40, 0.28, 0.30, 'body'], [-0.05, 0.25, 0.28, 'body'], [-0.60, 0.18, 0.24, 'limb']],
  slide:  [[-0.20, 0.95, 0.22, 'head'], [-0.10, 0.65, 0.30, 'body'], [0.25, 0.40, 0.28, 'body'], [0.75, 0.25, 0.24, 'limb']],
  dive:   [[0.75, 0.85, 0.22, 'head'], [0.35, 0.80, 0.30, 'body'], [-0.10, 0.75, 0.28, 'body'], [-0.65, 0.70, 0.24, 'limb']],
  seated: [[0, 0.85, 0.22, 'head'], [0, 0.50, 0.30, 'body'], [0.10, 0.25, 0.28, 'body'], [0.30, 0.10, 0.24, 'limb']],
};

const pool = Array.from({ length: 4 }, () => ({ x: 0, y: 0, z: 0, r: 0, zone: 'body' }));

function layoutFor(e) {
  const s = e.movement.state;
  if (e.vehicle) return { a: LAYOUTS.seated };
  switch (s.mode) {
    case 'dive': return { a: LAYOUTS.dive };
    case 'slide': return { a: s.slide?.kind === 'belly' ? LAYOUTS.prone : LAYOUTS.slide };
    case 'knockdown': return { a: s.knock?.phase === 'air' ? LAYOUTS.dive : s.knock?.phase === 'getup' ? LAYOUTS.crouch : LAYOUTS.prone };
    default:
      if (s.stanceT) return { a: LAYOUTS[s.stanceT.from], b: LAYOUTS[s.stanceT.to], t: Math.min(1, s.stanceT.t / s.stanceT.dur) };
      return { a: LAYOUTS[s.stance] ?? LAYOUTS.stand };
  }
}

/**
 * World-space hit spheres for a fighter (reused objects: copy what you keep).
 * @returns {{x,y,z,r,zone}[]}
 */
export function hitSpheres(e) {
  const s = e.movement.state;
  const { a, b, t = 0 } = layoutFor(e);
  const scale = e.transform?.def?.movement?.scale ?? 1;
  const fx = -Math.sin(s.bodyYaw ?? s.yaw), fz = -Math.cos(s.bodyYaw ?? s.yaw);
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
