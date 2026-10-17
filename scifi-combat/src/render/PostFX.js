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
// quality 'low' drops multisampling and halves the ray samples.

import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const QUAD_VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const RAYS_FRAG = `
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
    vec3 s = texture2D(tColor, c).rgb * sky;
    acc += max(s - 0.35, 0.0) * illum * weight;     // only what's brighter than the haze casts rays
    illum *= decay;
  }
  float edge = smoothstep(1.2, 0.2, length((sun - 0.5) * vec2(1.6, 1.0)));   // fade as the sun leaves the screen
  gl_FragColor = vec4(acc * ahead * edge, 1.0);
}`;

const FINAL_FRAG = `
uniform sampler2D tColor, tRays;
uniform vec3 rayColor, lift, gamma, gain;
uniform float rayStrength, exposure, saturation, contrast, vignette, grain, aberration, time;
uniform vec2 resolution;
varying vec2 vUv;
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
  vec3 c = vec3(texture2D(tColor, vUv + off).r, texture2D(tColor, vUv).g, texture2D(tColor, vUv - off).b);
  c += texture2D(tRays, vUv).rgb * rayColor * rayStrength;
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
  gl_FragColor = vec4(c, 1.0);
}`;

export class PostFX {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} post   palette.json planet `post`
   * @param {object} o { quality: 'high' | 'low' }
   */
  constructor(renderer, post, { quality = 'high' } = {}) {
    this.renderer = renderer; this.post = post; this.quality = quality;
    this.enabled = true;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const W = size.x, H = size.y;
    this.rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: quality === 'high' ? 4 : 0, depthTexture: new THREE.DepthTexture(W, H) });
    this.rt.depthTexture.type = THREE.UnsignedIntType;
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
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.raysMat);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(W, H), post.bloom.strength, post.bloom.radius, post.bloom.threshold);
    this.time = 0;
  }

  setSize(w, h) {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const W = size.x, H = size.y;
    this.rt.setSize(W, H);
    this.raysRT.setSize(Math.max(1, W >> 1), Math.max(1, H >> 1));
    this.bloom.setSize(W, H);
    this.finalMat.uniforms.resolution.value.set(W, H);
  }

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
    this.raysMat.uniforms.sun.value.set(sunScreen.x, sunScreen.y);
    this.raysMat.uniforms.ahead.value = Math.max(0, sunScreen.z);
    this.quad.material = this.raysMat;
    R.setRenderTarget(this.raysRT);
    R.render(this.quadScene, this.quadCam);
    // Bloom, added into the scene target.
    this.bloom.render(R, null, this.rt, dt, false);
    // Final.
    this.finalMat.uniforms.time.value = this.time;
    this.quad.material = this.finalMat;
    R.setRenderTarget(null);
    R.render(this.quadScene, this.quadCam);
    R.toneMapping = tm;
  }
}
