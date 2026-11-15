import { describe, it, expect } from 'vitest';
import { planHistory, isAllDayPlan, planTrailStops, hiddenStops } from './planHistory.js';

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
    expect(planHistory(task)).toEqual({ plan: task.originalPlan, changed: { date: true, startTime: false, duration: false }, allDay: false });
  });

  // A chore sent by another GLANCE app arrives all-day and is then given a
  // time: the history read "originally 00:00", as if it had been planned at midnight.
  describe('a task first planned all-day', () => {
    const allDay = { date: '2026-10-05', startTime: '00:00', duration: 30, allDay: true };

    it('given a time and a length on its own day has nothing to tell', () => {
      expect(planHistory({ date: '2026-10-05', startTime: '14:00', duration: 90, isAllDay: false, originalPlan: allDay })).toBeNull();
      expect(planHistory({ date: '2026-10-05', startTime: '00:00', duration: 30, isAllDay: true, originalPlan: allDay })).toBeNull();
    });

    it('moved to another day tells the day, and marks the plan all-day', () => {
      const task = { date: '2026-10-07', startTime: '14:00', duration: 90, originalPlan: allDay };
      expect(planHistory(task)).toEqual({ plan: allDay, changed: { date: true, startTime: false, duration: false }, allDay: true });
    });

    it('a baseline from before the flag is read by its stored midnight', () => {
      const old = { date: '2026-10-05', startTime: '00:00', duration: 30 };
      expect(isAllDayPlan(old)).toBe(true);
      expect(planHistory({ date: '2026-10-05', startTime: '14:00', duration: 90, originalPlan: old })).toBeNull();
      expect(planHistory({ date: '2026-10-06', startTime: '14:00', originalPlan: old })).toMatchObject({ allDay: true, changed: { date: true, startTime: false } });
    });

    it('isAllDayPlan: the flag decides when it is there; without it, midnight', () => {
      expect(isAllDayPlan({ date: 'd', startTime: '00:00', allDay: true })).toBe(true);
      expect(isAllDayPlan({ date: 'd', startTime: '00:00', allDay: false })).toBe(false);
      expect(isAllDayPlan({ date: 'd', startTime: '09:00' })).toBe(false);
      expect(isAllDayPlan({ date: 'd', startTime: '09:00', allDay: true })).toBe(true);
      expect(isAllDayPlan(null)).toBe(false);
    });

    it('a timed plan made all-day later is still a change', () => {
      const timed = { date: '2026-10-05', startTime: '09:00', duration: 30 };
      expect(planHistory({ date: '2026-10-05', startTime: '00:00', duration: 30, isAllDay: true, originalPlan: timed })).toMatchObject({ allDay: false, changed: { startTime: true } });
    });
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
