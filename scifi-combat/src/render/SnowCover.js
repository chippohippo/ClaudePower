// SnowCover: snow lying on a material's upward faces (a planet's `snow` in palette.json: its
// colour, how much of an upward face it covers, and the slope it clings to: none where the world
// normal's up-component is under `lo`, full over `hi`). Roofs, sidewalk tops, barriers and wrecks
// go white, walls keep their colour: the snowfall look of the dusk city.
// Patches a MeshStandardMaterial through onBeforeCompile, after whatever it already does there (a
// facade's windows, a triplanar texture): the snow is the last word on the colour before the light.

import * as THREE from 'three';

/**
 * @param {THREE.MeshStandardMaterial} mat
 * @param {object} snow  { color, amount (0..1), lo, hi }; nothing happens without one
 * @param {number} k     a share of `amount` for this material (road paint shows through a little)
 */
export function snowCover(mat, snow, k = 1) {
  const amount = (snow?.amount ?? 0) * k;
  if (!(amount > 0)) return mat;
  const c = new THREE.Color(snow.color ?? '#dcd6e8'), lo = snow.lo ?? 0.55, hi = snow.hi ?? 0.8;
  const f = (v) => v.toFixed(4);
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = function (sh, renderer) {
    prev.call(this, sh, renderer);
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_fragment>', `{
    float snowK = smoothstep(${f(lo)}, ${f(hi)}, inverseTransformDirection(normal, viewMatrix).y) * ${f(amount)};
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${f(c.r)}, ${f(c.g)}, ${f(c.b)}), snowK);
    roughnessFactor = mix(roughnessFactor, 0.9, snowK);
    metalnessFactor = mix(metalnessFactor, 0.0, snowK);
  }
  #include <lights_physical_fragment>`);
  };
  mat.customProgramCacheKey = () => `${prevKey}|snow:${c.getHexString()}:${f(lo)}:${f(hi)}:${f(amount)}`;
  return mat;
}
