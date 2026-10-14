// Imports the packs from the user's Drive folder (assets-src/drive/x/<pack>/…) into public/assets/
// without touching anything else (import.mjs prunes files whose sources are gone, this does not).
//
//   node tools/assets/import-drive.mjs [chars] [anims] [kits]
//
// Writes the optimised files and prints what it made; manifest entries live in overrides.json and
// are merged into public/assets/manifest.json by tools/assets/apply-overrides.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { optimizerAvailable, optimizeModel } from './optimize.mjs';
import { usefulClips } from '../../src/shared/clips.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const X = path.join(ROOT, 'assets-src/drive/x');
const OUT = path.join(ROOT, 'public/assets');
const what = new Set(process.argv.slice(2));
const all = what.size === 0;
if (!(await optimizerAvailable())) throw new Error('glTF-Transform not installed (npm ci)');
const done = [];
// .gltf side files that the pack misnames ("T_Hair_1_Normal_png.png") or keeps in another folder
function fixUris(file) {
  if (!file.endsWith('.gltf')) return;
  const j = JSON.parse(fs.readFileSync(file, 'utf8')), dir = path.dirname(file);
  const pack = path.join(X, path.relative(X, file).split(path.sep)[0]);
  const index = new Map();
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (!index.has(e.name.toLowerCase())) index.set(e.name.toLowerCase(), f); } };
  walk(pack);
  for (const im of [...(j.images || []), ...(j.buffers || [])]) {
    if (!im.uri || im.uri.startsWith('data:')) continue;
    const want = path.join(dir, decodeURIComponent(im.uri));
    if (fs.existsSync(want)) continue;
    const base = path.basename(want).toLowerCase();
    const hit = index.get(base) || index.get(base.replace(/_png\.png$/, '.png')) || index.get(base.replace(/\.png$/, '_png.png'));
    if (hit) { fs.mkdirSync(path.dirname(want), { recursive: true }); fs.copyFileSync(hit, want); console.log('  fixed', im.uri); }
    else console.log('  MISSING', im.uri);
  }
}
async function opt(src, dest, o) {
  fixUris(path.join(X, src));
  const size = await optimizeModel(path.join(X, src), path.join(OUT, dest), o);
  done.push(`${dest}  ${(size / 1024).toFixed(0)} KB`);
  console.log(dest, (size / 1024).toFixed(0), 'KB');
}

if (all || what.has('chars')) {
  const UBC = 'UBC/Universal Base Characters[Standard]';
  for (const g of ['Male', 'Female']) await opt(`${UBC}/Base Characters/Godot - UE/Superhero_${g}_FullBody.gltf`, `characters/UBC_${g}.glb`, { character: true, pbr: true, maxTex: 1024 });
  for (const h of ['Hair_Beard', 'Hair_Buns', 'Hair_Buzzed', 'Hair_BuzzedFemale', 'Hair_Long', 'Hair_SimpleParted', 'Eyebrows_Female', 'Eyebrows_Regular'])
    await opt(`${UBC}/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/${h}.gltf`, `characters/hair/${h}.glb`, { character: true, pbr: true, maxTex: 512 });
}

if (all || what.has('anims')) {
  // every clip a state can use (shared/clips.js patterns + the per-character overrides)
  const ovr = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/assets/overrides.json'), 'utf8')).manifest.characters.default.clips;
  for (const [pack, file, out] of [['UAL1', 'Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb', 'UAL1'], ['UAL2', 'Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb', 'UAL2']]) {
    const src = path.join(X, pack, file);
    const b = fs.readFileSync(src), n = b.readUInt32LE(12), names = JSON.parse(b.subarray(20, 20 + n)).animations.map((a) => a.name);
    const keep = new Set([...usefulClips(names, ovr), ...Object.values(ovr).filter((c) => names.includes(c))]);
    console.log(out, [...keep].join(' '));
    await opt(path.join(pack, file), `animations/${out}.glb`, { animOnly: true, keepClips: keep });
  }
}

fs.writeFileSync(path.join(ROOT, 'assets-src/drive/import-drive.log'), done.join('\n') + '\n');
