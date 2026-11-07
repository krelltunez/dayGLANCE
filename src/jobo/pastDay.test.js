import { describe, it, expect } from 'vitest';
import { createDoRecord, tombstoneDoRecord } from './core.js';
import { buildPastDayIndex, buildPastDaySlices, pastDayItems, pastDayDisplay } from './pastDay.js';
import { liveHiddenProjectIds, makeCalendarFilter } from '../utils/calendarFilter.js';

// Slice 6 (docs/jobo-past-days.md): what a date before today shows. Only the
// rule is under test here; the views adopt it in a later step.

const DAY = '2026-09-24';
const stamp = `${DAY}T18:00:00.000Z`;
const plan = { date: DAY, startTime: '09:00', duration: 60 };
const report = { id: 't1', title: 'Write the report #work', date: DAY, startTime: '09:00', duration: 60, color: 'bg-blue-500', completed: true, projectId: 'p1' };
const call = { id: 't2', title: 'Call the bank', date: DAY, startTime: '14:00', duration: 15, color: 'bg-rose-500', completed: false };
const timed = (over = {}) => createDoRecord({
  id: 'manual:1', taskId: 't1', title: 'Write the report #work', source: 'manual', progress: 'partial',
  timing: 'timed', date: DAY, startTime: '09:30', endDate: DAY, endTime: '10:15', planSnapshot: plan,
  createdAt: stamp, updatedAt: stamp, observedAt: stamp, ...over,
});
const untimed = (over = {}) => createDoRecord({
  id: `do:t1:${DAY}T10:40:00-05:00`, taskId: 't1', title: 'Write the report #work', source: 'completion', progress: 'completed',
  timing: 'untimed', date: DAY, startTime: null, endDate: null, endTime: null, planSnapshot: plan,
  createdAt: `${DAY}T10:40:00-05:00`, updatedAt: `${DAY}T10:40:00-05:00`, observedAt: `${DAY}T10:40:00-05:00`, ...over,
});
const show = (records, { dayTasks = [report, call], taskLookup = [report, call], date = DAY, isVisibleForUser, recurringTasks } = {}) =>
  pastDayItems({ dateStr: date, dayTasks, index: buildPastDayIndex({ records, taskLookup, recurringTasks }), isVisibleForUser });
const ids = (items) => items.map((item) => item.id);

describe('a past day shows Do per task', () => {
  // MUTATION: drop the covered filter and the plan block and its Do both draw.
  it('replaces a task\'s plan block with its timed Do, at the recorded interval, in the task\'s colour', () => {
    const items = show([timed()]);
    expect(ids(items)).toEqual(['t2', `jobo-do:manual:1:${DAY}`]);
    expect(items[1]).toMatchObject({
      title: report.title, color: 'bg-blue-500', date: DAY, startTime: '09:30', duration: 45,
      isAllDay: false, completed: false, projectId: 'p1',
      joboDo: true, joboRecordId: 'manual:1', joboTaskId: 't1', joboProgress: 'partial',
    });
  });

  it('leaves a task without timed Do as it stood', () => {
    expect(show([timed()]).find((item) => item.id === 't2')).toBe(call);
  });

  // An untimed completion changes nothing: the task's own checked state
  // already says it was done, and JOBO's estimate for it is never stored.
  it('keeps the plan block for a task completed without times', () => {
    const dayTasks = [report, call];
    expect(show([untimed()], { dayTasks })).toBe(dayTasks);
  });

  it('draws two sessions as two items, in time order', () => {
    const items = show([timed({ id: 'manual:2', startTime: '15:00', endTime: '15:30' }), timed()]);
    expect(items.filter((item) => item.joboDo).map((item) => item.startTime)).toEqual(['09:30', '15:00']);
    expect(ids(items)).not.toContain('t1');
  });

  it('shows unlinked work, and Do whose task is gone, under the recorded title with no task colour', () => {
    const unlinked = timed({ id: 'manual:u', taskId: null, title: 'Unplanned call', planSnapshot: null });
    const orphan = timed({ id: 'manual:o', taskId: 'deleted', title: 'An old task' });
    const items = show([unlinked, orphan]);
    expect(items.filter((item) => item.joboDo).map((item) => [item.title, item.color, item.joboTaskId]))
      .toEqual([['An old task', null, null], ['Unplanned call', null, null]]); // same start: by id
    expect(ids(items)).toEqual(expect.arrayContaining(['t1', 't2']));
  });

  it('splits a Do across midnight onto both days, marking the cut ends', () => {
    const late = timed({ date: '2026-09-23', startTime: '23:30', endDate: DAY, endTime: '00:45' });
    const before = show([late], { date: '2026-09-23', dayTasks: [] });
    const after = show([late], { date: DAY, dayTasks: [] });
    expect(before[0]).toMatchObject({ startTime: '23:30', duration: 30, joboClippedStart: false, joboClippedEnd: true });
    expect(after[0]).toMatchObject({ startTime: '00:00', duration: 45, joboClippedStart: true, joboClippedEnd: false });
  });
});

describe('only measured, visible, live facts', () => {
  // MUTATION: drop the visibility check and a partner's work appears.
  it('never shows another household member\'s Do, and keeps their hidden plan out of it', () => {
    const partner = { ...call, id: 't3', assignedUserSyncIds: ['partner'] };
    const mine = (task) => !(task.assignedUserSyncIds ?? []).length || task.assignedUserSyncIds.includes('me');
    const items = show([timed({ id: 'manual:p', taskId: 't3' })], { taskLookup: [report, call, partner], isVisibleForUser: mine });
    expect(items.some((item) => item.joboDo)).toBe(false);
  });

  // MUTATION: index planDuration records and a guess leaves JOBO as a fact.
  it('leaves out intervals inferred from a plan duration', () => {
    const dayTasks = [report, call];
    expect(show([timed({ timingBasis: 'planDuration' })], { dayTasks })).toBe(dayTasks);
  });

  it('leaves out deleted records, and uses a correction over the original', () => {
    const original = timed();
    const gone = tombstoneDoRecord(original, `${DAY}T19:00:00.000Z`);
    expect(show([original, gone]).some((item) => item.joboDo)).toBe(false);
    const corrected = createDoRecord({ ...original, startTime: '09:45', updatedAt: `${DAY}T19:00:00.000Z` });
    expect(show([original, corrected]).find((item) => item.joboDo).startTime).toBe('09:45');
  });

  // A malformed or runaway interval must not stall a MONTH render by
  // indexing every day it spans.
  it('indexes an interval of more than two weeks on its first and last days only', () => {
    const { slicesByDate } = buildPastDaySlices([timed({ date: '2026-08-01', startTime: '09:00', endDate: '2026-09-15', endTime: '10:00' })]);
    expect([...slicesByDate.keys()]).toEqual(['2026-08-01', '2026-09-15']);
    const { slicesByDate: week } = buildPastDaySlices([timed({ date: '2026-09-01', startTime: '22:00', endDate: '2026-09-03', endTime: '01:00' })]);
    expect([...week.keys()]).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
  });

  it('returns the day unchanged, the same array, when nothing was recorded on it', () => {
    const dayTasks = [report, call];
    expect(show([timed()], { date: '2026-09-25', dayTasks })).toBe(dayTasks);
    expect(pastDayItems({ dateStr: DAY, dayTasks })).toBe(dayTasks);
  });
});

describe('recurring occurrences', () => {
  it('replaces the occurrence the Do belongs to, not the whole series', () => {
    const template = { id: 'tmpl', title: 'Standup', startTime: '09:00', duration: 15, recurrence: { type: 'daily' }, completedDates: [DAY] };
    const occurrence = { id: `recurring-tmpl-${DAY}`, recurringTemplateId: 'tmpl', title: 'Standup', date: DAY, startTime: '09:00', duration: 15, color: 'bg-emerald-500', completed: true };
    const other = { ...occurrence, id: 'recurring-tmpl-2026-09-25', date: '2026-09-25' };
    const record = timed({ id: 'manual:s', taskId: 'tmpl', title: 'Standup', startTime: '09:05', endTime: '09:25', planSnapshot: { date: DAY, startTime: '09:00', duration: 15 } });
    const items = show([record], { dayTasks: [occurrence], taskLookup: [occurrence, other], recurringTasks: [template] });
    expect(ids(items)).toEqual([`jobo-do:manual:s:${DAY}`]);
    expect(items[0]).toMatchObject({ title: 'Standup', color: 'bg-emerald-500', joboTaskId: occurrence.id });
  });
});

// The two parts are memoized apart in the app: the slices on the ledger,
// the resolver on the tasks. A resolver rebuilt over the same slices sees
// the task as it stands now.
describe('the index in two parts', () => {
  it('reuses the ledger slices and resolves against the current tasks', () => {
    const slices = buildPastDaySlices([timed()]);
    const before = pastDayItems({ dateStr: DAY, dayTasks: [report], index: buildPastDayIndex({ slices, taskLookup: [report] }) });
    const renamed = { ...report, title: 'Write the final report', color: 'bg-violet-500' };
    const after = pastDayItems({ dateStr: DAY, dayTasks: [renamed], index: buildPastDayIndex({ slices, taskLookup: [renamed] }) });
    expect(before[0]).toMatchObject({ title: report.title, color: 'bg-blue-500' });
    expect(after[0]).toMatchObject({ title: 'Write the final report', color: 'bg-violet-500' });
    expect(after).toHaveLength(1);
  });
});

// What the views read (App's getDayDisplayForDate): the rule for past dates
// only, never without an index, and under the same tag filter as tasks.
describe('pastDayDisplay', () => {
  const index = () => buildPastDayIndex({ records: [timed()], taskLookup: [report, call] });
  const dayTasks = [report, call];

  // MUTATION: drop the date check and today's plan turns into Do while you
  // are still working through it.
  it('leaves today and later exactly as they are', () => {
    expect(pastDayDisplay({ dateStr: DAY, todayStr: DAY, dayTasks, index: index() })).toBe(dayTasks);
    expect(pastDayDisplay({ dateStr: DAY, todayStr: '2026-09-20', dayTasks, index: index() })).toBe(dayTasks);
  });

  it('changes nothing without an index: JOBO off, or the ledger not loaded', () => {
    expect(pastDayDisplay({ dateStr: DAY, todayStr: '2026-09-30', dayTasks, index: null })).toBe(dayTasks);
  });

  it('applies the rule to a past date', () => {
    const items = pastDayDisplay({ dateStr: DAY, todayStr: '2026-09-30', dayTasks, index: index() });
    expect(items.map((item) => item.id)).toEqual(['t2', `jobo-do:manual:1:${DAY}`]);
  });

  // MUTATION: skip the filter and a Do shows under a tag filter its task fails.
  it('holds a Do to the tag filter by its task\'s title', () => {
    const onlyWork = (items) => items.filter((item) => /#work\b/.test(item.title));
    const items = pastDayDisplay({ dateStr: DAY, todayStr: '2026-09-30', dayTasks: onlyWork(dayTasks), index: index(), tagFilter: onlyWork });
    expect(items.map((item) => item.id)).toEqual([`jobo-do:manual:1:${DAY}`]);
    const noWork = (items) => items.filter((item) => !/#work\b/.test(item.title));
    expect(pastDayDisplay({ dateStr: DAY, todayStr: '2026-09-30', dayTasks: noWork(dayTasks), index: index(), tagFilter: noWork }).map((item) => item.id)).toEqual(['t2']);
  });

  // #2307: App hands the calendar filter (tags and hidden projects) in as
  // `tagFilter`; a Do carries its task's project, so it leaves with the task.
  it('holds a Do to the hidden projects by its task\'s project', () => {
    const calendar = makeCalendarFilter({ selectedTags: ['work'], liveHidden: liveHiddenProjectIds(['p1'], [{ id: 'p1' }]) });
    const items = pastDayDisplay({ dateStr: DAY, todayStr: '2026-09-30', dayTasks: calendar(dayTasks), index: index(), tagFilter: calendar });
    expect(items.map((item) => item.id)).toEqual(['t2']);
  });
});
