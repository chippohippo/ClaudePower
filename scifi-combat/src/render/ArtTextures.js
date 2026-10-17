// ArtTextures: procedural textures and material patches for the art direction
// (docs/ART_DIRECTION.md). Deterministic (seeded), generated once at load.
//  * groundDetailTexture: an 8 m tile of scorched ground: drifted dust, wind ripples where it lies
//    deep, stones of every size (pale tops, contact shadows), and dried-mud plates for the patches
//    where the dust blew away. An albedo map (R multiplier, its mean divided back out; G dust;
//    B cracks) and three normal maps (fine, macro, plates), filtered like any texture.
//  * groundMaterial: the terrain's material. Vertex colors (the macro palette: dust, earth, rock,
//    mud, scorch) times the detail at two scales, so tiling never shows; cracks only in patches
//    (a world-scale mask), relief from the normal map (the terrain is a heightfield: its tangent
//    frame comes from the normal, no tangents needed).
//  * normalMap: a tileable normal map from a height field (also the cover textures' relief).

import * as THREE from 'three';

const hash = (i, j, s) => {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const vnoise = (u, v, period, s) => {
  const x = u * period, y = v * period, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const at = (a, b) => hash(((a % period) + period) % period, ((b % period) + period) % period, s);
  const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
};
const fbm = (u, v, base, s, oct = 4) => { let n = 0, w = 0.5, t = 0; for (let k = 0; k < oct; k++) { n += vnoise(u, v, base << k, s + k * 17) * w; t += w; w *= 0.5; } return n / t; };

/** Periodic Voronoi: distances to the nearest and second-nearest feature point (cells per tile). */
function voronoi(u, v, cells, s) {
  const x = u * cells, y = v * cells, i = Math.floor(x), j = Math.floor(y);
  let d1 = 9, d2 = 9, id = 0;
  for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
    const ci = i + a, cj = j + b, wi = ((ci % cells) + cells) % cells, wj = ((cj % cells) + cells) % cells;
    const px = ci + hash(wi, wj, s), py = cj + hash(wi, wj, s + 1);
    const d = Math.hypot(px - x, py - y);
    if (d < d1) { d2 = d1; d1 = d; id = wi * 131 + wj; } else if (d < d2) d2 = d;
  }
  return { d1, d2, id };
}

function dataTexture(size, fn) {
  const data = new Uint8Array(size * size * 4);
  let sum = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [r, g, b = 0] = fn(x / size, y / size, x, y);
    const i = (y * size + x) * 4;
    data[i] = Math.round(Math.max(0, Math.min(1, r)) * 255);
    data[i + 1] = Math.round(Math.max(0, Math.min(1, g)) * 255);
    data[i + 2] = Math.round(Math.max(0, Math.min(1, b)) * 255);
    data[i + 3] = 255;
    sum += r;
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

/** Tileable normal map (RGBA8) from a height field in metres over a `tile`-metre tile. */
export function normalMap(H, size, tile) {
  const data = new Uint8Array(size * size * 4), px = tile / size;
  const h = (x, y) => H[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x - 1, y) - h(x - 1, y + 1)) / (8 * px);
    const dy = (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x, y - 1) - h(x + 1, y - 1)) / (8 * px);
    const l = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
    data[i] = Math.round((-dx / l * 0.5 + 0.5) * 255); data[i + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255); data[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255); data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}

/**
 * 8 m of scorched ground (see the file header): { map (R albedo, G dust, B cracks), normal (dust
 * drifts, wind ripples, stones), macro (the broad drifts and boulders only, for the ~46 m layer:
 * magnified ripples and pebbles read as corduroy and craters), crackNormal (dried-mud plates,
 * masked into patches by the shader) }.
 */
export function groundDetailTexture(size = 1024) {
  const H = new Float32Array(size * size), HM = new Float32Array(size * size), HC = new Float32Array(size * size);
  const stoneAt = (d, r) => (d < r ? (1 - (d / r) ** 2) ** 0.7 : 0);
  const shadeAt = (d, r) => (d >= r && d < r * 1.6 ? 1 - (d - r) / (r * 0.6) : 0);   // contact shadow round a stone
  const map = dataTexture(size, (u, v, px, py) => {
    // Drifted dust, with wind ripples only where it drifted deep (the wind blows along the front).
    const dust = fbm(u, v, 3, 31, 5), drift = fbm(u, v, 6, 41, 3), deep = fbm(u, v, 4, 53, 3);
    const rippleMask = Math.max(0, Math.min(1, (deep - 0.48) / 0.16)) * (0.6 + 0.4 * dust);
    const ripple = Math.sin((u * 0.94 + v * 0.34) * Math.PI * 2 * 46 + drift * 11) * rippleMask;
    // Stones: a few per square metre, any size, anywhere (a jittered grid, most cells empty), pale
    // and sun-bleached on top, sitting in a ring of their own shadow (that's what reads as a stone
    // and not a pit).
    const st = voronoi(u, v, 72, 21), sr = 0.22 * (0.35 + hash(st.id, 1, 23)), has = hash(st.id, 2, 29) > 0.82;
    const stone = has ? stoneAt(st.d1, sr) : 0, sAO = has ? shadeAt(st.d1, sr) : 0;
    const big = voronoi(u, v, 9, 61), br = 0.12 * (0.5 + hash(big.id, 3, 67)), hasB = hash(big.id, 4, 71) > 0.85;
    const boulder = hasB ? stoneAt(big.d1, br) : 0, bAO = hasB ? shadeAt(big.d1, br) : 0;
    // Dried-mud plates (only where the shader's patch mask lets them show): wobbly edges (the
    // lookup is warped), plates of 20-60 cm, the small cracks fainter.
    const wu = u + (fbm(u, v, 16, 83, 3) - 0.5) * 0.02, wv = v + (fbm(u, v, 16, 89, 3) - 0.5) * 0.02;
    const c1 = voronoi(wu, wv, 16, 3), c2 = voronoi(wu, wv, 36, 11);
    const crack = Math.max(Math.max(0, 1 - (c1.d2 - c1.d1) / 0.05), Math.max(0, 1 - (c2.d2 - c2.d1) / 0.04) * 0.4);
    const broad = (dust - 0.5) * 0.06 + boulder * 0.07;
    H[py * size + px] = broad + ripple * 0.0018 + stone * 0.02;
    HM[py * size + px] = broad;
    HC[py * size + px] = -crack * 0.005 + (hash(c1.id, 0, 7) - 0.5) * 0.0015;
    const albedo = 0.86 + (dust - 0.5) * 0.3 + ripple * 0.012 + stone * (0.06 + (hash(st.id, 5, 73) - 0.5) * 0.2) - sAO * 0.12
      + boulder * (0.02 + (hash(big.id, 6, 79) - 0.5) * 0.12) - bAO * 0.14 + (hash(px, py, 9) - 0.5) * 0.02;
    return [albedo, dust, crack];
  });
  return { map, normal: normalMap(H, size, 8), macro: normalMap(HM, size, 8), crackNormal: normalMap(HC, size, 8) };
}

/**
 * The terrain material: vertex colors times the detail texture at two scales (uv is metres / 6
 * from TerrainChunks), cracks in patches, relief from the normal map.
 * @param {{ map, normal }} detail  groundDetailTexture()
 */
export function groundMaterial(detail, { relief = 1 } = {}) {
  detail.map.anisotropy = detail.normal.anisotropy = detail.macro.anisotropy = detail.crackNormal.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.gDetail = { value: detail.map };
    shader.uniforms.gNormal = { value: detail.normal };
    shader.uniforms.gCrack = { value: detail.crackNormal };
    shader.uniforms.gMacro = { value: detail.macro };
    shader.uniforms.gMean = { value: detail.map.userData.mean || 0.8 };
    shader.uniforms.gRelief = { value: relief };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvGroundUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D gDetail, gNormal, gCrack, gMacro;\nuniform float gMean, gRelief;\nvarying vec2 vGroundUv;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 gUv = vGroundUv * (6.0 / 8.0);                          // the tile is 8 m
        vec2 gUv2 = gUv * 0.173 + 0.31;                              // and a ~46 m one, so tiling never lines up
        vec4 gA = texture2D(gDetail, gUv), gB = texture2D(gDetail, gUv2);
        // Cracked plates only in patches: a world-scale mask from the dust of a ~260 m tile.
        float gCrackMask = smoothstep(0.56, 0.7, texture2D(gDetail, gUv * 0.031 + 0.7).g);
        diffuseColor.rgb *= ((gA.r * 0.7 + gB.r * 0.3) / gMean) * (1.0 - gA.b * 0.16 * gCrackMask);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // Heightfield tangent frame in world space (x and z along the ground), then back to view space.
          vec3 gN = normalize(transpose(mat3(viewMatrix)) * normal);
          vec3 gT = normalize(vec3(1.0, 0.0, 0.0) - gN * gN.x), gBt = normalize(cross(gT, gN));
          vec3 gM = texture2D(gNormal, gUv).xyz * 2.0 - 1.0;
          vec3 gM2 = texture2D(gMacro, gUv2).xyz * 2.0 - 1.0;
          vec3 gMc = texture2D(gCrack, gUv).xyz * 2.0 - 1.0;
          vec2 gXY = (gM.xy + gM2.xy * 0.6 + gMc.xy * gCrackMask) * gRelief;
          gN = normalize(gN + gT * gXY.x + gBt * gXY.y);
          normal = normalize(mat3(viewMatrix) * gN);
        }`);
  };
  mat.customProgramCacheKey = () => `ground:${detail.map.uuid}`;
  return mat;
}
