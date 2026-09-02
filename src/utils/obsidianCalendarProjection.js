// The calendar projection (companion spec 4.2, calendar events). Pure.
//
// The sync payload structurally EXCLUDES read-only calendar events
// (payloadExclusions.js: subscription feeds are re-fetched per device, native
// device-calendar rows never leave the phone), so the plugin's agenda mirror
// cannot see them. Rather than make the plugin a calendar client (feed URLs
// and credentials leaving the app, a second import pipeline), each running
// dayGLANCE publishes a PROJECTION: the events it currently holds for the
// sidebar's window, as one upserted bridge-stream row per device. Derived
// data, authored by the app, read by the plugin — the single-writer boundary
// for the data plane is untouched because this is not the data plane.
//
// Exactly the excluded classes are projected — nothing the plugin can
// already read from the mirror is duplicated here.

import { keepImportedTask } from '../sync/payloadExclusions.js';
import { shiftDateStr } from '@glance-apps/agenda-core';

export const CALENDAR_PROJECTION_WINDOW_DAYS = 35;

/** True for a task the payload excludes and the projection therefore carries. */
export const isProjectedCalendarEvent = (t, { multiUserEnabled = false } = {}) =>
  !!t && typeof t === 'object' && !!t.date && (!!t._native || (!!t.imported && !keepImportedTask(t, multiUserEnabled)));

/**
 * Build the projection payload for [today-35, today+35].
 * @param {object[]} tasks  the app's scheduled list (imported + native rows ride in it)
 * @param {{ today: string, deviceId: string, now?: Date, multiUserEnabled?: boolean, days?: Record<string,string> }} opts
 *   `days`: per-day fetch stamps (date → ISO) from the projection cache, so a
 *   reader can say how old a given day's events are and resolve two devices'
 *   copies of a day by freshness.
 */
export function buildCalendarProjection(tasks, { today, deviceId, now = new Date(), multiUserEnabled = false, days = null }) {
  const from = shiftDateStr(today, -CALENDAR_PROJECTION_WINDOW_DAYS);
  const to = shiftDateStr(today, CALENDAR_PROJECTION_WINDOW_DAYS);
  const events = [];
  for (const t of tasks || []) {
    if (!isProjectedCalendarEvent(t, { multiUserEnabled })) continue;
    if (t.date < from || t.date > to) continue;
    events.push({
      id: String(t.id),
      title: String(t.title ?? ''),
      date: t.date,
      startTime: t.isAllDay ? null : (t.startTime || null),
      duration: t.duration ?? null,
      isAllDay: !!t.isAllDay,
      color: t.color || t.nativeCalendarColor || null,
      completed: !!t.completed,
      ...(t.calendarName ? { calendarName: t.calendarName } : {}),
      ...(t.location ? { location: t.location } : {}),
    });
  }
  events.sort((a, b) => (a.date === b.date ? String(a.id).localeCompare(String(b.id)) : (a.date < b.date ? -1 : 1)));
  const payload = { v: 1, kind: 'projection', type: 'calendar', deviceId, from, to, publishedAt: now.toISOString(), events };
  if (days) {
    payload.days = {};
    for (const [d, at] of Object.entries(days)) if (d >= from && d <= to) payload.days[d] = at;
  }
  return payload;
}

/** Content identity for the publish guard: everything but the publish stamp. */
export function calendarProjectionHash(payload) {
  // The per-day stamps are excluded too: a re-fetch that changed nothing
  // must not republish, or every navigation would cost a request.
  const { publishedAt: _omit, days: _days, ...rest } = payload;
  return JSON.stringify(rest);
}
