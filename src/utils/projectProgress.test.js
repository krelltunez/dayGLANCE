import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { calculateProjectProgress, getProjectTotalDuration, isProjectStalled } from './projectProgress.js';

// Frozen: isProjectStalled reads Date.now() for both the grace period and the
// 7-day activity window.
const NOW = new Date('2026-08-18T12:00:00Z');
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

const OLD_PROJECT = { id: 'p1', createdAt: '2026-01-01T00:00:00Z' };
const task = (over = {}) => ({ id: 't', projectId: 'p1', duration: 30, completed: false, ...over });

describe('calculateProjectProgress', () => {
  it('weights by duration, not task count', () => {
    // 120 done out of 150 total: a count-based average would say 50%.
    const tasks = [task({ id: 'a', duration: 120, completed: true }), task({ id: 'b', duration: 30 })];
    expect(calculateProjectProgress('p1', tasks)).toBeCloseTo(0.8);
  });

  it('falls back to 30 minutes for tasks with no duration', () => {
    const tasks = [task({ id: 'a', duration: undefined, completed: true }), task({ id: 'b', duration: 30 })];
    expect(calculateProjectProgress('p1', tasks)).toBeCloseTo(0.5);
  });

  // null is the whole point: "no measurement to make" is not "measured at 0%".
  // A project whose only work is a recurring series lands here, because series
  // are excluded from progress on purpose.
  it('is null, not 0, when there is nothing to measure', () => {
    expect(calculateProjectProgress('p1', [])).toBeNull();
    expect(calculateProjectProgress('p1', [task({ archived: true, completed: true })])).toBeNull();
    expect(calculateProjectProgress('p1', [task({ projectId: 'p2', completed: true })])).toBeNull();
  });

  it('is 0 — not null — for real work that is genuinely untouched', () => {
    expect(calculateProjectProgress('p1', [task()])).toBe(0);
  });

  it('reports total duration for goal weighting', () => {
    expect(getProjectTotalDuration('p1', [task({ id: 'a', duration: 45 }), task({ id: 'b' })])).toBe(75);
  });
});

describe('isProjectStalled', () => {
  it('spares a project inside its 7-day grace period', () => {
    const fresh = { id: 'p1', createdAt: '2026-08-15T00:00:00Z' };
    expect(isProjectStalled('p1', [task()], fresh)).toBe(false);
  });

  it('is not stalled with nothing outstanding', () => {
    expect(isProjectStalled('p1', [task({ completed: true })], OLD_PROJECT)).toBe(false);
    expect(isProjectStalled('p1', [], OLD_PROJECT)).toBe(false);
  });

  it('is stalled with outstanding work and no completion in the last 7 days', () => {
    expect(isProjectStalled('p1', [task(), task({ id: 'old', completed: true, completedAt: '2026-07-01' })], OLD_PROJECT))
      .toBe(true);
  });

  it('is not stalled when a regular task completed inside the window', () => {
    expect(isProjectStalled('p1', [task(), task({ id: 'r', completed: true, completedAt: '2026-08-17' })], OLD_PROJECT))
      .toBe(false);
  });

  // The false positive: upkeep done through a recurring series leaves no
  // completed row in allTasks, so the project looked abandoned.
  it('counts a recent recurring completion as activity', () => {
    const series = [{ id: 's1', projectId: 'p1', completedDates: ['2026-08-17'] }];
    expect(isProjectStalled('p1', [task()], OLD_PROJECT, series)).toBe(false);
  });

  it('does not count a stale or foreign or archived series', () => {
    const stale = [{ id: 's1', projectId: 'p1', completedDates: ['2026-07-01'] }];
    const foreign = [{ id: 's2', projectId: 'p2', completedDates: ['2026-08-17'] }];
    const archived = [{ id: 's3', projectId: 'p1', archived: true, completedDates: ['2026-08-17'] }];
    for (const series of [stale, foreign, archived]) {
      expect(isProjectStalled('p1', [task()], OLD_PROJECT, series)).toBe(true);
    }
  });

  // Recurring data may only clear the flag, never raise it: a project with no
  // outstanding regular work stays unstalled whatever the series says.
  it('never introduces a stall that was not already there', () => {
    const series = [{ id: 's1', projectId: 'p1', completedDates: [] }];
    expect(isProjectStalled('p1', [], OLD_PROJECT, series)).toBe(false);
    expect(isProjectStalled('p1', [task({ completed: true })], OLD_PROJECT, series)).toBe(false);
  });

  it('omitting the argument keeps the previous behaviour', () => {
    expect(isProjectStalled('p1', [task()], OLD_PROJECT)).toBe(true);
  });
});
