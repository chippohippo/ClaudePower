// StratagemKit: the call-ins' hardware, modeled in code in the art direction's language
// (docs/ART_DIRECTION.md: chunky, utilitarian, faction paint on the big plates, black and
// gunmetal on the mechanics, hazard stripes on anything that moves or hits, stencilled numbers).
// Painted by channel (ModelKit CH) for TrooperMaterial's paintMaterial. Models face -Z, y up.
//
//  * beacon   a palm-sized canister with a spike to stick it in, a hazard band and an antenna;
//             its lamp is separate so StratagemViews can light it in the payload's color
//  * pod      an octagonal drop pod: four doors that fold down (each over one supply crate), a
//             frame of black ribs, a buried spike below, a cap with the lamp ring on top
//  * sentry   the turret that rises out of a sentry pod: a mast, the yoke, a boxy sensor head
//             with twin barrels and an ammo drum
//  * jet      the strike craft that flies strafing runs and airstrikes: a heavy cranked-delta
//             attack plane with canted twin tails, two big engines and bombs under the wings
//  * cradle   the frame a vehicle is dropped in: four corner posts on skids, a top frame with a
//             hazard-striped spine and the lift eye, four retro-thruster bells hung under the
//             long beams (they fire all the way down and lift the empty frame away)

import { CH, rbox, shell, cyl, lathe, tube, torus, quad, prism, merge } from './ModelKit.js';

const number = (w, h) => quad(w, h).paint(CH.number);

// ---------------------------------------------------------------- beacon
export function beaconModel() {
  const b = [];
  b.push(lathe([[0, -0.09], [0.012, -0.07], [0.03, 0], [0.055, 0.005], [0.06, 0.025], [0.06, 0.2], [0.05, 0.225], [0.034, 0.24], [0, 0.24]], { seg: 10 }).paint(CH.black, { dirt: 0.35 }));
  b.push(cyl(0.0615, 0.0615, 0.045, { seg: 10, open: true }).paint(CH.hazard).move(0, 0.09, 0));
  for (const y of [0.055, 0.17]) b.push(torus(0.061, 0.007, { seg: 12, radial: 4 }).paint(CH.metal).move(0, y, 0));
  b.push(tube([[0.02, 0.24, 0], [0.024, 0.4, 0], [0.03, 0.56, 0.01]], 0.0035, { seg: 6, radial: 3 }).paint(CH.black));
  const lamp = merge([cyl(0.028, 0.024, 0.055, { seg: 10 }).move(0, 0.24, 0)]);
  return { body: merge(b), lamp };
}

// ---------------------------------------------------------------- drop pod
/** Pod layout (m): octagon apothem, body bottom and top, door hinge, cap top. */
export const POD = { R: 0.62, y0: 0.28, y1: 1.92, cap: 2.26, sentryHead: 2.15 };
const OCT = Math.PI / 8;

/**
 * { core, door, crate, cap, lampRing, faces: [{ yaw, door }] }. The core is everything that stays
 * put; the four doors (one geometry, hinged at its bottom edge at the origin, closed upright facing
 * -Z) are placed by the view at faces[k].yaw, each over a crate.
 */
export function podModel({ fine = true } = {}) {
  const { R, y0, y1, cap } = POD, RV = R / Math.cos(OCT), side = 2 * R * Math.tan(OCT), H = y1 - y0;   // RV: to the corners
  const core = [], door = [], crate = [];
  // The buried spike and the skirt where it meets the body.
  core.push(lathe([[0, -0.75], [0.12, -0.55], [RV * 0.9, y0 - 0.08], [RV * 1.06, y0], [RV * 1.06, y0 + 0.06], [0, y0 + 0.06]], { seg: 8, phi0: OCT }).paint(CH.black, { dirt: 0.8 }));
  // The inner column (seen when the doors are open) and the fixed panels on the diagonals.
  core.push(cyl(R * 0.45, R * 0.45, H, { seg: 8 }).paint(CH.black, { dirt: 0.2 }).move(0, y0, 0));
  for (let k = 0; k < 4; k++) {
    const yaw = Math.PI / 4 + (k * Math.PI) / 2;
    core.push(shell(side * 0.98, H * 0.96, 0.05, { corner: 0.03, nu: 2, nv: 4 }).paint(CH.shade, { dirt: (x, y) => Math.max(0, 0.55 - y * 0.6) }).move(0, y0 + H / 2, -R + 0.05).rot(0, yaw, 0));
  }
  // The frame: a rib up every corner, bands top and bottom.
  for (let k = 0; k < 8; k++) {
    const a = OCT + (k * Math.PI) / 4;
    core.push(rbox(0.085, H + 0.06, 0.085, { e1: 0.2, e2: 0.25, ws: 6, hs: 2 }).paint(CH.black, { dirt: (x, y) => Math.max(0, 0.6 - y * 0.4) }).rot(0, -a, 0).move(Math.sin(a) * RV, y0 + H / 2, -Math.cos(a) * RV));
  }
  core.push(lathe([[RV * 1.04, y1 - 0.02], [RV * 1.06, y1 + 0.04], [RV * 1.02, y1 + 0.1], [RV * 0.6, y1 + 0.1]], { seg: 8, phi0: OCT }).paint(CH.black));
  // The cap: a frustum, a flat top with the lamp ring (separate) and three stubby thrusters.
  const capG = [lathe([[RV * 1.0, y1 + 0.08], [RV * 0.92, y1 + 0.14], [RV * 0.62, cap - 0.04], [RV * 0.56, cap], [0, cap]], { seg: 8, phi0: OCT }).paint(CH.armor, { dirt: 0.08 })];
  if (fine) {
    for (let k = 0; k < 3; k++) {
      const a = (k * Math.PI * 2) / 3 + 0.4;
      capG.push(lathe([[0.05, 0], [0.075, 0.02], [0.09, 0.12], [0.06, 0.13]], { seg: 8 }).paint(CH.metal).move(Math.sin(a) * R * 0.42, cap - 0.05, Math.cos(a) * R * 0.42));
    }
    capG.push(shell(R * 0.9, 0.08, 0.03, { corner: 0.01, nu: 3, nv: 1 }).paint(CH.hazard).rot(-0.75, 0, 0).move(0, (y1 + cap) / 2 + 0.03, -R * 0.78));
  }
  const lampRing = merge([torus(R * 0.44, 0.03, { seg: 16, radial: 4 }).move(0, cap + 0.005, 0)]);
  // A door: a curved panel in faction paint, a hazard band along the top, its number, hinged at
  // the bottom edge (the origin), face toward -Z.
  door.push(shell(side * 0.96, H * 0.94, 0.06, { corner: [0.06, 0.06, 0.02, 0.02], nu: 3, nv: 5, curveY: 3 }).paint(CH.armor, { dirt: (x, y) => Math.max(0, 0.5 - y * 0.55) }).move(0, H * 0.48, -0.005));
  if (fine) {
    door.push(shell(side * 0.9, 0.13, 0.07, { corner: 0.02, nu: 3, nv: 1, curveY: 3 }).paint(CH.hazard).move(0, H * 0.86, -0.006));
    door.push(rbox(0.16, 0.05, 0.05, { e1: 0.2, e2: 0.2, ws: 4, hs: 2 }).paint(CH.metal).move(0, H * 0.62, -0.085));      // handle
    door.push(number(0.22, 0.14).move(0, H * 0.4, -0.072));
    for (const sx of [-1, 1]) door.push(cyl(0.025, 0.025, 0.1, { seg: 6 }).paint(CH.metal).rot(0, 0, Math.PI / 2).move(sx * side * 0.32 + 0.05, 0.02, -0.03));   // hinges
  }
  // A supply crate (behind each door): ammo box with straps and a stencil.
  crate.push(rbox(side * 0.82, 0.36, 0.26, { e1: 0.14, e2: 0.14, ws: 6, hs: 4 }).paint(CH.gear, { dirt: 0.12 }));
  if (fine) {
    for (const x of [-0.12, 0.12]) crate.push(rbox(0.035, 0.37, 0.265, { e1: 0.2, e2: 0.2, ws: 4, hs: 2 }).paint(CH.black).move(x, 0, 0));
    crate.push(quad(0.14, 0.09).paint(CH.number).move(0, 0.02, -0.133));
    crate.push(rbox(0.18, 0.04, 0.06, { e1: 0.3, e2: 0.3, ws: 4, hs: 2 }).paint(CH.hazard).move(0, 0.2, 0));                 // carry handle
    crate.push(rbox(side * 0.6, 0.025, 0.012, { e1: 0.3, e2: 0.3, ws: 4, hs: 2 }).paint(CH.lamp).move(0, -0.12, -0.133));   // the ready light: lit crates are grabs left
  }
  // Where the view puts each door (its hinge) and the crate behind it, by face.
  const faces = [0, 1, 2, 3].map((k) => ({ yaw: (k * Math.PI) / 2 }));
  return { core: merge(core), cap: merge(capG), lampRing, door: merge(door), crate: merge(crate), faces, hinge: { r: R - 0.06, y: y0 + 0.02 }, crateAt: { r: R * 0.45 + 0.14, y: 0.86 } };
}

// ---------------------------------------------------------------- sentry
/** { mast (up from y = 0 to 1), head (pivot at the origin, barrels toward -Z), muzzle: z }. */
export function sentryModel({ fine = true } = {}) {
  const mast = [], head = [];
  mast.push(cyl(0.09, 0.075, 1, { seg: 10 }).paint(CH.metal));
  mast.push(cyl(0.13, 0.13, 0.08, { seg: 10 }).paint(CH.black).move(0, 0.92, 0));
  // The yoke and the sensor head between its arms.
  for (const sx of [-1, 1]) head.push(rbox(0.06, 0.34, 0.16, { e1: 0.2, e2: 0.25, ws: 6, hs: 3 }).paint(CH.black).move(sx * 0.31, 0.04, 0.02));
  head.push(rbox(0.5, 0.36, 0.62, { e1: 0.18, e2: 0.22, ws: fine ? 12 : 8, hs: 6 }).paint(CH.armor, { dirt: 0.05 }).move(0, 0.08, 0.02));
  head.push(rbox(0.3, 0.14, 0.04, { e1: 0.2, e2: 0.3, ws: 6, hs: 3 }).paint(CH.black).move(0, 0.16, -0.3));
  head.push(rbox(0.22, 0.07, 0.02, { e1: 0.3, e2: 0.4, ws: 6, hs: 2 }).paint(CH.visor).move(0, 0.16, -0.318));   // the optic
  for (const sx of [-1, 1]) {
    head.push(cyl(0.035, 0.03, 0.72, { seg: 8 }).paint(CH.metal).rot(-Math.PI / 2, 0, 0).move(sx * 0.1, -0.02, -0.26));
    head.push(cyl(0.045, 0.045, 0.1, { seg: 8 }).paint(CH.black).rot(-Math.PI / 2, 0, 0).move(sx * 0.1, -0.02, -0.92));
  }
  head.push(cyl(0.14, 0.14, 0.2, { seg: 12 }).paint(CH.black).rot(0, 0, Math.PI / 2).move(-0.36, 0.0, 0.12));    // ammo drum
  if (fine) {
    head.push(shell(0.44, 0.12, 0.02, { corner: 0.01, nu: 3, nv: 1 }).paint(CH.hazard).rot(-Math.PI / 2, 0, 0).move(0, 0.265, 0.12));
    head.push(number(0.2, 0.11).rot(0, -Math.PI / 2, 0).move(0.252, 0.05, 0.12));
    head.push(tube([[0.18, 0.26, 0.24], [0.19, 0.45, 0.27], [0.2, 0.6, 0.3]], 0.006, { seg: 6, radial: 3 }).paint(CH.black));
  }
  return { mast: merge(mast), head: merge(head), muzzle: -1.0 };
}

// ---------------------------------------------------------------- strike jet
/** { body, nozzles: [[x, y, z]] } about 13 m long, nose toward -Z. */
export function jetModel({ fine = true } = {}) {
  const b = [];
  // Fuselage: a long armored body, a nose cone, the canopy, a dark belly.
  b.push(rbox(1.7, 1.25, 9.2, { e1: 0.32, e2: 0.32, ws: fine ? 16 : 8, hs: 8 }).paint(CH.armor, { dirt: 0.04 }).move(0, 0, 0.6));
  b.push(lathe([[0.78, 0], [0.62, 1.1], [0.32, 2.3], [0, 3.1]], { seg: fine ? 14 : 8 }).paint(CH.armor).scale(1, 1, 0.82).rot(-Math.PI / 2, 0, 0).move(0, 0.02, -3.85));
  b.push(rbox(1.2, 0.5, 7.6, { e1: 0.3, e2: 0.3, ws: 10, hs: 4 }).paint(CH.black).move(0, -0.48, 0.9));
  b.push(rbox(0.82, 0.8, 2.5, { e1: 0.5, e2: 0.5, ws: 12, hs: 6, bottom: 0 }).paint(CH.glass).move(0, 0.5, -3.3));
  // Cranked-delta wings (plan outlines, extruded thin) with hazard leading edges.
  const wing = [[0.6, 2.4], [2.4, -0.6], [5.4, -2.6], [5.4, -3.5], [0.6, -3.6]];
  for (const sx of [1, -1]) {
    const w = prism(wing, 0.16, 'y', { bevel: 0.05 }).paint(CH.armor, { dirt: 0.03 }).move(0, -0.18, 0);
    if (sx < 0) w.mirrorX();
    b.push(w);
    if (fine) {
      const edge = prism([[2.4, -0.6], [5.4, -2.6], [5.23, -2.85], [2.23, -0.85]], 0.17, 'y', { bevel: 0.03 }).paint(CH.hazard).move(0, -0.185, 0);
      if (sx < 0) edge.mirrorX();
      b.push(edge);
      // Two bombs on pylons under each wing.
      for (const x of [2.2, 3.6]) {
        b.push(rbox(0.08, 0.3, 0.9, { e1: 0.2, e2: 0.2, ws: 4, hs: 2 }).paint(CH.black).move(sx * x, -0.36, 2.0));
        b.push(lathe([[0, 0], [0.06, 0], [0.16, 0.2], [0.2, 0.6], [0.16, 1.35], [0, 1.7]], { seg: 8 }).paint(CH.black, { dirt: 0.1 }).rot(-Math.PI / 2, 0, 0).move(sx * x, -0.62, 2.9));
        b.push(cyl(0.205, 0.205, 0.1, { seg: 8, open: true }).paint(CH.hazard).rot(-Math.PI / 2, 0, 0).move(sx * x, -0.62, 1.75));
      }
    }
  }
  // Canted twin tails, the stencilled number on each.
  const fin = [[-2.7, 0], [-4.7, 0], [-5.0, 2.2], [-4.2, 2.2]];
  for (const sx of [-1, 1]) {
    b.push(prism(fin, 0.12, 'x', { bevel: 0.03 }).paint(CH.armor).rot(0, 0, sx * -0.32).move(sx * 0.62, 0.45, 0));
    if (fine) b.push(number(0.7, 0.42).rot(0, sx * -Math.PI / 2, 0).rot(0, 0, sx * -0.32).move(sx * 0.975, 1.35, 4.1));
  }
  // Engines: two nacelles with nozzles; their glow is the lamp channel (and the view's flare).
  const nozzles = [];
  for (const sx of [-1, 1]) {
    b.push(rbox(0.9, 0.9, 4.2, { e1: 0.6, e2: 0.6, ws: fine ? 12 : 8, hs: 6 }).paint(CH.black).move(sx * 0.95, -0.05, 3.4));
    b.push(lathe([[0.42, 0], [0.46, 0.3], [0.4, 0.62], [0.3, 0.62]], { seg: fine ? 12 : 8 }).paint(CH.metal).rot(Math.PI / 2, 0, 0).move(sx * 0.95, -0.05, 5.4));
    b.push(cyl(0.3, 0.3, 0.02, { seg: fine ? 12 : 8 }).paint(CH.lamp).rot(Math.PI / 2, 0, 0).move(sx * 0.95, -0.05, 5.95));
    nozzles.push([sx * 0.95, -0.05, 6.1]);
  }
  if (fine) for (const sx of [-1, 1]) b.push(shell(2.2, 0.32, 0.04, { corner: 0.03, nu: 4, nv: 1 }).paint(CH.hazard).rot(0, sx * -Math.PI / 2, 0).move(sx * 0.86, 0.1, -1.6));
  return { body: merge(b), nozzles };
}

// ---------------------------------------------------------------- vehicle drop cradle
/**
 * The frame round a vehicle of `size` { x, y, z } (m, as in vehicles.json): { body, thrusters }
 * (the bells' mouths, for the flames). Faces -Z like the vehicle it carries.
 */
export function cradleModel(size) {
  const b = [], hx = size.x / 2 + 0.4, hz = size.z / 2 + 0.35, top = size.y + 0.75;
  const beam = (sx, sy, sz) => rbox(sx, sy, sz, { e1: 0.2, e2: 0.25, ws: 6, hs: 2 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.push(beam(0.22, top, 0.22).paint(CH.black, { dirt: (x, y) => Math.max(0, 0.7 - y * 0.25) }).move(sx * hx, top / 2, sz * hz));
    b.push(beam(0.28, 0.32, hz * 2 + 0.34).paint(CH.armor, { dirt: 0.1 }).move(sx * hx, top, 0));          // the long beams
    b.push(beam(0.32, 0.12, hz * 2 + 0.7).paint(CH.black, { dirt: 0.6 }).move(sx * hx, 0.06, 0));            // skids
  }
  for (const sz of [-1, 1]) b.push(beam(hx * 2 + 0.34, 0.3, 0.26).paint(CH.armor, { dirt: 0.1 }).move(0, top, sz * hz));
  // The spine over the middle with the lift eye, and its hazard stripes.
  b.push(beam(hx * 2, 0.24, 0.42).paint(CH.black).move(0, top + 0.06, 0));
  b.push(beam(0.46, 0.36, hz * 2 - 0.2).paint(CH.hazard, { dirt: 0.15 }).move(0, top + 0.08, 0));
  b.push(torus(0.24, 0.06, { seg: 12, radial: 4 }).paint(CH.metal).rot(0, 0, Math.PI / 2).move(0, top + 0.5, 0));
  const thrusters = [];
  for (const sx of [-1, 1]) for (const sz of [-0.5, 0.5]) {
    // A bell hung under the beam, wide mouth down, on a black collar.
    b.push(cyl(0.3, 0.17, 0.46, { seg: 10 }).paint(CH.metal, { dirt: 0.5 }).move(sx * hx, top - 0.66, sz * hz));
    b.push(cyl(0.2, 0.2, 0.18, { seg: 10 }).paint(CH.black).move(sx * hx, top - 0.22, sz * hz));
    thrusters.push([sx * hx, top - 0.72, sz * hz]);
  }
  for (const sz of [-1, 1]) b.push(number(0.5, 0.36).rot(0, sz > 0 ? 0 : Math.PI, 0).move(0, top, sz * (hz + 0.135)));
  return { body: merge(b), thrusters, top };
}
