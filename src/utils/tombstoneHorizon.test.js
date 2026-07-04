import { describe, it, expect } from 'vitest';
import { tombstoneHorizon } from './tombstoneHorizon.js';

// The horizon must be STABLE across the many sync cycles within a day. A value
// that changed every call (the old `Date.now()`-per-build code) made the synced
// singleton row differ every cycle → re-pushed every cycle → account seq advance
// → SSE self-nudge loop. These lock in the stability that removes that loop.

const DAY = 24 * 60 * 60 * 1000;
const at = (iso) => new Date(iso).getTime();

describe('tombstoneHorizon', () => {
  it('is IDENTICAL for every call within the same UTC day (no per-cycle churn)', () => {
    const morning = at('2026-07-04T00:00:00.000Z');
    const evening = at('2026-07-04T23:59:59.000Z');
    // Many "cycles" a few seconds apart across the day → one and the same value.
    const a = tombstoneHorizon(90, morning);
    const b = tombstoneHorizon(90, morning + 3000);
    const c = tombstoneHorizon(90, evening);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('advances by exactly one day when the UTC day rolls over', () => {
    const day1 = tombstoneHorizon(90, at('2026-07-04T12:00:00.000Z'));
    const day2 = tombstoneHorizon(90, at('2026-07-05T00:00:00.000Z'));
    expect(day2).not.toBe(day1);
    expect(at(day2) - at(day1)).toBe(DAY);
  });

  it('returns a UTC-midnight ISO exactly retentionDays before today', () => {
    const now = at('2026-07-04T15:30:00.000Z');
    // 90 days before the UTC-midnight of 2026-07-04 is 2026-04-05T00:00:00Z.
    expect(tombstoneHorizon(90, now)).toBe('2026-04-05T00:00:00.000Z');
  });

  it('never emits a horizon LATER than the true cutoff (conservative for pruning)', () => {
    const now = at('2026-07-04T15:30:00.000Z');
    const trueCutoff = now - 90 * DAY;
    expect(at(tombstoneHorizon(90, now))).toBeLessThanOrEqual(trueCutoff);
  });

  it('returns null when retention is disabled (<= 0)', () => {
    expect(tombstoneHorizon(0, Date.now())).toBeNull();
    expect(tombstoneHorizon(-5, Date.now())).toBeNull();
  });
});
