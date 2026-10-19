// VehicleKit: both armies' vehicles and guns, modeled in code (docs/ART_DIRECTION.md: "Vehicles,
// guns and props": chunky, boxy, utilitarian, made in a hurry; faction paint on the big plates,
// black and gunmetal on everything mechanical, hazard stripes on anything that moves or hits,
// stencilled numbers, work lights, dust on the lower hull).
//
// Each model is a static body plus the parts VehicleViews moves (turret, barrel, trail legs,
// stabilizers, crates), as BufferGeometries painted by channel (ModelKit CH; TrooperMaterial
// paintMaterial gives them the faction's colors). Models face -Z, ground at y = 0, sized from
// the vehicle's def (size, gun trunnion and barrel length). Solari builds rounder, Void sharper.

import { CH, rbox, shell, cyl, lathe, tube, torus, quad, prism, merge } from './ModelKit.js';

// ---------------------------------------------------------------- shared pieces
/** Style per army: Solari rounder, Void sharper and spined. */
const styleOf = (type) => (type?.startsWith('void') ? { e: 0.12, void: true } : { e: 0.2, void: false });

/** A track run along Z (centred on z0): belt, road wheels, sprocket and idler, an armored skirt. */
function tracks(L, x, w, h, st, out, fine, z0 = 0) {
  const from = out.length;
  const belt = rbox(w, h, L, { e1: 0.35, e2: 0.2, ws: fine ? 12 : 6, hs: fine ? 6 : 3 }).paint(CH.rubber).move(x, h / 2, 0);
  out.push(belt.paint(CH.rubber, { dirt: (px, py) => 0.5 + 0.5 * (1 - py / h) }));
  if (fine) {
    const n = Math.max(4, Math.round(L / 0.9));
    for (let i = 0; i < n; i++) {
      const z = -L / 2 + 0.45 + (i * (L - 0.9)) / (n - 1);
      out.push(cyl(h * 0.36, h * 0.36, 0.06, { seg: 12 }).paint(CH.metal, { dirt: 0.6 }).rot(0, 0, Math.PI / 2).move(x + Math.sign(x) * (w / 2 + 0.03), h * 0.4, z));
    }
    for (const z of [-L / 2 + 0.25, L / 2 - 0.25]) out.push(cyl(h * 0.42, h * 0.42, 0.08, { seg: 12 }).paint(CH.black, { dirt: 0.5 }).rot(0, 0, Math.PI / 2).move(x + Math.sign(x) * (w / 2 + 0.04), h * 0.52, z));
  }
  // The skirt: a painted plate over the upper run, hazard-striped at the nose.
  out.push(shell(L * 0.9, h * 0.55, 0.06, { corner: [0.1, st.void ? 0.3 : 0.12, 0.05, 0.05], nu: fine ? 8 : 2, nv: 2 }).paint(CH.armor, { dirt: (px, py) => 0.45 - py }).rot(0, Math.sign(x) * -Math.PI / 2, 0).move(x + Math.sign(x) * (w / 2 + 0.05), h * 0.72, 0));
  if (fine) out.push(shell(0.4, h * 0.5, 0.065, { corner: 0.04, nu: 2, nv: 2 }).paint(CH.hazard).rot(0, Math.sign(x) * -Math.PI / 2, 0).move(x + Math.sign(x) * (w / 2 + 0.055), h * 0.72, -L * 0.43));
  if (z0) for (let i = from; i < out.length; i++) out[i].move(0, 0, z0);
}

/** A lamp: housing and glowing lens, facing -Z. */
const lamp = (out, x, y, z, r = 0.07) => {
  out.push(cyl(r * 1.3, r * 1.3, 0.1, { seg: 10 }).paint(CH.black).rot(-Math.PI / 2, 0, 0).move(x, y, z + 0.05));
  out.push(cyl(r, r, 0.01, { seg: 10 }).paint(CH.lamp).rot(-Math.PI / 2, 0, 0).move(x, y, z - 0.052));   // just proud of the housing's face
};
/** A stencilled number on a face (normal along -Z by default; rotate as needed). */
const number = (w, h) => quad(w, h).paint(CH.number);

// ---------------------------------------------------------------- tank
function tank(def, st, fine) {
  const { x: W, y: H, z: L } = def.size, body = [], turret = [];
  const tw = 0.55, th = H * 0.42, deck = H * 0.62;
  for (const side of [-1, 1]) tracks(L, side * (W / 2 - tw / 2), tw, th, st, body, fine);
  // Hull from its side profile: a lower tub between the tracks, then the upper hull over them,
  // a long sloped glacis in front, the engine deck sloping down at the back.
  const hl = L / 2, hw = W - tw * 2 + 0.1;
  body.push(prism([[-hl, 0.3], [hl - 0.4, 0.3], [hl, th * 0.9], [hl, th + 0.05], [-hl, th + 0.05]], hw, 'x', { bevel: 0.03 }).paint(CH.black, { dirt: 0.45 }));
  const nose = st.void ? 1.25 : 1.0;
  body.push(prism([[-hl + 0.1, th], [hl, th], [hl, th + 0.12], [hl - nose, deck], [-hl + 0.55, deck], [-hl + 0.1, deck - 0.22]], W * 0.98, 'x', { bevel: 0.04 }).paint(CH.armor, { dirt: (x, y) => Math.max(0, 0.35 - (y - th) * 0.8) }));
  if (fine) {
    body.push(shell(0.5, nose * 0.9, 0.04, { corner: 0.03, nu: 2, nv: 3 }).paint(CH.hazard).rot(-Math.atan2(deck - th - 0.12, nose), 0, 0).move(W * 0.3, (th + 0.12 + deck) / 2 + 0.03, -(hl - nose / 2) - 0.02));
    for (let i = 0; i < 5; i++) body.push(rbox(W * 0.5, 0.04, 0.08, { e1: 0.2, e2: 0.2, ws: 4, hs: 2 }).paint(CH.metal).move(0, deck + 0.01, L * 0.12 + i * 0.13));   // grille
    for (const sx of [-1, 1]) lamp(body, sx * W * 0.34, th + 0.2, -hl + 0.02);
    body.push(number(0.5, 0.26).rot(0, -Math.PI / 2, 0).move(W * 0.49 + 0.006, (th + deck) / 2, L * 0.12));
    body.push(number(0.5, 0.26).rot(0, Math.PI / 2, 0).move(-W * 0.49 - 0.006, (th + deck) / 2, L * 0.12));
    // Stowage: jerrycans and a tow cable on the rear deck, a toolbox on the fender.
    for (const sx of [-1, 1]) body.push(rbox(0.22, 0.32, 0.12, { e1: 0.2, e2: 0.2 }).paint(CH.gear).move(sx * W * 0.36, deck + 0.16, L * 0.4));
    body.push(torus(0.18, 0.025, { seg: 14, radial: 4 }).paint(CH.black).move(0, deck + 0.03, L * 0.33));
    body.push(rbox(0.5, 0.18, 0.25, { e1: 0.15, e2: 0.15 }).paint(CH.black).move(-W * 0.36, deck + 0.09, -L * 0.05));
  }
  // Turret from its plan: a pointed front, flat sides, a bustle at the back.
  const tW = W * 0.62, tL = L * 0.46, tH = H * 0.3;
  const tp = st.void
    ? [[-tW / 2, -tL / 2], [tW / 2, -tL / 2], [tW / 2, tL * 0.15], [tW * 0.18, tL / 2], [-tW * 0.18, tL / 2], [-tW / 2, tL * 0.15]]
    : [[-tW * 0.45, -tL / 2], [tW * 0.45, -tL / 2], [tW / 2, -tL * 0.2], [tW / 2, tL * 0.22], [tW * 0.3, tL / 2], [-tW * 0.3, tL / 2], [-tW / 2, tL * 0.22], [-tW / 2, -tL * 0.2]];
  turret.push(prism(tp, tH, 'y', { bevel: 0.05 }).paint(CH.armor, { dirt: 0.06 }).move(0, 0, 0.1));
  turret.push(rbox(tW * 0.42, tH * 0.85, 0.28, { e1: 0.25, e2: 0.25, ws: 8, hs: 4 }).paint(CH.black).move(0, tH * 0.5, -tL / 2 - 0.02));   // mantlet
  const bl = L * 0.72;
  turret.push(lathe([[0.13, 0], [0.13, bl * 0.5], [0.16, bl * 0.52], [0.16, bl * 0.62], [0.11, bl * 0.64], [0.11, bl]], { seg: fine ? 12 : 6 }).paint(CH.metal).rot(-Math.PI / 2, 0, 0).move(0, tH * 0.5, -tL / 2 - 0.1));
  turret.push(rbox(0.3, 0.26, 0.42, { e1: 0.25, e2: 0.25, ws: 8, hs: 4 }).paint(CH.black).move(0, tH * 0.5, -tL / 2 - bl + 0.1));
  if (fine) {
    turret.push(cyl(0.28, 0.28, 0.09, { seg: 14 }).paint(CH.black).move(-tW * 0.18, tH, 0.3));
    turret.push(rbox(0.16, 0.1, 0.12, { e1: 0.2, e2: 0.2 }).paint(CH.black).move(tW * 0.2, tH + 0.04, -tL * 0.25));
    turret.push(shell(tW * 0.7, 0.16, 0.05, { corner: 0.03, nu: 4, nv: 1 }).paint(CH.hazard).rot(0, Math.PI, 0).move(0, tH * 0.7, tL / 2 + 0.1));
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) turret.push(cyl(0.05, 0.05, 0.18, { seg: 8 }).paint(CH.black).rot(-0.6, 0, sx * 0.4).move(sx * (tW / 2 + 0.04), tH * 0.55 + k * 0.08, -tL * 0.18));
    turret.push(number(0.4, 0.22).rot(0, -Math.PI / 2, 0).move(tW / 2 + 0.006, tH * 0.5, 0.25));
    turret.push(number(0.4, 0.22).rot(0, Math.PI / 2, 0).move(-tW / 2 - 0.006, tH * 0.5, 0.25));
    turret.push(tube([[tW * 0.32, tH, 0.55], [tW * 0.33, tH + 0.9, 0.57], [tW * 0.35, tH + 1.8, 0.65]], 0.012, { seg: 8, radial: 4 }).paint(CH.black));
    lamp(turret, tW * 0.32, tH * 0.8, -tL * 0.42, 0.06);
    if (st.void) for (const sx of [-1, 1]) turret.push(rbox(0.06, 0.4, 0.5, { e1: 0.1, e2: 0.1 }).paint(CH.shade).rot(0, 0, sx * 0.3).move(sx * tW * 0.45, tH * 1.1, 0.4));   // fins
  }
  return { body: merge(body), turret: merge(turret), turretY: deck - 0.02 };
}

// ---------------------------------------------------------------- hover bike
function bike(def, st, fine) {
  const { x: W, y: H, z: L } = def.size, b = [];
  // Where the rider sits, holds on and puts his feet (the driver seat's offset, grips and pegs, from
  // the hull's position, which floats hoverHeight over this model's origin): the seat's top, the
  // bar's grips and the pegs are built exactly there, and the rider's pose reaches the same points.
  const seat = def.seats?.find((q) => q.role === 'driver'), hh = def.hoverHeight ?? 0;
  const [, oy, oz] = seat?.offset ?? [0, H * 0.78 - hh, L * 0.08];
  const sy = oy + hh, at = (p, side) => [side * p[0], sy + p[1], oz - p[2]];
  // Body: a long armored spine, a fairing over the nose, a seat, hover pods glowing underneath.
  b.push(rbox(W * 0.6, H * 0.36, L * 0.72, { e1: 0.35, e2: st.e + 0.1, ws: fine ? 14 : 7, hs: 6 }).paint(CH.armor, { dirt: 0.1 }).move(0, H * 0.5, 0.05));
  b.push(shell(W * 0.7, L * 0.34, 0.06, { corner: st.void ? [0.25, 0.25, 0.02, 0.02] : [0.12, 0.12, 0.04, 0.04], curveY: 0.35, nu: fine ? 6 : 2, nv: 3 }).paint(CH.armor).rot(-1.2, 0, 0).move(0, H * 0.62, -L * 0.36));
  b.push(shell(W * 0.46, 0.2, 0.025, { corner: 0.04, curveY: 0.3, nu: 3, nv: 2 }).paint(CH.glass).rot(-0.75, 0, 0).move(0, H * 0.78, -L * 0.2));
  // The saddle: its top at the seat point, running back from just ahead of it, on a riser off the spine.
  b.push(rbox(W * 0.36, 0.12, L * 0.3, { e1: 0.35, e2: 0.4, ws: 8, hs: 4 }).paint(CH.black).move(0, sy - 0.06, oz + L * 0.06));
  if (sy - 0.12 > H * 0.68) b.push(rbox(W * 0.3, sy - 0.12 - H * 0.6, L * 0.24, { e1: 0.3, e2: 0.3, ws: 6, hs: 3 }).paint(CH.armor).move(0, (sy - 0.12 + H * 0.6) / 2, oz + L * 0.06));
  // The handlebar through the grips, on a stem off the nose; the pegs out on struts from the spine.
  if (seat?.grips) {
    const gl = at(seat.grips, -1), gr = at(seat.grips, 1), mid = [0, gl[1] - 0.05, gl[2] - 0.05];
    b.push(tube([gl, mid, gr], 0.02, { seg: fine ? 12 : 4, radial: fine ? 6 : 4 }).paint(CH.black));
    b.push(tube([[0, H * 0.7, mid[2] + 0.06], [0, mid[1], mid[2]]], 0.03, { seg: 2, radial: fine ? 6 : 4 }).paint(CH.metal));
    for (const g of [gl, gr]) b.push(cyl(0.024, 0.024, 0.11, { seg: fine ? 8 : 4 }).paint(CH.black, { dirt: 0.3 }).rot(0, 0, Math.PI / 2).move(g[0] + 0.055, g[1], g[2]));   // (centred on the grip)
  }
  if (seat?.pegs) for (const side of [-1, 1]) {
    // (the peg is the ankle's: the sole rests on it, an ankle's height below)
    const [px, py, pz] = at(seat.pegs, side), top = py - 0.08;
    b.push(rbox(0.12, 0.035, 0.09, { e1: 0.3, e2: 0.3, ws: 4, hs: 2 }).paint(CH.black, { dirt: 0.5 }).move(px, top - 0.0175, pz));
    b.push(rbox(Math.abs(px) - W * 0.28, 0.04, 0.05, { e1: 0.2, e2: 0.2, ws: 3, hs: 2 }).paint(CH.metal).move(side * (Math.abs(px) + W * 0.28) / 2, top - 0.02, pz));
  }
  for (const z of [-L * 0.3, L * 0.28]) {
    b.push(rbox(W * 0.95, H * 0.2, L * 0.24, { e1: 0.3, e2: st.e, ws: fine ? 10 : 6, hs: 4 }).paint(CH.black, { dirt: 0.4 }).move(0, H * 0.25, z));
    b.push(rbox(W * 0.8, 0.02, L * 0.18, { e1: 0.2, e2: 0.3, ws: 6, hs: 2 }).paint(CH.visor).move(0, H * 0.14, z));
  }
  b.push(cyl(0.13, 0.16, 0.3, { seg: fine ? 12 : 6 }).paint(CH.metal).rot(Math.PI / 2, 0, 0).move(0, H * 0.48, L * 0.42));
  b.push(cyl(0.1, 0.1, 0.02, { seg: fine ? 12 : 6 }).paint(CH.visor).rot(Math.PI / 2, 0, 0).move(0, H * 0.48, L * 0.73));
  if (fine) {
    if (!seat?.grips) b.push(tube([[-W * 0.4, H * 0.86, -L * 0.12], [0, H * 0.8, -L * 0.16], [W * 0.4, H * 0.86, -L * 0.12]], 0.018, { seg: 10, radial: 5 }).paint(CH.black));
    for (const sx of [-1, 1]) b.push(shell(L * 0.3, H * 0.16, 0.03, { corner: 0.02, nu: 3, nv: 1 }).paint(CH.hazard).rot(0, sx * -Math.PI / 2, 0).move(sx * W * 0.31, H * 0.5, -L * 0.05));
    lamp(b, 0, H * 0.55, -L * 0.48, 0.05);
    b.push(number(0.22, 0.12).rot(0, -Math.PI / 2, 0).move(W * 0.31, H * 0.56, L * 0.15));
  }
  return { body: merge(b) };
}

// ---------------------------------------------------------------- recon car
/**
 * A four-seat recon car (an open tub on a roll cage, the gunner standing at a ring mount over
 * the rear deck): the static body, the ring-mounted gun (VehicleViews swings it on the ring's
 * axis at `gunAt`) and one wheel (placed, steered and spun at each hub). Solari: round fenders,
 * a curved hood, a bull bar. Void: a wedge nose, slab fenders, spines along the cage.
 */
function car(def, st, fine) {
  const { x: W, y: H, z: L } = def.size, C = def.car, Wh = C.wheels, b = [], gun = [], wheel = [];
  const hl = L / 2, bw = W * 0.82, side = bw / 2;
  const seg = fine ? 14 : 6;
  // Floor pan and chassis rails, the skid plate under the nose.
  b.push(rbox(bw * 0.92, 0.08, L * 0.62, { e1: 0.2, e2: 0.2, ws: 6, hs: 2 }).paint(CH.black, { dirt: 0.6 }).move(0, 0.5, 0.05));
  for (const sx of [-1, 1]) b.push(rbox(0.12, 0.14, L * 0.94, { e1: 0.2, e2: 0.2, ws: 6, hs: 3 }).paint(CH.black, { dirt: 0.7 }).move(sx * side * 0.62, 0.48, 0));
  b.push(shell(bw * 0.7, 0.5, 0.04, { corner: 0.04, nu: 3, nv: 2 }).paint(CH.metal, { dirt: 0.8 }).rot(-1.15, 0, 0).move(0, 0.5, -hl + 0.32));
  // The hood: a side profile over the engine bay in front of the windscreen (a wedge for the Void).
  const hood = st.void
    ? [[0.95, 0.56], [hl - 0.05, 0.56], [hl, 0.7], [hl - 0.25, 0.84], [0.95, 1.08]]
    : [[0.95, 0.56], [hl - 0.08, 0.56], [hl, 0.68], [hl - 0.08, 0.86], [hl - 0.6, 0.98], [0.95, 1.06]];
  b.push(prism(hood, bw, 'x', { bevel: st.void ? 0.02 : 0.06 }).paint(CH.armor, { dirt: (x, y) => Math.max(0, 0.4 - (y - 0.56) * 0.9) }));
  if (fine) {
    // A louvred vent in the hood and a stripe down its middle.
    const top = (z) => { let yv = 0.56; for (let i = 0; i < hood.length - 1; i++) { const [u0, v0] = hood[i], [u1, v1] = hood[i + 1]; if ((u0 - -z) * (u1 - -z) <= 0 && u0 !== u1 && Math.min(v0, v1) > 0.6) yv = Math.max(yv, v0 + ((v1 - v0) * (-z - u0)) / (u1 - u0)); } return yv; };
    for (let k = 0; k < 4; k++) { const z = -1.25 - k * 0.12; b.push(rbox(bw * 0.34, 0.03, 0.05, { e1: 0.2, e2: 0.2, ws: 4, hs: 2 }).paint(CH.black).move(0, top(z) + 0.01, z)); }
    b.push(shell(0.22, 1.0, 0.012, { corner: 0.01, nu: 2, nv: 4 }).paint(CH.hazard).rot(-Math.PI / 2 + 0.12, 0, 0).move(bw * 0.28, top(-1.55) + 0.012, -1.55));
  }
  // The rear deck over the engine (the gunner stands on its step), and the tail.
  b.push(prism([[-hl + 0.02, 0.56], [-0.75, 0.56], [-0.75, 1.02], [-hl + 0.3, 1.04], [-hl + 0.02, 0.86]], bw, 'x', { bevel: st.void ? 0.02 : 0.05 }).paint(CH.armor, { dirt: (x, y) => Math.max(0, 0.4 - (y - 0.56) * 0.9) }));
  // The tub's sides: door panels from the hood to the deck, open above the sill.
  for (const sx of [-1, 1]) {
    b.push(prism([[-0.78, 0.55], [0.98, 0.55], [0.98, 1.03], [0.7, 1.0], [-0.78, 0.98]], 0.08, 'x', { bevel: 0.015 }).paint(CH.armor, { dirt: (x, y) => Math.max(0, 0.45 - (y - 0.55)) }).move(sx * (side - 0.04), 0, 0));
    if (fine) b.push(number(0.42, 0.22).rot(0, sx * -Math.PI / 2, 0).move(sx * (side + 0.002), 0.8, 0.12));
  }
  // Fenders over the wheels: round arches (Solari) or flat slabs (Void).
  for (const z of [Wh.zf, Wh.zr]) for (const sx of [-1, 1]) {
    const x = sx * Wh.x;
    if (st.void) b.push(rbox(0.46, 0.08, 1.12, { e1: 0.1, e2: 0.1, ws: 4, hs: 2 }).paint(CH.armor, { dirt: 0.3 }).rot(0, 0, sx * 0.12).move(x, 0.98, z));
    else b.push(lathe([[Wh.radius + 0.06, -0.23], [Wh.radius + 0.12, -0.21], [Wh.radius + 0.13, 0.21], [Wh.radius + 0.07, 0.23]], { seg: fine ? 16 : 8, phi0: Math.PI / 2 - 1.25, phiLen: 2.5 }).paint(CH.armor, { dirt: 0.35 }).rot(0, 0, Math.PI / 2).move(x, 0.44, z));
  }
  // The cockpit: four bucket seats, the dash, the wheel; a windscreen frame with a low glass pane.
  const seats = def.seats.filter((q) => q.role !== 'gunner');
  for (const q of seats) {
    const [x, y, z] = q.offset;
    b.push(rbox(0.46, 0.12, 0.46, { e1: 0.3, e2: 0.3, ws: 6, hs: 3 }).paint(CH.gear).move(x, y - 0.02, z + 0.02));
    b.push(rbox(0.46, 0.6, 0.1, { e1: 0.3, e2: 0.3, ws: 6, hs: 3 }).paint(CH.gear).rot(-0.18, 0, 0).move(x, y + 0.3, z + 0.3));
  }
  b.push(rbox(bw * 0.9, 0.22, 0.24, { e1: 0.2, e2: 0.2, ws: 6, hs: 3 }).paint(CH.black).move(0, 0.98, -0.88));
  const drv = def.seats.find((q) => q.role === 'driver')?.offset ?? [-0.42, 0.72, -0.2];
  b.push(torus(0.17, 0.022, { seg: 16, radial: 5 }).paint(CH.black).rot(Math.PI / 2 - 0.5, 0, 0).move(drv[0], 1.12, -0.62));
  for (const sx of [-1, 1]) b.push(tube([[sx * side * 0.92, 1.04, -0.98], [sx * side * 0.9, 1.5, -0.86]], 0.03, { seg: 4, radial: 6 }).paint(CH.black));
  b.push(tube([[-side * 0.9, 1.5, -0.86], [side * 0.9, 1.5, -0.86]], 0.03, { seg: 4, radial: 6 }).paint(CH.black));
  b.push(shell(bw * 0.84, 0.28, 0.02, { corner: 0.03, nu: 3, nv: 1 }).paint(CH.glass).rot(-0.3, 0, 0).move(0, 1.2, -0.94));
  // The roll cage: a hoop behind the front seats and one over the rear, joined along the roof,
  // braced down to the tail.
  const cageY = H - 0.04, cx = side * 0.86;
  for (const z of [0.15, 0.75]) {
    b.push(tube([[-cx, 1.0, z], [-cx * 0.95, cageY - 0.1, z], [-cx * 0.8, cageY, z], [cx * 0.8, cageY, z], [cx * 0.95, cageY - 0.1, z], [cx, 1.0, z]], 0.04, { seg: fine ? 16 : 8, radial: 6 }).paint(CH.black, { dirt: 0.2 }));
  }
  for (const sx of [-1, 1]) {
    b.push(tube([[sx * side * 0.9, 1.5, -0.86], [sx * cx * 0.8, cageY, -0.3], [sx * cx * 0.8, cageY, 0.75]], 0.035, { seg: fine ? 10 : 6, radial: 6 }).paint(CH.black));
    b.push(tube([[sx * cx * 0.8, cageY, 0.75], [sx * cx * 0.85, 1.3, 1.6], [sx * cx * 0.9, 1.02, hl - 0.2]], 0.035, { seg: fine ? 10 : 6, radial: 6 }).paint(CH.black));
    if (st.void && fine) for (let k = 0; k < 3; k++) b.push(rbox(0.04, 0.22, 0.12, { e1: 0.1, e2: 0.1 }).paint(CH.shade).rot(-0.4, 0, 0).move(sx * cx * 0.8, cageY + 0.1, -0.15 + k * 0.32));   // spines
  }
  // The ring mount over the rear deck: a ring at the standing gunner's waist on four posts, a
  // tread plate under his boots.
  const [gx, gy, gz] = def.seats.find((q) => q.role === 'gunner')?.offset ?? [0, 1.04, 1.1];
  const ringY = gy + 0.95;
  b.push(rbox(0.9, 0.03, 0.8, { e1: 0.2, e2: 0.2, ws: 6, hs: 2 }).paint(CH.metal, { dirt: 0.5 }).move(gx, gy - 0.01, gz));
  b.push(torus(0.52, 0.04, { seg: fine ? 28 : 12, radial: 6 }).paint(CH.metal).move(gx, ringY, gz));
  for (const a of [0.6, 2.5, 3.8, 5.7]) b.push(tube([[gx + Math.cos(a) * 0.46, gy, gz + Math.sin(a) * 0.46], [gx + Math.cos(a) * 0.52, ringY, gz + Math.sin(a) * 0.52]], 0.028, { seg: 2, radial: 5 }).paint(CH.black));
  // Front: bull bar (Solari) or a ram plate (Void), lamps, a hazard bumper; rear: tail lamps, the
  // spare wheel, jerrycans; an aerial.
  if (st.void) b.push(shell(bw * 0.86, 0.36, 0.06, { corner: [0.12, 0.12, 0.02, 0.02], nu: 4, nv: 2 }).paint(CH.black, { dirt: 0.5 }).rot(0.35, 0, 0).move(0, 0.66, -hl - 0.04));
  else {
    b.push(tube([[-bw * 0.42, 0.55, -hl + 0.05], [-bw * 0.4, 0.95, -hl - 0.1], [bw * 0.4, 0.95, -hl - 0.1], [bw * 0.42, 0.55, -hl + 0.05]], 0.04, { seg: fine ? 14 : 6, radial: 6 }).paint(CH.black, { dirt: 0.3 }));
    for (const sx of [-0.18, 0.18]) b.push(tube([[sx * bw, 0.58, -hl - 0.02], [sx * bw, 0.94, -hl - 0.1]], 0.03, { seg: 2, radial: 5 }).paint(CH.black));
  }
  b.push(rbox(bw * 1.0, 0.14, 0.16, { e1: 0.2, e2: 0.2, ws: 6, hs: 3 }).paint(CH.hazard, { dirt: 0.4 }).move(0, 0.56, -hl + 0.02));
  if (fine) {
    for (const sx of [-1, 1]) {
      lamp(b, sx * bw * 0.3, st.void ? 0.72 : 0.84, -hl - (st.void ? 0.08 : 0.16), 0.085);
      lamp(b, sx * 0.28, cageY + 0.08, -0.32, 0.06);                                   // roof lamps on the cage
      b.push(rbox(0.12, 0.08, 0.04, { e1: 0.2, e2: 0.2 }).paint(CH.lamp).move(sx * bw * 0.38, 0.9, hl - 0.01));   // tail lamps
      b.push(rbox(0.12, 0.32, 0.22, { e1: 0.2, e2: 0.2 }).paint(CH.gear).move(sx * bw * 0.3, 1.2, hl - 0.25));     // jerrycans
    }
    b.push(tube([[side * 0.8, cageY, 0.75], [side * 0.82, cageY + 0.9, 0.78], [side * 0.86, cageY + 1.7, 0.86]], 0.01, { seg: 8, radial: 4 }).paint(CH.black));
    b.push(shell(bw * 0.5, 0.12, 0.03, { corner: 0.02, nu: 3, nv: 1 }).paint(CH.hazard).rot(0, Math.PI, 0).move(0, 0.75, hl + 0.01));
  }
  // The gun on the ring (origin at the ring's centre): pintle, receiver, a long barrel with a
  // flash hider, the ammo can, a gun shield, spade grips.
  gun.push(cyl(0.05, 0.05, 0.22, { seg: 8 }).paint(CH.black).move(0, 0, -0.3));
  gun.push(rbox(0.16, 0.18, 0.62, { e1: 0.2, e2: 0.2, ws: 6, hs: 3 }).paint(CH.black).move(0, 0.28, -0.25));
  gun.push(lathe([[0.04, 0], [0.036, 0.9], [0.05, 0.92], [0.05, 1.08], [0.03, 1.1]], { seg: fine ? 10 : 6 }).paint(CH.metal).rot(-Math.PI / 2, 0, 0).move(0, 0.3, -0.55));
  gun.push(rbox(0.16, 0.16, 0.26, { e1: 0.2, e2: 0.2 }).paint(CH.gear).move(-0.17, 0.24, -0.2));
  gun.push(shell(0.72, 0.42, 0.04, { corner: st.void ? [0.2, 0.2, 0.02, 0.02] : [0.08, 0.08, 0.03, 0.03], curveY: 0.8, nu: fine ? 5 : 2, nv: 2 }).paint(CH.armor).move(0, 0.38, -0.5));
  if (fine) {
    gun.push(shell(0.66, 0.07, 0.045, { corner: 0.02, curveY: 0.8, nu: 4, nv: 1 }).paint(CH.hazard).move(0, 0.56, -0.505));
    for (const sx of [-1, 1]) gun.push(tube([[sx * 0.06, 0.28, 0.06], [sx * 0.12, 0.3, 0.16], [sx * 0.12, 0.38, 0.2]], 0.018, { seg: 6, radial: 4 }).paint(CH.black));
  }
  // One wheel, its axle along X, the hub cap on +X (VehicleViews mirrors the left ones): a fat
  // off-road tyre with tread blocks, a dished rim, lug nuts.
  const r = Wh.radius, tw = 0.34;
  wheel.push(lathe([[r * 0.62, -tw / 2], [r * 0.93, -tw / 2], [r, -tw / 2 + 0.05], [r, tw / 2 - 0.05], [r * 0.93, tw / 2], [r * 0.62, tw / 2]], { seg: fine ? 22 : 10 }).paint(CH.rubber, { dirt: 0.6 }).rot(0, 0, -Math.PI / 2));
  if (fine) for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    wheel.push(rbox(0.14, 0.05, 0.1, { e1: 0.3, e2: 0.3, ws: 4, hs: 2 }).paint(CH.rubber, { dirt: 0.7 }).move(k % 2 ? 0.07 : -0.07, r + 0.005, 0).rot(a, 0, 0));
  }
  wheel.push(cyl(r * 0.62, r * 0.62, tw * 0.8, { seg: fine ? 14 : 7 }).paint(CH.black, { dirt: 0.4 }).rot(0, 0, -Math.PI / 2).move(-tw * 0.4, 0, 0));
  wheel.push(cyl(r * 0.25, r * 0.2, 0.06, { seg: 10 }).paint(CH.metal).rot(0, 0, -Math.PI / 2).move(tw * 0.4, 0, 0));
  if (fine) for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; wheel.push(cyl(0.02, 0.02, 0.03, { seg: 6 }).paint(CH.metal).rot(0, 0, -Math.PI / 2).move(tw * 0.42, Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36)); }
  // The spare, on the tail.
  const spare = wheel.map((p) => p.clone().scale(0.92).rot(0, Math.PI / 2, 0).move(0, 1.0, hl + 0.1));
  if (fine) b.push(...spare);
  return { body: merge(b), gun: merge(gun), gunAt: [gx, ringY, gz], wheel: merge(wheel) };
}

// ---------------------------------------------------------------- dropship
function dropship(def, st, fine) {
  const { x: W, y: H, z: L } = def.size, b = [];
  b.push(rbox(W * 0.42, H * 0.8, L * 0.86, { e1: 0.3, e2: st.e + 0.1, ws: fine ? 16 : 8, hs: 8 }).paint(CH.armor, { dirt: 0.1 }).move(0, H * 0.55, 0));
  b.push(shell(W * 0.36, L * 0.18, 0.05, { corner: 0.15, curveY: 1.0, nu: fine ? 6 : 2, nv: 3 }).paint(CH.glass).rot(-0.9, 0, 0).move(0, H * 0.82, -L * 0.36));
  for (const sx of [-1, 1]) {
    // Wings with an engine pod each, glowing aft.
    b.push(shell(W * 0.36, L * 0.32, 0.12, { corner: st.void ? [0.6, 0.1, 0.1, 0.3] : [0.3, 0.1, 0.1, 0.2], nu: fine ? 5 : 2, nv: 3 }).paint(CH.armor).rot(-Math.PI / 2, 0, 0).move(sx * W * 0.38, H * 0.7, 0.4));
    b.push(cyl(0.42, 0.5, L * 0.36, { seg: fine ? 14 : 7 }).paint(CH.black).rot(Math.PI / 2, 0, 0).move(sx * W * 0.5, H * 0.62, 0.0));
    b.push(cyl(0.38, 0.38, 0.03, { seg: fine ? 14 : 7 }).paint(CH.visor).rot(Math.PI / 2, 0, 0).move(sx * W * 0.5, H * 0.62, L * 0.36 + 0.02));
    b.push(rbox(0.12, 0.5, L * 0.5, { e1: 0.2, e2: 0.2, ws: 4, hs: 3 }).paint(CH.black).move(sx * W * 0.16, 0.25, 0));   // landing skids
    if (fine) b.push(shell(L * 0.4, 0.3, 0.04, { corner: 0.03, nu: 4, nv: 1 }).paint(CH.hazard).rot(0, sx * -Math.PI / 2, 0).move(sx * W * 0.215, H * 0.35, 0.2));
  }
  b.push(shell(1.4, 1.2, 0.08, { corner: [0.5, 0.05, 0.05, 0.05], nu: 3, nv: 3 }).paint(CH.armor).rot(0, Math.PI / 2, 0).move(0, H * 1.1, L * 0.36));
  if (fine) { for (const sx of [-1, 1]) lamp(b, sx * W * 0.12, H * 0.4, -L * 0.43, 0.09); b.push(number(0.8, 0.45).rot(0, -Math.PI / 2, 0).move(W * 0.215, H * 0.75, -L * 0.1)); }
  return { body: merge(b) };
}

// ---------------------------------------------------------------- towed guns
function fieldGun(def, st, fine) {
  const { x: W, z: L } = def.size, g = def.gun, small = g.kind === 'at', tr = g.trunnion ?? [0, 1, 0];
  const body = [], barrel = [], trail = [];
  const wr = small ? 0.45 : 0.62;
  // Axle and wheels (tyre, rim, hub).
  body.push(rbox(W * 0.85, 0.2, 0.26, { e1: 0.3, e2: 0.3, ws: 8, hs: 3 }).paint(CH.black).move(0, wr, tr[2] + 0.2));
  for (const side of [-1, 1]) {
    body.push(lathe([[wr * 0.62, -0.11], [wr * 0.95, -0.11], [wr, -0.05], [wr, 0.05], [wr * 0.95, 0.11], [wr * 0.62, 0.11]], { seg: fine ? 18 : 8 }).paint(CH.rubber, { dirt: 0.7 }).rot(0, 0, Math.PI / 2).move(side * W * 0.46, wr, tr[2] + 0.2));
    body.push(cyl(wr * 0.62, wr * 0.62, 0.16, { seg: fine ? 14 : 7 }).paint(CH.black, { dirt: 0.4 }).rot(0, 0, Math.PI / 2).move(side * W * 0.46 - 0.08, wr, tr[2] + 0.2));
    if (fine) body.push(cyl(wr * 0.2, wr * 0.2, 0.22, { seg: 8 }).paint(CH.metal).rot(0, 0, Math.PI / 2).move(side * W * 0.46 - 0.11, wr, tr[2] + 0.2));
  }
  // The shield: faction paint, a hazard band along the top, the gun's number.
  const sh = small ? 0.8 : 1.05;
  body.push(shell(W * 0.92, sh, 0.06, { corner: st.void ? [0.35, 0.35, 0.05, 0.05] : [0.18, 0.18, 0.04, 0.04], curveY: 2.5, nu: fine ? 8 : 2, nv: 4 }).paint(CH.armor, { dirt: (x, y) => 0.4 - y * 0.4 }).rot(-0.12, 0, 0).move(0, tr[1] * 0.75, tr[2] - 0.12));
  if (fine) {
    body.push(shell(W * 0.86, 0.1, 0.065, { corner: 0.02, curveY: 2.5, nu: 6, nv: 1 }).paint(CH.hazard).rot(-0.12, 0, 0).move(0, tr[1] * 0.75 + sh * 0.36, tr[2] - 0.125));
    body.push(number(0.34, 0.18).rot(-0.12, 0, 0).move(W * 0.22, tr[1] * 0.75 - sh * 0.15, tr[2] - 0.185));
  }
  // The barrel on its slide: a tapering tube with a muzzle brake, recoil cylinders, breech, sight.
  const len = g.barrel ?? 2, r0 = small ? 0.075 : 0.13, r1 = small ? 0.06 : 0.1;
  barrel.push(lathe([[r0 * 1.15, 0], [r0, 0.15], [r1, len * 0.9], [r1 * 1.25, len * 0.91], [r1 * 1.3, len], [r1 * 0.8, len]], { seg: fine ? 14 : 7 }).paint(CH.metal).rot(-Math.PI / 2, 0, 0));
  barrel.push(rbox(r1 * 3.2, r1 * 2.6, 0.22, { e1: 0.2, e2: 0.2, ws: 6, hs: 3 }).paint(CH.black).move(0, 0, -len + 0.1));
  barrel.push(rbox(0.36, 0.32, 0.5, { e1: 0.2, e2: 0.2, ws: 8, hs: 4 }).paint(CH.black).move(0, 0, 0.3));                // breech
  if (fine) {
    for (const y of [0.17, -0.17]) barrel.push(cyl(0.05, 0.05, len * 0.45, { seg: 8 }).paint(CH.metal).rot(-Math.PI / 2, 0, 0).move(0, y * (small ? 0.7 : 1), 0.1));
    barrel.push(rbox(0.1, 0.12, 0.2, { e1: 0.2, e2: 0.2, ws: 6, hs: 3 }).paint(CH.black).move(-0.25, 0.18, 0.15));
    barrel.push(quad(0.07, 0.07).paint(CH.glass).move(-0.25, 0.18, 0.04));
  }
  // One trail leg (VehicleViews mirrors it): a long beam to a spade.
  trail.push(rbox(0.16, 0.16, L * 0.55, { e1: 0.2, e2: 0.2, ws: 6, hs: 3 }).paint(CH.black, { dirt: 0.4 }).rot(0.16, 0, 0).move(0, -0.2, L * 0.27));
  trail.push(shell(0.5, 0.35, 0.06, { corner: [0.02, 0.02, 0.12, 0.12], nu: 3, nv: 2 }).paint(CH.metal, { dirt: 0.8 }).move(0, -0.42, L * 0.53));
  if (fine) trail.push(rbox(0.2, 0.03, 0.4, { e1: 0.2, e2: 0.2, ws: 4, hs: 2 }).paint(CH.hazard).rot(0.16, 0, 0).move(0, -0.11, L * 0.12));
  return { body: merge(body), barrel: merge(barrel), trail: merge(trail) };
}

// ---------------------------------------------------------------- trucks: rocket battery, supply hauler
function truck(def, st, fine) {
  const { x: W, y: H, z: L } = def.size, body = [], rack = [], leg = [], crate = [];
  // A half-tracked chassis: wheels under the cab, tracks under the bed.
  const tw = 0.5, th = 0.8;
  for (const side of [-1, 1]) {
    tracks(L * 0.55, side * (W / 2 - tw / 2), tw, th, st, body, fine, L * 0.2);
    body.push(lathe([[0.3, -0.16], [0.48, -0.16], [0.5, 0], [0.48, 0.16], [0.3, 0.16]], { seg: fine ? 16 : 8 }).paint(CH.rubber, { dirt: 0.7 }).rot(0, 0, Math.PI / 2).move(side * (W / 2 - 0.2), 0.5, -L * 0.34));
    body.push(cyl(0.3, 0.3, 0.26, { seg: fine ? 12 : 6 }).paint(CH.black, { dirt: 0.5 }).rot(0, 0, Math.PI / 2).move(side * (W / 2 - 0.2) - 0.13, 0.5, -L * 0.34));
  }
  body.push(rbox(W * 0.7, 0.35, L * 0.95, { e1: 0.2, e2: 0.2, ws: 6, hs: 3 }).paint(CH.black, { dirt: 0.5 }).move(0, 0.75, 0));      // frame
  // The cab from its side profile: a sloped armored hood, a raked windscreen, a flat roof.
  const cz = -L * 0.3, cl = L * 0.36, base = 0.85, ch = H * 0.62, front = -cz + cl / 2;   // front: how far forward the cab reaches
  const u = (f) => cl / 2 - f * cl;                         // 0 = the front of the cab, 1 = its back
  body.push(prism([[u(1), base], [u(0), base], [u(0), base + ch * 0.45], [u(0.38), base + ch * 0.55], [u(0.55), base + ch], [u(1), base + ch]], W * 0.94, 'x', { bevel: 0.04 })
    .paint(CH.armor, { dirt: (x, y) => Math.max(0, 0.35 - (y - base) * 0.35) }).move(0, 0, cz));
  // The windscreen on the rake, side windows.
  const rake = Math.atan2(ch * 0.45, cl * 0.17);
  body.push(shell(W * 0.8, Math.hypot(ch * 0.45, cl * 0.17) * 0.8, 0.03, { corner: 0.04, nu: 4, nv: 1 }).paint(CH.glass).rot(-(Math.PI / 2 - rake), 0, 0).move(0, base + ch * 0.77, cz - u(0.465) - 0.015));
  if (fine) {
    for (const sx of [-1, 1]) {
      lamp(body, sx * W * 0.36, base + ch * 0.3, cz - front + 0.02, 0.08);
      body.push(shell(cl * 0.3, ch * 0.3, 0.03, { corner: 0.02, nu: 2, nv: 1 }).paint(CH.glass).rot(0, sx * -Math.PI / 2, 0).move(sx * (W * 0.47 + 0.004), base + ch * 0.78, cz + cl * 0.22));
      body.push(rbox(0.3, 0.06, cl * 0.5, { e1: 0.2, e2: 0.2, ws: 4, hs: 2 }).paint(CH.black, { dirt: 0.5 }).move(sx * W * 0.4, base - 0.05, cz - cl * 0.15));   // mudguards
    }
    for (let k = 0; k < 5; k++) body.push(rbox(W * 0.56, 0.035, 0.03, { e1: 0.2, e2: 0.2, ws: 4, hs: 2 }).paint(CH.black).move(0, base + 0.12 + k * 0.07, cz - front - 0.005));   // grille slats
    body.push(rbox(W * 1.02, 0.16, 0.16, { e1: 0.2, e2: 0.2, ws: 6, hs: 3 }).paint(CH.hazard, { dirt: 0.4 }).move(0, base - 0.02, cz - front - 0.06));                     // bumper
    body.push(rbox(W * 0.7, 0.08, 0.14, { e1: 0.2, e2: 0.2, ws: 6, hs: 2 }).paint(CH.black).move(0, base + ch + 0.06, cz + 0.1));
    for (let k = 0; k < 4; k++) body.push(cyl(0.035, 0.035, 0.01, { seg: 8 }).paint(CH.lamp).rot(-Math.PI / 2, 0, 0).move(-W * 0.24 + k * W * 0.16, base + ch + 0.06, cz + 0.1 - 0.076));
    for (const sx of [-1, 1]) body.push(number(0.4, 0.22).rot(0, sx * -Math.PI / 2, 0).move(sx * (W * 0.47 + 0.006), base + ch * 0.35, cz + cl * 0.2));
    body.push(tube([[W * 0.4, base + ch, cz + cl * 0.3], [W * 0.41, base + ch + 0.8, cz + cl * 0.32], [W * 0.43, base + ch + 1.6, cz + cl * 0.4]], 0.012, { seg: 8, radial: 4 }).paint(CH.black));
  }
  if (def.cargo) {
    // The bed: side boards, and the cargo VehicleViews shows as crates.
    body.push(rbox(W * 0.92, 0.12, L * 0.62, { e1: 0.2, e2: 0.2, ws: 6, hs: 2 }).paint(CH.black).move(0, H * 0.42, L * 0.16));
    for (const sx of [-1, 1]) body.push(shell(L * 0.62, 0.45, 0.05, { corner: 0.02, nu: fine ? 5 : 1, nv: 1 }).paint(CH.shade, { dirt: 0.3 }).rot(0, sx * -Math.PI / 2, 0).move(sx * W * 0.45, H * 0.42 + 0.28, L * 0.16));
    crate.push(rbox(W * 0.38, 0.62, 0.9, { e1: 0.15, e2: 0.15, ws: 6, hs: 4 }).paint(CH.gear, { dirt: 0.15 }));
    if (fine) {
      for (const y of [-0.2, 0.2]) crate.push(rbox(W * 0.39, 0.04, 0.91, { e1: 0.2, e2: 0.2, ws: 4, hs: 2 }).paint(CH.black).move(0, y, 0));
      crate.push(quad(0.3, 0.16).paint(CH.number).rot(0, Math.PI, 0).move(0, 0.05, 0.4555));
      crate.push(cyl(0.22, 0.22, 0.5, { seg: 12 }).paint(CH.hazard).move(W * 0.08, 0.31, 0.12));      // a drum lashed on top
    }
    return { body: merge(body), crate: merge(crate) };
  }
  // Rocket battery: the rack of tubes (on the trunnion), and one stabilizer leg (repeated).
  const RW = W * 0.75, RH = 0.9, RL = 2.4;
  rack.push(rbox(RW, RH, RL, { e1: 0.15, e2: st.e * 0.6, ws: fine ? 10 : 6, hs: 4 }).paint(CH.armor).move(0, 0, -0.6));
  rack.push(rbox(RW * 0.94, RH * 0.88, 0.05, { e1: 0.1, e2: 0.1, ws: 6, hs: 3 }).paint(CH.black).move(0, 0, -1.8));
  if (fine) {
    const cols = 5, rows = 3;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) rack.push(cyl(0.07, 0.07, 0.03, { seg: 8 }).paint(CH.metal).rot(-Math.PI / 2, 0, 0).move(-RW * 0.38 + (i * RW * 0.76) / (cols - 1), -RH * 0.3 + (j * RH * 0.6) / (rows - 1), -1.83));
    rack.push(shell(RW * 0.9, 0.14, 0.04, { corner: 0.02, nu: 5, nv: 1 }).paint(CH.hazard).rot(-Math.PI / 2, 0, 0).move(0, RH / 2 + 0.005, -1.4));
    rack.push(quad(0.5, 0.26).paint(CH.number).rot(0, -Math.PI / 2, 0).move(RW / 2 + 0.005, 0.05, -0.3));
  }
  leg.push(rbox(0.18, 1, 0.18, { e1: 0.2, e2: 0.2, ws: 6, hs: 3 }).paint(CH.black, { dirt: 0.5 }));
  leg.push(rbox(0.36, 0.06, 0.36, { e1: 0.3, e2: 0.3, ws: 6, hs: 2 }).paint(CH.metal, { dirt: 0.8 }).move(0, -0.5, 0));
  return { body: merge(body), rack: merge(rack), leg: merge(leg) };
}

/**
 * The model for a vehicle def: { body, turret?, turretY?, barrel?, trail?, rack?, leg?, crate?, gun?, gunAt?, wheel? }.
 * @param {string} type  the def's key (vehicles.json), for the army's style
 */
export function vehicleModel(def, type, { fine = true } = {}) {
  const st = styleOf(type);
  if (def.model === 'gun') return fieldGun(def, st, fine);
  if (def.gun || def.cargo) return truck(def, st, fine);
  if (def.model === 'tracked') return tank(def, st, fine);
  if (def.model === 'flyer') return dropship(def, st, fine);
  if (def.model === 'car') return car(def, st, fine);
  return bike(def, st, fine);
}
