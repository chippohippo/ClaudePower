// CityKit: the night city's things, modeled in code (docs/ART_DIRECTION.md, "The night city"):
// the civilian vehicles the war left in the streets (a futuristic sedan, a hover car, a van, a
// truck, a bus; crumpled, doors hanging, glass gone), street lamps, jersey barriers, shipping
// containers, tank traps, dumpsters, planters, benches, park trees and hedges, the park's
// fountain, and the neon signs' artwork.
//
// Each is a BufferGeometry from ModelKit parts with its paint channels baked into vertex colors
// (`bake`): the city's things aren't in an army's paint. Body paint bakes to white so an
// InstancedMesh's instance color paints each vehicle (a burned-out one: near black). Models face
// -Z with their base at y = 0.

import * as THREE from 'three';
import { CH, rbox, shell, cyl, lathe, tube, torus, prism, merge } from './ModelKit.js';

/** Paint channels to vertex colors (dirt toward a grime colour). */
export function bake(geo, colors, { grime = '#1d1a17', base = '#808080' } = {}) {
  const m = geo.getAttribute('aMat'), n = m.count, col = new Float32Array(n * 3);
  const C = {}, g = new THREE.Color(grime), c = new THREE.Color();
  for (const [k, v] of Object.entries(colors)) C[CH[k]] = new THREE.Color(v);
  const fallback = new THREE.Color(base);
  for (let i = 0; i < n; i++) {
    c.copy(C[Math.round(m.getX(i))] ?? fallback).lerp(g, Math.min(1, m.getZ(i)) * 0.6);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// Colors the vehicles bake to: the body white (the instance color paints it), the rest as itself.
const CAR = { armor: '#ffffff', glass: '#10141a', black: '#141416', rubber: '#0d0d0e', metal: '#5a5c60', lamp: '#3a3428', shade: '#0b0b0c', hazard: '#d9b13a', gear: '#2a2826' };

/** A little crumpling: a seeded field of dents pushed in toward the middle (the war has been at it). */
const _c = new THREE.Vector3();
function dent(part, seed, k = 0.06) {
  let s = seed >>> 0;
  const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const dents = Array.from({ length: 5 }, () => [r() * 2 - 1, 0.4 + r() * 1.6, (r() * 2 - 1) * 2.4, 0.5 + r() * 0.9, 0.5 + r()]);
  return part.warp((p) => {
    for (const [dx, dy, dz, rad, depth] of dents) {
      const d = Math.hypot(p.x - dx, p.y - dy, p.z - dz) / rad;
      if (d < 1) { _c.set(p.x, p.y - 0.8, p.z * 0.2).normalize(); p.addScaledVector(_c, -k * depth * (1 - d * d)); }
    }
  });
}

// ---------------------------------------------------------------- the wrecks
/** Four wheels (a hover car has pods instead), tyre and rim; `drop`: one corner on its rim. */
function wheels(out, w, l, r, { wheelbase = 0.62, drop = -1, fine = true } = {}) {
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], i) => {
    const rr = i === drop ? r * 0.75 : r;
    out.push(lathe([[rr * 0.6, -0.12], [rr * 0.95, -0.12], [rr, -0.05], [rr, 0.05], [rr * 0.95, 0.12], [rr * 0.6, 0.12]], { seg: fine ? 14 : 8 }).paint(CH.rubber).rot(0, 0, Math.PI / 2).move(sx * (w / 2 - 0.1), rr, sz * l * wheelbase / 2));
    out.push(cyl(rr * 0.6, rr * 0.6, 0.2, { seg: 8 }).paint(CH.metal, { dirt: 0.6 }).rot(0, 0, Math.PI / 2).move(sx * (w / 2 - 0.2), rr, sz * l * wheelbase / 2));
  });
}

function sedan(fine) {
  const L = 4.5, W = 1.9, b = [];
  wheels(b, W, L, 0.33, { fine, drop: 2 });
  // The body from its side profile: a long low wedge, a cabin set back, a short tail.
  b.push(dent(prism([[-L / 2, 0.32], [L / 2 - 0.25, 0.32], [L / 2, 0.55], [L / 2 - 0.15, 0.78], [0.9, 0.86], [-L / 2 + 0.3, 0.92], [-L / 2, 0.7]], W, 'x', { bevel: 0.05 }), 11).paint(CH.armor, { dirt: (x, y) => Math.max(0, 0.5 - y * 0.6) }));
  b.push(prism([[-1.25, 0.86], [0.85, 0.86], [0.2, 1.4], [-0.95, 1.42]], W * 0.86, 'x', { bevel: 0.04 }).paint(CH.glass));
  b.push(rbox(W * 0.87, 0.06, 1.15, { e1: 0.3, e2: 0.3, ws: 6, hs: 2 }).paint(CH.armor).move(0, 1.42, 0.38));   // the roof
  b.push(rbox(W * 1.02, 0.14, 0.18, { e1: 0.3, e2: 0.3, ws: 6, hs: 2 }).paint(CH.black, { dirt: 0.5 }).move(0, 0.42, -L / 2 + 0.04));
  b.push(rbox(W * 1.02, 0.14, 0.18, { e1: 0.3, e2: 0.3, ws: 6, hs: 2 }).paint(CH.black, { dirt: 0.5 }).move(0, 0.45, L / 2 - 0.06));
  if (fine) {
    // A light strip across the nose and the tail (dead now), a door hanging open.
    b.push(rbox(W * 0.8, 0.05, 0.05, { e1: 0.2, e2: 0.2, ws: 4, hs: 2 }).paint(CH.lamp).move(0, 0.66, -L / 2 + 0.08));
    b.push(rbox(W * 0.8, 0.06, 0.05, { e1: 0.2, e2: 0.2, ws: 4, hs: 2 }).paint(CH.lamp).move(0, 0.74, L / 2 - 0.06));
    b.push(shell(1.05, 0.55, 0.04, { corner: 0.04, nu: 3, nv: 2 }).paint(CH.armor).rot(0, -Math.PI / 2 - 0.9, 0).move(W / 2 + 0.38, 0.6, -0.55));
  }
  return { geo: merge(b), l: L, w: W };
}

function hover(fine) {
  const L = 4.9, W = 2.1, b = [];
  // A hover car down on its belly: no wheels, four thruster pods, a teardrop canopy.
  b.push(dent(rbox(W, 0.62, L, { e1: 0.45, e2: 0.5, ws: fine ? 18 : 8, hs: 8 }), 23).paint(CH.armor, { dirt: (x, y) => Math.max(0, 0.45 - y * 0.6) }).move(0, 0.42, 0));
  b.push(rbox(W * 0.75, 0.55, L * 0.48, { e1: 0.6, e2: 0.6, ws: fine ? 14 : 8, hs: 8 }).paint(CH.glass).move(0, 0.82, 0.15));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.push(cyl(0.28, 0.32, 0.5, { seg: fine ? 12 : 6 }).paint(CH.black, { dirt: 0.5 }).rot(Math.PI / 2, 0, 0).move(sx * (W / 2 + 0.05), 0.35, sz * L * 0.32));
    b.push(cyl(0.22, 0.22, 0.02, { seg: fine ? 12 : 6 }).paint(CH.shade).rot(Math.PI / 2, 0, 0).move(sx * (W / 2 + 0.05), 0.35, sz * L * 0.32 + sz * 0.26));
  }
  if (fine) b.push(rbox(W * 0.9, 0.05, 0.06, { e1: 0.2, e2: 0.2, ws: 4, hs: 2 }).paint(CH.lamp).move(0, 0.5, -L / 2 + 0.02));
  return { geo: merge(b), l: L, w: W };
}

function van(fine) {
  const L = 5.4, W = 2.15, b = [];
  wheels(b, W, L, 0.36, { fine, wheelbase: 0.66 });
  b.push(dent(prism([[-L / 2, 0.36], [L / 2 - 0.1, 0.36], [L / 2, 0.7], [L / 2 - 0.55, 1.35], [L / 2 - 1.0, 2.25], [-L / 2, 2.25]], W, 'x', { bevel: 0.05 }), 37, 0.05).paint(CH.armor, { dirt: (x, y) => Math.max(0, 0.45 - y * 0.35) }));
  b.push(shell(W * 0.86, 0.8, 0.03, { corner: 0.05, nu: 3, nv: 2 }).paint(CH.glass).rot(-0.62, 0, 0).move(0, 1.65, -L / 2 + 0.78));
  for (const sx of [-1, 1]) b.push(shell(0.9, 0.55, 0.03, { corner: 0.03, nu: 2, nv: 1 }).paint(CH.glass).rot(0, sx * -Math.PI / 2, 0).move(sx * (W / 2 + 0.003), 1.62, -L / 2 + 1.45));
  b.push(rbox(W * 1.02, 0.16, 0.2, { e1: 0.3, e2: 0.3, ws: 6, hs: 2 }).paint(CH.black, { dirt: 0.5 }).move(0, 0.46, -L / 2 + 0.06));
  if (fine) {
    // A side door slid open on the dark inside, a stripe down the flank.
    b.push(shell(1.2, 1.4, 0.02, { corner: 0.02, nu: 2, nv: 2 }).paint(CH.shade).rot(0, -Math.PI / 2, 0).move(W / 2 + 0.004, 1.15, -0.1));
    b.push(shell(L * 0.82, 0.18, 0.02, { corner: 0.01, nu: 6, nv: 1 }).paint(CH.hazard).rot(0, Math.PI / 2, 0).move(-W / 2 - 0.004, 1.05, 0.2));
  }
  return { geo: merge(b), l: L, w: W };
}

function truck(fine) {
  const L = 8.2, W = 2.5, b = [];
  wheels(b, W, L, 0.5, { fine, wheelbase: 0.7, drop: 1 });
  b.push(rbox(W * 0.85, 0.3, L * 0.95, { e1: 0.2, e2: 0.2, ws: 6, hs: 3 }).paint(CH.black, { dirt: 0.6 }).move(0, 0.75, 0));
  // The cab, and the cargo box behind it (its doors open).
  b.push(dent(prism([[-L / 2 + 0.05, 0.85], [-L / 2 + 2.2, 0.85], [-L / 2 + 2.2, 3.0], [-L / 2 + 0.55, 3.0], [-L / 2 + 0.05, 1.9]], W, 'x', { bevel: 0.05 }).move(0, 0, 0), 41, 0.04).paint(CH.armor));
  b.push(shell(W * 0.84, 0.8, 0.03, { corner: 0.04, nu: 3, nv: 2 }).paint(CH.glass).rot(-0.45, 0, 0).move(0, 2.35, L / 2 - 0.42));
  b.push(dent(rbox(W, 2.4, L * 0.68, { e1: 0.12, e2: 0.12, ws: 6, hs: 6 }), 43, 0.08).paint(CH.gear, { dirt: (x, y) => Math.max(0, 0.4 - y * 0.12) }).move(0, 2.1, -L * 0.14));
  if (fine) for (let k = 0; k < 9; k++) b.push(rbox(0.04, 2.3, 0.08, { e1: 0.2, e2: 0.2, ws: 4, hs: 2 }).paint(CH.black).move(W / 2 + 0.02, 2.1, -L * 0.14 - L * 0.3 + k * L * 0.075));
  return { geo: merge(b).rotateY(Math.PI), l: L, w: W };
}

function bus(fine) {
  const L = 11.5, W = 2.6, b = [];
  wheels(b, W, L, 0.5, { fine, wheelbase: 0.66 });
  b.push(dent(rbox(W, 2.7, L, { e1: 0.25, e2: 0.3, ws: fine ? 10 : 6, hs: 6 }), 59, 0.08).paint(CH.armor, { dirt: (x, y) => Math.max(0, 0.4 - y * 0.12) }).move(0, 1.75, 0));
  // A band of windows down both sides and across the front, a roof unit, doors.
  for (const sx of [-1, 1]) b.push(shell(L * 0.86, 0.95, 0.02, { corner: 0.04, nu: 8, nv: 1 }).paint(CH.glass).rot(0, sx * -Math.PI / 2, 0).move(sx * (W / 2 + 0.006), 2.2, 0.2));
  b.push(shell(W * 0.88, 1.2, 0.03, { corner: 0.05, nu: 3, nv: 2 }).paint(CH.glass).move(0, 2.05, -L / 2 - 0.01));
  b.push(rbox(W * 0.7, 0.35, L * 0.3, { e1: 0.3, e2: 0.3, ws: 6, hs: 3 }).paint(CH.black).move(0, 3.25, L * 0.18));
  if (fine) {
    b.push(rbox(W * 1.02, 0.12, L * 0.98, { e1: 0.2, e2: 0.2, ws: 6, hs: 2 }).paint(CH.hazard).move(0, 1.35, 0));    // a livery stripe
    b.push(rbox(W * 0.86, 0.22, 0.04, { e1: 0.2, e2: 0.2, ws: 4, hs: 2 }).paint(CH.lamp).move(0, 2.9, -L / 2 - 0.02));   // the route sign, dark
  }
  return { geo: merge(b), l: L, w: W };
}

/** The wrecks by type: { geo (vertex colors baked, body white), l, w }. */
export function wreckModels({ fine = true } = {}) {
  const out = {};
  for (const [k, f] of Object.entries({ sedan, hover, van, truck, bus })) { const m = f(fine); bake(m.geo, CAR); out[k] = m; }
  return out;
}

/** The civilian paint the wrecks were in (an instance color), and a burned-out one's. */
export const WRECK_COLORS = ['#8c2f2a', '#2f6d78', '#c9c6bd', '#d8b13a', '#5d6066', '#232428', '#3b4f8a', '#6b4a7a'];
export const BURNED = '#1a1614';

// ---------------------------------------------------------------- street furniture
/**
 * A street lamp: a tapering pole and a long arm reaching over the road (+Z here: the views turn
 * it to face the street), the LED bar's housing. The bar itself is `head` (its own emissive mesh).
 */
export function lampModels({ fine = true } = {}) {
  const post = [], head = [];
  post.push(cyl(0.13, 0.08, 7.3, { seg: fine ? 10 : 6 }).paint(CH.metal, { dirt: (x, y) => Math.max(0, 0.5 - y * 0.15) }));
  post.push(cyl(0.2, 0.2, 0.5, { seg: fine ? 10 : 6 }).paint(CH.black, { dirt: 0.5 }));
  post.push(tube([[0, 7.1, 0], [0, 7.5, 0.4], [0, 7.6, 1.2], [0, 7.55, 2.1]], 0.06, { seg: fine ? 10 : 6, radial: 6 }).paint(CH.metal));
  post.push(rbox(0.32, 0.12, 1.3, { e1: 0.3, e2: 0.3, ws: 6, hs: 2 }).paint(CH.black).move(0, 7.52, 1.65));
  head.push(rbox(0.22, 0.03, 1.15, { e1: 0.3, e2: 0.3, ws: 6, hs: 2 }).paint(CH.lamp).move(0, 7.45, 1.65));
  return { post: bake(merge(post), { metal: '#3a3d44', black: '#151619' }), head: merge(head), reach: 1.65, height: 7.45 };
}

/** Concrete jersey barrier: its section (wide foot, sloped face, narrow top) run 3 m along Z. */
export function jerseyModel() {
  const section = [[-0.35, 0], [0.35, 0], [0.33, 0.12], [0.12, 0.35], [0.1, 1.0], [-0.1, 1.0], [-0.12, 0.35], [-0.33, 0.12]];
  return bake(merge([prism(section, 3, 'x', { bevel: 0.02 }).rot(0, Math.PI / 2, 0).paint(CH.armor, { dirt: (x, y) => Math.max(0, 0.6 - y * 0.6) })]), { armor: '#7d7a74' });
}

/** A shipping container (2.5 x 2.6 x 6 m) with its ribs and doors; the instance color paints it. */
export function containerModel({ fine = true } = {}) {
  const b = [];
  b.push(rbox(2.5, 2.6, 6, { e1: 0.06, e2: 0.06, ws: 4, hs: 4 }).paint(CH.armor, { dirt: (x, y) => Math.max(0, 0.5 - y * 0.2) }).move(0, 1.3, 0));
  if (fine) for (let k = -13; k <= 13; k++) for (const sx of [-1, 1]) b.push(rbox(0.04, 2.4, 0.1, { e1: 0.2, e2: 0.2, ws: 4, hs: 2 }).paint(CH.armor).move(sx * 1.26, 1.3, k * 0.22));
  if (fine) for (const sx of [-0.6, 0.6]) b.push(rbox(0.05, 2.3, 0.05, { e1: 0.2, e2: 0.2, ws: 4, hs: 2 }).paint(CH.metal).move(sx, 1.3, -3.03));
  return bake(merge(b), { armor: '#ffffff', metal: '#4a4a4a' });
}
export const CONTAINER_COLORS = ['#8a3324', '#2c5a7a', '#3f6b3a', '#7a7a74', '#b8862a'];

/** A tank trap: three steel beams crossed. */
export function hedgehogModel() {
  const b = [];
  for (const [rx, ry, rz] of [[0.6, 0, 0], [-0.6, 0, 0], [0, 0, Math.PI / 2 - 0.6]]) b.push(rbox(0.16, 1.6, 0.16, { e1: 0.1, e2: 0.1, ws: 4, hs: 2 }).paint(CH.metal, { dirt: 0.5 }).rot(rx, ry, rz).move(0, 0.6, 0));
  return bake(merge(b), { metal: '#3d3a36' });
}

/** A dumpster with its lid, a planter (concrete, a dead shrub), a park bench. */
export function propModels({ fine = true } = {}) {
  const dump = [], plant = [], bench = [];
  dump.push(rbox(1.8, 1.1, 1.3, { e1: 0.1, e2: 0.15, ws: 6, hs: 4 }).paint(CH.armor, { dirt: 0.4 }).move(0, 0.6, 0));
  dump.push(rbox(1.84, 0.06, 1.34, { e1: 0.2, e2: 0.2, ws: 6, hs: 2 }).paint(CH.black).rot(0.3, 0, 0).move(0, 1.25, 0.15));
  plant.push(rbox(1.2, 0.85, 1.2, { e1: 0.12, e2: 0.12, ws: 6, hs: 4 }).paint(CH.armor, { dirt: (x, y) => Math.max(0, 0.5 - y * 0.5) }).move(0, 0.425, 0));
  plant.push(rbox(1.0, 0.06, 1.0, { e1: 0.3, e2: 0.3, ws: 6, hs: 2 }).paint(CH.shade).move(0, 0.83, 0));
  if (fine) for (let k = 0; k < 6; k++) plant.push(tube([[0, 0.85, 0], [Math.cos(k) * 0.15, 1.2, Math.sin(k) * 0.15], [Math.cos(k * 1.3) * 0.32, 1.45 + (k % 3) * 0.08, Math.sin(k * 1.3) * 0.32]], 0.015, { seg: 4, radial: 3 }).paint(CH.black));
  for (let k = 0; k < 4; k++) bench.push(rbox(1.8, 0.04, 0.09, { e1: 0.2, e2: 0.2, ws: 4, hs: 2 }).paint(CH.gear).move(0, 0.45, -0.18 + k * 0.12));
  for (let k = 0; k < 2; k++) bench.push(rbox(1.8, 0.09, 0.04, { e1: 0.2, e2: 0.2, ws: 4, hs: 2 }).paint(CH.gear).rot(-0.2, 0, 0).move(0, 0.65 + k * 0.13, 0.28 + k * 0.02));
  for (const sx of [-0.75, 0.75]) bench.push(rbox(0.06, 0.45, 0.5, { e1: 0.2, e2: 0.2, ws: 4, hs: 2 }).paint(CH.metal).move(sx, 0.225, 0));
  return {
    dumpster: bake(merge(dump), { armor: '#2f4a3a', black: '#151515' }),
    planter: bake(merge(plant), { armor: '#6f6c66', shade: '#1f1a15', black: '#2a231c' }),
    bench: bake(merge(bench), { gear: '#5a3f2a', metal: '#2a2b2e' }),
  };
}

/** A park tree: the trunk and its limbs (`trunk`), and the crown as a few lumps (`crown`). */
export function treeModels({ fine = true } = {}) {
  const trunk = [], crown = [];
  trunk.push(cyl(0.24, 0.14, 3.6, { seg: fine ? 8 : 5 }).paint(CH.gear, { dirt: 0.3 }));
  for (let k = 0; k < 4; k++) { const a = k * 1.7; trunk.push(tube([[0, 2.6, 0], [Math.cos(a) * 0.6, 3.4, Math.sin(a) * 0.6], [Math.cos(a) * 1.2, 4.0, Math.sin(a) * 1.2]], 0.07, { seg: 5, radial: 4 }).paint(CH.gear)); }
  for (const [x, y, z, r] of [[0, 4.4, 0, 1.8], [0.9, 3.9, 0.5, 1.3], [-0.8, 4.0, -0.4, 1.4], [0.2, 5.1, -0.3, 1.2]]) crown.push(rbox(r * 2, r * 1.6, r * 2, { e1: 0.85, e2: 0.85, ws: fine ? 10 : 6, hs: fine ? 7 : 4 }).paint(CH.armor).move(x, y, z));
  return { trunk: bake(merge(trunk), { gear: '#2c241d' }), crown: bake(merge(crown), { armor: '#ffffff' }) };
}

/** A bumpy hedge, 1 m along X (scaled to its box). */
export function hedgeModel() {
  return bake(merge([rbox(1, 1, 1, { e1: 0.55, e2: 0.5, ws: 10, hs: 6 }).paint(CH.armor).move(0, 0.5, 0)]), { armor: '#1d2a1a' });
}

/** The park's fountain: a round basin, its water, and a monument on a column. */
export function fountainModel(r, { fine = true } = {}) {
  const b = [];
  b.push(lathe([[r * 0.92, 0], [r, 0], [r, 0.7], [r * 0.92, 0.75], [r * 0.9, 0.2]], { seg: fine ? 40 : 16 }).paint(CH.armor, { dirt: 0.3 }));
  b.push(cyl(r * 0.9, r * 0.9, 0.04, { seg: fine ? 40 : 16 }).paint(CH.glass).move(0, 0.5, 0));
  b.push(cyl(0.55, 0.45, 3.2, { seg: fine ? 12 : 6 }).paint(CH.armor));
  b.push(torus(1.1, 0.07, { seg: fine ? 32 : 12, radial: 6 }).paint(CH.metal).rot(Math.PI / 2 - 0.3, 0, 0).move(0, 3.6, 0));
  b.push(rbox(0.4, 1.6, 0.4, { e1: 0.1, e2: 0.1, ws: 4, hs: 4 }).paint(CH.metal).rot(0, Math.PI / 4, 0).move(0, 4.0, 0));
  return bake(merge(b), { armor: '#8a8680', glass: '#1d2a40', metal: '#6c6f78' });
}

// ---------------------------------------------------------------- neon
/**
 * The signs' artwork: eight signs in a 2 x 4 atlas, drawn as glowing strokes on black (made-up
 * names and glyphs: a noodle bar, a hotel, a pharmacy cross, a 24/7, an arrow, a chevron
 * stack, a kanji-like stack, a heart). White strokes: the instance color tints them.
 */
export function signAtlas() {
  const cv = (typeof document !== 'undefined' ? document.createElement('canvas') : null);
  if (!cv) return null;
  cv.width = 512; cv.height = 1024;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 512, 1024);
  const cell = (i, draw) => { const x = (i % 2) * 256, y = Math.floor(i / 2) * 256; g.save(); g.translate(x, y); g.beginPath(); g.rect(6, 6, 244, 244); g.clip(); draw(); g.restore(); };
  const glow = (fn, w = 7) => { g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = w * 3; g.lineCap = 'round'; g.lineJoin = 'round'; fn(); g.strokeStyle = '#fff'; g.lineWidth = w; fn(); };
  const text = (s, size, y) => { g.font = `700 ${size}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 12; g.strokeStyle = 'rgba(255,255,255,0.22)'; g.strokeText(s, 128, y); g.fillStyle = '#fff'; g.fillText(s, 128, y); };
  const frame = () => glow(() => { g.strokeRect(18, 18, 220, 220); }, 5);
  cell(0, () => { frame(); text('NOODLE', 46, 110); text('BAR', 54, 165); });
  cell(1, () => { frame(); text('HOTEL', 60, 128); });
  cell(2, () => { glow(() => { g.beginPath(); for (const [x, y] of [[98, 40], [158, 40], [158, 98], [216, 98], [216, 158], [158, 158], [158, 216], [98, 216], [98, 158], [40, 158], [40, 98], [98, 98]]) g.lineTo(x, y); g.closePath(); g.stroke(); }, 8); });
  cell(3, () => { frame(); text('24/7', 72, 128); });
  cell(4, () => { glow(() => { g.beginPath(); g.moveTo(40, 128); g.lineTo(190, 128); g.moveTo(140, 70); g.lineTo(200, 128); g.lineTo(140, 186); g.stroke(); }, 10); });
  cell(5, () => { glow(() => { for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(60, 60 + k * 55); g.lineTo(128, 110 + k * 55); g.lineTo(196, 60 + k * 55); g.stroke(); } }, 9); });
  cell(6, () => { glow(() => { g.beginPath(); for (const [a, b2, c, d] of [[70, 40, 186, 40], [128, 40, 128, 120], [60, 90, 196, 90], [80, 140, 176, 140], [80, 140, 80, 216], [176, 140, 176, 216], [80, 216, 176, 216], [80, 178, 176, 178]]) { g.moveTo(a, b2); g.lineTo(c, d); } g.stroke(); }, 8); });
  cell(7, () => { glow(() => { g.beginPath(); g.moveTo(128, 200); g.bezierCurveTo(30, 130, 60, 40, 128, 90); g.bezierCurveTo(196, 40, 226, 130, 128, 200); g.stroke(); }, 9); });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
