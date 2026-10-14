// Apex-style hitboxes: a head sphere, body capsules (neck, chest, shoulders, pelvis, arms) and limb
// capsules (thighs, shins) on a realistically proportioned 1.8 m human. They are posed for standing,
// crouching, sliding and downed, turned by yaw, and widened or narrowed by the legend's size class
// (Apex: Wraith-small … Gibraltar-large). The server (bot bullets), the client (hit claims) and the
// Firing Range hitbox overlay all use this one definition, and the character pose layer
// (client/modelavatar.js) uses the same lean / drop numbers so the model matches its hitbox.

import { LEGENDS } from './legends.js';

// width multiplier per size class; heights are shared so movement and eye height stay identical
export const SIZE_CLASS = { small: 0.92, medium: 1.0, large: 1.12 };
const ROLE_SIZE = { dps: 'small', support: 'medium', tank: 'large' };
export function legendSize(legend) {
  const L = LEGENDS[legend];
  return SIZE_CLASS[(L && (L.size || ROLE_SIZE[L.cls])) || 'medium'];
}

// Standing joints in the body frame (metres; x right, y up, -z forward). Shared with the pose layer.
export const BODY = {
  headY: 1.67, headZ: -0.02, headR: 0.125,
  neckY: 1.53, chestTop: 1.36, chestBot: 1.08, chestDX: 0.07, chestR: 0.14,
  shoulderY: 1.40, shoulderX: 0.19, shoulderR: 0.085,
  pelvisY: 0.94, hipY: 0.92, hipX: 0.095, pelvisR: 0.13,
  thigh: 0.42, shin: 0.41, thighR: 0.085, shinR: 0.06, ankleY: 0.09,
  upperArmR: 0.055, forearmR: 0.045,
  // rifle hold (right hand on the grip, left on the handguard)
  elbowR: [0.24, 1.13, -0.10], handR: [0.13, 1.25, -0.32],
  elbowL: [-0.20, 1.17, -0.22], handL: [0.02, 1.30, -0.58],
  // downed: hands planted in front (x mirrored per side); zipline grip; airborne knee tuck
  downHand: [0.22, 0.12, -0.55], zipHand: [0.07, 2.08, -0.05], tuck: 0.22,
};

// Pose parameters: pelvis drop (m), upper-body lean about the pelvis (rad, + = forward), ankles.
export function bodyPose(mode, crouch = 0) {
  if (mode === 'downed') return { drop: 0.5, lean: 1.2, ankles: [[-0.13, 0.08, 0.5], [0.13, 0.08, 0.5]], arms: 'ground' };
  if (mode === 'slide') return { drop: 0.6, lean: -0.35, ankles: [[-0.1, 0.12, -0.7], [0.14, 0.08, 0.12]], arms: 'rifle' };
  // airborne: knees tucked (BODY.tuck); zipline: both hands up on the cable
  if (mode === 'air') return { drop: 0, lean: 0, ankles: [[-0.12, BODY.ankleY + BODY.tuck, 0.04], [0.12, BODY.ankleY + BODY.tuck, 0.04]], arms: 'rifle' };
  if (mode === 'zip') return { drop: 0, lean: 0, ankles: [[-0.12, BODY.ankleY, 0.02], [0.12, BODY.ankleY, 0.02]], arms: 'up' };
  const c = Math.max(0, Math.min(1, crouch));
  return { drop: 0.55 * c, lean: 0.5 * c, ankles: [[-0.12 - 0.01 * c, BODY.ankleY, 0.02 + 0.03 * c], [0.12 + 0.01 * c, BODY.ankleY, 0.02 + 0.03 * c]], arms: 'rifle' };
}

// Knee by two-bone IK in the plane that holds the hip→ankle line and the forward direction.
function knee(h, a, l1, l2) {
  const ux0 = a[0] - h[0], uy0 = a[1] - h[1], uz0 = a[2] - h[2];
  const d = Math.max(1e-4, Math.hypot(ux0, uy0, uz0));
  const ux = ux0 / d, uy = uy0 / d, uz = uz0 / d;
  const dd = Math.min(d, l1 + l2 - 1e-4);
  const along = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd);
  const off = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  // bend toward -z (knees forward), orthogonalised against the leg line
  let vx = 0, vy = 0, vz = -1;
  const k = vx * ux + vy * uy + vz * uz;
  vx -= k * ux; vy -= k * uy; vz -= k * uz;
  let vl = Math.hypot(vx, vy, vz);
  if (vl < 1e-3) { vx = 0; vy = -1; vz = 0; vl = 1; }
  return [h[0] + ux * along + (vx / vl) * off, h[1] + uy * along + (vy / vl) * off, h[2] + uz * along + (vz / vl) * off];
}

// Hitbox capsules for a pose, in world space: [{a:[x,y,z], b:[x,y,z], r, part}] (a sphere has a === b).
// pose: { x, y, z, yaw, crouch, mode: 'stand'|'air'|'zip'|'slide'|'downed', size (width multiplier) }
export function hitboxCapsules(pose) {
  const w = pose.size || 1, B = BODY;
  const P = bodyPose(pose.mode, pose.crouch);
  const cl = Math.cos(P.lean), sl = Math.sin(P.lean);
  const pY = B.pelvisY - P.drop;
  // upper body: lean about the pelvis, then drop
  const up = (x, y, z) => { const dy = y - B.pelvisY, dz = z; return [x, pY + dy * cl + dz * sl, -dy * sl + dz * cl]; };
  const caps = [];
  const add = (a, b, r, part) => caps.push({ a, b, r, part });
  const head = up(0, B.headY, B.headZ);
  add(head, head, B.headR, 'head');
  add(up(0, B.neckY - 0.03, 0), up(0, B.neckY + 0.03, -0.01), 0.07 * w, 'body');
  for (const sx of [-1, 1]) add(up(sx * B.chestDX * w, B.chestBot, 0), up(sx * B.chestDX * w, B.chestTop, 0), B.chestR * w, 'body');
  add(up(-B.shoulderX * w, B.shoulderY, 0), up(B.shoulderX * w, B.shoulderY, 0), B.shoulderR * w, 'body');
  add([-B.hipX * w, pY, 0], [B.hipX * w, pY, 0], B.pelvisR * w, 'body');
  if (P.arms === 'rifle') {
    const sR = up((B.shoulderX + 0.01) * w, B.shoulderY, 0), sL = up(-(B.shoulderX + 0.01) * w, B.shoulderY, 0);
    const eR = up(B.elbowR[0] * w, B.elbowR[1], B.elbowR[2]), eL = up(B.elbowL[0] * w, B.elbowL[1], B.elbowL[2]);
    add(sR, eR, B.upperArmR * w, 'body'); add(eR, up(...B.handR), B.forearmR * w, 'body');
    add(sL, eL, B.upperArmR * w, 'body'); add(eL, up(...B.handL), B.forearmR * w, 'body');
  } else if (P.arms === 'up') {
    for (const sx of [-1, 1]) add(up(sx * (B.shoulderX + 0.01) * w, B.shoulderY, 0), [sx * B.zipHand[0], B.zipHand[1], B.zipHand[2]], B.forearmR * w, 'body');
  } else {
    // downed: hands planted in front
    for (const sx of [-1, 1]) {
      const s = up(sx * (B.shoulderX + 0.01) * w, B.shoulderY, 0), hnd = [sx * B.downHand[0] * w, B.downHand[1], B.downHand[2]];
      add(s, hnd, B.forearmR * w, 'body');
    }
  }
  for (let i = 0; i < 2; i++) {
    const sx = i ? 1 : -1;
    const hip = [sx * B.hipX * w, pY - (B.pelvisY - B.hipY), 0];
    const an = P.ankles[i], ankle = [an[0] * w, an[1], an[2]];
    const kn = knee(hip, ankle, B.thigh, B.shin);
    add(hip, kn, B.thighR * w, 'legs');
    add(kn, ankle, B.shinR * w, 'legs');
  }
  // body frame → world
  const c = Math.cos(pose.yaw || 0), s = Math.sin(pose.yaw || 0);
  const tw = (p) => [pose.x + p[0] * c + p[2] * s, pose.y + p[1], pose.z - p[0] * s + p[2] * c];
  for (const k of caps) { const sphere = k.a === k.b; k.a = tw(k.a); k.b = sphere ? k.a : tw(k.b); }
  return caps;
}

// Ray (unit direction) vs capsule: distance along the ray or -1 (Inigo Quilez's capsule intersector).
export function rayCapsule(ox, oy, oz, dx, dy, dz, a, b, r) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const oax = ox - a[0], oay = oy - a[1], oaz = oz - a[2];
  const baba = bax * bax + bay * bay + baz * baz;
  if (baba < 1e-10) return raySphere(ox, oy, oz, dx, dy, dz, a, r);
  const bard = bax * dx + bay * dy + baz * dz;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = dx * oax + dy * oay + dz * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const qa = baba - bard * bard, qb = baba * rdoa - baoa * bard, qc = baba * oaoa - baoa * baoa - r * r * baba;
  const h = qb * qb - qa * qc;
  if (h < 0) return -1;
  if (qa > 1e-10) {
    const t = (-qb - Math.sqrt(h)) / qa;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t;
    return raySphere(ox, oy, oz, dx, dy, dz, y <= 0 ? a : b, r);
  }
  // ray parallel to the axis: only the caps can be hit first
  const t1 = raySphere(ox, oy, oz, dx, dy, dz, a, r), t2 = raySphere(ox, oy, oz, dx, dy, dz, b, r);
  return t1 < 0 ? t2 : t2 < 0 ? t1 : Math.min(t1, t2);
}

function raySphere(ox, oy, oz, dx, dy, dz, c, r) {
  const lx = ox - c[0], ly = oy - c[1], lz = oz - c[2];
  const b = lx * dx + ly * dy + lz * dz;
  const h = b * b - (lx * lx + ly * ly + lz * lz - r * r);
  if (h < 0) return -1;
  return -b - Math.sqrt(h);
}

// Ray vs a player's hitbox: { t, part } for the nearest part hit within maxT, or null.
// A bounding sphere rejects most rays before the capsules are built.
export function rayHitbox(ox, oy, oz, dx, dy, dz, pose, maxT) {
  const cx = pose.x, cy = pose.y + 0.9, cz = pose.z;
  const lx = ox - cx, ly = oy - cy, lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const R = 1.2 * Math.max(1, pose.size || 1);
  const h = b * b - (lx * lx + ly * ly + lz * lz - R * R);
  if (h < 0 || -b - Math.sqrt(h) > maxT || -b + Math.sqrt(h) < 0) return null;
  let best = maxT, part = null;
  for (const k of hitboxCapsules(pose)) {
    const t = rayCapsule(ox, oy, oz, dx, dy, dz, k.a, k.b, k.r);
    if (t >= 0 && t < best) { best = t; part = k.part; }
  }
  return part ? { t: best, part } : null;
}

// Pose for a player from the movement state (server) or a remote snapshot (client).
export function poseOf(x, y, z, yaw, crouch, downed, sliding, legend, air = false, zip = false) {
  const mode = downed ? 'downed' : sliding ? 'slide' : zip ? 'zip' : air && crouch < 0.5 ? 'air' : 'stand';
  return { x, y, z, yaw, crouch, mode, size: legendSize(legend) };
}
