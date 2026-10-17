import { describe, expect, it } from 'vitest';
import { createDoRecord } from './core.js';
import { buildJoboDayModel } from './viewModel.js';
import { summarizeJoboDayModel } from './dayStats.js';
import { buildCheckSummary, checkPriority } from './checkSummary.js';

const date = '2026-09-28';
const stamp = `${date}T12:00:00+08:00`;
const plan = { date, startTime: '09:00', duration: 60 };
const task = { id: 't1', title: 'Report #work', ...plan, originalPlan: plan, priority: 3, completed: true };
const record = (patch = {}) => createDoRecord({
  id: 'r1', taskId: 't1', title: task.title, source: 'completion', timing: 'timed',
  date, startTime: '09:10', endDate: date, endTime: '09:50', planSnapshot: plan,
  progress: 'partial', createdAt: stamp, observedAt: stamp, updatedAt: stamp, ...patch,
});
const modelFor = ({ records = [record()], tasks = [task], ...extra } = {}) => buildJoboDayModel({
  date, records, tasks, taskLookup: tasks, now: { date, time: '23:00' }, ...extra,
});
const reportFor = (input = {}, extra = {}) => buildCheckSummary(modelFor(input), { date, ...extra });
const untimed = (patch = {}) => record({ id: 'untimed', timing: 'untimed', startTime: null, endDate: null, endTime: null, ...patch });

describe('Statistics seed from the existing day model', () => {
  it('returns no report for an absent model', () => expect(buildCheckSummary(null)).toBeNull());
  it.each([[3, 'high'], [2, 'medium'], [1, 'low'], [0, 'none'], [undefined, 'unknown'], [null, 'unknown'], ['3', 'unknown'], [-1, 'unknown'], [4, 'unknown']])(
    'maps native priority %s to %s without inventing missing priority', (priority, expected) => {
      expect(checkPriority({ priority })).toBe(expected);
      expect(checkPriority(null)).toBe('unknown');
    },
  );
  it('uses the same day totals and comparison population as the date header', () => {
    const model = modelFor({ records: [record(), record({ id: 'r2', startTime: '09:40', endTime: '10:10' })] });
    const r = buildCheckSummary(model, { date });
    expect(r.stats).toEqual(summarizeJoboDayModel(model));
    expect(r.stats.native).toEqual({ completed: 1, total: 1, plannedMinutes: 60, skipped: 0 });
    expect(r.stats.recordedMinutes).toBe(60);
    expect(r.rawMinutes).toBe(70);
    expect(r.overlapMinutes).toBe(10);
    expect(r.single).toBe(0);
    expect(r.split).toBe(1);
    expect(r.priorities.high).toMatchObject({ total: 1, completed: 1, recordedMinutes: 60, comparable: 1 });
  });
  it('keeps task completion separate from the progress of each attempt', () => {
    const r = reportFor({ records: [record(), record({ id: 'r2', progress: 'mostly' })] });
    expect(r.stats.native.completed).toBe(1);
    expect(r.progress).toEqual({ completed: 0, mostly: 1, partial: 1, started: 0 });
    expect(r.priorities.high.progress).toEqual(r.progress);
  });
  it('clips daily time at midnight but keeps full-group metrics for comparisons', () => {
    const r = reportFor({ records: [record({ date: '2026-09-27', startTime: '23:30', endTime: '00:30' })] });
    expect(r.stats.recordedMinutes).toBe(30);
    expect(r.priorities.high.recordedMinutes).toBe(30);
    expect(r.rawMinutes).toBe(30);
    expect(r.maxSpanMinutes).toBe(60);
    expect(r.stats.comparison.comparableCount).toBe(1);
  });
  it('includes off-day attempts in plan comparisons without adding off-day time to this day', () => {
    const r = reportFor({ records: [record(), record({ id: 'tomorrow', date: '2026-09-29', endDate: '2026-09-29', startTime: '10:00', endTime: '10:30' })] });
    expect(r.doCount).toBe(1);
    expect(r.split).toBe(1);
    expect(r.stats.recordedMinutes).toBe(40);
    expect(r.stats.comparison.duration.longer).toBe(1);
    expect(r.maxLonger).toBe(10);
    expect(r.gapMinutes).toBe(1450);
    expect(r.maxSpanMinutes).toBe(1520);
  });
  it('does not add priority coverages across overlapping priorities', () => {
    const other = { ...task, id: 't2', priority: 2 };
    const r = reportFor({ tasks: [task, other], records: [record(), record({ id: 'r2', taskId: 't2', startTime: '09:40', endTime: '10:10' })] });
    expect(r.priorities.high.recordedMinutes).toBe(40);
    expect(r.priorities.medium.recordedMinutes).toBe(30);
    expect(r.stats.recordedMinutes).toBe(60);
    expect(r.priorities.high.recordedMinutes + r.priorities.medium.recordedMinutes).toBe(70);
  });
  it('leaves unlinked and priority-less work unclassified, including a P1-looking title', () => {
    const { priority: ignored, ...noPriority } = task;
    void ignored;
    const r = reportFor({ tasks: [noPriority], records: [record({ title: '#p1 urgent' }), record({ id: 'manual', taskId: null, source: 'manual', planSnapshot: null })] });
    expect(r.priorities.high.total).toBe(0);
    expect(r.priorities.none.total).toBe(0);
    expect(r.priorities.unknown.total).toBe(1);
    expect(r.priorities.unknown.progress.partial).toBe(2);
  });
  it('reads current priority without changing captured title or plan', () => {
    const row = record();
    const snapshot = JSON.stringify(row);
    const r = reportFor({ tasks: [{ ...task, title: 'Renamed', priority: 2 }], records: [row] });
    expect(r.priorities.medium.recordedMinutes).toBe(40);
    expect(r.priorities.high.recordedMinutes).toBeNull();
    expect(r.stats.native.total).toBe(1);
    expect(JSON.stringify(row)).toBe(snapshot);
  });
  it('does not call a missing original plan unchanged', () => {
    const { originalPlan: ignored, ...noOriginal } = task;
    void ignored;
    const r = reportFor({ tasks: [noOriginal] });
    expect(r.changes).toMatchObject({ compared: 0, unchanged: 0, unknown: 1 });
  });
  it('counts start/finish/budget changes independently', () => {
    const r = reportFor({ tasks: [{ ...task, originalPlan: { ...plan, startTime: '08:00', duration: 90 } }] });
    expect(r.changes).toMatchObject({ compared: 1, start: 1, finish: 1, duration: 1, unchanged: 0, unknown: 0 });
    expect(r.priorities.high.changed).toBe(1);
  });
  it('does not double-count captured plans after a rename or a reschedule', () => {
    const r = reportFor({ tasks: [{ ...task, title: 'New name', startTime: '11:00' }] });
    expect(r.stats.comparison.groupCount).toBe(1);
    expect(r.changes.compared).toBe(1);
    expect(r.priorities.high.comparable).toBe(1);
  });
  it('gets independent deviations, ratios and Allen relations from core', () => {
    const r = reportFor({ records: [record({ endTime: '10:30' })] });
    expect(r.maxStart).toBe(10);
    expect(r.maxFinish).toBe(30);
    expect(r.maxLonger).toBe(20);
    expect(r.minRatio).toBeCloseTo(80 / 60);
    expect(r.maxRatio).toBe(r.minRatio);
    expect(r.insideMinutes).toBe(50);
    expect(r.outsideMinutes).toBe(30);
    expect(r.relations).toEqual({ overlappedBy: 1 });
    expect(r.priorities.high).toMatchObject({ lateStart: 1, lateFinish: 1, longer: 1 });
  });
  it('keeps timing equality distinct from the broad withinPlan summary', () => {
    const r = reportFor({ records: [record({ startTime: '08:50', endTime: '09:50' })] });
    expect(r.withinPlan).toBe(1);
    expect(r.relations).toEqual({ overlaps: 1 });
    expect(r.insideMinutes).toBe(50);
    expect(r.outsideMinutes).toBe(10);
  });
  it('keeps missing duration unknown for a fully untimed or inferred group', () => {
    for (const rows of [[untimed()], [record({ timingBasis: 'planDuration' })]]) {
      const r = reportFor({ records: rows });
      expect(r.stats.recordedMinutes).toBeNull();
      expect(r.rawMinutes).toBeNull();
      expect(r.maxSpanMinutes).toBeNull();
      expect(r.gapMinutes).toBeNull();
      expect(r.stats.comparison.comparableCount).toBe(0);
      expect(r.stats.comparison.excludedCount).toBe(1);
      expect(r.maxRatio).toBeNull();
    }
  });
  it('retains only measured diagnostics in a mixed group', () => {
    const r = reportFor({ records: [record(), untimed(), record({ id: 'estimated', timingBasis: 'planDuration', endTime: '18:00' })] });
    expect(r.stats.recordedMinutes).toBe(40);
    expect(r.stats.comparison.comparableCount).toBe(0);
    expect(r.gapMinutes).toBe(0);
    expect(r.maxSpanMinutes).toBe(40);
    expect(r.insideMinutes).toBeNull();
    expect(r.rawMinutes).toBe(40);
    expect(r.priorities.high.comparable).toBe(0);
  });
  it('keeps invalid evidence distinct from a clean empty ledger', () => {
    const empty = reportFor({ records: [] });
    expect(empty.stats.recordedMinutes).toBeNull();
    expect(empty.noDo).toBe(1);
    const invalid = reportFor({ records: [record(), { id: 'broken' }] });
    expect(invalid.clean).toBe(false);
    expect(invalid.stats.recordedMinutes).toBeNull();
    expect(invalid.rawMinutes).toBeNull();
    expect(invalid.stats.comparison.comparableCount).toBeNull();
    expect(invalid.maxStart).toBeNull();
    expect(invalid.noDo).toBeNull();
  });
  it('uses winning records and excludes tombstones through the unchanged model', () => {
    const original = record();
    const corrected = record({ startTime: '09:30', updatedAt: `${date}T12:01:00+08:00` });
    const r = reportFor({ records: [corrected, original] });
    expect(r.doCount).toBe(1);
    expect(r.rawMinutes).toBe(20);
    const deleted = reportFor({ records: [original, { ...corrected, deleted: true }] });
    expect(deleted.doCount).toBe(0);
    expect(deleted.progress.partial).toBe(0);
  });
  it('respects the model household visibility without regrouping hidden work', () => {
    const r = reportFor({ isVisibleForUser: () => false });
    expect(r.doCount).toBe(0);
    expect(r.stats.native.total).toBe(0);
    expect(r.changes.compared).toBe(0);
  });
  it('keeps a second recurring instance separate from the captured day', () => {
    const template = { id: 'series', title: 'Read', startTime: '09:00', duration: 60, completedDates: [date], recurrence: { type: 'daily' } };
    const r = reportFor({ tasks: [], recurringTasks: [template], records: [
      record({ taskId: 'series', id: `do:series:${date}:1` }),
      record({ taskId: 'series', id: 'do:series:2026-09-29:2', date: '2026-09-29', endDate: '2026-09-29', planSnapshot: { ...plan, date: '2026-09-29' } }),
    ] });
    expect(r.doCount).toBe(1);
    expect(r.single).toBe(1);
    expect(r.split).toBe(0);
    expect(r.stats.comparison.groupCount).toBe(1);
    expect(r.priorities.unknown.comparable).toBe(1);
  });
  it('does not count no-plan execution as a failed comparison or lose it from measured time', () => {
    const r = reportFor({ tasks: [], records: [record({ taskId: null, source: 'manual', planSnapshot: null })] });
    expect(r.stats.recordedMinutes).toBe(40);
    expect(r.contexts.noPlan).toBe(1);
    expect(r.stats.comparison.groupCount).toBe(0);
    expect(r.stats.comparison.excludedCount).toBe(0);
  });
  it('counts selected-date queue completions rather than today or task due dates', () => {
    const make = (id, patch = {}) => ({ id, completed: true, completedAt: stamp, ...patch });
    const inboxTasks = [make('inbox'), make('project', { projectId: 'p' }),
      make('bucket', { bucketId: 'b1' }), make('due', { deadline: date }), make('project-due', { deadline: date, projectId: 'p' }),
      make('other-date', { completedAt: '2026-09-29T12:00:00+08:00' }), make('no-stamp', { completedAt: undefined }), make('pending', { completed: false })];
    const r = reportFor({}, { inboxTasks });
    expect(r.inboxCompleted).toBe(1);
    expect(r.projectCompleted).toBe(2);
  });
  it('is independent of drawing scale and tag text', () => {
    const normal = reportFor({ scale: 80 });
    const zoomed = reportFor({ scale: 240 });
    expect(zoomed).toEqual(normal);
    const noTags = reportFor({ tasks: [{ ...task, title: 'Report' }], records: [record({ title: 'Report' })] });
    expect(noTags).toEqual(normal);
  });
  it('honors supplied comparison decisions without reclassifying offsets', () => {
    const model = modelFor();
    model.plans.find(item => item.id.startsWith('captured::')).comparison.startTiming = 'onTime';
    const r = buildCheckSummary(model, { date });
    expect(r.stats.comparison.start.onTime).toBe(1);
    expect(r.priorities.high.lateStart).toBe(0);
  });
  it('does not mutate input models, tasks, records or arrays', () => {
    const freeze = value => {
      if (!value || typeof value !== 'object') return;
      Object.values(value).forEach(freeze); Object.freeze(value);
    };
    const model = modelFor();
    const original = JSON.stringify(model);
    freeze(model);
    expect(() => buildCheckSummary(model, { date, inboxTasks: Object.freeze([]) })).not.toThrow();
    expect(JSON.stringify(model)).toBe(original);
  });
});
