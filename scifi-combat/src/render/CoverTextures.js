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

function makeTexture(size, fn) {
  const data = new Uint8Array(size * size * 4);
  let sum = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = Math.max(0, Math.min(1, fn(x / size, y / size, x, y)));
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = Math.round(v * 255);
    data[i + 3] = 255;
    sum += v;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  tex.userData.mean = sum / (size * size);
  return tex;
}

/**
 * Courses of stuffed burlap bags, laid by hand: ~0.5 m long (each a little different), six
 * courses to the metre, each course offset at random, bulging between dark seams and lit from
 * above. (A perfectly regular stagger reads as brickwork.)
 */
export function sandbagTexture(size = 256) {
  const edge = (course, i) => i + (hash(course, i, 5) - 0.5) * 0.3;   // jittered seams between bags
  return makeTexture(size, (u, v, px, py) => {
    const course = Math.floor(v * 6), cy = v * 6 - course;
    const along = u * 2 + hash(course, 0, 2) * 2;
    let i = Math.floor(along), lo = edge(course, i), hi = edge(course, i + 1);
    if (along < lo) { i--; hi = lo; lo = edge(course, i); } else if (along > hi) { i++; lo = hi; hi = edge(course, i + 1); }
    const cx = (along - lo) / (hi - lo);
    // Round ends, a fat middle, squashed top and bottom where the courses press together.
    const sag = 0.08 * Math.sin(cx * Math.PI);                         // the middle bulges up a little
    const ey = Math.max(0, 1 - Math.abs((cy - sag) * 2 - 1) ** 1.7), ex = Math.max(0, 1 - Math.abs(cx * 2 - 1) ** 3.5);
    const pillow = Math.sqrt(ex * ey);
    const light = 0.82 + 0.3 * Math.min(1, Math.max(0, cy - 0.2));     // lit from above
    const tint = 0.86 + hash(course, i, 3) * 0.26;
    const weave = 0.05 * Math.sin(px * 2.3) * Math.sin(py * 2.3) + (hash(px, py, 9) - 0.5) * 0.09;
    const tie = cx < 0.07 || cx > 0.93 ? 0.8 : 1;
    const dirt = (fbm(u, v, 4, 5) - 0.5) * 0.18 - Math.max(0, 0.25 - v) * 0.4;   // muddier toward the bottom of the tile
    return (0.22 + 0.78 * pillow ** 0.8) * light * tint * tie + weave + dirt;
  });
}

/** Poured concrete: 0.5 m formwork lines, broad stains, pits. Tile = 4 m. */
export function concreteTexture(size = 256) {
  return makeTexture(size, (u, v, px, py) => {
    const stain = fbm(u, v, 4, 21) - 0.5, pit = hash(px, py, 4) > 0.985 ? -0.25 : 0;
    const line = Math.abs((v * 8) % 1 - 0.5) > 0.485 ? -0.12 : 0;
    const crack = Math.abs(fbm(u, v, 8, 33) - 0.5) < 0.012 ? -0.18 : 0;
    return 0.8 + stain * 0.35 + line + pit + crack + (hash(px, py, 7) - 0.5) * 0.06;
  });
}

/** Timber planks 0.2 m wide (5 per metre across the tile), grain along them. */
export function woodTexture(size = 256) {
  return makeTexture(size, (u, v, px, py) => {
    const plank = Math.floor(u * 5), pu = u * 5 - plank;
    const gap = pu < 0.04 ? 0.45 : 1;
    const grain = Math.sin((v * 40 + fbm(u, v, 4, plank + 50) * 6 + plank * 3.1) * Math.PI) * 0.06;
    const knot = fbm(u, v, 8, plank + 70) > 0.78 ? -0.15 : 0;
    return (0.78 + (hash(plank, 0, 11) - 0.5) * 0.18 + grain + knot) * gap + (hash(px, py, 13) - 0.5) * 0.05;
  });
}

/** Rock: craggy multi-octave noise with dark fissures. */
export function rockTexture(size = 256) {
  return makeTexture(size, (u, v) => {
    const n = fbm(u, v, 4, 61, 5), f = Math.abs(fbm(u, v, 6, 71) - 0.5) < 0.02 ? -0.2 : 0;
    return 0.55 + n * 0.55 + f;
  });
}

/** Steel panels 1 m wide with rivet lines and rust running down from them. */
export function metalTexture(size = 256) {
  return makeTexture(size, (u, v, px, py) => {
    const pu = (u * 4) % 1, seam = pu < 0.02 ? 0.55 : 1;
    const rivet = (pu > 0.05 && pu < 0.08) && Math.abs(((v * 16) % 1) - 0.5) < 0.12 ? 1.15 : 1;
    const rust = Math.max(0, fbm(u * 4, v, 2, 81) - 0.55) * (0.6 + 0.4 * Math.sin(u * 40)) * 0.6;
    return (0.82 + (fbm(u, v, 4, 91) - 0.5) * 0.2 - rust) * seam * rivet + (hash(px, py, 17) - 0.5) * 0.04;
  });
}

/**
 * Map `tex` onto `material` in world space: each fragment samples the texture on the two world
 * axes across its face (blended by the normal), `scale` tiles per metre. Works with instancing
 * (boxes scaled per instance keep real-size detail). The material colour is divided by the
 * texture's mean so the overall palette doesn't shift.
 */
export function triplanar(material, tex, scale) {
  material.color.multiplyScalar(1 / (tex.userData.mean || 1));
  material.onBeforeCompile = (shader) => {
    shader.uniforms.tpMap = { value: tex };
    shader.uniforms.tpScale = { value: scale };
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
      .replace('#include <common>', '#include <common>\nuniform sampler2D tpMap;\nuniform float tpScale;\nvarying vec3 vTpPos;\nvarying vec3 vTpNrm;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 tpB = pow(abs(vTpNrm), vec3(4.0));
        tpB /= (tpB.x + tpB.y + tpB.z + 1e-5);
        float tpC = texture2D(tpMap, vTpPos.zy * tpScale).r * tpB.x
                  + texture2D(tpMap, vTpPos.xz * tpScale).r * tpB.y
                  + texture2D(tpMap, vTpPos.xy * tpScale).r * tpB.z;
        diffuseColor.rgb *= tpC;`);
  };
  material.customProgramCacheKey = () => `tp:${tex.uuid}:${scale}`;
  return material;
}
