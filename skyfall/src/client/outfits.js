// Legend outfits for the Quaternius Universal Base Characters (UBC). The pack ships bare bodies on the
// Universal Animation Library skeleton, so every legend is dressed here, once per legend template:
//   1. suit: every body vertex is classified from its rest-pose position (head, neck, torso, arms,
//      hands, legs, feet) and gets a fabric colour, roughness and metalness through vertex attributes.
//      The skin texture only stays on the face; the muscle normal map is damped under the fabric.
//   2. gear: hard-surface pieces (plate carriers, shoulder armour, belts, knee pads, helmets, gas
//      masks, packs, jetpacks …) sized from the body's own cross-sections and parented to bones, so
//      they follow the animation with zero skinning cost and clone with the character.
//   3. hair: UBC hairstyles (skinned to the head bone) re-bound to the body skeleton.
// Outfit specs live in the manifest ("outfit" on a character entry), see LOOKS below for the defaults.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();

// --- palette helpers --------------------------------------------------------------------------
const col = (c) => new THREE.Color(c);
function mats(spec) {
  const m = (color, rough, metal, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  return {
    armor: m(spec.armor || '#3a3f46', 0.42, 0.35),
    accent: m(spec.primary, 0.45, 0.2),
    polymer: m(spec.polymer || '#1d2024', 0.7, 0.05),
    webbing: m(spec.webbing || '#2c2f2a', 0.9, 0),
    metal: m('#8a9096', 0.3, 0.85),
    glow: m(spec.glow || spec.primary, 0.3, 0, { emissive: col(spec.glow || spec.primary), emissiveIntensity: 2.2 }),
    visor: m(spec.visor || '#0c1218', 0.08, 0.6, { emissive: col(spec.glow || spec.primary), emissiveIntensity: 0.25 }),
    light: m(spec.light || '#d9dcdf', 0.5, 0.1),
    boot: m(spec.boot || '#25272a', 0.55, 0.05),
    sole: m('#111214', 0.9, 0),
  };
}

// --- body measurements from the rest pose ------------------------------------------------------
function restVerts(mesh) {
  const p = mesh.geometry.attributes.position, out = new Float32Array(p.count * 3);
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();
  for (let i = 0; i < p.count; i++) {
    mesh.getVertexPosition(i, _v).applyMatrix4(mesh.matrixWorld);
    out[i * 3] = _v.x; out[i * 3 + 1] = _v.y; out[i * 3 + 2] = _v.z;
  }
  return out;
}

function skeletonInfo(root) {
  const B = {};
  root.updateMatrixWorld(true);
  root.traverse((o) => { if (o.isBone) B[o.name.toLowerCase()] = o; });
  const P = (n) => (B[n] ? B[n].getWorldPosition(new THREE.Vector3()) : null);
  return {
    bones: B,
    pelvis: P('pelvis'), spine1: P('spine_01'), spine2: P('spine_02'), chest: P('spine_03'), neck: P('neck_01'), head: P('head'),
    shoulder: P('upperarm_l'), elbow: P('lowerarm_l'), wrist: P('hand_l'), thigh: P('thigh_l'), knee: P('calf_l'), ankle: P('foot_l'), ball: P('ball_l'),
  };
}

// cross-section of the torso (or a limb) between y0 and y1: x/z extents of vertices inside |x| < xMax
function slab(V, y0, y1, xMin, xMax) {
  const r = { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9, n: 0 };
  for (let i = 0; i < V.length; i += 3) {
    const x = V[i], y = V[i + 1], z = V[i + 2];
    if (y < y0 || y > y1 || x < xMin || x > xMax) continue;
    r.x0 = Math.min(r.x0, x); r.x1 = Math.max(r.x1, x); r.z0 = Math.min(r.z0, z); r.z1 = Math.max(r.z1, z); r.n++;
  }
  r.w = r.x1 - r.x0; r.d = r.z1 - r.z0; r.cx = (r.x0 + r.x1) / 2; r.cz = (r.z0 + r.z1) / 2;
  return r;
}

// --- 1. suit -------------------------------------------------------------------------------------
// The rest-pose position + normal of every vertex go to the shader (aRest / aRestN); the fragment
// shader decides per pixel what it is (skin, collar, sleeve, glove, torso panel, yoke, pants, knee
// pad, boot …), so seams, stripes and panels are crisp lines even on a 7k-vertex body.
function paintSuit(mesh, V, S, spec) {
  const geo = mesh.geometry.clone();
  geo.setAttribute('aRest', new THREE.BufferAttribute(V, 3));
  // rest normals from the rest positions
  const tmp = new THREE.BufferGeometry();
  tmp.setAttribute('position', new THREE.BufferAttribute(V, 3));
  if (geo.index) tmp.setIndex(geo.index);
  tmp.computeVertexNormals();
  geo.setAttribute('aRestN', tmp.attributes.normal);
  mesh.geometry = geo;
  mesh.material = suitMaterial(mesh.material, spec, S);
}

const FLAG = (spec) => new THREE.Vector4(
  { full: 0, short: 1, none: 2 }[spec.sleeves || 'full'],
  { lower: 1, balaclava: 2 }[spec.mask] || 0,
  (spec.armStripe ? 1 : 0) + (spec.legStripe ? 2 : 0) + (spec.chestStripe ? 4 : 0),
  (spec.pants === 'cargo' ? 1 : 0) + (spec.gloves === 'fingerless' ? 2 : 0) + (spec.torso === 'tank' ? 4 : 0),
);

const SUIT_GLSL = `
uniform vec3 uSkin, uPrim, uSec, uTert, uAcc, uGlove, uBoot, uMask;
uniform vec4 uL1, uL2, uL3, uF;
varying vec3 vRest, vRestN;
bool bit(float v, float b) { return mod(floor(v / b), 2.0) > 0.5; }
// first-person cut: only the arms from just outside the shoulder
bool fpArm() { return abs(vRest.x) > uL2.w - 0.09 && vRest.y > uL1.z - 0.03; }
// returns colour + mask (0 = keep skin texture), writes fabric roughness / metalness
vec4 suitZone(out float rough, out float metal) {
  vec3 P = vRest, N = normalize(vRestN);
  float ax = abs(P.x), out_ = N.x * sign(P.x);
  float neckY = uL1.x, headY = uL1.y, chestY = uL1.z, hipY = uL1.w;
  float kneeY = uL2.x, ankY = uL2.y, shX = uL2.z, elbX = uL2.w;
  float wrX = uL3.x, legX = uL3.y, headZ = uL3.z, thZ = uL3.w;
  vec3 seam = uSec * 0.45;
  vec3 C = uPrim; float k = 1.0; rough = 0.8; metal = 0.02;
  bool arm = ax > shX - 0.025 && P.y > chestY - 0.03;
  if (!arm && P.y > neckY + 0.035) {
    k = 0.0;
    if (uF.y == 1.0 && P.y < headY + 0.075 && P.z > headZ + 0.005) { k = 1.0; C = uMask; rough = 0.55; }
    if (uF.y == 2.0 && !(P.z > headZ + 0.05 && P.y > headY + 0.055 && P.y < headY + 0.125)) { k = 1.0; C = uMask; rough = 0.92; }
  } else if (!arm && P.y > neckY - 0.065) {
    C = uSec * (0.88 + 0.12 * step(0.5, fract(P.y * 140.0))); rough = 0.85;       // ribbed collar
    if (abs(P.y - (neckY - 0.065)) < 0.004) C = seam;
  } else if (arm) {
    float u = ax;
    if (u > wrX - 0.015) { C = uGlove; rough = 0.5; if (bit(uF.w, 2.0) && u > wrX + 0.075) k = 0.0; }
    else {
      bool sleeve = uF.x == 0.0 || (uF.x == 1.0 && u < shX + 0.13);
      if (!sleeve) k = 0.0;
      C = u < shX + 0.07 ? uPrim : uSec;                                            // shoulder cap
      if (abs(u - (shX + 0.07)) < 0.004) C = seam;
      if (uF.x == 1.0 && abs(u - (shX + 0.125)) < 0.008) C = uTert;                  // short-sleeve hem
      if (abs(u - (wrX - 0.035)) < 0.006) C = uTert;                                // cuff
      if (bit(uF.z, 1.0) && N.y > 0.72 && u > shX + 0.07 && u < wrX - 0.045) C = uAcc;
    }
  } else if (P.y > hipY + 0.035) {
    C = mix(uPrim, uTert, smoothstep(0.55, 0.8, abs(N.x)));                        // side panels
    float yoke = chestY + 0.115;
    if (P.y > yoke) C = uSec;
    if (abs(P.y - yoke) < 0.0045) C = seam;
    if (bit(uF.w, 4.0) && P.y > chestY && ax > shX - 0.08) k = 0.0;               // tank top
    if (ax < 0.0035 && N.z > 0.3) C = seam;                                       // front zip
    if (bit(uF.z, 4.0) && N.z > 0.35 && abs(P.y - (chestY + 0.06)) < 0.016) C = uAcc;
    if (abs(P.y - (chestY - 0.1)) < 0.004 && N.z > 0.0) C = seam;                 // under-chest seam
  } else if (P.y > ankY + 0.1) {
    C = uSec; rough = 0.84;
    float lx = ax - legX;
    if (bit(uF.w, 1.0) && out_ > 0.55 && P.y > kneeY + 0.1 && P.y < kneeY + 0.27) C = uTert;   // cargo pocket
    if (bit(uF.w, 1.0) && out_ > 0.55 && (abs(P.y - (kneeY + 0.27)) < 0.004 || abs(P.y - (kneeY + 0.24)) < 0.003)) C = seam;
    if (bit(uF.z, 2.0) && out_ > 0.82 && abs(P.z - thZ) < 0.013 && P.y > kneeY - 0.3) C = uAcc;
    if (abs(P.y - kneeY) < 0.075 && N.z > 0.45) C = mix(C, uTert, 0.85);         // knee reinforcement
    if (abs(P.y - (hipY + 0.035)) < 0.005) C = seam;                             // waistband
    if (P.y > hipY - 0.1 && ax < 0.004) C = seam;                                // fly / inseam
  } else { C = uBoot; rough = 0.5; }
  return vec4(C, k);
}
`;

const suitMatCache = new Map();
export function suitMaterial(base, spec, S) {
  const key = base.uuid + '|' + JSON.stringify(spec);
  if (suitMatCache.has(key)) return suitMatCache.get(key);
  const m = base.clone();
  m.name = base.name + '_suit';
  const c = (v, d) => new THREE.Color(v || d);
  const U = {
    uSkin: { value: c(spec.skin, '#ffffff') }, uPrim: { value: c(spec.primary, '#555') }, uSec: { value: c(spec.secondary, '#24272c') },
    uTert: { value: c(spec.tertiary || spec.secondary, '#33363c') }, uAcc: { value: c(spec.stripe || spec.primary) }, uGlove: { value: c(spec.glove, '#1a1b1e') },
    uBoot: { value: c(spec.boot, '#1c1d20') }, uMask: { value: c(spec.maskColor, '#15171a') },
    uL1: { value: new THREE.Vector4(S.neck.y, S.head.y, S.chest.y, S.pelvis.y) },
    uL2: { value: new THREE.Vector4(S.knee.y, S.ankle.y, S.shoulder.x, S.elbow.x) },
    uL3: { value: new THREE.Vector4(S.wrist.x, S.thigh.x, S.head.z, S.thigh.z) },
    uF: { value: FLAG(spec) },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aRest, aRestN;\nvarying vec3 vRest, vRestN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = aRest; vRestN = aRestN;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + SUIT_GLSL)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float suitRough, suitMetal;
        vec4 suit = suitZone(suitRough, suitMetal);
        {
          // fabric: fine weave + faint large-scale wear so flat colours read as cloth
          vec3 rp = vRest * 1100.0;
          float weave = 0.5 + 0.5 * sin(rp.x + rp.z + sin(rp.y * 0.5)) * sin(rp.y + sin((rp.x - rp.z) * 0.5));
          float wear = fract(sin(dot(floor(vRest * 22.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          vec3 cloth = suit.rgb * (0.94 + 0.06 * weave) * (0.97 + 0.05 * wear);
          diffuseColor.rgb = mix(diffuseColor.rgb * uSkin, cloth, suit.a);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, suitRough, suit.a);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, suitMetal, suit.a);')
      .replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * (1.0 - 0.88 * suit.a);');
  };
  m.customProgramCacheKey = () => 'suit2';
  suitMatCache.set(key, m);
  return m;
}

// The same suit with everything but the arms discarded (first-person arms, fparms.js)
const fpCache = new Map();
export function fpSuitMaterial(base) {
  if (fpCache.has(base)) return fpCache.get(base);
  const m = base.clone();
  m.onBeforeCompile = (sh, r) => {
    base.onBeforeCompile(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('vec4 suit = suitZone(suitRough, suitMetal);', 'if (!fpArm()) discard;\n        vec4 suit = suitZone(suitRough, suitMetal);');
  };
  m.customProgramCacheKey = () => 'suitfp';
  fpCache.set(base, m);
  return m;
}

// --- 2. gear -------------------------------------------------------------------------------------
function rbox(w, h, d, r = 0.02, seg = 2) { return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2.1, h / 2.1, d / 2.1)); }

// place `mesh` at a rest-pose world position/rotation, parented to `bone`
function pin(bone, mesh, pos, euler) {
  bone.updateMatrixWorld(true);
  const wq = bone.getWorldQuaternion(new THREE.Quaternion());
  const want = euler ? new THREE.Quaternion().setFromEuler(euler) : new THREE.Quaternion();
  mesh.position.copy(bone.worldToLocal(pos.clone()));
  mesh.quaternion.copy(wq.invert().multiply(want));
  // bones may be scaled (cm rigs): undo it so pieces keep their metric size
  const ws = bone.getWorldScale(new THREE.Vector3());
  mesh.scale.set(1 / ws.x, 1 / ws.y, 1 / ws.z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.gear = true;
  bone.add(mesh);
  return mesh;
}
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const E = (x, y, z) => new THREE.Euler(x, y, z);

function addGear(S, V, M, list) {
  const B = S.bones;
  const chestS = slab(V, S.chest.y - 0.04, S.chest.y + 0.04, -S.shoulder.x + 0.05, S.shoulder.x - 0.05);
  const waistS = slab(V, S.pelvis.y + 0.03, S.pelvis.y + 0.1, -S.shoulder.x + 0.04, S.shoulder.x - 0.04);
  const thighS = slab(V, S.knee.y + 0.22, S.knee.y + 0.28, 0.02, S.shoulder.x);
  const shinS = slab(V, S.knee.y - 0.02, S.knee.y + 0.02, 0.02, S.shoulder.x);
  const headS = slab(V, S.head.y + 0.06, S.head.y + 0.14, -0.2, 0.2);
  const armS = slab(V, S.shoulder.y - 0.1, S.shoulder.y + 0.1, S.shoulder.x + 0.05, S.shoulder.x + 0.09);
  const fore = slab(V, S.wrist.y - 0.08, S.wrist.y + 0.08, S.wrist.x - 0.12, S.wrist.x - 0.06);
  const front = chestS.z1, back = chestS.z0, cy = S.chest.y;
  const sides = [1, -1];
  const g = (name, mat) => { const m = new THREE.Mesh(name, mat); return m; };
  for (const item of list) {
    const [kind, opt = {}] = Array.isArray(item) ? item : [item];
    if (kind === 'plates') {
      // plate carrier: front + back plates, shoulder straps, cummerbund, pouches
      const w = chestS.w * (opt.w || 0.78), h = opt.h || 0.3, t = opt.t || 0.045;
      const fy = cy - 0.02;
      pin(B.spine_03, g(rbox(w, h, t, 0.025), M[opt.mat || 'armor']), V3(0, fy, front + t / 2 - 0.01), E(-0.08, 0, 0));
      pin(B.spine_03, g(rbox(w * 1.02, h * 1.05, t, 0.025), M[opt.mat || 'armor']), V3(0, fy + 0.01, back - t / 2 + 0.012), E(0.06, 0, 0));
      const cb = slab(V, cy - 0.2, cy - 0.14, -S.shoulder.x + 0.03, S.shoulder.x - 0.03);
      pin(B.spine_02, g(rbox(cb.w + 0.02, 0.1, cb.d + 0.02, 0.035, 3), M.webbing), V3(0, cy - 0.17, cb.cz), null);
      for (const s of sides) pin(B.spine_03, g(rbox(0.055, 0.03, chestS.d * 0.95, 0.012), M.webbing), V3(s * w * 0.32, cy + h / 2 + 0.035, chestS.cz), E(0, 0, s * 0.12));
      const np = opt.pouches ?? 3;
      for (let i = 0; i < np; i++) {
        const px = (i - (np - 1) / 2) * (w / np);
        pin(B.spine_03, g(rbox(w / np - 0.012, 0.11, 0.05, 0.012), M[opt.pouch || 'polymer']), V3(px, fy - h / 2 + 0.07, front + t + 0.012), E(-0.08, 0, 0));
      }
      if (opt.glow) pin(B.spine_03, g(rbox(w * 0.5, 0.012, 0.01, 0.004), M.glow), V3(0, fy + h / 2 - 0.035, front + t + 0.002), E(-0.08, 0, 0));
    } else if (kind === 'chestplate') {
      // heavy one-piece breastplate wrapping the ribcage + abs plate
      const w = chestS.w * 1.08, d = chestS.d * 1.12;
      pin(B.spine_03, g(rbox(w, 0.3, d, 0.07, 3), M[opt.mat || 'armor']), V3(0, cy + 0.02, chestS.cz + 0.008), null);
      pin(B.spine_02, g(rbox(w * 0.82, 0.13, d * 0.95, 0.05, 3), M[opt.mat2 || 'polymer']), V3(0, cy - 0.17, chestS.cz + 0.005), null);
      if (opt.glow) for (const s of sides) pin(B.spine_03, g(rbox(0.012, 0.16, 0.012, 0.004), M.glow), V3(s * w * 0.3, cy + 0.02, chestS.cz + d / 2 + 0.002), null);
    } else if (kind === 'shoulders') {
      const big = opt.size || 1;
      for (const s of sides) {
        const side = s > 0 ? 'l' : 'r';
        const x = s * (S.shoulder.x + 0.05 * big);
        const m = g(rbox(0.15 * big, 0.06 * big, armS.d * 1.35 * big, 0.025 * big, 3), M[opt.mat || 'armor']);
        pin(B['upperarm_' + side], m, V3(x, S.shoulder.y + armS.d * 0.45 + 0.01 * big, armS.cz), E(0, 0, s * 0.35));
        if (opt.layers) pin(B['upperarm_' + side], g(rbox(0.12 * big, 0.04 * big, armS.d * 1.2 * big, 0.018, 2), M[opt.mat2 || 'accent']), V3(x + s * 0.05 * big, S.shoulder.y + armS.d * 0.3, armS.cz), E(0, 0, s * 0.7));
      }
    } else if (kind === 'belt') {
      const w = waistS.w * 1.06, d = waistS.d * 1.1;
      const ring = new THREE.CylinderGeometry(1, 1, 0.05, 28, 1, true);
      ring.scale(w / 2, 1, d / 2);
      const m = g(ring, M.webbing); m.material = M.webbing.clone(); m.material.side = THREE.DoubleSide;
      pin(B.pelvis, m, V3(0, S.pelvis.y + 0.06, waistS.cz), null);
      pin(B.pelvis, g(rbox(0.07, 0.05, 0.02, 0.008), M.metal), V3(0, S.pelvis.y + 0.06, waistS.cz + d / 2 + 0.005), null);
      for (const s of sides) for (const k of [0.55, 0.85]) {
        const a = k * Math.PI / 2;
        pin(B.pelvis, g(rbox(0.07, 0.085, 0.045, 0.012), M[opt.pouch || 'polymer']), V3(s * Math.sin(a) * w / 2 * 1.02, S.pelvis.y + 0.035, waistS.cz + Math.cos(a) * d / 2 * 1.05), E(0, s * a, 0));
      }
    } else if (kind === 'holster') {
      const s = opt.side === 'left' ? 1 : -1, side = s > 0 ? 'l' : 'r';
      pin(B['thigh_' + side], g(rbox(0.06, 0.2, thighS.d * 0.75, 0.02), M.polymer), V3(s * (Math.abs(thighS.cx) + thighS.w / 2 + 0.02), S.knee.y + 0.27, thighS.cz), E(0, 0, s * 0.05));
      pin(B['thigh_' + side], g(rbox(0.02, 0.03, thighS.d * 1.02, 0.008), M.webbing), V3(s * Math.abs(thighS.cx), S.knee.y + 0.22, thighS.cz), null);
    } else if (kind === 'kneepads') {
      for (const s of sides) {
        const side = s > 0 ? 'l' : 'r';
        pin(B['calf_' + side], g(rbox(shinS.w * 0.7, 0.12, 0.04, 0.02, 3), M[opt.mat || 'armor']), V3(s * Math.abs(shinS.cx || S.knee.x), S.knee.y + 0.01, shinS.z1 + 0.01), E(-0.15, 0, 0));
        if (opt.shin) pin(B['calf_' + side], g(rbox(shinS.w * 0.6, 0.22, 0.03, 0.015, 2), M[opt.mat || 'armor']), V3(s * Math.abs(S.knee.x), S.knee.y - 0.2, shinS.z1 - 0.005), E(0.06, 0, 0));
      }
    } else if (kind === 'elbowpads' || kind === 'bracers') {
      for (const s of sides) {
        const side = s > 0 ? 'l' : 'r';
        if (kind === 'elbowpads') pin(B['lowerarm_' + side], g(rbox(0.07, 0.07, 0.06, 0.02), M.armor), V3(s * (S.elbow.x + 0.02), S.elbow.y, S.elbow.z - 0.045), null);
        else {
          const c = new THREE.CylinderGeometry(fore.d * 0.62, fore.d * 0.55, 0.15, 14);
          c.rotateZ(Math.PI / 2);
          pin(B['lowerarm_' + side], g(c, M[opt.mat || 'armor']), V3(s * (S.wrist.x - 0.1), S.wrist.y, fore.cz), null);
          if (opt.glow) pin(B['lowerarm_' + side], g(rbox(0.09, 0.012, 0.012, 0.004), M.glow), V3(s * (S.wrist.x - 0.1), S.wrist.y + fore.d * 0.6, fore.cz), null);
        }
      }
    } else if (kind === 'helmet') {
      const r = Math.max(headS.w, headS.d) / 2 + 0.025;
      const shell = new THREE.SphereGeometry(r, 28, 18, 0, Math.PI * 2, 0, Math.PI * (opt.full ? 0.62 : 0.52));
      shell.scale(1, opt.tall || 1.0, 1.08);
      const hm = g(shell, M[opt.mat || 'armor']); hm.material = hm.material.clone(); hm.material.side = THREE.DoubleSide;
      const hy = S.head.y + 0.1;
      pin(B.head, hm, V3(0, hy, headS.cz - 0.01), E(-0.12, 0, 0));
      if (opt.visor) {
        const vg = new THREE.SphereGeometry(r * 1.01, 24, 8, Math.PI * 0.18, Math.PI * 0.64, Math.PI * 0.42, Math.PI * 0.2);
        const vm = g(vg, M.visor); vm.material = M.visor.clone(); vm.material.side = THREE.DoubleSide;
        pin(B.head, vm, V3(0, hy - 0.02, headS.cz - 0.005), E(-0.12, 0, 0));
      }
      if (opt.ears) for (const s of sides) { const e = new THREE.CylinderGeometry(0.04, 0.045, 0.035, 16); e.rotateZ(Math.PI / 2); pin(B.head, g(e, M.polymer), V3(s * (r - 0.005), S.head.y + 0.07, headS.cz), null); }
      if (opt.crest) pin(B.head, g(rbox(0.025, 0.035, r * 1.7, 0.01), M.accent), V3(0, hy + r * 0.96 * (opt.tall || 1), headS.cz - 0.02), E(-0.12, 0, 0));
    } else if (kind === 'goggles') {
      const r = headS.w / 2 + 0.008;
      const band = new THREE.CylinderGeometry(r, r, 0.035, 28, 1, true);
      band.scale(1, 1, (headS.d / headS.w) * 1.02);
      const bm = g(band, M.webbing); bm.material = M.webbing.clone(); bm.material.side = THREE.DoubleSide;
      pin(B.head, bm, V3(0, S.head.y + (opt.up ? 0.16 : 0.115), headS.cz), E(opt.up ? -0.25 : 0, 0, 0));
      for (const s of sides) {
        const lens = new THREE.CylinderGeometry(0.026, 0.028, 0.025, 18); lens.rotateX(Math.PI / 2);
        pin(B.head, g(lens, M.visor), V3(s * 0.035, S.head.y + (opt.up ? 0.18 : 0.115), headS.z1 + (opt.up ? -0.02 : 0.004)), E(opt.up ? -0.6 : 0, s * 0.18, 0));
      }
    } else if (kind === 'gasmask') {
      const fz = headS.z1;
      pin(B.head, g(rbox(0.11, 0.09, 0.07, 0.03, 3), M.polymer), V3(0, S.head.y + 0.035, fz - 0.005), E(0.2, 0, 0));
      for (const s of sides) {
        const f = new THREE.CylinderGeometry(0.03, 0.032, 0.05, 16); f.rotateX(Math.PI / 2);
        pin(B.head, g(f, M[opt.filter || 'accent']), V3(s * 0.055, S.head.y + 0.015, fz + 0.025), E(0.25, s * 0.5, 0));
      }
      const lens = rbox(0.13, 0.04, 0.02, 0.015);
      pin(B.head, g(lens, M.visor), V3(0, S.head.y + 0.115, fz + 0.003), null);
    } else if (kind === 'mask') {
      pin(B.head, g(rbox(0.12, 0.07, 0.05, 0.03, 3), M[opt.mat || 'polymer']), V3(0, S.head.y + 0.03, headS.z1 - 0.012), E(0.15, 0, 0));
      if (opt.glow) pin(B.head, g(rbox(0.08, 0.008, 0.008, 0.003), M.glow), V3(0, S.head.y + 0.035, headS.z1 + 0.015), E(0.15, 0, 0));
    } else if (kind === 'backpack') {
      const w = opt.w || 0.3, h = opt.h || 0.4, d = opt.d || 0.14;
      pin(B.spine_03, g(rbox(w, h, d, 0.04, 3), M[opt.mat || 'polymer']), V3(0, cy - 0.03, back - d / 2 + 0.01), null);
      if (opt.cross) { // medic cross, glowing
        pin(B.spine_03, g(rbox(0.11, 0.035, 0.01, 0.005), M.glow), V3(0, cy, back - d - 0.0), null);
        pin(B.spine_03, g(rbox(0.035, 0.11, 0.01, 0.005), M.glow), V3(0, cy, back - d - 0.0), null);
      }
      if (opt.antenna) { const a = new THREE.CylinderGeometry(0.005, 0.007, 0.45, 6); pin(B.spine_03, g(a, M.metal), V3(-w * 0.35, cy + h / 2 + 0.18, back - d / 2), E(0.15, 0, 0.08)); pin(B.spine_03, g(new THREE.SphereGeometry(0.012, 8, 6), M.glow), V3(-w * 0.35 - 0.018, cy + h / 2 + 0.4, back - d / 2 - 0.035), null); }
      if (opt.tanks) for (const s of sides) { const t = new THREE.CylinderGeometry(0.055, 0.055, h * 1.05, 16); pin(B.spine_03, g(t, M[opt.tankMat || 'accent']), V3(s * 0.08, cy - 0.02, back - d - 0.04), null); pin(B.spine_03, g(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 10), M.metal), V3(s * 0.08, cy + h / 2 + 0.03, back - d - 0.04), null); }
      if (opt.glow) pin(B.spine_03, g(rbox(w * 0.6, 0.015, 0.01, 0.005), M.glow), V3(0, cy + h / 2 - 0.05, back - d + 0.005), null);
    } else if (kind === 'jetpack') {
      const w = 0.32, h = 0.36, d = 0.12;
      pin(B.spine_03, g(rbox(w, h, d, 0.04, 3), M.armor), V3(0, cy - 0.02, back - d / 2 + 0.01), null);
      for (const s of sides) {
        const th = new THREE.CylinderGeometry(0.06, 0.07, 0.34, 18);
        pin(B.spine_03, g(th, M[opt.mat || 'accent']), V3(s * 0.12, cy - 0.06, back - d - 0.05), null);
        const noz = new THREE.CylinderGeometry(0.05, 0.075, 0.07, 18, 1, true);
        const nm = g(noz, M.metal); nm.material = M.metal.clone(); nm.material.side = THREE.DoubleSide;
        pin(B.spine_03, nm, V3(s * 0.12, cy - 0.26, back - d - 0.05), null);
        pin(B.spine_03, g(new THREE.CircleGeometry(0.048, 16).rotateX(Math.PI / 2), M.glow), V3(s * 0.12, cy - 0.235, back - d - 0.05), null);
        pin(B.spine_03, g(rbox(0.07, 0.04, 0.12, 0.015), M.polymer), V3(s * 0.21, cy + 0.12, back - d / 2), E(0, 0, s * 0.3));
      }
    } else if (kind === 'collar') {
      const t = new THREE.TorusGeometry(Math.max(0.065, headS.w * 0.42), 0.022, 10, 24);
      t.rotateX(Math.PI / 2);
      t.scale(1.1, 1, 1.05);
      pin(B.neck_01, g(t, M[opt.mat || 'armor']), V3(0, S.neck.y - 0.01, S.neck.z + 0.01), E(-0.15, 0, 0));
    } else if (kind === 'scarf') {
      const t = new THREE.TorusGeometry(0.085, 0.04, 10, 24); t.rotateX(Math.PI / 2); t.scale(1.15, 1, 1.1);
      const m = new THREE.MeshStandardMaterial({ color: opt.color || '#6b5a46', roughness: 0.95 });
      pin(B.neck_01, g(t, m), V3(0, S.neck.y - 0.02, S.neck.z + 0.015), E(-0.2, 0, 0));
      pin(B.spine_03, g(rbox(0.16, 0.22, 0.03, 0.01), m), V3(0.03, cy + 0.04, front + 0.01), E(-0.1, 0, -0.08));
    } else if (kind === 'boots') {
      // boot shells over the sculpted feet: sole + upper + toe cap + ankle cuff
      for (const sd of sides) {
        const side = sd > 0 ? 'l' : 'r';
        const fx = sd * Math.abs(S.ankle.x), toeZ = S.ball.z + 0.075, heelZ = S.ankle.z - 0.075, len = toeZ - heelZ, mz = (toeZ + heelZ) / 2;
        const foot = B['foot_' + side];
        pin(foot, g(rbox(0.105, 0.03, len + 0.01, 0.012), M.sole), V3(fx, 0.015, mz), null);
        pin(foot, g(rbox(0.1, 0.085, len * 0.72, 0.035, 3), M.boot), V3(fx, 0.06, heelZ + len * 0.36), null);
        pin(B['ball_' + side] || foot, g(rbox(0.098, 0.06, len * 0.4, 0.03, 3), M.boot), V3(fx, 0.045, toeZ - len * 0.2), null);
        const cuff = new THREE.CylinderGeometry(0.06, 0.068, 0.16, 16);
        pin(B['calf_' + side], g(cuff, M.boot), V3(fx, S.ankle.y + 0.05, S.ankle.z + 0.005), null);
        pin(B['calf_' + side], g(rbox(0.11, 0.022, 0.13, 0.008), M.webbing), V3(fx, S.ankle.y + 0.1, S.ankle.z + 0.005), null);
      }
    } else if (kind === 'canisters') {
      // grenade / gas canisters around the belt
      for (const s of sides) for (const k of [0.3, 0.6]) {
        const a = k * Math.PI / 2;
        const c = new THREE.CylinderGeometry(0.03, 0.03, 0.1, 12);
        pin(B.pelvis, g(c, M[opt.mat || 'accent']), V3(s * Math.sin(a) * waistS.w * 0.58, S.pelvis.y - 0.0, waistS.cz + Math.cos(a) * waistS.d * 0.6), null);
      }
    }
  }
}

// --- 3. hair -------------------------------------------------------------------------------------
export function attachSkinned(root, part, color) {
  const bones = {};
  root.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  const body = [];
  root.traverse((o) => { if (o.isSkinnedMesh) body.push(o); });
  const host = body[0] ? body[0].parent : root;
  const add = [];
  part.traverse((o) => { if (o.isSkinnedMesh) add.push(o); });
  for (const m of add) {
    const sk = m.skeleton;
    const nb = sk.bones.map((b) => bones[b.name]);
    if (nb.some((b) => !b)) continue;
    const mesh = new THREE.SkinnedMesh(m.geometry, m.material);
    mesh.name = m.name;
    if (color) { mesh.material = m.material.clone(); mesh.material.color.set(color); }
    mesh.position.copy(m.position); mesh.quaternion.copy(m.quaternion); mesh.scale.copy(m.scale);
    host.add(mesh);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(nb, sk.boneInverses.map((x) => x.clone())), m.bindMatrix.clone());
    mesh.castShadow = true;
    mesh.frustumCulled = false;
  }
}

// --- entry point ---------------------------------------------------------------------------------
export function dressCharacter(root, spec, parts = []) {
  const S = skeletonInfo(root);
  if (!S.pelvis || !S.chest || !S.head || !S.wrist || !S.knee) return false;
  let body = null;
  root.traverse((o) => { if (o.isSkinnedMesh && (!body || o.geometry.attributes.position.count > body.geometry.attributes.position.count)) body = o; });
  if (!body) return false;
  const V = restVerts(body);
  paintSuit(body, V, S, spec);
  // eyebrows follow the hair colour; eyes stay
  root.traverse((o) => { if (o.isSkinnedMesh && /eyebrow/i.test(o.name)) { o.material = o.material.clone(); o.material.color.set(spec.hairColor || '#2a1d14'); } });
  addGear(S, V, mats(spec), [...(spec.gear || []), ...(spec.boots === false ? [] : ['boots'])]);
  for (const p of parts) attachSkinned(root, p, spec.hairColor || '#2a1d14');
  return true;
}
