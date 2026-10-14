// Downloads the CC0 packs that can be fetched without a browser into assets-src/:
//   github      — the authors' own repositories (KayKit characters + space props, Kenney FPS kit),
//                 sparse git clones, plus Poly Haven HDRIs mirrored in the three.js repo
//   mirror      — GitHub release mirror of Quaternius nature / sci-fi kits and ambientCG
//                 materials (third-party: each zip must contain the author's license file)
//   polyhaven   — HDRI + PBR textures through the public API (api.polyhaven.com)
//   ambientcg   — texture zips (ambientcg.com/get?file=<id>_1K-JPG.zip)
//   kenney      — pack zips, link read from kenney.nl/assets/<slug>
// Sources that fail (blocked host) are reported and skipped; anything already present is kept.
// Quaternius, itch.io (3dmodelscc0, WRAD ARMS, KayKit) and Mixamo need a click in a browser; the
// script prints that list. Then run `node tools/assets/import.mjs`.
//
//   node tools/assets/fetch.mjs [--only github,mirror,polyhaven,ambientcg,kenney] [--force]
//
// The machine needs network access to those hosts (in a sandbox, add them to the allowed domains).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = process.env.ASSETS_SRC || path.join(ROOT, 'assets-src');
const S = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/assets/sources.json'), 'utf8'));
const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only')) || '').split('=')[1]?.split(',') || (args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null);
const force = args.includes('--force');
const want = (k) => !only || only.includes(k);
const UA = { 'user-agent': 'SKYFALL-asset-fetch/1.0 (+https://github.com)' };
const results = [];

// curl honours HTTPS_PROXY / corporate proxies (Node's fetch does not); fetch is the fallback
let hasCurl = true;
try { execFileSync('curl', ['--version'], { stdio: 'ignore' }); } catch { hasCurl = false; }
async function get(url, asText = true) {
  if (hasCurl) {
    const buf = execFileSync('curl', ['-sSfL', '--max-time', '300', '-A', UA['user-agent'], url], { maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] });
    return asText ? buf.toString('utf8') : buf;
  }
  const r = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return asText ? r.text() : Buffer.from(await r.arrayBuffer());
}
const getJSON = async (url) => JSON.parse(await get(url));

async function download(url, dest) {
  if (!force && fs.existsSync(dest) && fs.statSync(dest).size > 0) { results.push(`skip ${path.relative(ROOT, dest)} (exists)`); return true; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, await get(url, false));
  results.push(`got  ${path.relative(ROOT, dest)} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
  return true;
}

const attempt = async (label, fn) => { try { await fn(); } catch (e) { results.push(`FAIL ${label}: ${(e.stderr ? e.stderr.toString().trim() : '') || e.message}`); } };

// --- authors' GitHub repositories (sparse, blobless: only the listed paths are downloaded)
if (want('github') && S.github) {
  const cache = path.join(SRC, '.git-cache');
  for (const g of S.github.repos) {
    await attempt(`github ${g.repo}`, async () => {
      const destDir = path.join(SRC, g.dest);
      if (!force && fs.existsSync(destDir) && fs.readdirSync(destDir).length) { results.push(`skip ${path.relative(ROOT, destDir)} (exists)`); return; }
      const dir = path.join(cache, g.repo.replace('/', '__'));
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(cache, { recursive: true });
      const git = (...a) => execFileSync('git', a, { env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' }, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
      git('clone', '-q', '--filter=blob:none', '--no-checkout', '--depth', '1', `https://github.com/${g.repo}`, dir);
      const files = git('-C', dir, 'ls-tree', '-r', 'HEAD', '--name-only').toString().split('\n').filter((f) => f && g.paths.some((p) => f.startsWith(p)));
      if (!files.length) throw new Error('none of the listed paths exist in the repository');
      git('-C', dir, 'checkout', '-q', 'HEAD', '--', ...files);
      for (const f of files) { const to = path.join(destDir, f); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(dir, f), to); }
      fs.rmSync(dir, { recursive: true, force: true });
      results.push(`got  ${g.dest}/ (${files.length} files from github.com/${g.repo}, ${g.license})`);
    });
  }
  for (const f of S.github.files || []) await attempt(`github ${f.dest}`, () => download(f.url, path.join(SRC, f.dest)));
}

// --- third-party release mirror: verify each archive carries its author's license
if (want('mirror') && S.mirror) {
  for (const z of S.mirror.zips) {
    await attempt(`mirror ${z.file}`, async () => {
      const dest = path.join(SRC, z.dest);
      await download(`${S.mirror.base}/${z.file}`, dest);
      if (z.expectLicense) {
        const list = execFileSync('unzip', ['-Z1', dest], { maxBuffer: 1 << 26 }).toString();
        if (!list.split('\n').some((l) => l.endsWith(z.expectLicense))) { fs.rmSync(dest); throw new Error(`no ${z.expectLicense} inside — removed`); }
      }
    });
  }
}

const haveTex = new Set();
if (want('polyhaven') && !(only == null && fs.existsSync(path.join(SRC, 'polyhaven', 'hdri')) && fs.readdirSync(path.join(SRC, 'polyhaven', 'hdri')).length)) {
  const P = S.polyhaven;
  await attempt('polyhaven hdri', async () => {
    const f = await getJSON(`https://api.polyhaven.com/files/${P.hdri.id}`);
    const url = f.hdri[P.hdri.res].hdr.url;
    await download(url, path.join(SRC, 'polyhaven', 'hdri', `${P.hdri.id}_${P.hdri.res}.hdr`));
  });
  for (const [role, id] of Object.entries(P.textures)) {
    await attempt(`polyhaven ${role} (${id})`, async () => {
      const f = await getJSON(`https://api.polyhaven.com/files/${id}`);
      const diff = f.Diffuse || f.diffuse || f.Color;
      const url = diff[P.res].jpg.url;
      await download(url, path.join(SRC, 'polyhaven', 'textures', role, `${id}_diff_${P.res}.jpg`));
      haveTex.add(role);
    });
  }
}
if (want('ambientcg')) {
  const A = S.ambientcg;
  for (const [role, id] of Object.entries(A.textures)) {
    if (haveTex.has(role) && !only) continue;
    await attempt(`ambientcg ${role} (${id})`, () => download(`https://ambientcg.com/get?file=${id}_${A.res}.zip`, path.join(SRC, 'ambientcg', role, `${id}_${A.res}.zip`)));
  }
}
if (want('kenney')) {
  for (const slug of S.kenney.packs) {
    await attempt(`kenney ${slug}`, async () => {
      const html = await get(`https://kenney.nl/assets/${slug}`);
      const m = html.match(/href="([^"]+\.zip)"/i);
      if (!m) throw new Error('no zip link on the asset page');
      const url = new URL(m[1], 'https://kenney.nl').href;
      await download(url, path.join(SRC, 'kenney', path.basename(new URL(url).pathname)));
    });
  }
}

console.log(results.join('\n'));
console.log('\nDownload these in a browser and drop the zips (or folders) anywhere under assets-src/:');
for (const m of S.manual) console.log(`  - ${m.name} [${m.license}] — ${m.role}\n    ${m.url}`);
console.log('\nThen: node tools/assets/import.mjs');
