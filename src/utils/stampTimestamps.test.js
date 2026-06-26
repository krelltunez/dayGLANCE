import { describe, it, expect } from 'vitest';
import { stampTimestamps } from './stampTimestamps.js';
import { mergeTaskArrays } from '../mergeSync.js';

const ISO = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();

describe('stampTimestamps', () => {
  it('stamps a genuinely new task (no prior, no lastModified)', () => {
    const out = stampTimestamps([{ id: 1, title: 'New' }], [], 'NOW');
    expect(out[0].lastModified).toBe('NOW');
  });

  it('preserves lastModified for an unchanged task', () => {
    const prev = [{ id: 1, title: 'A', completed: false, lastModified: ISO(100) }];
    const curr = [{ id: 1, title: 'A', completed: false, lastModified: ISO(100) }];
    expect(stampTimestamps(curr, prev, 'NOW')[0].lastModified).toBe(prev[0].lastModified);
  });

  it('stamps a genuinely changed task (user edited the title)', () => {
    const prev = [{ id: 1, title: 'A', lastModified: ISO(100) }];
    const curr = [{ id: 1, title: 'A edited', lastModified: ISO(100) }];
    expect(stampTimestamps(curr, prev, 'NOW')[0].lastModified).toBe('NOW');
  });

  it('preserves an incoming lastModified for a task new to storage (no re-stamp)', () => {
    const curr = [{ id: 1, title: 'FromCloud', lastModified: ISO(50) }];
    expect(stampTimestamps(curr, [], 'NOW')[0].lastModified).toBe(curr[0].lastModified);
  });

  // ── Regression: the iCloud zombie-resurrection root cause ──────────────────
  // A stale device holds a still-incomplete task. The stored copy lacks default
  // fields (notes/subtasks) that load/merge default into in-memory state. The
  // ONLY difference is that passive normalization — the user did not touch the
  // task. The stamper must NOT bump lastModified, otherwise the fabricated "now"
  // beats a real completion made on another device and the task resurrects.
  it('does NOT re-stamp when the only diff is passive default normalization', () => {
    const stored = [{ id: 1, title: 'Pay rent', completed: false, lastModified: ISO(100) }];
    const inMemory = [{ id: 1, title: 'Pay rent', completed: false, notes: '', subtasks: [], lastModified: ISO(100) }];
    const out = stampTimestamps(inMemory, stored, ISO(0));
    expect(out[0].lastModified).toBe(stored[0].lastModified); // NOT ISO(0)
  });

  describe('onRestamp diagnostic', () => {
    it('reports the changed fields when an existing task is re-stamped', () => {
      const prev = [{ id: 1, title: 'A', completed: false, lastModified: ISO(100) }];
      const curr = [{ id: 1, title: 'A', completed: true, lastModified: ISO(100) }];
      const calls = [];
      stampTimestamps(curr, prev, 'NOW', (info) => calls.push(info));
      expect(calls).toEqual([{ id: 1, changedKeys: ['completed'] }]);
    });

    it('does NOT fire for unchanged tasks, default-only diffs, or new tasks', () => {
      const calls = [];
      const onRestamp = (info) => calls.push(info);
      // unchanged
      stampTimestamps([{ id: 1, title: 'A', lastModified: ISO(100) }], [{ id: 1, title: 'A', lastModified: ISO(100) }], 'NOW', onRestamp);
      // default-only diff (the resurrection vector — must stay silent)
      stampTimestamps([{ id: 2, title: 'B', notes: '', subtasks: [], lastModified: ISO(100) }], [{ id: 2, title: 'B', lastModified: ISO(100) }], 'NOW', onRestamp);
      // new task
      stampTimestamps([{ id: 3, title: 'C' }], [], 'NOW', onRestamp);
      expect(calls).toEqual([]);
    });
  });

  it('a completion made elsewhere survives a stale device sync (end-to-end)', () => {
    // Device B (online) completed the task 30 min ago, bumping its lastModified.
    const remoteCompleted = [{ id: 1, title: 'Pay rent', completed: true, completedAt: '2026-06-26', lastModified: ISO(30) }];

    // Stale device A: stored copy is old/incomplete; in-memory copy is the same
    // task with default fields normalized in (no real user edit).
    const storedStale = [{ id: 1, title: 'Pay rent', completed: false, lastModified: ISO(100) }];
    const inMemoryStale = [{ id: 1, title: 'Pay rent', completed: false, notes: '', subtasks: [], lastModified: ISO(100) }];

    // Device A builds its sync payload (stamps), then merges the remote in.
    const stampedLocal = stampTimestamps(inMemoryStale, storedStale, ISO(0));
    const { merged } = mergeTaskArrays(stampedLocal, remoteCompleted, {});

    // The completion must win — the stale incomplete copy must not resurrect it.
    expect(merged).toHaveLength(1);
    expect(merged[0].completed).toBe(true);
  });
});
