// Turns downloaded packs in assets-src/ into game-ready public/assets/ + manifest.json.
//
//   node tools/assets/import.mjs [--dry] [--fresh]
//
// 1. unzips every .zip under assets-src/ (next to the zip)
// 2. inspects every .glb/.gltf (rig, clips, bounds; read straight from the glTF JSON), .fbx, .hdr,
//    texture and audio file
// 3. assigns roles by name rules tuned for Quaternius / Kenney / 3dmodelscc0 / WRAD / Poly Haven /
//    ambientCG naming:
//      characters.default   rigged base character (Universal Base Characters) + animation library
//      characters.<legend>  other rigged characters with their own clips (Ultimate Animated
//                           Character Pack, KayKit), matched to legends by theme words
//      weapons.<id>         guns by type (AR, SMG, LMG, shotgun, DMR, sniper, revolver, pistol)
//      arms                 first-person arms (WRAD ARMS)
//      nature.tree/rock/bush up to 4 variants each (Kenney Nature Kit / Quaternius Nature MegaKit)
//      hdri, textures.<role>, sounds.<name>
// 4. copies the chosen files (with their .bin / texture side files) into public/assets/<category>/
//    and writes manifest.json, IMPORT_REPORT.md and CREDITS.md
//
// Re-running keeps hand edits: an existing manifest entry that points at the same file is kept
// as-is (use --fresh to regenerate everything).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = process.env.ASSETS_SRC || path.join(ROOT, 'assets-src');
const OUT = process.env.ASSETS_OUT || path.join(ROOT, 'public', 'assets');
const DRY = process.argv.includes('--dry');
const FRESH = process.argv.includes('--fresh');
const S = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/assets/sources.json'), 'utf8'));
const LEGENDS = ['jolt', 'phantom', 'halo', 'bastion', 'echo', 'miasma', 'volt', 'spectre', 'kodiak'];
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
  for (let pass = 0; pass < 3; pass++) { // zips inside zips
    for (const z of walk(SRC).filter((f) => /\.zip$/i.test(f))) {
      const dest = z.replace(/\.zip$/i, '');
      if (fs.existsSync(dest)) continue;
      fs.mkdirSync(dest, { recursive: true });
      try { execFileSync('unzip', ['-oq', z, '-d', dest]); } catch {
        execFileSync('python3', ['-c', 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', z, dest]);
      }
      n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------- 2. inspect glTF
function readGltfJson(file) {
  const buf = fs.readFileSync(file);
  if (/\.gltf$/i.test(file)) return JSON.parse(buf.toString('utf8'));
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.slice(20, 20 + len).toString('utf8'));
}
function inspect(file) {
  const info = { file, ext: path.extname(file).toLowerCase(), name: path.basename(file).replace(/\.[^.]+$/, ''), size: fs.statSync(file).size };
  if (info.ext === '.fbx') { info.kind = 'fbx'; return info; }
  try {
    const j = readGltfJson(file);
    info.animations = (j.animations || []).map((a) => a.name || '');
    info.skinned = !!(j.skins && j.skins.length);
    info.prims = (j.meshes || []).reduce((n, m) => n + m.primitives.length, 0);
    const jointIdx = new Set((j.skins || []).flatMap((s) => s.joints));
    info.bones = [...jointIdx].map((i) => (j.nodes[i] && j.nodes[i].name) || '');
    // rough bounds from POSITION accessors (node transforms ignored)
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const m of j.meshes || []) for (const p of m.primitives) {
      const a = j.accessors[p.attributes.POSITION];
      if (a && a.min && a.max) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], a.min[k]); mx[k] = Math.max(mx[k], a.max[k]); }
    }
    info.size3 = mn[0] < Infinity ? mx.map((v, k) => +(v - mn[k]).toFixed(3)) : null;
    info.uris = [...(j.buffers || []), ...(j.images || [])].map((b) => b.uri).filter((u) => u && !u.startsWith('data:'));
    info.kind = 'gltf';
  } catch (e) { info.kind = 'bad'; info.error = e.message; }
  return info;
}

// ---------------------------------------------------------------- 3. roles
const rel = (f) => path.relative(SRC, f);
const words = (f) => rel(f).toLowerCase();
const pick = (list, res, not) => list.filter((m) => res.test(words(m.file)) && !(not && not.test(words(m.file))));

const files = () => walk(SRC);
const extracted = DRY ? 0 : unzipAll();
const all = files();
const models = all.filter((f) => /\.(glb|gltf|fbx)$/i.test(f)).map(inspect).filter((m) => m.kind !== 'bad');
// prefer glb > gltf > fbx when the same asset ships in several formats
const rank = { '.glb': 0, '.gltf': 1, '.fbx': 2 };
const byName = new Map();
for (const m of models) { const k = m.name.toLowerCase() + '|' + path.dirname(path.dirname(m.file)); const o = byName.get(k); if (!o || rank[m.ext] < rank[o.ext]) byName.set(k, m); }
const uniq = [...byName.values()];
log(`# SKYFALL asset import\n\nsource: ${path.relative(ROOT, SRC)} — ${all.length} files, ${extracted} zips extracted, ${uniq.length} models\n`);

const isLib = (m) => m.kind === 'gltf' && m.skinned && (m.animations || []).length >= 8 && (/(^|[^a-z])(ual|anim|animation|library|locomotion)/i.test(m.name) || m.prims === 0);
const isArms = (m) => /(wrad|fps.?arms|\barms\b|first.?person)/i.test(words(m.file));
const rigged = uniq.filter((m) => (m.skinned || (m.kind === 'fbx' && /charact|human|soldier|male|female/i.test(words(m.file)))) && !isArms(m) && !isLib(m));
const libs = uniq.filter(isLib);
const manifest = { characters: {}, weapons: {}, nature: {}, textures: {}, sounds: {} };
const chosen = new Map(); // src -> { dest, info }
const dest = (cat, m) => `${cat}/${m.name.replace(/[^\w.-]+/g, '_')}${m.ext}`;
const use = (cat, m) => { const d = dest(cat, m); chosen.set(m.file, { d, m }); return d; };

// characters: default base + animation library sharing its bone names
const overlap = (a, b) => { const s = new Set((a || []).map((x) => x.replace(/[^a-z0-9]/gi, '').toLowerCase())); const t = (b || []).map((x) => x.replace(/[^a-z0-9]/gi, '').toLowerCase()); return t.length ? t.filter((x) => s.has(x)).length / t.length : 0; };
const bases = rigged.filter((m) => /(base|ubc|universal|superhero|mannequin|^male|^female|regular)/i.test(m.name) || /universal.?base/i.test(words(m.file)));
const base = bases[0] || rigged.find((m) => (m.animations || []).length >= 4) || rigged[0];
if (base) {
  const lib = libs.filter((l) => overlap(base.bones, l.bones) > 0.6);
  manifest.characters.default = { file: use('characters', base), animations: lib.map((l) => use('animations', l)), height: 1.8 };
  log(`characters.default  ← ${rel(base.file)}  (${(base.animations || []).length} clips${lib.length ? ` + ${lib.map((l) => `${rel(l.file)} [${l.animations.length}]`).join(', ')}` : ''})`);
}
// per-legend characters with their own clips
const THEME = {
  kodiak: /(soldier|knight|robot|heavy|tank|swat|guard)/i, bastion: /(robot|knight|armou?r|mech|soldier|guard)/i,
  miasma: /(zombie|hazmat|witch|goblin|plague|toxic)/i, jolt: /(punk|runner|casual|street|skater|ninja)/i,
  phantom: /(ninja|rogue|hood|wizard|thief|assassin|ghost)/i, spectre: /(pilot|astronaut|space|jet|aviator)/i,
  halo: /(doctor|medic|nurse|angel|priest|scientist)/i, echo: /(hunter|ranger|scout|elf|archer|explorer)/i,
  volt: /(commander|officer|military|soldier|agent)/i,
};
const pool = rigged.filter((m) => m !== base && ((m.animations || []).length >= 4 || m.kind === 'fbx'));
for (const lg of LEGENDS) {
  const i = pool.findIndex((m) => THEME[lg].test(m.name));
  if (i >= 0) { const m = pool.splice(i, 1)[0]; manifest.characters[lg] = { file: use('characters', m), height: 1.8 }; log(`characters.${lg.padEnd(8)}← ${rel(m.file)}`); }
}
for (const lg of LEGENDS) {
  if (manifest.characters[lg] || !pool.length) continue;
  const m = pool.shift();
  manifest.characters[lg] = { file: use('characters', m), height: 1.8 };
  log(`characters.${lg.padEnd(8)}← ${rel(m.file)} (round-robin)`);
}

// weapons
const statics = uniq.filter((m) => !m.skinned && !isArms(m));
const gunPool = statics.filter((m) => /(gun|rifle|pistol|smg|shotgun|sniper|revolver|ak|m4|uzi|blaster|weapon|lmg|carbine|magnum|deagle)/i.test(words(m.file)) && !/(bullet|ammo|shell|casing|grenade|rocket|explosive|mag(azine)?$|scope$|crate)/i.test(m.name));
const GUNS = [
  ['talon', /(ak.?47|assault|\bar\b|m4|m16|carbine|rifle_?1|scar)/i, /(sniper|shotgun|smg)/i],
  ['mauler', /(ak|assault|rifle|famas|aug|g36|bullpup)/i, /(sniper|shotgun|smg|pistol)/i],
  ['hornet', /(smg|uzi|mp5|mp7|submachine|vector|p90)/i],
  ['volt', /(blaster|plasma|laser|energy|sci.?fi|smg)/i],
  ['bulwark', /(lmg|minigun|machine.?gun|m249|heavy)/i],
  ['breacher', /(shotgun|spas|pump)/i],
  ['scout', /(dmr|marksman|scout|semi|rifle)/i, /(assault|ak|smg)/i],
  ['sentinel', /(sniper|awp|barrett|bolt)/i],
  ['viper', /(revolver|magnum|deagle|desert.?eagle|wingman)/i],
  ['p20', /(pistol|handgun|glock|m1911|beretta)/i, /(revolver|magnum)/i],
];
const usedGun = new Set();
for (const [id, re, not] of GUNS) {
  let c = gunPool.filter((m) => re.test(m.name) && !(not && not.test(m.name)) && !usedGun.has(m));
  if (!c.length) c = gunPool.filter((m) => re.test(m.name) && !(not && not.test(m.name)));
  if (!c.length) continue;
  const m = c[0];
  usedGun.add(m);
  const e = { file: use('weapons', m) };
  // barrel along the longest horizontal axis; X-long guns get turned to point along -Z
  if (m.size3 && m.size3[0] > m.size3[2]) e.rotY = Math.PI / 2;
  manifest.weapons[id] = e;
  log(`weapons.${id.padEnd(9)}← ${rel(m.file)}${e.rotY ? ' (rotated: verify muzzle direction in the viewer)' : ''}`);
}

// first-person arms
const arms = uniq.find((m) => isArms(m) && (m.skinned || m.kind === 'fbx'));
if (arms) { manifest.arms = { file: use('arms', arms), scale: 1, pos: [0, 0, 0], rot: [0, 0, 0] }; log(`arms            ← ${rel(arms.file)} (tune pos/rot/scale in the viewer)`); }

// nature
const NATURE = {
  tree: [/(tree|pine|birch|oak|palm|fir|spruce|willow)/i, /(stump|log|fallen|trunk_?only|leaf$|leaves$|branch)/i],
  rock: [/(rock|stone|boulder|cliff)/i, /(path|tile|wall|floor|brick|small|pebble)/i],
  bush: [/(bush|shrub|hedge|fern|plant_?bush)/i, /(flower|mushroom|grass)/i],
};
for (const [kind, [re, not]] of Object.entries(NATURE)) {
  const c = pick(statics, re, not).sort((a, b) => rank[a.ext] - rank[b.ext]).slice(0, 4);
  if (c.length) { manifest.nature[kind] = c.map((m) => use('nature', m)); log(`nature.${kind.padEnd(10)}← ${c.map((m) => rel(m.file)).join(', ')}`); }
}

// hdri
const hdr = all.filter((f) => /\.hdr$/i.test(f)).sort((a, b) => (/polyhaven/i.test(b) ? 1 : 0) - (/polyhaven/i.test(a) ? 1 : 0))[0];
if (hdr) { const m = { file: hdr, name: path.basename(hdr, '.hdr'), ext: '.hdr' }; manifest.hdri = { file: use('hdri', m), intensity: 0.6, background: false }; log(`hdri            ← ${rel(hdr)}`); }

// textures: Poly Haven diffuse or ambientCG *_Color, in folders named after the role
const ROLES = ['ground', 'wall', 'floor', 'metal', 'wood', 'rock', 'roof'];
for (const role of ROLES) {
  const imgs = all.filter((f) => /\.(jpe?g|png)$/i.test(f) && new RegExp(`[\\\\/]${role}[\\\\/]`, 'i').test(f) && /(diff|color|albedo|basecolor)/i.test(path.basename(f)));
  const f = imgs.find((x) => /polyhaven/i.test(x)) || imgs[0];
  if (f) { const m = { file: f, name: `${role}_${path.basename(f).replace(/\.[^.]+$/, '')}`, ext: path.extname(f) }; manifest.textures[role] = { map: use('textures', m), scale: role === 'ground' ? 4 : 2, strength: 0.6 }; log(`textures.${role.padEnd(8)}← ${rel(f)}`); }
}

// sounds: Kenney audio packs → recipe names the game plays
const SOUNDS = { ui: /(click|select|confirm)/i, ui_hover: /(rollover|switch|tick|hover)/i, pickup: /(pickup|coin|collect)/i, bin_open: /(open|door|chest)/i, impact_metal: /impact.*(metal|plate)|metal.*impact/i, impact: /impact.*(generic|soft|wood)|footstep.*(concrete)/i };
const auds = all.filter((f) => /\.(ogg|wav|mp3)$/i.test(f));
for (const [name, re] of Object.entries(SOUNDS)) {
  const f = auds.find((a) => re.test(path.basename(a)));
  if (f) { const m = { file: f, name: `${name}_${path.basename(f).replace(/\.[^.]+$/, '')}`, ext: path.extname(f) }; manifest.sounds[name] = use('audio', m); log(`sounds.${name.padEnd(12)}← ${rel(f)}`); }
}
for (const k of ['characters', 'weapons', 'nature', 'textures', 'sounds']) if (!Object.keys(manifest[k]).length) delete manifest[k];

// ---------------------------------------------------------------- 4. write
const manPath = path.join(OUT, 'manifest.json');
let final = manifest;
if (!FRESH && fs.existsSync(manPath)) {
  // keep hand-tuned entries that still point at the same file
  const old = JSON.parse(fs.readFileSync(manPath, 'utf8'));
  const merge = (n, o) => {
    if (!o || typeof n !== 'object' || Array.isArray(n)) return n;
    if (n.file && o.file === n.file) return o;
    const r = { ...n };
    for (const k of Object.keys(n)) r[k] = merge(n[k], o[k]);
    return r;
  };
  final = merge(manifest, old);
}
if (!DRY) {
  for (const [src, { d, m }] of chosen) {
    const to = path.join(OUT, d);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(src, to);
    // .gltf side files (buffers, textures) keep their relative paths
    for (const u of m.uris || []) {
      const from = path.join(path.dirname(src), decodeURIComponent(u));
      if (fs.existsSync(from)) { const t = path.join(path.dirname(to), decodeURIComponent(u)); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.copyFileSync(from, t); }
    }
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(manPath, JSON.stringify(final, null, 2));
  // credits from the source folders that contributed files
  const SRCS = [
    [/quaternius/i, 'Quaternius (quaternius.com) — CC0'], [/kenney/i, 'Kenney (kenney.nl) — CC0'], [/polyhaven|poly.?haven/i, 'Poly Haven (polyhaven.com) — CC0'],
    [/ambientcg/i, 'ambientCG (ambientcg.com) — CC0'], [/3dmodelscc0/i, '3dmodelscc0 (itch.io) — CC0'], [/wrad|wriks/i, 'WRAD ARMS by wriks (itch.io) — see its itch.io page for the license'],
    [/kaykit|lousberg/i, 'KayKit by Kay Lousberg (itch.io) — CC0'], [/mixamo/i, 'Mixamo (Adobe) — Mixamo terms, not CC0'],
  ];
  const used = new Set();
  for (const src of chosen.keys()) for (const [re, label] of SRCS) if (re.test(src)) used.add(label);
  fs.writeFileSync(path.join(OUT, 'CREDITS.md'), `# Third-party assets\n\n${[...used].map((u) => `- ${u}`).join('\n') || '- (none yet)'}\n\nFiles: see IMPORT_REPORT.md.\n`);
  fs.writeFileSync(path.join(OUT, 'IMPORT_REPORT.md'), report.join('\n') + '\n');
}
log(`\n${DRY ? '[dry run] would write' : 'wrote'} ${chosen.size} files + manifest.json → ${path.relative(ROOT, OUT)}`);
if (!chosen.size) log('Nothing matched. Put pack zips/folders under assets-src/ (node tools/assets/fetch.mjs lists them).');
