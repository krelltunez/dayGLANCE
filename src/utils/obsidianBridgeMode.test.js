import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { recordBridgeMode } from './obsidianBridgeMode.js';
import { detectObsidianDeletions } from './obsidianDeletions.js';

// Gate (b) pins: EVERY mode transition, in BOTH directions, clears the
// deletion detector's baseline and its dates sidecar in lockstep — and an
// empty baseline IS the one conservative no-detection cycle (the detector
// reports nothing when it previously saw nothing). Without this, a device
// that unpairs after months diffs a fresh scan against a fossilized
// baseline and everything legitimately removed since looks like a fresh
// deletion — the mass-tombstone shape.

const MODE_KEY = 'day-planner-obsidian-bridge-mode';
const BASELINE_KEY = 'day-planner-obsidian-last-scanned';
const DATES_KEY = 'day-planner-obsidian-last-scanned-dates';

beforeEach(() => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
});
afterEach(() => { delete globalThis.localStorage; });

const seedBaseline = () => {
  localStorage.setItem(BASELINE_KEY, JSON.stringify(['2026-05-01', 'obsidian-dg-aaaa1111']));
  localStorage.setItem(DATES_KEY, JSON.stringify({ 'obsidian-dg-aaaa1111': '2026-05-01' }));
};

describe('recordBridgeMode', () => {
  it('direct → plugin clears the baseline AND the dates sidecar, in lockstep', () => {
    localStorage.setItem(MODE_KEY, 'direct');
    seedBaseline();
    expect(recordBridgeMode('plugin')).toBe(true);
    expect(localStorage.getItem(BASELINE_KEY)).toBe(null);
    expect(localStorage.getItem(DATES_KEY)).toBe(null);
    expect(localStorage.getItem(MODE_KEY)).toBe('plugin');
  });

  it('plugin → direct clears too (the unpair direction is the dangerous one)', () => {
    localStorage.setItem(MODE_KEY, 'plugin');
    seedBaseline();
    expect(recordBridgeMode('direct')).toBe(true);
    expect(localStorage.getItem(BASELINE_KEY)).toBe(null);
    expect(localStorage.getItem(DATES_KEY)).toBe(null);
  });

  it('repeating the stored mode is a no-op; the very first record never clears', () => {
    seedBaseline();
    expect(recordBridgeMode('direct')).toBe(false); // first record: no prior mode
    expect(localStorage.getItem(BASELINE_KEY)).not.toBe(null);
    expect(recordBridgeMode('direct')).toBe(false); // steady state
    expect(localStorage.getItem(BASELINE_KEY)).not.toBe(null);
  });

  it('after the clear, the next scan is exactly one conservative no-detection cycle', () => {
    localStorage.setItem(MODE_KEY, 'plugin');
    seedBaseline();
    recordBridgeMode('direct');
    // First post-transition scan: empty baseline → the detector reports
    // NOTHING, however much vanished while this device was in plugin mode.
    const first = detectObsidianDeletions(
      JSON.parse(localStorage.getItem(BASELINE_KEY) || '[]'),
      ['2026-08-29'], null, { keyDates: {} },
    );
    expect(first.deletions).toEqual([]);
    // The scan then establishes a fresh baseline; detection resumes from it.
    localStorage.setItem(BASELINE_KEY, JSON.stringify(['2026-08-29', '2026-08-30']));
    const second = detectObsidianDeletions(
      JSON.parse(localStorage.getItem(BASELINE_KEY)),
      ['2026-08-29'], null, { keyDates: {} },
    );
    expect(second.deletions).toContain('2026-08-30');
  });
});
