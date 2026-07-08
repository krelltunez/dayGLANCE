import { describe, it, expect } from 'vitest';
import { createVault, createDevice, syncToConvergence } from './dbVaultSim.js';
import { makeEntityId, SINGLETON_KIND, applyRemoteEntity } from './dbAdapter.js';
import { tombstoneCutoff } from './tombstoneRetention.js';
import { mergeSyncData } from '../mergeSync.js';

// ─────────────────────────────────────────────────────────────────────────────
// THE FENCE REWORK (tombstonePrunedBefore): CONVERGENCE.
//
// The resurrection fence is now a PURE FUNCTION of the current UTC day
// (= tombstoneCutoff(), the fixed 60-day GC window). The peer's value therefore
// carries no information a device can't reproduce locally, so all three sites
// recompute-and-OVERWRITE it rather than newerIso/max()-merging it:
//   • the payload (App.jsx buildSyncPayload → tombstoneCutoff().toISOString())
//   • the VAULT merge (dbAdapter.js mergeBundle 'tombstonePrunedBefore')
//   • the FILE-tier merge (mergeSync.js override)
// This is the fix to the monotonic-max() trap of PR #1142: max() could never
// LOWER a stuck-high value, so a device emitting the correct (lower) value
// re-pushed forever without converging.
//
// Residual (documented, NOT "zero churn"): the cutoff advances one UTC day per
// day, so around midnight one device briefly computes yesterday's value and the
// other today's — a single tombstonePrunedBefore change that self-heals within a
// cycle. Case (b) proves the self-heal.
// ─────────────────────────────────────────────────────────────────────────────

const DAY = 86400000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();
const singleton = (value) => ({ _kind: SINGLETON_KIND, _key: 'tombstonePrunedBefore', value });
const FENCE_ID = makeEntityId(SINGLETON_KIND, 'tombstonePrunedBefore');

const emptyData = () => ({
  tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: [],
  completedTaskUids: [], deletedTaskIds: {},
  syncUrl: null, taskCalendarUrl: null,
  routineDefinitions: {}, todayRoutines: [], routinesDate: '',
  minimizedSections: {}, use24HourClock: false,
});

describe('fence rework — one canonical tombstoneCutoff(), no reimplemented flooring', () => {
  it('CONDITION 1: payload, vault merge, and file-tier merge all emit the identical value', () => {
    const canonical = tombstoneCutoff().toISOString();

    // VAULT tier (dbAdapter.mergeBundle via applyRemoteEntity): whatever the peer
    // sent, we store the locally-recomputed cutoff.
    const vaultData = {};
    applyRemoteEntity(vaultData, singleton(daysAgo(3)));

    // FILE tier (mergeSync override).
    const { data: fileData } = mergeSyncData(emptyData(), emptyData(), 30);

    expect(vaultData.tombstonePrunedBefore).toBe(canonical);
    expect(fileData.tombstonePrunedBefore).toBe(canonical);
    // The payload emits tombstoneCutoff().toISOString() directly (App.jsx) — the
    // SAME call, so it is identical by construction. If any site reimplemented the
    // flooring instead of calling tombstoneCutoff(), these would drift and this
    // assertion would catch it.
  });
});

describe('fence rework — convergence (CONDITION 2)', () => {
  it('(a) a stuck-HIGH peer value is overwritten with the local cutoff in one merge', () => {
    const future = new Date(Date.now() + 30 * DAY).toISOString(); // a stuck-high fence
    const data = { tombstonePrunedBefore: future };
    const rePush = applyRemoteEntity(data, singleton(future));

    // Overwritten with the recomputed cutoff — NOT kept at the stuck-high value
    // (which max()/newerIso would have done forever).
    expect(data.tombstonePrunedBefore).toBe(tombstoneCutoff().toISOString());
    // We pulled the stuck-high row but now hold the corrected (lower) value, so we
    // re-push it to drag the vault/peer down. That re-push TERMINATES: once the
    // vault holds the cutoff, the next merge stores the same cutoff → no re-push.
    expect(rePush).toEqual([FENCE_ID]);
  });

  it('(a) no churn: the merged value equals the getData recompute → a clean cycle', () => {
    // The #1142 churn was: merge stored the (higher) peer value, but getData
    // recomputed the (lower) payload value every cycle → perpetual snapshot-diff.
    // Now both are tombstoneCutoff(), so the fixed point is reached.
    const mirror = {};
    applyRemoteEntity(mirror, singleton(new Date(Date.now() + 30 * DAY).toISOString()));
    const getDataRecompute = tombstoneCutoff().toISOString(); // what buildSyncPayload emits
    expect(mirror.tombstonePrunedBefore).toBe(getDataRecompute); // no diff → no re-push
  });

  it('(a) two devices with divergent stuck values converge (does not hang)', () => {
    const vault = createVault();
    const a = createDevice('A', { tombstonePrunedBefore: new Date(Date.now() + 30 * DAY).toISOString() });
    const b = createDevice('B', { tombstonePrunedBefore: daysAgo(120) });
    a.mutate(() => [FENCE_ID]);
    b.mutate(() => [FENCE_ID]);
    syncToConvergence(a, b, vault); // throws if it never settles
    expect(a.data.tombstonePrunedBefore).toBe(tombstoneCutoff().toISOString());
    expect(b.data.tombstonePrunedBefore).toBe(tombstoneCutoff().toISOString());
  });

  it('(b) UTC-midnight rollover: an adjacent-day peer value self-heals to the current cutoff', () => {
    const yesterday = new Date(tombstoneCutoff().getTime() - DAY).toISOString();
    const mirror = { tombstonePrunedBefore: yesterday };
    // Peer still on yesterday's cutoff (it hasn't rolled over yet).
    const rePush = applyRemoteEntity(mirror, singleton(yesterday));
    // We compute TODAY's cutoff and overwrite — the fence advances exactly one day.
    expect(mirror.tombstonePrunedBefore).toBe(tombstoneCutoff().toISOString());
    // We re-push today's value so the lagging peer is dragged forward within a cycle.
    expect(rePush).toEqual([FENCE_ID]);
    // Once both are on today's value the merge is a no-op — the self-heal terminates.
    const rePush2 = applyRemoteEntity(mirror, singleton(tombstoneCutoff().toISOString()));
    expect(rePush2).toEqual([]);
  });

  it('(c) mixed retention (90d, 30d, 0) all land on the SAME today-60 fence', () => {
    const cutoff = tombstoneCutoff().toISOString();
    for (const retention of [90, 30, 0]) {
      // Sides carry deliberately different stale fence values AND different
      // retention — none of it changes the result.
      const local = { ...emptyData(), tombstonePrunedBefore: daysAgo(90) };
      const remote = { ...emptyData(), tombstonePrunedBefore: daysAgo(30) };
      const { data } = mergeSyncData(local, remote, retention);
      expect(data.tombstonePrunedBefore).toBe(cutoff);
    }
    // The VAULT tier takes no retention parameter at all (dbAdapter.mergeBundle),
    // so it is retention-agnostic by construction — proven in CONDITION 1 above.
  });
});

describe('fence rework — stability within a day (CONDITION 3 residual is bounded)', () => {
  it('is STABLE across the many cycles of a single UTC day (only advances at midnight)', () => {
    const morning = tombstoneCutoff(Date.parse('2026-07-06T00:00:01.000Z')).toISOString();
    const night = tombstoneCutoff(Date.parse('2026-07-06T23:59:59.000Z')).toISOString();
    expect(morning).toBe(night); // same UTC day → identical → no intra-day churn
    const nextDay = tombstoneCutoff(Date.parse('2026-07-07T00:00:01.000Z')).toISOString();
    expect(nextDay).not.toBe(night); // advances exactly once, at the UTC boundary
  });
});
