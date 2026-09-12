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
//   npm i playwright --no-save        # not a declared dependency
//   npx playwright install chromium   # once, unless CHROMIUM_PATH is set
//   npm run dev                       # vite's default port is 5173
//   DAYGLANCE_URL=http://localhost:5173/ node scripts/gen-readme-screenshots.mjs
//
// DAYGLANCE_URL defaults to :5174, which is NOT where `npm run dev` serves,
// so pass it unless your dev server is on that port. CHROMIUM_PATH overrides
// the browser; without it Playwright's own Chromium is used.
//
// No network is needed. The Day Dial capture is the only view that shows
// live-fetched data, and its forecast is served from a fixture over intercepted
// requests, so the image is identical on every machine and today's real sky
// can't change it.
//
// Every image is rewritten on each run. To refresh just one, run it and then
// restore the rest:
//   git status --porcelain screenshots/ | awk '{print $2}' \
//     | grep -v 'day-dial.png$' | xargs -r git checkout --
//
// Output: screenshots/*.png (the 16 reproducible README images)

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

// A canned Open-Meteo forecast, served to the Day Dial capture by request
// interception (see `routes` below). The weather layer is the one part of the
// face that comes off the network, so without this the capture either shows no
// temperatures or shows whatever the sky over Denver happened to be doing on
// the day someone ran the script. Fixed data makes the image reproducible, and
// lets it be generated from a sandbox with no route to api.open-meteo.com.
//
// The profile is an ordinary Front Range summer day: clear and cool at dawn,
// clouding up through the morning, an afternoon thunderstorm around 15:00 that
// the precipitation arc marks and that knocks the UV index (and so the
// daylight band) down with it.
const DENVER = { lat: 39.7392, lon: -104.9903 };
const DIAL_HOURLY = [
  // [temp °F, WMO code, UV index] for hours 00..23, local time.
  [64, 0, 0], [63, 0, 0], [62, 0, 0], [61, 0, 0], [60, 0, 0], [60, 0, 0],
  [63, 0, 0.3], [68, 0, 1.1], [73, 1, 2.6], [78, 1, 4.6], [82, 2, 6.7], [85, 2, 8.4],
  [88, 2, 9.5], [90, 3, 9.7], [91, 3, 8.8], [89, 95, 5.1], [86, 95, 3.4], [83, 80, 2.3],
  [80, 2, 1.2], [77, 1, 0.4], [74, 1, 0], [71, 0, 0], [69, 0, 0], [66, 0, 0],
];

// Day 0 is the dial's day and the only one it draws; days 1-5 exist because
// useWeather builds a five-day forecast strip from them.
const DIAL_DAILY = [
  [91, 60, 95], [88, 59, 2], [93, 62, 1], [95, 64, 0], [90, 63, 3], [86, 61, 80],
];

function openMeteoFixture(startDate) {
  const pad = (n) => String(n).padStart(2, '0');
  const dayStr = (i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };
  const time = [], temperature_2m = [], weather_code = [], uv_index = [];
  for (let i = 0; i < DIAL_DAILY.length; i++) {
    for (let h = 0; h < 24; h++) {
      // Later days ride the same hourly shape, nudged toward their own high:
      // nothing reads them but the strip's min/max, so the shape is enough.
      const drift = (DIAL_DAILY[i][0] - DIAL_DAILY[0][0]);
      time.push(dayStr(i) + 'T' + pad(h) + ':00');
      temperature_2m.push(DIAL_HOURLY[h][0] + drift);
      weather_code.push(i === 0 ? DIAL_HOURLY[h][1] : DIAL_DAILY[i][2]);
      uv_index.push(DIAL_HOURLY[h][2]);
    }
  }
  return {
    current: { temperature_2m: DIAL_HOURLY[11][0], weather_code: DIAL_HOURLY[11][1] },
    daily: {
      time: DIAL_DAILY.map((_, i) => dayStr(i)),
      temperature_2m_max: DIAL_DAILY.map((d) => d[0]),
      temperature_2m_min: DIAL_DAILY.map((d) => d[1]),
      weather_code: DIAL_DAILY.map((d) => d[2]),
    },
    hourly: { time, temperature_2m, weather_code, uv_index },
  };
}

const browser = await chromium.launch(launchOpts);

async function page({ w, h, dsf, mobile, dark, extra = '', tz, time, routes }) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, deviceScaleFactor: dsf,
    isMobile: mobile, hasTouch: mobile,
    // Default: the browser's own zone, which is UTC on CI. A capture that
    // shows SOLAR data has to pin a zone, or the sun marks land at the wrong
    // hours for the coordinates.
    ...(tz ? { timezoneId: tz } : {}),
  });
  // Canned JSON for outbound APIs, installed before the first navigation.
  // Anything the app fetches over the network is non-reproducible otherwise,
  // and unreachable from a sandbox with no egress.
  for (const [glob, body] of routes || []) {
    await ctx.route(glob, (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(typeof body === 'function' ? body() : body),
    }));
  }
  const at = time || FIXED;
  await ctx.clock.install({ time: at });
  await ctx.clock.pauseAt(at);
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

// ---------- Widescreen view cycler: MULTI / DAY / WEEK (needs >=1600px wide) ----------
for (const view of ['multi', 'day', 'week']) {
  const name = `desktop-${view}`;
  try {
    const { ctx, p } = await page({
      w: 1680, h: 980, dsf: 2, mobile: false, dark: true,
      extra: `localStorage.setItem('day-planner-default-view', ${JSON.stringify(JSON.stringify(view))}); localStorage.setItem('day-planner-view-mode', ${JSON.stringify(JSON.stringify(view))});`,
    });
    await save(p, name); ok(name);
    await ctx.close();
  } catch (e) { fail(name, e); }
}

// ---------- Day Dial (O) ----------
// Not in the seed, because these are per-device view preferences rather than
// data: which readouts ride the face, and the coordinates the solar layer
// reads back. The focus log is seeded here too so the session rail has
// something to draw — it is written by exiting focus mode, which no headless
// capture can do.
try {
  const name = 'day-dial';
  const { ctx, p } = await page({
    w: 1280, h: 960, dsf: 2, mobile: false, dark: true,
    // Denver, and the instant that reads 11:20 there — the solar layer draws
    // sunrise and sunset from the coordinates, so the clock has to agree with
    // them or the sun comes up at noon.
    //
    // This step overrides FIXED, and the DATE it picks is chosen for the
    // moon: 7 July 2026 is a last quarter over Denver, the one phase that
    // reads unmistakably AS a phase at glyph size — a straight terminator
    // rather than a disc. It cannot also sit mid-night, and that is geometry
    // rather than a compromise: a quarter moon transits near sunrise or
    // sunset by definition, and only a full moon transits at midnight, where
    // it would draw a plain circle. Everything else in the capture is
    // date-relative and follows.
    tz: 'America/Denver', time: new Date('2026-07-07T17:20:00Z'),
    // The forecast, served from a fixture rather than fetched: see
    // openMeteoFixture. The geocode is stubbed too, so the app resolves the
    // ZIP through its own code path and caches the coordinates itself.
    routes: [
      ['**/api.zippopotam.us/**', { places: [{ latitude: String(DENVER.lat), longitude: String(DENVER.lon) }] }],
      ['**/api.open-meteo.com/**', () => openMeteoFixture(new Date('2026-07-07T12:00:00'))],
    ],
    extra: `
      // The two lists you work FROM along the top, the two proportions you
      // are judged BY along the bottom — which is the reading order the face
      // deserves, and incidentally puts the two count readouts side by side
      // and the two rings side by side.
      //   top-left  Inbox     top-right     Deadlines
      //   bottom-l  Aligned   bottom-right  a project
      // Done is left off because it and Aligned draw the identical object,
      // and a habit because there are only four corners. The project id is
      // minted by the seed, so it is patched in below rather than written
      // here.
      localStorage.setItem('day-planner-dial-complications', '["inbox","deadlines","aligned",null]');
      localStorage.setItem('day-planner-goals-projects-enabled', 'true');
      // Extra fixtures for THIS capture only, so the shared seed (and the
      // other fifteen screenshots) stay as they are. The date is read off the
      // frozen clock rather than hard-coded, so it follows FIXED.
      (() => {
        const d = new Date();
        const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        const base = { date: day, completed: false, priority: 0, notes: '', subtasks: [], lastModified: d.toISOString() };
        const tasks = JSON.parse(localStorage.getItem('day-planner-tasks') || '[]');
        // Two pile-ups, so the ring shows its lane split: one nested inside
        // the 14:00 block, one partly over the 16:00 one. Kept away from the
        // 11:20 needle so the hub still narrates the block that is running.
        tasks.push(
          { ...base, id: 'dial-overlap-1', title: 'Design review #work', startTime: '14:30', duration: 45, color: 'bg-purple-500' },
          { ...base, id: 'dial-overlap-2', title: 'Vendor call #work', startTime: '16:15', duration: 35, color: 'bg-amber-500' },
        );
        localStorage.setItem('day-planner-tasks', JSON.stringify(tasks));

        // Routines at 25, 45 and 90 minutes, alongside the seed's two at 15,
        // so the track shows bars of visibly different lengths.
        const routines = JSON.parse(localStorage.getItem('day-planner-today-routines') || '[]');
        routines.push(
          { id: 'dial-routine-1', name: 'Morning pages', bucket: 'everyday', startTime: '07:00', duration: 25, isAllDay: false, completed: true, lastModified: d.toISOString() },
          { id: 'dial-routine-2', name: 'Inbox sweep', bucket: 'everyday', startTime: '13:00', duration: 45, isAllDay: false, completed: false, lastModified: d.toISOString() },
          { id: 'dial-routine-3', name: 'Evening shutdown', bucket: 'everyday', startTime: '20:30', duration: 90, isAllDay: false, completed: false, lastModified: d.toISOString() },
        );
        localStorage.setItem('day-planner-today-routines', JSON.stringify(routines));

        // The project readout: the first active project, with one of its
        // tasks completed so the ring is neither empty nor full. Its id comes
        // from the seed, so the slot is patched here rather than hard-coded.
        const projects = JSON.parse(localStorage.getItem('day-planner-projects') || '[]');
        const shown = projects.find((p) => p.status === 'active');
        if (shown) {
          const slots = JSON.parse(localStorage.getItem('day-planner-dial-complications') || '[]');
          slots[3] = 'project:' + shown.id;
          localStorage.setItem('day-planner-dial-complications', JSON.stringify(slots));
          for (const key of ['day-planner-tasks', 'day-planner-unscheduled']) {
            const list = JSON.parse(localStorage.getItem(key) || '[]');
            const first = list.find((t) => t.projectId === shown.id && !t.completed);
            if (first) { first.completed = true; localStorage.setItem(key, JSON.stringify(list)); break; }
          }
        }

        // Something actually due today, so the Deadlines readout is not a zero.
        const unscheduled = JSON.parse(localStorage.getItem('day-planner-unscheduled') || '[]');
        unscheduled.push(
          { ...base, id: 'dial-deadline-1', date: null, startTime: '00:00', duration: 30, title: 'Send the quarterly invoice #admin', deadline: day, priority: 2, color: 'bg-red-500' },
          { ...base, id: 'dial-deadline-2', date: null, startTime: '00:00', duration: 30, title: 'Renew the domain #admin', deadline: day, priority: 1, color: 'bg-blue-500' },
        );
        localStorage.setItem('day-planner-unscheduled', JSON.stringify(unscheduled));
      })();
      // Weather has to be configured, not just have coordinates cached:
      // useWeather clears day-planner-weather-coords when no location is set
      // ("location cleared -> the dial's sun marks go too"), which takes the
      // solar hairlines and the daylight band with it.
      localStorage.setItem('day-planner-weather-enabled', 'true');
      localStorage.setItem('day-planner-weather-zip', '80202');
      localStorage.setItem('day-planner-weather-temp-unit', 'fahrenheit');
      // Seeded as well as configured, so the solar layer has coordinates
      // before the first render rather than one fetch later. The stubbed
      // geocode writes the same pair back over them.
      localStorage.setItem('day-planner-weather-coords', '{"lat":39.7392,"lon":-104.9903}');
      // A declared day window is what gives the ring its night.
      localStorage.setItem('day-planner-day-windows', '{"defaults":{"start":"07:00","stop":"22:30","lastModified":"1970-01-01T00:00:00.000Z"}}');
      localStorage.setItem('day-planner-focus-log', '{"2026-07-07":{"totalMinutes":115,"sessions":3,"cyclesCompleted":3,"tasksCompleted":2,"spans":[{"start":540,"end":595},{"start":596,"end":625},{"start":870,"end":900}]}}');
    `,
  });
  await p.locator('body').click({ position: { x: 5, y: 5 } });
  await p.keyboard.press('o');
  await settle(ctx, p, 1800);
  await save(p, name); ok(name);
  await ctx.close();
} catch (e) { fail('day-dial', e); }

// ---------- Desktop modal: goals (G) ----------
for (const [name, key] of [['goals-projects', 'g']]) {
  try {
    const { ctx, p } = await page({ w: 1360, h: 900, dsf: 2, mobile: false, dark: true });
    await p.locator('body').click({ position: { x: 5, y: 5 } });
    await p.keyboard.press(key);
    await settle(ctx, p, 1500);
    await save(p, name); ok(name);
    await ctx.close();
  } catch (e) { fail(name, e); }
}

// ---------- Goals Roadmap (Gantt) with the v2.0 goal selected to reveal its projects ----------
try {
  const { ctx, p } = await page({ w: 1360, h: 1180, dsf: 2, mobile: false, dark: true });
  await p.locator('body').click({ position: { x: 5, y: 5 } });
  await p.keyboard.press('g');
  await settle(ctx, p, 1200);
  await p.getByRole('button', { name: 'Roadmap' }).click();
  await settle(ctx, p, 1200);
  // Select the goal bar so the detail panel with its child projects opens below.
  await p.getByText('Launch v2.0 client SaaS platform', { exact: false }).first().click();
  await settle(ctx, p, 1500);
  await save(p, 'goals-roadmap'); ok('goals-roadmap');
  await ctx.close();
} catch (e) { fail('goals-roadmap', e); }

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
  // android-timeline is the same app timeline (Android is a WebView of the app) — GRID view
  try {
    await p.getByText('Timeline', { exact: true }).click();
    await settle(ctx, p);
    await save(p, 'android-timeline'); ok('android-timeline');
  } catch (e) { fail('android-timeline', e); }
  await ctx.close();
}

// ---------- Phone: App Timeline — LIST view ----------
try {
  const { ctx, p } = await page({ ...PHONE, dark: true, extra: `localStorage.setItem('day-planner-mobile-view-mode', JSON.stringify('list'));` });
  await p.getByText('Timeline', { exact: true }).click();
  await settle(ctx, p);
  await save(p, 'android-timeline-list'); ok('android-timeline-list');
  await ctx.close();
} catch (e) { fail('android-timeline-list', e); }

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
