import { describe, it, expect } from 'vitest';
import { createDoRecord } from './core.js';
import { buildJoboDayModel } from './viewModel.js';
import { summarizeJoboDayModel } from './dayStats.js';

const date = '2026-09-28';
const stamp = `${date}T12:00:00+08:00`;
const plan = { date, startTime: '09:00', duration: 60 };
const task = { id: 't1', title: 'Report', ...plan, completed: true };
const row = (patch = {}) => createDoRecord({
  id: 'do:t1:a', taskId: 't1', title: 'Report', source: 'completion', timing: 'timed',
  date, startTime: '09:10', endDate: date, endTime: '09:50', planSnapshot: plan,
  progress: 'partial', createdAt: stamp, observedAt: stamp, updatedAt: stamp, ...patch,
});
const summarize = (records = [], tasks = [task], extra = {}) => summarizeJoboDayModel(buildJoboDayModel({ date, records, tasks, ...extra }));

describe('the five day-model headline dimensions', () => {
  it('uses native completion separately from Do progress and counts a captured group once', () => {
    const stats = summarize([row(), row({ id: 'do:t1:b', startTime: '09:40', endTime: '10:10' })]);
    expect(stats.native).toEqual({ total: 1, completed: 1, plannedMinutes: 60, skipped: 0 });
    expect(stats.recordedMinutes).toBe(60); // 40 + 30 - 10, never 70
    expect(stats.comparison.comparableCount).toBe(1);
    expect(stats.comparison.start.late).toBe(1);
    expect(stats.comparison.finish.late).toBe(1);
    expect(stats.comparison.duration.onEstimate).toBe(1);
  });
  it('clips coverage across midnight and unions it with another interval', () => {
    const stats = summarize([
      row({ date: '2026-09-27', startTime: '23:30', endTime: '00:30' }),
      row({ id: 'do:t1:b', startTime: '00:20', endTime: '00:50' }),
    ]);
    expect(stats.recordedMinutes).toBe(50);
  });
  it('never turns untimed completions or inferred intervals into measured time', () => {
    const stats = summarize([
      row({ timing: 'untimed', startTime: null, endTime: null, endDate: null }),
      row({ id: 'do:t1:b', timingBasis: 'planDuration' }),
    ]);
    expect(stats.recordedMinutes).toBeNull();
    expect(stats.untimedCount).toBe(1);
    expect(stats.inferredCount).toBe(1);
    expect(stats.comparison.comparableCount).toBe(0);
    expect(stats.comparison.excludedCount).toBe(1);
  });
  it('compares the complete group against its captured date, not only its visible sessions', () => {
    const records = [row(), row({ id: 'do:t1:b', date: '2026-09-29', startTime: '10:00', endDate: '2026-09-29', endTime: '10:30' })];
    const today = summarize(records);
    expect(today.recordedMinutes).toBe(40);
    expect(today.comparison.duration.longer).toBe(1);
    const tomorrow = summarize(records, [], { date: '2026-09-29', taskLookup: [task] });
    expect(tomorrow.recordedMinutes).toBe(30);
    expect(tomorrow.comparison.groupCount).toBe(0);
  });
  it('uses corrected winners, excludes tombstones and does not count hidden household tasks', () => {
    const original = row();
    const newer = row({ startTime: '09:20', updatedAt: `${date}T12:01:00+08:00` });
    expect(summarize([original, newer]).recordedMinutes).toBe(30);
    expect(summarize([original, { ...newer, deleted: true }]).recordedMinutes).toBeNull();
    expect(summarize([original], [task], { isVisibleForUser: () => false }).native.total).toBe(0);
    expect(summarize([original], [task], { isVisibleForUser: () => false }).recordedMinutes).toBeNull();
  });
  it('does not call a measured subset a complete comparison', () => {
    const stats = summarize([row(), row({ id: 'do:t1:b', timing: 'untimed', startTime: null, endTime: null, endDate: null })]);
    expect(stats.recordedMinutes).toBe(40);
    expect(stats.comparison.comparableCount).toBe(0);
    expect(stats.comparison.excludedCount).toBe(1);
  });
  it('handles empty and invalid data without claiming zero actual activity', () => {
    expect(summarizeJoboDayModel(null)).toBeNull();
    const empty = summarize([], []);
    expect(empty.recordedMinutes).toBeNull();
    expect(empty.native.total).toBe(0);
    expect(empty.comparison.comparableCount).toBe(0);
    const invalid = summarize([row(), { id: 'bad' }]);
    expect(invalid.invalidCount).toBe(1);
    expect(invalid.recordedMinutes).toBeNull();
    expect(invalid.comparison.comparableCount).toBeNull();
  });
  it('keeps unlinked measured work but invents no Plan comparison', () => {
    const stats = summarize([row({ taskId: null, source: 'manual', planSnapshot: null })], []);
    expect(stats.recordedMinutes).toBe(40);
    expect(stats.comparison.groupCount).toBe(0);
    expect(stats.native.total).toBe(0);
  });
  it('does not double-count a renamed current task and its captured title', () => {
    const stats = summarize([row()], [{ ...task, title: 'Renamed' }]);
    expect(stats.comparison.groupCount).toBe(1);
    expect(stats.native.total).toBe(1);
    expect(stats.recordedMinutes).toBe(40);
  });
  it('counts only current timed task checkboxes, not read-only calendar entries or synthetic history', () => {
    const stats = summarize([], [task, task, { ...task, id: 'external', imported: true }, { ...task, id: 'archived', archived: true }]);
    expect(stats.native.total).toBe(1);
  });
  it('retains independent early/on-time/late and shorter/on-estimate/longer dimensions', () => {
    const cases = [
      ['08:50', '09:40', 'early', 'early', 'shorter'],
      ['09:00', '10:00', 'onTime', 'onTime', 'onEstimate'],
      ['09:10', '10:20', 'late', 'late', 'longer'],
    ];
    for (const [startTime, endTime, start, finish, duration] of cases) {
      const stats = summarize([row({ startTime, endTime })]);
      expect(stats.comparison.start[start]).toBe(1);
      expect(stats.comparison.finish[finish]).toBe(1);
      expect(stats.comparison.duration[duration]).toBe(1);
    }
  });
});
