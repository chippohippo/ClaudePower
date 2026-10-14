// End-to-end test of the imported-asset pipeline with generated stand-in assets.
//   npm run dev   (in another terminal)
//   node tools/assets/fixturetest.mjs [http://localhost:5173] [screenshotDir]
// Writes fixture GLBs + a texture, HDRI and sound into public/assets/_fixtures with a test
// manifest, opens the firing range in Chromium and checks that characters, guns, trees, rocks,
// textures, HDRI and samples all went through the pipeline. Everything is removed afterwards and
// any existing manifest.json is restored.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const IMPORT = process.argv.includes('--import'); // run the fixtures through tools/assets/import.mjs
const URL0 = argv[0] || 'http://localhost:5173';
const SHOTS = argv[1] || null;
const PACKS = path.join(ROOT, '.fixture-packs');
const PUB = path.join(ROOT, 'public', 'assets');
const FIX = path.join(PUB, '_fixtures');
const MAN = path.join(PUB, 'manifest.json');

async function loadPlaywright() {
  for (const p of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node-tools/node_modules/playwright/index.mjs']) {
    if (!p) continue;
    try { return await import(p); } catch { /* next */ }
  }
  throw new Error('playwright not found (npm i -D playwright, or set PLAYWRIGHT_MODULE)');
}

// tiny uncompressed Radiance HDR: blue sky gradient over warm ground
function makeHDR(w = 64, h = 32) {
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, 'ascii');
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = y / (h - 1);
    const rgb = t < 0.5 ? [0.5 + t, 0.7 + t * 0.4, 1.2] : [0.6, 0.5, 0.35];
    const m = Math.max(...rgb), e = Math.ceil(Math.log2(m)) + 128, sc = 256 / 2 ** (e - 128);
    const i = (y * w + x) * 4;
    px[i] = Math.min(255, rgb[0] * sc); px[i + 1] = Math.min(255, rgb[1] * sc); px[i + 2] = Math.min(255, rgb[2] * sc); px[i + 3] = e;
  }
  return Buffer.concat([head, px]);
}

// short click as 16-bit mono WAV
function makeWAV() {
  const sr = 44100, n = Math.floor(sr * 0.08), data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin(i / sr * 2 * Math.PI * 2200) * Math.exp(-i / (sr * 0.015)) * 30000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const MANIFEST = {
  characters: { default: { file: '_fixtures/character.glb', tint: ['Main'], handBone: 'Hand.R' } },
  weapons: { talon: { file: '_fixtures/gun.glb', rotY: Math.PI / 2 }, breacher: { file: '_fixtures/gun.glb', rotY: Math.PI / 2 } },
  nature: { tree: ['_fixtures/tree.glb'], rock: ['_fixtures/rock.glb'], bush: ['_fixtures/bush.glb'] },
  textures: { ground: { map: '_fixtures/noise.png', scale: 3, strength: 0.6 }, wall: { map: '_fixtures/noise.png', scale: 2 } },
  hdri: { file: '_fixtures/sky.hdr', intensity: 0.6 },
  sounds: { ui: '_fixtures/click.wav' },
};

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const hadManifest = fs.existsSync(MAN);
if (IMPORT && hadManifest) {
  console.error('--import needs an empty public/assets (it writes and then removes asset folders); move your manifest aside first');
  process.exit(2);
}
if (hadManifest) fs.copyFileSync(MAN, MAN + '.bak');
let fails = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name, extra); if (!ok) fails++; };
try {
  // 1. generate fixtures in the browser (three's GLTFExporter)
  const gen = await browser.newPage();
  await gen.goto(URL0 + '/tools/assets/fixtures.html');
  await gen.waitForFunction(() => window.fixturesReady, null, { timeout: 60000 });
  const files = await gen.evaluate(() => window.makeFixtures());
  const png = await gen.evaluate(() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    for (let i = 0; i < 4000; i++) { const v = 80 + Math.random() * 150; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * 128, Math.random() * 128, 3, 3); }
    return c.toDataURL('image/png').split(',')[1];
  });
  await gen.close();
  fs.mkdirSync(FIX, { recursive: true });
  for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(FIX, n), Buffer.from(b, 'base64'));
  fs.writeFileSync(path.join(FIX, 'noise.png'), Buffer.from(png, 'base64'));
  fs.writeFileSync(path.join(FIX, 'sky.hdr'), makeHDR());
  fs.writeFileSync(path.join(FIX, 'click.wav'), makeWAV());
  if (IMPORT) {
    // lay the fixtures out like real downloads and let the importer pick roles + write the manifest
    const put = (rel, src) => { const t = path.join(PACKS, rel); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.copyFileSync(path.join(FIX, src), t); };
    put('quaternius_universal_base_characters/glTF/UBC_Superhero_Male.glb', 'character.glb');
    put('quaternius_ultimate_guns/glTF/AK47.glb', 'gun.glb');
    put('quaternius_ultimate_guns/glTF/Shotgun_Pump.glb', 'gun.glb');
    put('quaternius_ultimate_guns/glTF/Pistol_1.glb', 'gun.glb');
    put('kenney_nature-kit/Models/GLB format/tree_pineRoundA.glb', 'tree.glb');
    put('kenney_nature-kit/Models/GLB format/rock_largeA.glb', 'rock.glb');
    put('kenney_nature-kit/Models/GLB format/plant_bush.glb', 'bush.glb');
    put('polyhaven/hdri/sky_2k.hdr', 'sky.hdr');
    put('polyhaven/textures/ground/aerial_grass_rock_diff_1k.png', 'noise.png');
    put('polyhaven/textures/wall/painted_concrete_diff_1k.png', 'noise.png');
    put('kenney_ui-audio/Audio/click1.wav', 'click.wav');
    // one pack as a zip, to exercise extraction
    execFileSync('python3', ['-c', 'import sys,zipfile,os; z=zipfile.ZipFile(sys.argv[1],"w"); [z.write(os.path.join(r,f), os.path.relpath(os.path.join(r,f), sys.argv[2])) for r,_,fs in os.walk(sys.argv[2]) for f in fs]; z.close()', path.join(PACKS, 'kenney_nature-kit.zip'), path.join(PACKS, 'kenney_nature-kit')]);
    fs.rmSync(path.join(PACKS, 'kenney_nature-kit'), { recursive: true });
    const out = execFileSync('node', [path.join(ROOT, 'tools/assets/import.mjs'), '--fresh'], { env: { ...process.env, ASSETS_SRC: PACKS }, encoding: 'utf8' });
    console.log(out.split('\n').map((l) => '  | ' + l).join('\n'));
    const man = JSON.parse(fs.readFileSync(MAN, 'utf8'));
    check('importer: base character + guns + nature + hdri + textures + sound', !!(man.characters?.default && man.weapons?.talon && man.weapons?.breacher && man.weapons?.p20 && man.nature?.tree && man.nature?.rock && man.nature?.bush && man.hdri && man.textures?.ground && man.sounds?.ui));
    check('importer: X-long guns rotated to -Z', man.weapons?.talon?.rotY > 1.5);
  } else fs.writeFileSync(MAN, JSON.stringify(MANIFEST, null, 2));
  console.log('fixtures:', fs.readdirSync(FIX).map((f) => `${f} ${fs.statSync(path.join(FIX, f)).size}B`).join(', '));

  // 2. play the firing range with the fixtures loaded
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('WebSocket')) errors.push(m.text()); });
  await page.addInitScript(() => localStorage.setItem('skyfall.settings', JSON.stringify({ quality: 'low' })));
  await page.goto(URL0 + '/?server=http://localhost:3999');
  await page.waitForFunction(() => window.__skyfall && window.__skyfall.assets.done, null, { timeout: 60000 });
  const report = await page.evaluate(() => window.__skyfall.assets.report);
  console.log(report.map((l) => '  ' + l).join('\n'));
  check('every manifest entry loaded', report.length >= (IMPORT ? 9 : 10) && report.every((l) => l.startsWith('ok')), `${report.length} entries`);
  await page.click('#btn-range');
  await page.waitForFunction(() => window.__skyfall.game && window.__skyfall.game.inv, null, { timeout: 90000 });
  await page.evaluate(() => { window.__skyfall.input.locked = true; const g = window.__skyfall.game; g.yaw = 0; g.pitch = -0.05; });
  await page.waitForTimeout(7000);
  const r = await page.evaluate(() => {
    const g = window.__skyfall.game;
    const avs = [...g.remotes.values()].map((x) => x.avatar).filter(Boolean);
    const model = avs.filter((a) => a.mixer);
    const states = [...new Set(model.map((a) => a.state))];
    const names = new Set();
    g.vm.gun && g.vm.gun.traverse((o) => { if (o.isMesh) names.add(o.material.name); });
    let leaves = 0, rocks = 0;
    g.scene.traverse((o) => { if (o.isInstancedMesh && o.material.name === 'Leaves') leaves += o.count; if (o.isInstancedMesh && o.material.name === 'Rock') rocks += o.count; });
    const tinted = model[0] ? (() => { let c = null; model[0].model.traverse((o) => { if (o.isSkinnedMesh && !c) c = (Array.isArray(o.material) ? o.material[0] : o.material).color.getHexString(); }); return c; })() : null;
    // range dummies are unarmed: equip one to check the hand socket
    if (model[0]) { model[0]._setWeapon('talon'); }
    return {
      avatars: avs.length, model: model.length, states, handGun: !!(model[0] && model[0].gun.children.length > 0 && model[0].hand),
      vmGun: [...names], leaves, rocks, env: !!g.view.scene.environment, hdri: !!window.__skyfall.assets.hdri,
      sound: !!(window.__skyfall.audio && window.__skyfall.audio.buffers && window.__skyfall.audio.buffers.ui && window.__skyfall.audio.buffers.ui.duration < 0.2),
      tinted, toon: model[0] ? (() => { let t = false; model[0].model.traverse((o) => { if (o.isSkinnedMesh) t = (Array.isArray(o.material) ? o.material : [o.material]).some((m) => m.isMeshToonMaterial); }); return t; })() : false,
    };
  });
  console.log(JSON.stringify(r));
  check('characters use the imported rig', r.model > 0 && r.model === r.avatars, `${r.model}/${r.avatars}`);
  check('animation states mapped from clip names', r.states.length > 0 && !r.states.includes(null), r.states.join(','));
  check('imported character is cel-shaded (Comic)', r.toon);
  check('legend tint applied to "Main" material', r.tinted && r.tinted !== '8090a0', '#' + r.tinted);
  check('third-person gun in the hand', r.handGun);
  check('first-person viewmodel uses the imported gun', r.vmGun.includes('Gun'), r.vmGun.join(','));
  check('trees + bushes instanced from GLB', r.leaves > 0, `${r.leaves} leaf instances`);
  check('rocks drape the rock colliders', r.rocks > 0, `${r.rocks}`);
  check('HDRI lights the world', r.hdri && r.env);
  check('recorded sample replaced the "ui" recipe', r.sound);
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  if (SHOTS) {
    await page.screenshot({ path: path.join(SHOTS, 'assets_range.png') });
    await page.evaluate(() => {
      const g = window.__skyfall.game;
      const av = [...g.remotes.values()].find((x) => x.avatar && x.avatar.mixer);
      if (!av) return;
      const p = av.avatar.root.position;
      g.frameHook = () => { g.camera.position.set(p.x + 3.2, p.y + 1.7, p.z + 3.2); g.camera.lookAt(p.x, p.y + 1, p.z); };
    });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(SHOTS, 'assets_character.png') });
  }
  await page.close();

  // 3. asset viewer renders every entry through the same pipeline
  const vp = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const verr = [];
  vp.on('pageerror', (e) => verr.push(e.message));
  await vp.goto(URL0 + '/tools/assets/viewer.html');
  await vp.waitForFunction(() => document.querySelectorAll('#list button').length > 0, null, { timeout: 60000 });
  const btns = await vp.$$eval('#list button', (b) => b.map((x) => x.textContent));
  for (const label of ['default', 'talon']) {
    await vp.click(`#list button:text-is("${label}")`);
    await vp.waitForTimeout(1500);
    if (SHOTS) await vp.screenshot({ path: path.join(SHOTS, `viewer_${label}.png`) });
  }
  check('asset viewer lists and shows entries', btns.length >= 5 && verr.length === 0, `${btns.length} entries ${verr.join(' | ')}`);
  await vp.close();
} finally {
  await browser.close();
  fs.rmSync(FIX, { recursive: true, force: true });
  fs.rmSync(PACKS, { recursive: true, force: true });
  for (const d of ['characters', 'animations', 'weapons', 'nature', 'hdri', 'textures', 'audio', 'arms', 'CREDITS.md', 'IMPORT_REPORT.md']) if (IMPORT) fs.rmSync(path.join(PUB, d), { recursive: true, force: true });
  if (hadManifest) fs.renameSync(MAN + '.bak', MAN);
  else fs.rmSync(MAN, { force: true });
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
