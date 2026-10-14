// Comic / pop-art rendering style (Borderlands-like):
//  - toonify(): swaps PBR materials for 3-band cel shading (keeps colours, maps, vertex colours,
//    emissive accents and custom shader patches)
//  - ComicPost: full-screen ink pass on the world render. Thick silhouette lines from depth
//    discontinuities, thinner crease lines from the 1/z Laplacian (zero on flat planes, so only
//    real edges ink), lines thin out with distance, halftone dots in the shadows and a punchy grade.
//  - addHulls(): inverted-hull outlines for the first-person viewmodel (drawn in its own pass).

import * as THREE from 'three';

// Active art style (set from settings when a match starts).
export const STYLE = { comic: true };

export const COMIC = {
  bands: [0.36, 0.7, 1.0],    // cel-shading light bands (deeper shadow band = punchier)
  lineColor: [0.05, 0.04, 0.06],
  silhouette: 0.025,          // relative depth jump that counts as an outline
  crease: 0.009,             // 1/z curvature that counts as a crease
  thickness: 1.6,            // line width in pixels at 1080p (scales with resolution)
  fadeNear: 60,               // lines start thinning at this distance (m)
  fadeFar: 520,
  halftone: 0.6,             // halftone strength in dark areas (0 = off)
  halftoneSize: 5.0,          // dot spacing in pixels
  saturation: 1.35,
  contrast: 1.08,
  hullThickness: 0.0045,      // viewmodel outline thickness (m)
};

// Clean art style reuses the post pass as a pure colour grade (no ink, no halftone): punchy,
// warm-lit and saturated like Apex's daylight maps, so characters read against the terrain.
export const CLEAN_GRADE = { ink: 0, halftone: 0, saturation: 1.16, contrast: 1.07 };

let gradientMap = null;
function getGradient() {
  if (gradientMap) return gradientMap;
  const b = COMIC.bands;
  const data = new Uint8Array(b.length * 4);
  b.forEach((v, i) => { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = Math.round(v * 255); data[i * 4 + 3] = 255; });
  gradientMap = new THREE.DataTexture(data, b.length, 1, THREE.RGBAFormat);
  gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

const converted = new WeakMap();
export function toToon(m) {
  if (!m || !m.isMeshStandardMaterial) return m;
  let t = converted.get(m);
  if (t) return t;
  t = new THREE.MeshToonMaterial({
    color: m.color, map: m.map, gradientMap: getGradient(), vertexColors: m.vertexColors,
    emissive: m.emissive, emissiveIntensity: m.emissiveIntensity, emissiveMap: m.emissiveMap,
    transparent: m.transparent, opacity: m.opacity, side: m.side, depthWrite: m.depthWrite,
    alphaTest: m.alphaTest, alphaMap: m.alphaMap, alphaToCoverage: m.alphaToCoverage, // leaf cards (alpha-masked foliage)
    polygonOffset: m.polygonOffset, polygonOffsetFactor: m.polygonOffsetFactor,
  });
  if (m.onBeforeCompile && m.onBeforeCompile.toString() !== THREE.Material.prototype.onBeforeCompile.toString()) {
    t.onBeforeCompile = m.onBeforeCompile;
    // keep the source material's cache key: patch closures share source text but differ in params
    const key = m.customProgramCacheKey();
    t.customProgramCacheKey = () => 'toon' + key + m.onBeforeCompile.toString().length;
  }
  t.name = m.name;
  converted.set(m, t);
  return t;
}

// Convert every PBR material under obj to cel shading (shared materials are converted once).
export function toonify(obj) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    if (Array.isArray(o.material)) o.material = o.material.map(toToon);
    else o.material = toToon(o.material);
  });
  return obj;
}

const hullMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(...COMIC.lineColor), side: THREE.BackSide });
// Inverted-hull ink outline: a slightly larger back-face copy of each mesh.
export function addHulls(obj, t = COMIC.hullThickness) {
  const meshes = [];
  obj.traverse((o) => { if (o.isMesh && !o.userData.isHull && !o.material.transparent && o.geometry) meshes.push(o); });
  for (const m of meshes) {
    if (m.isSkinnedMesh) {
      // skinned meshes (imported FPS arms): back-face copy bound to the same skeleton, pushed out
      // along the skinned normal in object units so the ink follows the animation
      const ws = m.getWorldScale(new THREE.Vector3()).x || 1;
      const hm = hullMat.clone();
      hm.onBeforeCompile = (sh) => {
        sh.uniforms.hullT = { value: t / ws };
        sh.vertexShader = 'uniform float hullT;\n' + sh.vertexShader.replace('#include <skinning_vertex>', '#include <skinning_vertex>\n  transformed += normalize(objectNormal) * hullT;');
      };
      const h = new THREE.SkinnedMesh(m.geometry, hm);
      h.bind(m.skeleton, m.bindMatrix);
      h.userData.isHull = true;
      h.castShadow = false;
      h.frustumCulled = false;
      m.parent.add(h);
      h.position.copy(m.position); h.quaternion.copy(m.quaternion); h.scale.copy(m.scale);
      continue;
    }
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const s = m.geometry.boundingBox.getSize(new THREE.Vector3());
    const c = m.geometry.boundingBox.getCenter(new THREE.Vector3());
    const h = new THREE.Mesh(m.geometry, hullMat);
    h.userData.isHull = true;
    h.scale.set(1 + (2 * t) / Math.max(s.x, 0.005), 1 + (2 * t) / Math.max(s.y, 0.005), 1 + (2 * t) / Math.max(s.z, 0.005));
    h.position.copy(c).multiply(new THREE.Vector3(1 - h.scale.x, 1 - h.scale.y, 1 - h.scale.z));
    h.castShadow = false;
    m.add(h);
  }
  return obj;
}

export class ComicPost {
  constructor(renderer, grade = null) {
    this.renderer = renderer;
    this.rt = null;
    this.size = new THREE.Vector2();
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const C = COMIC;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, res: { value: new THREE.Vector2(1, 1) },
        near: { value: 0.05 }, far: { value: 4000 }, px: { value: 1 },
        silhouette: { value: C.silhouette }, crease: { value: C.crease }, fade: { value: new THREE.Vector2(C.fadeNear, C.fadeFar) },
        halftone: { value: grade ? grade.halftone : C.halftone }, htSize: { value: C.halftoneSize },
        sat: { value: grade ? grade.saturation : C.saturation }, contrast: { value: grade ? grade.contrast : C.contrast },
        ink: { value: new THREE.Vector3(...C.lineColor) }, inkAmt: { value: grade ? grade.ink : 1 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 res; uniform float near, far, px;
        uniform float silhouette, crease, halftone, htSize, sat, contrast, inkAmt; uniform vec2 fade; uniform vec3 ink;
        varying vec2 vUv;
        float lin(vec2 uv){ float d = texture2D(tDepth, uv).x; return (near * far) / (far - d * (far - near)); }
        void main(){
          vec2 o = px / res;
          float c = lin(vUv);
          float l = lin(vUv - vec2(o.x, 0.0)), r = lin(vUv + vec2(o.x, 0.0));
          float d = lin(vUv - vec2(0.0, o.y)), u = lin(vUv + vec2(0.0, o.y));
          float l2 = lin(vUv - o), r2 = lin(vUv + o), d2 = lin(vUv + vec2(o.x, -o.y)), u2 = lin(vUv + vec2(-o.x, o.y));
          // silhouettes: relative depth jumps against any neighbour (only inks the nearer side)
          float jump = max(max(l, r), max(max(d, u), max(max(l2, r2), max(d2, u2)))) - c;
          float sil = smoothstep(silhouette, silhouette * 2.0, jump / c);
          // creases: curvature of 1/z (planes have zero laplacian in screen space)
          float ic = 1.0 / c;
          float lap = abs(1.0 / l + 1.0 / r - 2.0 * ic) + abs(1.0 / d + 1.0 / u - 2.0 * ic);
          float cr = smoothstep(crease, crease * 2.5, lap / ic) * 0.85;
          float sky = step(far * 0.9, c);
          float dist = 1.0 - smoothstep(fade.x, fade.y, c);
          float creaseDist = 1.0 - smoothstep(25.0, 90.0, c); // creases are close-range detail only
          // far silhouettes fade to a soft tint so the horizon stays clean and readable
          float line = max(sil * (0.18 + 0.82 * dist * dist), cr * (1.0 - sky) * creaseDist);
          // tone-map + sRGB first so grading and halftone work on display values
          gl_FragColor = vec4(texture2D(tColor, vUv).rgb, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          vec3 col = gl_FragColor.rgb;
          float lum = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(vec3(lum), col, sat);
          col = (col - 0.5) * contrast + 0.5;
          // painterly split-tone: cool shadows, warm highlights (keeps cel bands readable)
          col = mix(col, col * vec3(0.78, 0.86, 1.12), clamp((0.45 - lum) * 2.2, 0.0, 1.0) * (1.0 - sky));
          col = mix(col, col * vec3(1.06, 1.02, 0.94), clamp((lum - 0.6) * 2.5, 0.0, 1.0) * (1.0 - sky));
          // halftone dots in the shadows (screen-space, 45 degree grid)
          vec2 p = gl_FragCoord.xy / htSize;
          p = mat2(0.7071, -0.7071, 0.7071, 0.7071) * p;
          vec2 cell = fract(p) - 0.5;
          float dark = clamp((0.26 - lum) / 0.26, 0.0, 1.0) * (1.0 - sky);
          float dot_ = 1.0 - smoothstep(dark * 0.55 - 0.08, dark * 0.55, length(cell));
          col *= 1.0 - dot_ * halftone * dark;
          col = mix(col, ink, clamp(line, 0.0, 1.0) * inkAmt);
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        }`,
      depthTest: false, depthWrite: false, toneMapped: true,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
  }

  _ensure() {
    const r = this.renderer;
    r.getDrawingBufferSize(this.size);
    const w = this.size.x, h = this.size.y;
    if (this.rt && this.rt.width === w && this.rt.height === h) return;
    if (this.rt) this.rt.dispose();
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace });
    this.rt.depthTexture = new THREE.DepthTexture(w, h);
    this.rt.depthTexture.type = THREE.UnsignedIntType;
    this.mat.uniforms.tColor.value = this.rt.texture;
    this.mat.uniforms.tDepth.value = this.rt.depthTexture;
    this.mat.uniforms.res.value.set(w, h);
    this.mat.uniforms.px.value = Math.max(1, (h / 1080) * COMIC.thickness);
  }

  render(scene, camera) {
    this._ensure();
    const r = this.renderer;
    const u = this.mat.uniforms;
    u.near.value = camera.near; u.far.value = camera.far;
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.scene, this.cam);
  }
}
