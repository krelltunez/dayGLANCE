import { describe, it, expect } from 'vitest';
import { OBSIDIAN_IMPORT_WINDOW_DAYS, obsidianWindowCutoffDate } from './obsidian.js';

describe('Obsidian import window (decoupled from calendar retention)', () => {
  it('is a fixed 90-day window', () => {
    expect(OBSIDIAN_IMPORT_WINDOW_DAYS).toBe(90);
  });

  it('computes a local YYYY-MM-DD cutoff `days` before the reference date', () => {
    // 2026-07-08 − 90 days = 2026-04-09
    expect(obsidianWindowCutoffDate(90, new Date(2026, 6, 8))).toBe('2026-04-09');
  });

  it('zero-pads month and day', () => {
    // 2026-03-05 − 30 days = 2026-02-03
    expect(obsidianWindowCutoffDate(30, new Date(2026, 2, 5))).toBe('2026-02-03');
  });

  it('crosses year boundaries correctly', () => {
    // 2026-02-01 − 90 days = 2025-11-03
    expect(obsidianWindowCutoffDate(90, new Date(2026, 1, 1))).toBe('2025-11-03');
  });

  it('returns null for an unlimited window (days <= 0)', () => {
    expect(obsidianWindowCutoffDate(0, new Date(2026, 6, 8))).toBeNull();
    expect(obsidianWindowCutoffDate(-5, new Date(2026, 6, 8))).toBeNull();
  });

  it('the default 90-day window resolves to a non-null cutoff', () => {
    expect(obsidianWindowCutoffDate(OBSIDIAN_IMPORT_WINDOW_DAYS, new Date(2026, 6, 8))).toBe('2026-04-09');
  });
});
