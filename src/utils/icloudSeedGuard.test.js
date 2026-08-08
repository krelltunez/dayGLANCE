import { describe, it, expect } from 'vitest';
import {
  evaluateMissingSnapshot,
  MISSING_GRACE_MS,
  ICLOUD_LAST_SYNCED_KEY,
} from './icloudSeedGuard.js';

const T0 = 1_700_000_000_000;

describe('evaluateMissingSnapshot', () => {
  // Unchanged behaviour: a device that has never synced must still seed, or a
  // genuinely new container never gets created.
  it('seeds on a real first run', () => {
    expect(evaluateMissingSnapshot({ hasSyncedBefore: false, missingSince: 0, now: T0 }))
      .toEqual({ skip: false, missingSince: 0 });
  });

  it('seeds on first run even if a stale missing-streak is somehow carried in', () => {
    expect(evaluateMissingSnapshot({ hasSyncedBefore: false, missingSince: T0 - 1e6, now: T0 }))
      .toEqual({ skip: false, missingSince: 0 });
  });

  // The case the original guard meant to cover and never did.
  it('waits on the first sighting of an absent file after a prior sync', () => {
    expect(evaluateMissingSnapshot({ hasSyncedBefore: true, missingSince: 0, now: T0 }))
      .toEqual({ skip: true, missingSince: T0 });
  });

  it('keeps waiting inside the grace window', () => {
    const r = evaluateMissingSnapshot({
      hasSyncedBefore: true, missingSince: T0, now: T0 + MISSING_GRACE_MS - 1,
    });
    expect(r).toEqual({ skip: true, missingSince: T0 });
  });

  // The streak must measure the whole absence, not restart each cycle — otherwise
  // the window never elapses and the stall becomes permanent.
  it('preserves the original sighting across repeated cycles', () => {
    let state = { missingSince: 0 };
    for (const offset of [0, 15_000, 30_000, 45_000]) {
      state = evaluateMissingSnapshot({
        hasSyncedBefore: true, missingSince: state.missingSince, now: T0 + offset,
      });
      expect(state.skip).toBe(true);
    }
    expect(state.missingSince).toBe(T0);
  });

  // The failure the broken guard could not have caused, and which this must not
  // introduce: a genuinely deleted snapshot leaving sync stalled forever.
  it('seeds again once the file has been absent past the grace window', () => {
    expect(evaluateMissingSnapshot({
      hasSyncedBefore: true, missingSince: T0, now: T0 + MISSING_GRACE_MS,
    })).toEqual({ skip: false, missingSince: 0 });
  });

  it('clears the streak when it decides to seed, so the next absence starts fresh', () => {
    const recovered = evaluateMissingSnapshot({
      hasSyncedBefore: true, missingSince: T0, now: T0 + MISSING_GRACE_MS + 1,
    });
    expect(recovered.missingSince).toBe(0);
    // Next absence begins its own window rather than firing immediately.
    const next = evaluateMissingSnapshot({
      hasSyncedBefore: true, missingSince: recovered.missingSince, now: T0 + 1e7,
    });
    expect(next).toEqual({ skip: true, missingSince: T0 + 1e7 });
  });

  it('honours a custom grace window', () => {
    const opts = { hasSyncedBefore: true, missingSince: T0, graceMs: 1000 };
    expect(evaluateMissingSnapshot({ ...opts, now: T0 + 999 }).skip).toBe(true);
    expect(evaluateMissingSnapshot({ ...opts, now: T0 + 1000 }).skip).toBe(false);
  });

  it('seeds with no arguments rather than stalling on an undefined state', () => {
    expect(evaluateMissingSnapshot()).toEqual({ skip: false, missingSince: 0 });
    expect(evaluateMissingSnapshot({})).toEqual({ skip: false, missingSince: 0 });
  });
});

describe('ICLOUD_LAST_SYNCED_KEY', () => {
  // The whole bug was reading a key another tier owned. This one must be
  // iCloud's own, distinct from the WebDAV and GLANCEvault records.
  it('is distinct from the WebDAV and vault sync records', () => {
    expect(ICLOUD_LAST_SYNCED_KEY).toBe('dayglance-icloud-last-synced');
    expect(ICLOUD_LAST_SYNCED_KEY).not.toBe('day-planner-cloud-sync-last-synced');
    expect(ICLOUD_LAST_SYNCED_KEY).not.toBe('dayglance-vault-db-sync-last-synced');
  });
});
