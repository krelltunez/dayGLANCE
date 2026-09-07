import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readCalendarProjectionCache, writeCalendarProjectionCache,
  absorbCalendarDays, absorbCalendarWindow, pruneCalendarProjectionCache, calendarProjectionInput,
  CALENDAR_PROJECTION_CACHE_KEY,
} from './calendarProjectionCache.js';
import { buildCalendarProjection } from './obsidianCalendarProjection.js';

// The cache exists because the projection used to be built from a task list
// that, on native-calendar devices, holds only five days of events around
// the viewed date and none before the first fetch. Per-day replacement is
// the contract: a fetch replaces exactly the days it covered.

const native = (id, date, over = {}) => ({ id, title: id, date, startTime: '10:00', duration: 30, imported: true, _native: true, notes: 'private', ...over });
const feed = (id, date, over = {}) => ({ id, title: id, date, startTime: '09:00', duration: 60, imported: true, importSource: 'sync', isTaskCalendar: false, ...over });
const NOW = new Date('2026-09-02T16:00:00Z');

beforeEach(() => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
});
afterEach(() => { delete globalThis.localStorage; });

describe('absorbCalendarDays (native fetch)', () => {
  it('replaces exactly the fetched days, keeps other days, drops notes and non-projected rows', () => {
    let cache = absorbCalendarDays(null, ['2026-09-01', '2026-09-02'], [native('a', '2026-09-01'), native('b', '2026-09-02'), { id: 'task', date: '2026-09-02', title: 'Mine' }], { now: NOW });
    expect(Object.keys(cache.days).sort()).toEqual(['2026-09-01', '2026-09-02']);
    expect(cache.days['2026-09-02'].events.map((e) => e.id)).toEqual(['b']);
    expect(cache.days['2026-09-02'].events[0].notes).toBeUndefined();
    // The user navigates: a new window is fetched, day 01 is untouched, day 02 is replaced (b gone), day 03 added.
    cache = absorbCalendarDays(cache, ['2026-09-02', '2026-09-03'], [native('c', '2026-09-03')], { now: new Date('2026-09-02T17:00:00Z') });
    expect(cache.days['2026-09-01'].events.map((e) => e.id)).toEqual(['a']);
    expect(cache.days['2026-09-02'].events).toEqual([]);
    expect(cache.days['2026-09-02'].at).toBe('2026-09-02T17:00:00.000Z');
    expect(cache.days['2026-09-03'].events.map((e) => e.id)).toEqual(['c']);
  });
});

describe('absorbCalendarWindow (feed sync)', () => {
  it('replaces every day in the window, keeping events of feeds that failed this round', () => {
    let cache = absorbCalendarWindow(null, [feed('p1', '2026-09-01'), feed('x1', '2026-09-02', { feedId: 'ics-x' })], { from: '2026-09-01', to: '2026-09-03', now: NOW });
    expect(Object.keys(cache.days).sort()).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(cache.days['2026-09-03'].events).toEqual([]);
    // Feed ics-x failed: its cached events survive; the primary feed's are replaced.
    cache = absorbCalendarWindow(cache, [feed('p2', '2026-09-01')], { from: '2026-09-01', to: '2026-09-03', keepFeedIds: new Set(['ics-x']), now: NOW });
    expect(cache.days['2026-09-01'].events.map((e) => e.id)).toEqual(['p2']);
    expect(cache.days['2026-09-02'].events.map((e) => e.id)).toEqual(['x1']);
    // No feeds at all: the window clears.
    cache = absorbCalendarWindow(cache, [], { from: '2026-09-01', to: '2026-09-03', now: NOW });
    expect(Object.values(cache.days).every((d) => d.events.length === 0)).toBe(true);
  });
});

describe('prune + input + persistence', () => {
  it('prunes outside the window, exposes per-day stamps, round-trips through localStorage, and feeds the projection builder', () => {
    let cache = absorbCalendarDays(null, ['2026-07-01', '2026-09-02'], [native('old', '2026-07-01'), native('now', '2026-09-02')], { now: NOW });
    cache = pruneCalendarProjectionCache(cache, { from: '2026-07-29', to: '2026-10-07' });
    expect(Object.keys(cache.days)).toEqual(['2026-09-02']);
    writeCalendarProjectionCache(cache);
    expect(JSON.parse(localStorage.getItem(CALENDAR_PROJECTION_CACHE_KEY)).days['2026-09-02'].events).toHaveLength(1);
    const back = readCalendarProjectionCache();
    const input = calendarProjectionInput(back, { from: '2026-07-29', to: '2026-10-07' });
    expect(input.days).toEqual({ '2026-09-02': '2026-09-02T16:00:00.000Z' });
    const payload = buildCalendarProjection(input.tasks, { today: '2026-09-02', deviceId: 'd', now: NOW, days: input.days });
    expect(payload.events.map((e) => e.id)).toEqual(['now']);
    expect(payload.days).toEqual(input.days);
  });
  it('a corrupt or missing store reads as empty', () => {
    expect(readCalendarProjectionCache()).toEqual({ v: 1, days: {} });
    localStorage.setItem(CALENDAR_PROJECTION_CACHE_KEY, '{not json');
    expect(readCalendarProjectionCache()).toEqual({ v: 1, days: {} });
  });
});
