import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { recordBridgeMode, reconcileArchivedBaseline } from './obsidianBridgeMode.js';
import { detectObsidianDeletions, addObsidianTombstones, isObsidianTombstoned } from './obsidianDeletions.js';

// Gate (b) pins, AS AMENDED (archive-and-reconcile): a direct→plugin
// transition ARCHIVES the baseline + dates sidecar under the transition
// time instead of destroying them; the live baseline still clears in both
// directions (the conservative empty-baseline first cycle is unchanged);
// and after the device returns to direct mode the archived evidence is run
// through the SAME detector so deletions made in the vault while paired
// still propagate — stamped at the archive time so they lose LWW to
// anything touched since. The headline test is the commissioned scenario:
// a simulated month paired, deletions meanwhile, a correct exit.

const MODE_KEY = 'day-planner-obsidian-bridge-mode';
const BASELINE_KEY = 'day-planner-obsidian-last-scanned';
const DATES_KEY = 'day-planner-obsidian-last-scanned-dates';
const ARCHIVE_KEY = 'day-planner-obsidian-baseline-archive';

beforeEach(() => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
});
afterEach(() => { delete globalThis.localStorage; });

const seedBaseline = (keys, dates = {}) => {
  localStorage.setItem(BASELINE_KEY, JSON.stringify(keys));
  localStorage.setItem(DATES_KEY, JSON.stringify(dates));
};
const archive = () => JSON.parse(localStorage.getItem(ARCHIVE_KEY));

describe('recordBridgeMode — archive on entry, live baseline never survives a transition', () => {
  it('direct → plugin ARCHIVES baseline + dates under the transition time, then clears the live pair', () => {
    localStorage.setItem(MODE_KEY, 'direct');
    seedBaseline(['2026-05-01', 'obsidian-dg-aaaa1111'], { 'obsidian-dg-aaaa1111': '2026-05-01' });
    expect(recordBridgeMode('plugin', '2026-07-01T00:00:00.000Z')).toBe(true);
    expect(archive()).toEqual({
      keys: ['2026-05-01', 'obsidian-dg-aaaa1111'],
      dates: { 'obsidian-dg-aaaa1111': '2026-05-01' },
      archivedAt: '2026-07-01T00:00:00.000Z',
    });
    expect(localStorage.getItem(BASELINE_KEY)).toBe(null);
    expect(localStorage.getItem(DATES_KEY)).toBe(null);
  });

  it('plugin → direct clears the live pair and KEEPS the archive waiting', () => {
    localStorage.setItem(MODE_KEY, 'direct');
    seedBaseline(['2026-05-01']);
    recordBridgeMode('plugin', '2026-07-01T00:00:00.000Z');
    expect(recordBridgeMode('direct')).toBe(true);
    expect(archive()?.keys).toEqual(['2026-05-01']);
    expect(localStorage.getItem(BASELINE_KEY)).toBe(null);
  });

  it('a flap with a pending archive MERGES the newer baseline in under the OLDER stamp (weaker tombstones = safer)', () => {
    localStorage.setItem(MODE_KEY, 'direct');
    seedBaseline(['2026-05-01']);
    recordBridgeMode('plugin', '2026-07-01T00:00:00.000Z');
    recordBridgeMode('direct');
    seedBaseline(['2026-05-01', '2026-07-02']); // scans re-established a baseline
    recordBridgeMode('plugin', '2026-07-03T00:00:00.000Z');
    expect(archive().keys.sort()).toEqual(['2026-05-01', '2026-07-02']);
    expect(archive().archivedAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('repeating the stored mode is a no-op; the very first record touches nothing', () => {
    seedBaseline(['2026-05-01']);
    expect(recordBridgeMode('direct')).toBe(false); // first record: no prior mode
    expect(localStorage.getItem(BASELINE_KEY)).not.toBe(null);
    expect(recordBridgeMode('direct')).toBe(false);
    expect(archive()).toBe(null);
  });
});

describe('reconcileArchivedBaseline — the month-paired exit (the commissioned scenario)', () => {
  const T_PAIRED = '2026-07-29T00:00:00.000Z'; // device entered plugin mode
  const NOW = Date.parse('2026-08-29T12:00:00.000Z'); // a month later

  // What the device knew when it paired: two daily notes, three tasks.
  const seedAndPair = () => {
    localStorage.setItem(MODE_KEY, 'direct');
    seedBaseline(
      ['2026-07-20', '2026-07-25', 'obsidian-dg-gone0001', 'obsidian-dg-kept0002', 'obsidian-dg-edit0003'],
      { 'obsidian-dg-gone0001': '2026-07-20', 'obsidian-dg-kept0002': '2026-07-25', 'obsidian-dg-edit0003': '2026-07-25' },
    );
    recordBridgeMode('plugin', T_PAIRED);
  };

  it('deletions accumulated while paired land on the exit scan, tombstoned at the ARCHIVE time — and lose LWW to anything touched since', () => {
    seedAndPair();
    // A month passes. In the vault meanwhile: note 2026-07-20 and task
    // gone0001 were deleted; edit0003's task was completed in dayGLANCE
    // (via the stream) during the window. Device unpairs:
    recordBridgeMode('direct');
    // First direct scan sees the post-deletion vault.
    const freshScan = ['2026-07-25', '2026-08-28', 'obsidian-dg-kept0002', 'obsidian-dg-edit0003'];
    const result = reconcileArchivedBaseline(freshScan, '2026-06-01', NOW);
    expect(result.skipped).toBe(false);
    expect(result.deletions.sort()).toEqual(['2026-07-20', 'obsidian-dg-gone0001']);
    expect(result.archivedAt).toBe(T_PAIRED);
    expect(archive()).toBe(null); // one-shot: consumed

    // The tombstones behave: stamped at pairing time, they drop only rows
    // untouched since before the paired window.
    const tombstones = addObsidianTombstones({}, result.deletions, result.archivedAt);
    // Untouched since June → genuinely deleted → stays gone.
    expect(isObsidianTombstoned(tombstones, 'obsidian-dg-gone0001', '2026-06-15T00:00:00.000Z')).toBe(true);
    // The same key re-created (or touched) mid-window beats the tombstone.
    expect(isObsidianTombstoned(tombstones, 'obsidian-dg-gone0001', '2026-08-10T00:00:00.000Z')).toBe(false);
    // Keys never reconciled carry no tombstone at all.
    expect(isObsidianTombstoned(tombstones, 'obsidian-dg-edit0003', '2026-06-15T00:00:00.000Z')).toBe(false);
  });

  it('keys that aged out of the scan window during the paired month are EXCLUDED, not "deleted"', () => {
    seedAndPair();
    recordBridgeMode('direct');
    // Cutoff moved past the old note while paired: its absence is the
    // window sliding, and its dated task goes with it.
    const result = reconcileArchivedBaseline(['2026-07-25', 'obsidian-dg-kept0002', 'obsidian-dg-edit0003'], '2026-07-21', NOW);
    expect(result.skipped).toBe(false);
    expect(result.deletions).toEqual([]); // 2026-07-20 + gone0001 aged out; nothing else missing
  });

  it('drop-too-large keeps the archive and retries; a later scan (window shrinks the diff) consumes it — no oscillation', () => {
    localStorage.setItem(MODE_KEY, 'direct');
    const keys = Array.from({ length: 12 }, (_, i) => `2026-07-${String(i + 10).padStart(2, '0')}`);
    seedBaseline(keys);
    recordBridgeMode('plugin', T_PAIRED);
    recordBridgeMode('direct');
    // 6 of 12 gone at once → over max(5, ceil(12*0.25)) → judged incomplete.
    const survivors = keys.slice(6);
    const first = reconcileArchivedBaseline(survivors, '2026-06-01', NOW);
    expect(first).toEqual({ skipped: true });
    expect(archive()).not.toBe(null); // kept for the next scan
    // Later, the window has moved past two of the missing keys: 4 missing
    // ≤ threshold → real deletions, archive consumed.
    const second = reconcileArchivedBaseline(survivors, '2026-07-12', NOW);
    expect(second.skipped).toBe(false);
    expect(second.deletions).toEqual(['2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15']);
    expect(archive()).toBe(null);
    // And there is nothing left to oscillate: no archive → null forever.
    expect(reconcileArchivedBaseline(survivors, '2026-07-12', NOW)).toBe(null);
  });

  it('an archive past the 60-day tombstone horizon is discarded (a tombstone would be GC-d anyway), logged, and never reported', () => {
    localStorage.setItem(MODE_KEY, 'direct');
    seedBaseline(['2026-05-01']);
    recordBridgeMode('plugin', '2026-05-02T00:00:00.000Z');
    recordBridgeMode('direct');
    expect(reconcileArchivedBaseline(['2026-08-28'], null, NOW)).toBe(null); // ~119 days old
    expect(archive()).toBe(null);
  });

  it('no archive (a device that never paired) → null, nothing touched', () => {
    expect(reconcileArchivedBaseline(['2026-08-28'], null, NOW)).toBe(null);
  });

  it('the live detector still gets its conservative empty-baseline first cycle after any transition', () => {
    seedAndPair();
    recordBridgeMode('direct');
    const first = detectObsidianDeletions(
      JSON.parse(localStorage.getItem(BASELINE_KEY) || '[]'),
      ['2026-08-28'], null, { keyDates: {} },
    );
    expect(first).toEqual({ deletions: [], skipped: false, reason: null });
  });
});
