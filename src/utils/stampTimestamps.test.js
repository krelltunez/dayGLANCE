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

  // ── Regression: cold-open re-stamp on `archived` (day-planner-unscheduled) ───
  // Same class as the tombstonePrunedBefore false-diff: a never-archived task has
  // no `archived` key in storage, but in-memory it carries `archived: false` (from
  // an unarchive elsewhere or a merge). Absent ≡ false, so the stamper must treat
  // them as equal and NOT fabricate a new lastModified on every cold-open.
  it('does NOT re-stamp when storage lacks `archived` but memory has archived:false', () => {
    const stored = [{ id: 1, title: 'Inbox item', completed: false, lastModified: ISO(100) }];
    const inMemory = [{ id: 1, title: 'Inbox item', completed: false, notes: '', subtasks: [], archived: false, lastModified: ISO(100) }];
    const out = stampTimestamps(inMemory, stored, ISO(0));
    expect(out[0].lastModified).toBe(stored[0].lastModified); // stable — no false-diff
  });

  it('does NOT re-stamp the reverse: storage has archived:false, memory omits it', () => {
    const stored = [{ id: 1, title: 'Inbox item', archived: false, lastModified: ISO(100) }];
    const inMemory = [{ id: 1, title: 'Inbox item', lastModified: ISO(100) }];
    expect(stampTimestamps(inMemory, stored, ISO(0))[0].lastModified).toBe(stored[0].lastModified);
  });

  it('round-trips: store→load leaves archived:false stable across repeated saves (no drift)', () => {
    // Cold-open cycle: state carries archived:false; storage was written without it
    // (older data). First save must not re-stamp, and the item stays stable on the
    // next cycle too (idempotent — never dirties).
    const t0 = ISO(100);
    let stored = [{ id: 1, title: 'Item', completed: false, lastModified: t0 }];
    const inMemory = [{ id: 1, title: 'Item', completed: false, notes: '', subtasks: [], archived: false, lastModified: t0 }];
    for (let cycle = 0; cycle < 3; cycle++) {
      const out = stampTimestamps(inMemory, stored, ISO(0));
      expect(out[0].lastModified).toBe(t0); // never fabricated
      stored = out; // persist and re-load next cycle
    }
  });

  it('a REAL archive still re-stamps (archived:true vs absent is a genuine change)', () => {
    const stored = [{ id: 1, title: 'Item', lastModified: ISO(100) }];
    const inMemory = [{ id: 1, title: 'Item', archived: true, lastModified: ISO(100) }];
    expect(stampTimestamps(inMemory, stored, 'NOW')[0].lastModified).toBe('NOW');
  });

  // ── Round-trip: an archived:true inbox item stays archived and does NOT
  // false-diff once the store also holds archived:true. This is the day-planner-
  // unscheduled store→load→payload path an archived task takes every cycle: the
  // load normalize adds notes/subtasks defaults, the stamper compares, and the
  // item must round-trip byte-identical (archived kept, lastModified stable) so it
  // never re-pushes on an unchanged cycle. Guards against a regression that would
  // strip archived on this path.
  it('round-trips archived:true store→load→save with NO false-diff across cycles', () => {
    const t0 = ISO(100);
    // Store already carries archived:true (written by a prior save).
    let stored = [{ id: 1, title: 'Archived inbox', completed: true, archived: true, lastModified: t0 }];
    for (let cycle = 0; cycle < 3; cycle++) {
      // loadData adds notes/subtasks defaults into in-memory state (App normalize).
      const inMemory = stored.map(t => ({ ...t, notes: t.notes ?? '', subtasks: t.subtasks ?? [] }));
      const out = stampTimestamps(inMemory, stored, ISO(0));
      expect(out[0].archived).toBe(true);          // archived survives the round-trip
      expect(out[0].lastModified).toBe(t0);         // no fabricated timestamp → no re-push
      stored = out;                                 // persist + reload next cycle
    }
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
      // archived absent-vs-false (the cold-open re-stamp we fixed — must stay silent)
      stampTimestamps([{ id: 4, title: 'D', archived: false, lastModified: ISO(100) }], [{ id: 4, title: 'D', lastModified: ISO(100) }], 'NOW', onRestamp);
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
