// Shrinks imported models for the web with glTF-Transform (devDependencies), writing one .glb:
//   - drops held props baked into character files (the manifest "hide" list)
//   - keeps only animation clips the game can map to a state (src/shared/clips.js)
//   - prunes unused data, dedups, welds, quantizes vertex data and applies meshopt compression
//     (decoded in the browser by three's bundled MeshoptDecoder — no CDN, no WASM download)
// Falls back to a plain copy when glTF-Transform isn't installed.

import fs from 'node:fs';
import path from 'node:path';

let gt = null;
export async function optimizerAvailable() {
  if (gt !== null) return !!gt;
  try {
    const [core, fn, ext, mo] = await Promise.all([import('@gltf-transform/core'), import('@gltf-transform/functions'), import('@gltf-transform/extensions'), import('meshoptimizer')]);
    let sharp = null;
    try { sharp = (await import('sharp')).default; } catch { /* textures stay as they are */ }
    await mo.MeshoptEncoder.ready;
    const io = new core.NodeIO().registerExtensions(ext.ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': mo.MeshoptEncoder, 'meshopt.decoder': mo.MeshoptDecoder });
    await mo.MeshoptSimplifier.ready;
    gt = { core, fn, ext, io, MeshoptEncoder: mo.MeshoptEncoder, MeshoptSimplifier: mo.MeshoptSimplifier, sharp };
  } catch { gt = false; }
  return !!gt;
}

// Quaternius .gltf files reference textures that live in a shared folder elsewhere in the pack:
// copy any missing referenced file from where it actually is (same basename, same pack).
export function repairUris(file, packRoot, uris) {
  const fixed = [];
  for (const u of uris || []) {
    const want = path.join(path.dirname(file), decodeURIComponent(u));
    if (fs.existsSync(want)) continue;
    const base = path.basename(want).toLowerCase();
    const hit = findFile(packRoot, (f) => path.basename(f).toLowerCase() === base);
    if (hit) { fs.mkdirSync(path.dirname(want), { recursive: true }); fs.copyFileSync(hit, want); fixed.push(u); }
  }
  return fixed;
}
const dirCache = new Map();
function findFile(root, pred) {
  if (!dirCache.has(root)) {
    const out = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(p); } };
    if (fs.existsSync(root)) walk(root);
    dirCache.set(root, out);
  }
  return dirCache.get(root).find(pred);
}

// Options:
//   hide       node names to delete (held props)
//   keepClips  Set of clip names to keep (others deleted); an empty Set strips all animation
//   animOnly   write an animation library: skeleton + clips, no meshes, materials or textures
//   character  skinned model (no welding)
//   maxTex     longest side for colour textures (they're re-encoded as WebP)
//   simplify   0..1 triangle ratio (meshoptimizer simplifier) — rocks, bushes, and dense characters
export async function optimizeModel(src, dest, { hide = [], keepClips = null, character = false, animOnly = false, maxTex = 512, simplify = 0, pbr = false, dropTextures = false } = {}) {
  const { fn, io, MeshoptEncoder, MeshoptSimplifier, sharp } = gt;
  const doc = await io.read(src);
  // spec/gloss materials (older Sketchfab exports) render white in three.js: convert to metal/rough
  if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'KHR_materials_pbrSpecularGlossiness')) await doc.transform(fn.metalRough());
  const root = doc.getRoot();
  if (animOnly) {
    for (const n of root.listNodes()) { if (n.getMesh()) n.setMesh(null); if (n.getSkin()) n.setSkin(null); }
    for (const m of root.listMeshes()) m.dispose();
  }
  // the cel / ink look only uses base colour: PBR detail maps are dead weight
  // (realistic packs keep normal + roughness maps with `pbr`)
  for (const mat of root.listMaterials()) {
    if (dropTextures) mat.setBaseColorTexture(null);
    if (pbr) { mat.setOcclusionTexture(null); continue; }
    mat.setNormalTexture(null);
    mat.setOcclusionTexture(null);
    mat.setMetallicRoughnessTexture(null);
  }
  if (hide.length) {
    const h = new Set(hide);
    for (const n of root.listNodes()) if (h.has(n.getName())) n.dispose();
  }
  // dispose channels + samplers too, or their keyframe accessors survive prune()
  if (keepClips) for (const a of root.listAnimations()) if (!keepClips.has(a.getName())) { a.listChannels().forEach((c) => c.dispose()); a.listSamplers().forEach((x) => x.dispose()); a.dispose(); }
  await doc.transform(
    fn.prune(),
    fn.dedup(),
    ...(character && !simplify ? [] : [fn.weld()]),
    ...(simplify > 0 ? [fn.simplify({ simplifier: MeshoptSimplifier, ratio: simplify, error: character ? 0.004 : simplify < 0.2 ? 0.05 : 0.01 })] : []),
    fn.resample(),
    fn.quantize({ quantizeTexcoord: 12 }),
    ...(sharp && !animOnly ? [fn.textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [maxTex, maxTex], quality: 85 })] : []),
    fn.meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await io.write(dest, doc);
  return fs.statSync(dest).size;
}
