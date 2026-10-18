// PostFX: the frame after the scene (docs/ART_DIRECTION.md, palette.json `post`).
//  1. The scene renders linear HDR into a multisampled half-float target with a depth texture.
//  2. God rays (half resolution): from every pixel, march toward the sun's place on screen and
//     gather the bright sky behind; the depth texture keeps only sky pixels, so soldiers, ridges
//     and wrecks cut dark shafts through the light, and smoke over the sky dims them.
//  3. Bloom (three's UnrealBloomPass) on whatever burns brighter than white: the sun, fire,
//     muzzle flashes, visors.
//  4. Final pass to the screen: rays added in the light's color, exposure, ACES filmic, the
//     grade (lift, gamma, gain, contrast, saturation), vignette, film grain, and a little
//     chromatic aberration toward the edges; then sRGB.
//  5. The stylized look (`post.outline`, `post.letterbox`): ink lines where the depth breaks
//     (silhouettes and creases, found as a kink in 1/depth, so flat ground never draws one), on
//     the near side of the edge, 2 px wide up to 1080p, fading out with distance; cinematic bars.
//  6. Render scale (the options menu): the scene, rays and bloom draw at a fraction of the screen's
//     resolution and the final pass scales them up with contrast-adaptive sharpening (AMD CAS,
//     the sharpening half of FSR 1), so a smaller image still reads crisp.
// quality 'low' drops multisampling and halves the ray samples. setOptions() changes the scale,
// the multisampling and each effect live.

import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const QUAD_VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
// A pixel that went NaN or infinite somewhere in the scene (a degenerate normal, a half-float
// overflow) is one black dot; but the god rays march across the screen through it and the bloom
// blurs it through every mip, and it comes out as big black blocks and streaks that flicker as
// it comes and goes. Every pass that spreads light reads the scene through this first.
const SAFE = `vec3 safe(vec3 x) { return any(isnan(x)) || any(isinf(x)) ? vec3(0.0) : clamp(x, 0.0, 512.0); }`;

const RAYS_FRAG = `
${SAFE}
uniform sampler2D tColor, tDepth;
uniform vec2 sun;
uniform float density, decay, weight, ahead;
uniform int samples;
varying vec2 vUv;
void main() {
  if (ahead <= 0.0) { gl_FragColor = vec4(0.0); return; }
  vec2 delta = (vUv - sun) * density / float(samples);
  vec2 uv = vUv;
  float illum = 1.0;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 64; i++) {
    if (i >= samples) break;
    uv -= delta;
    vec2 c = clamp(uv, 0.0, 1.0);
    float sky = step(0.99995, texture2D(tDepth, c).r);
    vec3 s = safe(texture2D(tColor, c).rgb) * sky;
    acc += max(s - 0.35, 0.0) * illum * weight;     // only what's brighter than the haze casts rays
    illum *= decay;
  }
  float edge = smoothstep(1.2, 0.2, length((sun - 0.5) * vec2(1.6, 1.0)));   // fade as the sun leaves the screen
  gl_FragColor = vec4(acc * ahead * edge, 1.0);
}`;

const FINAL_FRAG = `
${SAFE}
uniform sampler2D tColor, tRays, tDepth;
uniform vec3 rayColor, lift, gamma, gain, inkColor;
uniform float rayStrength, exposure, saturation, contrast, vignette, grain, aberration, time;
uniform float ink, inkEdge, inkNear, inkFar, camNear, camFar, letterbox, sharpen;
uniform vec2 resolution;
varying vec2 vUv;
// Contrast-adaptive sharpening of the upscaled image (AMD CAS), in a tone-compressed space so the
// HDR highlights can't ring: the cross's local contrast sets how hard to sharpen.
vec3 tc(vec3 x) { return x / (1.0 + x); }
vec3 itc(vec3 y) { return y / max(vec3(1.0) - y, vec3(1e-4)); }
vec3 casColor(vec2 uv) {
  vec2 t = 1.0 / resolution;
  vec3 a = tc(safe(texture2D(tColor, uv + vec2(0.0, -t.y)).rgb)), b = tc(safe(texture2D(tColor, uv + vec2(-t.x, 0.0)).rgb));
  vec3 c = tc(safe(texture2D(tColor, uv).rgb));
  vec3 d = tc(safe(texture2D(tColor, uv + vec2(t.x, 0.0)).rgb)), e = tc(safe(texture2D(tColor, uv + vec2(0.0, t.y)).rgb));
  vec3 mn = min(min(min(a, b), min(d, e)), c), mx = max(max(max(a, b), max(d, e)), c);
  vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0));
  vec3 w = amp * mix(-0.125, -0.2, sharpen);
  return itc(clamp((c + w * (a + b + d + e)) / (1.0 + 4.0 * w), 0.0, 0.999));
}
float invDepth(vec2 uv) { float z = texture2D(tDepth, uv).r * 2.0 - 1.0; return (camFar + camNear - z * (camFar - camNear)) / (2.0 * camNear * camFar); }
vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 color) {
  const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color = ACESInputMat * (color / 0.6);
  color = RRTAndODTFit(color);
  return clamp(ACESOutputMat * color, 0.0, 1.0);
}
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec2 d = vUv - 0.5;
  float r2 = dot(d, d);
  // Chromatic aberration: red out, blue in, toward the edges.
  vec2 off = d * aberration * r2 * 4.0;
  vec3 c = sharpen > 0.0 ? casColor(vUv) : safe(texture2D(tColor, vUv).rgb);
  if (aberration > 0.0) { c.r = safe(texture2D(tColor, vUv + off).rgb).r; c.b = safe(texture2D(tColor, vUv - off).rgb).b; }
  c += safe(texture2D(tRays, vUv).rgb) * rayColor * rayStrength;
  // Ink: a kink in 1/depth across the pixel (zero on any flat surface), on the near side only.
  if (ink > 0.0) {
    vec2 px = vec2(max(2.0, floor(resolution.y / 540.0 + 0.5))) / resolution;   // whole pixels: 2 up to 1080p
    float ic = invDepth(vUv);
    float il = invDepth(vUv - vec2(px.x, 0.0)), ir = invDepth(vUv + vec2(px.x, 0.0));
    float id = invDepth(vUv - vec2(0.0, px.y)), iu = invDepth(vUv + vec2(0.0, px.y));
    float kink = max(-(il + ir - 2.0 * ic), -(id + iu - 2.0 * ic)) / max(ic, 1e-6);
    float dist = 1.0 / max(ic, 1e-6);
    float k = smoothstep(inkEdge, inkEdge * 2.5, kink) * smoothstep(inkFar, inkNear, dist) * ink;
    c = mix(c, inkColor * (0.7 + 0.6 * max(max(c.r, c.g), c.b)), k);   // the ink takes a little of the light it's drawn in
  }
  c = aces(c * exposure);
  // Grade (display-referred): lift the shadows cool, warm the highlights, then contrast and saturation.
  c = pow(max(c * gain + lift * (1.0 - c), 0.0), 1.0 / gamma);
  c = (c - 0.5) * contrast + 0.5;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation);
  c *= mix(1.0, smoothstep(0.85, 0.15, length(d * vec2(1.25, 1.0))), vignette);
  c = clamp(c, 0.0, 1.0);
  c = toSRGB(c);
  c += (hash(vUv * resolution + fract(time * 13.0) * 97.0) - 0.5) * grain;
  if (vUv.y < letterbox || vUv.y > 1.0 - letterbox) c = vec3(0.0);   // cinematic bars
  gl_FragColor = vec4(c, 1.0);
}`;

export class PostFX {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} post   palette.json planet `post`
   * @param {object} o { quality: 'high' | 'low' }
   */
  constructor(renderer, post, { quality = 'high', scale = 1, samples = null } = {}) {
    this.renderer = renderer; this.post = post; this.quality = quality;
    this.enabled = true;
    this.scale = scale;
    this.samples = samples ?? (quality === 'high' ? 4 : 0);
    this.fx = { bloom: true, rays: true, ink: true, letterbox: true, film: true };
    const size = this.#size();
    const W = size.x, H = size.y;
    this.rt = this.#target(W, H);
    this.raysRT = new THREE.WebGLRenderTarget(Math.max(1, W >> 1), Math.max(1, H >> 1), { type: THREE.HalfFloatType });
    const G = post.godRays, gr = post.grade;
    this.raysMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: RAYS_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tColor: { value: this.rt.texture }, tDepth: { value: this.rt.depthTexture }, sun: { value: new THREE.Vector2(0.5, 0.5) }, ahead: { value: 0 },
        density: { value: G.density }, decay: { value: G.decay }, weight: { value: 1 / G.samples * 2.2 }, samples: { value: quality === 'high' ? G.samples : Math.round(G.samples / 2) } },
    });
    this.finalMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: FINAL_FRAG, depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: {
        tColor: { value: this.rt.texture }, tRays: { value: this.raysRT.texture }, rayColor: { value: new THREE.Color(G.color) }, rayStrength: { value: G.strength },
        exposure: { value: post.exposure }, lift: { value: new THREE.Vector3(...gr.lift) }, gamma: { value: new THREE.Vector3(...gr.gamma) }, gain: { value: new THREE.Vector3(...gr.gain) },
        saturation: { value: gr.saturation }, contrast: { value: gr.contrast }, vignette: { value: post.vignette }, grain: { value: post.grain },
        aberration: { value: post.aberration }, time: { value: 0 }, resolution: { value: new THREE.Vector2(W, H) },
        tDepth: { value: this.rt.depthTexture }, camNear: { value: 0.1 }, camFar: { value: 1000 },
        ink: { value: post.outline?.strength ?? 0 }, inkColor: { value: new THREE.Color(post.outline?.color ?? '#2a2444') },
        inkEdge: { value: post.outline?.edge ?? 0.12 }, inkNear: { value: post.outline?.near ?? 4 }, inkFar: { value: post.outline?.far ?? 70 },
        letterbox: { value: post.letterbox ?? 0 }, sharpen: { value: 0 },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.raysMat);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(W, H), post.bloom.strength, post.bloom.radius, post.bloom.threshold);
    const hp = this.bloom.materialHighPassFilter;          // (its bright-pass: where the blur starts)
    hp.fragmentShader = `${SAFE}\n` + hp.fragmentShader.replace('vec4 texel = texture2D( tDiffuse, vUv );', 'vec4 texel = texture2D( tDiffuse, vUv ); texel.rgb = safe( texel.rgb );');
    hp.needsUpdate = true;
    this.time = 0;
  }

  /** The scene's resolution: the drawing buffer's at the render scale. */
  #size() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    return size.set(Math.max(1, Math.round(size.x * this.scale)), Math.max(1, Math.round(size.y * this.scale)));
  }

  #target(W, H) {
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: this.samples, depthTexture: new THREE.DepthTexture(W, H) });
    rt.depthTexture.type = THREE.UnsignedIntType;
    return rt;
  }

  setSize(w, h) {
    const size = this.#size();
    const W = size.x, H = size.y;
    this.rt.setSize(W, H);
    this.raysRT.setSize(Math.max(1, W >> 1), Math.max(1, H >> 1));
    this.bloom.setSize(W, H);
    this.finalMat.uniforms.resolution.value.set(W, H);
    this.finalMat.uniforms.sharpen.value = this.scale < 0.999 ? Math.min(1, (1 - this.scale) * 2.5) : 0;
  }

  /**
   * The options menu's graphics, live: { scale (0.5..1), samples (0, 2, 4), bloom, rays, ink,
   * letterbox, film }.
   */
  setOptions(o) {
    if (o.samples !== undefined && o.samples !== this.samples) {
      this.samples = o.samples;
      const old = this.rt, size = this.#size();
      this.rt = this.#target(size.x, size.y);
      old.dispose(); old.depthTexture?.dispose();
      const U = this.finalMat.uniforms;
      U.tColor.value = this.rt.texture; U.tDepth.value = this.rt.depthTexture;
      this.raysMat.uniforms.tColor.value = this.rt.texture; this.raysMat.uniforms.tDepth.value = this.rt.depthTexture;
    }
    if (o.scale !== undefined) this.scale = Math.min(1, Math.max(0.25, o.scale));
    for (const k of ['bloom', 'rays', 'ink', 'letterbox', 'film']) if (o[k] !== undefined) this.fx[k] = !!o[k];
    const U = this.finalMat.uniforms, P = this.post;
    U.ink.value = this.fx.ink ? P.outline?.strength ?? 0 : 0;
    U.letterbox.value = this.fx.letterbox ? P.letterbox ?? 0 : 0;
    U.grain.value = this.fx.film ? P.grain : 0;
    U.aberration.value = this.fx.film ? P.aberration : 0;
    U.rayStrength.value = this.fx.rays ? P.godRays.strength : 0;
    this.setSize();
  }

  /** The letterbox each bar covers now (0 when the planet has none or it's turned off). */
  get letterbox() { return this.finalMat.uniforms.letterbox.value; }

  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {THREE.Vector3} sunScreen  (u, v, ahead) from Atmosphere.sunScreen()
   */
  render(scene, camera, sunScreen, dt = 1 / 60) {
    const R = this.renderer;
    if (!this.enabled) { R.setRenderTarget(null); R.render(scene, camera); return; }
    this.time += dt;
    const tm = R.toneMapping;
    R.toneMapping = THREE.NoToneMapping;
    R.setRenderTarget(this.rt);
    R.render(scene, camera);
    // God rays.
    if (this.fx.rays) {
      this.raysMat.uniforms.sun.value.set(sunScreen.x, sunScreen.y);
      this.raysMat.uniforms.ahead.value = Math.max(0, sunScreen.z);
      this.quad.material = this.raysMat;
      R.setRenderTarget(this.raysRT);
      R.render(this.quadScene, this.quadCam);
    }
    // Bloom, added into the scene target.
    if (this.fx.bloom) this.bloom.render(R, null, this.rt, dt, false);
    // Final.
    this.finalMat.uniforms.time.value = this.time;
    this.finalMat.uniforms.camNear.value = camera.near; this.finalMat.uniforms.camFar.value = camera.far;
    this.quad.material = this.finalMat;
    R.setRenderTarget(null);
    R.render(this.quadScene, this.quadCam);
    R.toneMapping = tm;
  }
}
