import { describe, expect, it } from 'vitest';
import { beginFocusCapture, resumeFocusCapture, pauseFocusCapture, sealFocusCapture } from './focusCapture.js';
import { buildFocusDoRecords, focusMinuteInterval, summarizeFocusCapture } from './focusRecords.js';
import { compareExecutionToPlan, createDoRecord, tombstoneDoRecord, updateDoRecord } from './core.js';
import { buildJoboDayModel, buildJoboTaskResolver } from './viewModel.js';
import { summarizeJoboDayModel } from './dayStats.js';

const task = { id: 't1', title: 'Write', date: '2026-10-09', startTime: '09:00', duration: 30 };
const instant = time => Date.parse(`2026-10-09T${time}Z`);
const span = (start, end) => ({ startedAt: instant(start), endedAt: instant(end), startOffset: 0, endOffset: 0 });
const capture = (start, end) => sealFocusCapture(resumeFocusCapture(beginFocusCapture({ id: 'focus:s:0', tasks: [task] }), instant(start)), instant(end));

describe('minute-resolution Focus Do', () => {
  it('rounds both civil boundaries without rounding the duration', () => {
    expect(focusMinuteInterval(span('09:00:20', '09:02:40'))).toEqual({ date: task.date, startTime: '09:00', endDate: task.date, endTime: '09:03', minutes: 3 });
    expect(focusMinuteInterval(span('09:00:20', '09:01:40')).minutes).toBe(2);
    expect(focusMinuteInterval(span('09:00:50', '09:01:10'))).toBeNull();
    expect(focusMinuteInterval(span('09:00:00', '09:01:00')).minutes).toBe(1);
  });
  it('keeps the signed difference from captured work explicit', () => {
    expect(summarizeFocusCapture(capture('09:00:20', '09:01:40'))).toMatchObject({ workMilliseconds: 80000, recordedMinutes: 2, recordedDifferenceMilliseconds: 40000 });
    expect(summarizeFocusCapture(capture('09:00:40', '09:01:20'))).toMatchObject({ workMilliseconds: 40000, recordedMinutes: 0, recordedDifferenceMilliseconds: -40000 });
  });
  it('creates one partial Do per represented segment, linked to one captured task and plan', () => {
    let c = pauseFocusCapture(resumeFocusCapture(beginFocusCapture({ id: 's', tasks: [task] }), instant('09:00:00')), instant('09:02:00'));
    c = sealFocusCapture(resumeFocusCapture(c, instant('09:02:30')), instant('09:04:40'));
    const rows = buildFocusDoRecords(c, 't1', []);
    expect(rows).toHaveLength(2);
    expect(rows.map(row => [row.startTime, row.endTime])).toEqual([['09:00', '09:02'], ['09:03', '09:05']]);
    expect(rows.every(row => row.source === 'focus' && row.progress === 'partial' && row.taskId === 't1')).toBe(true);
    expect(rows[0].planSnapshot).toEqual({ date: task.date, startTime: '09:00', duration: 30 });
    expect(compareExecutionToPlan(rows[0].planSnapshot, rows).metrics).toMatchObject({ recordedMinutes: 4, gapMinutes: 1 });
  });
  it('reuses every id and version stamp on repeat construction', () => {
    const c = capture('09:00:00', '09:02:00');
    expect(buildFocusDoRecords(c, 't1', [])).toEqual(buildFocusDoRecords(c, 't1', []));
  });
  it('never recreates an existing row, edit, or tombstone', () => {
    const c = capture('09:00:00', '09:02:00');
    const [row] = buildFocusDoRecords(c, 't1', []);
    const edited = updateDoRecord(row, { endTime: '09:03' }, '2026-10-09T10:00:00Z');
    const deleted = tombstoneDoRecord(row, '2026-10-09T10:00:00Z');
    for (const existing of [row, edited, deleted]) expect(buildFocusDoRecords(c, 't1', [existing])).toEqual([]);
  });
  it('retains manual history and counts overlapping daily measured minutes once', () => {
    const [row] = buildFocusDoRecords(capture('09:00:00', '09:02:00'), 't1', []);
    const manual = createDoRecord({ ...row, id: 'manual:1', source: 'manual', startTime: '09:01', endTime: '09:03' });
    const rows = buildFocusDoRecords(capture('09:00:00', '09:02:00'), 't1', [manual]);
    expect(rows).toEqual([row]);
    expect(summarizeJoboDayModel(buildJoboDayModel({ date: task.date, records: [manual, ...rows] })).recordedMinutes).toBe(3);
  });
  it('keeps the native untimed completion separate and the mixed execution non-comparable', () => {
    const [row] = buildFocusDoRecords(capture('09:00:00', '09:02:00'), 't1', []);
    const completion = createDoRecord({ ...row, id: 'do:t1:done', source: 'completion', progress: 'completed', timing: 'untimed', startTime: null, endDate: null, endTime: null });
    const compared = compareExecutionToPlan(row.planSnapshot, [row, completion]);
    expect(compared.comparable).toBe(false);
    expect(compared.metrics.recordedMinutes).toBe(2);
  });
  it('keeps no-plan recurring Focus rows independent under the existing resolver contract', () => {
    const recurring = { ...task, id: 'recurring-r1-2026-10-09', recurringTemplateId: 'r1', isAllDay: true };
    const c = sealFocusCapture(resumeFocusCapture(beginFocusCapture({ id: 's', tasks: [recurring] }), instant('09:00:00')), instant('09:02:00'));
    const [row] = buildFocusDoRecords(c, recurring.id, []);
    expect(row).toMatchObject({ taskId: 'r1', planSnapshot: null, source: 'focus' });
    expect(buildJoboTaskResolver({ records: [row], taskLookup: [recurring] })(row)).toBeNull();
    expect(summarizeJoboDayModel(buildJoboDayModel({ date: task.date, records: [row] })).recordedMinutes).toBe(2);
  });
  it('uses explicit endDate across midnight', () => {
    const interval = focusMinuteInterval({ ...span('23:59:00', '23:59:01'), endedAt: Date.parse('2026-10-10T00:01:00Z') });
    expect(interval).toEqual({ date: task.date, startTime: '23:59', endDate: '2026-10-10', endTime: '00:01', minutes: 2 });
  });
  it('keeps a captured zone offset when conversion happens later', () => {
    expect(focusMinuteInterval({ ...span('01:00:00', '01:01:00'), startOffset: -480, endOffset: -480 }).startTime).toBe('09:00');
  });
  it('does not fabricate a civil hour across a timezone or DST transition', () => {
    expect(focusMinuteInterval({ ...span('09:00:00', '09:02:00'), endOffset: -60 })).toBeNull();
  });
  it('refuses an unloaded ledger and invalid segment coordinates', () => {
    expect(() => buildFocusDoRecords(capture('09:00:00', '09:02:00'), 't1', undefined)).toThrow(/loaded/);
    expect(() => focusMinuteInterval(span('09:00:00', '09:00:00'))).toThrow(/Invalid/);
  });
});
