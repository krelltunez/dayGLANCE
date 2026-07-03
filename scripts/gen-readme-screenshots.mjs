// dayGLANCE README screenshot generator.
//
// Regenerates fresh, UNFRAMED captures of every view referenced in README.md,
// using the same demo seed and frozen mid-morning clock as the app-store set.
// These are raw (no device frame / background) — apply your framing treatment
// afterward, then swap them into README.md.
//
// Writes straight into screenshots/, overwriting the images README.md points at.
// Two README images are NOT reproducible headlessly and are left untouched:
//   - android-widget.png : an Android home-screen widget (OS launcher, not the web app)
//   - obsidian.png       : needs a live Obsidian vault so the inline note renders
//
// Usage:
//   npm run dev
//   node scripts/gen-readme-screenshots.mjs
//
// Output: screenshots/*.png (the 15 reproducible README images)

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'screenshots');
const SEED = fs.readFileSync(path.join(__dirname, 'seed-demo-data.js'), 'utf8');
const URL = process.env.DAYGLANCE_URL || 'http://localhost:5174/';
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FIXED = new Date('2026-07-02T11:20:00');
const launchOpts = { headless: true };
if (fs.existsSync(EXE)) launchOpts.executablePath = EXE;

fs.mkdirSync(OUT, { recursive: true });

const POLISH = `
  localStorage.setItem('gettingStartedDismissed', 'true');
  localStorage.setItem('day-planner-daily-content-enabled', 'false');
  localStorage.setItem('hideProjectTasksInbox', 'false');
  try {
    const goals = JSON.parse(localStorage.getItem('day-planner-goals') || '[]');
    for (const g of goals) {
      if (g.targetDate && new Date(g.targetDate + 'T00:00:00') < new Date('2026-07-02T00:00:00')) g.targetDate = '2026-09-30';
    }
    localStorage.setItem('day-planner-goals', JSON.stringify(goals));
  } catch (e) {}
`;

// Clear today's scheduled tasks so the Glance panel switches to GLANCEahead.
const CLEAR_TODAY = `
  try {
    const d = new Date(); const p = n => String(n).padStart(2,'0');
    const today = d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
    const tasks = JSON.parse(localStorage.getItem('day-planner-tasks') || '[]');
    localStorage.setItem('day-planner-tasks', JSON.stringify(tasks.filter(t => t.date !== today)));
  } catch (e) {}
`;

const browser = await chromium.launch(launchOpts);

async function page({ w, h, dsf, mobile, dark, extra = '' }) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, deviceScaleFactor: dsf,
    isMobile: mobile, hasTouch: mobile,
  });
  await ctx.clock.install({ time: FIXED });
  await ctx.clock.pauseAt(FIXED);
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.evaluate(SEED);
  await p.evaluate(`localStorage.setItem('day-planner-darkmode', ${JSON.stringify(dark)}); ${POLISH} ${extra}`);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await ctx.clock.runFor(3500);
  await p.waitForTimeout(300);
  await ctx.clock.runFor(1200);
  return { ctx, p };
}

const settle = async (ctx, p, ms = 1200) => { await ctx.clock.runFor(ms); await p.waitForTimeout(200); };
const save = (p, name) => p.screenshot({ path: path.join(OUT, `${name}.png`) });
const PHONE = { w: 430, h: 932, dsf: 3, mobile: true };
const ok = (n) => console.log('ok', n);
const fail = (n, e) => console.log('FAIL', n, e.message.split('\n')[0]);

// ---------- Desktop 1/2/3-day (dark) + light-mode + hero ----------
for (const [name, dark, size] of [
  ['hero-dark', true, { w: 1120, h: 760 }],
  ['light-mode', false, { w: 1120, h: 760 }],
  ['desktop-1col', true, { w: 1120, h: 760 }],
  ['desktop-2col', true, { w: 1360, h: 860 }],
  ['desktop-3col', true, { w: 1680, h: 980 }],
]) {
  try {
    const { ctx, p } = await page({ ...size, dsf: 2, mobile: false, dark });
    await save(p, name); ok(name);
    await ctx.close();
  } catch (e) { fail(name, e); }
}

// ---------- Desktop modals: routines (R) and goals (G) ----------
for (const [name, key] of [['routines', 'r'], ['goals-projects', 'g']]) {
  try {
    const { ctx, p } = await page({ w: 1360, h: 900, dsf: 2, mobile: false, dark: true });
    await p.locator('body').click({ position: { x: 5, y: 5 } });
    await p.keyboard.press(key);
    await settle(ctx, p, 1500);
    await save(p, name); ok(name);
    await ctx.close();
  } catch (e) { fail(name, e); }
}

// ---------- Phone: glance, timeline, inbox, android-timeline ----------
{
  const { ctx, p } = await page({ ...PHONE, dark: true });
  await save(p, 'glance'); ok('glance');
  for (const [label, name] of [['Timeline', 'timeline'], ['inbox', 'inbox']]) {
    try {
      await p.getByText(label, { exact: true }).click();
      await settle(ctx, p);
      await save(p, name); ok(name);
    } catch (e) { fail(name, e); }
  }
  // android-timeline is the same app timeline (Android is a WebView of the app)
  try {
    await p.getByText('Timeline', { exact: true }).click();
    await settle(ctx, p);
    await save(p, 'android-timeline'); ok('android-timeline');
  } catch (e) { fail('android-timeline', e); }
  await ctx.close();
}

// ---------- Phone: GLANCEahead (empty today) ----------
try {
  const { ctx, p } = await page({ ...PHONE, dark: true, extra: CLEAR_TODAY });
  await save(p, 'glanceahead'); ok('glanceahead');
  await ctx.close();
} catch (e) { fail('glanceahead', e); }

// ---------- Phone: daily summary overlay ----------
try {
  const { ctx, p } = await page({ ...PHONE, dark: true });
  await p.locator('button:has(svg[viewBox="0 0 36 36"])').first().click();
  await settle(ctx, p, 1500);
  await save(p, 'daily-summary'); ok('daily-summary');
  await ctx.close();
} catch (e) { fail('daily-summary', e); }

// ---------- Phone: focus setup + active ----------
try {
  const { ctx, p } = await page({ ...PHONE, dark: true });
  await p.getByRole('button', { name: 'Enter Focus Mode' }).click();
  await settle(ctx, p, 1500);
  await save(p, 'focus-mode-1'); ok('focus-mode-1');
  await p.getByRole('button', { name: 'Start Focus Session' }).click();
  await settle(ctx, p, 1500);
  await ctx.clock.runFor(60000);
  await p.waitForTimeout(200);
  await save(p, 'focus-mode-2'); ok('focus-mode-2');
  await ctx.close();
} catch (e) { fail('focus-mode', e); }

await browser.close();
console.log('=== README screenshots written to', OUT, '===');
console.log('NOT reproduced (need native context / live vault): android-widget.png, obsidian.png');
