import { describe, expect, it } from 'vitest';
import { createDoRecord } from './core.js';
import { buildJoboDayModel } from './viewModel.js';
import { buildCheckSummary, CHECK_PRIORITIES } from './checkSummary.js';

const date = '2026-09-30';
const now = { date, time: '12:00' };
const task = (patch = {}) => ({
  id: 't1', title: 'Work', date, startTime: '09:00', duration: 60, priority: 3, ...patch,
});
const record = (patch = {}) => createDoRecord({
  id: 'r1', taskId: 't1', title: 'Work', source: 'manual', progress: 'partial', timing: 'timed',
  date, startTime: '09:00', endDate: date, endTime: '10:00',
  planSnapshot: { date, startTime: '09:00', duration: 60 },
  createdAt: `${date}T09:00:00Z`, updatedAt: `${date}T09:00:00Z`, observedAt: `${date}T09:00:00Z`,
  ...patch,
});
const summarize = (input = {}) => {
  const model = buildJoboDayModel({ date, now, tasks: [], records: [], ...input });
  return { model, summary: buildCheckSummary(model, { date }) };
};
const priorityTotal = (summary) => CHECK_PRIORITIES.reduce((total, key) => total + summary.priorities[key].total, 0);

describe('Check native and not-started populations use the same real day model', () => {
  it.each([
    ['ordinary imported calendar event', { imported: true }],
    ['archived task', { archived: true }],
    ['synthetic occurrence', { isJoboSyntheticOccurrence: true }],
  ])('excludes an overdue %s from all native counts', (_name, patch) => {
    const { model, summary } = summarize({ tasks: [task(patch)] });
    expect(model.plans).toHaveLength(1);
    expect(model.plans[0].comparison.notStarted).toBe(true);
    expect(summary.stats.native).toEqual({ completed: 0, total: 0, plannedMinutes: 0, skipped: 0 });
    expect(priorityTotal(summary)).toBe(0);
    expect(summary.noDo).toBe(0);
  });

  it('includes imported task-calendar tasks and preserves not-started timing', () => {
    const importedTask = task({ imported: true, isTaskCalendar: true });
    for (const [time, expected] of [['08:00', 0], ['12:00', 1]]) {
      const { summary } = summarize({ tasks: [importedTask], now: { date, time } });
      expect(summary.stats.native).toEqual({ completed: 0, total: 1, plannedMinutes: 60, skipped: 0 });
      expect(summary.priorities.high.total).toBe(1);
      expect(summary.noDo).toBe(expected);
    }
  });

  it('counts each native task once even when its current plan is duplicated', () => {
    const { summary } = summarize({ tasks: [task(), task()] });
    expect(summary.stats.native).toEqual({ completed: 0, total: 1, plannedMinutes: 60, skipped: 0 });
    expect(priorityTotal(summary)).toBe(1);
    expect(summary.noDo).toBe(1);
  });

  it.each([
    ['archived task', { archived: true }],
    ['ordinary imported calendar event', { imported: true }],
  ])('retains recorded history for an excluded %s', (_name, patch) => {
    const { model, summary } = summarize({ tasks: [task(patch)], records: [record()] });
    expect(model.plans[0].currentTask.id).toBe('t1');
    expect(summary.stats.native.total).toBe(0);
    expect(priorityTotal(summary)).toBe(0);
    expect(summary.noDo).toBe(0);
    expect(summary.stats.recordedMinutes).toBe(60);
    expect(summary.stats.comparison.comparableCount).toBe(1);
    expect(summary.progress.partial).toBe(1);
    expect(summary.priorities.high.recordedMinutes).toBe(60);
  });

  it('keeps a removed task as captured history without adding a native task', () => {
    const { model, summary } = summarize({ records: [record()] });
    expect(model.plans[0].historical).toBe(true);
    expect(model.plans[0].currentTask).toBeNull();
    expect(summary.stats.native.total).toBe(0);
    expect(priorityTotal(summary)).toBe(0);
    expect(summary.noDo).toBe(0);
    expect(summary.stats.recordedMinutes).toBe(60);
    expect(summary.stats.comparison.comparableCount).toBe(1);
  });

  it('counts only the rescheduled current plan while retaining its older captured plan', () => {
    const { model, summary } = summarize({ tasks: [task({ startTime: '11:00' })], records: [record()] });
    expect(model.plans).toHaveLength(2);
    expect(model.plans.filter(item => item.historical)).toHaveLength(1);
    expect(summary.stats.native).toEqual({ completed: 0, total: 1, plannedMinutes: 60, skipped: 0 });
    expect(priorityTotal(summary)).toBe(1);
    expect(summary.noDo).toBe(1);
    expect(summary.stats.recordedMinutes).toBe(60);
  });

  it('keeps missing plan evidence separate from native task completion', () => {
    const { summary } = summarize({ tasks: [task({ completed: true })] });
    expect(summary.stats.native).toEqual({ completed: 1, total: 1, plannedMinutes: 60, skipped: 0 });
    expect(summary.noDo).toBe(1);
    expect(summary.doCount).toBe(0);
  });

  it('keeps not-started unavailable when the ledger has invalid evidence', () => {
    const { summary } = summarize({ tasks: [task()], records: [{ ...record(), startTime: 'invalid' }] });
    expect(summary.stats.native.total).toBe(1);
    expect(summary.clean).toBe(false);
    expect(summary.noDo).toBeNull();
  });
});
