// Turns downloaded packs in assets-src/ into game-ready public/assets/ + manifest.json.
//
//   node tools/assets/import.mjs [--dry] [--fresh] [--no-reuse]
//
// 1. unzips every .zip under assets-src/ (next to the zip, nested zips too)
// 2. inspects every .glb/.gltf straight from the glTF JSON + binary (rig, bone names, clips, mesh
//    node names, world-space vertices), and every .fbx / .hdr / texture / audio file
// 3. assigns roles (rules below, then tools/assets/overrides.json on top):
//      characters.default    base rig (+ animation libraries that share ≥60% of its bone names)
//      characters.<legend>   every rigged character is classified Tank / DPS / Support from its
//                            name (knight/warrior/brute → tank, rogue/ranger/ninja → dps,
//                            mage/medic/druid → support …) and matched to that role's legends,
//                            theme words first; Sixes then gets 2/2/2 visually distinct roles
//      hide                  held props baked into character files (swords, shields, staffs,
//                            crossbows …) are hidden so legends carry SKYFALL's guns instead
//      weapons.<id>          archetype from the name (AR, SMG, LMG, shotgun, DMR, sniper, revolver,
//                            pistol; sci-fi blasters prefer the energy SMG), muzzle direction from
//                            the vertex heuristic in src/shared/gunfacing.js → rotY
//      props.<kind>          models draped over map colliders of that kind (crate, container,
//                            barrel, pillar) — the collision stays exactly the same
//      nature.tree/rock/bush up to 4 variants each, picked across model families
//      arms, hdri, textures.<role>, sounds.<recipe>
//    Mixamo: put characters in assets-src/mixamo/characters/*.fbx and animations (exported
//    "Without Skin") in assets-src/mixamo/animations/*.fbx; every Mixamo character gets every
//    Mixamo animation, clips are named after their file (Mixamo calls them all "mixamo.com").
// 4. copies the chosen files (with .bin / texture side files) into public/assets/<category>/ and
//    writes manifest.json, IMPORT_REPORT.md and CREDITS.md
//
// Re-running keeps hand edits: an existing manifest entry that points at the same file is kept
// (--fresh regenerates everything). tools/assets/overrides.json always wins.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readGltf, worldPositions } from './gltfread.mjs';
import { gunFacing } from '../../src/shared/gunfacing.js';
import { LEGENDS, LEGEND_IDS, ROLES } from '../../src/shared/legends.js';
import { WEAPONS } from '../../src/shared/weapons.js';
import { usefulClips } from '../../src/shared/clips.js';
import { optimizerAvailable, optimizeModel, repairUris } from './optimize.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = process.env.ASSETS_SRC || path.join(ROOT, 'assets-src');
const OUT = process.env.ASSETS_OUT || path.join(ROOT, 'public', 'assets');
const DRY = process.argv.includes('--dry');
const FRESH = process.argv.includes('--fresh');
const REUSE = !process.argv.includes('--no-reuse');
// glTF-Transform optimisation (meshopt + quantize + prune) unless --no-optimize or not installed
const OPT = !process.argv.includes('--no-optimize') && !DRY && await optimizerAvailable();
const OVR_PATH = path.join(ROOT, 'tools/assets/overrides.json');
const OVR = fs.existsSync(OVR_PATH) ? JSON.parse(fs.readFileSync(OVR_PATH, 'utf8')) : {};
const report = [];
const log = (s) => { report.push(s); console.log(s); };

// ---------------------------------------------------------------- 1. unzip
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === '__MACOSX') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
function unzipAll() {
  let n = 0;
  for (let pass = 0; pass < 3; pass++) {
    for (const z of walk(SRC).filter((f) => /\.zip$/i.test(f))) {
      const dest = z.replace(/\.zip$/i, '');
      if (fs.existsSync(dest)) continue;
      fs.mkdirSync(dest, { recursive: true });
      try { execFileSync('unzip', ['-oq', z, '-d', dest]); } catch {
        execFileSync('python3', ['-I', '-c', 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', z, dest]);
      }
      n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------- 2. inspect
const EQUIP = /(sword|shield|axe|staff|wand|spellbook|crossbow|knife|dagger|throwable|mug|^bow|_bow|quiver|arrow|hammer|mace|spear|scythe|lantern|torch|pickaxe|club)/i;
function inspect(file) {
  const info = { file, ext: path.extname(file).toLowerCase(), name: path.basename(file).replace(/\.[^.]+$/, ''), size: fs.statSync(file).size };
  if (info.ext === '.fbx') { info.kind = 'fbx'; return info; }
  try {
    const g = readGltf(file);
    const j = g.json;
    info.animations = (j.animations || []).map((a) => a.name || '');
    info.skinned = !!(j.skins && j.skins.length);
    info.prims = (j.meshes || []).reduce((n, m) => n + m.primitives.length, 0);
    const jointIdx = new Set((j.skins || []).flatMap((s) => s.joints));
    info.bones = [...jointIdx].map((i) => (j.nodes[i] && j.nodes[i].name) || '');
    info.meshNodes = (j.nodes || []).filter((n) => n.mesh !== undefined).map((n) => n.name || '');
    info.equipment = info.skinned ? info.meshNodes.filter((n) => EQUIP.test(n)) : [];
    info.uris = [...(j.buffers || []), ...(j.images || [])].map((b) => b.uri).filter((u) => u && !u.startsWith('data:'));
    // textures that live elsewhere in the pack (Quaternius shared texture folders) are put back
    if (!DRY) info.repaired = repairUris(file, path.join(SRC, path.relative(SRC, file).split(path.sep)[0]), info.uris);
    info.kind = 'gltf';
    info._g = g; // positions decoded lazily (guns, props)
  } catch (e) { info.kind = 'bad'; info.error = e.message; }
  return info;
}
const positions = (m) => (m._pos ||= m._g ? worldPositions(m._g) : new Float32Array());
function bounds(m) {
  const p = positions(m);
  if (!p.length) return null;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[i + k]); mx[k] = Math.max(mx[k], p[i + k]); }
  return mx.map((v, k) => +(v - mn[k]).toFixed(3));
}

// ---------------------------------------------------------------- 3. roles
const rel = (f) => path.relative(SRC, f);
const words = (f) => rel(f).toLowerCase();
const extracted = DRY ? 0 : unzipAll();
const all = walk(SRC);
const models = all.filter((f) => /\.(glb|gltf|fbx)$/i.test(f)).map(inspect).filter((m) => m.kind !== 'bad');
// same asset in several formats (Quaternius ships FBX / OBJ / glTF): glb > gltf > fbx
const rank = { '.glb': 0, '.gltf': 1, '.fbx': 2 };
const pack = (m) => rel(m.file).split(path.sep)[0];
const byName = new Map();
for (const m of models) { const k = pack(m) + '|' + m.name.toLowerCase(); const o = byName.get(k); if (!o || rank[m.ext] < rank[o.ext]) byName.set(k, m); }
const uniq = [...byName.values()];
log(`# SKYFALL asset import\n\nsource: ${path.relative(ROOT, SRC)} — ${all.length} files, ${extracted} zips extracted, ${uniq.length} models\n`);

const manifest = { characters: {}, weapons: {}, props: {}, nature: {}, textures: {}, sounds: {} };
const libs = []; // shared animation libraries to write
const chosen = new Map();
const optimizable = (m) => OPT && (m.ext === '.glb' || m.ext === '.gltf');
const destOf = (cat, m) => `${cat}/${(m.prefix ? m.prefix + '_' : '')}${m.name.replace(/[^\w.-]+/g, '_')}${optimizable(m) ? '.glb' : m.ext}`;
const use = (cat, m, opt = {}) => { const d = destOf(cat, m); const o = chosen.get(m.file); chosen.set(m.file, { d, m, opt: { ...(o && o.opt), ...opt } }); return d; };

const isMixamoAnim = (m) => /[\\/]mixamo[\\/]animations[\\/]/i.test(m.file);
const isMixamoChar = (m) => /[\\/]mixamo[\\/]characters[\\/]/i.test(m.file);
const isArms = (m) => /(wrad|fps.?arms|[\\/]arms[\\/]|\barms\b|first.?person)/i.test(words(m.file));
const isLib = (m) => !isMixamoChar(m) && (isMixamoAnim(m) || (m.kind === 'gltf' && m.skinned && (m.animations || []).length >= 8 && (/(^|[^a-z])(ual|anim|animation|library|locomotion)/i.test(m.name) || m.prims === 0)));
const rigged = uniq.filter((m) => !isArms(m) && !isLib(m) && (m.skinned || isMixamoChar(m) || (m.kind === 'fbx' && /charact|human|soldier|male|female/i.test(words(m.file)))));

// --- characters: role classification → legends of that role
const ROLE_WORDS = {
  tank: /(knight|warrior|barbarian|brute|tank|heavy|golem|robot|mech|guard|paladin|viking|giant|ogre|juggernaut|soldier|swat)/i,
  dps: /(rogue|ninja|assassin|hunter|ranger|runner|thief|archer|scout|pirate|punk|cowboy|duelist|hooded)/i,
  support: /(mage|medic|doctor|nurse|druid|priest|cleric|healer|wizard|witch|engineer|scientist|minion|shaman|monk)/i,
};
const LEGEND_THEME = {
  kodiak: /(knight|paladin|swat|riot|guard)/i, bastion: /(barbarian|viking|giant|golem|heavy)/i, miasma: /(warrior|zombie|plague|toxic|hazmat|skeleton_warrior)/i,
  jolt: /(rogue(?!_hood)|runner|punk|skater)/i, phantom: /(hood|ninja|assassin|ghost|thief)/i, spectre: /(skeleton_rogue|pilot|astronaut|jet|pirate)/i,
  halo: /(^mage$|medic|doctor|nurse|cleric|priest|healer)/i, echo: /(skeleton_mage|hunter|ranger|druid|scout|archer)/i, volt: /(minion|engineer|soldier|commander|officer|scientist)/i,
};
const roleOf = (m) => {
  const n = m.name.replace(/[_-]+/g, '_');
  for (const r of ['tank', 'support', 'dps']) if (ROLE_WORDS[r].test(n)) return r;
  return null;
};
const overlap = (a, b) => {
  const s = new Set((a || []).map((x) => x.replace(/[^a-z0-9]/gi, '').toLowerCase()));
  const t = (b || []).map((x) => x.replace(/[^a-z0-9]/gi, '').toLowerCase());
  return t.length ? t.filter((x) => s.has(x)).length / t.length : 0;
};
const charEntry = (m) => {
  // ship only the clips the game can map to a state, and drop held props from the file itself
  const e = { file: use('characters', m, { character: true, hide: m.equipment || [], keepClips: usefulClips(m.animations || []) }), height: 1.8 };
  if (m.equipment && m.equipment.length) e.hide = m.equipment;
  // single-atlas characters (KayKit, Kenney) keep their own colours; legend tint stays subtle
  e.tintAmount = (m.meshNodes || []).length > 3 ? 0.22 : 0.6;
  if (isMixamoChar(m)) e.animations = uniq.filter(isMixamoAnim).map((a) => use('animations', a));
  return e;
};
const bases = rigged.filter((m) => /(base|ubc|universal|superhero|mannequin|^male|^female|regular)/i.test(m.name) || /universal.?base/i.test(words(m.file)));
const base = bases[0] || rigged.find((m) => (m.animations || []).length >= 4 || isMixamoChar(m)) || rigged[0];
if (base) {
  const lib = uniq.filter(isLib).filter((l) => isMixamoAnim(l) ? isMixamoChar(base) : overlap(base.bones, l.bones) > 0.6);
  manifest.characters.default = charEntry(base);
  if (lib.length && !manifest.characters.default.animations) manifest.characters.default.animations = lib.map((l) => use('animations', l));
  log(`characters.default   ← ${rel(base.file)} (${(base.animations || []).length} clips${lib.length ? ` + ${lib.length} animation files` : ''})`);
}
const pool = rigged.filter((m) => m !== base || rigged.length >= LEGEND_IDS.length);
const byRole = { tank: [], dps: [], support: [], none: [] };
for (const m of pool) byRole[roleOf(m) || 'none'].push(m);
const assigned = new Map();
for (const role of ['tank', 'dps', 'support']) {
  const legends = LEGEND_IDS.filter((id) => LEGENDS[id].cls === role);
  const cands = byRole[role];
  // theme matches first, then the rest of that role, then unclassified models
  for (const lg of legends) { const i = cands.findIndex((m) => LEGEND_THEME[lg].test(m.name)); if (i >= 0) assigned.set(lg, cands.splice(i, 1)[0]); }
  for (const lg of legends) if (!assigned.has(lg) && cands.length) assigned.set(lg, cands.shift());
  for (const lg of legends) if (!assigned.has(lg) && byRole.none.length) assigned.set(lg, byRole.none.shift());
  byRole.leftover = (byRole.leftover || []).concat(cands);
}
for (const lg of LEGEND_IDS) if (!assigned.has(lg) && byRole.leftover && byRole.leftover.length) assigned.set(lg, byRole.leftover.shift());
for (const lg of LEGEND_IDS) {
  const m = assigned.get(lg);
  if (!m) continue;
  manifest.characters[lg] = { ...charEntry(m), role: LEGENDS[lg].cls };
  log(`characters.${lg.padEnd(9)}← ${rel(m.file)}  [${ROLES[LEGENDS[lg].cls].label}${roleOf(m) && roleOf(m) !== LEGENDS[lg].cls ? `, model reads as ${roleOf(m)}` : ''}]${m.equipment && m.equipment.length ? `  hides ${m.equipment.length} held props` : ''}`);
}
// characters sharing one rig (KayKit, Quaternius UBC …) share one animation library: the clips are
// written once to animations/<rig>.glb and stripped from every character file
if (OPT) {
  const sig = (m) => (m.bones || []).map((b) => b.toLowerCase()).sort().join('|');
  const groups = new Map();
  for (const [key, e] of Object.entries(manifest.characters)) {
    const m = [...chosen.values()].find((c) => c.d === e.file)?.m;
    if (!m || !m.bones || !m.bones.length || !(m.animations || []).length || e.animations) continue;
    const k = sig(m);
    if (!groups.has(k)) groups.set(k, { src: m, keys: [] });
    groups.get(k).keys.push(key);
  }
  let gi = 0;
  for (const g of groups.values()) {
    if (g.keys.length < 2) continue;
    const lib = { ...g.src, name: `rig${gi++}_${pack(g.src).replace(/[^\w]+/g, '_')}_anims`, file: g.src.file };
    const libDest = `animations/${lib.name}.glb`;
    libs.push({ src: g.src.file, dest: libDest, keepClips: usefulClips(g.src.animations) });
    for (const key of g.keys) {
      manifest.characters[key].animations = [libDest];
      const c = [...chosen.values()].find((x) => x.d === manifest.characters[key].file);
      c.opt.keepClips = new Set();
    }
    log(`  shared animation library ${libDest}: ${usefulClips(g.src.animations).size} clips for ${g.keys.length} characters`);
  }
}

const roleCount = {};
for (const lg of LEGEND_IDS) if (manifest.characters[lg]) roleCount[LEGENDS[lg].cls] = (roleCount[LEGENDS[lg].cls] || 0) + 1;
if (Object.keys(manifest.characters).length > 1) log(`  role coverage: ${Object.entries(roleCount).map(([r, n]) => `${n} ${r}`).join(' / ')} (Sixes needs 2/2/2 distinct)`);

// --- weapons: archetype by name, facing by geometry
const statics = uniq.filter((m) => !m.skinned && !isArms(m) && !isMixamoAnim(m) && !isMixamoChar(m));
const ARCH = [
  ['Sniper', /(sniper|awp|barrett|bolt.?action|kar98|longbow|railgun)/i],
  ['Marksman', /(dmr|marksman|scout|g3|m14|battle.?rifle|semi.?auto)/i],
  ['Shotgun', /(shotgun|spas|pump|double.?barrel|sawed|sawn)/i],
  ['LMG', /(lmg|minigun|machine.?gun|m249|gatling|heavy.?gun)/i],
  ['SMG', /(smg|uzi|mp5|mp7|submachine|vector|p90|repeater|tommy)/i],
  ['Revolver', /(revolver|magnum|deagle|desert.?eagle|wingman)/i],
  ['Pistol', /(pistol|handgun|glock|m1911|beretta|usp|blaster)/i],
  ['AR', /(ak.?47|ak|assault|\bar\b|m4|m16|carbine|rifle|famas|aug|g36|scar|bullpup)/i],
];
const NOT_GUN = /(bullet|ammo|shell|casing|grenade|rocket(?!.*launcher)|explosive|magazine|scope|crate|holster|case|bag|stand|rack)/i;
const archOf = (m) => { if (NOT_GUN.test(m.name)) return null; for (const [a, re] of ARCH) if (re.test(m.name)) return a; return null; };
const guns = statics.map((m) => ({ m, arch: archOf(m), scifi: /(blaster|plasma|laser|energy|sci.?fi|pulse|ray)/i.test(m.name) })).filter((g) => g.arch);
const WANT = { talon: 'AR', mauler: 'AR', hornet: 'SMG', volt: 'SMG', bulwark: 'LMG', breacher: 'Shotgun', scout: 'Marksman', sentinel: 'Sniper', viper: 'Revolver', p20: 'Pistol' };
const FALLBACK = { Revolver: ['Pistol'], Marksman: ['AR', 'Sniper'], LMG: ['AR'], Sniper: ['Marksman'] };
const usedGun = new Set();
const order = ['volt', 'talon', 'hornet', 'bulwark', 'breacher', 'scout', 'sentinel', 'viper', 'p20', 'mauler'];
for (const id of order) {
  const want = WANT[id];
  const pickFrom = (arch, allowUsed) => {
    let c = guns.filter((g) => g.arch === arch && (allowUsed || !usedGun.has(g)));
    if (id === 'volt') c.sort((a, b) => b.scifi - a.scifi); else c.sort((a, b) => a.scifi - b.scifi);
    return c[0];
  };
  let g = pickFrom(want, false) || (FALLBACK[want] || []).map((a) => pickFrom(a, false)).find(Boolean);
  if (!g && REUSE) g = pickFrom(want, true);
  if (!g) continue;
  usedGun.add(g);
  const f = gunFacing(positions(g.m));
  const e = { file: use('weapons', g.m), rotY: +f.rotY.toFixed(4), archetype: g.arch };
  manifest.weapons[id] = e;
  log(`weapons.${id.padEnd(9)}← ${rel(g.m.file)}  [${g.arch} for ${WEAPONS[id].cls}; muzzle ${f.sign > 0 ? '+' : '-'}${f.axis}, confidence ${f.confidence.toFixed(2)}${f.confidence < 0.3 ? ' — CHECK IN VIEWER' : ''}]`);
}
const missing = Object.keys(WANT).filter((id) => !manifest.weapons[id]);
if (missing.length) log(`  procedural guns kept for: ${missing.join(', ')}`);

// --- first-person arms
const arms = uniq.find((m) => isArms(m) && (m.skinned || m.kind === 'fbx'));
if (arms) { manifest.arms = { file: use('arms', arms), scale: 1, pos: [0, 0, 0], rot: [0, 0, 0] }; log(`arms                 ← ${rel(arms.file)} (tune pos/rot/scale in the viewer)`); }

// --- nature: variety across families (CommonTree_1, Pine_2, … rather than 4× the same family)
const NATURE = {
  // autumn / red foliage (e.g. Quaternius TwistedTree) is skipped: red is the enemy-highlight colour
  tree: [/(tree|pine|birch|oak|palm|fir|spruce|willow)/i, /(stump|log|fallen|_cut|cut$|dead|leaf$|leaves$|branch|trees_|twisted|autumn|orange|red)/i],
  rock: [/(rock|boulder|cliff)/i, /(path|tile|wall|floor|brick|pebble|resource|rocks_)/i],
  bush: [/(bush|shrub|hedge|fern|plant_?bush)/i, /(flower|mushroom|grass)/i],
};
const family = (m) => m.name.replace(/[_-]?\d+$/, '').replace(/_(big|small|large|medium|[a-e])$/i, '').toLowerCase();
for (const [kind, [re, not]] of Object.entries(NATURE)) {
  const c = statics.filter((m) => re.test(m.name) && !not.test(m.name)).sort((a, b) => rank[a.ext] - rank[b.ext] || a.name.localeCompare(b.name));
  const fams = new Map();
  for (const m of c) { const f = family(m); if (!fams.has(f)) fams.set(f, []); fams.get(f).push(m); }
  const picks = [];
  for (let round = 0; picks.length < 4 && round < 4; round++) for (const list of fams.values()) if (list[round] && picks.length < 4) picks.push(list[round]);
  // light simplification where it helps (rocks, bushes); tree foliage is leaf cards the simplifier
  // can't merge, so trees get a distance LOD at runtime instead (client/world.js)
  const SIMPLIFY = { rock: 0.8, bush: 0.6 };
  if (picks.length) { manifest.nature[kind] = picks.map((m) => use('nature', m, { simplify: SIMPLIFY[kind] || 0 })); log(`nature.${kind.padEnd(14)}← ${picks.map((m) => rel(m.file)).join(', ')}`); }
}

// --- props draped over map colliders of the same kind (collision unchanged)
const PROPS = {
  crate: [/(crate|box_|cargo_[ab]$|cargo_[ab]_packed|chest)/i, /(open|lid|empty|stack)/i],
  container: [/(container|cargo_.*stacked|shipping)/i, /(containers_[a-d]$)/i],
  barrel: [/(barrel)/i, /(bucket)/i],
  pillar: [/(column|pillar)/i, /(curve|broken)/i],
};
for (const [kind, [re, not]] of Object.entries(PROPS)) {
  const c = statics.filter((m) => re.test(m.name) && !not.test(m.name)).sort((a, b) => rank[a.ext] - rank[b.ext] || a.name.localeCompare(b.name)).slice(0, 4);
  if (c.length) { manifest.props[kind] = c.map((m) => use('props', m)); log(`props.${kind.padEnd(15)}← ${c.map((m) => rel(m.file)).join(', ')}`); }
}

// --- hdri: daylight first
const HDRI_PREF = [/quarry|kloofendal|puresky|meadow|sunny|day|park|field/i, /sunrise|morning|sunset/i, /./];
const hdrs = all.filter((f) => /\.hdr$/i.test(f));
const hdr = HDRI_PREF.map((re) => hdrs.find((h) => re.test(path.basename(h)))).find(Boolean);
if (hdr) { manifest.hdri = { file: use('hdri', { file: hdr, name: path.basename(hdr, '.hdr'), ext: '.hdr' }), intensity: 0.6, background: false }; log(`hdri                 ← ${rel(hdr)}`); }

// --- textures: colour maps in folders named after the role (Poly Haven diffuse or ambientCG _Color)
for (const role of ['ground', 'wall', 'floor', 'metal', 'wood', 'rock', 'roof']) {
  const imgs = all.filter((f) => /\.(jpe?g|png)$/i.test(f) && new RegExp(`[\\\\/]${role}[\\\\/]`, 'i').test(f) && /(diff|_color|albedo|basecolor)/i.test(path.basename(f)));
  const f = imgs.find((x) => /polyhaven/i.test(x)) || imgs[0];
  if (f) { manifest.textures[role] = { map: use('textures', { file: f, name: `${role}_${path.basename(f).replace(/\.[^.]+$/, '')}`, ext: OPT ? '.jpg' : path.extname(f) }), scale: role === 'ground' ? 4 : 2, strength: role === 'ground' ? 0.55 : 0.5 }; log(`textures.${role.padEnd(12)}← ${rel(f)}`); }
}

// --- sounds: recorded samples replace the synth recipe of the same name
const SOUNDS = { ui: /(click|select|confirm)/i, ui_hover: /(rollover|hover|tick)/i, pickup: /(pickup|coin|collect)/i, bin_open: /(open|door|chest)/i, draw: /(weapon_change|equip|draw)/i };
const auds = all.filter((f) => /\.(ogg|wav|mp3)$/i.test(f));
for (const [name, re] of Object.entries(SOUNDS)) {
  const f = auds.find((a) => re.test(path.basename(a)));
  if (f) { manifest.sounds[name] = use('audio', { file: f, name: `${name}_${path.basename(f).replace(/\.[^.]+$/, '')}`, ext: path.extname(f) }); log(`sounds.${name.padEnd(14)}← ${rel(f)}`); }
}

// --- manual overrides always win (deep merge; null deletes)
const deepMerge = (a, b) => {
  if (b === null) return undefined;
  if (typeof b !== 'object' || Array.isArray(b) || typeof a !== 'object' || !a) return b;
  const r = { ...a };
  for (const k of Object.keys(b)) { if (k.startsWith('_')) continue; const v = deepMerge(a[k], b[k]); if (v === undefined) delete r[k]; else r[k] = v; }
  return r;
};
let final = manifest;
if (OVR.manifest) { final = deepMerge(final, OVR.manifest); log(`\noverrides: applied tools/assets/overrides.json`); }
for (const k of Object.keys(final)) if (final[k] && typeof final[k] === 'object' && !Array.isArray(final[k]) && !Object.keys(final[k]).length) delete final[k];

// ---------------------------------------------------------------- 4. write
const manPath = path.join(OUT, 'manifest.json');
if (!FRESH && fs.existsSync(manPath)) {
  const old = JSON.parse(fs.readFileSync(manPath, 'utf8'));
  const keep = (n, o) => {
    if (!o || typeof n !== 'object' || Array.isArray(n)) return n;
    if (n.file && o.file === n.file) return { ...n, ...o };
    const r = { ...n };
    for (const k of Object.keys(n)) r[k] = keep(n[k], o[k]);
    return r;
  };
  final = keep(final, old);
  if (OVR.manifest) final = deepMerge(final, OVR.manifest);
}
if (!DRY) {
  let before = 0, after = 0;
  for (const [src, { d, m, opt }] of chosen) {
    const to = path.join(OUT, d);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (optimizable(m)) {
      before += m.size + (m.uris || []).reduce((n, u) => { const f = path.join(path.dirname(src), decodeURIComponent(u)); return n + (fs.existsSync(f) ? fs.statSync(f).size : 0); }, 0);
      try { after += await optimizeModel(src, to, opt); continue; } catch (e) { log(`  ! optimise failed for ${rel(src)} (${e.message}); copying as-is`); fs.rmSync(to, { force: true }); }
    }
    // surface textures only feed luminance detail: 512 px JPEG is plenty
    if (d.startsWith('textures/') && OPT) {
      try { const sharp = (await import('sharp')).default; await sharp(src).resize(512, 512, { fit: 'inside' }).jpeg({ quality: 82 }).toFile(to.replace(/\.png$/i, '.jpg')); continue; } catch { /* plain copy below */ }
    }
    fs.copyFileSync(src, to);
    for (const u of m.uris || []) {
      const from = path.join(path.dirname(src), decodeURIComponent(u));
      if (fs.existsSync(from)) { const t = path.join(path.dirname(to), decodeURIComponent(u)); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.copyFileSync(from, t); }
      else log(`  ! ${rel(src)} references missing ${u}`);
    }
  }
  for (const l of libs) {
    try { after += await optimizeModel(l.src, path.join(OUT, l.dest), { animOnly: true, keepClips: l.keepClips, character: true }); } catch (e) { log(`  ! animation library ${l.dest} failed: ${e.message}`); }
  }
  if (OPT && before) log(`\noptimised models: ${(before / 1e6).toFixed(1)} MB → ${(after / 1e6).toFixed(1)} MB (meshopt + quantize, unused clips and held props removed)`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(manPath, JSON.stringify(final, null, 2));
  // drop files from earlier imports that nothing in the manifest references any more
  const refs = JSON.stringify(final);
  let removed = 0;
  for (const dir of ['characters', 'animations', 'weapons', 'arms', 'nature', 'props', 'textures', 'hdri', 'audio']) {
    for (const f of walk(path.join(OUT, dir))) {
      const r = path.relative(OUT, f).split(path.sep).join('/');
      if (/\.(glb|gltf|fbx|hdr|jpe?g|png|webp|ogg|wav|mp3)$/i.test(r) && !refs.includes(`"${r}"`) && ![...chosen.values()].some((c) => path.dirname(c.d) === path.dirname(r) && /\.gltf$/i.test(c.d))) { fs.rmSync(f); removed++; }
    }
  }
  if (removed) log(`removed ${removed} stale files from earlier imports`);
  const SRCS = [
    [/quaternius/i, 'Quaternius (quaternius.com) — CC0'], [/kenney/i, 'Kenney (kenney.nl) — CC0'], [/polyhaven|poly.?haven/i, 'Poly Haven (polyhaven.com) — CC0'],
    [/ambientcg/i, 'ambientCG (ambientcg.com) — CC0'], [/3dmodelscc0/i, '3dmodelscc0 (itch.io) — CC0'], [/wrad|wriks/i, 'WRAD ARMS by wriks (itch.io) — see its itch.io page for the license'],
    [/kaykit|lousberg/i, 'KayKit by Kay Lousberg (kaylousberg.com) — CC0'], [/mixamo/i, 'Mixamo (Adobe) — Mixamo terms, not CC0'],
  ];
  const used = new Set();
  for (const src of chosen.keys()) for (const [re, label] of SRCS) if (re.test(src)) used.add(label);
  fs.writeFileSync(path.join(OUT, 'CREDITS.md'), `# Third-party assets\n\n${[...used].map((u) => `- ${u}`).join('\n') || '- (none yet)'}\n\nFiles and roles: see IMPORT_REPORT.md.\n`);
  fs.writeFileSync(path.join(OUT, 'IMPORT_REPORT.md'), report.join('\n') + '\n');
}
log(`\n${DRY ? '[dry run] would write' : 'wrote'} ${chosen.size} files + manifest.json → ${path.relative(ROOT, OUT)}`);
if (!chosen.size) log('Nothing matched. Put pack zips/folders under assets-src/ (see assets-src/README.md).');
