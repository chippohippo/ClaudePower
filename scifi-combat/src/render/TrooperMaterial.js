// TrooperMaterial: paint, wear and posing for the trooper kit (TrooperKit, ModelKit channels).
//
//  * Posing: each vertex follows one bone (aMat.w); the bone's matrix is read from a float
//    texture, row = the fighter's slot (iA.x), four texels per bone. Rigid skinning in the
//    vertex shader, so a whole crowd's armor is a handful of instanced draws. Limbs may
//    stretch along their bone; normals use the matching inverse scale.
//  * Paint by channel: the faction palette (data/art/palette.json `factions`) is a uniform
//    array, four factions by NCH channels (the two armies, the city's civilians, its gangs); the
//    instance picks its faction (iA.y). Per channel: roughness, metalness, whether it's painted
//    metal, and glow (visors, lamps). The city's people vary person to person: a civilian's
//    jacket, accent, neon and skin, a raider's gang colour, from small palettes (uVar) by the
//    stencil number (iA.z), which they never wear.
//  * Wear (painted channels): paint chipped to bare metal where the geometry says edge (aMat.y)
//    and the noise agrees, worn lighter round the chips, fine scratches. Dirt (aMat.z): ochre
//    dust climbing the boots, shins and cape hem. Seeded per trooper so no two are alike.
//  * Decals: a stencilled two-digit number (iA.z) and each faction's cape emblem, drawn from
//    aUv and cut out (discard) round the strokes.
//  * Hazard channel: diagonal stripes, armor color and black.
//  * Rim light (iR): a fresnel glow round the silhouette, per fighter: its faction's colour, or a
//    civilian's (CrowdRenderer picks it).
// The same bone and decal patches go into the shadow (depth) material. paintMaterial() is the
// same paint without the bones, for static models (vehicles, guns): faction, number, tint and
// glow are per-material uniforms.

import * as THREE from 'three';
import { CH, NCH } from './ModelKit.js';

/** Per channel: roughness, metalness, painted (1: chips to metal), glow (emissive strength). */
const SURF = {
  armor: [0.46, 0.12, 1, 0], shade: [0.5, 0.12, 1, 0], black: [0.52, 0.18, 1, 0], suit: [0.93, 0, 0, 0],
  gear: [0.88, 0, 0, 0], webbing: [0.9, 0, 0, 0], metal: [0.36, 0.85, 0, 0], stencil: [0.6, 0, 0, 0],
  hazard: [0.5, 0.12, 1, 0], glass: [0.07, 0.35, 0, 0], visor: [0.3, 0, 0, 2.6], cape: [0.96, 0, 0, 0],
  trim: [0.8, 0, 0, 0], lamp: [0.3, 0, 0, 5], rubber: [0.95, 0, 0, 0], white: [0.72, 0, 0, 0],
  number: [0.62, 0, 0, 0], emblem: [0.8, 0, 0, 0], skin: [0.62, 0, 0, 0],
};

/**
 * The city's people when a palette doesn't have them (palette.json factions.civilian and
 * .bandit are the authored ones): street clothes, faces; per-person jackets, accents, skin
 * tones and neon; each gang's colour.
 */
export const PEOPLE = {
  civilian: {
    armor: '#565a63', armorShade: '#3e4148', black: '#1c1d21', suit: '#4b4f58', gear: '#2f3036', webbing: '#2a2a2e', stencil: '#d8d4cc', stripe: '#151517',
    cape: '#6b5a4a', capeTrim: '#8a7a6a', visor: '#5ff3ff', visorGlass: '#0e1418', lamp: '#7af7ff', metal: '#5c6068', skin: '#c08f72',
    jackets: ['#4b4f58', '#5d3b3a', '#3b4d46', '#5c5338', '#353a4f', '#6a6159', '#2b2d33', '#5b4560'],
    accents: ['#8a6f5a', '#3f5f6f', '#6d3f4f', '#9a8f6a'], skins: ['#e0b49a', '#c08f72', '#8d5f45', '#5e3d2c'], neon: ['#5ff3ff', '#ff4fd8', '#ffb347', '#9dff6a'],
  },
  bandit: {
    armor: '#6b5444', armorShade: '#4a3a30', black: '#18181b', suit: '#2c2a2e', gear: '#3a352f', webbing: '#2b2722', stencil: '#e8e2d4', stripe: '#121214',
    cape: '#c43c2a', capeTrim: '#e0a030', visor: '#ff5a2a', visorGlass: '#14100e', lamp: '#ff7a4a', metal: '#4a4c50', skin: '#b0826a',
    gangs: ['#ff4a2a', '#9dff3a', '#3ad8ff', '#ff3ad2', '#ffd23a', '#7a5cff', '#3affb0', '#ff8a2a'],
  },
};
/** The factions' order: the team number picks one (Teams.js). */
export const FACTIONS = ['solari', 'void', 'civilian', 'bandit'];
const NVAR = 28;   // uVar: 8 jackets, 4 accents, 8 gang colours, 4 skin tones, 4 neons

/** Channel colors for one faction (palette.json factions.*, plus shared materials). */
function factionColors(f, materials) {
  const by = {
    armor: f.armor, shade: f.armorShade, black: f.black, suit: f.suit, gear: f.gear, webbing: f.webbing,
    metal: f.metal, stencil: f.stencil, hazard: f.stripe, glass: f.visorGlass, visor: f.visor, cape: f.cape,
    trim: f.capeTrim, lamp: f.lamp, rubber: materials?.rubber ?? '#151515', white: '#d8d3c6', number: f.stencil, emblem: f.capeTrim,
    skin: f.skin ?? '#c08f72',
  };
  const out = new Array(NCH);
  for (const [k, i] of Object.entries(CH)) out[i] = new THREE.Color(by[k] ?? '#ff00ff');
  return out;
}

/** The palette's colours for factions `keys` (the people's defaults where it has none). */
function palColors(palette, keys) {
  const pal = [];
  for (const k of keys) pal.push(...factionColors(palette.factions?.[k] ?? PEOPLE[k] ?? palette.factions.solari, palette.materials));
  return pal;
}

/** The people's variety (uVar): jackets, accents, gang colours, skin tones, neons. */
function variety(palette) {
  const C = { ...PEOPLE.civilian, ...(palette.factions?.civilian ?? {}) }, B = { ...PEOPLE.bandit, ...(palette.factions?.bandit ?? {}) };
  const take = (list, n) => Array.from({ length: n }, (_, i) => new THREE.Color(list[i % list.length]));
  return [...take(C.jackets, 8), ...take(C.accents, 4), ...take(B.gangs, 8), ...take(C.skins, 4), ...take(C.neon, 4)];
}

const VERT_COMMON = `
attribute vec4 aMat;
attribute vec2 aUv;
attribute vec4 iA;      // slot, faction, number, tint
attribute vec3 iE;      // status glow
attribute vec4 iR;      // rim light: colour (times strength), sharpness
uniform highp sampler2D uBones;
varying vec4 vMat;
varying vec3 vLocal;
varying vec2 vDecal;
varying vec4 vI;
varying vec3 vE;
varying vec4 vR;
mat4 tkBone() {
  int x = int(aMat.w + 0.5) * 4, y = int(iA.x + 0.5);
  return mat4(texelFetch(uBones, ivec2(x, y), 0), texelFetch(uBones, ivec2(x + 1, y), 0),
              texelFetch(uBones, ivec2(x + 2, y), 0), texelFetch(uBones, ivec2(x + 3, y), 0));
}`;

const VARYINGS = `vMat = aMat; vLocal = position + vec3(iA.z * 0.731, iA.z * 0.377, 0.0); vDecal = aUv; vI = iA; vE = iE; vR = iR;`;

const fragCommon = (nf) => `
uniform vec3 uPal[${NCH * nf}];
uniform vec4 uSurf[${NCH}];
uniform vec3 uVar[${NVAR}];
uniform vec3 uBare, uDust;
varying vec4 vMat;
varying vec3 vLocal;
varying vec2 vDecal;
varying vec4 vI;
varying vec3 vE;
varying vec4 vR;
float tkH(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float tkN(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(tkH(i), tkH(i + vec3(1, 0, 0)), f.x), mix(tkH(i + vec3(0, 1, 0)), tkH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(tkH(i + vec3(0, 0, 1)), tkH(i + vec3(1, 0, 1)), f.x), mix(tkH(i + vec3(0, 1, 1)), tkH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float tkSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return step(length(pa - ba * h), 0.085); }
// A stencil-cut seven-segment digit in a unit cell (gaps at the joints are the stencil's bridges).
float tkDigit(vec2 p, int d) {
  int bits = d == 0 ? 63 : d == 1 ? 6 : d == 2 ? 91 : d == 3 ? 79 : d == 4 ? 102 : d == 5 ? 109 : d == 6 ? 125 : d == 7 ? 7 : d == 8 ? 127 : 111;
  p = (p - 0.5) * vec2(1.3, 1.05) + 0.5;
  float g = 0.07, m = 0.0;
  if ((bits & 1) != 0) m = max(m, tkSeg(p, vec2(0.25 + g, 0.86), vec2(0.75 - g, 0.86)));
  if ((bits & 2) != 0) m = max(m, tkSeg(p, vec2(0.75, 0.86 - g), vec2(0.75, 0.5 + g)));
  if ((bits & 4) != 0) m = max(m, tkSeg(p, vec2(0.75, 0.5 - g), vec2(0.75, 0.14 + g)));
  if ((bits & 8) != 0) m = max(m, tkSeg(p, vec2(0.25 + g, 0.14), vec2(0.75 - g, 0.14)));
  if ((bits & 16) != 0) m = max(m, tkSeg(p, vec2(0.25, 0.5 - g), vec2(0.25, 0.14 + g)));
  if ((bits & 32) != 0) m = max(m, tkSeg(p, vec2(0.25, 0.86 - g), vec2(0.25, 0.5 + g)));
  if ((bits & 64) != 0) m = max(m, tkSeg(p, vec2(0.25 + g, 0.5), vec2(0.75 - g, 0.5)));
  return m;
}
// Cape emblems: Solari, a sun over a chevron; Void, a ring split by a gap round a core.
float tkEmblem(vec2 p, int team) {
  vec2 c = p - 0.5;
  if (team == 0) {
    vec2 s = c - vec2(0.0, 0.1);
    float sun = step(length(s), 0.15);
    float halo = step(abs(length(s) - 0.23), 0.028) * step(0.0, s.y + 0.03);
    float chev = step(abs(abs(c.x) * 0.85 - (c.y + 0.36)), 0.055) * step(abs(c.x), 0.34) * step(c.y, -0.08);
    return max(max(sun, halo), chev);
  }
  float r = length(c);
  return max(step(abs(r - 0.3), 0.065) * step(0.06, abs(c.x + c.y * 0.35)), step(r, 0.09));
}`;

const COLOR = `
int tkCh = int(vMat.x + 0.5), tkTeam = int(vI.y + 0.5), tkNum = int(vI.z + 0.5);
vec3 tkCol = uPal[tkTeam * ${NCH} + tkCh];
if (tkTeam == 2) {            // a civilian: his own jacket, accent, neon and skin
  if (tkCh == ${CH.suit}) tkCol = uVar[tkNum % 8];
  else if (tkCh == ${CH.cape} || tkCh == ${CH.trim}) tkCol = uVar[8 + (tkNum / 8) % 4];
  else if (tkCh == ${CH.visor} || tkCh == ${CH.lamp}) tkCol = uVar[24 + (tkNum / 3) % 4];
  else if (tkCh == ${CH.skin}) tkCol = uVar[20 + (tkNum / 5) % 4];
} else if (tkTeam == 3) {     // a raider: his gang's colour on his crest, goggles and rags (number: gang * 10 + him)
  if (tkCh == ${CH.cape} || tkCh == ${CH.trim} || tkCh == ${CH.visor} || tkCh == ${CH.lamp}) tkCol = uVar[12 + (tkNum / 10) % 8];
  else if (tkCh == ${CH.skin}) tkCol = uVar[20 + tkNum % 4];
}
vec4 tkS = uSurf[tkCh];
float tkRough = tkS.x, tkMetal = tkS.y;
vec3 tkGlow = vec3(0.0);
if (tkCh == ${CH.hazard}) tkCol = mix(uPal[tkTeam * ${NCH} + ${CH.armor}], tkCol, step(0.5, fract((vLocal.x + vLocal.y - vLocal.z) * 14.0)));
if (tkCh == ${CH.number}) {
  int num = int(vI.z + 0.5);
  float m = vDecal.x < 0.5 ? tkDigit(vec2(vDecal.x * 2.0, vDecal.y), (num / 10) % 10) : tkDigit(vec2(vDecal.x * 2.0 - 1.0, vDecal.y), num % 10);
  if (m < 0.5) discard;
}
if (tkCh == ${CH.emblem} && tkEmblem(vDecal, tkTeam) < 0.5) discard;
// Paint wear: chips to bare metal on edges, lighter worn paint round them, scratches.
if (tkS.z > 0.5) {
  // Only edges chip (aMat.y), in patches; flat paint just wears a little lighter.
  float n = tkN(vLocal * 60.0) * 0.6 + tkN(vLocal * 160.0) * 0.4;
  float w = vMat.y * 0.62 + n * 0.45;
  float chip = smoothstep(0.8, 0.84, w);
  float scr = step(abs(fract(dot(vLocal, vec3(23.0, 41.0, 13.0)) + tkN(vLocal * 7.0) * 3.0) - 0.5), 0.01) * step(0.8, tkN(vLocal * 13.0 + 3.1));
  tkCol *= 1.0 + 0.1 * smoothstep(0.55, 0.8, w) * (1.0 - chip) - 0.06 * (tkN(vLocal * 9.0) - 0.5);
  tkCol = mix(tkCol, uBare, max(chip, scr * 0.6));
  tkRough = mix(tkRough, 0.42, chip); tkMetal = mix(tkMetal, 0.7, chip);
} else if (tkS.y < 0.5 && tkS.w == 0.0 && tkCh != ${CH.glass}) {
  tkCol *= 0.88 + 0.24 * tkN(vLocal * 55.0);                        // cloth and rubber: a little weave
}
// Dust climbing from the ground.
float tkD = clamp(vMat.z * (0.7 + 0.35 * tkN(vLocal * 7.0)) - 0.15 + (tkN(vLocal * 45.0) - 0.5) * 0.12, 0.0, 1.0);
tkCol = mix(tkCol, uDust, tkD * 0.7);
tkRough = mix(tkRough, 1.0, tkD); tkMetal = mix(tkMetal, 0.0, tkD);
if (tkS.w > 0.0) { tkGlow = tkCol * tkS.w; tkCol *= 0.25; }
diffuseColor.rgb = tkCol * vI.w;`;

const DEPTH_DECALS = `
#include <clipping_planes_fragment>
int tkCh = int(vMat.x + 0.5);
if (tkCh == ${CH.number} || tkCh == ${CH.emblem}) discard;`;

/**
 * @param {object} palette  palette.json (factions in FACTIONS order = team 0..3)
 * @param {THREE.DataTexture} bones
 * @returns {{ material, depth }}
 */
export function trooperMaterials(palette, bones, factionKeys = FACTIONS) {
  const pal = palColors(palette, factionKeys);
  const surf = Object.entries(CH).sort((a, b) => a[1] - b[1]).map(([k]) => new THREE.Vector4(...SURF[k]));
  const uniforms = {
    uBones: { value: bones }, uPal: { value: pal }, uSurf: { value: surf }, uVar: { value: variety(palette) },
    uBare: { value: new THREE.Color('#b3aea4') }, uDust: { value: new THREE.Color(palette.vfx?.dust ?? '#b9976a').multiplyScalar(0.9) },
  };
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_COMMON}`)
      .replace('#include <beginnormal_vertex>', `mat4 bM = tkBone();
        vec3 bS2 = vec3(dot(bM[0].xyz, bM[0].xyz), dot(bM[1].xyz, bM[1].xyz), dot(bM[2].xyz, bM[2].xyz));
        vec3 objectNormal = normalize(mat3(bM) * (normal / bS2));`)
      .replace('#include <begin_vertex>', `vec3 transformed = (bM * vec4(position, 1.0)).xyz;\n${VARYINGS}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${fragCommon(factionKeys.length)}`)
      .replace('#include <color_fragment>', COLOR)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tkRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = tkMetal;')
      // The rim: a fresnel glow round the silhouette in the fighter's colour (faction, or a civilian's).
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += tkGlow + vE + vR.rgb * pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), vR.w);');
  };
  material.customProgramCacheKey = () => `trooper${factionKeys.length}`;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (shader) => {
    shader.uniforms.uBones = uniforms.uBones;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_COMMON}`)
      .replace('#include <begin_vertex>', `mat4 bM = tkBone();\nvec3 transformed = (bM * vec4(position, 1.0)).xyz;\n${VARYINGS}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vMat;')
      .replace('#include <clipping_planes_fragment>', DEPTH_DECALS);
  };
  depth.customProgramCacheKey = () => 'trooper-depth';
  return { material, depth, uniforms };
}

const STATIC_VERT_COMMON = `
attribute vec4 aMat;
attribute vec2 aUv;
uniform float uTeam, uNumber, uTint;
uniform vec3 uGlow;
varying vec4 vMat;
varying vec3 vLocal;
varying vec2 vDecal;
varying vec4 vI;
varying vec3 vE;
varying vec4 vR;`;

/**
 * The trooper paint for a static model (a vehicle): one material per model, so its own damage
 * tint (uTint), status glow (uGlow) and number. The program is shared by all of them.
 * @returns {THREE.MeshStandardMaterial} with .paint = { team, number, tint, glow } uniforms
 */
export function paintMaterial(palette, { team = 0, number = 0, factionKeys = ['solari', 'void'] } = {}) {
  const shared = (paintMaterial.cache ??= new Map());
  const key = factionKeys.join();
  if (!shared.has(key)) {
    shared.set(key, {
      uPal: { value: palColors(palette, factionKeys) }, uSurf: { value: Object.entries(CH).sort((a, b) => a[1] - b[1]).map(([k]) => new THREE.Vector4(...SURF[k])) }, uVar: { value: variety(palette) },
      uBare: { value: new THREE.Color('#b3aea4') }, uDust: { value: new THREE.Color(palette.vfx?.dust ?? '#b9976a').multiplyScalar(0.9) },
    });
  }
  const paint = { uTeam: { value: team }, uNumber: { value: number }, uTint: { value: 1 }, uGlow: { value: new THREE.Color(0, 0, 0) } };
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared.get(key), paint);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${STATIC_VERT_COMMON}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat; vLocal = position + vec3(uNumber * 0.731, uNumber * 0.377, 0.0); vDecal = aUv; vI = vec4(0.0, uTeam, uNumber, uTint); vE = uGlow; vR = vec4(0.0);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${fragCommon(factionKeys.length)}`)
      .replace('#include <color_fragment>', COLOR)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tkRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = tkMetal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += tkGlow + vE;');
  };
  material.customProgramCacheKey = () => `paint-static${factionKeys.length}`;
  material.paint = paint;
  return material;
}
