/**
 * Native (device-local) calendar integration.
 *
 * Two transports share one event-JSON contract so the rest of the app stays
 * platform-agnostic:
 *
 *   - Mobile bridge (Android/iOS): synchronous accessors on window.DayGlanceNative
 *     (see src/native.js — nativeGetCalendars / nativeGetEvents).
 *   - macOS Electron desktop: asynchronous IPC on window.electronAPI, backed by a
 *     signed Swift EventKit helper spawned by the main process.
 *
 * Event JSON contract (identical across every platform — verified against the
 * iOS CalendarBridge):
 *   getCalendars()  → [{ id, name, accountName, color }]
 *   getEvents(date) → [{ id, title, start, end, allDay, notes, location,
 *                        calendarId, calendarName, color }]
 *
 * Native events are tagged `_native: true` by nativeEventToTask and are never
 * persisted or synced, so they sidestep the multi-user calendar-leak concern
 * entirely (consistent with the per-user calendar config work).
 */
import { isNativeApp } from '../native.js';
import { taskEnd } from '@glance-apps/agenda-core';

const timeToMinutes = (time) => {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
};

/**
 * True when the Electron renderer exposes the macOS calendar IPC bridge.
 * Gated on the darwin platform so Windows/Linux Electron builds keep relying
 * on URL/CalDAV subscriptions.
 */
export const electronCalendarAvailable = () =>
  typeof window !== 'undefined' &&
  !!window.electronAPI?.getCalendarEvents &&
  window.electronAPI?.platform === 'darwin';

/**
 * True when device-local calendar events are available from any native source —
 * the mobile bridge (Android/iOS) or the macOS Electron EventKit helper.
 * The URL/CalDAV read-sync path is skipped whenever this is true.
 */
export const hasNativeCalendar = () => isNativeApp() || electronCalendarAvailable();

/**
 * Requests macOS calendar access. Triggers the system permission dialog the
 * first time it runs; subsequent calls resolve immediately. Returns true when
 * events can be read. No-op (false) when the Electron bridge is absent.
 */
export const electronRequestCalendarAccess = async () => {
  if (!window.electronAPI?.requestCalendarAccess) return false;
  try {
    const res = await window.electronAPI.requestCalendarAccess();
    return !!res?.granted;
  } catch {
    return false;
  }
};

/**
 * Fetches the device calendar list from the Electron helper.
 *
 * The main process caches the list (5 min TTL) so a tray-popup reload doesn't
 * re-spawn the helper for a list the main window already fetched. Pass
 * `{ force: true }` for an explicit user-initiated refresh, which must always
 * re-query EventKit — an empty list is never cached, but a stale non-empty one
 * would otherwise hide a calendar the user just added.
 */
export const electronGetCalendars = async ({ force = false } = {}) => {
  if (!window.electronAPI?.getCalendars) return [];
  try {
    return (await window.electronAPI.getCalendars(force)) ?? [];
  } catch {
    return [];
  }
};

/**
 * Fetches events for each date in `dates` from the Electron helper and returns a
 * per-date array aligned to the input — the same shape the mobile path produces
 * via `dates.map(nativeGetEvents)` — so the App-side merge logic is identical
 * across platforms. The helper queries each day with the same overlap predicate
 * as the mobile bridge, so multi-day all-day events appear under every day they
 * span. Entries are `null` when a day has no result (e.g. access denied).
 */
export const electronGetEventsByDate = async (dates) => {
  if (!dates?.length || !window.electronAPI?.getCalendarEvents) {
    return (dates ?? []).map(() => null);
  }
  try {
    const map = await window.electronAPI.getCalendarEvents(dates[0], dates[dates.length - 1]);
    return dates.map((d) => (Array.isArray(map?.[d]) ? map[d] : null));
  } catch {
    return dates.map(() => null);
  }
};

/**
 * The device-calendar filter ('day-planner-calendar-filter', synced) lists the
 * calendar ids to show. An empty list shows every calendar, which is what
 * stored and synced filters already mean. Hiding every calendar is a list
 * holding only this placeholder (#2120): it matches no real id, so every
 * consumer's "keep only these ids" check hides everything without knowing
 * about it, including a device on a build that predates it.
 */
export const CALENDAR_FILTER_NONE = '__none__';

export const isCalendarFilterNone = (filter) =>
  filter.length > 0 && filter.every(id => id === CALENDAR_FILTER_NONE);

export const isCalendarShown = (filter, id) =>
  filter.length === 0 || filter.includes(id);

/**
 * The filter after the user toggles one calendar's checkbox. Checking the last
 * unchecked calendar collapses to [] (show all, so calendars added later show
 * too); unchecking the last checked one becomes the placeholder rather than []
 * — [] would mean "show all" and every box would spring back on.
 *
 * @param allIds  The ids of the calendars listed in settings.
 */
export function toggleCalendarInFilter(filter, id, allIds) {
  const current = filter.length === 0 ? allIds : filter.filter(f => f !== CALENDAR_FILTER_NONE);
  const next = current.includes(id) ? current.filter(f => f !== id) : [...current, id];
  if (next.length === 0) return [CALENDAR_FILTER_NONE];
  return allIds.every(a => next.includes(a)) ? [] : next;
}

/**
 * The filter after calendars are discovered that the list did not have: they
 * show as checked when some calendars are shown, and stay hidden when the user
 * has hidden every calendar.
 */
export function extendCalendarFilter(filter, newIds) {
  if (filter.length === 0 || isCalendarFilterNone(filter)) return filter;
  const toAdd = newIds.filter(id => !filter.includes(id));
  return toAdd.length > 0 ? [...filter, ...toAdd] : filter;
}

/**
 * Maps a native calendar event (mobile bridge or Electron helper — identical
 * shape) to a `_native`-flagged task. `_native` tasks are excluded from saveData
 * so they're never persisted or synced.
 *
 * @param event  Native event JSON, optionally tagged with `_queryDate` (the day
 *               it was fetched for) so multi-day all-day events land on the
 *               correct day.
 *
 * Mirrored by the Android launcher provider's own calendar read
 * (launcher/LauncherDeviceEvents.kt), with nativeResultsToTasks below; a
 * change here regenerates launcherDeviceEvents.vectors.json
 * (utils/launcherDeviceEvents.fixture.test.js) and the Kotlin follows.
 */
export const nativeEventToTask = (event) => {
  const isAllDay = event.allDay;
  const startStr = event.start; // "YYYY-MM-DDThh:mm:ss" or "YYYY-MM-DD"
  const endStr = event.end;

  // Android formats all-day event timestamps (stored as UTC midnight) as local time
  // strings without a timezone suffix. In UTC- timezones this shifts the date one day
  // back (e.g. UTC midnight March 15 → local "2026-03-14T19:00:00"). Parse via Date
  // so JS treats the string as local time, then read the UTC date from toISOString()
  // to recover the correct calendar date regardless of device timezone.
  const allDayDateStr = (str) => {
    if (!str || str.length === 10) return str; // already "YYYY-MM-DD"
    return new Date(str).toISOString().substring(0, 10);
  };

  const startDate = isAllDay ? allDayDateStr(startStr) : startStr.substring(0, 10);
  // CalendarRepository already subtracts 1 day from Android's exclusive dtend before
  // sending, so the end arrives as the inclusive last day in "YYYY-MM-DD" format.
  const endDate = endStr ? endStr.substring(0, 10) : startDate;
  const isMultiDay = isAllDay && endDate > startDate;
  // For multi-day all-day events use the queried date so each day they span appears
  // correctly. Clamp _queryDate to [startDate, endDate]: Android can return an event
  // one day early/late due to UTC-offset arithmetic, so out-of-range query dates are
  // snapped to the nearest valid boundary instead of displaying the event off by a day.
  let date;
  if (isMultiDay && event._queryDate) {
    const qd = event._queryDate;
    date = qd < startDate ? startDate : qd > endDate ? endDate : qd;
  } else {
    date = startDate;
  }
  const startTime = isAllDay ? null : startStr.substring(11, 16); // "HH:MM"
  let duration = 60;
  if (!isAllDay && endStr && endStr.length >= 16) {
    const endTime = endStr.substring(11, 16);
    duration = Math.max(15, timeToMinutes(endTime) - timeToMinutes(startTime));
  }
  return {
    // The id names one occurrence on one day, never just the event: every
    // platform reports the same event id for each occurrence of a recurring
    // series (EventKit's eventIdentifier, CalendarContract's EVENT_ID), and
    // the merge in App.jsx dedupes by task id. With the event id alone, a
    // fetch spanning several occurrences (MONTH's six-week grid, or a daily
    // event inside the timeline's window) kept only the first and silently
    // dropped the rest. The date suffix also gives a multi-day all-day event
    // a per-day copy on each day it spans. Two occurrences on the same day
    // still collapse; the same event returned for two adjacent query dates
    // (an all-day event in UTC+ zones, a timed one crossing midnight) still
    // dedupes, because both resolve to the same start date.
    id:                   `native-cal-${event.id}-${date}`,
    nativeEventId:        event.id,
    nativeCalendarColor:  event.color || '',
    title:                event.title || '',
    date,
    startTime:            startTime || null,
    duration,
    isAllDay,
    imported:             true,
    isTaskCalendar:       String(event.id).startsWith('task-'),
    notes:                event.notes || '',
    location:             event.location || '',
    calendarName:         event.calendarName || '',
    completed:            false,
    _native:              true,
  };
};

/**
 * A per-day fetch → `_native` tasks: the one conversion both device-calendar
 * consumers use (App.jsx's view fetch and the widget's own fetch,
 * useWidgetNativeEvents), so an event cannot become one task in the app and
 * a different one on the home screen.
 *
 * @param results   Per-day arrays aligned to `dates` (null for a failed day).
 * @param dates     'YYYY-MM-DD' each result was fetched for.
 * @param opts.calendarFilter  Calendar ids to keep; empty keeps every calendar.
 * @param opts.overrides       'day-planner-native-time-overrides' contents:
 *                             user edits (a dragged time, a new title) that
 *                             outlive a re-fetch.
 * @returns {{ events: object[], tasks: object[] }} the tagged raw events (for
 *   calendar discovery) and the tasks, deduplicated by occurrence id — the
 *   provider can return the same all-day event in adjacent day windows.
 */
export function nativeResultsToTasks(results, dates, { calendarFilter = [], overrides = {} } = {}) {
  // Tag each event with the date it was queried for so multi-day all-day
  // events can be shown on every day they span, not just their start date.
  const events = results.flatMap((result, i) =>
    Array.isArray(result) ? result.map(e => ({ ...e, _queryDate: dates[i] })) : []);
  const filterSet = calendarFilter.length > 0 ? new Set(calendarFilter) : null;
  const seen = new Set();
  const tasks = events
    .filter(e => !filterSet || filterSet.has(e.calendarId))
    .map(e => nativeEventToTask(e))
    .filter(t => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    })
    .map(t => {
      const override = t.nativeEventId && overrides[String(t.nativeEventId)];
      if (!override) return t;
      return {
        ...t,
        ...(override.date !== undefined ? { date: override.date } : {}),
        ...(override.startTime !== undefined ? { startTime: override.startTime, isAllDay: false } : {}),
        ...(override.duration !== undefined ? { duration: override.duration } : {}),
        ...(override.title !== undefined ? { title: override.title } : {}),
        ...(override.notes !== undefined ? { notes: override.notes } : {}),
        ...(override.color !== undefined ? { color: override.color } : {}),
      };
    });
  return { events, tasks };
}

/**
 * The local `YYYY-MM-DDTHH:MM:00` a timed block written back to the device
 * calendar ends at. A block that runs past midnight ends on the next date
 * (#2278): `2026-11-04T25:00:00` is not a time the calendar can read, and a
 * write that fails reverts the move.
 */
export function nativeEventEndString(dateStr, startTime, duration) {
  const end = taskEnd({ date: dateStr, startTime, duration });
  const hh = String(Math.floor(end.minutes / 60)).padStart(2, '0');
  const mm = String(end.minutes % 60).padStart(2, '0');
  return `${end.date}T${hh}:${mm}:00`;
}
