// The GLANCElauncher's snapshot of this app's data, served read-only by the
// Android LauncherProvider (dayglance-android/.../launcher/LauncherProvider.kt)
// and described in docs/launcher-integration.md. Built beside the widget
// snapshot (utils/widgetSnapshot.js) on the same trigger, but shaped for the
// launcher's models rather than for widgets: every row keeps its id and the
// fields the launcher's planning and dial need, and nothing is pre-rendered.
//
// Pure apart from the helpers it is handed: nothing here reads storage, the
// clock or the DOM. `now` is the instant the snapshot describes; the sun
// times come from the coordinates the dial already stores.

import { taskColorToHex } from './colorUtils.js';
import { deriveBlockEnergy } from './energyAxis.js';
import { getSunTimes } from './solar.js';
import { dateToString } from './taskUtils.js';
import { computeAvailableSlots } from './dayOccupancy.js';
import { sortProjectsByOrder } from './projectOrder.js';

export const LAUNCHER_SNAPSHOT_VERSION = 1;

/** Frame instances are listed per day over this window around today. */
export const FRAME_WINDOW = { daysBefore: 7, daysAfter: 34 };

/**
 * Device-calendar events are listed over this window: the launcher's planning
 * and dial look at today and the days ahead, and every event is a row in the
 * provider, so the window is kept to what is drawn.
 */
export const DEVICE_EVENT_WINDOW = { daysBefore: 1, daysAfter: 6 };

/**
 * What the Android shell needs to read the device calendar itself
 * (dayglance-android/.../launcher/LauncherDeviceEvents.kt): the calendars
 * shown, the user's edits to device events, and the window. The provider
 * re-reads the calendar on every query with these, so an event added in
 * another app reaches the launcher while this app is closed, which no
 * snapshot can do. Its rows must equal the ones built here from the same
 * events; dayglance-ios/TestFixtures/launcherDeviceEvents.vectors.json holds
 * both sides to that.
 *
 * Overrides keep only the fields nativeResultsToTasks applies, with the colour
 * resolved to hex (a device event's own colour still wins, as in taskRow).
 */
export function launcherDeviceCalendar({ filter = [], overrides = {} } = {}) {
  const out = {};
  for (const [id, o] of Object.entries(overrides || {})) {
    if (!o || typeof o !== 'object') continue;
    const entry = {};
    for (const key of ['date', 'startTime', 'duration', 'title', 'notes']) {
      if (o[key] !== undefined) entry[key] = o[key];
    }
    if (o.color !== undefined) entry.colorHex = taskColorToHex(o.color);
    out[String(id)] = entry;
  }
  return {
    filter: Array.isArray(filter) ? filter.map(String) : [],
    overrides: out,
    daysBefore: DEVICE_EVENT_WINDOW.daysBefore,
    daysAfter: DEVICE_EVENT_WINDOW.daysAfter,
  };
}

const timeToMinutes = (time) => {
  if (!time || typeof time !== 'string') return null;
  const [h, m] = time.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

const RECURRING_ID = /^recurring-(.+)-\d{4}-\d{2}-\d{2}$/;

// A device event's row is also built by the Android provider's own read
// (launcherDeviceCalendar below); a change to the fields regenerates the shared fixture.
function taskRow(t, source) {
  const isEvent = !!t.imported && !t.isTaskCalendar;
  const recurring = typeof t.id === 'string' ? RECURRING_ID.exec(t.id) : null;
  return {
    id: String(t.id),
    title: t.title || '',
    date: source === 'inbox' ? null : (t.date || null),
    startTime: !t.isAllDay && t.startTime ? t.startTime : null,
    duration: Number.isFinite(t.duration) ? t.duration : 0,
    isAllDay: !!t.isAllDay,
    completed: !!t.completed,
    completedAt: t.completedAt || null,
    colorHex: taskColorToHex(t.color, t.nativeCalendarColor),
    priority: t.priority ?? 0,
    notes: t.notes || '',
    projectId: t.projectId || null,
    deadline: t.deadline || null,
    source: isEvent ? 'calendar' : 'dayglance',
    energy: deriveBlockEnergy(t),
    clientId: t.clientId || null,
    recurringId: recurring ? recurring[1] : null,
    // A device-calendar event (CalendarContract), read live and never stored:
    // a headless refresh cannot read it, so the shell carries these rows over.
    native: !!t._native,
  };
}

const keep = (t, isVisibleForUser) => t && !t.archived && !t.isExample && isVisibleForUser(t);

/**
 * @param {object} input
 * @param {Date} input.now                 the instant described; its date is "today"
 * @param {string} input.todayStr          today's YYYY-MM-DD, as the app derives it
 * @param {Array} input.tasks              scheduled tasks
 * @param {Array} input.unscheduledTasks   the Inbox
 * @param {Array} input.expandedRecurringTasks  recurring occurrences over the app's expansion range
 * @param {Array} input.projects @param {Array} input.goals
 * @param {boolean} input.goalsProjectsEnabled
 * @param {Function} input.isVisibleForUser
 * @param {?number} [input.inboxCount]  the Inbox count as the app shows it, with its filters and
 *   user lens (utils/inboxFilter.js); the launcher's Inbox complication shows it. Null: left out.
 * @param {Array} input.todayRoutines @param {object} input.routineCompletions  id → the date completed
 * @param {boolean} input.routinesEnabled
 * @param {Function} input.frameInstancesForDate  (Date) → frame instances (utils/frameInstances.js)
 * @param {Function} input.getDayWindow    (dateStr) → { start, stop } as 'HH:MM' | null, or null
 * @param {?{lat:number, lon:number}} input.weatherCoords
 * @param {?object} input.weatherHourlyByDate  useWeather's hourlyByDate: { 'YYYY-MM-DD': { hour: {temp, code, uv} } }
 * @param {string} [input.weatherTempUnit]  'fahrenheit' | 'celsius', the unit the temps are in
 * @param {?{on:boolean, fromMin:number}} [input.dialAlarm]  the dial's alarm-mark prefs (utils/dialPrefs.js)
 * @param {?object} [input.dialLayers]  the dial's layer toggles (utils/dialPrefs.js loadDialLayers), which
 *   the launcher's dial follows; null leaves them out (every layer on).
 * @param {boolean} input.use24Hour
 * @param {string} input.timezone
 * @param {number} input.updatedAt         the push's own stamp (excluded from the fingerprint)
 * @param {Array} input.handledWrites      the launcher-write ledger (intents/launcherWrites.js)
 * @param {Function} [input.sunTimes]      (Date, lat, lon) → { sunriseMin, sunsetMin }; the real one by default
 * @param {?{dates:Set<string>, byDate:object}} [input.deviceEvents]  the device-calendar fetch
 *   (utils/widgetNativeEvents.js groupWidgetNativeEvents), independent of the day on screen.
 *   When given, it replaces the `_native` rows in `tasks` (which cover only the days the app
 *   is drawing) over DEVICE_EVENT_WINDOW. Null: the app's own `_native` rows, whatever they cover.
 * @param {boolean} [input.carryDeviceEvents]  this snapshot could not read the device calendar
 *   (the headless refresh): the shell keeps the previous snapshot's native rows.
 * @param {?{filter:string[], overrides:object}} [input.deviceCalendar]  the calendar filter and
 *   'day-planner-native-time-overrides', for the shell's own read (launcherDeviceCalendar).
 *   Null on a device without a device calendar.
 */
export function buildLauncherSnapshot({
  now, todayStr,
  tasks = [], unscheduledTasks = [], expandedRecurringTasks = [],
  projects = [], goals = [], goalsProjectsEnabled = false, isVisibleForUser = () => true,
  inboxCount = null,
  todayRoutines = [], routineCompletions = {}, routinesEnabled = true,
  frameInstancesForDate = () => [], getDayWindow = () => null,
  weatherCoords = null, weatherHourlyByDate = null, weatherTempUnit = 'fahrenheit', dialAlarm = null, dialLayers = null,
  use24Hour = false, timezone, updatedAt,
  handledWrites = [],
  sunTimes = getSunTimes,
  deviceEvents = null,
  carryDeviceEvents = false,
  deviceCalendar = null,
}) {
  const seen = new Set();
  const rows = [];
  const push = (t, source) => {
    if (!keep(t, isVisibleForUser)) return;
    const row = taskRow(t, source);
    if (seen.has(row.id)) return;
    seen.add(row.id);
    rows.push(row);
  };
  const eventDates = [];
  const noon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  for (let d = -DEVICE_EVENT_WINDOW.daysBefore; d <= DEVICE_EVENT_WINDOW.daysAfter; d++) {
    const date = new Date(noon);
    date.setDate(noon.getDate() + d);
    eventDates.push(dateToString(date));
  }
  for (const t of tasks) {
    if (deviceEvents && t?._native) continue;
    push(t, 'scheduled');
  }
  if (deviceEvents) {
    for (const date of eventDates) {
      for (const t of deviceEvents.byDate?.[date] || []) push(t, 'scheduled');
    }
  }
  for (const t of unscheduledTasks) push(t, 'inbox');
  for (const t of expandedRecurringTasks) push(t, 'recurring');

  const goalRows = goalsProjectsEnabled
    ? goals.map(g => ({
      id: String(g.id), title: g.title || '', description: g.description || '',
      colorHex: taskColorToHex(g.color), targetDate: g.targetDate || null, status: g.status || 'active',
    }))
    : [];
  // In the order the Goals & Projects space draws them (sortProjectsByOrder):
  // the launcher lists them as sent. One stable sort over every project keeps
  // each group's own order, since sortOrder is numbered per group.
  const projectRows = goalsProjectsEnabled
    ? sortProjectsByOrder(projects).map(p => ({
      id: String(p.id), title: p.title || '', goalId: p.goalId || null,
      colorHex: taskColorToHex(p.color), description: p.description || '', status: p.status || 'active',
      // The project's own target date (#2160), the same field and form a goal
      // row carries: a local YYYY-MM-DD, or null.
      targetDate: p.targetDate || null,
    }))
    : [];

  const routineRows = routinesEnabled
    ? todayRoutines.map(r => ({
      id: String(r.id), name: r.name || '',
      startTime: !r.isAllDay && r.startTime ? r.startTime : null,
      duration: Number.isFinite(r.duration) ? r.duration : null,
      isAllDay: !!r.isAllDay || !r.startTime,
      completed: routineCompletions[r.id] === todayStr,
    }))
    : [];

  // Each frame's free time, as the app's dial reads it (App.jsx dialFrameSlots):
  // computeAvailableSlots over the day's timed rows (the ones the launcher
  // draws) and today's routines, with no now floor, so the launcher takes
  // "still available" at its own minute. A row without a duration counts the
  // default 30 minutes, as the app's occupancy does.
  const timedByDate = new Map();
  for (const r of rows) {
    if (!r.date || !r.startTime) continue;
    if (!timedByDate.has(r.date)) timedByDate.set(r.date, []);
    timedByDate.get(r.date).push(r.duration > 0 ? r : { ...r, duration: undefined });
  }
  const routineState = {
    routines: todayRoutines, routinesDate: todayStr, routineCompletions, routinesEnabled, todayDate: todayStr,
  };
  const frameRows = [];
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  for (let d = -FRAME_WINDOW.daysBefore; d <= FRAME_WINDOW.daysAfter; d++) {
    const date = new Date(base);
    date.setDate(base.getDate() + d);
    const dateStr = dateToString(date);
    for (const f of frameInstancesForDate(date)) {
      const slots = computeAvailableSlots(f, {
        state: routineState, tasks: timedByDate.get(dateStr) || [], dateStr, todayStr: dateStr, nowMinutes: 0,
      });
      frameRows.push({
        id: `${f.frameId}:${dateStr}`, frameId: String(f.frameId), date: dateStr,
        start: f.start, end: f.end, name: f.label || '', colorHex: taskColorToHex(f.color),
        slots: slots.map(x => ({ start: x.start, end: x.end })),
      });
    }
  }

  const window = getDayWindow(todayStr) || {};
  const sun = weatherCoords && Number.isFinite(weatherCoords.lat) && Number.isFinite(weatherCoords.lon)
    ? sunTimes(now, weatherCoords.lat, weatherCoords.lon)
    : null;
  const hasCoords = !!sun;
  const dayShape = {
    dayStartMin: timeToMinutes(window.start),
    dayStopMin: timeToMinutes(window.stop),
    sunriseMin: sun?.sunriseMin ?? null,
    sunsetMin: sun?.sunsetMin ?? null,
    use24HourClock: !!use24Hour,
    // The weather location, for the launcher's moon and solar elevation.
    lat: hasCoords ? weatherCoords.lat : null,
    lon: hasCoords ? weatherCoords.lon : null,
    // The dial's alarm-mark prefs, so the launcher shows the mark as the app does.
    dialAlarm: dialAlarm ? { on: dialAlarm.on !== false, fromMin: Number.isFinite(dialAlarm.fromMin) ? dialAlarm.fromMin : 18 * 60 } : null,
    // The dial's layer toggles, so the launcher's dial draws what the app's does. Only the
    // layers the launcher draws; focus is the app's alone. A missing key reads as on.
    ...(dialLayers ? { dialLayers: {
      solar: dialLayers.solar !== false, weather: dialLayers.weather !== false,
      calendars: dialLayers.calendars !== false, routines: dialLayers.routines !== false,
      frames: dialLayers.frames !== false,
    } } : {}),
  };

  // Hourly weather per forecast date, as the dial's weather ring reads it: one
  // row per date, hours in order, temps already in the user's unit. Only dates
  // the forecast covers exist; the launcher drops the layer for any other.
  const weatherRows = [];
  for (const date of Object.keys(weatherHourlyByDate || {}).sort()) {
    const byHour = weatherHourlyByDate[date] || {};
    const hours = [];
    for (let h = 0; h < 24; h++) {
      const e = byHour[h];
      if (!e) continue;
      hours.push({
        hour: h,
        temp: Number.isFinite(e.temp) ? e.temp : null,
        code: Number.isFinite(e.code) ? e.code : null,
        uv: Number.isFinite(e.uv) ? Math.round(e.uv * 10) / 10 : null,
      });
    }
    if (hours.length) weatherRows.push({ id: date, date, unit: weatherTempUnit === 'celsius' ? 'celsius' : 'fahrenheit', hours });
  }

  return {
    version: LAUNCHER_SNAPSHOT_VERSION,
    updatedAt,
    timezone,
    today: todayStr,
    ...(Number.isFinite(inboxCount) ? { inboxCount } : {}),
    tasks: rows,
    goals: goalRows,
    projects: projectRows,
    routines: routineRows,
    frames: frameRows,
    dayShape,
    weather: weatherRows,
    ...(carryDeviceEvents ? { carryDeviceEvents: true } : {}),
    ...(deviceCalendar ? { deviceCalendar: launcherDeviceCalendar(deviceCalendar) } : {}),
    handledWrites: handledWrites.map(h => ({ clientId: h.clientId, taskId: h.taskId ?? null, action: h.action, at: h.at })),
  };
}

/** Content fingerprint: the snapshot minus its own stamp, so an unchanged day is not re-pushed. */
export function launcherSnapshotFingerprint(snapshot) {
  return JSON.stringify({ ...snapshot, updatedAt: 0 });
}
