import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The calendar filter (#2307) is view-only: in App.jsx it may reach the views
// and nothing else. useDayReads.test.js holds the scheduling side; this holds
// App's wiring of the view side, since App cannot be rendered in a test.

const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
const between = (from, to) => {
  const start = app.indexOf(from);
  expect(start, `${from} not found`).toBeGreaterThan(-1);
  return app.slice(start, app.indexOf(to, start));
};

describe('App hands the calendar filter to the views', () => {
  it('reads the past-day display through it, Do included', () => {
    const display = between('const getDayDisplayForDate = useCallback(', '}), [');
    expect(display).toContain('dayTasks: getCalendarTasksForDate(date, applyTagFilter)');
    expect(display).toContain('tagFilter: applyTagFilter ? filterForCalendar : null');
  });

  it('carries the previous night through it, as shown and as planned', () => {
    const continuations = between('const getContinuationsForDate = useCallback(', '}), [');
    expect(continuations).toContain('readShown: getDayDisplayForDate');
    expect(continuations).toContain('readPlanned: getCalendarTasksForDate');
  });
});

describe('App reads the calendar filter nowhere else', () => {
  // Every line of App.jsx that names it. A new one is a new reader: if it is a
  // view, add it here; if it schedules, counts free time or snapshots the day,
  // it must read getTasksForDate instead.
  const ALLOWED = [
    /^\s*filterForCalendar,$/, // useComputedViews' result
    /^\s*\/\/ /, // comments
    /getTasksForDate, getCalendarTasksForDate, calendarHiddenCount,$/, // useDayReads' result
    /useDayReads\(\{ tasksByDate, filterByTags, filterForCalendar, routineOccupancy, calendarFilterDateStrs \}\)/,
    /dayTasks: getCalendarTasksForDate\(date, applyTagFilter\),$/,
    /tagFilter: applyTagFilter \? filterForCalendar : null,$/,
    /\}\), \[getCalendarTasksForDate, pastDayIndex, isVisibleForUser, filterForCalendar, nowTodayStr, todayEnded\]\);$/,
    /readShown: getDayDisplayForDate, readPlanned: getCalendarTasksForDate, applyTagFilter, asPlanned,$/,
    /\}\), \[getCalendarTasksForDate, getDayDisplayForDate\]\);$/,
    // The context, for the views.
    /^\s*filterByTags, filterForCalendar,$/,
    /^\s*getTasksForDate, getCalendarTasksForDate, getDayDisplayForDate, getDoSessionsForTask,/,
  ];

  it('names it only at the known view-side sites', () => {
    const lines = app.split('\n').filter((line) => /getCalendarTasksForDate|filterForCalendar/.test(line));
    const unknown = lines.filter((line) => !ALLOWED.some((re) => re.test(line)));
    expect(unknown).toEqual([]);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('leaves frames\' free time and the snapshots on getTasksForDate', () => {
    expect(app).toContain('= useDayReads({');
    expect(app).not.toMatch(/computeAvailableSlotsPure\(/);
  });
});
