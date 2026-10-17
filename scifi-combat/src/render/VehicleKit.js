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
  out.push(cyl(r, r, 0.01, { seg: 10 }).paint(CH.lamp).rot(-Math.PI / 2, 0, 0).move(x, y, z - 0.003));
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
  // Body: a long armored spine, a fairing over the nose, a seat, hover pods glowing underneath.
  b.push(rbox(W * 0.6, H * 0.36, L * 0.72, { e1: 0.35, e2: st.e + 0.1, ws: fine ? 14 : 7, hs: 6 }).paint(CH.armor, { dirt: 0.1 }).move(0, H * 0.5, 0.05));
  b.push(shell(W * 0.7, L * 0.34, 0.06, { corner: st.void ? [0.25, 0.25, 0.02, 0.02] : [0.12, 0.12, 0.04, 0.04], curveY: 0.35, nu: fine ? 6 : 2, nv: 3 }).paint(CH.armor).rot(-1.2, 0, 0).move(0, H * 0.62, -L * 0.36));
  b.push(shell(W * 0.46, 0.2, 0.025, { corner: 0.04, curveY: 0.3, nu: 3, nv: 2 }).paint(CH.glass).rot(-0.75, 0, 0).move(0, H * 0.78, -L * 0.2));
  b.push(rbox(W * 0.36, 0.12, L * 0.3, { e1: 0.35, e2: 0.4, ws: 8, hs: 4 }).paint(CH.black).move(0, H * 0.72, L * 0.14));
  for (const z of [-L * 0.3, L * 0.28]) {
    b.push(rbox(W * 0.95, H * 0.2, L * 0.24, { e1: 0.3, e2: st.e, ws: fine ? 10 : 6, hs: 4 }).paint(CH.black, { dirt: 0.4 }).move(0, H * 0.25, z));
    b.push(rbox(W * 0.8, 0.02, L * 0.18, { e1: 0.2, e2: 0.3, ws: 6, hs: 2 }).paint(CH.visor).move(0, H * 0.14, z));
  }
  b.push(cyl(0.13, 0.16, 0.3, { seg: fine ? 12 : 6 }).paint(CH.metal).rot(Math.PI / 2, 0, 0).move(0, H * 0.48, L * 0.42));
  b.push(cyl(0.1, 0.1, 0.02, { seg: fine ? 12 : 6 }).paint(CH.visor).rot(Math.PI / 2, 0, 0).move(0, H * 0.48, L * 0.73));
  if (fine) {
    b.push(tube([[-W * 0.4, H * 0.86, -L * 0.12], [0, H * 0.8, -L * 0.16], [W * 0.4, H * 0.86, -L * 0.12]], 0.018, { seg: 10, radial: 5 }).paint(CH.black));
    for (const sx of [-1, 1]) b.push(shell(L * 0.3, H * 0.16, 0.03, { corner: 0.02, nu: 3, nv: 1 }).paint(CH.hazard).rot(0, sx * -Math.PI / 2, 0).move(sx * W * 0.31, H * 0.5, -L * 0.05));
    lamp(b, 0, H * 0.55, -L * 0.48, 0.05);
    b.push(number(0.22, 0.12).rot(0, -Math.PI / 2, 0).move(W * 0.31, H * 0.56, L * 0.15));
  }
  return { body: merge(b) };
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
 * The model for a vehicle def: { body, turret?, turretY?, barrel?, trail?, rack?, leg?, crate? }.
 * @param {string} type  the def's key (vehicles.json), for the army's style
 */
export function vehicleModel(def, type, { fine = true } = {}) {
  const st = styleOf(type);
  if (def.model === 'gun') return fieldGun(def, st, fine);
  if (def.gun || def.cargo) return truck(def, st, fine);
  if (def.model === 'tracked') return tank(def, st, fine);
  if (def.model === 'flyer') return dropship(def, st, fine);
  return bike(def, st, fine);
}
