// External art assets (CC0 packs: Quaternius, Kenney, Poly Haven, ambientCG, …) loaded from
// public/assets/manifest.json. Everything is optional: with no manifest (or a missing file) the
// game keeps its procedural characters, guns, trees, sky light and synthesized audio.
//
// Every model goes through adaptModel(): materials become MeshStandardMaterial (FBX ships Phong),
// textures get the right colour space, and in Comic style everything is cel-shaded by toonify()
// so imported art sits in the same ink + cel look as the procedural world. Characters and guns
// are normalised to SKYFALL's scale and facing (characters ~1.8 m tall facing -Z, guns barrel -Z).
//
// docs/ASSETS.md describes the manifest; tools/assets/ fetches and imports the packs.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { STYLE, toonify, toToon } from './comic.js';
import { CLIP_PATTERNS, matchClip } from '../shared/clips.js';
import { gunFacing } from '../shared/gunfacing.js';

const BASE = (import.meta.env && import.meta.env.BASE_URL ? import.meta.env.BASE_URL : '/') + 'assets/';

export { CLIP_PATTERNS } from '../shared/clips.js';

// Convert any imported material to MeshStandardMaterial so the PBR / toon pipeline can use it.
function toStandard(m) {
  if (!m || m.isMeshStandardMaterial || m.isShaderMaterial) return m;
  const s = new THREE.MeshStandardMaterial({
    color: m.color ? m.color.clone() : new THREE.Color('#ffffff'),
    map: m.map || null, normalMap: m.normalMap || null, alphaMap: m.alphaMap || null,
    emissive: m.emissive ? m.emissive.clone() : new THREE.Color(0), emissiveMap: m.emissiveMap || null,
    transparent: m.transparent, opacity: m.opacity, side: m.side, vertexColors: m.vertexColors,
    alphaTest: m.alphaTest || 0, roughness: 0.75, metalness: 0.05,
  });
  s.name = m.name;
  return s;
}

// Make an imported model look native: standard materials, sRGB colour maps, shadows. Cel shading
// is applied when a copy is handed out (styled()), because the art style is only known per match.
export function adaptModel(root, { shadows = true, skinned = false } = {}) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = shadows;
    o.receiveShadow = true;
    if (skinned && o.isSkinnedMesh) o.frustumCulled = false; // skinned bounds don't follow the pose
    const fix = (m) => {
      const s = toStandard(m);
      if (s && s.map) { s.map.colorSpace = THREE.SRGBColorSpace; s.map.anisotropy = 4; }
      if (s && s.emissiveMap) s.emissiveMap.colorSpace = THREE.SRGBColorSpace;
      return s;
    };
    o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
  });
  return root;
}

// Many character packs split a body into parts that share one texture atlas (KayKit: body, head,
// arms, legs, helmet, cape …), each with its own skin. Merge parts that share a material into a
// single SkinnedMesh on a union skeleton → one draw call per character instead of 7–10.
export function mergeSkinnedParts(root) {
  const groups = new Map();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isSkinnedMesh || Array.isArray(o.material) || !o.visible) return;
    const k = o.material.uuid + '|' + o.parent.uuid;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  });
  let merged = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const ref = list[0];
    if (!list.every((m) => m.bindMatrix.equals(ref.bindMatrix) && m.matrix.equals(ref.matrix))) continue;
    const bones = [], inverses = [];
    const geos = [];
    let ok = true;
    for (const m of list) {
      const g = m.geometry.clone();
      for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(n)) g.deleteAttribute(n);
      if (!g.attributes.skinIndex || !g.attributes.position) { ok = false; break; }
      const si = g.attributes.skinIndex;
      const remap = m.skeleton.bones.map((b, i) => {
        let j = bones.indexOf(b);
        if (j < 0) { j = bones.length; bones.push(b); inverses.push(m.skeleton.boneInverses[i].clone()); }
        return j;
      });
      const arr = new Uint16Array(si.count * 4);
      for (let i = 0; i < si.count; i++) for (let c = 0; c < 4; c++) arr[i * 4 + c] = remap[si.getComponent(i, c)] ?? 0;
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(arr, 4));
      // dequantize so parts with different quantization can be merged
      for (const n of ['position', 'normal', 'uv', 'skinWeight']) {
        const a = g.attributes[n];
        if (a && !(a.array instanceof Float32Array)) {
          const f = new Float32Array(a.count * a.itemSize);
          for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
          g.setAttribute(n, new THREE.BufferAttribute(f, a.itemSize));
        }
      }
      geos.push(g);
    }
    if (!ok || geos.some((g) => Object.keys(g.attributes).sort().join() !== Object.keys(geos[0].attributes).sort().join())) continue;
    const geo = mergeGeometries(geos.map((g) => (g.index ? g : g)), false);
    if (!geo) continue;
    const mesh = new THREE.SkinnedMesh(geo, ref.material);
    mesh.name = ref.name + '_merged';
    mesh.position.copy(ref.position); mesh.quaternion.copy(ref.quaternion); mesh.scale.copy(ref.scale);
    ref.parent.add(mesh);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones, inverses), ref.bindMatrix);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    for (const m of list) m.parent.remove(m);
    merged += list.length - 1;
  }
  return merged;
}

function styled(root) {
  if (STYLE.comic) toonify(root);
  return root;
}

// Scale/orient a model: uniform scale to a target size along an axis, optional rotation, then
// rest it on the ground (characters) or centre it (props/guns).
function normalise(root, { height, length, rot, rotY, offset, ground = true, scale } = {}) {
  if (rot) root.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  else if (rotY) root.rotation.y = rotY;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  let k = scale || 1;
  if (!scale && height && size.y > 1e-4) k = height / size.y;
  else if (!scale && length && Math.max(size.x, size.z) > 1e-4) k = length / Math.max(size.x, size.z);
  root.scale.multiplyScalar(k);
  root.updateMatrixWorld(true);
  box.setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  root.position.x -= c.x; root.position.z -= c.z;
  root.position.y -= ground ? box.min.y : c.y;
  if (offset) { root.position.x += offset[0] || 0; root.position.y += offset[1] || 0; root.position.z += offset[2] || 0; }
  // wrap so callers can place/rotate the result freely without losing the normalisation
  const g = new THREE.Group();
  g.add(root);
  return g;
}

class AssetLibrary {
  constructor() {
    this.manifest = null;
    this.chars = new Map();    // key -> { scene, clips, def }
    this.guns = new Map();     // weaponId -> { scene, def }
    this.arms = null;
    this.nature = {};          // kind -> [{ parts: [{ geometry, material }], def }]
    this.props = {};           // map collider kind (crate, container …) -> same shape as nature
    this.textures = {};        // world kind -> { map, scale }
    this.hdri = null;
    this.sounds = {};          // sound name -> ArrayBuffer (decoded by audio.js)
    this.report = [];
    this.done = false;
    this.ready = null;
  }

  get enabled() { return !!this.manifest; }

  load() {
    if (this.ready) return this.ready;
    this.ready = this._load().catch((e) => { console.warn('[assets] disabled:', e.message); }).finally(() => { this.done = true; });
    return this.ready;
  }

  async _load() {
    let res;
    try { res = await fetch(BASE + 'manifest.json', { cache: 'no-cache' }); } catch { return; }
    if (!res.ok) return;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) return; // dev servers answer index.html for missing files
    const M = (this.manifest = await res.json());
    const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), fbx = new FBXLoader();
    const cache = new Map(); // shared animation libraries are loaded once
    const loadModel = (file) => {
      if (!cache.has(file)) cache.set(file, (async () => {
        const url = BASE + file;
        if (/\.fbx$/i.test(file)) {
          const o = await fbx.loadAsync(url);
          // Mixamo names every clip "mixamo.com": use the file name ("Rifle Run.fbx" → "Rifle Run")
          const base = file.split('/').pop().replace(/\.fbx$/i, '');
          for (const a of o.animations || []) if (/^(mixamo\.com|take 001|unreal take)$/i.test(a.name) || o.animations.length === 1) a.name = base;
          return { scene: o, animations: o.animations || [] };
        }
        const g = await gltf.loadAsync(url);
        return { scene: g.scene, animations: g.animations || [] };
      })());
      return cache.get(file);
    };
    const tryLoad = async (label, fn) => {
      try { await fn(); this.report.push(`ok   ${label}`); } catch (e) { this.report.push(`FAIL ${label}: ${e.message}`); console.warn('[assets]', label, e); }
    };
    const jobs = [];
    // characters (+ shared animation libraries retargeted by bone name)
    for (const [key, def] of Object.entries(M.characters || {})) {
      jobs.push(tryLoad(`character ${key}`, async () => {
        const m = await loadModel(def.file);
        let clips = m.animations.slice();
        for (const f of def.animations || []) { const a = await loadModel(f); clips = clips.concat(a.animations); }
        // held props baked into the character file (swords, shields …): hidden, SKYFALL hands it a gun
        if (def.hide && def.hide.length) {
          const hide = new Set(def.hide.map((n) => THREE.PropertyBinding.sanitizeNodeName(n)));
          m.scene.traverse((o) => { if (hide.has(o.name) || hide.has(THREE.PropertyBinding.sanitizeNodeName(o.name))) o.visible = false; });
        }
        // hidden props first so they're not merged in, then one draw call per material
        const hidden = [];
        m.scene.traverse((o) => { if (!o.visible && o !== m.scene) hidden.push(o); });
        for (const o of hidden) if (o.parent) o.parent.remove(o);
        const merged = mergeSkinnedParts(m.scene);
        adaptModel(m.scene, { skinned: true });
        this.chars.set(key, { scene: m.scene, clips, def, merged });
      }));
    }
    for (const [id, def] of Object.entries(M.weapons || {})) {
      jobs.push(tryLoad(`weapon ${id}`, async () => {
        const m = await loadModel(def.file);
        adaptModel(m.scene);
        this.guns.set(id, { scene: m.scene, def });
      }));
    }
    if (M.arms) jobs.push(tryLoad('arms', async () => { const m = await loadModel(M.arms.file); adaptModel(m.scene, { skinned: true, shadows: false }); this.arms = { scene: m.scene, clips: m.animations, def: M.arms }; }));
    for (const [cat, kind, list] of [...Object.entries(M.nature || {}).map(([k, l]) => ['nature', k, l]), ...Object.entries(M.props || {}).map(([k, l]) => ['props', k, l])]) {
      this[cat][kind] = [];
      for (const def0 of list) {
        const def = typeof def0 === 'string' ? { file: def0 } : def0;
        jobs.push(tryLoad(`${cat} ${kind} ${def.file}`, async () => {
          const m = await loadModel(def.file);
          adaptModel(m.scene);
          this[cat][kind].push({ parts: bakeParts(m.scene, def), def });
        }));
      }
    }
    if (M.hdri) jobs.push(tryLoad('hdri', async () => { this.hdri = await new RGBELoader().loadAsync(BASE + M.hdri.file); this.hdri.mapping = THREE.EquirectangularReflectionMapping; }));
    const tl = new THREE.TextureLoader();
    for (const [kind, def] of Object.entries(M.textures || {})) {
      jobs.push(tryLoad(`texture ${kind}`, async () => {
        const map = await tl.loadAsync(BASE + def.map);
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        map.colorSpace = THREE.SRGBColorSpace;
        map.anisotropy = 4;
        this.textures[kind] = { map, scale: def.scale || 2, strength: def.strength ?? 0.6 };
      }));
    }
    for (const [name, file] of Object.entries(M.sounds || {})) {
      jobs.push(tryLoad(`sound ${name}`, async () => { const r = await fetch(BASE + file); if (!r.ok) throw new Error(r.status); this.sounds[name] = await r.arrayBuffer(); }));
    }
    await Promise.all(jobs);
    console.info('[assets]\n' + this.report.join('\n'));
  }

  // A fresh, independently animatable copy of a character (skeleton cloned), or null.
  character(legend) {
    const c = this.chars.get(legend) || this.chars.get('default');
    if (!c) return null;
    const def = c.def;
    const scene = styled(SkeletonUtils.clone(c.scene));
    const root = normalise(scene, { height: def.height || 1.8, rotY: def.rotY ?? Math.PI, rot: def.rot, scale: def.scale, offset: def.offset });
    const names = c.clips.map((a) => a.name);
    const clips = {};
    for (const st of Object.keys(CLIP_PATTERNS)) {
      const n = matchClip(names, st, def.clips);
      if (n) clips[st] = c.clips[names.indexOf(n)];
    }
    return { root, model: scene, clips, def };
  }

  gun(id, defaultLength = 0.8) {
    const g = this.guns.get(id);
    if (!g) return null;
    const def = g.def;
    let rotY = def.rotY;
    if (rotY === undefined && !def.rot) rotY = (g.facing ||= autoFacing(g.scene)).rotY;
    const root = normalise(styled(g.scene.clone(true)), { length: def.length || defaultLength, rotY, rot: def.rot, scale: def.scale, offset: def.offset, ground: false });
    return { root, def };
  }

  // first-person arms (e.g. WRAD ARMS): an independently animatable copy, or null
  fpArms() {
    if (!this.arms) return null;
    const def = this.arms.def;
    const model = styled(SkeletonUtils.clone(this.arms.scene));
    const root = new THREE.Group();
    root.add(model);
    if (def.scale) model.scale.multiplyScalar(def.scale);
    if (def.rot) model.rotation.set(def.rot[0] || 0, def.rot[1] || 0, def.rot[2] || 0);
    if (def.pos) model.position.set(def.pos[0] || 0, def.pos[1] || 0, def.pos[2] || 0);
    return { root, model, clips: this.arms.clips, def };
  }

  natureKinds(kind) { return this._kinds(this.nature, kind); }
  propKinds(kind) { return this._kinds(this.props, kind); }

  _kinds(store, kind) {
    const list = store[kind];
    if (!list || !list.length) return null;
    return list.map((v) => ({ def: v.def, parts: v.parts.map((p) => ({ geometry: p.geometry, material: STYLE.comic ? toToon(p.material) : p.material })) }));
  }
}

// Muzzle direction for guns whose manifest gives no rotation (same heuristic as the importer).
function autoFacing(scene) {
  scene.updateMatrixWorld(true);
  const pts = [], v = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    const step = Math.max(1, Math.floor(p.count / 4000));
    for (let i = 0; i < p.count; i += step) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); pts.push(v.x, v.y, v.z); }
  });
  return gunFacing(pts);
}

// Flatten a static model into geometry+material parts in model space (unit-normalised so the
// caller's per-instance scale is in metres), ready for InstancedMesh.
function bakeParts(scene, def) {
  const root = normalise(scene, { height: def.height || 1, rot: def.rot, rotY: def.rotY, ground: true });
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.length === 1) parts.push({ geometry: geo, material: mats[0] });
    else for (const gr of geo.groups) {
      const sub = geo.clone();
      sub.setIndex(geo.index ? Array.from(geo.index.array.slice(gr.start, gr.start + gr.count)) : Array.from({ length: gr.count }, (_, i) => gr.start + i));
      sub.clearGroups();
      parts.push({ geometry: sub, material: mats[gr.materialIndex] });
    }
  });
  return parts;
}

export const assets = new AssetLibrary();
