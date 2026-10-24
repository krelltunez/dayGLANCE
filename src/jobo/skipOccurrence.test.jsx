import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isSkipException, occurrencePlan, restoreOccurrence, skipOccurrence, skipState, skipTotals, skippedDates,
  skippedOccurrences, updateTemplate,
} from './skipOccurrence.js';
import { CARRY_ACTION, notStartedAction, notStartedTasks, nextStepSummary } from './carryForward.js';
import { createCarryForwardActions } from './carryForwardActions.js';
import { createDoRecord } from './core.js';
import { buildJoboDayModel } from './viewModel.js';
import { summarizeJoboDayModel } from './dayStats.js';
import { aggregateCheckSummaries, buildStatisticsDayReport } from './checkStatistics.js';
import { expandRecurringTasks } from '../utils/expandRecurringTasks.js';
import { monthStats } from '../utils/monthStats.js';
import useStats from '../hooks/useStats.js';

const today = '2026-10-13';
const at = '2026-10-13T11:05:00.000+02:00';
const series = (over = {}) => ({
  id: 'tpl', title: 'Read', startTime: '09:00', duration: 60, color: 'bg-blue-500', priority: 2,
  recurrence: { type: 'daily', startDate: '2026-10-01' }, completedDates: [], exceptions: {}, ...over,
});
const skipped = (over = {}) => skipOccurrence(series(over), today, { at });
const doOn = (date, over = {}) => createDoRecord({
  id: `do-${date}`, taskId: 'tpl', title: 'Read', source: 'manual', timing: 'timed',
  date, startTime: '14:00', endDate: date, endTime: '14:30', progress: 'partial',
  planSnapshot: { date, startTime: '09:00', duration: 60 },
  createdAt: `${date}T14:30:00Z`, updatedAt: `${date}T14:30:00Z`, observedAt: `${date}T14:30:00Z`, ...over,
});

afterEach(() => vi.useRealTimers());

describe('the skip record', () => {
  it('marks the date skipped with its own evidence and the plan the occurrence showed', () => {
    const template = series({ exceptions: { [today]: { startTime: '10:30', title: 'Read ch. 4' } } });
    const next = skipOccurrence(template, today, { at, lastModified: '2026-10-13T09:05:00.000Z' });
    expect(next.exceptions[today]).toEqual({
      startTime: '10:30', title: 'Read ch. 4', skipped: true,
      skip: { at, plan: { startTime: '10:30', duration: 60, isAllDay: false } },
    });
    expect(next.lastModified).toBe('2026-10-13T09:05:00.000Z');
    expect(template.exceptions[today].skipped).toBeUndefined();
    // The engine already hides a skipped date everywhere it expands.
    expect(expandRecurringTasks([next], { rangeStart: today, rangeEnd: today, today })).toEqual([]);
  });

  it('tells a skip from a move, which carries no evidence', () => {
    expect(isSkipException(skipped().exceptions[today])).toBe(true);
    expect(isSkipException({ skipped: true })).toBe(false);
    expect(isSkipException({ skipped: true, skip: {} })).toBe(false);
    expect(isSkipException({ skip: { at } })).toBe(false);
  });

  it.each([
    ['already skipped', { skipped: true, skip: { at: 'earlier', plan: {} } }],
    ['moved', { skipped: true }],
    ['deleted', { deleted: true }],
  ])('changes nothing on a date %s', (_, exception) => {
    expect(skipOccurrence(series({ exceptions: { [today]: exception } }), today, { at })).toBeNull();
  });

  it('restores only its own skip, removing the skip and keeping the date key and its other fields', () => {
    const template = skipOccurrence(series({ exceptions: { [today]: { title: 'Read ch. 4' } } }), today, { at });
    const back = restoreOccurrence(template, today, at, { lastModified: 'later' });
    expect(back.exceptions[today]).toEqual({ title: 'Read ch. 4' });
    expect(back.lastModified).toBe('later');
    const bare = restoreOccurrence(skipped(), today, at);
    expect(Object.hasOwn(bare.exceptions, today)).toBe(true);
    expect(bare.exceptions[today]).toEqual({});
    expect(expandRecurringTasks([bare], { rangeStart: today, rangeEnd: today, today })).toHaveLength(1);
  });

  it('refuses a skip it did not make, a move, or a date with nothing on it', () => {
    expect(restoreOccurrence(skipped(), today, 'another skip')).toBeNull();
    expect(restoreOccurrence(series({ exceptions: { [today]: { skipped: true } } }), today, at)).toBeNull();
    expect(restoreOccurrence(series(), today, at)).toBeNull();
  });

  it('applies a change to one series in a copied list, or reports the refusal', () => {
    const list = [series({ id: 'other' }), series()];
    const next = updateTemplate(list, 'tpl', template => skipOccurrence(template, today, { at }));
    expect(next[0]).toBe(list[0]);
    expect(isSkipException(next[1].exceptions[today])).toBe(true);
    expect(list[1].exceptions[today]).toBeUndefined();
    expect(updateTemplate(next, 'tpl', template => skipOccurrence(template, today, { at }))).toBeNull();
    expect(updateTemplate(list, 'missing', template => template)).toBeNull();
  });
});

describe('a skipped occurrence as the Check and statistics read it', () => {
  it('keeps the frozen plan through a later series edit', () => {
    const edited = { ...skipped(), startTime: '07:00', duration: 15, title: 'Read more' };
    const [row] = skippedOccurrences([edited], today);
    expect(row).toMatchObject({ id: `recurring-tpl-${today}`, title: 'Read more', startTime: '09:00', duration: 60,
      isAllDay: false, priority: 2, skippedAt: at, skipState: 'skipped', recurringTemplateId: 'tpl', date: today });
    expect(occurrencePlan(edited, today)).toEqual({ startTime: '07:00', duration: 15, isAllDay: false });
  });

  it('says what became of it: a completion wins over a Do, and only a Do on that occurrence counts', () => {
    const template = skipped();
    expect(skipState(template, today, [])).toBe('skipped');
    expect(skipState(template, today, [doOn(today)])).toBe('worked');
    expect(skipState({ ...template, completedDates: [today] }, today, [doOn(today)])).toBe('completed');
    for (const record of [doOn('2026-10-12'), doOn(today, { taskId: 'else' }), doOn(today, { source: 'completion' }),
      { ...doOn(today), deleted: true }]) {
      expect(skipState(template, today, [record])).toBe('skipped');
    }
  });

  it('lists skips only, for the current user, in plan order', () => {
    const early = skipOccurrence(series({ id: 'early', startTime: '07:00' }), today, { at });
    const moved = series({ id: 'moved', exceptions: { [today]: { skipped: true } } });
    const theirs = skipOccurrence(series({ id: 'theirs', assignedUserSyncIds: ['u2'] }), today, { at });
    const rows = skippedOccurrences([skipped(), moved, theirs, early], today,
      { isVisibleForUser: task => !task.assignedUserSyncIds?.includes('u2') });
    expect(rows.map(row => row.recurringTemplateId)).toEqual(['early', 'tpl']);
  });

  it('totals skips in a range, done or not, and leaves moves out', () => {
    let template = series({ completedDates: ['2026-10-10'] });
    for (const date of ['2026-10-09', '2026-10-10', today]) template = skipOccurrence(template, date, { at });
    template.exceptions['2026-10-11'] = { skipped: true };
    expect(skippedDates(template, '2026-10-01', '2026-10-12')).toEqual(['2026-10-09', '2026-10-10']);
    expect(skipTotals(template, '2026-10-01', '2026-10-12')).toEqual({ count: 2, completed: 1, minutes: 120, completedMinutes: 60 });
  });
});

describe('Skip in the Not started group', () => {
  const occurrence = (over = {}) => ({ id: `recurring-tpl-${today}`, title: 'Read', date: today, startTime: '09:00', duration: 60,
    recurringTemplateId: 'tpl', isRecurring: true, completed: false, ...over });

  it('is offered for a timed occurrence on today\'s Check only', () => {
    expect(notStartedAction(occurrence(), { today, date: today })).toEqual({ kind: CARRY_ACTION.SKIP, task: occurrence() });
    expect(notStartedAction(occurrence({ date: '2026-10-12' }), { today, date: '2026-10-12' }).kind).toBe(CARRY_ACTION.NONE);
    expect(notStartedAction(occurrence(), { today: '2026-10-14', date: today }).kind).toBe(CARRY_ACTION.NONE);
    // Only the Check of today itself, whatever the task says.
    expect(notStartedAction(occurrence(), { today, date: '2026-10-12' }).kind).toBe(CARRY_ACTION.NONE);
    // An occurrence of another date shown on today's Check (one that ran past
    // midnight) is not today's to skip.
    expect(notStartedAction(occurrence({ date: '2026-10-12' }), { today, date: today }).kind).toBe(CARRY_ACTION.NONE);
    expect(notStartedAction(occurrence({ isAllDay: true }), { today, date: today }).kind).toBe(CARRY_ACTION.NONE);
    expect(notStartedAction(occurrence({ recurringTemplateId: undefined }), { today, date: today }).kind).toBe(CARRY_ACTION.NONE);
    expect(notStartedAction(occurrence(), { date: today }).kind).toBe(CARRY_ACTION.NONE);
  });

  it('lists the ended occurrence with Skip, and never counts it as a pending next step', () => {
    const task = occurrence();
    const model = buildJoboDayModel({ date: today, records: [], tasks: [task], taskLookup: [task], now: { date: today, time: '18:00' } });
    const notStarted = notStartedTasks(model, { date: today, today, entries: [], dayTasks: [task] });
    expect(notStarted).toMatchObject([{ id: task.id, recurring: true, action: { kind: CARRY_ACTION.SKIP } }]);
    expect(nextStepSummary(model, { date: today, today, entries: [], notStarted })).toEqual({ pending: 0 });
  });
});

describe('skipTask, restoreSkip and their undo steps', () => {
  const task = { id: `recurring-tpl-${today}`, title: 'Read', date: today, startTime: '09:00', duration: 60, recurringTemplateId: 'tpl', isRecurring: true };
  function setup(initial = [series()], over = {}) {
    let list = initial;
    const steps = [];
    const deps = {
      recurringTasks: initial,
      setRecurringTasks: vi.fn(update => { list = update(list); }),
      readRecurringTasks: () => list,
      pushUndo: vi.fn(),
      pushUndoAction: vi.fn(step => steps.push(step)),
      playUISound: vi.fn(),
      now: () => new Date('2026-10-13T09:05:00.000Z'),
      t: (key, { defaultValue }) => `${key}|${defaultValue}`,
      ...over,
    };
    return { deps, actions: createCarryForwardActions(deps), list: () => list, setList: next => { list = next; }, steps };
  }

  it('skips as one targeted undo step, not a snapshot, stamped by the own-clock completion stamp', () => {
    vi.useFakeTimers({ now: new Date('2026-10-13T09:05:00.000Z') });
    const { deps, actions, list, steps } = setup();
    const result = actions.skipTask(task, today);
    expect(result.skipped).toBe(true);
    expect(result.at).toMatch(/^2026-10-13T\d\d:05:00(\.000)?([+-]\d\d:\d\d|Z)$/);
    expect(list()[0].exceptions[today]).toEqual({ skipped: true, skip: { at: result.at, plan: { startTime: '09:00', duration: 60, isAllDay: false } } });
    expect(list()[0].lastModified).toBe('2026-10-13T09:05:00.000Z');
    expect(deps.pushUndo).not.toHaveBeenCalled();
    expect(steps).toHaveLength(1);
    expect(deps.playUISound).toHaveBeenCalledWith('slide');
  });

  it('refuses a stale press and pushes nothing', () => {
    const { deps, actions, steps } = setup([skipOccurrence(series(), today, { at })]);
    expect(actions.skipTask(task, today)).toEqual({ stale: true });
    expect(actions.skipTask({ ...task, date: '2026-10-12' }, today)).toEqual({ stale: true });
    expect(actions.skipTask({ ...task, recurringTemplateId: 'gone' }, today)).toEqual({ stale: true });
    expect(deps.setRecurringTasks).not.toHaveBeenCalled();
    expect(steps).toEqual([]);
  });

  it('undoes to the occurrence it skipped, keeping the key, and redoes the same skip with its frozen plan', async () => {
    const { actions, list, setList, steps } = setup();
    const { at: stamp } = actions.skipTask(task, today);
    // A series edit in between: redo still puts back the plan the skip froze.
    expect(await steps[0].undo()).toEqual({ ok: true, message: 'jobo.check.skipUndone|Skip undone' });
    expect(list()[0].exceptions[today]).toEqual({});
    setList([{ ...list()[0], startTime: '07:00' }]);
    expect(await steps[0].redo()).toEqual({ ok: true, message: 'jobo.check.skipRedone|Skip redone' });
    expect(list()[0].exceptions[today].skip).toEqual({ at: stamp, plan: { startTime: '09:00', duration: 60, isAllDay: false } });
  });

  it('leaves an occurrence that changed since alone, reading the series as they stand now', async () => {
    const { actions, list, setList, steps, deps } = setup();
    actions.skipTask(task, today);
    // Sync brought another device's skip of the same date.
    const theirs = skipOccurrence(series(), today, { at: '2026-10-13T11:00:00.000+02:00' });
    setList([theirs]);
    expect(await steps[0].undo()).toEqual({ ok: false, message: 'jobo.check.skipChanged|This occurrence has changed since, so it was left as it is.' });
    expect(list()).toEqual([theirs]);
    expect(deps.setRecurringTasks).toHaveBeenCalledTimes(1);
  });

  it('restores from the Skipped group with its own inverse step', async () => {
    const start = skipOccurrence(series(), today, { at, plan: { startTime: '08:00', duration: 30, isAllDay: false } });
    const { actions, list, steps } = setup([start]);
    const [row] = actions.skippedOn(today);
    expect(row.startTime).toBe('08:00');
    expect(actions.restoreSkip(row)).toEqual({ restored: true });
    expect(list()[0].exceptions[today]).toEqual({});
    expect(actions.restoreSkip(row)).toEqual({ stale: true });
    expect(await steps[0].undo()).toEqual({ ok: true, message: 'jobo.check.restoreUndone|Restore undone' });
    expect(list()[0].exceptions[today]).toEqual(start.exceptions[today]);
    expect(await steps[0].redo()).toEqual({ ok: true, message: 'jobo.check.restoreRedone|Restore redone' });
    expect(list()[0].exceptions[today]).toEqual({});
  });

  it('reads the Skipped group with the ledger and the current user', () => {
    const { actions } = setup([skipOccurrence(series(), today, { at })], {
      joboRecords: [doOn(today)], isVisibleForUser: () => true,
    });
    expect(actions.skippedOn(today).map(row => row.skipState)).toEqual(['worked']);
    const hidden = setup([skipOccurrence(series(), today, { at })], { isVisibleForUser: () => false });
    expect(hidden.actions.skippedOn(today)).toEqual([]);
  });
});

describe('statistics: a skip is planned and not done (decision 5)', () => {
  const now = { date: today, time: '18:00' };
  const occurrence = { id: `recurring-tpl-${today}`, title: 'Read', date: today, startTime: '09:00', duration: 60, color: 'bg-blue-500',
    recurringTemplateId: 'tpl', isRecurring: true, completed: false, priority: 2 };
  const done = { id: 'done', title: 'Write', date: today, startTime: '11:00', duration: 30, completed: true, priority: 0 };
  const day = tasks => buildJoboDayModel({ date: today, records: [], tasks, taskLookup: tasks, now });

  it('gives today the same rate whether the occurrence was skipped or missed, and counts the skip', () => {
    const missed = summarizeJoboDayModel(day([done, occurrence]));
    const skips = skippedOccurrences([skipped()], today);
    const withSkip = summarizeJoboDayModel(day([done]), { skips });
    expect(withSkip.native).toEqual({ ...missed.native, skipped: 1 });
    expect(withSkip.native).toEqual({ completed: 1, total: 2, plannedMinutes: 90, skipped: 1 });
    // A skip is never a No Do or a comparison.
    expect(withSkip.comparison).toEqual(summarizeJoboDayModel(day([done])).comparison);
  });

  it('counts a skip overtaken by a completion as done, and no longer as skipped', () => {
    const skips = skippedOccurrences([{ ...skipped(), completedDates: [today] }], today);
    expect(summarizeJoboDayModel(day([done]), { skips }).native).toEqual({ completed: 2, total: 2, plannedMinutes: 90, skipped: 0 });
  });

  it('keeps a skip in a past day\'s history and adds it up across days', () => {
    const template = skipOccurrence(series(), '2026-10-12', { at });
    const report = buildStatisticsDayReport({ date: '2026-10-12', recurringTasks: [template], now });
    expect(report.stats.native).toEqual({ completed: 0, total: 1, plannedMinutes: 60, skipped: 1 });
    // Restored, the occurrence keeps its key and so its place in the history.
    const restored = restoreOccurrence(template, '2026-10-12', at);
    const back = buildStatisticsDayReport({ date: '2026-10-12', recurringTasks: [restored], now });
    expect(back.stats.native).toEqual({ completed: 0, total: 1, plannedMinutes: 60, skipped: 0 });
    const total = aggregateCheckSummaries([report, back]);
    expect(total.stats.native).toMatchObject({ total: 2, skipped: 1 });
  });

  it('keeps MONTH\'s rate as if the occurrence were missed', () => {
    const input = { year: 2026, month: 10, today };
    const missed = monthStats({ ...input, recurringTasks: [series()] });
    const withSkip = monthStats({ ...input, recurringTasks: [skipped()] });
    expect(withSkip).toEqual(missed);
    const moved = monthStats({ ...input, recurringTasks: [series({ exceptions: { [today]: { skipped: true } } })] });
    expect(moved.scheduled).toBe(missed.scheduled - 1);
  });

  it('keeps the daily summary\'s rate as if the occurrence were missed', () => {
    vi.useFakeTimers({ now: new Date('2026-10-13T12:00:00') });
    const read = recurringTasks => {
      let stats;
      const Probe = () => { stats = useStats({ tasks: [], unscheduledTasks: [], recurringTasks }); return null; };
      renderToStaticMarkup(<Probe />);
      return stats;
    };
    const missed = read([series()]);
    const withSkip = read([skipped()]);
    for (const key of ['allTimeScheduledCount', 'allTimeCompletedCount', 'totalScheduledMinutes', 'totalCompletedMinutes',
      'actualTodayPlannedMinutes', 'actualTodayCompletedMinutes']) expect(withSkip[key]).toBe(missed[key]);
    expect(withSkip.actualTodayNonImportedTasks).toHaveLength(missed.actualTodayNonImportedTasks.length);
  });
});
