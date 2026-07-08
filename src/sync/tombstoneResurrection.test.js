import { describe, it, expect } from 'vitest';
import { createVault, createDevice, syncToConvergence } from './dbVaultSim.js';
import { makeEntityId, SINGLETON_KIND } from './dbAdapter.js';
import { pruneAllTombstones, tombstoneCutoff } from './tombstoneRetention.js';
import { mergeSyncData } from '../mergeSync.js';

// ─────────────────────────────────────────────────────────────────────────────
// RESURRECTION SAFETY for the fixed-60-day tombstone GC.
//
// Closes the gap called out in the fix justification: a dedicated test that
// couples "tombstone pruned at the 60-day window" with "a deletion still
// propagates and the item does NOT come back". Two independent suppressors are
// exercised:
//   • VAULT tier — the entity DELETE ROW (applyRemoteDelete), seq-ordered in the
//     vault log; the deletedTaskIds singleton is NOT consulted here.
//   • FILE tier — the deletedTaskIds tombstone (merge.js mergeArrayById), which
//     drops a stale live re-push whose lastModified predates the deletion.
// The fix RETAINS the tombstone for 60 days on both tiers, so both suppressors
// keep working; it only GCs entries older than 60 days.
// ─────────────────────────────────────────────────────────────────────────────

const DAY = 86400000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

const EMPTY = {
  tasks: [], unscheduledTasks: [], recurringTasks: [], recycleBin: [], todayRoutines: [],
  habits: [], goals: [], projects: [], gtdFrames: [], users: [], dailyNotes: {},
  deletedTaskIds: {},
};

const TASK_X = { id: 'X', title: 'buy milk', lastModified: daysAgo(80) };

function seededPair(base) {
  const vault = createVault();
  const a = createDevice('A', base);
  const b = createDevice('B', base);
  // Seed: mark A's whole state dirty and converge so both + the vault share it.
  a.mutate((d) => [
    ...d.tasks.map((t) => makeEntityId('tasks', t.id)),
    makeEntityId(SINGLETON_KIND, 'deletedTaskIds'),
  ]);
  syncToConvergence(a, b, vault);
  return { vault, a, b };
}

// Delete X on a device: drop the row + record the tombstone, marking both dirty.
function deleteX(dev, whenIso) {
  dev.mutate((d) => {
    d.tasks = d.tasks.filter((t) => t.id !== 'X');
    d.deletedTaskIds = { ...d.deletedTaskIds, X: whenIso };
    return [makeEntityId('tasks', 'X'), makeEntityId(SINGLETON_KIND, 'deletedTaskIds')];
  });
}

describe('tombstone GC — deletion propagates and survives the 60-day prune', () => {
  it('deletes on A → B sees it gone (deletion still propagates)', () => {
    const { vault, a, b } = seededPair({ ...EMPTY, tasks: [TASK_X] });
    expect(b.data.tasks.find((t) => t.id === 'X')).toBeTruthy(); // both start with X

    deleteX(a, daysAgo(0));
    syncToConvergence(a, b, vault);

    expect(a.data.tasks.find((t) => t.id === 'X')).toBeUndefined();
    expect(b.data.tasks.find((t) => t.id === 'X')).toBeUndefined();
  });

  it('a FRESH tombstone is retained by the 60-day prune (not GCd), item stays gone', () => {
    const { vault, a, b } = seededPair({ ...EMPTY, tasks: [TASK_X] });
    deleteX(a, daysAgo(0));
    syncToConvergence(a, b, vault);

    // The 60-day GC the DB engine runs each cycle — here applied directly.
    pruneAllTombstones(a.data, tombstoneCutoff());
    pruneAllTombstones(b.data, tombstoneCutoff());

    expect(a.data.deletedTaskIds.X).toBeDefined(); // 0 days old → kept
    expect(b.data.deletedTaskIds.X).toBeDefined();
    expect(b.data.tasks.find((t) => t.id === 'X')).toBeUndefined();
  });

  it('in a CONVERGED fleet, GCing an ancient (>60d) tombstone does not resurrect X (no live copy exists)', () => {
    const { vault, a, b } = seededPair({ ...EMPTY, tasks: [TASK_X] });
    deleteX(a, daysAgo(80));
    syncToConvergence(a, b, vault);

    // Age both tombstones past the window and GC them.
    a.data.deletedTaskIds = { X: daysAgo(80) };
    b.data.deletedTaskIds = { X: daysAgo(80) };
    pruneAllTombstones(a.data, tombstoneCutoff());
    expect(a.data.deletedTaskIds.X).toBeUndefined(); // GCd
    pruneAllTombstones(b.data, tombstoneCutoff());

    syncToConvergence(a, b, vault);
    // No device holds a live X, so nothing can push it back.
    expect(a.data.tasks.find((t) => t.id === 'X')).toBeUndefined();
    expect(b.data.tasks.find((t) => t.id === 'X')).toBeUndefined();
  });
});

describe('tombstone GC — the retained tombstone suppresses a stale live re-push (file tier)', () => {
  it('a stale device re-pushing live X is dropped by the retained tombstone (merge.js:67)', () => {
    // Local device: deleted X, tombstone fresh (well inside 60 days).
    const local = { ...EMPTY, tasks: [], deletedTaskIds: { X: daysAgo(1) } };
    // Stale device re-pushes X live with its ORIGINAL (pre-deletion) lastModified.
    const remoteStale = { ...EMPTY, tasks: [TASK_X], deletedTaskIds: {} };

    const { data } = mergeSyncData(local, remoteStale, 30);
    // Tombstone (1 day old) is newer than X.lastModified (80 days old) → X suppressed.
    expect(data.tasks.find((t) => t.id === 'X')).toBeUndefined();
    // And the fix kept the tombstone available to do the suppressing.
    expect(data.deletedTaskIds.X).toBeDefined();
  });

  it('DISCRIMINATOR: without the tombstone, the same stale re-push WOULD resurrect X', () => {
    // Proves the previous test passes because of the tombstone, not by accident.
    const localNoTombstone = { ...EMPTY, tasks: [], deletedTaskIds: {} };
    const remoteStale = { ...EMPTY, tasks: [TASK_X], deletedTaskIds: {} };
    const { data } = mergeSyncData(localNoTombstone, remoteStale, 30);
    // No tombstone and no fence (no tombstonePrunedBefore) → X comes back.
    expect(data.tasks.find((t) => t.id === 'X')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The HONEST 60-day boundary (documents behavior the fix does NOT change).
//
// The resurrection FENCE (merge.js:88, from remote.tombstonePrunedBefore) sits in
// the FIRST pass only — it guards LOCAL-only zombies (a stale device PULLING).
// It does NOT guard a REMOTE-only stale re-push (a stale device PUSHING X back):
// the second pass (merge.js:97-107) suppresses that solely via the tombstone. So:
//   • ≤60 days: tombstone retained → stale push suppressed (proven above).
//   • >60 days: tombstone GCd → a stale PUSH resurrects; a stale PULL is still
//     caught by the fence. This is the accepted finite-retention tradeoff; the fix
//     LENGTHENS the protected window from ~30 to 60 days, it does not remove the
//     >60-day boundary.
// ─────────────────────────────────────────────────────────────────────────────
describe('tombstone GC — the >60-day boundary is real (unchanged by the fix)', () => {
  it('the FENCE catches a LOCAL-only stale zombie even with no tombstone (pull direction)', () => {
    const localStale = { ...EMPTY, tasks: [TASK_X], deletedTaskIds: {} };
    const remoteUpToDate = { ...EMPTY, tasks: [], deletedTaskIds: {}, tombstonePrunedBefore: daysAgo(30) };
    const { data } = mergeSyncData(localStale, remoteUpToDate, 30);
    // X (80d old) is local-only and older than the 30d fence → dropped as zombie.
    expect(data.tasks.find((t) => t.id === 'X')).toBeUndefined();
  });

  it('the fence does NOT catch a REMOTE-only stale re-push once the tombstone is GCd (push direction)', () => {
    const local = { ...EMPTY, tasks: [], deletedTaskIds: {}, tombstonePrunedBefore: daysAgo(30) };
    const remoteStale = { ...EMPTY, tasks: [TASK_X], deletedTaskIds: {}, tombstonePrunedBefore: daysAgo(30) };
    const { data } = mergeSyncData(local, remoteStale, 30);
    // No tombstone (GCd) and no fence in the second pass → X resurrects. This is
    // the >60-day exposure the fix bounds but does not eliminate.
    expect(data.tasks.find((t) => t.id === 'X')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FENCE REWORK safety, derived from the requirement (NOT retrofitted to output).
//
// The fence a peer now emits is the PRODUCED value tombstoneCutoff().toISOString()
// (App.jsx buildSyncPayload / dbAdapter / mergeSync — all the same call), i.e.
// today-60. merge.js:88 drops a LOCAL-only item strictly older than that fence.
// The rework is safe iff the fence draws the zombie/live line at EXACTLY the
// 60-day tombstone-GC window, in BOTH directions:
//   • UP  (no resurrection):   a local-only item older than 60d whose tombstone
//                              has been GC'd is dropped, not re-uploaded.
//   • DOWN (no data loss):     a genuinely recent local-only item — a real edit on
//                              a device that was merely offline — is NOT dropped.
// The DOWN direction is the one that broke two days ago (PR #1142 churn / the
// fear of eating live data); it is asserted here against the real produced fence.
// ─────────────────────────────────────────────────────────────────────────────
describe('fence rework — the PRODUCED today-60 fence is safe in both directions', () => {
  const producedFence = () => tombstoneCutoff().toISOString();

  it('UP: drops a local-only zombie older than 60 days (deleted-and-pruned stays gone)', () => {
    // Deleted >60d ago on a peer, tombstone since GC'd; this stale device still holds
    // X live. The produced fence must suppress it rather than resurrect it.
    const localStale = { ...EMPTY, tasks: [{ id: 'X', title: 'buy milk', lastModified: daysAgo(75) }], deletedTaskIds: {} };
    const remoteUpToDate = { ...EMPTY, tasks: [], deletedTaskIds: {}, tombstonePrunedBefore: producedFence() };
    const { data } = mergeSyncData(localStale, remoteUpToDate, 30);
    expect(data.tasks.find((t) => t.id === 'X')).toBeUndefined(); // 75d > 60d → dropped
  });

  it('DOWN: KEEPS a genuinely recent local-only item (an offline edit is not eaten)', () => {
    // A real task created on a device that was simply offline for a bit — never
    // deleted, no tombstone. It must survive the fence, or the fix loses live data.
    const recent = { id: 'R', title: 'new idea', lastModified: daysAgo(10) };
    const localOffline = { ...EMPTY, tasks: [recent], deletedTaskIds: {} };
    const remoteUpToDate = { ...EMPTY, tasks: [], deletedTaskIds: {}, tombstonePrunedBefore: producedFence() };
    const { data } = mergeSyncData(localOffline, remoteUpToDate, 30);
    expect(data.tasks.find((t) => t.id === 'R')).toBeTruthy(); // 10d < 60d → preserved
  });

  it('the zombie/live boundary is 60 days, INDEPENDENT of syncRetentionDays', () => {
    // The whole point of the rework: retention no longer moves the fence. A 30d and
    // a 90d device both draw the line at the identical 60-day point. (Floored
    // cutoff ∈ [now-61d, now-60d], so 59d is always kept and 61d always dropped,
    // regardless of the time of day the test runs.)
    const keep = { id: 'A', title: 'keep', lastModified: daysAgo(59) };
    const drop = { id: 'B', title: 'drop', lastModified: daysAgo(61) };
    for (const retention of [30, 90]) {
      const local = { ...EMPTY, tasks: [keep, drop], deletedTaskIds: {} };
      const remote = { ...EMPTY, tasks: [], deletedTaskIds: {}, tombstonePrunedBefore: producedFence() };
      const { data } = mergeSyncData(local, remote, retention);
      expect(data.tasks.find((t) => t.id === 'A')).toBeTruthy();    // 59d < 60d → kept
      expect(data.tasks.find((t) => t.id === 'B')).toBeUndefined(); // 61d > 60d → dropped
    }
  });
});
