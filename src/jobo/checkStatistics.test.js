import { describe, expect, it } from 'vitest';
import { createDoRecord } from './core.js';
import { aggregateCheckSummaries, statisticsDatesForScope, statisticsEvidenceDates } from './checkStatistics.js';

const priority = (total = 0, completed = 0, recordedMinutes = null) => ({
  total, completed, recordedMinutes,
  progress: { completed: 0, mostly: 0, partial: total ? 1 : 0, started: 0 },
  changed: total ? 1 : 0, comparable: total ? 1 : 0,
  lateStart: total ? 1 : 0, lateFinish: 0, longer: 0,
});
const report = (patch = {}) => ({
  clean: true,
  stats: {
    native: { completed: 1, total: 2, plannedMinutes: 90 },
    recordedMinutes: 40, untimedCount: 0, inferredCount: 0, invalidCount: 0,
    comparison: {
      comparableCount: 1, groupCount: 1, excludedCount: 0,
      start: { early: 0, onTime: 0, late: 1 },
      finish: { early: 0, onTime: 1, late: 0 },
      duration: { shorter: 1, onEstimate: 0, longer: 0 },
    },
  },
  priorities: {
    high: priority(2, 1, 40), medium: priority(), low: priority(), none: priority(), unknown: priority(),
  },
  changes: { compared: 1, start: 1, finish: 0, duration: 0, unchanged: 0, unknown: 0 },
  progress: { completed: 0, mostly: 0, partial: 1, started: 0 },
  contexts: { planned: 1, noPlan: 0, unknown: 0 },
  relations: { overlaps: 1 },
  inboxCompleted: 0, projectCompleted: 0, doCount: 1, single: 1, split: 0,
  rawMinutes: 40, overlapMinutes: 0, gapMinutes: 0, maxSpanMinutes: 40,
  insideMinutes: 40, outsideMinutes: 0, maxStart: 10, maxFinish: 0, maxLonger: 0,
  minRatio: 2 / 3, maxRatio: 2 / 3, withinPlan: 1, noDo: 1,
  ...patch,
});

describe('statistics date scopes', () => {
  it('uses the selected day and the exact week supplied by the app', () => {
    expect(statisticsDatesForScope({ scope: 'day', anchorDate: '2026-09-16' })).toEqual(['2026-09-16']);
    expect(statisticsDatesForScope({
      scope: 'week', anchorDate: '2026-09-16',
      weekDates: [new Date(2026, 8, 14, 12), new Date(2026, 8, 15, 12)],
    })).toEqual(['2026-09-14', '2026-09-15']);
  });

  it('builds a complete calendar month', () => {
    const dates = statisticsDatesForScope({ scope: 'month', anchorDate: '2026-09-16' });
    expect(dates).toHaveLength(30);
    expect(dates[0]).toBe('2026-09-01');
    expect(dates.at(-1)).toBe('2026-09-30');
  });

  it('collects durable all-time evidence and excludes future dates', () => {
    expect(statisticsEvidenceDates({
      anchorDate: '2026-09-16', throughDate: '2026-10-02',
      records: [createDoRecord({ id: 'r1', taskId: null, title: 'Work', source: 'manual', progress: 'partial',
        timing: 'timed', date: '2026-09-01', startTime: '23:00', endDate: '2026-09-02', endTime: '01:00',
        planSnapshot: { date: '2026-08-31', startTime: '23:00', duration: 120 },
        createdAt: '2026-09-02T02:00:00Z', updatedAt: '2026-09-02T02:00:00Z', observedAt: '2026-09-02T02:00:00Z',
      })],
      tasks: [{ date: '2026-09-20', originalPlan: { date: '2026-09-18' }, completedAt: '2026-09-20T10:00:00Z' }],
      recurringTasks: [{ id: 'recurring', completedDates: ['2026-09-03', '2026-10-03'], exceptions: { '2026-09-04': {}, '2026-10-04': {} } }],
    })).toEqual(['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-16', '2026-09-18', '2026-09-20']);
  });

  it('sorts and deduplicates all-time dates', () => {
    expect(statisticsDatesForScope({
      scope: 'allTime', anchorDate: '2026-09-16',
      evidenceDates: ['2026-09-20', '2026-09-01', '2026-09-20'],
    })).toEqual(['2026-09-01', '2026-09-20']);
  });
});

describe('range aggregation', () => {
  it('adds day-partitioned totals and captured-plan comparisons', () => {
    const second = report({
      stats: {
        ...report().stats,
        native: { completed: 2, total: 3, plannedMinutes: 120 },
        recordedMinutes: 50,
        comparison: {
          comparableCount: 1, groupCount: 2, excludedCount: 1,
          start: { early: 1, onTime: 0, late: 0 },
          finish: { early: 0, onTime: 0, late: 1 },
          duration: { shorter: 0, onEstimate: 0, longer: 1 },
        },
      },
      rawMinutes: 60, overlapMinutes: 10, insideMinutes: 30, outsideMinutes: 20,
      maxStart: 5, maxFinish: 20, maxLonger: 30, minRatio: 0.5, maxRatio: 1.5,
      relations: { overlaps: 1, after: 1 }, withinPlan: 0, noDo: 2,
    });
    const value = aggregateCheckSummaries([report(), second]);
    expect(value.stats.native).toEqual({ completed: 3, total: 5, plannedMinutes: 210, skipped: 0 });
    expect(value.stats.recordedMinutes).toBe(90);
    expect(value.stats.comparison.start).toEqual({ early: 1, onTime: 0, late: 1 });
    expect(value.stats.comparison.finish).toEqual({ early: 0, onTime: 1, late: 1 });
    expect(value.stats.comparison.duration).toEqual({ shorter: 1, onEstimate: 0, longer: 1 });
    expect(value.rawMinutes).toBe(100);
    expect(value.overlapMinutes).toBe(10);
    expect(value.insideMinutes).toBe(70);
    expect(value.outsideMinutes).toBe(20);
    expect(value.maxStart).toBe(10);
    expect(value.maxFinish).toBe(20);
    expect(value.maxLonger).toBe(30);
    expect(value.minRatio).toBe(0.5);
    expect(value.maxRatio).toBe(1.5);
    expect(value.relations).toEqual({ overlaps: 2, after: 1 });
    expect(value.noDo).toBe(3);
  });

  it('does not infer range Execution from bare summaries without record/group identities', () => {
    const value = aggregateCheckSummaries([report(), report()]);
    expect(value.doCount).toBeNull();
    expect(value.progress).toBeNull();
    expect(value.contexts).toBeNull();
    expect(value.single).toBeNull();
    expect(value.split).toBeNull();
    expect(value.gapMinutes).toBeNull();
  });

  it('with invalid ledger evidence keeps basic counts but hides exact metrics', () => {
    const dirty = report({
      clean: false,
      stats: { ...report().stats, recordedMinutes: null, invalidCount: 1 },
      rawMinutes: null, maxStart: null,
    });
    const value = aggregateCheckSummaries([report(), dirty]);
    expect(value.clean).toBe(false);
    expect(value.stats.native.total).toBe(4);
    expect(value.stats.invalidCount).toBe(1);
    expect(value.stats.recordedMinutes).toBeNull();
    expect(value.stats.comparison.comparableCount).toBeNull();
    expect(value.rawMinutes).toBeNull();
    expect(value.maxStart).toBeNull();
    expect(value.changes).toBeNull();
  });

  it('preserves one-day semantics without mutating the source', () => {
    const source = report();
    const before = JSON.stringify(source);
    const value = aggregateCheckSummaries([source]);
    expect(value).toMatchObject(source);
    expect(value.days).toBe(1);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('returns null for no reports', () => expect(aggregateCheckSummaries([])).toBeNull());
});
