import { describe, it, expect } from 'vitest';
import { detectObsidianDeletions, isObsidianTombstoned, addObsidianTombstones, obsidianKeyDate } from './obsidianDeletions.js';

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

  it('does NOT tombstone a note that aged out of the retention window', () => {
    // 2026-04-06 fell below the cutoff — it left the scan because the window slid,
    // not because it was deleted. Must not be reported.
    const r = detectObsidianDeletions(['2026-04-06', '2026-07-01'], ['2026-07-01'], '2026-06-07');
    expect(r.deletions).toEqual([]);
    expect(r.skipped).toBe(false);
  });

  it('DOES tombstone an in-window note that vanished (real deletion)', () => {
    const r = detectObsidianDeletions(['2026-06-22', '2026-07-01'], ['2026-07-01'], '2026-06-07');
    expect(r.deletions).toEqual(['2026-06-22']);
  });

  it('applies the window cutoff to task ids too (date embedded in the id)', () => {
    const last = ['obsidian-2026-04-06-abc', 'obsidian-2026-06-22-xyz'];
    const r = detectObsidianDeletions(last, [], '2026-06-07'); // both missing…
    // …but the April one aged out (excluded); the June one is a real deletion.
    // Empty current with a non-empty last is normally 'empty-scan'; assert the
    // date filter still governs which count as candidates by using a partial scan:
    const r2 = detectObsidianDeletions(last, ['obsidian-2026-07-05-new'], '2026-06-07');
    expect(r2.deletions).toEqual(['obsidian-2026-06-22-xyz']);
    expect(r.skipped).toBe(true); // empty scan guard still fires first
  });
});

describe('obsidianKeyDate', () => {
  it('reads a daily-note date key', () => expect(obsidianKeyDate('2026-06-22')).toBe('2026-06-22'));
  it('reads the date from a task id', () => expect(obsidianKeyDate('obsidian-2026-06-22-a9f')).toBe('2026-06-22'));
  it('returns null for an undatable key', () => expect(obsidianKeyDate('weird-key')).toBeNull());
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
