// Day-keyed widget snapshot: the next N days, projected in advance so a
// widget can switch days at midnight without the app running.
//
// WHY: only the WebView writes widget content. A phone left in the background
// across midnight used to wake up with every widget holding yesterday's
// agenda; the stale state that landed first (WidgetFreshness.swift / .kt)
// made that honest, not fresh. This module makes it fresh for the DAY: the
// snapshot effect in App.jsx builds today exactly as before and adds
// `days: [today+1 … today+N]`, each built from the same functions, keyed by
// date. The native side resolves the entry's local day against the payload
// (docs/widget-background-refresh-plan.md, options iOS-A / Android-A).
//
// WHAT A PROJECTED DAY IS: right about the SHAPE of the day (timed blocks,
// all-day items, deadlines, frames, goals due, the sky, the dial) and silent
// about STATE that cannot exist yet — the day's completions, its habit
// counts, its routines (chips the user places each day; a new day starts
// empty, so a projected dial honestly has fewer blocks than the day will
// eventually have), the overdue list (which is today's, repeated), the
// GLANCEahead preview, hyperGLANCE sessions and the Live Activity summary
// (all today-only by construction). The native side labels a projected day
// "planned as of <push time>".
//
// WHAT IS KEPT ON PURPOSE: per-task tags and project references, at the same
// richness as the pushed day. The dial's Phase 4 timeline is 96 entries over
// 24 hours, so a timeline built at 20:00 draws tomorrow after midnight, with
// tomorrow's needle moving through tomorrow's blocks and the hub naming each
// block and its tag as it becomes current.
//
// N = 3: a weekend away stays covered, and the dial's own 24-hour timeline
// crosses midnight by design, so N = 1 would break the dial's timeline and
// not just the multi-day case. Recurring instances for those days exist only
// because the expansion range is anchored at today+N as well as today
// (recurringExpansionRange.js) — without that anchor a user parked on last
// week would get projected days with recurring blocks silently missing.

import { stripWikilinksAndTags, dateToString } from './taskUtils.js';
import { taskColorToHex, frameColorToHex } from './colorUtils.js';
import { computeSkySnapshot, projectDialSnapshot } from './dayDial.js';

// Local on purpose: streamDeckPayload.js exports one but pulls in an Electron
// alias, and this module has to load in plain Node (tests, measurements).
// Same semantics as the App.jsx helper the sections code used.
const timeToMinutes = (time) => {
  if (!time) return 0;
  const [h, m] = String(time).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Days projected beyond today. See the header for why 3. */
export const WIDGET_PROJECTION_DAYS = 3;

/**
 * Size guard for one push, in UTF-8 bytes of the JSON. Mirrors
 * `snapshotCapBytes` in dayglance-ios/DayGlance/Bridges/WidgetBridge.swift,
 * which drops anything larger. 400 KB replaces a 200 KB figure that had been
 * chosen as "safely under 30 MB" rather than measured; the Phase 0 spike put
 * the widget extension at 13–18 MB footprint with all of this decoded, and a
 * busy day measured 17 KB per projected day before trimming. The WARN
 * threshold is the signal for the next person: past it, something grew.
 */
export const WIDGET_SNAPSHOT_CAP_BYTES = 400_000;
export const WIDGET_SNAPSHOT_WARN_BYTES = 300_000;

/** The N dates after `today`, as local Dates at noon (DST-safe arithmetic). */
export function projectionDates(today, days = WIDGET_PROJECTION_DAYS) {
  const out = [];
  for (let i = 1; i <= days; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i, 12, 0, 0, 0);
    out.push(d);
  }
  return out;
}

/**
 * The one task shape every widget list draws (the SCHEDULED sections on
 * Android, the light rows on both). Same rule everywhere: no [[wikilinks]] (a
 * widget cannot open a note) and no #tags in the title — they ride `tags`.
 * Moved verbatim from the snapshot effect so today and the projected days
 * cannot drift.
 */
export function serializeWidgetTask(t, projectNameFor) {
  return {
    id: t.id,
    title: stripWikilinksAndTags(t.title),
    colorHex: taskColorToHex(t.color, t.nativeCalendarColor),
    startTime: t.startTime || '',
    duration: t.duration || 0,
    tags: (t.tags || []).slice(0, 3),
    projectName: projectNameFor ? projectNameFor(t) : '',
  };
}

/**
 * Frame sections + unframed scheduled tasks, in day order. Verbatim from the
 * snapshot effect (it built today's `sections` inline); shared now so a
 * projected day is assembled by the same code as today.
 *
 * @param scheduled  The day's timed tasks in start order, overdue ones already
 *                   removed by the caller (today) or none to remove (projected).
 * @param frames     Frame instances for the day, already filtered the way the
 *                   caller wants (today drops frames that have ended).
 * @param frameAvailableMinutes (frame) => free minutes inside it.
 * @param serialize  (task) => the row shape.
 */
export function buildScheduleSections({ scheduled, frames, frameAvailableMinutes, serialize }) {
  const taskFrameMap = new Map();
  for (const task of scheduled) {
    if (!task.startTime) continue;
    const tStart = timeToMinutes(task.startTime);
    const tEnd = tStart + (task.duration || 0);
    for (const frame of frames) {
      if (tStart >= timeToMinutes(frame.start) && tEnd <= timeToMinutes(frame.end)) {
        taskFrameMap.set(String(task.id), frame.frameId);
        break;
      }
    }
  }

  const sections = [];
  const sortedFrames = [...frames].sort(
    (a, b) => timeToMinutes(a.start) - timeToMinutes(b.start)
  );
  const assignedIds = new Set();
  let schedIdx = 0;

  for (const frame of sortedFrames) {
    const fStart = timeToMinutes(frame.start);
    const beforeTasks = [];
    while (schedIdx < scheduled.length) {
      const t = scheduled[schedIdx];
      if (timeToMinutes(t.startTime || '00:00') < fStart && !taskFrameMap.has(String(t.id))) {
        beforeTasks.push(t);
        assignedIds.add(String(t.id));
        schedIdx++;
      } else break;
    }
    if (beforeTasks.length > 0) {
      sections.push({ type: 'unframed', tasks: beforeTasks.map(serialize) });
    }

    const frameTasks = scheduled.filter(t => taskFrameMap.get(String(t.id)) === frame.frameId);
    const totalAvail = frameAvailableMinutes(frame);
    const frameColorHex = frameColorToHex(frame.color);

    if (totalAvail > 0 || frameTasks.length > 0) {
      sections.push({
        type: 'frame',
        name: frame.label,
        colorHex: frameColorHex,
        start: frame.start,
        end: frame.end,
        availableMinutes: totalAvail,
        tasks: frameTasks.map(serialize),
      });
    }
    frameTasks.forEach(t => assignedIds.add(String(t.id)));
    while (schedIdx < scheduled.length && assignedIds.has(String(scheduled[schedIdx].id))) schedIdx++;
  }
  const remaining = scheduled.filter(t => !assignedIds.has(String(t.id)));
  if (remaining.length > 0) {
    sections.push({ type: 'unframed', tasks: remaining.map(serialize) });
  }
  return sections;
}

/**
 * One projected day. Pure: everything date-dependent arrives resolved for
 * THAT day by the caller (the App.jsx helpers are per-render closures).
 *
 * @param opts.date        Local Date inside the day.
 * @param opts.dateStr     'YYYY-MM-DD' of the day.
 * @param opts.dateLabel   Localized short label, as the pushed day carries.
 * @param opts.dayTasks    getTasksForDate(date): tasks + recurring
 *                         instances, visibility-filtered, no tag filter.
 * @param opts.prevDayTasks The day before, for the dial's overnight carry.
 * @param opts.deadlineTasks Inbox tasks due that day (caller-filtered).
 * @param opts.frames      getFrameInstancesForDate(date), unfiltered: nothing
 *                         has ended on a day that has not started.
 * @param opts.frameAvailableMinutes (frame) => minutes; the caller wraps
 *                         computeAvailableSlots(frame, date), which already
 *                         knows a future day has no elapsed time.
 * @param opts.dialFrames  The same frames with their unfloored `slots`, for
 *                         the Day Dial (projectDialSnapshot `frames`).
 * @param opts.dayWindow   getDayWindow(dateStr) or null.
 * @param opts.coords      Stored weather coords or null → no sky.
 * @param opts.goalsDue    Goals with targetDate === dateStr, already shaped.
 * @param opts.projectsDue Projects with targetDate === dateStr, already shaped (#2160).
 * @param opts.projectNameFor (task) => project title or ''.
 */
export function buildProjectedDay({
  date, dateStr, dateLabel,
  dayTasks = [], prevDayTasks = [], deadlineTasks = [],
  frames = [], frameAvailableMinutes = () => 0, dialFrames = null,
  dayWindow = null, coords = null, goalsDue = [], projectsDue = [],
  projectNameFor = () => '',
}) {
  const serialize = (t) => serializeWidgetTask(t, projectNameFor);
  const live = dayTasks.filter(t => t && !t.isExample);

  // Same partition todayAgenda makes, minus the clock: on a day that has not
  // started nothing has ended, so every timed task is "scheduled".
  const allDay = live
    .filter(t => t.isAllDay && !t.completed)
    .map(t => ({
      id: t.id,
      title: stripWikilinksAndTags(t.title),
      colorHex: taskColorToHex(t.color, t.nativeCalendarColor),
      projectName: projectNameFor(t),
    }));
  const scheduled = live
    .filter(t => !t.isAllDay)
    .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  const deadlines = deadlineTasks.map(t => ({
    id: t.id,
    title: stripWikilinksAndTags(t.title),
    colorHex: taskColorToHex(t.color, t.nativeCalendarColor),
    projectName: projectNameFor(t),
  }));

  const sections = buildScheduleSections({ scheduled, frames, frameAvailableMinutes, serialize });

  // Up Next for a day that has not started: the whole incomplete timed list
  // in order. The native side promotes through it by the clock when the day
  // arrives (a projected day cannot know what "now" will be), so unlike the
  // pushed day this list is NOT capped at four — cutting it would leave the
  // widget empty by mid-afternoon with tasks still ahead. Notes and subtasks
  // are today-only richness and are trimmed; tags and project stay.
  const upcoming = scheduled
    .filter(t => !t.completed && t.startTime)
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))
    .map(serialize);
  const nextTask = upcoming[0] || null;
  const upcomingTasks = upcoming.slice(1);

  return {
    date: dateStr,
    dateLabel,
    allDay,
    deadlines,
    sections,
    goals: goalsDue,
    projectsDue,
    nextTask,
    upcomingTasks,
    sky: computeSkySnapshot(date, coords),
    dial: projectDialSnapshot({
      date: dateStr,
      dayTasks: live,
      prevDayTasks,
      dayWindow,
      routines: null,
      routineCompletions: null,
      frames: dialFrames,
    }),
  };
}

/**
 * Sanity guard on the wire size. Returns the JSON to send: the full payload,
 * or — past the cap — the payload with its optional blocks shed one at a time
 * until it fits, so today still reaches the widgets while the extras are
 * dropped loudly rather than the whole push being refused on the native side.
 * Shed order: `monthWindow` first (the month grid, widgetMonthWindow.js),
 * then `days` — the existing widgets' projection outranks the newer field.
 */
const SHEDDABLE_FIELDS = ['monthWindow', 'days'];

/**
 * JSON.stringify replacer for the widget snapshot: every `id` goes out as a
 * string. The iOS models decode ids as String?, and one numeric id anywhere
 * (an imported or legacy row) fails the WHOLE decode, blanking every widget.
 */
export const stringIds = (key, value) => (key === 'id' && typeof value === 'number' ? String(value) : value);

export function guardSnapshotSize(snapshot, {
  cap = WIDGET_SNAPSHOT_CAP_BYTES, warn = WIDGET_SNAPSHOT_WARN_BYTES, log = console,
} = {}) {
  // TextEncoder exists in every WebView this runs in and in Node ≥ 11 (tests).
  const byteLength = (s) => new TextEncoder().encode(s).length;
  let json = JSON.stringify(snapshot, stringIds);
  let bytes = byteLength(json);
  const droppedFields = [];
  if (bytes > cap) {
    let current = snapshot;
    for (const field of SHEDDABLE_FIELDS) {
      if (bytes <= cap) break;
      if (current[field] == null) continue;
      // eslint-disable-next-line no-unused-vars
      const { [field]: _gone, ...rest } = current;
      current = rest;
      droppedFields.push(field);
      log.error(`[widget] snapshot is ${bytes} B, over the ${cap} B cap: dropping \`${field}\` for this push. Something grew — see widgetDayProjection.js.`);
      json = JSON.stringify(current, stringIds);
      bytes = byteLength(json);
    }
  } else if (bytes > warn) {
    log.warn(`[widget] snapshot is ${bytes} B, past the ${warn} B warning line (cap ${cap} B). Something grew — see widgetDayProjection.js.`);
  }
  return { json, bytes, dropped: droppedFields.length > 0, droppedFields };
}

/** 'YYYY-MM-DD' for a local Date; re-exported so callers need one import. */
export { dateToString };
