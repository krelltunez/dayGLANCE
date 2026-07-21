import { describe, it, expect } from 'vitest';
import { EMPTY_SCHED_FILTERS, hasActiveSchedFilters, taskMatchesSchedFilters, toggleSchedFilter, groupProjectsForFilter, limitRecurringToNextInstance } from './schedAgenda.js';

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

describe('groupProjectsForFilter', () => {
  const goals = [
    { id: 'g1', title: 'Fitness', status: 'active' },
    { id: 'g2', title: 'Archived goal', status: 'archived' },
    { id: 'g3', title: 'Empty goal', status: 'active' },
  ];
  const projects = [
    { id: 'p1', title: 'Run', goalId: 'g1', status: 'active' },
    { id: 'p2', title: 'Old', goalId: 'g1', status: 'completed' },
    { id: 'p3', title: 'Solo', status: 'active' },
    { id: 'p4', title: 'In archived goal', goalId: 'g2', status: 'active' },
  ];

  it('groups by goal title with a trailing Standalone group', () => {
    const groups = groupProjectsForFilter(projects, goals);
    expect(groups.map(g => g.label)).toEqual(['Fitness', 'Standalone']);
    expect(groups[0].projects.map(p => p.id)).toEqual(['p1']);
    expect(groups[1].projects.map(p => p.id)).toEqual(['p3', 'p4']);
  });
});

describe('limitRecurringToNextInstance', () => {
  const day = (dateStr, tasks) => ({ dateStr, tasks });
  const occ = (tpl, dateStr, completed = false) => ({ id: `recurring-${tpl}-${dateStr}`, completed });

  it('keeps only the first incomplete occurrence per series', () => {
    const days = [
      day('2026-07-21', [occ('abc', '2026-07-21'), { id: 'plain-1' }]),
      day('2026-07-22', [occ('abc', '2026-07-22')]),
      day('2026-07-23', [occ('abc', '2026-07-23'), occ('xyz', '2026-07-23')]),
    ];
    const out = limitRecurringToNextInstance(days);
    expect(out[0].tasks.map(t => t.id)).toEqual(['recurring-abc-2026-07-21', 'plain-1']);
    expect(out[1].tasks).toHaveLength(0);
    expect(out[2].tasks.map(t => t.id)).toEqual(['recurring-xyz-2026-07-23']);
  });

  it('skips completed occurrences so the next incomplete one shows', () => {
    const days = [
      day('2026-07-21', [occ('abc', '2026-07-21', true)]),
      day('2026-07-22', [occ('abc', '2026-07-22')]),
    ];
    const out = limitRecurringToNextInstance(days);
    expect(out[0].tasks).toHaveLength(0);
    expect(out[1].tasks.map(t => t.id)).toEqual(['recurring-abc-2026-07-22']);
  });

  it('handles template ids containing hyphens', () => {
    const days = [
      day('2026-07-21', [occ('a-b-c-d', '2026-07-21')]),
      day('2026-07-22', [occ('a-b-c-d', '2026-07-22')]),
    ];
    const out = limitRecurringToNextInstance(days);
    expect(out[0].tasks).toHaveLength(1);
    expect(out[1].tasks).toHaveLength(0);
  });
});
