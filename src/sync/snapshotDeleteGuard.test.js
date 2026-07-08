import { describe, it, expect } from 'vitest';
import { partitionSnapshotDeletes } from './snapshotDeleteGuard.js';

// cur is snapshotShred output: { entityId -> hash }. Only the KEYS matter here.
const curOf = (...entityIds) => Object.fromEntries(entityIds.map((e) => [e, '#']));

describe('partitionSnapshotDeletes', () => {
  it('SKIPS an un-tombstoned vanish — the glitch-shrink (no fleet-wide deletion)', () => {
    // tasks:X was in the snapshot, is gone from getData(), has no tombstone, and its
    // id appears nowhere else. That is a local-state glitch, not a deletion → keep it.
    const { propagate, skipped } = partitionSnapshotDeletes(['tasks:X'], curOf(), {});
    expect(propagate).toEqual([]);
    expect(skipped).toEqual(['tasks:X']);
  });

  it('PROPAGATES a tombstoned delete — a real permanent deletion still works', () => {
    const mirror = { deletedTaskIds: { X: '2026-07-08T00:00:00.000Z' } };
    const { propagate, skipped } = partitionSnapshotDeletes(['tasks:X'], curOf(), mirror);
    expect(propagate).toEqual(['tasks:X']);
    expect(skipped).toEqual([]);
  });

  it('PROPAGATES a cross-list move — task → recycle bin keeps the id under recycleBin', () => {
    // tasks:X is gone but recycleBin:X is present: the id survived under another kind,
    // so the old-kind row must be deleted. Not a glitch.
    const { propagate, skipped } = partitionSnapshotDeletes(['tasks:X'], curOf('recycleBin:X'), {});
    expect(propagate).toEqual(['tasks:X']);
    expect(skipped).toEqual([]);
  });

  it('honors tombstones across all bundle kinds (frames, goals, projects, areas, …)', () => {
    const mirror = {
      deletedFrameIds: { f1: 't' },
      deletedGoalIds: { g1: 't' },
      deletedProjectIds: { p1: 't' },
      deletedAreaIds: { a1: 't' },
      deletedObsidianKeys: { '2026-04-27': 't' },
    };
    const del = ['gtdFrames:f1', 'goals:g1', 'projects:p1', 'areas:a1', 'tasks:2026-04-27'];
    const { propagate, skipped } = partitionSnapshotDeletes(del, curOf(), mirror);
    expect(propagate.sort()).toEqual(del.sort());
    expect(skipped).toEqual([]);
  });

  it('THE WAR: a 160-task glitch-shrink is fully skipped (none tombstoned, none moved)', () => {
    // Reproduces the observed incident: a device diverged to a smaller set and the
    // diff wanted to delete ~160 live, un-deleted tasks. All are kept.
    const del = [];
    for (let i = 0; i < 67; i++) del.push(`tasks:t${i}`);
    for (let i = 0; i < 93; i++) del.push(`unscheduledTasks:u${i}`);
    const { propagate, skipped } = partitionSnapshotDeletes(del, curOf(), { deletedTaskIds: {} });
    expect(propagate).toEqual([]);
    expect(skipped).toHaveLength(160);
  });

  it('MIXED: keeps glitch vanishes, propagates the genuinely-deleted and moved ones', () => {
    const mirror = { deletedTaskIds: { real: 't' } };
    const cur = curOf('recycleBin:moved'); // "moved" survives in the bin
    const del = ['tasks:real', 'tasks:moved', 'tasks:glitch1', 'tasks:glitch2'];
    const { propagate, skipped } = partitionSnapshotDeletes(del, cur, mirror);
    expect(propagate.sort()).toEqual(['tasks:moved', 'tasks:real']);
    expect(skipped.sort()).toEqual(['tasks:glitch1', 'tasks:glitch2']);
  });

  it('tolerates empty / missing inputs', () => {
    expect(partitionSnapshotDeletes([], {}, {})).toEqual({ propagate: [], skipped: [] });
    expect(partitionSnapshotDeletes(null, null, null)).toEqual({ propagate: [], skipped: [] });
  });
});
