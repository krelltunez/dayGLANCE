// The calendar projection CACHE (companion spec 4.2, calendar events —
// the 2026-09-02 disappearing-events fix).
//
// The projection used to be built from the live task list. On a native-
// calendar device that list holds calendar events for only the five days
// around the date being viewed (App.jsx's EventKit effect replaces every
// calendar event with that window on each navigation), and it holds NONE
// between launch and the first fetch — so the published projection shrank
// to the current window on every navigation and to nothing at startup, and
// the sidebar's events vanished and returned with it.
//
// This cache is DEVICE-LOCAL and CUMULATIVE, keyed by day. Every source that
// produces calendar events feeds it with per-day replacement semantics:
//  • the native fetch replaces exactly the days it fetched;
//  • a feed sync replaces every day of the projection window (a feed is
//    fetched whole), keeping the days' events of feeds that failed.
// The projection publishes the cache, not the task list, so days outside
// the current view keep their last-fetched events, startup publishes the
// last known state, and no extra native or network traffic is needed. Each
// day carries the time it was last fetched so readers can say how old a
// given day's events are.
//
// Never synced: it is derived from sources that are themselves device-local
// (payloadExclusions.js is the reason those events are not in the data
// plane in the first place).

import { PRIMARY_FEED_ID } from './icsFeedSync.js';
import { isProjectedCalendarEvent } from './obsidianCalendarProjection.js';
import { shiftDateStr } from '@glance-apps/agenda-core';

export const CALENDAR_PROJECTION_CACHE_KEY = 'dayglance-calendar-projection-cache';

const empty = () => ({ v: 1, days: {} });

export function readCalendarProjectionCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CALENDAR_PROJECTION_CACHE_KEY) || 'null');
    if (parsed && parsed.v === 1 && parsed.days && typeof parsed.days === 'object') return parsed;
  } catch { /* fresh */ }
  return empty();
}

export function writeCalendarProjectionCache(cache) {
  try { localStorage.setItem(CALENDAR_PROJECTION_CACHE_KEY, JSON.stringify(cache)); }
  catch { /* storage unavailable: the next absorb retries */ }
}

// Only the fields the projection (and the feed bookkeeping) need. Notes
// and the like stay out of device storage.
const slim = (t) => ({
  id: t.id, title: t.title, date: t.date, startTime: t.startTime ?? null, duration: t.duration ?? null,
  isAllDay: !!t.isAllDay, completed: !!t.completed,
  ...(t.color ? { color: t.color } : {}),
  ...(t.nativeCalendarColor ? { nativeCalendarColor: t.nativeCalendarColor } : {}),
  ...(t.calendarName ? { calendarName: t.calendarName } : {}),
  ...(t.location ? { location: t.location } : {}),
  ...(t.feedId ? { feedId: t.feedId } : {}),
  imported: !!t.imported, ...(t._native ? { _native: true } : {}),
  ...(t.isTaskCalendar ? { isTaskCalendar: true } : {}),
  ...(t.importSource ? { importSource: t.importSource } : {}),
});

const projected = (events, multiUserEnabled) =>
  (events || []).filter((t) => isProjectedCalendarEvent(t, { multiUserEnabled })).map(slim);

/**
 * Per-day replacement for a native fetch: `dates` were fetched in full, so
 * each of them becomes exactly the events in `events` on that date.
 */
export function absorbCalendarDays(cache, dates, events, { now = new Date(), multiUserEnabled = false } = {}) {
  const at = now.toISOString();
  const keep = projected(events, multiUserEnabled);
  const days = { ...(cache?.days || {}) };
  for (const date of dates || []) {
    days[date] = { at, events: keep.filter((e) => e.date === date) };
  }
  return { v: 1, days };
}

/**
 * Whole-window replacement for a feed sync: every day in [from, to] becomes
 * the fresh events on that day, plus the cached events of feeds that failed
 * this round (`keepFeedIds`), which the app also keeps in its own list.
 */
export function absorbCalendarWindow(cache, events, { from, to, keepFeedIds = null, now = new Date(), multiUserEnabled = false } = {}) {
  const at = now.toISOString();
  const fresh = projected(events, multiUserEnabled);
  const days = { ...(cache?.days || {}) };
  for (let d = from; d <= to; d = shiftDateStr(d, 1)) {
    const kept = keepFeedIds
      ? (days[d]?.events || []).filter((e) => keepFeedIds.has(e.feedId ?? PRIMARY_FEED_ID))
      : [];
    days[d] = { at, events: [...kept, ...fresh.filter((e) => e.date === d)] };
  }
  return { v: 1, days };
}

/** Drop days outside [from, to] (the window slides daily). */
export function pruneCalendarProjectionCache(cache, { from, to }) {
  const days = {};
  for (const [d, entry] of Object.entries(cache?.days || {})) {
    if (d >= from && d <= to) days[d] = entry;
  }
  return { v: 1, days };
}

/** What the projection builder consumes: the cached events plus per-day fetch stamps. */
export function calendarProjectionInput(cache, { from, to }) {
  const tasks = [];
  const days = {};
  for (const [d, entry] of Object.entries(cache?.days || {})) {
    if (d < from || d > to) continue;
    days[d] = entry.at;
    for (const e of entry.events || []) tasks.push(e);
  }
  return { tasks, days };
}
