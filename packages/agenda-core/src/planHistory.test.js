import { describe, it, expect } from 'vitest';
import { planHistory, planTrailStops, hiddenStops } from './planHistory.js';

// The reading rules the app's history panel and the MCP read surface share.
// The app's own suites (src/utils/originalPlan.test.js, planTrail.test.js)
// exercise them through the re-exports; these pin the package by itself.

describe('planHistory', () => {
  it('is null with no baseline, and null when the baseline still matches', () => {
    expect(planHistory({ date: '2026-10-05', startTime: '09:00' })).toBeNull();
    expect(planHistory({ date: '2026-10-05', startTime: '09:00', duration: 30, originalPlan: { date: '2026-10-05', startTime: '09:00', duration: 30 } })).toBeNull();
  });

  it('names what moved, and ignores a duration the baseline never recorded', () => {
    const task = { date: '2026-10-09', startTime: '09:00', duration: 45, originalPlan: { date: '2026-10-05', startTime: '09:00' } };
    expect(planHistory(task)).toEqual({ plan: task.originalPlan, changed: { date: true, startTime: false, duration: false } });
  });
});

describe('planTrailStops', () => {
  it('keeps only stops with a date, a start and a finite at, in stored order', () => {
    const good = [{ at: 2, date: '2026-10-06', startTime: '10:00' }, { at: '1', date: '2026-10-05', startTime: '09:00' }];
    expect(planTrailStops([good[0], null, { at: 'x', date: 'd', startTime: 's' }, { at: 3, date: '2026-10-07' }, good[1]])).toEqual(good);
    expect(planTrailStops('nope')).toEqual([]);
    expect(planTrailStops(undefined)).toEqual([]);
  });
});

describe('hiddenStops', () => {
  it('is the count minus the recorded stops, never negative', () => {
    const trail = [{ at: 1, date: '2026-10-05', startTime: '09:00' }, { at: 2, date: '2026-10-06', startTime: '09:00' }];
    expect(hiddenStops({ deferrals: 5, planTrail: trail })).toBe(3);
    expect(hiddenStops({ deferrals: 1, planTrail: trail })).toBe(0);
    expect(hiddenStops({ deferrals: 'junk', planTrail: trail })).toBe(0);
    expect(hiddenStops(null)).toBe(0);
  });
});
