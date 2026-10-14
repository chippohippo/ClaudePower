// Builds the Windows installer from the packaged app (release/win-unpacked, made by
// `electron-builder --win dir`) with NSIS and build/installer.nsi. Works on Windows, Linux and macOS:
// NSIS ships native makensis builds, and the installer writes its uninstaller at install time, so no
// Wine is needed (electron-builder's own NSIS target needs Wine off Windows to pre-build it).
//
//   npm run dist:win          (= vite build → electron-builder --win dir → this script)
//   MAKENSIS=/path/to/makensis node tools/desktop/build-installer.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const SRC = path.join(ROOT, 'release', 'win-unpacked');
const OUT = path.join(ROOT, 'release', `SKYFALL-Setup-${pkg.version}.exe`);
const NSIS_VER = 'nsis-3.0.4.1';
const NSIS_URL = `https://github.com/electron-userland/electron-builder-binaries/releases/download/${NSIS_VER}/${NSIS_VER}.7z`;

if (!fs.existsSync(path.join(SRC, 'SKYFALL.exe'))) {
  console.error('release/win-unpacked/SKYFALL.exe missing — run: npx electron-builder --win dir --x64');
  process.exit(1);
}

// makensis: $MAKENSIS, electron-builder's cached NSIS bundle, or download that bundle
function cacheDirs() {
  const dirs = [];
  if (process.env.ELECTRON_BUILDER_CACHE) dirs.push(process.env.ELECTRON_BUILDER_CACHE);
  if (process.platform === 'win32') dirs.push(path.join(process.env.LOCALAPPDATA || os.homedir(), 'electron-builder', 'Cache'));
  else if (process.platform === 'darwin') dirs.push(path.join(os.homedir(), 'Library', 'Caches', 'electron-builder'));
  else dirs.push(path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'electron-builder'));
  return dirs.map((d) => path.join(d, 'nsis', NSIS_VER));
}
const exeIn = (dir) => (process.platform === 'win32' ? path.join(dir, 'Bin', 'makensis.exe') : path.join(dir, process.platform === 'darwin' ? 'mac' : 'linux', 'makensis'));

async function nsisDir() {
  for (const d of cacheDirs()) if (fs.existsSync(exeIn(d))) return d;
  const dir = cacheDirs()[0];
  console.log(`downloading ${NSIS_URL}`);
  const res = await fetch(NSIS_URL);
  if (!res.ok) throw new Error(`NSIS download failed: HTTP ${res.status}`);
  fs.mkdirSync(dir, { recursive: true });
  const archive = path.join(dir, '..', `${NSIS_VER}.7z`);
  fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  const { path7za } = await import('7zip-bin');
  fs.chmodSync(path7za, 0o755);
  execFileSync(path7za, ['x', '-y', `-o${dir}`, archive], { stdio: 'ignore' });
  return dir;
}

const dirSize = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? dirSize(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);

const makensis = process.env.MAKENSIS || null;
const dir = makensis ? null : await nsisDir();
const bin = makensis || exeIn(dir);
if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);
const args = [
  `-DVERSION=${pkg.version}`, `-DSRC=${SRC}`, `-DOUT=${OUT}`, `-DICON=${path.join(ROOT, 'build', 'icon.ico')}`,
  `-DSIZE_KB=${Math.round(dirSize(SRC) / 1024)}`, '-V2', path.join(ROOT, 'build', 'installer.nsi'),
];
console.log(`makensis ${path.basename(bin)} → ${path.relative(ROOT, OUT)}`);
execFileSync(bin, args, { stdio: 'inherit', env: { ...process.env, ...(dir ? { NSISDIR: dir } : {}) } });
console.log(`installer: ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB)`);
