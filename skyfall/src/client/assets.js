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
import { STYLE, toonify, toToon } from './comic.js';

const BASE = (import.meta.env && import.meta.env.BASE_URL ? import.meta.env.BASE_URL : '/') + 'assets/';

// Animation states the game asks for → clip-name patterns tried in order (first match wins).
// Covers Quaternius (Universal Animation Library / Ultimate Animated Character Pack), Mixamo and
// Kenney naming. A manifest "clips" map overrides any of these per character.
export const CLIP_PATTERNS = {
  idle: [/^idle_?gun/i, /gun.*idle/i, /^idle$/i, /idle_?loop/i, /^idle/i, /breath/i],
  walk: [/^walk_?gun/i, /^walk(_?loop)?$/i, /^walk/i, /walking/i],
  run: [/^run_?gun/i, /gun.*run/i, /^run(_?loop)?$/i, /^sprint/i, /^run/i, /running/i, /jog/i],
  crouch: [/crouch.*(walk|fwd|forward|move)/i, /^crouch/i, /sneak/i],
  slide: [/slide/i, /^roll/i, /crouch/i],
  jump: [/jump_?idle/i, /^jump$/i, /jump.*(loop|air|fall)/i, /fall/i, /^jump/i, /air/i],
  skydive: [/sky.?dive/i, /fall/i, /^jump_?idle/i, /swim/i, /^jump/i],
  downed: [/crawl/i, /^death/i, /dead/i, /die/i],
  death: [/^death/i, /dead/i, /die/i, /dying/i],
  shoot: [/shoot/i, /fire/i, /gun.*shoot/i, /punch/i],
  reload: [/reload/i],
  heal: [/interact/i, /use/i, /pickup/i],
  zip: [/hang/i, /climb/i, /^jump_?idle/i],
};

function matchClip(names, state, overrides) {
  if (overrides && overrides[state] && names.includes(overrides[state])) return overrides[state];
  // strip armature prefixes like "CharacterArmature|Run" / "mixamo.com|Run"
  const short = names.map((n) => n.split('|').pop());
  for (const re of CLIP_PATTERNS[state] || []) {
    const i = short.findIndex((n) => re.test(n));
    if (i >= 0) return names[i];
  }
  return null;
}

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
    const gltf = new GLTFLoader(), fbx = new FBXLoader();
    const loadModel = async (file) => {
      const url = BASE + file;
      if (/\.fbx$/i.test(file)) { const o = await fbx.loadAsync(url); return { scene: o, animations: o.animations || [] }; }
      const g = await gltf.loadAsync(url);
      return { scene: g.scene, animations: g.animations || [] };
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
        adaptModel(m.scene, { skinned: true });
        this.chars.set(key, { scene: m.scene, clips, def });
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
    for (const [kind, list] of Object.entries(M.nature || {})) {
      this.nature[kind] = [];
      for (const def0 of list) {
        const def = typeof def0 === 'string' ? { file: def0 } : def0;
        jobs.push(tryLoad(`nature ${kind} ${def.file}`, async () => {
          const m = await loadModel(def.file);
          adaptModel(m.scene);
          this.nature[kind].push({ parts: bakeParts(m.scene, def), def });
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
    const root = normalise(styled(g.scene.clone(true)), { length: def.length || defaultLength, rot: def.rot, rotY: def.rotY, scale: def.scale, offset: def.offset, ground: false });
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

  natureKinds(kind) {
    const list = this.nature[kind];
    if (!list || !list.length) return null;
    return list.map((v) => ({ def: v.def, parts: v.parts.map((p) => ({ geometry: p.geometry, material: STYLE.comic ? toToon(p.material) : p.material })) }));
  }
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
