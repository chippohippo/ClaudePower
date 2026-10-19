#!/usr/bin/env node
// Record the game's sound offline, in a headless browser, through the game's own AudioDirector and
// SoundEngine (the Audio Lab's ?render=): a real battle heard from inside it, or the board (every
// weapon first person and at range, every blast, the near misses). Writes a WAV and a log of what
// played (time, id, kind, distance, level) for measuring the mix.
//
//   node tools/audio/listen.mjs battle out.wav [map=trench|city] [planet=scorched|duskcity|nightcity] [size=32v32] [seed=3] [warm=25] [secs=40]
//   node tools/audio/listen.mjs board out.wav [map=trench|city] [planet=...]
//
// Needs Playwright (npm i -D playwright) and a Chromium it can launch (PLAYWRIGHT_CHROMIUM or its own).

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [kind = 'battle', out = 'battle.wav', ...rest] = process.argv.slice(2);
const opt = Object.fromEntries(rest.map((a) => a.split('=')));
const q = new URLSearchParams({ render: kind, ...opt });
const ROOT = process.env.EMBERFALL_ROOT ?? fileURLToPath(new URL('../..', import.meta.url));   // (another checkout's sound: EMBERFALL_ROOT)
const port = 8900 + Math.floor(Math.random() * 90);

const server = spawn(process.execPath, ['tools/serve.mjs', String(port), '--no-open'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve) => server.stdout.on('data', (d) => /running at/.test(String(d)) && resolve()));
const { chromium } = await import('playwright');
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page:', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error('console:', m.text()); });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/audio-lab.html?${q}`);
  await page.waitForFunction(() => window.__audiolab?.done, null, { timeout: 30 * 60 * 1000, polling: 1000 });
  const r = await page.evaluate(() => ({ error: window.__audiolab.error, wav: window.__audiolab.wav, log: window.__audiolab.log }));
  if (r.error) throw new Error(r.error);
  writeFileSync(out, Buffer.from(r.wav, 'base64'));
  writeFileSync(out.replace(/\.wav$/, '') + '.log.json', JSON.stringify(r.log));
  console.log(`${out}: ${kind} ${q} in ${((Date.now() - t0) / 1000).toFixed(0)} s, ${r.log.plays.length} sounds played`);
} finally {
  await browser.close();
  server.kill();
}
