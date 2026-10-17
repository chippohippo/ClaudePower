// TrooperKit: the two trooper armies' kit, modeled in code (docs/ART_DIRECTION.md: "The two
// trooper armies"; data/art/troopers.json maps each class role to its kit).
//
// Every mesh here is rigidly skinned: each vertex follows one rig bone (aMat.w), so a whole
// body (plates, pouches, boots, gloves on 14 bones) is ONE geometry and one draw call for
// everyone wearing it (CrowdRenderer poses it from a bone texture). Paint is by channel
// (ModelKit CH), so one mesh serves both armies: the shader looks the color up per faction.
//
// Bone frames (what each part is modeled in):
//   pelvis, chest, head  +X right, +Y up, -Z forward (the face, the chest plate)
//   abdomen              the same, +Y from the pelvis (0) to the chest centre (REF.abdomen)
//   limbs                +Y down the limb from the joint (0) to the next (REF.*), +X the body's
//                        right, +Z forward (the knee pad is at +Z)
//   foot                 origin at the ankle, +X right, +Y up, -Z toward the toe
//   gun                  origin at the butt, -Z toward the muzzle, +Y up (modeled at its length)
//   cape0..2             +Y down the cape from each link, -Z the outer face
//
// Three body weights (light, medium, heavy), six helmets, role gear (packs, antennas, the
// medic's armband: gear may hang on any bone), seven weapons, the cape; each at two detail
// levels (near: every pouch, strap and stencil; mid: the silhouette and paint).

import { CH, rbox, shell, plate, cyl, lathe, tube, torus, quad, merge, tris } from './ModelKit.js';

export const BONE = {
  pelvis: 0, abdomen: 1, chest: 2, head: 3, upperArmL: 4, upperArmR: 5, foreArmL: 6, foreArmR: 7,
  thighL: 8, thighR: 9, shinL: 10, shinR: 11, footL: 12, footR: 13, gun: 14, cape0: 15, cape1: 16, cape2: 17,
};
export const NBONES = 18;
/** Reference lengths the limbs are modeled at (rig dims; the bone matrix stretches to the real one). */
export const REF = { abdomen: 0.34, upperArm: 0.29, foreArm: 0.28, thigh: 0.45, shin: 0.45, cape: 0.27 };
/** Gun lengths per archetype (data/animation/humanoid.json gun.lengths). */
export const GUN_LENGTH = { smg: 0.55, assaultRifle: 0.82, shotgun: 0.86, sniper: 1.12, pulseRifle: 0.78, beam: 0.9, super: 1.05 };

// Detail per level: segments, and whether the small things (pouches, straps, stencils) exist.
const LV = [
  { ws: 7, hs: 4, nu: 2, nv: 2, seg: 6, fine: false },        // mid
  { ws: 14, hs: 8, nu: 7, nv: 5, seg: 12, fine: true },       // near
];

// ---------------------------------------------------------------- helpers
const rb = (L, sx, sy, sz, o = {}) => rbox(sx, sy, sz, { ws: o.ws ?? L.ws, hs: o.hs ?? L.hs, e1: o.e1 ?? 0.3, e2: o.e2 ?? 0.3, ...o });
const sh = (L, w, h, d, o = {}) => shell(w, h, d, { nu: o.nu ?? L.nu, nv: o.nv ?? L.nv, bevel: L.fine ? (o.bevel ?? 0.008) : 0.003, ...o, ...(L.fine ? {} : { bevel: Math.min(0.004, o.bevel ?? 0.004) }) });
const lt = (L, prof, o = {}) => lathe(prof, { seg: o.seg ?? L.seg, ...o });
/** Bone-and-dirt stamp on a list of parts. */
const bind = (parts, bone, dirt = null) => { for (const p of parts) { p.set(3, bone); if (dirt !== null) p.paint(p.mat[0], { dirt }); } return parts; };
/** Mirror right-side parts to the left (x → -x). */
const mirror = (parts) => parts.map((p) => p.clone().mirrorX());
/** Dirt that climbs from the bottom of a limb (y from 0 at the joint to len). */
const climb = (len, lo, hi) => (x, y) => lo + (hi - lo) * Math.max(0, Math.min(1, y / len));

// ---------------------------------------------------------------- torso
/** Chest bone: core, chest plate assembly, back plate, collar, straps, pouches, lamp. */
function chest(L, w) {
  const out = [];
  out.push(rb(L, 0.36, 0.42, 0.23, { e1: 0.55, e2: 0.6 }).paint(CH.suit).move(0, 0.02, 0.01));
  // Side plates under the arms: the torso reads broad from the front.
  for (const sx of [-1, 1]) out.push(rb(L, 0.05, 0.2, 0.17, { e1: 0.35, e2: 0.35 }).paint(CH.shade).move(sx * 0.178, -0.02, 0));
  // The chest plate and what's strapped to it are built flat, then bent round the torso together.
  const front = [];
  const pw = w.plateW, ph = w.plateH;
  front.push(sh(L, pw, ph, 0.05, { corner: [0.08, 0.08, 0.035, 0.035], bevel: 0.013 }).paint(CH.armor));
  if (w.heavy) {
    // Layered: a second plate over the upper chest and a gorget ridge.
    front.push(sh(L, pw * 0.82, ph * 0.5, 0.025, { corner: [0.06, 0.06, 0.02, 0.02], bevel: 0.008 }).paint(CH.armor).move(0, ph * 0.2, -0.04));
    front.push(sh(L, pw * 0.5, 0.05, 0.03, { corner: 0.015 }).paint(CH.black).move(0, ph * 0.43, -0.045));
  }
  front.push(sh(L, 0.05, ph * 0.86, 0.022, { corner: 0.01, bevel: 0.005 }).paint(w.light ? CH.webbing : CH.black).move(0, -0.01, -0.04));   // the spine plate
  front.push(sh(L, pw * 0.86, 0.055, 0.024, { corner: 0.012 }).paint(CH.black).move(0, -ph / 2 + 0.035, -0.04));                            // the lower band
  if (L.fine) {
    for (const sx of [-1, 1]) front.push(rb(L, 0.032, ph * 0.95, 0.012, { e1: 0.2, e2: 0.2, hs: 3 }).paint(CH.webbing).move(sx * 0.115, 0, -0.05));   // straps
    // Magazine pouches across the bottom of the plate, flaps on top.
    for (const px of w.light ? [-0.075, 0.075] : [-0.09, 0, 0.09]) {
      front.push(rb(L, 0.068, 0.095, 0.045, { e1: 0.3, e2: 0.25 }).paint(CH.gear).move(px, -0.055, -0.07));
      front.push(rb(L, 0.072, 0.032, 0.05, { e1: 0.25, e2: 0.25, hs: 4 }).paint(CH.webbing).move(px, -0.012, -0.072));
    }
    front.push(quad(0.07, 0.04).paint(CH.number).move(-0.095, 0.065, -0.0462));          // the squad number (right chest, as seen)
    // The chest lamp on the left breast.
    front.push(cyl(0.022, 0.022, 0.035, { seg: 10 }).paint(CH.black).rot(-Math.PI / 2, 0, 0).move(0.11, 0.08, -0.045));
    front.push(cyl(0.016, 0.016, 0.004, { seg: 10 }).paint(CH.lamp).rot(-Math.PI / 2, 0, 0).move(0.11, 0.08, -0.081));
  }
  for (const p of front) p.bendY(0.22).move(0, 0.05, -0.085);
  out.push(...front);
  // Back plate (it carries the pack).
  out.push(sh(L, 0.33, 0.3, 0.035, { corner: [0.06, 0.06, 0.03, 0.03] }).paint(CH.shade).bendY(0.2).rot(0, Math.PI, 0).move(0, 0.03, 0.09));
  // Collar: a ring round the neck and a raised guard behind it.
  out.push(torus(0.085, w.heavy ? 0.034 : 0.026, { seg: L.fine ? 20 : 8, radial: L.fine ? 6 : 4 }).paint(CH.black).scale(1, 1.2, 0.95).move(0, 0.19, 0.005));
  out.push(sh(L, 0.22, w.heavy ? 0.12 : 0.085, 0.025, { corner: [0.03, 0.03, 0, 0] }).paint(w.heavy ? CH.armor : CH.shade).bendY(0.11).rot(-0.25, Math.PI, 0).move(0, 0.21, 0.07));
  // Shoulder yokes: the straps over the top, into the pauldrons.
  for (const sx of [-1, 1]) out.push(rb(L, 0.1, 0.035, 0.22, { e1: 0.25, e2: 0.35 }).paint(CH.webbing).move(sx * 0.125, 0.2, 0.005));
  return bind(out, BONE.chest, 0.02);
}

/** Abdomen bone: the waist and its segmented guard. */
function abdomen(L, w) {
  const out = [rb(L, 0.29, 0.34, 0.21, { e1: 0.7, e2: 0.7 }).paint(CH.suit).move(0, 0.17, 0)];
  const bands = L.fine ? [0.11, 0.165, 0.22] : [0.165];
  for (const y of bands) out.push(sh(L, 0.24, L.fine ? 0.05 : 0.15, 0.024, { corner: 0.012 }).paint(CH.black).bendY(0.15).move(0, y, -0.088));
  return bind(out, BONE.abdomen, 0.04);
}

/** Pelvis bone: hips, belt, buckle, pouches, groin plate, tassets on heavies. */
function pelvis(L, w) {
  const out = [rb(L, 0.33, 0.22, 0.23, { e1: 0.5, e2: 0.6 }).paint(CH.suit).move(0, -0.04, 0)];
  out.push(rb(L, 0.36, 0.055, 0.25, { e1: 0.15, e2: 0.75 }).paint(CH.webbing).move(0, 0.04, 0));
  out.push(sh(L, 0.13, 0.13, 0.025, { corner: [0.01, 0.01, 0.05, 0.05] }).paint(CH.black).bendY(0.12).move(0, -0.085, -0.105));
  if (L.fine) {
    out.push(rb(L, 0.06, 0.045, 0.022, { e1: 0.2, e2: 0.2 }).paint(CH.metal).move(0, 0.04, -0.128));
    for (const sx of [-1, 1]) {
      out.push(rb(L, 0.06, 0.09, 0.1, { e1: 0.3, e2: 0.3 }).paint(CH.gear).rot(0, sx * 0.25, 0).move(sx * 0.17, 0.0, -0.035));
      out.push(rb(L, 0.064, 0.03, 0.104, { e1: 0.25, e2: 0.3, hs: 4 }).paint(CH.webbing).rot(0, sx * 0.25, 0).move(sx * 0.17, 0.045, -0.035));
      out.push(rb(L, 0.09, 0.085, 0.05, { e1: 0.3, e2: 0.3 }).paint(CH.gear).move(sx * 0.085, 0.0, 0.128));
    }
  }
  if (w.heavy) {
    for (const sx of [-1, 1]) {
      out.push(sh(L, 0.14, 0.17, 0.025, { corner: [0.02, 0.02, 0.05, 0.05] }).paint(CH.armor).bendY(0.12).rot(0.12, -sx * 0.45, 0).move(sx * 0.125, -0.09, -0.075));
      if (L.fine) out.push(sh(L, 0.13, 0.03, 0.02, { corner: 0.008 }).paint(CH.black).bendY(0.12).rot(0.12, -sx * 0.45, 0).move(sx * 0.125, -0.012, -0.088));
    }
  }
  return bind(out, BONE.pelvis, 0.08);
}

// ---------------------------------------------------------------- arms (right, mirrored left)
function upperArm(L, w) {
  const out = [lt(L, [[0.05, -0.03], [0.062, 0.04], [0.065, 0.14], [0.057, 0.25], [0.05, 0.3]]).paint(CH.suit)];
  // The pauldron caps the shoulder: built facing out (+X), tipped up over the joint.
  const s = w.pauldron;
  const cap = [sh(L, s, s * 0.95, 0.03, { corner: [0.03, 0.03, 0.05, 0.05], curveY: 0.062, curveX: 0.075, bevel: 0.01, nu: L.fine ? 9 : 3, nv: L.fine ? 8 : 3 }).paint(CH.armor)];
  if (L.fine) {
    cap.push(sh(L, s * 0.92, 0.03, 0.02, { corner: 0.01, curveY: 0.062, nu: 8, nv: 1 }).paint(CH.black).bendX(0.075).move(0, s * 0.4, -0.012));   // the trim at its lower edge
    if (!w.light) cap.push(sh(L, s * 0.46, s * 0.3, 0.012, { corner: [0, 0, 0.012, 0.012], curveY: 0.062, curveX: 0.075, nu: 4, nv: 3 }).paint(CH.hazard).move(0, s * 0.12, -0.03));
  }
  if (w.heavy) cap.push(sh(L, s * 0.8, s * 0.6, 0.026, { corner: [0.04, 0.04, 0.025, 0.025], curveY: 0.06, curveX: 0.07 }).paint(CH.armor).move(0, -s * 0.22, -0.028));
  for (const p of cap) p.rot(0, -Math.PI / 2, 0).rot(0, 0, -0.75).move(0.035, -0.015, 0);
  out.push(...cap);
  if (!w.light) out.push(rb(L, 0.07, 0.07, 0.04, { e1: 0.4, e2: 0.4 }).paint(CH.black).move(0, 0.285, -0.05));   // elbow pad (behind the joint)
  return out;
}

function foreArm(L, w, left) {
  const out = [lt(L, [[0.05, -0.015], [0.054, 0.06], [0.047, 0.2], [0.04, 0.27]]).paint(CH.suit)];
  // Bracer round the outside and top of the forearm.
  out.push(lathe([[0.059, 0.045], [0.063, 0.1], [0.06, 0.18], [0.051, 0.235]], { seg: L.fine ? 10 : 5, phi0: -0.3, phiLen: Math.PI * 1.25 }).paint(CH.black));
  if (L.fine) {
    out.push(sh(L, 0.06, 0.1, 0.012, { corner: 0.01, curveY: 0.06, nu: 3, nv: 3 }).paint(CH.armor).rot(0, -Math.PI / 2, 0).move(0.062, 0.13, 0));
    if (left) {   // the left wrist carries the call-in pad: a small screen in the visor's color
      out.push(rb(L, 0.05, 0.075, 0.03, { e1: 0.2, e2: 0.2 }).paint(CH.black).rot(0, 0, 0).move(0, 0.16, 0.058));
      out.push(quad(0.034, 0.05).paint(CH.visor).rot(0, Math.PI, 0).move(0, 0.16, 0.0745));
    }
  }
  // The glove: a fist round the grip, knuckle guard on top.
  out.push(rb(L, 0.075, 0.1, 0.06, { e1: 0.45, e2: 0.5 }).paint(CH.black).move(0, 0.31, 0));
  if (L.fine) out.push(rb(L, 0.07, 0.035, 0.03, { e1: 0.3, e2: 0.3 }).paint(CH.shade).move(0.01, 0.315, 0.028));
  return out;
}

// ---------------------------------------------------------------- legs (right, mirrored left)
function thigh(L, w) {
  const out = [lt(L, [[0.086, -0.03], [0.1, 0.06], [0.096, 0.22], [0.082, 0.38], [0.07, 0.46]]).paint(CH.suit)];
  if (L.fine) {
    out.push(rb(L, 0.05, 0.12, 0.09, { e1: 0.3, e2: 0.3 }).paint(CH.gear).move(0.095, 0.17, 0));                       // thigh pouch
    out.push(rb(L, 0.054, 0.03, 0.094, { e1: 0.2, e2: 0.3, hs: 4 }).paint(CH.webbing).move(0.095, 0.115, 0));
    for (const y of [0.13, 0.24]) out.push(torus(0.092, 0.008, { seg: 14, radial: 4 }).paint(CH.webbing).move(0, y, 0));  // its straps
  }
  // Thigh plates on the outer front, angled out (heavies get the big ones).
  if (!w.light) out.push(sh(L, w.heavy ? 0.13 : 0.1, w.heavy ? 0.2 : 0.13, 0.02, { corner: [0.015, 0.015, 0.035, 0.035], curveY: 0.1 }).paint(CH.armor).rot(0, Math.PI + 0.45, 0).move(0.03, w.heavy ? 0.15 : 0.12, 0.078));
  return bind(out, 0, climb(REF.thigh, 0.12, 0.25));
}

function shin(L, w) {
  const out = [lt(L, [[0.07, -0.02], [0.078, 0.08], [0.07, 0.26], [0.058, 0.4], [0.054, 0.46]]).paint(CH.suit)];
  const kp = w.light ? 0.09 : 0.105;
  out.push(rb(L, kp, kp * 1.05, 0.06, { e1: 0.35, e2: 0.45 }).paint(CH.armor).move(0, 0.015, 0.06));
  if (L.fine) out.push(rb(L, 0.02, kp * 0.85, 0.025, { e1: 0.3, e2: 0.3, hs: 4 }).paint(CH.black).move(0, 0.015, 0.088));
  if (!w.light) {
    out.push(sh(L, w.heavy ? 0.11 : 0.095, 0.25, 0.022, { corner: [0.02, 0.02, 0.035, 0.035], curveY: 0.065 }).paint(CH.armor).rot(0, Math.PI, 0).move(0, 0.22, 0.056));
    if (L.fine) out.push(sh(L, 0.03, 0.2, 0.012, { corner: 0.008, nu: 1, nv: 4 }).paint(CH.black).rot(0, Math.PI, 0).move(0, 0.22, 0.08));
  }
  else out.push(lt(L, [[0.068, 0.12], [0.07, 0.15], [0.066, 0.3], [0.062, 0.32]]).paint(CH.black));               // shin wraps
  out.push(lt(L, [[0.058, 0.35], [0.066, 0.37], [0.066, 0.45], [0.06, 0.47]]).paint(CH.gear));                       // boot cuff
  return bind(out, 0, climb(REF.shin, 0.25, 0.85));
}

function boot(L, w) {
  const k = w.heavy ? 1.08 : 1;
  const out = [
    rb(L, 0.105 * k, 0.11, 0.24 * k, { e1: 0.35, e2: 0.45 }).paint(CH.gear).move(0, -0.028, -0.05),
    rb(L, 0.115 * k, 0.035, 0.27 * k, { e1: 0.25, e2: 0.35 }).paint(CH.rubber).move(0, -0.0625, -0.055),
    rb(L, 0.1 * k, 0.06, 0.08, { e1: 0.4, e2: 0.4 }).paint(CH.black).move(0, -0.035, -0.15 * k),
  ];
  if (L.fine) {
    out.push(rb(L, 0.09 * k, 0.05, 0.05, { e1: 0.35, e2: 0.35 }).paint(CH.black).move(0, -0.04, 0.06));
    out.push(rb(L, 0.112 * k, 0.025, 0.13, { e1: 0.2, e2: 0.7 }).paint(CH.webbing).move(0, 0.012, -0.01));
  }
  return bind(out, 0, 0.9);
}

/** A whole body of one weight: 14 bones, one geometry. */
function body(weight, L) {
  const w = {
    light: weight === 'light', heavy: weight === 'heavy',
    plateW: weight === 'heavy' ? 0.44 : weight === 'light' ? 0.36 : 0.41,
    plateH: weight === 'heavy' ? 0.32 : weight === 'light' ? 0.23 : 0.29,
    pauldron: weight === 'heavy' ? 0.235 : weight === 'light' ? 0.15 : 0.195,
  };
  const parts = [...chest(L, w), ...abdomen(L, w), ...pelvis(L, w)];
  const ua = upperArm(L, w), fa = foreArm(L, w, false), th = thigh(L, w), sn = shin(L, w), bt = boot(L, w);
  parts.push(...bind(ua, BONE.upperArmR, 0.05), ...bind(mirror(ua), BONE.upperArmL));
  parts.push(...bind(fa, BONE.foreArmR, 0.06), ...bind(foreArm(L, w, true).map((p) => p.mirrorX()), BONE.foreArmL, 0.06));
  parts.push(...bind(th, BONE.thighR), ...bind(mirror(th), BONE.thighL));
  parts.push(...bind(sn, BONE.shinR), ...bind(mirror(sn), BONE.shinL));
  parts.push(...bind(bt, BONE.footR), ...bind(mirror(bt), BONE.footL));
  return parts;
}

// ---------------------------------------------------------------- helmets (head bone)
function helmet(type, L) {
  const out = [];
  const visor = (w, h, y, z, R) => {
    out.push(sh(L, w, h, 0.018, { corner: Math.min(0.012, h / 3), curveY: R, nu: L.fine ? 6 : 2, nv: 1 }).paint(CH.glass).move(0, y, z));
    out.push(sh(L, w * 0.8, 0.006, 0.004, { corner: 0, curveY: R, nu: L.fine ? 6 : 2, nv: 1, bevel: 0.001 }).paint(CH.visor).move(0, y, z - 0.0185));
  };
  const comms = (r = 0.04) => {
    for (const sx of [-1, 1]) out.push(cyl(r, r * 0.9, 0.035, { seg: L.fine ? 12 : 6 }).paint(CH.black).rot(0, 0, -sx * Math.PI / 2).move(sx * 0.128, -0.012, 0.005));
  };
  const number = (y = 0.06) => { if (L.fine) out.push(quad(0.06, 0.034).paint(CH.number).rot(0, Math.PI / 2, 0).move(-0.1505, y, 0.035)); };
  if (type === 'medium' || type === 'pilot') {
    // Domed, a slit visor under a brow, jaw guard, side comms, a ridge, a neck skirt.
    out.push(rb(L, 0.275, 0.26, 0.29, { e1: 0.55, e2: 0.7 }).paint(CH.armor).move(0, 0.035, 0.02));
    if (type === 'pilot') {
      // Pilots: one wide wraparound visor and no jaw guard (a breathing unit instead).
      out.push(sh(L, 0.25, 0.1, 0.02, { corner: 0.03, curveY: 0.13 }).paint(CH.glass).move(0, -0.01, -0.118));
      out.push(sh(L, 0.2, 0.006, 0.004, { corner: 0, curveY: 0.13, bevel: 0.001 }).paint(CH.visor).move(0, 0.02, -0.1385));
      out.push(rb(L, 0.08, 0.06, 0.06, { e1: 0.4, e2: 0.4 }).paint(CH.black).move(0, -0.09, -0.11));
    } else {
      out.push(sh(L, 0.2, 0.12, 0.035, { corner: [0.015, 0.015, 0.05, 0.05], curveY: 0.12 }).paint(CH.black).move(0, -0.068, -0.105));
      if (L.fine) for (const vy of [-0.06, -0.078, -0.096]) out.push(rb(L, 0.07, 0.008, 0.012, { e1: 0.2, e2: 0.2, hs: 3 }).paint(CH.metal).move(0, vy, -0.141));
      visor(0.21, 0.048, 0.008, -0.122, 0.14);
      out.push(sh(L, 0.24, 0.04, 0.04, { corner: [0.02, 0.02, 0.005, 0.005], curveY: 0.14 }).paint(CH.armor).move(0, 0.05, -0.108));
    }
    comms();
    out.push(rb(L, 0.03, 0.24, 0.04, { e1: 0.3, e2: 0.3 }).paint(CH.black).bendX(0.15).rot(Math.PI / 2, 0, 0).move(0, 0.157, 0.03));
    out.push(rb(L, 0.283, 0.035, 0.3, { e1: 0.2, e2: 0.7 }).paint(CH.black).move(0, -0.035, 0.03));                  // the helmet band
    out.push(sh(L, 0.22, 0.07, 0.02, { corner: [0.01, 0.01, 0.03, 0.03], curveY: 0.12 }).paint(CH.shade).rot(0.3, Math.PI, 0).move(0, -0.085, 0.118));
    number();
  } else if (type === 'light' || type === 'hood') {
    // Low profile: a cap with a wide visor, a breather instead of a jaw guard.
    out.push(rb(L, 0.27, 0.22, 0.29, { e1: 0.55, e2: 0.55 }).paint(type === 'hood' ? CH.black : CH.armor).move(0, 0.045, 0.01));
    visor(0.23, 0.06, 0.0, -0.122, 0.13);
    out.push(rb(L, 0.1, 0.07, 0.07, { e1: 0.4, e2: 0.45 }).paint(CH.black).move(0, -0.075, -0.1));
    if (L.fine) for (const sx of [-1, 1]) out.push(cyl(0.018, 0.02, 0.03, { seg: 10 }).paint(CH.metal).rot(Math.PI / 2, 0, sx * 0.5).move(sx * 0.04, -0.09, -0.125));
    comms(0.035);
    if (type === 'hood') {
      // A cloth hood over it all, falling to the shoulders.
      out.push(sh(L, 0.46, 0.4, 0.022, { corner: [0.1, 0.1, 0.02, 0.02], curveY: 0.16, curveX: 0.2, nu: L.fine ? 10 : 4, nv: L.fine ? 9 : 3 }).paint(CH.cape).rot(-0.25, Math.PI, 0).move(0, 0.06, 0.15));
      out.push(sh(L, 0.32, 0.12, 0.025, { corner: [0, 0, 0.04, 0.04], curveY: 0.16 }).paint(CH.cape).rot(0.35, Math.PI, 0).move(0, -0.13, 0.12));
    } else number(0.07);
  } else {
    // Heavy (and crest): angular, a full face plate with a T-visor, cheek plates.
    out.push(rb(L, 0.3, 0.26, 0.31, { e1: 0.32, e2: 0.4 }).paint(CH.armor).move(0, 0.035, 0.015));
    out.push(sh(L, 0.23, 0.2, 0.04, { corner: [0.03, 0.03, 0.06, 0.06], curveY: 0.13, bevel: 0.01 }).paint(CH.black).move(0, -0.03, -0.122));
    out.push(sh(L, 0.12, 0.06, 0.03, { corner: [0.01, 0.01, 0.025, 0.025], curveY: 0.1 }).paint(CH.shade).rot(-0.3, 0, 0).move(0, -0.115, -0.15));   // the chin
    out.push(sh(L, 0.2, 0.034, 0.016, { corner: 0.008, curveY: 0.14, nv: 1 }).paint(CH.glass).move(0, 0.025, -0.16));
    out.push(sh(L, 0.034, 0.1, 0.016, { corner: 0.008, nu: 1 }).paint(CH.glass).move(0, -0.03, -0.165));
    out.push(sh(L, 0.16, 0.006, 0.004, { corner: 0, curveY: 0.14, bevel: 0.001, nv: 1 }).paint(CH.visor).move(0, 0.025, -0.177));
    for (const sx of [-1, 1]) out.push(sh(L, 0.08, 0.13, 0.03, { corner: [0.02, 0.02, 0.03, 0.03] }).paint(CH.shade).rot(0, -sx * 1.1, 0).move(sx * 0.12, -0.04, -0.06));
    out.push(sh(L, 0.26, 0.05, 0.035, { corner: 0.012, curveY: 0.14 }).paint(CH.armor).move(0, 0.085, -0.128));
    out.push(sh(L, 0.24, 0.08, 0.022, { corner: [0.01, 0.01, 0.03, 0.03], curveY: 0.12 }).paint(CH.shade).rot(0.35, Math.PI, 0).move(0, -0.09, 0.12));
    comms(0.045);
    number(0.07);
    if (type === 'crest') {
      // The flame knight's crest: a tall fin of armor along the crown, black-edged.
      out.push(plate([[-0.16, 0], [0.13, 0], [0.18, 0.05], [0.06, 0.1], [-0.12, 0.08]], 0.022, { bevel: 0.005 }).paint(CH.armor).rot(0, Math.PI / 2, 0).move(0.011, 0.155, 0));
      out.push(rb(L, 0.03, 0.02, 0.3, { e1: 0.2, e2: 0.3 }).paint(CH.black).move(0, 0.16, 0));
    } else out.push(rb(L, 0.035, 0.045, 0.27, { e1: 0.25, e2: 0.25 }).paint(CH.black).move(0, 0.17, 0.012));
  }
  return bind(out, BONE.head, 0);
}

// ---------------------------------------------------------------- role gear (any bone)
function gear(type, L) {
  const out = [];
  const pack = (w = 0.28, h = 0.3, d = 0.13) => {
    out.push(rb(L, w, h, d, { e1: 0.2, e2: 0.25 }).paint(CH.gear).move(0, 0.02, 0.105 + d / 2));
    out.push(rb(L, w + 0.012, 0.08, d + 0.012, { e1: 0.2, e2: 0.2 }).paint(CH.black).move(0, 0.02 + h / 2 - 0.03, 0.105 + d / 2));
    if (L.fine) {
      for (const sx of [-1, 1]) out.push(cyl(0.033, 0.033, h * 0.75, { seg: 10 }).paint(CH.metal).move(sx * (w / 2 + 0.022), -h * 0.35, 0.105 + d / 2));
      out.push(cyl(0.045, 0.045, w * 0.9, { seg: 10 }).paint(CH.gear).rot(0, 0, Math.PI / 2).move(w * 0.45, 0.02 + h / 2 + 0.035, 0.105 + d / 2));
      out.push(rb(L, 0.11, 0.09, 0.04, { e1: 0.2, e2: 0.2 }).paint(CH.black).move(0.06, -0.03, 0.105 + d + 0.015));
      out.push(cyl(0.008, 0.008, 0.004, { seg: 8 }).paint(CH.lamp).rot(Math.PI / 2, 0, 0).move(0.09, -0.01, 0.105 + d + 0.036));
      out.push(quad(0.07, 0.04).paint(CH.number).rot(0, Math.PI, 0).move(-0.06, 0.05, 0.105 + d + 0.0005));
    }
  };
  const whip = (x, len) => out.push(tube([[x, 0.15, 0.2], [x + 0.01, 0.15 + len * 0.5, 0.215], [x + 0.03, 0.15 + len, 0.25]], 0.0045, { seg: L.fine ? 8 : 3, radial: 4 }).paint(CH.black));
  if (type === 'standard') pack();
  else if (type === 'radio') { pack(0.26, 0.28, 0.12); whip(0.1, 0.55); }
  else if (type === 'antenna') {
    pack(0.24, 0.26, 0.12);
    whip(0.09, 0.75); whip(-0.09, 0.45);
    out.push(rb(L, 0.18, 0.05, 0.08, { e1: 0.2, e2: 0.2 }).paint(CH.black).move(0, 0.17, 0.17));
    out.push(cyl(0.012, 0.012, 0.004, { seg: 8 }).paint(CH.visor).rot(Math.PI / 2, 0, 0).move(-0.05, 0.17, 0.212));
  } else if (type === 'tools') {
    pack(0.3, 0.32, 0.14);
    // An engineer's tool frame: a pick and a shovel strapped across the pack.
    out.push(cyl(0.012, 0.012, 0.5, { seg: 6 }).paint(CH.metal).rot(0, 0, 0.9).move(0.18, -0.2, 0.26));
    out.push(rb(L, 0.12, 0.14, 0.012, { e1: 0.3, e2: 0.3 }).paint(CH.metal).rot(0, 0, 0.9).move(-0.17, 0.16, 0.26));
    out.push(cyl(0.01, 0.01, 0.42, { seg: 6 }).paint(CH.metal).rot(0, 0, -0.9).move(-0.16, -0.16, 0.255));
  } else if (type === 'medic') {
    pack(0.28, 0.28, 0.13);
    // Big med pouches and a white armband (no red cross: that emblem is protected).
    for (const sx of [-1, 1]) out.push(rb(L, 0.07, 0.11, 0.11, { e1: 0.3, e2: 0.3 }).paint(CH.white).move(sx * 0.18, -0.03, 0.17));
    const band = torus(0.066, 0.014, { seg: L.fine ? 16 : 8, radial: 4 }).paint(CH.white).move(0, 0.1, 0);
    out.push(band.set(3, BONE.upperArmL));
  } else if (type === 'bandolier') {
    pack(0.3, 0.3, 0.14);
    // A demolitionist's bandolier of charges across the chest.
    const path = [], n = L.fine ? 7 : 4;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), x = 0.15 - 0.3 * t, y = 0.2 - 0.33 * t;
      out.push(cyl(0.022, 0.022, 0.07, { seg: 8 }).paint(i % 2 ? CH.hazard : CH.black).rot(0, 0, 0.6).move(x, y, -0.16));
      path.push([x, y, -0.15]);
    }
    if (L.fine) out.push(tube(path, 0.012, { seg: 10, radial: 4 }).paint(CH.webbing));
  }
  for (const p of out) if (p.mat[3] === 0) p.set(3, BONE.chest);
  return out;
}

// ---------------------------------------------------------------- cape (cape0..2)
/**
 * Three panels to the back of the knees, wider at the collar than the hem, hanging in folds,
 * the hem torn; the faction's trim band near the bottom and its emblem on the middle panel.
 * The folds are one function of the position down the whole cape, so the panels meet.
 */
function cape(L) {
  const out = [], len = REF.cape, n = 3, top = 0.42, hem = 0.36;
  for (let i = 0; i < n; i++) {
    const fold = (p) => {
      const g = Math.max(0, Math.min(1, (i * len + p.y) / (n * len)));
      p.x *= (top + (hem - top) * g) / top;
      p.z += Math.sin(p.x * 34 + 1.3) * (0.003 + 0.014 * g) + Math.sin(p.x * 12 - 0.6) * 0.01 * g;
      if (L.fine && i === n - 1 && p.y > len - 0.015) p.y -= Math.abs(Math.sin(p.x * 41 + 0.7)) * 0.032 + Math.abs(Math.sin(p.x * 97)) * 0.012;
    };
    const h = len + 0.025;
    const seg = [shell(top, h, 0.012, { corner: 0, bevel: 0.002, nu: L.fine ? 14 : 3, nv: L.fine ? 3 : 1 }).paint(CH.cape).move(0, h / 2 - 0.025, 0)];
    if (L.fine && i === n - 1) seg.push(shell(top, 0.028, 0.0145, { corner: 0, bevel: 0.001, nu: 14, nv: 1 }).paint(CH.trim).move(0, len - 0.07, 0.00125));
    if (L.fine && i === 1) seg.push(quad(0.17, 0.17).tessellate(0.03).paint(CH.emblem).rot(0, 0, Math.PI).move(0, len * 0.45, -0.0122));
    for (const p of seg) {
      p.warp(fold).set(3, BONE.cape0 + i);
      p.paint(p.mat[0], { dirt: (x, y) => 0.08 + 0.3 * (i * len + y) / (n * len) + (i === n - 1 ? 0.25 * Math.max(0, y / len - 0.6) : 0) });
    }
    out.push(...seg);
  }
  return out;
}

// ---------------------------------------------------------------- weapons (gun bone)
function weapon(arch, L) {
  const len = GUN_LENGTH[arch] ?? 0.82, out = [];
  const z = (f) => -len * f;                        // a fraction of the way to the muzzle
  const energy = arch === 'pulseRifle' || arch === 'beam';
  // Stock and butt pad.
  if (arch !== 'smg') {
    out.push(rb(L, 0.042, 0.1, len * 0.24, { e1: 0.25, e2: 0.3 }).paint(CH.black).move(0, -0.025, z(0.13)));
    out.push(rb(L, 0.046, 0.11, 0.02, { e1: 0.3, e2: 0.3 }).paint(CH.rubber).move(0, -0.025, -0.01));
  } else out.push(rb(L, 0.03, 0.05, 0.16, { e1: 0.2, e2: 0.2 }).paint(CH.black).move(0, -0.01, z(0.15)));
  // Receiver with a painted side panel.
  const rz = arch === 'smg' ? 0.42 : 0.4, rl = len * (arch === 'sniper' ? 0.28 : 0.34);
  out.push(rb(L, 0.06, 0.1, rl, { e1: 0.15, e2: 0.2 }).paint(CH.metal).move(0, 0, z(rz)));
  if (L.fine) for (const sx of [-1, 1]) out.push(rb(L, 0.006, 0.06, rl * 0.7, { e1: 0.15, e2: 0.15, hs: 3 }).paint(CH.armor).move(sx * 0.032, 0.012, z(rz)));
  // Grip and magazine (energy guns: a glowing cell).
  out.push(rb(L, 0.034, 0.1, 0.045, { e1: 0.35, e2: 0.35 }).paint(CH.rubber).rot(0.3, 0, 0).move(0, -0.085, z(rz) + rl * 0.3));
  if (energy) out.push(rb(L, 0.05, 0.05, 0.1, { e1: 0.3, e2: 0.3 }).paint(CH.visor).move(0, -0.045, z(rz) - rl * 0.15));
  else if (arch === 'shotgun') out.push(cyl(0.05, 0.05, 0.05, { seg: L.fine ? 14 : 7 }).paint(CH.black).rot(0, 0, Math.PI / 2).move(0.025, -0.08, z(rz) - rl * 0.15));
  else out.push(rb(L, 0.032, arch === 'smg' ? 0.16 : 0.14, 0.055, { e1: 0.25, e2: 0.25 }).paint(CH.black).rot(0.22, 0, 0).move(0, -0.11, z(rz) - rl * 0.12));
  // Handguard / shroud, barrel, muzzle.
  const hz = arch === 'sniper' ? 0.62 : 0.68, hl = len * (arch === 'sniper' ? 0.3 : 0.26);
  out.push(rb(L, 0.052, 0.068, hl, { e1: 0.2, e2: 0.25 }).paint(CH.black).move(0, 0.002, z(hz)));
  if (L.fine && energy) for (let k = 0; k < 4; k++) out.push(torus(0.03, 0.006, { seg: 12, radial: 4 }).paint(CH.visor).rot(Math.PI / 2, 0, 0).move(0, 0.002, z(hz) + hl * (0.3 - k * 0.2)));
  else if (L.fine) for (let k = 0; k < 3; k++) out.push(rb(L, 0.054, 0.012, 0.03, { e1: 0.2, e2: 0.2, hs: 3 }).paint(CH.metal).move(0, 0.03, z(hz) + hl * (0.25 - k * 0.25)));
  const bl = len * (arch === 'sniper' ? 0.22 : 0.14), bz = len - bl / 2 - 0.02;
  out.push(cyl(0.013, 0.013, bl, { seg: L.fine ? 10 : 5 }).paint(CH.metal).rot(-Math.PI / 2, 0, 0).move(0, 0.005, -bz + bl / 2));
  out.push(rb(L, 0.034, 0.034, 0.055, { e1: 0.2, e2: 0.2 }).paint(arch === 'super' ? CH.hazard : CH.black).move(0, 0.005, z(1) + 0.03));
  // Optics: a red-dot box on rifles, a long scope on the marksman's gun.
  if (arch === 'sniper') {
    out.push(cyl(0.022, 0.026, 0.3, { seg: L.fine ? 12 : 6 }).paint(CH.black).rot(-Math.PI / 2, 0, 0).move(0, 0.085, z(0.3)));
    if (L.fine) out.push(cyl(0.02, 0.02, 0.004, { seg: 12 }).paint(CH.glass).rot(-Math.PI / 2, 0, 0).move(0, 0.085, z(0.3) - 0.3));
  } else if (arch !== 'shotgun') {
    out.push(rb(L, 0.036, 0.045, 0.09, { e1: 0.2, e2: 0.25 }).paint(CH.black).move(0, 0.072, z(0.42)));
    if (L.fine) out.push(quad(0.026, 0.024).paint(CH.glass).move(0, 0.074, z(0.42) - 0.0455));
  }
  if (arch === 'super') {
    // The heavy launcher: a fat tube over the receiver.
    out.push(cyl(0.055, 0.055, len * 0.75, { seg: L.fine ? 14 : 7 }).paint(CH.armor).rot(-Math.PI / 2, 0, 0).move(0, 0.06, z(0.2)));
  }
  return bind(out, BONE.gun, 0.05);
}

// ---------------------------------------------------------------- far impostor
/**
 * Far LOD: a ~150-triangle trooper standing at the origin facing -Z (1.8 m), painted by
 * channel like the rest, for the impostor batch (positioned by instance matrix, no bones).
 */
export function impostorGeometry() {
  const L = { ws: 6, hs: 4, nu: 1, nv: 1, seg: 5, fine: false };
  const P = [
    rb(L, 0.36, 0.5, 0.26, { e1: 0.5, e2: 0.5 }).paint(CH.armor).move(0, 1.32, 0),
    rb(L, 0.3, 0.3, 0.24, { e1: 0.5, e2: 0.5 }).paint(CH.suit).move(0, 1.0, 0),
    rb(L, 0.27, 0.27, 0.29, { e1: 0.6, e2: 0.6 }).paint(CH.armor).move(0, 1.7, 0),
    rb(L, 0.2, 0.05, 0.05, { e1: 0.4, e2: 0.4 }).paint(CH.glass).move(0, 1.69, -0.13),
    rb(L, 0.13, 0.9, 0.15, { e1: 0.6, e2: 0.6 }).paint(CH.suit).move(-0.1, 0.45, 0),
    rb(L, 0.13, 0.9, 0.15, { e1: 0.6, e2: 0.6 }).paint(CH.suit).move(0.1, 0.45, 0),
    rb(L, 0.12, 0.6, 0.12, { e1: 0.6, e2: 0.6 }).paint(CH.black).move(-0.25, 1.15, -0.05),
    rb(L, 0.12, 0.6, 0.12, { e1: 0.6, e2: 0.6 }).paint(CH.black).move(0.25, 1.15, -0.05),
    rb(L, 0.34, 0.6, 0.03, { e1: 0.3, e2: 0.3 }).paint(CH.cape).move(0, 1.1, 0.16),
    rb(L, 0.26, 0.28, 0.12, { e1: 0.3, e2: 0.3 }).paint(CH.gear).move(0, 1.35, 0.17),
  ];
  return merge(P);
}

/** A role's kit from the authored table (data/art/troopers.json), with defaults filled in. */
export function kitFor(table, role) {
  const k = table?.roles?.[role] ?? table?.default ?? {};
  return { body: k.body ?? 'medium', helmet: k.helmet ?? 'medium', gear: k.gear === undefined ? 'standard' : k.gear, cape: k.cape !== false };
}

// ---------------------------------------------------------------- the catalogue
/**
 * Every mesh of the kit at both levels: { body: { light: [mid, near], ... }, helmet: {...},
 * gear: {...}, cape: [mid, near], weapon: {...} } as BufferGeometries.
 */
export function buildKit() {
  const two = (fn) => [merge(fn(LV[0])), merge(fn(LV[1]))];
  const kit = { body: {}, helmet: {}, gear: {}, weapon: {}, cape: two((L) => cape(L)) };
  for (const w of ['light', 'medium', 'heavy']) kit.body[w] = two((L) => body(w, L));
  for (const h of ['light', 'medium', 'heavy', 'crest', 'hood', 'pilot']) kit.helmet[h] = two((L) => helmet(h, L));
  for (const g of ['standard', 'radio', 'antenna', 'tools', 'medic', 'bandolier']) kit.gear[g] = two((L) => gear(g, L));
  for (const a of Object.keys(GUN_LENGTH)) kit.weapon[a] = two((L) => weapon(a, L));
  return kit;
}

/** Triangle counts per mesh (for the art lab and the perf budget). */
export function kitStats(kit) {
  const out = {};
  for (const [group, m] of Object.entries(kit)) {
    if (Array.isArray(m)) out[group] = m.map(tris);
    else for (const [k, v] of Object.entries(m)) out[`${group}.${k}`] = v.map(tris);
  }
  return out;
}

