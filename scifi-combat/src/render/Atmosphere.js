// Atmosphere: a planet preset's sky, sun, fog, fill light and falling ash (data/art/palette.json,
// docs/ART_DIRECTION.md). Presentation only.
//  * Sky dome (one draw call, at the far plane): a gradient from the horizon to the zenith, a
//    horizon band that matches the fog exactly (far ground melts into the sky), a haze glow, wind-
//    torn smoke streaks, smoke columns from burning things on the horizon, a ringed moon half lost
//    in the haze, and an HDR sun disk and halo (bright enough to bloom and to cast god rays).
//  * Fog: three's fog chunks are replaced (installFog, before any material compiles) by an
//    exponential height fog, thickest in the low ground and thinner with altitude, tinted toward
//    the sun's color when you look toward it. One function, shared by the sky's horizon band.
//  * Lights: the low, hard sun with its shadow box following the action; the sky itself baked
//    into an environment map (image-based light: metal reflects the burning sky, shade is lit by
//    it); a hemisphere fill (warm sky above, dark earth below) and a soft bounce from the camera
//    side so shaded faces never go black.
//  * Ash: flakes (and a few embers) falling and drifting around the camera, wrapped in a box. A
//    preset can make it snow (`ash.size`, `alpha`, `near`, `box`: big soft flakes, thick around
//    you and close to the lens).
//  * Night presets (`stars`, `aurora`): a star field, and aurora curtains folding and drifting
//    round the sky, brightest and highest on one side (their colour is baked into the
//    environment light too); the "sun" is then the moon, its disk dimmed by `sun.gain`.

import * as THREE from 'three';

const DEG = Math.PI / 180;

/** Unit vector toward a point in the sky: elevation above the horizon, azimuth clockwise from north (-Z). */
export function skyDir(elevation, azimuth, out = new THREE.Vector3()) {
  const e = elevation * DEG, a = azimuth * DEG;
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

const glslColor = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`; };
const glslVec = (v) => `vec3(${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)})`;

/**
 * The fog: exponential height fog with a sun-tinted color. Installs over three's fog chunks, so
 * every material with `fog: true` (and the sky's horizon) agrees. Call before materials compile;
 * scene.fog must be a FogExp2 (its density is the density at `base` height).
 */
export function installFog(planet) {
  const F = planet.fog, sun = skyDir(planet.sun.elevation, planet.sun.azimuth);
  THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG\n  varying float vFogDepth;\n  varying vec3 vFogWorld;\n#endif`;
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG\n  vFogDepth = - mvPosition.z;\n  vFogWorld = ( inverse( viewMatrix ) * mvPosition ).xyz;\n#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    vec3 fogRay = vFogWorld - cameraPosition;
    float fogDist = length( fogRay );
    float fogK = ${F.heightFalloff.toFixed(5)};
    float fogDy = fogRay.y;
    float fogDen = fogDensity * exp( - fogK * ( cameraPosition.y - (${F.base.toFixed(3)}) ) );
    float fogInt = fogDen * fogDist * ( abs( fogK * fogDy ) > 0.001 ? ( 1.0 - exp( - fogK * fogDy ) ) / ( fogK * fogDy ) : 1.0 );
    float fogFactor = 1.0 - exp( - fogInt );
    float fogSun = pow( max( dot( fogRay / max( fogDist, 0.001 ), ${glslVec(sun)} ), 0.0 ), ${F.sunPower.toFixed(2)} );
    vec3 fogTint = mix( fogColor, ${glslColor(F.sunColor)}, fogSun );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    vec3 fogTint = fogColor;
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint, fogFactor );
#endif`;
}

/** How far until fog (at ground level) has swallowed `cover` of what's behind it (for culling). */
export function fogReach(planet, cover = 0.985) { return -Math.log(1 - cover) / planet.fog.density; }

// ---------------------------------------------------------------- sky
const NOISE = `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float n = 0.0, w = 0.5; for (int k = 0; k < 5; k++) { n += vnoise(p) * w; p = p * 2.03 + vec2(17.1, 9.3); w *= 0.5; } return n; }
`;

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;   // on the far plane: behind everything, depth 1 (the god rays read that as sky)
}`;

const SKY_FRAG = `
uniform vec3 zenith, upper, horizon, below, haze, streakCol, smokeCol, fireCol;
uniform vec3 sunDir, sunDisk, sunHalo;
uniform float sunSize;
uniform vec3 moonDir, moonRight, moonUp, moonColor, moonShade, ringColor;
uniform float moonSize, moonHaze;
uniform vec3 fogColor, fogSunColor;
uniform float fogSunPower, time, sunGain, gain;
uniform vec4 columns[6];
uniform float stars, aurora, aurAz, aurSpan, aurEl, aurH, aurSpeed, aurFloor, aurTilt;
uniform vec3 aurLow, aurMid, aurHigh;
varying vec3 vDir;
${NOISE}
vec3 fogTint(vec3 d) { return mix(fogColor, fogSunColor, pow(max(dot(d, sunDir), 0.0), fogSunPower)); }
void main() {
  vec3 d = normalize(vDir);
  float e = d.y, cs = dot(d, sunDir);
  vec3 col;
  if (e < 0.0) col = mix(fogTint(d), below, smoothstep(0.0, -0.3, e));
  else {
    col = mix(horizon, upper, smoothstep(0.03, 0.34, e));
    col = mix(col, zenith, smoothstep(0.3, 0.98, e));
    col = mix(col, fogTint(d), exp(-max(e, 0.0) * 16.0));   // the horizon is the fog's color: far ground melts in
  }
  col += haze * 0.22 * exp(-abs(e) * 8.0) * smoothstep(0.0, 0.05, e) * (0.55 + 0.45 * pow(max(cs, 0.0), 2.0));   // zero at the horizon: no seam with the fogged ground

  // Wind-torn smoke streaks across the upper sky, drifting.
  vec2 sp = d.xz / (max(e, 0.0) + 0.14);
  float warp = fbm(sp * 0.55 + vec2(time * 0.006, time * 0.002));
  float streak = smoothstep(0.42, 0.86, fbm(vec2(sp.x * 0.32 + warp, sp.y * 1.4 - warp) + vec2(time * 0.01, 0.0)));
  float band = smoothstep(0.0, 0.12, e) * (1.0 - smoothstep(0.55, 0.95, e));
  col = mix(col, streakCol * (0.75 + 0.6 * pow(max(cs, 0.0), 6.0)), streak * 0.6 * band);

  // Smoke columns: plumes rising from burning things beyond the horizon, widening as they climb.
  float az = atan(d.x, -d.z);
  for (int i = 0; i < 6; i++) {
    vec4 c = columns[i];
    if (c.w < 0.5) continue;
    float da = az - c.x; da = mod(da + 3.14159265, 6.2831853) - 3.14159265;
    float h = clamp(e / c.y, 0.0, 1.4);
    float halfW = c.z * (0.45 + 1.6 * h * h);
    float bill = fbm(vec2(da / max(halfW, 0.001) * 1.6 + float(i) * 7.0, e * 38.0 - time * 0.08));
    float body = (1.0 - smoothstep(0.55, 1.0, abs(da) / halfW + (bill - 0.5) * 0.7)) * (1.0 - smoothstep(0.85, 1.25, h + (bill - 0.5) * 0.3));
    body *= smoothstep(-0.02, 0.01, e);
    vec3 sc = mix(smokeCol, streakCol, 0.25 + 0.5 * pow(max(cs, 0.0), 3.0)) * (0.8 + 0.4 * bill);
    col = mix(col, sc, body * 0.85);
    col += fireCol * body * exp(-e / max(c.y * 0.12, 0.001)) * 0.9;   // the fire under it
  }

  // Stars (a night sky): a fixed field of cells on the sphere, twinkling, lost toward the horizon.
  if (stars > 0.0 && e > 0.0) {
    vec3 sc = d * 260.0, ci = floor(sc);
    float h = hash12(ci.xy + vec2(ci.z * 7.31, ci.z * 3.17));
    if (h > 0.9962) {
      float r = length(fract(sc) - 0.5);
      float tw = 0.6 + 0.4 * sin(time * (1.3 + h * 7.0) + h * 91.0);
      float k = (h - 0.9962) / 0.0038;
      col += mix(vec3(1.0, 0.86, 0.75), vec3(0.75, 0.85, 1.0), fract(h * 113.0)) * smoothstep(0.34, 0.0, r) * (0.35 + 1.9 * k * k) * tw * stars * smoothstep(0.03, 0.3, e);
    }
  }

  // The aurora: curtains hanging all round the sky, brightest and highest toward aurAz (an arc
  // climbing over that side), patchy along their length, their lower edges folding and drifting,
  // rays streaming up them, hot at the edge and fading up through the colours.
  if (aurora > 0.0 && e > 0.0) {
    float az = atan(d.x, -d.z);
    float da = mod(az - aurAz + 3.14159265, 6.2831853) - 3.14159265;
    float t = time * 0.02 * aurSpeed;
    float toward = exp(-pow(da / aurSpan, 2.0) * 2.2);
    float where = mix(aurFloor, 1.0, toward) * mix(0.3, 1.0, smoothstep(0.28, 0.62, fbm(vec2(az * 1.2 + 4.0, t * 0.9))));
    float lift = aurTilt * (0.5 + 0.5 * cos(da));
    vec3 acc = vec3(0.0);
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float base = aurEl * (1.0 + 0.55 * fk) + lift * (1.0 - 0.3 * fk) + 0.045 * sin(az * (2.0 + fk) + t * 3.0 + fk * 2.1) + 0.07 * (fbm(vec2(az * 1.4 + fk * 5.3, t * 1.5 + fk)) - 0.5);
      float h = (e - base) / (aurH * (1.0 - 0.25 * fk));
      if (h < -0.08 || h > 2.2) continue;
      float rays = fbm(vec2(az * (34.0 + fk * 9.0) + fk * 13.0 + t * 5.0, t * 0.7 + fk));
      rays = pow(rays, 2.4) * 3.2;
      float folds = smoothstep(0.25, 0.75, fbm(vec2(az * 2.6 + t * 2.4 + fk * 9.0, fk * 3.0 + t)));
      float edge = smoothstep(-0.06, 0.03, h) * exp(-max(h, 0.0) * 2.2);
      vec3 c = mix(aurLow, aurMid, smoothstep(0.0, 0.3, h));
      c = mix(c, aurHigh, smoothstep(0.4, 1.4, h));
      acc += c * edge * rays * folds * (1.0 - 0.3 * fk);
    }
    col += acc * aurora * where * smoothstep(0.0, 0.07, e);
  }

  // The moon: a big ringed world, sun-lit, half lost in the haze.
  float mr = sin(moonSize * 0.5 * 0.0174533);
  vec2 mu = vec2(dot(d, moonRight), dot(d, moonUp)) / mr;
  float facing = dot(d, moonDir);
  if (facing > 0.0) {
    float rr = dot(mu, mu);
    vec2 ru = vec2(mu.x * 0.94 + mu.y * 0.34, (mu.y * 0.94 - mu.x * 0.34) / 0.22);   // tilted ring plane, seen from low
    float rd = length(ru);
    float ring = smoothstep(1.55, 1.6, rd) * (1.0 - smoothstep(2.3, 2.4, rd)) * (0.55 + 0.45 * vnoise(vec2(rd * 40.0, 0.0)));
    float behind = step(0.0, ru.y);       // the far half of the ring is behind the planet
    vec3 mcol = col;
    if (rr < 1.0) {
      vec3 n = normalize(vec3(mu, sqrt(1.0 - rr)));
      vec3 ls = normalize(vec3(dot(sunDir, moonRight), dot(sunDir, moonUp), dot(sunDir, moonDir)));
      float lit = smoothstep(-0.15, 0.5, dot(n, ls));
      float crater = 0.75 + 0.25 * fbm(mu * 5.0 + 3.0);
      float bands = 0.85 + 0.15 * sin(mu.y * 9.0 + fbm(mu * 2.0) * 3.0);
      mcol = mix(moonShade, moonColor, lit) * crater * bands;
      mcol = mix(mcol, col, smoothstep(0.92, 1.0, rr) * 0.6);
      if (behind > 0.5) ring = 0.0;
    }
    mcol = mix(mcol, ringColor * (0.6 + 0.4 * dot(normalize(vec3(0.0, 1.0, 0.3)), vec3(0.0, 1.0, 0.0))), ring * 0.75);
    float show = (rr < 1.0 ? 1.0 : 0.0) + ring;
    col = mix(col, mcol, clamp(show, 0.0, 1.0) * (1.0 - moonHaze) * smoothstep(0.0, 0.08, e));
  }

  // The sun: a halo through everything and an HDR disk (it blooms, and the god rays start here).
  float halo = pow(max(cs, 0.0), 10.0) * 0.6 + pow(max(cs, 0.0), 160.0) * 1.6 + pow(max(cs, 0.0), 2.5) * 0.14;
  col += sunHalo * halo * (1.0 - streak * band * 0.45);
  float disk = smoothstep(cos(sunSize * 0.0174533), cos(sunSize * 0.82 * 0.0174533), cs);
  col = mix(col, sunDisk * 14.0 * sunGain, disk * (1.0 - streak * band * 0.6));
  col += (hash12(gl_FragCoord.xy + time) - 0.5) / 160.0;   // dither: no banding in the gradient
  gl_FragColor = vec4(max(col * gain, 0.0), 1.0);
}`;

// ---------------------------------------------------------------- ash
const ASH_VERT = `
attribute float seed;
uniform vec3 uCam;
uniform float uTime, uBox, uFall, uSize, uEmbers, uNear, uPx;
uniform vec2 uDrift;
varying float vSeed, vFade;
void main() {
  vSeed = seed;
  vec3 p = position * uBox;
  float t = uTime * (0.6 + 0.8 * fract(seed * 13.7));
  p += vec3(uDrift.x * t + sin(t * 0.7 + seed * 40.0) * 0.6, -uFall * t, uDrift.y * t + cos(t * 0.5 + seed * 20.0) * 0.6);
  vec3 base = uCam - vec3(uBox * 0.5);
  p = mod(p - base, uBox) + base;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float ember = step(1.0 - uEmbers, fract(seed * 7.31));
  gl_PointSize = uSize * (ember > 0.5 ? 1.6 : 1.0) * (0.6 + fract(seed * 3.3)) * 240.0 * uPx / max(-mv.z, 0.5);   // (uPx: the same size on any screen)
  vFade = smoothstep(uBox * 0.5, uBox * 0.3, length(p - uCam)) * smoothstep(uNear, uNear * 2.6, -mv.z);   // none in your face (snow comes closer)
  gl_Position = projectionMatrix * mv;
}`;
const ASH_FRAG = `
uniform vec3 uAsh, uEmber;
uniform float uEmbers, uTime, uAlpha;
varying float vSeed, vFade;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = dot(c, c);
  if (r > 0.25) discard;
  float ember = step(1.0 - uEmbers, fract(vSeed * 7.31));
  float flicker = 0.6 + 0.4 * sin(uTime * 9.0 + vSeed * 50.0);
  vec3 col = ember > 0.5 ? uEmber * (3.0 + 3.0 * flicker) : uAsh;
  float a = (1.0 - r * 4.0) * vFade * (ember > 0.5 ? 0.9 : uAlpha);
  gl_FragColor = vec4(col, a);
}`;

export class Atmosphere {
  /**
   * @param {THREE.Scene} scene
   * @param {object} planet  a preset from palette.json `planets`
   * @param {object} o { radius (sky dome, inside the camera's far plane), shadows, shadowBox (m), ash, renderer (bakes the environment light) }
   */
  constructor(scene, planet, { radius = 1000, shadows = true, shadowBox = 45, shadowMap = 2048, ash = true, renderer = null } = {}) {
    this.scene = scene; this.planet = planet;
    const P = planet;
    this.sunDir = skyDir(P.sun.elevation, P.sun.azimuth);
    this.moonDir = skyDir(P.moon.elevation, P.moon.azimuth);
    scene.background = null;
    scene.fog = new THREE.FogExp2(P.fog.color, P.fog.density);
    this.reach = fogReach(P);

    // Sky dome.
    const mr = new THREE.Vector3().crossVectors(this.moonDir, new THREE.Vector3(0, 1, 0)).normalize();
    const mu = new THREE.Vector3().crossVectors(mr, this.moonDir).normalize();
    const cols = Array.from({ length: 6 }, (_, i) => {
      const c = P.smokeColumns?.[i];
      if (!c) return new THREE.Vector4(0, 0, 0, 0);
      return new THREE.Vector4(c.azimuth * DEG, Math.atan2(c.height, c.distance), Math.atan2(c.width * 0.5, c.distance), 1);
    });
    const C = (hex) => new THREE.Color(hex);
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        zenith: { value: C(P.sky.zenith) }, upper: { value: C(P.sky.upper) }, horizon: { value: C(P.sky.horizon) }, below: { value: C(P.sky.below) },
        haze: { value: C(P.sky.haze) }, streakCol: { value: C(P.sky.streaks) }, smokeCol: { value: C('#2a221e') }, fireCol: { value: C('#ff6a1e').multiplyScalar(0.6) },
        sunDir: { value: this.sunDir }, sunDisk: { value: C(P.sun.disk) }, sunHalo: { value: C(P.sun.halo) }, sunSize: { value: P.sun.size },
        moonDir: { value: this.moonDir }, moonRight: { value: mr }, moonUp: { value: mu }, moonColor: { value: C(P.moon.color) }, moonShade: { value: C(P.moon.shade) },
        ringColor: { value: C(P.moon.ring) }, moonSize: { value: P.moon.size }, moonHaze: { value: P.moon.haze },
        fogColor: { value: C(P.fog.color) }, fogSunColor: { value: C(P.fog.sunColor) }, fogSunPower: { value: P.fog.sunPower },
        time: { value: 0 }, columns: { value: cols }, sunGain: { value: P.sun.gain ?? 1 }, gain: { value: 1 },
        // A night sky's stars and aurora (presets without them leave both at 0).
        stars: { value: P.stars ?? 0 }, aurora: { value: P.aurora?.strength ?? 0 },
        aurAz: { value: (P.aurora?.azimuth ?? 0) * DEG }, aurSpan: { value: (P.aurora?.span ?? 120) * DEG * 0.5 },
        aurEl: { value: (P.aurora?.elevation ?? 15) * DEG }, aurH: { value: (P.aurora?.height ?? 30) * DEG }, aurSpeed: { value: P.aurora?.speed ?? 1 },
        aurFloor: { value: P.aurora?.floor ?? 0 }, aurTilt: { value: (P.aurora?.tilt ?? 0) * DEG },
        aurLow: { value: C(P.aurora?.low ?? '#ff4fd8') }, aurMid: { value: C(P.aurora?.mid ?? '#9b4dff') }, aurHigh: { value: C(P.aurora?.high ?? '#3a2ad0') },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), this.skyMat);
    this.sky.frustumCulled = false; this.sky.renderOrder = -1000;
    scene.add(this.sky);

    // Lights.
    this.sun = new THREE.DirectionalLight(P.sun.color, P.sun.intensity);
    this.sun.castShadow = shadows;
    if (shadows) {
      this.sun.shadow.mapSize.set(shadowMap, shadowMap);
      Object.assign(this.sun.shadow.camera, { left: -shadowBox, right: shadowBox, top: shadowBox, bottom: -shadowBox, near: 5, far: 400 });
      this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.03;
    }
    this.hemi = new THREE.HemisphereLight(P.fill.sky, P.fill.ground, P.fill.intensity);
    this.bounce = new THREE.DirectionalLight(P.fill.bounce, P.fill.bounceIntensity);
    scene.add(this.sun, this.sun.target, this.hemi, this.bounce, this.bounce.target);

    // Ash.
    if (ash && P.ash) {
      const n = P.ash.count, pos = new Float32Array(n * 3), seed = new Float32Array(n);
      let s = 12345;
      const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
      for (let i = 0; i < n; i++) { pos[i * 3] = rnd(); pos[i * 3 + 1] = rnd(); pos[i * 3 + 2] = rnd(); seed[i] = rnd(); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
      this.ashMat = new THREE.ShaderMaterial({
        vertexShader: ASH_VERT, fragmentShader: ASH_FRAG, transparent: true, depthWrite: false, fog: false,
        uniforms: {
          uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uBox: { value: P.ash.box ?? 60 }, uFall: { value: P.ash.fall }, uSize: { value: P.ash.size ?? 0.026 },
          uAlpha: { value: P.ash.alpha ?? 0.4 }, uNear: { value: P.ash.near ?? 1.5 }, uPx: { value: 1 },
          uDrift: { value: new THREE.Vector2(...P.ash.drift) }, uEmbers: { value: P.ash.embers }, uAsh: { value: C(P.ash.color) }, uEmber: { value: C(P.ash.ember) },
        },
      });
      this.ash = new THREE.Points(g, this.ashMat);
      this.ash.frustumCulled = false;
      scene.add(this.ash);
    }
    this.time = 0;
    this.renderer = renderer;
    if (renderer) this.bakeEnvironment(renderer);
  }

  /**
   * The sky as image-based light (scene.environment): a small copy of the dome, the sun disk
   * tamed (it would swamp the blur), scaled by the preset's `fill.env`.
   */
  bakeEnvironment(renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const mat = this.skyMat.clone();
    mat.uniforms.sunGain.value = 0.15 * (this.planet.sun.gain ?? 1);
    mat.uniforms.gain.value = this.planet.fill.env ?? 1;
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), mat));
    const rt = pmrem.fromScene(envScene, 0.035, 0.1, 100);
    this.scene.environment = rt.texture;
    pmrem.dispose(); mat.dispose();
  }

  /**
   * Per frame: the dome and ash follow the camera, the sun's shadow box follows `focus` (the
   * player), the bounce light comes from the camera's side.
   */
  update(dt, camera, focus = camera.position) {
    this.time += dt;
    this.sky.position.copy(camera.position);
    this.skyMat.uniforms.time.value = this.time;
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 160);
    this.sun.target.updateMatrixWorld();
    this.bounce.target.position.copy(focus);
    this.bounce.position.copy(camera.position).add(new THREE.Vector3(0, 6, 0));
    this.bounce.target.updateMatrixWorld();
    if (this.ash) {
      const u = this.ashMat.uniforms;
      u.uCam.value.copy(camera.position); u.uTime.value = this.time;
      if (this.renderer) u.uPx.value = this.renderer.getDrawingBufferSize(_v2).y / 720;
    }
  }

  /** Sun direction in screen space (for the god rays): uv and how much it's in front of the camera. */
  sunScreen(camera, out = new THREE.Vector3()) {
    const p = _p.copy(camera.position).addScaledVector(this.sunDir, 500).project(camera);
    const ahead = camera.getWorldDirection(_f).dot(this.sunDir);
    return out.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, ahead);
  }
}
const _p = new THREE.Vector3(), _f = new THREE.Vector3(), _v2 = new THREE.Vector2();
