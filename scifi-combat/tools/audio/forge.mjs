#!/usr/bin/env node
// The sound forge: the game's sounds, designed in code and cut from the recorded packs, written as
// Ogg under audio/ with audio/manifest.json, which the game's SoundEngine loads. Anything not in the
// manifest stays synthesized at runtime (src/audio/SoundBank.js).
//
//   node tools/audio/forge.mjs <packs dir> [out dir = audio] [--only=gun:ar_sol,boom:,...]
//
// <packs dir> holds the packs extracted: Modern_Firearms_Military_Pack/, SciFi_Cyberpunk_SFX_Pack/,
// and the 400-sound packs' folders (Footsteps/, Weapons/, UI/, Materials/, Combat and Gore/, ...).
// Needs ffmpeg (with libvorbis) on the PATH. Deterministic: the same packs build the same files.
// --only rebuilds just the ids starting with any of the prefixes, keeping the rest of the manifest.
//
//  * weapons.mjs: every gun in layers (crack, body, low, mech) and the far classes.
//  * blasts.mjs: explosions in layers (crack, body, low, debris by room) and their far versions, the
//    artillery's reports, shells coming in, rounds and bolts going past, the sky.
//  * foley.mjs: handling, brass, bodies, footsteps, hits, melee, the UI, from the recordings.
//  * atmos.mjs: each map's atmosphere: its beds and the things you hear in it.

import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as B from './lib.mjs';
import { GUNS, FAR, gun, farClass, LEVEL } from './weapons.mjs';
import { SIZES, boom, boomFarTakes, report, incoming, crackPast, boltPast, sky } from './blasts.mjs';
import { foley, foleyLevel } from './foley.mjs';
import { atmos } from './atmos.mjs';

const argv = process.argv.slice(2), flags = argv.filter((a) => a.startsWith('--')), pos = argv.filter((a) => !a.startsWith('--'));
const SRC = resolve(pos[0] ?? '.'), OUT = resolve(pos[1] ?? 'audio');
const only = (flags.find((f) => f.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const want = (id) => !only.length || only.some((p) => id.startsWith(p));
B.packs(SRC);

const t0 = Date.now();
const manifest = only.length && existsSync(join(OUT, 'manifest.json')) ? JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8')) : { sounds: {} };
manifest.version = 2;
manifest.note = 'Built by tools/audio/forge.mjs: layered guns and blasts, the close-up sounds, each map\'s atmosphere.';
if (!only.length && existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });
let files = 0, bytes = 0;

/** How each layer is stored: stereo or mono, sample rate, Vorbis quality. */
const ENC = {
  crack: { stereo: true, sr: 48000, q: 5 }, body: { stereo: true, sr: 48000, q: 4 }, mech: { stereo: true, sr: 48000, q: 4 },
  low: { stereo: false, sr: 22050, q: 3 }, far: { stereo: false, sr: 32000, q: 3 }, debris: { stereo: true, sr: 44100, q: 3 },
  near: { stereo: false, sr: 44100, q: 4 }, wide: { stereo: true, sr: 44100, q: 4 }, ui: { stereo: true, sr: 44100, q: 4 },
  bed: { stereo: true, sr: 44100, q: 3 }, spot: { stereo: false, sr: 32000, q: 3 },
};
/** Takes written as dir-1.ogg, dir-2.ogg, ...: their paths (relative to OUT). */
function write(dir, takes, enc) {
  return takes.map((b, i) => {
    const rel = `${dir}-${i + 1}.ogg`, file = join(OUT, rel);
    B.encode(b, file, enc);
    files++; bytes += statSync(file).size;
    return rel;
  });
}
const lv = (takes, db, win) => takes.map((b) => B.level(b, db, win));
const say = (id) => process.stdout.write(`${id} `);

// ---------------------------------------------------------------- guns and their far classes
for (const [name, G] of Object.entries(GUNS)) {
  const id = `${G.kind === 'energy' ? 'laser' : 'gun'}:${name}`;
  if (!want(id)) continue;
  say(id);
  const L = gun(name), dir = id.replace(':', '/');
  const layers = {};
  for (const [layer, takes] of Object.entries(L)) layers[layer] = write(`${dir}/${layer}`, lv(takes, ...LEVEL[layer]), ENC[layer]);
  manifest.sounds[id] = { kind: 'gun', mix: G.mix, far: `far:${G.cls}`, layers };
}
for (const cls of Object.keys(FAR)) {
  const id = `far:${cls}`;
  if (!want(id)) continue;
  say(id);
  manifest.sounds[id] = { kind: 'far', layers: { far: write(`far/${cls}`, lv(farClass(cls), ...LEVEL.far), ENC.far) } };
}

// ---------------------------------------------------------------- blasts, reports, the air
const BOOM_LEVEL = { crack: [-12, 0.008], body: [-12, 0.1], low: [-12, 0.1], debris: [-20, 0.15], far: [-12, 0.15] };
for (const name of [...Object.keys(SIZES), 'emp']) {
  const id = `boom:${name}`;
  if (!want(id)) continue;
  say(id);
  const L = boom(name), layers = {};
  for (const [layer, takes] of Object.entries(L)) {
    const k = layer.split('@')[0];
    layers[layer] = write(`boom/${name}/${layer.replace('@', '-')}`, lv(takes, ...BOOM_LEVEL[k]), ENC[k]);
  }
  const mix = name === 'emp' ? { crack: -6, body: 0, low: -4 } : { crack: 5, body: 0, low: -4, 'debris@open': -4, 'debris@city': -4 };
  manifest.sounds[id] = { kind: 'boom', mix, ...(name === 'emp' ? {} : { far: `far:boom:${name}` }), layers };
  if (name !== 'emp') manifest.sounds[`far:boom:${name}`] = { kind: 'far', layers: { far: write(`far/boom-${name}`, lv(boomFarTakes(name), ...BOOM_LEVEL.far), ENC.far) } };
}
for (const kind of ['howitzer', 'at', 'rocket']) {
  const id = `report:${kind}`;
  if (!want(id)) continue;
  say(id);
  const L = report(kind), layers = {};
  for (const [layer, takes] of Object.entries(L)) layers[layer] = write(`report/${kind}/${layer}`, lv(takes, ...BOOM_LEVEL[layer]), ENC[layer]);
  manifest.sounds[id] = { kind: 'report', mix: { crack: kind === 'rocket' ? -4 : -2, body: 0, low: kind === 'at' ? -2 : 0 }, layers };
}
const simple = (id, kind, takes, enc, db, win) => {
  if (!want(id)) return;
  say(id);
  manifest.sounds[id] = { kind, takes: write(`${id.replace(/:/g, '/')}/take`, lv(takes, db, win), enc) };
};
simple('incoming', 'near', [0, 1, 2, 3, 4, 5].map(incoming), ENC.wide, -14, 0.3);
simple('crack', 'near', [0, 1, 2, 3, 4, 5, 6, 7].map(crackPast), ENC.wide, -12, 0.008);
for (const f of ['sol', 'void']) simple(`whizz:${f}`, 'near', [0, 1, 2, 3, 4, 5].map((k) => boltPast(f, k)), ENC.wide, -14, 0.05);
for (const k of ['pod', 'jet']) simple(`sky:${k}`, 'report', [0, 1, 2].map((i) => sky(k, i)), ENC.wide, -14, 0.3);

// ---------------------------------------------------------------- the close-up sounds
for (const [id, { kind, takes }] of Object.entries(foley())) {
  if (!want(id)) continue;
  say(id);
  manifest.sounds[id] = { kind, takes: write(`${id.replace(/:/g, '/')}/take`, lv(takes, foleyLevel(id), 0.15), kind === 'ui' ? ENC.ui : ENC.near) };
}

// ---------------------------------------------------------------- each map's atmosphere
for (const [id, e] of Object.entries(atmos())) {
  if (!want(id)) continue;
  say(id);
  manifest.sounds[id] = { kind: e.kind, ...(e.spot ? { spot: e.spot } : {}), takes: write(`${id.replace(/:/g, '/')}/take`, e.level === false ? e.takes : lv(e.takes, e.level ?? -20, 0.4), ENC[e.enc ?? 'bed']) };
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
console.log(`\n${Object.keys(manifest.sounds).length} sounds; this run ${files} files, ${(bytes / 1048576).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${OUT}`);
