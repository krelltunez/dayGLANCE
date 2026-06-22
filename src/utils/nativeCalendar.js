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

/** Fetches the device calendar list from the Electron helper. */
export const electronGetCalendars = async () => {
  if (!window.electronAPI?.getCalendars) return [];
  try {
    return (await window.electronAPI.getCalendars()) ?? [];
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
 * Maps a native calendar event (mobile bridge or Electron helper — identical
 * shape) to a `_native`-flagged task. `_native` tasks are excluded from saveData
 * so they're never persisted or synced.
 *
 * @param event  Native event JSON, optionally tagged with `_queryDate` (the day
 *               it was fetched for) so multi-day all-day events land on the
 *               correct day.
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
    // Multi-day all-day events get a per-day ID so each day's copy survives dedup
    id:                   isMultiDay ? `native-cal-${event.id}-${date}` : `native-cal-${event.id}`,
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
