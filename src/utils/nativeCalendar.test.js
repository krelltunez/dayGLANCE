import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { continuationsFromPreviousDay } from '@glance-apps/agenda-core';
import {
  nativeEventToTask, nativeResultsToTasks, CALENDAR_FILTER_NONE, isCalendarFilterNone,
  isCalendarShown, toggleCalendarInFilter, extendCalendarFilter, nativeEventEndString,
  nativeEventDuration,
} from './nativeCalendar.js';

// The Electron EventKit helper emits the exact same JSON shape as the mobile
// DayGlanceNative bridge, so these fixtures double as the Electron contract.
const ev = (extra = {}) => ({
  id: 'ABC-123',
  title: 'Standup',
  start: '2026-06-22T09:00:00',
  end: '2026-06-22T09:30:00',
  allDay: false,
  notes: '',
  location: '',
  calendarId: 'cal-work',
  calendarName: 'Work',
  color: '#3b82f6',
  ...extra,
});

describe('nativeEventToTask', () => {
  it('maps a timed event with derived duration and _native flag', () => {
    const task = nativeEventToTask(ev());
    expect(task).toMatchObject({
      id: 'native-cal-ABC-123-2026-06-22',
      nativeEventId: 'ABC-123',
      title: 'Standup',
      date: '2026-06-22',
      startTime: '09:00',
      duration: 30,
      isAllDay: false,
      imported: true,
      isTaskCalendar: false,
      completed: false,
      _native: true,
      nativeCalendarColor: '#3b82f6',
      calendarName: 'Work',
    });
  });

  it('clamps a too-short duration to a 15-minute minimum', () => {
    const task = nativeEventToTask(ev({ start: '2026-06-22T09:00:00', end: '2026-06-22T09:05:00' }));
    expect(task.duration).toBe(15);
  });

  it('falls back to a 60-minute duration when no end time is present', () => {
    const task = nativeEventToTask(ev({ end: '' }));
    expect(task.duration).toBe(60);
  });

  it('maps a single-day all-day event with no startTime', () => {
    const task = nativeEventToTask({
      ...ev(),
      allDay: true,
      start: '2026-06-22',
      end: '2026-06-22',
    });
    expect(task).toMatchObject({
      id: 'native-cal-ABC-123-2026-06-22',
      date: '2026-06-22',
      startTime: null,
      isAllDay: true,
    });
  });

  it('gives multi-day all-day events a per-day id and uses the queried date', () => {
    const base = {
      ...ev(),
      id: 'TRIP',
      allDay: true,
      start: '2026-06-20',
      end: '2026-06-23',
    };
    const day1 = nativeEventToTask({ ...base, _queryDate: '2026-06-21' });
    const day2 = nativeEventToTask({ ...base, _queryDate: '2026-06-22' });
    expect(day1.id).toBe('native-cal-TRIP-2026-06-21');
    expect(day1.date).toBe('2026-06-21');
    expect(day2.id).toBe('native-cal-TRIP-2026-06-22');
    expect(day2.date).toBe('2026-06-22');
    // Distinct ids so each spanned day survives id-based dedup
    expect(day1.id).not.toBe(day2.id);
  });

  it('clamps an out-of-range queried date to the event span', () => {
    const base = { ...ev(), id: 'TRIP', allDay: true, start: '2026-06-20', end: '2026-06-22' };
    const before = nativeEventToTask({ ...base, _queryDate: '2026-06-18' });
    const after = nativeEventToTask({ ...base, _queryDate: '2026-06-25' });
    expect(before.date).toBe('2026-06-20');
    expect(after.date).toBe('2026-06-22');
  });

  it('flags task-list calendars via the task- id prefix', () => {
    const task = nativeEventToTask(ev({ id: 'task-42' }));
    expect(task.isTaskCalendar).toBe(true);
    expect(task.id).toBe('native-cal-task-42-2026-06-22');
  });

  // Every platform reports one event id for all occurrences of a recurring
  // series, and the merge in App.jsx dedupes by task id. A fetch spanning
  // several occurrences (MONTH's grid) must keep each of them.
  it('gives each occurrence of a recurring event its own id', () => {
    const weekly = (day) => ev({ id: 'MEETING', start: `2026-06-${day}T14:00:00`, end: `2026-06-${day}T15:00:00` });
    const ids = ['01', '08', '15', '22', '29'].map((d) => nativeEventToTask(weekly(d)).id);
    expect(new Set(ids).size).toBe(5);
    expect(ids[0]).toBe('native-cal-MEETING-2026-06-01');
  });

  it('keeps one id for the same occurrence returned by adjacent day queries', () => {
    // A single-day all-day event that CalendarContract also returns for the
    // neighbouring query date, and a timed event crossing midnight: both
    // are one occurrence and must still collapse in the id-based dedup.
    const allDay = { ...ev(), allDay: true, start: '2026-06-22', end: '2026-06-22' };
    expect(nativeEventToTask({ ...allDay, _queryDate: '2026-06-22' }).id)
      .toBe(nativeEventToTask({ ...allDay, _queryDate: '2026-06-23' }).id);
    const overnight = ev({ start: '2026-06-22T23:00:00', end: '2026-06-23T01:00:00' });
    expect(nativeEventToTask({ ...overnight, _queryDate: '2026-06-22' }).id)
      .toBe(nativeEventToTask({ ...overnight, _queryDate: '2026-06-23' }).id);
  });
});

// #2278: a timed event that runs past midnight is as long as it really is,
// so it carries onto the next date like any task. The duration used to come
// from the clock times alone, and a 23:00-01:00 event became 15 minutes.
describe('a device event that crosses midnight (#2278)', () => {
  const overnight = ev({ id: 'LATE', start: '2026-06-22T23:00:00', end: '2026-06-23T01:00:00' });

  it('is as long as its full start to its full end, and carries the rest onto the next date', () => {
    const dates = ['2026-06-22', '2026-06-23'];
    // The provider returns it for both days it touches; it is one row.
    const { tasks } = nativeResultsToTasks([[overnight], [overnight]], dates);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ date: '2026-06-22', startTime: '23:00', duration: 120 });
    const pieces = continuationsFromPreviousDay(tasks.filter((t) => t.date === '2026-06-22'));
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({ fromDate: '2026-06-22', startMinutes: 0, endMinutes: 60 });
    expect(pieces[0].task).toBe(tasks[0]);
  });

  it('is capped at a whole day, and a same-day event keeps its old duration', () => {
    expect(nativeEventDuration('2026-06-22T09:00:00', '2026-06-24T09:00:00')).toBe(24 * 60);
    expect(nativeEventDuration('2026-06-22T09:00:00', '2026-06-23T09:00:00')).toBe(24 * 60);
    expect(nativeEventDuration('2026-06-22T22:00:00', '2026-06-23T06:30:00')).toBe(510);
    expect(nativeEventDuration('2026-06-22T09:00:00', '2026-06-22T10:30:00')).toBe(90);
    expect(nativeEventDuration('2026-06-22T09:00:00', '2026-06-22T09:05:00')).toBe(15);
    // An end before the start is a broken event, not a negative block.
    expect(nativeEventDuration('2026-06-22T09:00:00', '2026-06-21T09:00:00')).toBe(15);
    expect(nativeEventDuration('2026-06-22T09:00:00', '')).toBe(60);
    // Across a month and a year end.
    expect(nativeEventDuration('2026-12-31T23:30:00', '2027-01-01T00:45:00')).toBe(75);
  });

  it('a user edit keeps its own duration, and an edit that moves the time keeps the real one', () => {
    const dates = ['2026-06-22'];
    const moved = nativeResultsToTasks([[overnight]], dates, { overrides: { LATE: { startTime: '22:00' } } }).tasks[0];
    expect(moved).toMatchObject({ startTime: '22:00', duration: 120 });
    const resized = nativeResultsToTasks([[overnight]], dates, { overrides: { LATE: { duration: 180 } } }).tasks[0];
    expect(resized).toMatchObject({ startTime: '23:00', duration: 180 });
    expect(continuationsFromPreviousDay([resized])[0].minutes).toBe(120);
  });

  // The strings are the device's local wall times. Elapsed time across a DST
  // change differs from the wall-clock span: in America/Santiago the clocks
  // change at midnight, so 23:00-01:00 is 3 hours on the April night and 1
  // hour on the September one. The block is drawn by its wall times, so it is
  // 120 minutes on both. A child process gives the case a real host zone.
  it('is the wall-clock span across a DST change at midnight', () => {
    const script = `
      import { nativeEventDuration } from ${JSON.stringify(new URL('./nativeCalendar.js', import.meta.url).href)};
      if (new Date('2026-04-05T01:00:00') - new Date('2026-04-04T23:00:00') !== 180 * 60000) throw new Error('not a DST night here');
      process.stdout.write(JSON.stringify([
        nativeEventDuration('2026-04-04T23:00:00', '2026-04-05T01:00:00'),
        nativeEventDuration('2026-09-05T23:00:00', '2026-09-06T01:00:00'),
      ]));
    `;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: 'America/Santiago' }, encoding: 'utf8', timeout: 10000,
    });
    expect(JSON.parse(out)).toEqual([120, 120]);
  });
});

// #2120: unchecking every device calendar used to collapse the filter to [],
// which means "show all", so every box sprang back on and nothing was hidden.
describe('device calendar filter', () => {
  const ALL = ['cal-work', 'cal-home', 'cal-holidays'];
  const NONE = [CALENDAR_FILTER_NONE];

  // Uncheck/check through the same function the settings checkboxes call.
  const toggleAll = (filter, ids) => ids.reduce((f, id) => toggleCalendarInFilter(f, id, ALL), filter);

  it('unchecking every calendar hides them all instead of showing them all', () => {
    const filter = toggleAll([], ALL);
    expect(filter).toEqual(NONE);
    expect(isCalendarFilterNone(filter)).toBe(true);
    for (const id of ALL) expect(isCalendarShown(filter, id)).toBe(false);
  });

  it('a lone calendar can be unchecked', () => {
    expect(toggleCalendarInFilter([], 'cal-work', ['cal-work'])).toEqual(NONE);
  });

  it('checking one calendar from none shows only that calendar', () => {
    const filter = toggleCalendarInFilter(NONE, 'cal-home', ALL);
    expect(filter).toEqual(['cal-home']);
    expect(ALL.filter(id => isCalendarShown(filter, id))).toEqual(['cal-home']);
  });

  it('checking every calendar again collapses to show-all', () => {
    expect(toggleAll(NONE, ALL)).toEqual([]);
    expect(toggleCalendarInFilter(['cal-work', 'cal-home'], 'cal-holidays', ALL)).toEqual([]);
  });

  it('partial selections behave as before', () => {
    expect(toggleCalendarInFilter([], 'cal-work', ALL)).toEqual(['cal-home', 'cal-holidays']);
    expect(toggleCalendarInFilter(['cal-home', 'cal-holidays'], 'cal-home', ALL)).toEqual(['cal-holidays']);
  });

  it('newly discovered calendars stay hidden when every calendar is hidden', () => {
    expect(extendCalendarFilter(NONE, ['cal-new'])).toBe(NONE);
    expect(extendCalendarFilter([], ['cal-new'])).toEqual([]);
    expect(extendCalendarFilter(['cal-work'], ['cal-new', 'cal-work'])).toEqual(['cal-work', 'cal-new']);
  });

  it('the hide-all filter produces no tasks where events become tasks', () => {
    const results = [[ev(), ev({ id: 'XYZ', calendarId: 'cal-home' })]];
    const dates = ['2026-06-22'];
    expect(nativeResultsToTasks(results, dates, { calendarFilter: NONE }).tasks).toEqual([]);
    expect(nativeResultsToTasks(results, dates, { calendarFilter: [] }).tasks).toHaveLength(2);
    expect(nativeResultsToTasks(results, dates, { calendarFilter: ['cal-home'] }).tasks.map(t => t.nativeEventId)).toEqual(['XYZ']);
  });
});

describe('nativeEventEndString (#2278)', () => {
  it('ends on the same date, or on the next one past midnight', () => {
    expect(nativeEventEndString('2026-06-22', '09:00', 90)).toBe('2026-06-22T10:30:00');
    expect(nativeEventEndString('2026-06-22', '23:00', 60)).toBe('2026-06-23T00:00:00');
    expect(nativeEventEndString('2026-06-22', '23:00', 120)).toBe('2026-06-23T01:00:00');
    expect(nativeEventEndString('2026-12-31', '23:30', 60)).toBe('2027-01-01T00:30:00');
  });
});
