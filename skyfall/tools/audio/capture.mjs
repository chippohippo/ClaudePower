// Renders every synthesised sound in real Chromium Web Audio and writes them as WAV files
// (plus an offline-rendered mix through the real bus: compressor + reverb) for analysis.
//   node tools/audio/capture.mjs <outdir>   (needs `npm run dev` on :5173)
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const out = process.argv[2] || 'audio-out';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto('http://localhost:5173/?server=http://localhost:3999');
await page.waitForFunction(() => window.__skyfall && window.__skyfall.audio);
const sr = await page.evaluate(async () => { const a = window.__skyfall.audio; await a.init(); return a.ctx.sampleRate; });
const names = await page.evaluate(() => Object.keys(window.__skyfall.audio.buffers));
function wav(f32, rate) {
  const n = f32.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32767))), 44 + i * 2);
  return b;
}
for (const name of names) {
  const data = await page.evaluate((n) => Array.from(window.__skyfall.audio.buffers[n].getChannelData(0)), name);
  fs.writeFileSync(`${out}/${name}.wav`, wav(Float32Array.from(data), sr));
}
// full-bus mixes, if the engine supports offline scene rendering
const scenes = await page.evaluate(async () => {
  const a = window.__skyfall.audio;
  if (!a.renderScene) return {};
  const res = {};
  for (const [k, sc] of Object.entries(a.testScenes())) res[k] = Array.from(await a.renderScene(sc.events, sc.dur));
  return res;
});
for (const [k, d] of Object.entries(scenes)) fs.writeFileSync(`${out}/scene_${k}.wav`, wav(Float32Array.from(d), sr));
console.log('wrote', names.length, 'buffers and', Object.keys(scenes).length, 'scenes at', sr, 'Hz to', out);
await browser.close();
