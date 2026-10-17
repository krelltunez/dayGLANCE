import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createDoRecord, tombstoneDoRecord } from './core.js';
import { buildJoboDayModel } from './viewModel.js';
import { buildCheckSummary } from './checkSummary.js';
import { expandRecurringTasks } from '../utils/expandRecurringTasks.js';
import {
  aggregateCheckSummaries, buildStatisticsDayReport, statisticsEvidenceDates, statisticsReportFromModel,
} from './checkStatistics.js';

const now = { date: '2026-09-30', time: '12:00' };
const record = (patch = {}) => createDoRecord({
  id: 'r1', taskId: null, title: 'Work', source: 'manual', progress: 'partial', timing: 'timed',
  date: '2026-09-28', startTime: '09:00', endDate: '2026-09-30', endTime: '10:00', planSnapshot: null,
  createdAt: '2026-09-28T09:00:00Z', updatedAt: '2026-09-28T09:00:00Z', observedAt: '2026-09-28T09:00:00Z',
  ...patch,
});
const recurring = (patch = {}) => ({
  id: 'daily', title: 'Read', startTime: '09:00', duration: 60, color: 'bg-blue-500',
  recurrence: { type: 'daily', startDate: '2026-08-01' }, completedDates: ['2026-09-01'], ...patch,
});
const range = (source) => {
  const dates = statisticsEvidenceDates({ ...source, tasks: [...(source.tasks || []), ...(source.inboxTasks || [])], anchorDate: now.date, throughDate: now.date });
  return { dates, summary: aggregateCheckSummaries(dates.map(date => buildStatisticsDayReport({ ...source, date, now }))) };
};

describe('statistics uses real day models and persisted evidence', () => {
  it('includes every occupied civil day and all 2940 measured minutes', () => {
    const { dates, summary } = range({ records: [record()] });
    expect(dates).toEqual(['2026-09-28', '2026-09-29', '2026-09-30']);
    expect(summary.stats.recordedMinutes).toBe(2940);
    expect(summary.rawMinutes).toBe(2940);
  });

  it('does not include an empty midnight endpoint or future slices', () => {
    const midnight = record({ endDate: '2026-09-30', endTime: '00:00' });
    expect(statisticsEvidenceDates({ records: [midnight] })).toEqual(['2026-09-28', '2026-09-29']);
    const clipped = statisticsEvidenceDates({ records: [record()], throughDate: '2026-09-29' });
    expect(clipped).toEqual(['2026-09-28', '2026-09-29']);
  });

  it('uses winner records and excludes tombstones from dates and inferred identities', () => {
    const old = record({ timingBasis: 'planDuration' });
    const newer = { ...old, date: '2026-09-29', updatedAt: '2026-09-30T09:00:00Z' };
    const active = range({ records: [old, newer, newer] });
    expect(active.dates).toEqual(['2026-09-29', '2026-09-30']);
    expect(active.summary.stats.inferredCount).toBe(1);
    const deleted = range({ records: [old, tombstoneDoRecord(old, '2026-09-30T09:00:00Z')] });
    expect(deleted.dates).toEqual(['2026-09-30']);
    expect(deleted.summary.stats.inferredCount).toBe(0);
  });

  it('counts one inferred record across midnight once, without measuring its estimate', () => {
    const estimated = record({ timingBasis: 'planDuration', startTime: '23:00', endDate: '2026-09-29', endTime: '01:00' });
    const { summary } = range({ records: [estimated] });
    expect(summary.stats.inferredCount).toBe(1);
    expect(summary.stats.recordedMinutes).toBeNull();
    expect(summary.rawMinutes).toBeNull();
    const mixed = range({ records: [estimated, record({ id: 'measured', endDate: '2026-09-28', endTime: '10:00' })] }).summary;
    expect(mixed.stats.inferredCount).toBe(1);
    expect(mixed.stats.recordedMinutes).toBe(60);
  });

  it('keeps invalid or missing-id evidence fail-closed after projecting dates', () => {
    for (const invalid of [{ ...record(), id: undefined }, { ...record(), startTime: 'invalid' }]) {
      const summary = range({ records: [record({ id: 'valid' }), invalid] }).summary;
      expect(summary.clean).toBe(false);
      expect(summary.stats.recordedMinutes).toBeNull();
      expect(summary.stats.comparison.comparableCount).toBeNull();
      expect(summary.stats.inferredCount).toBe(0);
    }
  });

  it('counts saved completed recurrence outside the live expansion window', () => {
    const template = recurring();
    expect(expandRecurringTasks([template], { rangeStart: '2026-09-28', rangeEnd: '2026-10-04', today: now.date })
      .some(task => task.date === '2026-09-01')).toBe(false);
    const report = buildStatisticsDayReport({ date: '2026-09-01', recurringTasks: [template], now });
    expect(report.stats.native).toEqual({ completed: 1, total: 1, plannedMinutes: 60, skipped: 0 });
  });

  it('retains saved completion if the current recurrence rule no longer names that day', () => {
    const report = buildStatisticsDayReport({ date: '2026-09-01', now,
      recurringTasks: [recurring({ recurrence: { type: 'weekly', startDate: '2026-09-30', daysOfWeek: [3] } })],
    });
    expect(report.stats.native.completed).toBe(1);
  });

  it('counts a historical occurrence backed by Do while not inventing untouched occurrences', () => {
    const template = recurring({ completedDates: [] });
    const source = { recurringTasks: [template], now, records: [record({ taskId: 'daily', date: '2026-09-01',
      endDate: '2026-09-01', endTime: '10:00', planSnapshot: { date: '2026-09-01', startTime: '09:00', duration: 60 },
    })] };
    const saved = buildStatisticsDayReport({ ...source, date: '2026-09-01' });
    expect(saved.stats.native).toEqual({ completed: 0, total: 1, plannedMinutes: 60, skipped: 0 });
    expect(saved.stats.recordedMinutes).toBe(60);
    const untouched = buildStatisticsDayReport({ ...source, date: '2026-09-02' });
    expect(untouched.stats.native.total).toBe(0);
    expect(untouched.stats.recordedMinutes).toBeNull();
    expect(range(source).dates).not.toContain('2026-09-02');
  });

  it('respects saved exceptions, including skipped/deleted instances', () => {
    const template = recurring({ completedDates: [], exceptions: {
      '2026-09-01': { startTime: '14:00', duration: 30 },
      '2026-09-02': { deleted: true }, '2026-09-03': { skipped: true },
    } });
    const build = date => buildStatisticsDayReport({ date, recurringTasks: [template], now });
    expect(build('2026-09-01').stats.native.plannedMinutes).toBe(30);
    expect(build('2026-09-02').stats.native.total).toBe(0);
    expect(build('2026-09-03').stats.native.total).toBe(0);
  });

  it('keeps current/future recurrence identical to the app expansion without changing templates', () => {
    const template = recurring();
    const before = JSON.stringify(template);
    const dayTasks = expandRecurringTasks([template], { rangeStart: now.date, rangeEnd: now.date, today: now.date });
    const model = buildJoboDayModel({ date: now.date, tasks: dayTasks, recurringTasks: [template], records: [], now });
    const actual = buildStatisticsDayReport({ date: now.date, recurringTasks: [template], now });
    expect(actual).toMatchObject(buildCheckSummary(model, { date: now.date }));
    expect(JSON.stringify(template)).toBe(before);
  });

  it('preserves selected-day not-started semantics before and after planned start', () => {
    const task = { id: 't1', date: now.date, startTime: '09:00', duration: 60 };
    for (const [time, expected] of [['08:00', 0], ['12:00', 1]]) {
      const model = buildJoboDayModel({ date: now.date, tasks: [task], records: [], now: { date: now.date, time } });
      const result = statisticsReportFromModel(model, { date: now.date });
      expect(result).toMatchObject(buildCheckSummary(model, { date: now.date }));
      expect(result.noDo).toBe(expected);
    }
  });
});

describe('statistics household visibility', () => {
  const visible = task => !task.assignedUserSyncIds?.includes('bob');
  it('does not let hidden task, Do, or recurrence dates alter the visible range', () => {
    const hiddenTask = { id: 'bob', date: '2020-01-01', assignedUserSyncIds: ['bob'] };
    const hiddenRecord = record({ taskId: 'bob', date: '2020-01-01', endDate: '2020-01-03' });
    const hiddenRecurring = recurring({ assignedUserSyncIds: ['bob'], completedDates: ['2020-02-01'], exceptions: { '2020-02-02': {} } });
    expect(range({ tasks: [hiddenTask], records: [hiddenRecord], recurringTasks: [hiddenRecurring], isVisibleForUser: visible }).dates)
      .toEqual([now.date]);
  });

  it('applies occurrence assignment overrides instead of filtering the entire template', () => {
    const template = recurring({ assignedUserSyncIds: ['bob'], completedDates: ['2026-09-01', '2026-09-02'],
      exceptions: { '2026-09-02': { assignedUserSyncIds: ['alice'] } } });
    const source = { recurringTasks: [template], isVisibleForUser: visible };
    expect(range(source).dates).toEqual(['2026-09-02', now.date]);
    expect(buildStatisticsDayReport({ ...source, date: '2026-09-01', now }).stats.native.total).toBe(0);
    expect(buildStatisticsDayReport({ ...source, date: '2026-09-02', now }).stats.native.completed).toBe(1);
  });

  it('filters hidden completed queues but preserves independent orphan history', () => {
    const source = { isVisibleForUser: visible, records: [record({ taskId: 'removed-task' })], inboxTasks: [
      { id: 'hidden-inbox', completed: true, completedAt: `${now.date}T09:00:00Z`, assignedUserSyncIds: ['bob'] },
      { id: 'hidden-project', projectId: 'p1', completed: true, completedAt: `${now.date}T09:00:00Z`, assignedUserSyncIds: ['bob'] },
      { id: 'visible-inbox', completed: true, completedAt: `${now.date}T09:00:00Z` },
    ] };
    const report = buildStatisticsDayReport({ ...source, date: now.date, now });
    expect(report.inboxCompleted).toBe(1);
    expect(report.projectCompleted).toBe(0);
    expect(range(source).summary.stats.recordedMinutes).toBe(2940);
  });
});

describe('statistics civil dates across timezones', () => {
  it.each(['UTC', 'America/New_York', 'Asia/Shanghai'])('uses the model completion marker in %s', TZ => {
    const script = `
      import { createDoRecord } from './src/jobo/core.js';
      import { completionMarker } from './src/jobo/completionMarker.js';
      import { statisticsEvidenceDates, buildStatisticsDayReport, aggregateCheckSummaries } from './src/jobo/checkStatistics.js';
      const stamp = '2026-09-28T00:30:00Z';
      const row = createDoRecord({ id: 'untimed', taskId: null, title: 'Done', source: 'completion', progress: 'completed',
        date: '2026-09-28', timing: 'untimed', startTime: null, endDate: null, endTime: null, planSnapshot: null,
        createdAt: stamp, updatedAt: stamp, observedAt: stamp });
      const dates = statisticsEvidenceDates({ records: [row], anchorDate: '2026-09-30', throughDate: '2026-09-30' });
      const summary = aggregateCheckSummaries(dates.map(date => buildStatisticsDayReport({ date, records: [row] })));
      console.log(JSON.stringify({ dates, marker: completionMarker(row).date, untimed: summary.stats.untimedCount,
        doCount: summary.doCount, completed: summary.progress.completed, noPlan: summary.contexts.noPlan }));
    `;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd(), env: { ...process.env, TZ }, encoding: 'utf8' }));
    expect(result.dates).toContain(result.marker);
    expect(result.untimed).toBe(1);
    expect(result.doCount).toBe(1);
    expect(result.completed).toBe(1);
    expect(result.noPlan).toBe(1);
  });
});
