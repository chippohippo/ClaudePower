// Scripted 10-year playtest as Germany through the real UI (M3 gate). Needs `npm run dev` on :5173 and
// Playwright available (npx playwright / a global install); not a project dependency. Logs decisions,
// greyed-out reasons, alerts per year and UI frame rate at speed 5.
import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
p.setDefaultTimeout(4000);
const errs = []; p.on("pageerror", e => errs.push(e.message));
const log = (...a) => console.log(...a);
let decisions = 0, greyed = 0;
const act = async (what, locator) => {
  try {
    const el = locator.first();
    await el.waitFor();
    if (await el.isDisabled()) {
      await el.hover({ force: true }); await p.waitForTimeout(250);
      const reason = await p.locator("text=/^✖/").first().innerText().catch(() => "?");
      greyed++; log(`  greyed: ${what} — ${reason}`); return false;
    }
    await el.hover(); await p.waitForTimeout(250);
    const prev = await p.locator("div:has(> div:text-matches('^•'))").last().innerText().catch(() => "");
    await el.click(); decisions++;
    log(`#${decisions} ${what}${prev ? "  [preview: " + prev.replace(/\n/g, " ").slice(0, 160) + "]" : ""}`);
    await p.waitForTimeout(350); return true;
  } catch (e) { log(`  could not: ${what}: ${e.message.split("\n")[0]}`); return false; }
};
const bar = async () => (await p.locator("body").innerText()).split("\n").slice(0, 16).join(" ");
const alerts = async () => p.evaluate(() => [...document.querySelectorAll("div")].filter(d => d.style.borderLeft?.includes("3px")).map(d => d.innerText.replace("🔕", "").trim()));
const jump = async (q) => { await p.keyboard.press("Escape"); await p.keyboard.press("Control+k"); await p.locator("input[placeholder^=Search]").waitFor(); await p.locator("input[placeholder^=Search]").fill(q); await p.keyboard.press("Enter"); await p.waitForTimeout(500); ; log("    jumped:", (await p.locator("strong").filter({ hasNotText: "Germany" }).allInnerTexts()).join("/").slice(0, 80)); };
const fpsLog = [];
const runDays = async (days) => {
  await p.locator("button:text-is('5')").first().click();
  const play = p.locator("button:text-is('▶')"); await play.click();
  const fps = await p.evaluate((ms) => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < ms ? requestAnimationFrame(f) : r(n / (ms / 1000)); }; requestAnimationFrame(f); }), days / 120 * 1000);
  fpsLog.push(Math.round(fps));
  await p.locator("button:text-is('⏸')").click(); await p.waitForTimeout(700);
};
const gov = async () => { if (!(await p.locator("text=Government >> nth=0").isVisible().catch(() => false)) || !(await p.locator("text=Automation").isVisible().catch(() => false))) await p.locator("button:text-is('F1 Gov')").click(); await p.waitForTimeout(300); };
const law = (name) => p.locator(`div:has(> span:text-is("${name}")) button`);
const devBtn = (pt) => p.locator(`button:text-is("+1 ${pt}")`);
const build = async (bName, n) => { await p.selectOption("select", { label: bName }); await p.fill("input[type=number]", String(n)); return act(`build ${bName} ×${n}`, p.locator("button:text-is('Build')")); };

await p.goto("http://localhost:5173/");
await p.click("text=Germany"); await p.click("text=Start — World");
await p.waitForSelector("canvas", { timeout: 30000 }); await p.waitForTimeout(2000);
log("START", await bar()); log("ALERTS", JSON.stringify(await alerts()));
await p.screenshot({ path: "m3-start.png" });

await gov();
await act("enact Public Schools → Universal Education", law("Universal Education"));
await act("turn off Auto-construct", p.locator("div[title^='The state picks'] button"));
await act("turn off Auto-budget", p.locator("div[title^='Adjust the tax'] button"));
await act("raise tax +1%", p.locator("button:text-is('+1%')"));
await p.screenshot({ path: "m3-gov.png" });
await act("undo the tax raise", p.locator("button:has-text('Undo')"));
await jump("Nordrhein");
await act("develop Production in Nordrhein-Westfalen", devBtn("DIP"));
await act("develop Tax in Nordrhein-Westfalen", devBtn("ADM"));
await build("Arms Factory", 30);
await p.screenshot({ path: "m3-province.png" });
const plan = [
  async () => { await jump("Bayern"); await act("develop Production in Bayern", devBtn("DIP")); await build("Consumer Goods Factory", 40); },
  async () => { await jump("Sachsen"); await act("develop Manpower in Sachsen", devBtn("MIL")); await build("Tool Works", 25); },
  async () => { await gov(); await act("raise stability", p.locator("button:has-text('Raise stability')")); await act("cut tax −1%", p.locator("button:text-is('−1%')")); },
  async () => { await jump("Niedersachsen"); await build("Consumer Goods Factory", 40); await act("develop Tax in Niedersachsen", devBtn("ADM")); },
  async () => { await gov(); await act("Partial Mobilisation", law("Partial Mobilisation")); },
  async () => { await jump("Berlin"); await act("develop Production in Brandenburg (Berlin)", devBtn("DIP")); await build("Office", 30); },
  async () => { await gov(); await act("Open Borders", law("Open Borders")); await act("raise tax +1%", p.locator("button:text-is('+1%')")); },
  async () => { await jump("Nordrhein"); await build("Steel Mill", 30); await act("develop Production", devBtn("DIP")); },
  async () => { await gov(); await act("back to Limited Mobilisation", law("Limited Mobilisation")); await act("turn Auto-construct back on", p.locator("div[title^='The state picks'] button")); },
  async () => { await jump("Bayern"); await act("develop Tax in Bayern", devBtn("ADM")); await act("develop Manpower in Bayern", devBtn("MIL")); },
];
for (let year = 0; year < 10; year++) {
  await runDays(365);
  log(`--- ${await bar()}`); log("    ALERTS", JSON.stringify(await alerts())); log("    SELECTED-AFTER-JUMP", "");
  await plan[year]();
}
await p.locator("button:text-is('F2 Economy')").click(); await p.waitForTimeout(1500);
await p.screenshot({ path: "m3-end.png" });
log("FPS while running (speed 5):", JSON.stringify(fpsLog));
log("END", await bar()); log("DECISIONS", decisions, "GREYED", greyed, "ERRORS", JSON.stringify(errs));
await b.close();
