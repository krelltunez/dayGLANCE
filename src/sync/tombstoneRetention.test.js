import { describe, it, expect } from 'vitest';
import {
  TOMBSTONE_RETENTION_DAYS,
  TOMBSTONE_BUNDLE_KEYS,
  tombstoneCutoff,
  pruneTombstoneMap,
  unionNewerIso,
  pruneAllTombstones,
} from './tombstoneRetention.js';
import { applyRemoteEntity, SINGLETON_KIND, TOMBSTONE_BUNDLES } from './dbAdapter.js';

const DAY = 86400000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

describe('tombstoneRetention — policy constants', () => {
  it('retention is fixed at 60 days', () => {
    expect(TOMBSTONE_RETENTION_DAYS).toBe(60);
  });

  it('the canonical key list matches dbAdapter TOMBSTONE_BUNDLES exactly', () => {
    expect(new Set(TOMBSTONE_BUNDLE_KEYS)).toEqual(TOMBSTONE_BUNDLES);
  });
});

describe('tombstoneCutoff', () => {
  it('is day-floored ~60 days ago (stable across a day → no per-cycle diff)', () => {
    const cut = tombstoneCutoff(Date.parse('2026-07-06T18:25:50.000Z'));
    expect(cut.toISOString()).toBe('2026-05-07T00:00:00.000Z'); // 60 days before, floored to UTC day
  });

  it('yields the same value for any two moments in the same UTC day', () => {
    const morning = tombstoneCutoff(Date.parse('2026-07-06T00:00:01.000Z')).getTime();
    const night = tombstoneCutoff(Date.parse('2026-07-06T23:59:59.000Z')).getTime();
    expect(morning).toBe(night);
  });
});

describe('pruneTombstoneMap', () => {
  const cut = tombstoneCutoff();

  it('drops entries older than the cutoff, keeps newer ones', () => {
    const out = pruneTombstoneMap({ old: daysAgo(70), recent: daysAgo(10) }, cut);
    expect(out).toEqual({ recent: expect.any(String) });
  });

  it('keeps the boundary case just inside 60 days', () => {
    const out = pruneTombstoneMap({ inside: daysAgo(59) }, cut);
    expect(out.inside).toBeDefined();
  });

  it('keeps unparseable timestamps (fail-safe: never lose an undateable tombstone)', () => {
    const out = pruneTombstoneMap({ junk: 'not-a-date' }, cut);
    expect(out.junk).toBe('not-a-date');
  });

  it('with no cutoff returns a copy unchanged', () => {
    const src = { a: daysAgo(999) };
    const out = pruneTombstoneMap(src, null);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
  });
});

describe('unionNewerIso', () => {
  it('keeps the newer timestamp per id', () => {
    const older = daysAgo(10);
    const newer = daysAgo(2);
    const a = { x: older, y: daysAgo(5) };
    const b = { x: newer, z: daysAgo(1) };
    const out = unionNewerIso(a, b);
    expect(out.x).toBe(newer); // b's x is newer than a's x
    expect(out.y).toBe(a.y);
    expect(out.z).toBe(b.z);
  });
});

describe('pruneAllTombstones', () => {
  it('prunes every bundle in place and reports change', () => {
    const data = {
      deletedTaskIds: { old: daysAgo(70), keep: daysAgo(1) },
      deletedGoalIds: { keep: daysAgo(3) },
    };
    const changed = pruneAllTombstones(data, tombstoneCutoff());
    expect(changed).toBe(true);
    expect(data.deletedTaskIds).toEqual({ keep: expect.any(String) });
    expect(data.deletedGoalIds).toEqual({ keep: expect.any(String) });
  });

  it('reports NO change when nothing crosses the window (steady state)', () => {
    const data = { deletedTaskIds: { a: daysAgo(10), b: daysAgo(50) } };
    const before = JSON.stringify(data);
    const changed = pruneAllTombstones(data, tombstoneCutoff());
    expect(changed).toBe(false);
    expect(JSON.stringify(data)).toBe(before);
  });

  it('never fabricates an absent bundle', () => {
    const data = { tasks: [] };
    pruneAllTombstones(data, tombstoneCutoff());
    expect('deletedTaskIds' in data).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The heartbeat-loop regression, at the vault tier. The DB engine merges a pulled
// tombstone bundle with a GROW-ONLY union (dbAdapter mergeBundle → unionNewerIso),
// so a peer still holding an ancient tombstone re-injects it every pull. dbEngine's
// dbSyncCycle then prunes the mirror at the fixed 60-day window. This pair must
// return the bundle to its pre-cycle set so the snapshot-diff sees NO change → no
// push → no SSE self-nudge loop. (dbSyncCycle itself needs the full crypto engine;
// here we drive the exact two operations it composes: pull-union then prune.)
// ─────────────────────────────────────────────────────────────────────────────
describe('vault cycle — grow-union pull + 60-day prune is a stable no-op', () => {
  const singleton = (value) => ({ _kind: SINGLETON_KIND, _key: 'deletedTaskIds', value });

  it('drops an ancient tombstone a peer re-injects, converging to the steady set', () => {
    const steady = { a: daysAgo(10), b: daysAgo(50) };
    const mirror = { deletedTaskIds: { ...steady } };

    // Peer (old/grow-only device) pushes its bundle including a 70-day tombstone.
    applyRemoteEntity(mirror, singleton({ ...steady, ancient: daysAgo(70) }));
    expect(mirror.deletedTaskIds.ancient).toBeDefined(); // grow-union re-added it

    // dbEngine's end-of-cycle prune ages it back out.
    pruneAllTombstones(mirror, tombstoneCutoff());
    expect(mirror.deletedTaskIds).toEqual(steady); // identical → not dirty → no push
  });

  it('is idempotent across repeated cycles (no oscillation)', () => {
    const steady = { a: daysAgo(10), b: daysAgo(50) };
    const mirror = { deletedTaskIds: { ...steady } };
    const peerBundle = { ...steady, ancient: daysAgo(70) };

    for (let cycle = 0; cycle < 5; cycle++) {
      applyRemoteEntity(mirror, singleton(peerBundle));
      pruneAllTombstones(mirror, tombstoneCutoff());
      expect(mirror.deletedTaskIds).toEqual(steady);
    }
  });

  it('still propagates a fresh in-window tombstone a peer introduces', () => {
    const mirror = { deletedTaskIds: { a: daysAgo(10) } };
    applyRemoteEntity(mirror, singleton({ a: daysAgo(10), fresh: daysAgo(5) }));
    pruneAllTombstones(mirror, tombstoneCutoff());
    expect(mirror.deletedTaskIds.fresh).toBeDefined();
  });
});
