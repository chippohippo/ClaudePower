// CoverTextures: procedural, tileable surface detail for the battlefield's cover, mapped in world
// space (triplanar), so a 4 m wall and a 40 m parapet both show bags, blocks and planks at their
// real size, and instanced boxes need no UVs at all.
//  * sandbag: staggered rows of stuffed burlap bags (0.5 m long, 6 courses to the metre)
//  * concrete: cast panels with formwork lines, stains and pitting
//  * wood: planks with grain and dark gaps
//  * rock: craggy noise
//  * metal: riveted panels with rust streaks
// All are DataTextures (no canvas, deterministic), grayscale multipliers centred on 1 after the
// material colour is divided by the texture's mean (so the palette stays as designed).

import * as THREE from 'three';
import { normalMap } from './ArtTextures.js';

const hash = (i, j, s) => {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** Periodic value noise in [0, 1) with `period` cells across the tile. */
const vnoise = (u, v, period, s) => {
  const x = u * period, y = v * period, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const at = (a, b) => hash(((a % period) + period) % period, ((b % period) + period) % period, s);
  const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
};
const fbm = (u, v, base, s, oct = 4) => { let n = 0, w = 0.5, t = 0; for (let k = 0; k < oct; k++) { n += vnoise(u, v, base << k, s + k * 17) * w; t += w; w *= 0.5; } return n / t; };

function makeTexture(size, fn, tile = 0) {
  const data = new Uint8Array(size * size * 4), H = tile ? new Float32Array(size * size) : null;
  let sum = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = fn(x / size, y / size, x, y), a = typeof r === 'number' ? r : r[0];
    const v = Math.max(0, Math.min(1, a));
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = Math.round(v * 255);
    data[i + 3] = 255;
    if (H) H[y * size + x] = typeof r === 'number' ? 0 : r[1];
    sum += v;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  tex.userData.mean = sum / (size * size);
  if (H) tex.userData.normal = normalMap(H, size, tile);
  return tex;
}

/**
 * Courses of stuffed burlap bags, laid by hand: ~0.5 m long (each a little different), six
 * courses to the metre, each course offset at random, bulging between dark seams. (A perfectly
 * regular stagger reads as brickwork.) Tile = 1 m; the height (the bulge, up to 7 cm) makes the
 * normal map, so the light shapes each bag.
 */
export function sandbagTexture(size = 512) {
  const edge = (course, i) => i + (hash(course, i, 5) - 0.5) * 0.3;   // jittered seams between bags
  return makeTexture(size, (u, v, px, py) => {
    const course = Math.floor(v * 6), cy = v * 6 - course;
    const along = u * 2 + hash(course, 0, 2) * 2;
    let i = Math.floor(along), lo = edge(course, i), hi = edge(course, i + 1);
    if (along < lo) { i--; hi = lo; lo = edge(course, i); } else if (along > hi) { i++; lo = hi; hi = edge(course, i + 1); }
    const cx = (along - lo) / (hi - lo);
    // Round ends, a fat middle, squashed top and bottom where the courses press together.
    const sag = 0.06 * Math.sin(cx * Math.PI) * (hash(course, i, 4) - 0.3);   // some bags slump
    const ey = Math.max(0, 1 - Math.abs((cy - sag) * 2 - 1) ** 2.4), ex = Math.max(0, 1 - Math.abs(cx * 2 - 1) ** 5);
    const pillow = Math.sqrt(ex * ey);
    const fold = (fbm(u, v, 16, 41, 3) - 0.5) * 0.012 * pillow;           // creases in the cloth
    const weave = 0.0008 * Math.sin(px * 1.6) * Math.sin(py * 1.6);
    const tint = 0.92 + hash(course, i, 3) * 0.16;
    const burlap = (fbm(u, v, 64, 9, 2) - 0.5) * 0.08;
    const tie = cx < 0.05 || cx > 0.95 ? 0.9 : 1;
    const dirt = (fbm(u, v, 4, 5) - 0.5) * 0.18 - Math.max(0, 0.25 - v) * 0.25;   // muddier toward the bottom of the tile
    const seam = 0.55 + 0.45 * Math.min(1, pillow * 2.2);                 // dark only deep in the crevices
    return [(0.95 * seam * tint * tie) + burlap + dirt, pillow ** 0.6 * 0.07 + fold + weave];
  }, 1);
}

/** Poured concrete: 0.5 m formwork lines, broad stains, pits. Tile = 4 m. */
export function concreteTexture(size = 512) {
  return makeTexture(size, (u, v, px, py) => {
    const stain = fbm(u, v, 4, 21) - 0.5, pitted = hash(px >> 1, py >> 1, 4) > 0.985;
    const lv = Math.abs((v * 8) % 1 - 0.5), line = lv > 0.488 ? 1 : 0;
    const ck = Math.abs(fbm(u, v, 8, 33) - 0.5), crack = ck < 0.01 ? 1 - ck / 0.01 : 0;
    const chip = Math.max(0, fbm(u, v, 16, 37, 3) - 0.68) * 3;            // spalled patches
    const albedo = 0.8 + stain * 0.35 - line * 0.1 - (pitted ? 0.2 : 0) - crack * 0.16 - chip * 0.08 + (fbm(u, v, 128, 7, 1) - 0.5) * 0.06;
    return [albedo, -line * 0.006 - (pitted ? 0.003 : 0) - crack * 0.004 - chip * 0.006 + (fbm(u, v, 32, 39, 2) - 0.5) * 0.002];
  }, 4);
}

/** Timber planks 0.2 m wide (5 per metre across the tile), grain along them. */
export function woodTexture(size = 256) {
  return makeTexture(size, (u, v, px, py) => {
    const plank = Math.floor(u * 5), pu = u * 5 - plank;
    const gap = pu < 0.04 ? 0.45 : 1;
    const g = Math.sin((v * 40 + fbm(u, v, 4, plank + 50) * 6 + plank * 3.1) * Math.PI), grain = g * 0.06;
    const knot = fbm(u, v, 8, plank + 70) > 0.78 ? -0.15 : 0;
    const edge = Math.min(1, Math.min(pu, 1 - pu) / 0.08);                // rounded, worn plank edges
    const albedo = (0.78 + (hash(plank, 0, 11) - 0.5) * 0.18 + grain + knot) * gap + (fbm(u, v, 64, 13, 1) - 0.5) * 0.05;
    return [albedo, (pu < 0.04 ? -0.012 : 0) + edge * 0.003 + g * 0.0006 + (hash(plank, 1, 15) - 0.5) * 0.004];
  }, 1 / 0.6);
}

/** Rock: craggy multi-octave noise with dark fissures. */
export function rockTexture(size = 256) {
  return makeTexture(size, (u, v) => {
    const n = fbm(u, v, 4, 61, 5), fk = Math.abs(fbm(u, v, 6, 71) - 0.5), f = fk < 0.02 ? 1 - fk / 0.02 : 0;
    return [0.55 + n * 0.55 - f * 0.2, (n - 0.5) * 0.08 - f * 0.02];
  }, 1 / 0.3);
}

/** Steel panels 1 m wide with rivet lines and rust running down from them. */
export function metalTexture(size = 512) {
  return makeTexture(size, (u, v, px, py) => {
    const pu = (u * 4) % 1, seam = pu < 0.02 ? 0.55 : 1;
    const rx = (pu - 0.065) / 0.018, ry = (((v * 16) % 1) - 0.5) / 0.28, rr = rx * rx + ry * ry;
    const rivet = rr < 1 ? Math.sqrt(1 - rr) : 0;
    const rust = Math.max(0, fbm(u * 4, v, 2, 81) - 0.55) * (0.6 + 0.4 * Math.sin(u * 40)) * 0.6;
    const dent = (fbm(u, v, 8, 93, 3) - 0.5) * 0.004;
    const albedo = (0.82 + (fbm(u, v, 4, 91) - 0.5) * 0.2 - rust) * seam * (1 + rivet * 0.15) + (fbm(u, v, 128, 17, 1) - 0.5) * 0.04;
    return [albedo, (pu < 0.02 ? -0.004 : 0) + rivet * 0.006 + dent];
  }, 4);
}

/**
 * Map `tex` onto `material` in world space: each fragment samples the texture on the two world
 * axes across its face (blended by the normal), `scale` tiles per metre. Works with instancing
 * (boxes scaled per instance keep real-size detail). The material colour is divided by the
 * texture's mean so the overall palette doesn't shift. `bump` > 0 also lights the texture's
 * relief (bag bulges, plank gaps, pits, rivets) from its normal map, fading out with distance.
 * Per projection axis the tangent normal swizzles into world space (a heightfield on a +X face is
 * x = height, so the map's (x, y) land on (z, y)); the face's sign never flips a bump into a dent.
 */
export function triplanar(material, tex, scale, bump = 0) {
  material.color.multiplyScalar(1 / (tex.userData.mean || 1));
  const nor = bump > 0 ? tex.userData.normal : null;
  if (nor) nor.anisotropy = tex.anisotropy;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.tpMap = { value: tex };
    shader.uniforms.tpNor = { value: nor };
    shader.uniforms.tpScale = { value: scale };
    shader.uniforms.tpBump = { value: bump };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTpPos;\nvarying vec3 vTpNrm;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 tpW = vec4(transformed, 1.0);
        vec3 tpN = objectNormal;
        #ifdef USE_INSTANCING
          tpW = instanceMatrix * tpW;
          tpN = mat3(instanceMatrix) * tpN;
        #endif
        tpW = modelMatrix * tpW;
        vTpPos = tpW.xyz;
        vTpNrm = normalize(mat3(modelMatrix) * tpN);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D tpMap, tpNor;\nuniform float tpScale, tpBump;\nvarying vec3 vTpPos;\nvarying vec3 vTpNrm;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 tpB = pow(abs(vTpNrm), vec3(4.0));
        tpB /= (tpB.x + tpB.y + tpB.z + 1e-5);
        float tpC = texture2D(tpMap, vTpPos.zy * tpScale).r * tpB.x
                  + texture2D(tpMap, vTpPos.xz * tpScale).r * tpB.y
                  + texture2D(tpMap, vTpPos.xy * tpScale).r * tpB.z;
        diffuseColor.rgb *= tpC;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        ${nor ? `{
          float tpNear = smoothstep(60.0, 8.0, length(vViewPosition)) * tpBump;
          if (tpNear > 0.0) {
            vec2 nX = texture2D(tpNor, vTpPos.zy * tpScale).xy * 2.0 - 1.0;
            vec2 nY = texture2D(tpNor, vTpPos.xz * tpScale).xy * 2.0 - 1.0;
            vec2 nZ = texture2D(tpNor, vTpPos.xy * tpScale).xy * 2.0 - 1.0;
            vec3 tpP = vec3(0.0, nX.y, nX.x) * tpB.x + vec3(nY.x, 0.0, nY.y) * tpB.y + vec3(nZ.x, nZ.y, 0.0) * tpB.z;
            vec3 tpWn = transpose(mat3(viewMatrix)) * normal;
            normal = normalize(mat3(viewMatrix) * normalize(tpWn + tpP * tpNear));
          }
        }` : ''}`);
  };
  material.customProgramCacheKey = () => `tp:${tex.uuid}:${scale}:${!!nor}`;
  return material;
}
