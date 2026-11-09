import { describe, it, expect } from 'vitest';
import { goalsForView, goalRevealFilters, readShowCompletedGoals, SHOW_COMPLETED_GOALS_KEY } from './goalFilters.js';

// Which goals the Goals view shows: the area filter, and completed goals
// hidden unless shown.

const areas = [{ id: 'dev' }, { id: 'home' }];
const goals = [
  { id: 'a', status: 'active', areaId: 'dev' },
  { id: 'b', status: 'completed', areaId: 'dev' },
  { id: 'c', status: 'completed', areaId: 'home' },
  { id: 'd', status: 'active' },
  { id: 'e', status: 'completed', areaId: 'gone' },
];
const ids = (list) => list.map((g) => g.id);

describe('goalsForView', () => {
  it('hides completed goals by default, keeping the given order, and counts them', () => {
    const r = goalsForView(goals, {});
    expect(ids(r.goals)).toEqual(['a', 'd']);
    expect(r.completedCount).toBe(3);
  });

  it('shows them when asked, the count unchanged', () => {
    const r = goalsForView(goals, { showCompleted: true });
    expect(ids(r.goals)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(r.completedCount).toBe(3);
  });

  it('counts only the completed goals the area filter lets through', () => {
    expect(goalsForView(goals, { areaFilter: 'dev', areas })).toEqual({ goals: [goals[0]], completedCount: 1 });
    // No defined area: no area, or one that no longer exists.
    const none = goalsForView(goals, { areaFilter: 'uncategorized', areas, showCompleted: true });
    expect(ids(none.goals)).toEqual(['d', 'e']);
    expect(none.completedCount).toBe(1);
  });
});

describe('goalRevealFilters: what to change so a goal a request goes to is shown', () => {
  it('shows completed goals for a completed one', () => {
    expect(goalRevealFilters(goals[2], {})).toEqual({ showCompleted: true });
    expect(goalRevealFilters(goals[2], { showCompleted: true })).toEqual({});
  });

  it('widens the area filter for one it hides, and both when both hide it', () => {
    expect(goalRevealFilters(goals[0], { areaFilter: 'home', areas })).toEqual({ areaFilter: 'all' });
    expect(goalRevealFilters(goals[2], { areaFilter: 'dev', areas })).toEqual({ areaFilter: 'all', showCompleted: true });
  });

  it('changes nothing for a goal already shown, or none', () => {
    expect(goalRevealFilters(goals[0], { areaFilter: 'dev', areas })).toEqual({});
    expect(goalRevealFilters(undefined, {})).toEqual({});
  });
});

describe('readShowCompletedGoals', () => {
  it('is off unless turned on', () => {
    const storage = (v) => ({ getItem: (k) => (k === SHOW_COMPLETED_GOALS_KEY ? v : null) });
    expect(readShowCompletedGoals(storage(null))).toBe(false);
    expect(readShowCompletedGoals(storage('false'))).toBe(false);
    expect(readShowCompletedGoals(storage('true'))).toBe(true);
    expect(readShowCompletedGoals({ getItem: () => { throw new Error('blocked'); } })).toBe(false);
  });
});
