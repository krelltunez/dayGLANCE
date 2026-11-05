import { describe, it, expect } from 'vitest';
import {
  nativeEventToTask, nativeResultsToTasks, CALENDAR_FILTER_NONE, isCalendarFilterNone,
  isCalendarShown, toggleCalendarInFilter, extendCalendarFilter, nativeEventEndString,
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
