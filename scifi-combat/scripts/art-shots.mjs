// Art lab captures, headless: node scripts/art-shots.mjs <outdir> station[:view[:query]] ...
// Needs the page served on :8765 (python3 -m http.server 8765) and Playwright (CHROMIUM_PATH
// picks a browser binary; software GL via SwiftShader, so it runs anywhere, slowly).
import { chromium } from 'playwright';
const out = process.argv[2], shots = process.argv.slice(3);
const exe = process.env.CHROMIUM_PATH;
const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const errors = [];
for (const s of shots) {
  const [station, view, query] = s.split(':');
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(`${s}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(`${s}: ${m.text()}`); });
  await page.goto(`http://localhost:8765/art-lab.html?station=${station}${view ? `&view=${view}` : ''}${query ? `&${query}` : ''}`);
  await page.waitForFunction(() => window.__art?.ready, null, { timeout: 240000, polling: 500 });
  await page.waitForTimeout(station === 'palette' ? 300 : 2500);
  const name = `${station}${view ? '-' + view : ''}${query ? '-' + query.replace(/[=&]/g, '_') : ''}`;
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name);
  await page.close();
}
console.log(errors.length ? errors.slice(0, 10).join('\n') : 'no errors');
await browser.close();
