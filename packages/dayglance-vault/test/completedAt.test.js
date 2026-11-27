// The completedAt carry (src/completedAt.js): a done copy without a stamp
// never erases the stamp a done copy elsewhere recorded (2026-11-27: a device
// on an older build applied a vault tick without stamping, its newer copy won,
// and the task stayed done with no completion time).
import { describe, expect, it } from 'vitest';
import { carriedCompletedAt } from '../src/completedAt.js';
import { applyRemoteEntity, makeEntityId } from '../src/adapter.js';

const STAMP = '2026-11-27T14:57:15-07:00';
const done = (extra = {}) => ({ id: 't1', title: 'Tick', completed: true, ...extra });
const open = (extra = {}) => ({ id: 't1', title: 'Tick', completed: false, ...extra });

describe('carriedCompletedAt', () => {
  it('a done winner without a stamp takes a done copy\'s', () => {
    expect(carriedCompletedAt(done(), done({ completedAt: STAMP }))).toBe(STAMP);
    expect(carriedCompletedAt(done({ completedAt: null }), done({ completedAt: STAMP }))).toBe(STAMP);
    expect(carriedCompletedAt(done(), undefined, done({ completedAt: STAMP }))).toBe(STAMP);
  });

  it('never replaces the winner\'s own stamp', () => {
    expect(carriedCompletedAt(done({ completedAt: 'X' }), done({ completedAt: STAMP }))).toBe('X');
  });

  it('carries nothing onto an open winner, nor from an open copy', () => {
    expect(carriedCompletedAt(open({ completedAt: null }), done({ completedAt: STAMP }))).toBeNull();
    expect(carriedCompletedAt(done(), open({ completedAt: STAMP }))).toBeUndefined();
  });

  it('gives the stamp whichever copy wins, and again changes nothing', () => {
    const a = done({ completedAt: STAMP });
    const b = done();
    expect(carriedCompletedAt(a, b)).toBe(STAMP);
    expect(carriedCompletedAt(b, a)).toBe(STAMP);
    const once = { ...b, completedAt: carriedCompletedAt(b, a) };
    expect(carriedCompletedAt(once, a)).toBe(STAMP);
  });
});

describe('the vault apply', () => {
  const pull = (data, value) => applyRemoteEntity(data, { entityId: makeEntityId('unscheduledTasks', 't1'), _kind: 'unscheduledTasks', value });

  it('a newer done copy without a stamp keeps the local stamp and is re-pushed', () => {
    const data = { unscheduledTasks: [done({ completedAt: STAMP, lastModified: '2026-11-27T21:57:15.000Z' })] };
    const repush = pull(data, done({ lastModified: '2026-11-27T21:57:21.154Z' }));
    expect(data.unscheduledTasks[0]).toMatchObject({ completedAt: STAMP, lastModified: '2026-11-27T21:57:21.154Z' });
    expect(repush).toEqual([makeEntityId('unscheduledTasks', 't1')]);
  });

  it('a reopen wins with no stamp carried, and nothing is re-pushed', () => {
    const data = { unscheduledTasks: [done({ completedAt: STAMP, lastModified: '2026-11-27T21:57:15.000Z' })] };
    const repush = pull(data, open({ completedAt: null, lastModified: '2026-11-27T22:00:00.000Z' }));
    expect(data.unscheduledTasks[0]).toMatchObject({ completed: false, completedAt: null });
    expect(repush).toEqual([]);
  });
});
