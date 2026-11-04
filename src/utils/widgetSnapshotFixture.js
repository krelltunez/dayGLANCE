// A widget snapshot shaped like a LIVE push, built by the same producers the
// app's snapshot effect uses (buildProjectedDay → computeSkySnapshot,
// projectDialSnapshot), from a fixed day, place and task set. Written to
// dayglance-ios/TestFixtures/widgetSnapshot.live.json by `npm run
// ios:vectors` and consumed by the widget extension's own unit tests
// (dayglance-ios/DayGlanceWidgetTests), which push it through the widget's
// decoder, day resolution and face mapping and sample the rendered face.
//
// Why a second fixture next to dayDial.vectors.json: the vectors pin single
// functions. This pins the WHOLE payload the widget sees, so a field the JS
// side stops sending, or sends in a shape the strict Swift decoder rejects,
// fails a test here and in Swift instead of showing up as a blank ring on a
// phone. The DIAL_PREVIEW widget draws from a hand-made fixture and cannot
// catch that; this can. Same drift guard as the vectors:
// widgetSnapshotFixture.test.js fails when the committed file no longer
// matches what this builds.

import { buildProjectedDay, projectionDates, dateToString } from './widgetDayProjection.js';
import { DEFAULT_ALARM_PREFS } from './dialPrefs.js';
import { buildWidgetMonthWindow } from './widgetMonthWindow.js';
import { frameInstancesForDate, computeAvailableSlots } from '@glance-apps/agenda-core';
import { buildWidgetDueOn } from './widgetGoalsProjects.js';

export const LIVE_SNAPSHOT_TIMEZONE = 'America/Denver';
export const LIVE_SNAPSHOT_PATH = 'dayglance-ios/TestFixtures/widgetSnapshot.live.json';
/** Denver, the vectors' site: an ordinary sunrise and sunset, a real moon. */
export const LIVE_SNAPSHOT_COORDS = { lat: 39.7392, lon: -104.9903 };
/** Monday 2026-09-21, local noon. */
export const LIVE_SNAPSHOT_TODAY = () => new Date(2026, 8, 21, 12);

const task = (dateStr, over) => ({
  id: 'x', title: 'Untitled', color: 'bg-blue-500', date: dateStr,
  startTime: '09:00', duration: 60, tags: [], completed: false, projectId: null, ...over,
});

/** A plausible day: a done morning block, work, lunch, an evening event. */
export function liveFixtureTasks(dateStr) {
  return [
    task(dateStr, { id: `${dateStr}-run`, title: 'Run #health', startTime: '06:40', duration: 35, tags: ['health'], completed: true, color: 'bg-emerald-500' }),
    task(dateStr, { id: `${dateStr}-deep`, title: 'Deep work #deep [[Spec]]', startTime: '09:00', duration: 90, tags: ['deep'] }),
    task(dateStr, { id: `${dateStr}-standup`, title: 'Standup', startTime: '10:45', duration: 15, color: 'bg-purple-500' }),
    task(dateStr, { id: `${dateStr}-lunch`, title: 'Lunch', startTime: '12:15', duration: 45, color: 'bg-amber-500' }),
    task(dateStr, { id: `${dateStr}-review`, title: 'Review PRs', startTime: '14:05', duration: 55, color: 'bg-blue-500' }),
    task(dateStr, { id: `${dateStr}-dinner`, title: 'Dinner with Sam', startTime: '18:30', duration: 90, color: 'bg-rose-500' }),
    task(dateStr, { id: `${dateStr}-read`, title: 'Read', startTime: '21:00', duration: 40, color: 'bg-indigo-500' }),
  ];
}

/**
 * Frames on every weekday: a morning block with a focus frame inside it (the
 * nested case, which only a per-day exception produces in the app), an
 * afternoon block with nothing scheduled in it (0 %), and the evening. Colours
 * are the editor's pastel classes, as stored.
 */
export const LIVE_FIXTURE_FRAMES = [
  { id: 'f-morning', label: 'Deep work', color: 'bg-indigo-200', days: [1, 2, 3, 4, 5], start: '08:30', end: '12:30', enabled: true, bufferMinutes: 5 },
  { id: 'f-focus', label: 'Focus', color: 'bg-green-200', days: [1, 2, 3, 4, 5], start: '09:00', end: '10:30', enabled: true, bufferMinutes: 5 },
  { id: 'f-admin', label: 'Admin', color: 'bg-amber-200', days: [1, 2, 3, 4, 5], start: '15:00', end: '16:30', enabled: true, bufferMinutes: 5 },
  { id: 'f-evening', label: 'Evening', color: 'bg-rose-200', days: [1, 2, 3, 4, 5], start: '18:00', end: '21:45', enabled: true, bufferMinutes: 5 },
];

/** The day's frames with their unfloored slots, as App.jsx's dialFramesForDate. */
export function liveFixtureDialFrames(dateStr) {
  const tasks = liveFixtureTasks(dateStr);
  return frameInstancesForDate(LIVE_FIXTURE_FRAMES, dateStr).map((f) => ({
    ...f,
    slots: computeAvailableSlots(f, { tasks, dateStr, todayStr: dateStr, nowMinutes: 0 }),
  }));
}

/** Monday weeks in the fixture, so the Swift side cannot assume Sunday. */
export const LIVE_SNAPSHOT_WEEK_START = 1;
/** The crowded first of the month: seven blocks, an all-day item, a deadline. */
export const LIVE_MONTH_CROWDED_DAY = '2026-10-01';

const MONTH_TITLES = ['Standup', 'Deep work: payments migration #deep', 'Lunch with Priya', 'Review PRs', '1:1 with Sam',
  'Dentist', 'Gym', 'Pick up kids', 'Quarterly planning — draft goals for the next two quarters and circulate', 'Write weekly update',
  'Design review: onboarding flow', 'Groceries', 'Team retro', 'Customer call — Acme renewal'];
const MONTH_PALETTE = ['bg-blue-500', 'bg-rose-500', 'bg-emerald-500', 'bg-amber-500', 'bg-purple-500', 'bg-indigo-500'];
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * Six weeks with a real month's texture, for the month grid widget: busy
 * weekdays (some past the four-bar cap), light weekends, an early block and
 * a late one that runs past midnight (both outside the 7–21 window the widget
 * clamps to), all-day items and deadlines on scattered days, and a crowded
 * first of the month. Deterministic: derived from the date alone.
 */
export function liveMonthTasks(dateStr) {
  if (dateStr === LIVE_MONTH_CROWDED_DAY) {
    return [510, 600, 690, 810, 960, 1080, 1170].map((s, i) => task(dateStr, {
      id: `${dateStr}-c${i}`, startTime: hhmm(s), duration: [30, 60, 45, 90, 30, 60, 30][i],
      color: MONTH_PALETTE[i % MONTH_PALETTE.length], title: MONTH_TITLES[i % MONTH_TITLES.length],
    })).concat(task(dateStr, { id: `${dateStr}-rent`, title: 'Rent due', isAllDay: true, startTime: '', duration: 0, color: 'bg-red-500' }));
  }
  const date = new Date(`${dateStr}T12:00:00`);
  const dom = date.getDate();
  const dow = date.getDay();
  const weekend = dow === 0 || dow === 6;
  const count = weekend ? dom % 2 : 2 + (dom * 7) % 4 + (dom % 5 === 0 ? 2 : 0);
  const out = [];
  let cursor = 480 + (dom * 13) % 90;
  for (let k = 0; k < count && cursor < 1260; k++) {
    const duration = [15, 30, 45, 60, 90, 120][(dom + k * 3) % 6];
    out.push(task(dateStr, {
      id: `${dateStr}-m${k}`, title: MONTH_TITLES[(dom * 3 + k) % MONTH_TITLES.length],
      startTime: hhmm(cursor), duration, color: MONTH_PALETTE[(dom + k) % MONTH_PALETTE.length],
      // A done block on some days (today among them), for the agenda's completed style.
      completed: k === 0 && dom % 4 === 1,
    }));
    cursor += duration + 30 + ((dom * (k + 1)) % 5) * 20;
  }
  if (dom % 9 === 0) out.push(task(dateStr, { id: `${dateStr}-early`, startTime: '06:00', duration: 45, color: 'bg-emerald-500' }));
  if (dom % 11 === 0) out.push(task(dateStr, { id: `${dateStr}-late`, startTime: '22:30', duration: 120, color: 'bg-indigo-500' }));
  if (dom % 6 === 0) out.push(task(dateStr, { id: `${dateStr}-allday`, title: 'Maria’s birthday', isAllDay: true, startTime: '', duration: 0, color: 'bg-amber-500' }));
  return out;
}

const liveMonthDeadlines = (dateStr) => {
  const dom = Number(dateStr.slice(8));
  return (dateStr === LIVE_MONTH_CROWDED_DAY || dom % 8 === 3) ? [{ title: 'Submit expense report', color: 'bg-red-500' }] : [];
};

// Two projects with their own target date (#2160) on the first projected
// day: one with tasks, one with nothing to measure (progressPct null). They
// ride `projectsDue` only, which the Android day widget reads and the iOS
// widgets ignore; their tasks feed the progress figures, not the agenda.
const LIVE_DUE_PROJECT_TASKS = [
  { id: 'dp-t1', title: 'Order shingles', projectId: 'roof', completed: true },
  { id: 'dp-t2', title: 'Hire roofer', projectId: 'roof', completed: false },
];
const liveDueProjects = (dateStr) => [
  { id: 'roof', title: 'Renovate the roof', status: 'active', targetDate: dateStr },
  { id: 'garden', title: 'Plan the garden', status: 'active', targetDate: dateStr },
];

export function buildLiveWidgetSnapshot() {
  const today = LIVE_SNAPSHOT_TODAY();
  const dueProjectsDate = dateToString(projectionDates(today)[0]);
  const day = (date) => {
    const dateStr = dateToString(date);
    const prev = new Date(date);
    prev.setDate(prev.getDate() - 1);
    return buildProjectedDay({
      date,
      dateStr,
      dateLabel: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      dayTasks: liveFixtureTasks(dateStr),
      prevDayTasks: liveFixtureTasks(dateToString(prev)),
      dialFrames: liveFixtureDialFrames(dateStr),
      dayWindow: { start: '06:30', stop: '22:30' },
      coords: LIVE_SNAPSHOT_COORDS,
      projectsDue: buildWidgetDueOn({
        projects: liveDueProjects(dueProjectsDate), tasks: LIVE_DUE_PROJECT_TASKS, dateStr,
      }).projects,
    });
  };
  return {
    // The pushed day's fields at the top level, as App.jsx sends them, then
    // the day-invariant blocks, then the projected days.
    ...day(today),
    use24Hour: false,
    allGoals: [],
    allProjects: [],
    days: projectionDates(today).map(day),
    // The month grid's six weeks (+ rollover tail), from the same producer
    // App.jsx uses. A placed routine on the pushed day only, as in the app.
    monthWindow: buildWidgetMonthWindow({
      today,
      weekStartDay: LIVE_SNAPSHOT_WEEK_START,
      tasksForDate: (date) => liveMonthTasks(dateToString(date)),
      deadlinesForDate: liveMonthDeadlines,
      routinesForDate: (dateStr) => (dateStr === dateToString(today)
        ? [{ id: 'stretch', name: 'Stretch', startTime: '07:30', duration: 15, completed: true }]
        : []),
    }),
    timezone: LIVE_SNAPSHOT_TIMEZONE,
    // App.jsx sends the dial's alarm-mark prefs (utils/dialPrefs.js).
    dialAlarm: { ...DEFAULT_ALARM_PREFS },
    updatedAt: Date.UTC(2026, 8, 21, 18, 0, 0),
    reloadWidgets: true,
  };
}
