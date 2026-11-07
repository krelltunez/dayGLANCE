import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The calendar filter (#2307), the tag filter and the hidden projects alike, is
// DISPLAY-ONLY: it may reach the views and nothing else. useDayReads.test.js
// holds the scheduling side; this holds the wiring, since App cannot be
// rendered in a test, and the modules outside App that schedule, measure free
// time, nudge, run focus, draw the dial or snapshot the day.

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../App.jsx');
const between = (from, to) => {
  const start = app.indexOf(from);
  expect(start, `${from} not found`).toBeGreaterThan(-1);
  return app.slice(start, app.indexOf(to, start));
};

// Every name that reads the day through a calendar filter, or builds one: the
// filters themselves, the calendar's reads, today's tag-filtered list and the
// tag selection the filter is made from.
const FILTERED = /\b(getCalendarTasksForDate|filterForCalendar|filterByTags|getDayDisplayForDate|getContinuationsForDate|filteredTodayTasks|selectedTags|passesTagFilter|makeCalendarFilter)\b/;
const isComment = (line) => /^\s*(\/\/|\/?\*)/.test(line);

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
  // Every line of App.jsx that names a filtered read. A new one is a new
  // reader: if it is a view, add it here; if it schedules, measures free time
  // or occupancy, nudges, runs focus, draws the dial or snapshots the day, it
  // must read getTasksForDate (the day as it holds) instead.
  const ALLOWED = [
    // The tag filter's state, its backup and restore.
    /^\s*selectedTags, setSelectedTags, showUntagged, setShowUntagged,/,
    /^\s*selectedTags: JSON\.parse\(localStorage\.getItem\('day-planner-selected-tags'\) \|\| '\[\]'\),$/,
    /^\s*if \(data\.selectedTags\) localStorage\.setItem\('day-planner-selected-tags', JSON\.stringify\(data\.selectedTags\)\);$/,
    // useComputedViews' input and result.
    /^\s*selectedTags,$/,
    /^\s*filterByTags,$/,
    /^\s*filterForCalendar,$/,
    /^\s*filteredTodayTasks,$/,
    // useDayReads, which takes the calendar filter for the calendar read only.
    /^\s*getTasksForDate, getCalendarTasksForDate, calendarHiddenCount,$/,
    /^\s*\} = useDayReads\(\{ tasksByDate, filterForCalendar, routineOccupancy, calendarFilterDateStrs \}\);$/,
    // The past-day display and the continuations, for the views.
    /^\s*const getDayDisplayForDate = useCallback\(\(date, applyTagFilter = true\) => pastDayDisplay\(\{$/,
    /^\s*dayTasks: getCalendarTasksForDate\(date, applyTagFilter\),$/,
    /^\s*tagFilter: applyTagFilter \? filterForCalendar : null,$/,
    /^\s*\}\), \[getCalendarTasksForDate, pastDayIndex, isVisibleForUser, filterForCalendar, nowTodayStr, todayEnded\]\);$/,
    /^\s*const getContinuationsForDate = useCallback\(\(date, applyTagFilter = true, \{ asPlanned = false \} = \{\}\) => continuationsForDate\(date, \{$/,
    /^\s*readShown: getDayDisplayForDate, readPlanned: getCalendarTasksForDate, applyTagFilter, asPlanned,$/,
    /^\s*\}\), \[getCalendarTasksForDate, getDayDisplayForDate\]\);$/,
    // The contexts, for the views and the tag filter's own UI.
    /^\s*selectedTags, setSelectedTags,$/,
    /^\s*filteredUnscheduledTasks, filteredTodayTasks,$/,
    /^\s*filterByTags, filterForCalendar,$/,
    /^\s*getTasksForDate, getCalendarTasksForDate, getDayDisplayForDate, getDoSessionsForTask, getDateIndicators, hasTasksOnDate,$/,
    /^\s*getContinuationsForDate,$/,
  ];

  it('names a filtered read only at the known view-side sites', () => {
    const lines = app.split('\n').filter((line) => FILTERED.test(line) && !isComment(line));
    const unknown = lines.filter((line) => !ALLOWED.some((re) => re.test(line)));
    expect(unknown).toEqual([]);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('gives useDayReads no tag filter of its own, so the held day cannot reach one', () => {
    const call = between('= useDayReads({', '});');
    expect(call).not.toMatch(/filterByTags|selectedTags/);
    expect(app).not.toMatch(/computeAvailableSlotsPure\(/);
  });

  it('reads the held day where it nudges, runs focus and settles focus Do', () => {
    expect(between('const generateFrameNudge = useCallback(', '}, [')).toContain('todayTasks: getTasksForDate(today),');
    expect(between('const focusModeAvailable = useMemo(', '}, [')).toContain('focusModeAvailableAt(getTasksForDate(now),');
    expect(between('const computeFocusBlockTasks = () => {', '\n  };')).toContain('focusBlockAt(getTasksForDate(now),');
    expect(between('const focusDo = useFocusDo({', 'complete:')).toContain("return getTasksForDate(new Date(original.date + 'T12:00:00'))");
    expect(app).toContain('getTasksForDate: (...args) => getTasksForDate(...args),');
  });
});

describe('the modules that schedule, measure, nudge, focus or snapshot read no filtered day', () => {
  // They take the held day (getTasksForDate, getPrevDayTasks) or the free
  // time built on it (computeAvailableSlots, dialFramesForDate) from App, or
  // are pure over what App hands them. None may name a calendar filter.
  const MODULES = [
    '../hooks/useTaskActions.js', // scheduling an Inbox task into a frame
    '../components/FrameScheduleModal.jsx', // the frame's free slots
    '../utils/frameNudge.js',
    '../hooks/useFocusOrchestration.js', // the named task on entering focus
    '../hooks/useFocusDo.js',
    '../jobo/focusSession.js', // resolveBlock, for a recurring occurrence
    '../utils/focusBlock.js',
    '../components/DayDialModal.jsx', // the in-app dial's ring and totals
    '../utils/dayDial.js',
    '../utils/dayOccupancy.js',
    '../utils/widgetSnapshot.js',
    '../utils/widgetDayProjection.js',
    '../utils/launcherSnapshot.js',
    '../components/SummaryStrip.jsx',
    '../components/TitlebarSummaryStrip.jsx',
    '../hooks/useTodayEnded.js',
  ];

  it.each(MODULES)('%s', (path) => {
    const named = read(path).split('\n').filter((line) => FILTERED.test(line) && !isComment(line));
    expect(named).toEqual([]);
  });
});
