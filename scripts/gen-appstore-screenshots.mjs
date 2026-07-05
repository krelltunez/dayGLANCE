// dayGLANCE App Store screenshot generator.
//
// Boots the running dev server (http://localhost:5174), seeds realistic demo
// data (scripts/seed-demo-data.js), freezes the clock at mid-morning so the day
// reads as "in progress" rather than overdue, and captures the key views at
// iPhone 6.7" resolution (1290x2796) plus a wide desktop hero, in light + dark.
//
// Usage:
//   npm run dev                         # in one terminal (serves on 5174)
//   node scripts/gen-appstore-screenshots.mjs [light|dark|both]
//
// Output: screenshots/app-store/{phone,desktop}/*.png
//
// The pre-installed Chromium path below is for the Claude Code web sandbox; on a
// normal machine, drop `executablePath` (or run `npx playwright install chromium`).

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'screenshots', 'app-store');
const SEED = fs.readFileSync(path.join(__dirname, 'seed-demo-data.js'), 'utf8');
const URL = process.env.DAYGLANCE_URL || 'http://localhost:5174/';
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FIXED = new Date('2026-07-02T11:20:00'); // Thursday mid-morning
const launchOpts = { headless: true };
if (fs.existsSync(EXE)) launchOpts.executablePath = EXE;

fs.mkdirSync(path.join(OUT, 'phone'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'tablet'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'desktop'), { recursive: true });

// Screenshot-time polish applied on top of the generic demo seed, so the base
// seed stays neutral: reveal project-linked inbox tasks (fuller inbox) and push
// any past goal target dates into the future (nothing reads as "overdue").
const POLISH = `
  localStorage.setItem('gettingStartedDismissed', 'true');
  localStorage.setItem('day-planner-daily-content-enabled', 'false');
  localStorage.setItem('hideProjectTasksInbox', 'false');
  try {
    const goals = JSON.parse(localStorage.getItem('day-planner-goals') || '[]');
    const soon = '2026-09-30';
    for (const g of goals) {
      if (g.targetDate && new Date(g.targetDate + 'T00:00:00') < new Date('2026-07-02T00:00:00')) {
        g.targetDate = soon;
      }
    }
    localStorage.setItem('day-planner-goals', JSON.stringify(goals));
  } catch (e) {}
`;

const browser = await chromium.launch(launchOpts);

async function seededPage(size, dark, extra = '') {
  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: size.dsf,
    isMobile: size.mobile,
    hasTouch: size.mobile,
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

async function run(mode) {
  const dark = mode === 'dark';
  const tag = (n) => `${n}-${mode}.png`;
  const phone = { w: 430, h: 932, dsf: 3, mobile: true };

  // ---- Phone: tabbed views share one page ----
  {
    const { ctx, p } = await seededPage(phone, dark);
    await p.screenshot({ path: path.join(OUT, 'phone', tag('01-glance')) });
    console.log(mode, 'glance ok');

    for (const [label, name] of [['Timeline', '02-timeline'], ['inbox', '03-inbox'], ['Goals', '04-goals']]) {
      try {
        await p.getByText(label, { exact: true }).click();
        await settle(ctx, p);
        await p.screenshot({ path: path.join(OUT, 'phone', tag(name)) });
        console.log(mode, name, 'ok');
      } catch (e) { console.log(mode, name, 'FAIL', e.message.split('\n')[0]); }
    }

    // Goals -> Roadmap flowchart (still on the Goals tab from the loop above)
    try {
      await p.getByRole('button', { name: 'Roadmap' }).click();
      await settle(ctx, p, 1500);
      await p.screenshot({ path: path.join(OUT, 'phone', tag('04b-roadmap')) });
      console.log(mode, '04b-roadmap ok');
    } catch (e) { console.log(mode, '04b-roadmap FAIL', e.message.split('\n')[0]); }

    await ctx.close();
  }

  // ---- Phone: timeline in LIST view (fresh page, mobile-view-mode = list) ----
  try {
    const { ctx, p } = await seededPage(phone, dark, `localStorage.setItem('day-planner-mobile-view-mode', JSON.stringify('list'));`);
    await p.getByText('Timeline', { exact: true }).click();
    await settle(ctx, p);
    await p.screenshot({ path: path.join(OUT, 'phone', tag('02b-timeline-list')) });
    console.log(mode, '02b-timeline-list ok');
    await ctx.close();
  } catch (e) { console.log(mode, '02b-timeline-list FAIL', e.message.split('\n')[0]); }

  // ---- Phone: Daily Summary overlay (fresh page) ----
  try {
    const { ctx, p } = await seededPage(phone, dark);
    await p.locator('button:has(svg[viewBox="0 0 36 36"])').first().click();
    await settle(ctx, p, 1500);
    await p.screenshot({ path: path.join(OUT, 'phone', tag('05-daily-summary')) });
    console.log(mode, 'daily-summary ok');
    await ctx.close();
  } catch (e) { console.log(mode, 'daily-summary FAIL', e.message.split('\n')[0]); }

  // ---- Phone: Focus Mode overlay (fresh page) ----
  try {
    const { ctx, p } = await seededPage(phone, dark);
    await p.getByRole('button', { name: 'Enter Focus Mode' }).click();
    await settle(ctx, p, 1500);
    await p.screenshot({ path: path.join(OUT, 'phone', tag('06-focus')) });
    console.log(mode, 'focus ok');
    // Start the session -> running timer
    try {
      await p.getByRole('button', { name: 'Start Focus Session' }).click();
      await settle(ctx, p, 1500);
      await ctx.clock.runFor(60000); // advance a minute: timer reads 24:00, elapsed 1m
      await p.waitForTimeout(200);
      await p.screenshot({ path: path.join(OUT, 'phone', tag('07-focus-active')) });
      console.log(mode, '07-focus-active ok');
    } catch (e) { console.log(mode, '07-focus-active FAIL', e.message.split('\n')[0]); }
    await ctx.close();
  } catch (e) { console.log(mode, 'focus FAIL', e.message.split('\n')[0]); }

  // ---- Desktop hero: 3-column glance + timeline ----
  {
    const { ctx, p } = await seededPage({ w: 1680, h: 1050, dsf: 2, mobile: false }, dark);
    await p.screenshot({ path: path.join(OUT, 'desktop', tag('01-overview')) });
    console.log(mode, 'desktop overview ok');
    await ctx.close();
  }

  // ---- Desktop: Goals & Projects modal ----
  {
    const { ctx, p } = await seededPage({ w: 1680, h: 1050, dsf: 2, mobile: false }, dark);
    try {
      await p.getByRole('button', { name: 'Goals & Projects' }).click();
      await settle(ctx, p, 1500);
      await p.screenshot({ path: path.join(OUT, 'desktop', tag('02-goals')) });
      console.log(mode, 'desktop goals ok');
    } catch (e) { console.log(mode, 'desktop goals FAIL', e.message.split('\n')[0]); }
    await ctx.close();
  }

  // ---- Tablet: iPad 12.9" portrait (1024x1366 @2x = 2048x2732) ----
  {
    const tablet = { w: 1024, h: 1366, dsf: 2, mobile: true };
    const { ctx, p } = await seededPage(tablet, dark);
    await p.screenshot({ path: path.join(OUT, 'tablet', tag('01-overview')) });
    console.log(mode, 'tablet overview ok');
    try {
      await p.getByRole('button', { name: 'Goals & Projects' }).click();
      await settle(ctx, p, 1500);
      await p.screenshot({ path: path.join(OUT, 'tablet', tag('02-goals')) });
      console.log(mode, 'tablet goals ok');
    } catch (e) { console.log(mode, 'tablet goals FAIL', e.message.split('\n')[0]); }
    await ctx.close();
  }
}

const arg = (process.argv[2] || 'both').toLowerCase();
const modes = arg === 'both' ? ['light', 'dark'] : [arg];
for (const m of modes) await run(m);

await browser.close();
console.log('=== screenshots written to', OUT, '===');
