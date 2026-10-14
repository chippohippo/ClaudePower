// Merges tools/assets/overrides.json into public/assets/manifest.json (same deep merge as import.mjs:
// overrides win, arrays replace, null deletes) without re-running the importer.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAN = path.join(ROOT, 'public/assets/manifest.json');
const OVR = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/assets/overrides.json'), 'utf8'));
const deepMerge = (a, b) => {
  if (b === null) return undefined;
  if (typeof b !== 'object' || Array.isArray(b) || typeof a !== 'object' || a === null || Array.isArray(a)) return b;
  const r = { ...a };
  for (const k of Object.keys(b)) { if (k.startsWith('_')) continue; const v = deepMerge(a[k], b[k]); if (v === undefined) delete r[k]; else r[k] = v; }
  return r;
};
const m = deepMerge(JSON.parse(fs.readFileSync(MAN, 'utf8')), OVR.manifest || {});
fs.writeFileSync(MAN, JSON.stringify(m, null, 2) + '\n');
console.log('manifest updated:', Object.keys(m.characters || {}).join(' '));
