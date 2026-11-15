import { describe, it, expect } from 'vitest';
import { writebackSnapshotEntry, hasUnwrittenChange } from './obsidianWritebackSnapshot.js';

// The writeback is held while a cycle runs. A change made during the cycle is
// still waiting when the cycle refreshes the snapshot for the tasks it
// observed; that refresh must not record the waiting change as written.

const task = (over = {}) => ({ id: 'o1', title: 'Call the plumber #obsidian', completed: false, duration: 30, ...over });

describe('hasUnwrittenChange', () => {
  it('is false while the snapshot agrees with the app\'s copy', () => {
    const t = task({ date: '2026-09-10', startTime: '14:00', duration: 90, projectId: 'p1' });
    expect(hasUnwrittenChange(writebackSnapshotEntry(t, null), t)).toBe(false);
    // Absent and null are one state, as the entry stores them.
    expect(hasUnwrittenChange({ completed: false, startTime: null, duration: 30, title: t.title, date: null, projectId: null }, task())).toBe(false);
  });

  it('is true for each thing the writeback writes: a schedule, a length, a completion, a title, a project', () => {
    const entry = writebackSnapshotEntry(task(), null);
    for (const change of [{ date: '2026-09-10' }, { startTime: '14:00' }, { duration: 90 }, { completed: true }, { title: 'Call the roofer #obsidian' }, { projectId: 'p1' }]) {
      expect(hasUnwrittenChange(entry, task(change)), JSON.stringify(change)).toBe(true);
    }
  });

  it('a line recorded with its own differing time counts as waiting, so the app\'s time is still written', () => {
    const t = task({ date: '2026-09-10', startTime: '14:00' });
    const entry = writebackSnapshotEntry(t, { o1: { startTime: '09:00' } });
    expect(hasUnwrittenChange(entry, t)).toBe(true);
  });

  it('is false with no entry or no app copy: a first observation is recorded as before', () => {
    expect(hasUnwrittenChange(undefined, task())).toBe(false);
    expect(hasUnwrittenChange(writebackSnapshotEntry(task(), null), undefined)).toBe(false);
  });
});
