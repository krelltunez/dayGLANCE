import { describe, it, expect } from 'vitest';
import { partitionSnapshotDeletes, STALE_TOMBSTONE_EPSILON_MS } from './snapshotDeleteGuard.js';

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

  it('reports a reason per entityId (tombstoned / cross-list / glitch) for diagnostics', () => {
    const mirror = { deletedTaskIds: { real: 't' } };
    const cur = curOf('recycleBin:moved');
    const del = ['tasks:real', 'tasks:moved', 'tasks:glitch1'];
    const { reasons } = partitionSnapshotDeletes(del, cur, mirror);
    expect(reasons).toEqual({
      'tasks:real': 'tombstoned',
      'tasks:moved': 'cross-list',
      'tasks:glitch1': 'glitch',
    });
  });

  it('tolerates empty / missing inputs', () => {
    expect(partitionSnapshotDeletes([], {}, {})).toEqual({ propagate: [], skipped: [], excluded: [], reasons: {} });
    expect(partitionSnapshotDeletes(null, null, null)).toEqual({ propagate: [], skipped: [], excluded: [], reasons: {} });
  });
});

describe('partitionSnapshotDeletes — stale-tombstone rule (tombstone vs lastModified)', () => {
  const T = Date.parse('2026-07-08T12:00:00.000Z');
  const iso = (ms) => new Date(ms).toISOString();
  // getDeletedEntity stub: the wrapped copy being deleted, with a lastModified.
  const deletedTaskAt = (lastModifiedMs) => () =>
    ({ _kind: 'tasks', value: { id: 'X', title: 't', lastModified: iso(lastModifiedMs) } });

  it('SKIPS a stale tombstone: the deleted copy is newer by more than the epsilon (revived task)', () => {
    // Deleted long ago (lingering 60-day tombstone), then revived with a fresh
    // edit; a transient shrink drops the revived copy. The stale tombstone must
    // NOT bless the delete — this is the guard's core scenario.
    const mirror = { deletedTaskIds: { X: iso(T) } };
    const { propagate, skipped, reasons } = partitionSnapshotDeletes(
      ['tasks:X'], curOf(), mirror, deletedTaskAt(T + STALE_TOMBSTONE_EPSILON_MS + 1),
    );
    expect(propagate).toEqual([]);
    expect(skipped).toEqual(['tasks:X']);
    expect(reasons['tasks:X']).toBe('stale-tombstone'); // distinct from bare 'glitch'
  });

  it('PROPAGATES a real delete: tombstone newer than the deleted copy', () => {
    const mirror = { deletedTaskIds: { X: iso(T) } };
    const { propagate, skipped, reasons } = partitionSnapshotDeletes(
      ['tasks:X'], curOf(), mirror, deletedTaskAt(T - 60 * 60 * 1000),
    );
    expect(propagate).toEqual(['tasks:X']);
    expect(skipped).toEqual([]);
    expect(reasons['tasks:X']).toBe('tombstoned');
  });

  it('PROPAGATES within the epsilon: tombstone slightly BEFORE lastModified (same-operation stamping)', () => {
    // moveToRecycleBin stamps the bin copy's lastModified up to ~1s into the
    // future; an immediate empty-bin writes a tombstone up to ~1s older. That is
    // a REAL delete and must still propagate — a false-stale would resurrect it.
    const mirror = { deletedTaskIds: { X: iso(T) } };
    const { propagate, skipped } = partitionSnapshotDeletes(
      ['tasks:X'], curOf(), mirror, deletedTaskAt(T + STALE_TOMBSTONE_EPSILON_MS - 1000),
    );
    expect(propagate).toEqual(['tasks:X']);
    expect(skipped).toEqual([]);
  });

  it('FALLBACK: a deleted copy with no parseable lastModified → the tombstone authorizes', () => {
    const mirror = { deletedTaskIds: { X: iso(T) } };
    for (const getDeleted of [
      () => ({ _kind: 'tasks', value: { id: 'X', title: 'no ts' } }), // no lastModified
      () => ({ _kind: 'tasks', value: { id: 'X', lastModified: 'not-a-date' } }),
      () => null,           // copy not recoverable
      () => { throw new Error('boom'); }, // lookup failure
    ]) {
      const { propagate, skipped } = partitionSnapshotDeletes(['tasks:X'], curOf(), mirror, getDeleted);
      expect(propagate).toEqual(['tasks:X']);
      expect(skipped).toEqual([]);
    }
  });

  it('FALLBACK: an unparseable tombstone value → authorizes even a newer deleted copy', () => {
    // Some historical bundle values may not be ISO; we cannot call a tombstone
    // stale if we cannot date it (a false-stale resurrects a genuine delete).
    const mirror = { deletedTaskIds: { X: 'not-a-date' } };
    const { propagate, skipped, reasons } = partitionSnapshotDeletes(
      ['tasks:X'], curOf(), mirror, deletedTaskAt(T + 10 * 60 * 1000),
    );
    expect(propagate).toEqual(['tasks:X']);
    expect(skipped).toEqual([]);
    expect(reasons['tasks:X']).toBe('tombstoned');
  });

  it('FALLBACK: no getDeletedEntity lookup at all → pre-rule behavior (tombstone authorizes)', () => {
    const mirror = { deletedTaskIds: { X: iso(T) } };
    const { propagate } = partitionSnapshotDeletes(['tasks:X'], curOf(), mirror);
    expect(propagate).toEqual(['tasks:X']);
  });

  it('cross-list moves are unaffected: a stale tombstone + surviving copy under another kind still propagates', () => {
    const mirror = { deletedTaskIds: { X: iso(T) } };
    const { propagate, reasons } = partitionSnapshotDeletes(
      ['tasks:X'], curOf('recycleBin:X'), mirror, deletedTaskAt(T + 10 * 60 * 1000),
    );
    expect(propagate).toEqual(['tasks:X']);
    expect(reasons['tasks:X']).toBe('cross-list');
  });

  it('keeps the NEWEST tombstone per id across bundles (a re-delete re-stamps and wins)', () => {
    // Revived at T+1h, then genuinely re-deleted at T+2h: the newer tombstone
    // must authorize even though an older one lingers alongside.
    const mirror = { deletedTaskIds: { X: iso(T) }, deletedFrameIds: { X: iso(T + 2 * 60 * 60 * 1000) } };
    const { propagate, skipped } = partitionSnapshotDeletes(
      ['tasks:X'], curOf(), mirror, deletedTaskAt(T + 60 * 60 * 1000),
    );
    expect(propagate).toEqual(['tasks:X']);
    expect(skipped).toEqual([]);
  });
});

describe('payload-excluded classification (the fresh-device churn fix)', () => {
  const curOf = (...entityIds) => Object.fromEntries(entityIds.map((e) => [e, '#']));

  it('an un-tombstoned vanish whose copy is payload-excluded is RELEASED — not skipped, not healed', () => {
    const { propagate, skipped, excluded, reasons } = partitionSnapshotDeletes(
      ['tasks:X'], curOf(), {}, undefined, () => true,
    );
    expect(propagate).toEqual([]);
    expect(skipped).toEqual([]);
    expect(excluded).toEqual(['tasks:X']);
    expect(reasons['tasks:X']).toBe('payload-excluded');
  });

  it('a TOMBSTONED excluded row still propagates — real deletions always win', () => {
    const mirror = { deletedTaskIds: { X: '2026-07-08T00:00:00.000Z' } };
    const { propagate, excluded } = partitionSnapshotDeletes(
      ['tasks:X'], curOf(), mirror, undefined, () => true,
    );
    expect(propagate).toEqual(['tasks:X']);
    expect(excluded).toEqual([]);
  });

  it('a cross-list survivor still propagates even when excluded-class', () => {
    const { propagate, excluded } = partitionSnapshotDeletes(
      ['tasks:X'], curOf('recycleBin:X'), {}, undefined, () => true,
    );
    expect(propagate).toEqual(['tasks:X']);
    expect(excluded).toEqual([]);
  });

  it('non-excluded vanishes still classify as glitch; a THROWING predicate fails safe to glitch', () => {
    const notExcluded = partitionSnapshotDeletes(['tasks:X'], curOf(), {}, undefined, () => false);
    expect(notExcluded.skipped).toEqual(['tasks:X']);
    expect(notExcluded.excluded).toEqual([]);

    const throwing = partitionSnapshotDeletes(['tasks:X'], curOf(), {}, undefined, () => { throw new Error('boom'); });
    expect(throwing.skipped).toEqual(['tasks:X']);
    expect(throwing.excluded).toEqual([]);
  });

  it('BACK-COMPAT: without the predicate, behavior is unchanged and excluded is empty', () => {
    const res = partitionSnapshotDeletes(['tasks:X'], curOf(), {});
    expect(res.skipped).toEqual(['tasks:X']);
    expect(res.excluded).toEqual([]);
  });

  it('THE LOOP, classified: a 150-row legacy-excluded baseline is fully released — nothing left to heal', () => {
    // The field incident's shape: 150 legacy excluded-class rows in a fresh
    // device's baseline. All must land in `excluded` (released), leaving the
    // heal path — one HTTP GET per skipped row — with NOTHING to fetch.
    const del = [];
    for (let i = 0; i < 150; i++) del.push(`tasks:t${i}`);
    const { propagate, skipped, excluded } = partitionSnapshotDeletes(del, curOf(), {}, undefined, () => true);
    expect(propagate).toEqual([]);
    expect(skipped).toEqual([]);
    expect(excluded).toHaveLength(150);
  });

  it('carries a SPECIFIC reason string from the predicate (e.g. retention-aged) into reasons', () => {
    // The predicate may name WHY a row is released — the retention-aged branch
    // returns 'retention-aged' so diagnostics distinguish it from payload-excluded.
    const { excluded, reasons } = partitionSnapshotDeletes(
      ['unscheduledTasks:X'], curOf(), {}, undefined, () => 'retention-aged',
    );
    expect(excluded).toEqual(['unscheduledTasks:X']);
    expect(reasons['unscheduledTasks:X']).toBe('retention-aged');
  });

  it('an empty-string reason is falsy → keeps the glitch classification', () => {
    const { skipped, excluded, reasons } = partitionSnapshotDeletes(
      ['tasks:X'], curOf(), {}, undefined, () => '',
    );
    expect(excluded).toEqual([]);
    expect(skipped).toEqual(['tasks:X']);
    expect(reasons['tasks:X']).toBe('glitch');
  });
});
