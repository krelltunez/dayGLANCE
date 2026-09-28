import { describe, it, expect } from 'vitest';
import { createDoRecord, canCompleteDo, reassessDoProgress, completeDoAttempt, pickJoboRecord } from './core.js';
import { createManualDo, prepareDoEdit } from './viewActions.js';
import { buildJoboRecords, advanceJoboReopenReceipts } from './detector.js';

const stamp = '2026-09-28T11:00:00+08:00';
const later = '2026-09-28T11:00:00.900+08:00';
const row = (patch = {}) => createDoRecord({
  id: `do:t1:${stamp}`, taskId: 't1', source: 'completion', title: 'Captured',
  timing: 'timed', date: '2026-09-28', startTime: '10:00', endDate: '2026-09-28', endTime: '10:45',
  progress: 'partial', planSnapshot: { date: '2026-09-28', startTime: '10:00', duration: 30 },
  createdAt: stamp, observedAt: stamp, updatedAt: stamp, extra: { preserved: [1, 2] }, ...patch,
});
const edge = (r) => ({ completions: [{ id: r.id, taskId: r.taskId, completedAt: r.createdAt }], uncompletions: [] });

describe('explicit Completed reassessment', () => {
  it('requires positive current-task evidence, preserving every other field', () => {
    const original = row();
    for (const taskCompleted of [false, undefined, null, 1, 'true']) {
      expect(() => reassessDoProgress(original, 'completed', later, { taskCompleted })).toThrow();
    }
    const changed = reassessDoProgress(original, 'completed', later, { taskCompleted: true });
    expect(changed).toEqual({ ...original, progress: 'completed', updatedAt: later });
    expect(original.progress).toBe('partial');
    expect(pickJoboRecord(original, changed)).toBe(changed);
    expect(pickJoboRecord(changed, original)).toBe(changed);
    expect(reassessDoProgress(changed, 'completed', undefined, { taskCompleted: true })).toBe(changed);
  });
  it.each(['started', 'partial', 'mostly'])('allows unlinked manual %s to complete, not linked manual/focus/orphan evidence', progress => {
    const manual = row({ source: 'manual', taskId: null, progress });
    expect(reassessDoProgress(manual, 'completed', later)).toEqual({ ...manual, progress: 'completed', updatedAt: later });
    for (const original of [row({ source: 'manual' }), row({ source: 'focus', taskId: null }), row({ taskId: null })]) {
      expect(canCompleteDo(original, { taskCompleted: true })).toBe(false);
      expect(() => reassessDoProgress(original, 'completed', later, { taskCompleted: true })).toThrow();
    }
  });
  it('requires a newer version and does not revive deletion', () => {
    expect(() => reassessDoProgress(row(), 'completed', stamp, { taskCompleted: true })).toThrow();
    expect(() => reassessDoProgress(row({ deleted: true }), 'completed', later, { taskCompleted: true })).toThrow();
  });
  it('keeps ensure-present unchanged, even for a partial or deleted row', () => {
    for (const original of [row(), row({ deleted: true })]) {
      const records = [original];
      expect(completeDoAttempt(records, { id: original.id })).toBe(records);
    }
  });
  it('wires creation, editing and stale-record guards through the form adapters', () => {
    const manual = createManualDo({ id: 'manual:one', title: 'Work', date: '2026-09-28', startMinute: 600, progress: 'completed', now: Date.parse(stamp) });
    expect(manual).toMatchObject({ taskId: null, progress: 'completed' });
    const original = row();
    expect(() => prepareDoEdit({ records: [original], record: original, progress: 'completed', now: Date.parse(later) })).toThrow();
    const changed = prepareDoEdit({ records: [original], record: original, progress: 'completed', taskCompleted: true, now: Date.parse(later) });
    expect(changed).toEqual({ ...original, progress: 'completed', updatedAt: new Date(later).toISOString() });
    expect(prepareDoEdit({ records: [changed], record: original, progress: 'completed', taskCompleted: true, now: Date.parse(later) + 1 })).toBeNull();
  });
});

describe('same-key re-completion requires the witnessed uncheck winner', () => {
  it('restores the same corrected attempt, not a second record, using a transient receipt', () => {
    const completed = row({ progress: 'completed' });
    const uncheck = { completions: [], uncompletions: [{ id: completed.id, uncheckedAt: null }] };
    const mutations = buildJoboRecords(uncheck, [completed], { observedAt: '2026-09-28T11:00:00.500+08:00' });
    const receipts = advanceJoboReopenReceipts(new Map(), uncheck, mutations);
    const restored = buildJoboRecords(edge(completed), mutations, { observedAt: later, reopenReceipts: receipts });
    expect(restored).toHaveLength(1);
    expect(restored[0]).toEqual({ ...completed, updatedAt: later });
    expect(advanceJoboReopenReceipts(receipts, edge(completed), restored).size).toBe(0);
    expect(Object.keys(restored[0]).sort()).toEqual(Object.keys(completed).sort());
  });
  it('a late observer cannot override a reassessment, correction, or tombstone', () => {
    const original = row();
    expect(buildJoboRecords(edge(original), [original], { observedAt: later })).toEqual([]);
    const receipts = new Map([[original.id, original]]);
    for (const current of [
      row({ progress: 'mostly', updatedAt: later }),
      row({ startTime: '10:05', updatedAt: later }),
      row({ deleted: true, updatedAt: later }),
      row({ title: 'equal-stamp competing capture' }),
    ]) {
      expect(buildJoboRecords(edge(original), [current], { observedAt: later, reopenReceipts: receipts })).toEqual([]);
    }
  });
  it('a new completion key still appends and does not rewrite the old attempt', () => {
    const original = row();
    const changed = buildJoboRecords({ completions: [{ id: `do:t1:${later}`, taskId: 't1', title: 'Current title', date: original.date, planSnapshot: original.planSnapshot, completedAt: later }] }, [original], { observedAt: later });
    expect(changed).toHaveLength(1);
    expect(changed[0].id).not.toBe(original.id);
    expect(original.progress).toBe('partial');
    expect(advanceJoboReopenReceipts(new Map([[original.id, original]]), { completions: [{ id: `do:t1:${later}`, taskId: 't1' }] }, changed).size).toBe(0);
  });
});


describe('receipt retirement follows source occurrence identity', () => {
  it('a new key retires only its own occurrence, even after actual dates were corrected', () => {
    const stampA = '2026-09-24T09:30:00+08:00';
    const stampB = '2026-09-25T09:30:00+08:00';
    const a = row({ id: `do:r1:2026-09-24:${stampA}`, taskId: 'r1', createdAt: stampA, planSnapshot: null });
    const b = row({ id: `do:r1:2026-09-25:${stampB}`, taskId: 'r1', createdAt: stampB, planSnapshot: null });
    const receipts = new Map([[a.id, a], [b.id, b]]);
    const newB = { id: 'do:r1:2026-09-25:2026-09-25T10:00:00+08:00', taskId: 'r1' };
    const after = advanceJoboReopenReceipts(receipts, { completions: [newB] }, []);
    expect([...after.keys()]).toEqual([a.id]);
    expect(receipts.size).toBe(2);
  });

  it('still protects a deliberate Mostly then Partial reassessment after uncheck', () => {
    const receipt = row();
    const current = row({ progress: 'partial', updatedAt: later });
    expect(buildJoboRecords(edge(current), [current], { observedAt: later, reopenReceipts: new Map([[receipt.id, receipt]]) })).toEqual([]);
  });
});
