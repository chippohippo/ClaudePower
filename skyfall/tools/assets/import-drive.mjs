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
import { optimizerAvailable, optimizeModel, optimizePack } from './optimize.mjs';
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

if (all || what.has('kits')) {
  const ESS = 'SciFiEssentials/glTF', MEGA = 'SciFiMega/Modular SciFi MegaKit[Standard]/glTF', NAT = 'NatureMega/glTF';
  const pack = async (dest, entries, o) => {
    const list = entries.map(([dir, n]) => { const f = path.join(X, dir, n + '.gltf'); fixUris(f); return [n, f]; });
    const size = await optimizePack(list, path.join(OUT, dest), o);
    done.push(`${dest}  ${(size / 1024).toFixed(0)} KB  (${list.length} models)`);
    console.log(dest, (size / 1024).toFixed(0), 'KB');
  };
  const E = (...n) => n.map((x) => [ESS, x]), Mg = (sub, ...n) => n.map((x) => [`${MEGA}/${sub}`, x]), N = (...n) => n.map((x) => [NAT, x]);
  await pack('props/kit_props.glb', [
    ...E('Prop_Crate', 'Prop_Crate_Large', 'Prop_Crate_Tarp', 'Prop_Crate_Tarp_Large', 'Prop_Chest', 'Prop_Barrel1', 'Prop_Barrel2_Closed',
      'Prop_Desk_L', 'Prop_Desk_Medium', 'Prop_Desk_Small', 'Prop_Locker', 'Prop_Shelves_WideTall', 'Prop_Shelves_ThinTall', 'Prop_Shelves_WideShort',
      'Prop_SatelliteDish', 'Prop_Chair', 'Prop_Ammo_Closed', 'Prop_HealthPack'),
  ], { maxTex: 1024 });
  await pack('props/kit_station.glb', [
    ...Mg('Props', 'Prop_Crate3', 'Prop_Crate4', 'Prop_Vent_Big', 'Prop_Vent_Wide', 'Prop_Vent_Small', 'Prop_Computer', 'Prop_AccessPoint', 'Prop_Light_Wide', 'Prop_Light_Small',
      'Prop_Light_Floor', 'Prop_Fan_Small', 'Prop_PipeHolder', 'Prop_Barrel_Large', 'Prop_Chest', 'Prop_ItemHolder'),
    ...Mg('Columns', 'Column_Astra', 'Column_Hollow', 'Column_Large_Straight', 'Column_MetalSupport', 'Column_Pipes', 'Column_Round', 'Column_Simple'),
  ], { maxTex: 1024 });
  await pack('nature/kit_trees.glb', N('CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5', 'Pine_1', 'Pine_2', 'Pine_3', 'Pine_4', 'Pine_5',
    'TwistedTree_1', 'TwistedTree_2', 'TwistedTree_3', 'DeadTree_1', 'DeadTree_2', 'DeadTree_3'), { maxTex: 512 });
  await pack('nature/kit_plants.glb', N('Bush_Common', 'Bush_Common_Flowers', 'Fern_1', 'Plant_1_Big', 'Plant_7_Big', 'Plant_1', 'Plant_7', 'Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3',
    'Grass_Common_Short', 'Grass_Common_Tall', 'Grass_Wispy_Short', 'Grass_Wispy_Tall', 'Flower_3_Group', 'Flower_4_Group', 'Clover_1', 'Clover_2',
    'Pebble_Round_1', 'Pebble_Round_2', 'Pebble_Square_1', 'Mushroom_Common'), { maxTex: 512 });
}

fs.writeFileSync(path.join(ROOT, 'assets-src/drive/import-drive.log'), done.join('\n') + '\n');
