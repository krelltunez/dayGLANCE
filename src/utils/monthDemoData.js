// A realistic month of demo data for judging the month view against, since
// a real calendar is rarely busy enough on cue. Deterministic per month (the
// seed is the month), shaped exactly like the app's own tasks and inbox
// items so it flows through the same adapters as real data. Dev use only:
// nothing here is ever written to storage.
//
// Shape of the month: several events most weekdays with a mix of durations
// and some genuine overlaps; a few tasks a day in varied colours; the odd
// all-day item; a handful of deadlines; occasional weekend items; and a
// couple of quiet stretches so sparse and busy days sit side by side.

import { TASK_COLORS } from './colorUtils.js';
import { daysInMonth } from './monthGrid.js';

const mulberry32 = (seed) => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const EVENTS = ['Standup', 'Team sync', '1:1', 'Design review', 'Planning', 'Retro', 'Customer call', 'Dentist', 'Lunch with Sam', 'Board prep', 'Interview', 'Workshop', 'All hands', 'Coffee chat', 'Vendor demo'];
const TASKS = ['Write spec', 'Review PR', 'Deep work', 'Expense report', 'Draft proposal', 'Fix login bug', 'Prep slides', 'Groceries', 'Call bank', 'Read paper', 'Plan sprint', 'Update docs', 'Gym', 'Pay rent', 'Book flights'];
const ALL_DAY = ['Team offsite', 'Public holiday', 'Conference', "Mom's birthday", 'Out of office'];
const DEADLINES = ['Tax filing', 'Grant application', 'Quarterly report', 'Visa renewal', 'Insurance renewal', 'Abstract submission', 'Performance review'];
const CALENDARS = ['Work', 'Personal'];

const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];
const chance = (rnd, p) => rnd() < p;
const dateStr = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * @param {number} year
 * @param {number} month  1..12
 * @param {{ today?: string, seed?: number }} [opts]  today: YYYY-MM-DD, so
 *   earlier days get some completed work; seed: override the month seed
 * @returns {{ tasks: object[], unscheduled: object[], routines: object[] }}  the
 *   app's own shapes; routines are the day-scoped chips for `today` only, as
 *   in the app, where a routine exists on no other day
 */
export function generateDemoMonth(year, month, { today, seed } = {}) {
  const rnd = mulberry32(seed ?? year * 100 + month);
  const days = daysInMonth(year, month);
  const stamp = new Date(year, month - 1, 1).toISOString();
  const tasks = [];
  const unscheduled = [];
  let n = 0;
  const id = (prefix) => `demo-${prefix}-${year}${String(month).padStart(2, '0')}-${++n}`;

  // Two quiet stretches of three weekdays each.
  const quiet = new Set();
  for (let k = 0; k < 2; k++) {
    const start = 3 + Math.floor(rnd() * (days - 8));
    for (let d = start; d < start + 3; d++) quiet.add(d);
  }

  for (let d = 1; d <= days; d++) {
    const ds = dateStr(year, month, d);
    const dow = new Date(year, month - 1, d).getDay();
    const weekend = dow === 0 || dow === 6;
    const past = today ? ds < today : false;
    if (quiet.has(d) && !weekend) continue;
    if (weekend && !chance(rnd, 0.3)) continue;

    const eventCount = weekend ? 1 : 1 + Math.floor(rnd() * 4);          // 1..4 on weekdays
    const taskCount = weekend ? Math.floor(rnd() * 2) : Math.floor(rnd() * 3); // 0..2
    const used = [];
    const slot = () => {
      const start = weekend ? 600 + 15 * Math.floor(rnd() * 24) : 480 + 15 * Math.floor(rnd() * 38); // 08:00..17:15
      return start;
    };
    for (let i = 0; i < eventCount; i++) {
      const duration = pick(rnd, [30, 30, 45, 60, 60, 90, 120]);
      // About a third of the time, overlap the previous event on purpose.
      const start = used.length && chance(rnd, 0.35) ? used[used.length - 1] + 15 : slot();
      used.push(start);
      tasks.push({
        id: id('ev'), title: pick(rnd, EVENTS), date: ds, startTime: hhmm(start), duration,
        imported: true, calendarName: pick(rnd, CALENDARS), completed: false, createdAt: stamp,
      });
    }
    for (let i = 0; i < taskCount; i++) {
      const duration = pick(rnd, [15, 30, 30, 45, 60, 90]);
      tasks.push({
        id: id('t'), title: pick(rnd, TASKS), date: ds, startTime: hhmm(slot()), duration,
        color: pick(rnd, TASK_COLORS).class, completed: past && chance(rnd, 0.7), createdAt: stamp,
      });
    }
    if (chance(rnd, 0.08)) {
      const imported = chance(rnd, 0.5);
      tasks.push({ id: id('ad'), title: pick(rnd, ALL_DAY), date: ds, isAllDay: true, startTime: '00:00', duration: 0, imported, ...(imported ? { calendarName: pick(rnd, CALENDARS) } : { color: pick(rnd, TASK_COLORS).class }), completed: false, createdAt: stamp });
    }
  }

  // Five to seven deadlines, as inbox tasks due on a day of the month.
  const deadlineCount = 5 + Math.floor(rnd() * 3);
  for (let i = 0; i < deadlineCount; i++) {
    const d = 1 + Math.floor(rnd() * days);
    unscheduled.push({ id: id('dl'), title: pick(rnd, DEADLINES), deadline: dateStr(year, month, d), color: pick(rnd, TASK_COLORS).class, completed: false, createdAt: stamp });
  }

  // Routines: today's chips, the only day they exist on in the app.
  const routines = today && today.startsWith(dateStr(year, month, 1).slice(0, 8))
    ? [
      { id: 'demo-ro-run', name: 'Morning run', startTime: '06:30', duration: 30 },
      { id: 'demo-ro-breakfast', name: 'Breakfast', startTime: '07:30', duration: 30 },
      { id: 'demo-ro-lunch', name: 'Lunch', startTime: '12:00', duration: 45 },
      { id: 'demo-ro-walk', name: 'Walk', startTime: '15:30', duration: 15 },
      { id: 'demo-ro-gym', name: 'Gym', startTime: '18:30', duration: 60 },
    ]
    : [];

  return { tasks, unscheduled, routines };
}
