import { describe, it, expect } from 'vitest';
import { detectObsidianDeletions, isObsidianTombstoned, addObsidianTombstones } from './obsidianDeletions.js';

describe('detectObsidianDeletions (conservative)', () => {
  it('reports a key this device previously scanned and no longer sees', () => {
    const r = detectObsidianDeletions(['a', 'b', 'c'], ['a', 'c']);
    expect(r).toEqual({ deletions: ['b'], skipped: false, reason: null });
  });

  it('reports nothing on the first scan (no prior baseline)', () => {
    expect(detectObsidianDeletions([], ['a', 'b'])).toEqual({ deletions: [], skipped: false, reason: null });
  });

  it('SKIPS an empty scan that follows a non-empty one (failed/partial scan)', () => {
    const r = detectObsidianDeletions(['a', 'b', 'c'], []);
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('empty-scan');
    expect(r.deletions).toEqual([]);
  });

  it('SKIPS when the drop exceeds the conservative margin (incomplete scan)', () => {
    // 10 known, 9 vanish at once → not 9 real deletions, an incomplete scan.
    const last = Array.from({ length: 10 }, (_, i) => `k${i}`);
    const r = detectObsidianDeletions(last, ['k0']);
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('drop-too-large');
  });

  it('allows a small drop (within margin) to be reported', () => {
    const last = Array.from({ length: 10 }, (_, i) => `k${i}`);
    const r = detectObsidianDeletions(last, last.slice(0, 8)); // 2 dropped, within max(5, 25%*10=3)
    expect(r.skipped).toBe(false);
    expect(r.deletions.sort()).toEqual(['k8', 'k9']);
  });

  it('reports nothing when nothing disappeared', () => {
    expect(detectObsidianDeletions(['a', 'b'], ['a', 'b', 'c'])).toEqual({ deletions: [], skipped: false, reason: null });
  });
});

describe('isObsidianTombstoned', () => {
  it('suppresses when the tombstone is at least as new as the row', () => {
    expect(isObsidianTombstoned({ x: '2026-07-07T00:00:00Z' }, 'x', '2026-07-06T00:00:00Z')).toBe(true);
  });
  it('does NOT suppress a row re-created after the tombstone (newer lastModified wins)', () => {
    expect(isObsidianTombstoned({ x: '2026-07-06T00:00:00Z' }, 'x', '2026-07-07T00:00:00Z')).toBe(false);
  });
  it('is false when there is no tombstone for the key', () => {
    expect(isObsidianTombstoned({}, 'x', '2026-01-01T00:00:00Z')).toBe(false);
  });
});

describe('addObsidianTombstones', () => {
  it('adds keys with the deletion time, keeping the newest per key', () => {
    const out = addObsidianTombstones({ a: '2026-01-01T00:00:00Z' }, ['a', 'b'], '2026-07-07T00:00:00Z');
    expect(out).toEqual({ a: '2026-07-07T00:00:00Z', b: '2026-07-07T00:00:00Z' });
  });
  it('does not move a key backwards to an older time', () => {
    const out = addObsidianTombstones({ a: '2026-07-07T00:00:00Z' }, ['a'], '2026-01-01T00:00:00Z');
    expect(out.a).toBe('2026-07-07T00:00:00Z');
  });
});
