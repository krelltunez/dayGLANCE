import { describe, it, expect, vi } from 'vitest';
import { createDoRecord, pickJoboRecord } from './core.js';
import { createManualDo, doIntervalAt, prepareDoEdit, prepareDoDelete, commitDoEdit } from './viewActions.js';
const stamp = '2026-09-24T09:00:00.000Z';
const base = () => createDoRecord({ id: 'do:t1:x', taskId: 't1', title: 'Captured', source: 'completion',
  timing: 'untimed', date: '2026-09-24', startTime: null, endDate: null, endTime: null,
  planSnapshot: { date: '2026-09-24', startTime: '09:00', duration: 30 }, progress: 'completed',
  createdAt: stamp, updatedAt: stamp, observedAt: stamp });
const now = Date.parse(stamp) + 60000;
describe('minimal Do form adapters', () => {
  it('uses the supplied manual identity on a rejected write and retry', async () => {
    const id = 'manual:allocated-once';
    const draft = { id, title: 'Manual work', date: '2026-09-24', startMinute: 600, duration: 30, now };
    const writer = vi.fn().mockResolvedValueOnce({ ok: false, error: 'storageWrite' }).mockResolvedValueOnce({ ok: true });
    await expect(commitDoEdit(writer, createManualDo(draft))).rejects.toThrow();
    await commitDoEdit(writer, createManualDo({ ...draft, now: now + 1 }));
    const attempts = writer.mock.calls.map(([rows]) => rows[0]);
    expect(attempts.map(row => row.id)).toEqual([id, id]);
    expect(attempts.every(row => row.progress === 'started' && row.taskId === null && row.source === 'manual')).toBe(true);
    expect(pickJoboRecord(...attempts).id).toBe(id);
  });
  it('allows completed manual work only when it has no task link', () => {
    const input = { id: 'm', title: 'Manual', date: '2026-09-24', startMinute: 600, progress: 'completed', now };
    expect(createManualDo(input)).toMatchObject({ taskId: null, source: 'manual', progress: 'completed' });
    expect(() => createManualDo({ ...input, task: { id: 't1', completed: true } })).toThrow();
  });
  it('corrects untimed evidence under the same id without changing capture or source', () => {
    const opened = base();
    const patch = doIntervalAt('2026-09-24', 23 * 60 + 45, 30);
    const next = prepareDoEdit({ records: [opened], record: opened, patch, progress: 'completed', now });
    expect(next).toMatchObject({ id: opened.id, title: opened.title, planSnapshot: opened.planSnapshot,
      source: opened.source, createdAt: opened.createdAt, observedAt: opened.observedAt,
      timing: 'timed', endDate: '2026-09-25', endTime: '00:15', progress: 'completed' });
    expect(opened.timing).toBe('untimed');
  });
  it('reassesses only the Do and refuses stale/tombstoned versions', () => {
    const opened = base();
    const next = prepareDoEdit({ records: [opened], record: opened, progress: 'partial', now });
    expect(next.progress).toBe('partial');
    expect(next.planSnapshot).toEqual(opened.planSnapshot);
    expect(prepareDoEdit({ records: [next], record: opened, progress: 'mostly', now: now + 1 })).toBeNull();
    const deleted = prepareDoDelete({ records: [next], record: next, now: now + 2 });
    expect(deleted.deleted).toBe(true);
    expect(prepareDoEdit({ records: [deleted], record: next, progress: 'mostly', now: now + 3 })).toBeNull();
  });
  it('preserves unknown extensions and does not mint a version for a no-op', () => {
    const opened = createDoRecord({ ...base(), extension: { keep: true } });
    expect(prepareDoEdit({ records: [opened], record: opened, patch: {}, now })).toBe(opened);
    const next = prepareDoEdit({ records: [opened], record: opened, progress: 'started', now });
    expect(next.extension).toEqual({ keep: true });
    expect(() => prepareDoEdit({ records: [opened], record: opened, patch: { title: 'Changed' }, now })).toThrow();
  });
  it('accepts a held receipt without claiming success or retrying in the view', async () => {
    const record = base();
    const writer = vi.fn().mockResolvedValue({ ok: false, held: true, error: 'storageWrite' });
    expect(await commitDoEdit(writer, record)).toEqual({ ok: false, held: true, error: 'storageWrite' });
    expect(writer).toHaveBeenCalledExactlyOnceWith([record]);
  });
});
