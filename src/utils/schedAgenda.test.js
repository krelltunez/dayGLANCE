import { describe, it, expect } from 'vitest';
import { EMPTY_SCHED_FILTERS, hasActiveSchedFilters, taskMatchesSchedFilters, toggleSchedFilter } from './schedAgenda.js';

const task = { title: 'Write report #work #deep', color: 'bg-red-500', projectId: 'p1' };

describe('taskMatchesSchedFilters', () => {
  it('passes everything when no filters are active', () => {
    expect(taskMatchesSchedFilters(task, EMPTY_SCHED_FILTERS)).toBe(true);
    expect(hasActiveSchedFilters(EMPTY_SCHED_FILTERS)).toBe(false);
  });

  it('filters by color', () => {
    expect(taskMatchesSchedFilters(task, { colors: ['bg-red-500'], tags: [], projectIds: [] })).toBe(true);
    expect(taskMatchesSchedFilters(task, { colors: ['bg-green-500'], tags: [], projectIds: [] })).toBe(false);
  });

  it('filters by tag (OR within tags)', () => {
    expect(taskMatchesSchedFilters(task, { colors: [], tags: ['work'], projectIds: [] })).toBe(true);
    expect(taskMatchesSchedFilters(task, { colors: [], tags: ['home', 'deep'], projectIds: [] })).toBe(true);
    expect(taskMatchesSchedFilters(task, { colors: [], tags: ['home'], projectIds: [] })).toBe(false);
  });

  it('filters by project, with none sentinel for project-less tasks', () => {
    expect(taskMatchesSchedFilters(task, { colors: [], tags: [], projectIds: ['p1'] })).toBe(true);
    expect(taskMatchesSchedFilters(task, { colors: [], tags: [], projectIds: ['p2'] })).toBe(false);
    const free = { title: 'Free task', color: 'bg-blue-500' };
    expect(taskMatchesSchedFilters(free, { colors: [], tags: [], projectIds: ['none'] })).toBe(true);
    expect(taskMatchesSchedFilters(free, { colors: [], tags: [], projectIds: ['p1'] })).toBe(false);
  });

  it('ANDs across dimensions', () => {
    expect(taskMatchesSchedFilters(task, { colors: ['bg-red-500'], tags: ['work'], projectIds: ['p1'] })).toBe(true);
    expect(taskMatchesSchedFilters(task, { colors: ['bg-red-500'], tags: ['home'], projectIds: ['p1'] })).toBe(false);
  });
});

describe('toggleSchedFilter', () => {
  it('adds and removes values immutably', () => {
    const withRed = toggleSchedFilter(EMPTY_SCHED_FILTERS, 'colors', 'bg-red-500');
    expect(withRed.colors).toEqual(['bg-red-500']);
    expect(EMPTY_SCHED_FILTERS.colors).toEqual([]);
    expect(toggleSchedFilter(withRed, 'colors', 'bg-red-500').colors).toEqual([]);
  });
});
