import { describe, it, expect } from 'vitest';
import { EMPTY_SCHED_FILTERS, hasActiveSchedFilters, taskMatchesSchedFilters, toggleSchedFilter, groupProjectsForFilter, limitRecurringToNextInstance, schedFiltersEqual, isPastEvent } from './schedAgenda.js';

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

describe('schedFiltersEqual', () => {
  it('matches regardless of selection order', () => {
    const a = { colors: ['bg-red-500', 'bg-blue-500'], tags: ['work'], projectIds: [] };
    const b = { colors: ['bg-blue-500', 'bg-red-500'], tags: ['work'], projectIds: [] };
    expect(schedFiltersEqual(a, b)).toBe(true);
  });

  it('detects differences in any dimension', () => {
    const a = { colors: ['bg-red-500'], tags: ['work'], projectIds: [] };
    expect(schedFiltersEqual(a, { colors: ['bg-red-500'], tags: ['work'], projectIds: ['p1'] })).toBe(false);
    expect(schedFiltersEqual(a, { colors: ['bg-red-500'], tags: [], projectIds: [] })).toBe(false);
    expect(schedFiltersEqual(a, { colors: [], tags: ['work'], projectIds: [] })).toBe(false);
  });

  it('treats empty combos as equal and handles missing args', () => {
    expect(schedFiltersEqual(EMPTY_SCHED_FILTERS, { colors: [], tags: [], projectIds: [] })).toBe(true);
    expect(schedFiltersEqual(null, EMPTY_SCHED_FILTERS)).toBe(false);
    expect(schedFiltersEqual(EMPTY_SCHED_FILTERS, undefined)).toBe(false);
  });

  it('tolerates missing dimension keys (older stored presets)', () => {
    expect(schedFiltersEqual({ colors: [], tags: [] }, EMPTY_SCHED_FILTERS)).toBe(true);
    expect(schedFiltersEqual({ tags: ['work'] }, { colors: [], tags: ['work'], projectIds: [] })).toBe(true);
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

describe('isPastEvent', () => {
  // 2026-07-28 at 14:00
  const now = new Date('2026-07-28T14:00:00');
  const event = (over) => ({ imported: true, date: '2026-07-28', startTime: '09:00', duration: 60, ...over });

  it('ignores non-imported tasks entirely, even past-dated ones', () => {
    expect(isPastEvent({ date: '2026-07-01', startTime: '09:00', duration: 30 }, now)).toBe(false);
  });

  it('ignores task-calendar imports (they behave like tasks)', () => {
    expect(isPastEvent(event({ isTaskCalendar: true }), now)).toBe(false);
  });

  it('ignores events without a date', () => {
    expect(isPastEvent(event({ date: undefined }), now)).toBe(false);
  });

  it('marks events on earlier days as past', () => {
    expect(isPastEvent(event({ date: '2026-07-27' }), now)).toBe(true);
  });

  it('never marks events on later days', () => {
    expect(isPastEvent(event({ date: '2026-07-29' }), now)).toBe(false);
  });

  it("today: past once the event's end has been reached", () => {
    expect(isPastEvent(event({ startTime: '09:00', duration: 60 }), now)).toBe(true);   // ended 10:00
    expect(isPastEvent(event({ startTime: '13:00', duration: 60 }), now)).toBe(true);   // ends exactly 14:00
    expect(isPastEvent(event({ startTime: '13:30', duration: 60 }), now)).toBe(false);  // in progress
    expect(isPastEvent(event({ startTime: '15:00', duration: 60 }), now)).toBe(false);  // upcoming
  });

  it('all-day events last until the day ends', () => {
    expect(isPastEvent(event({ isAllDay: true, startTime: '00:00' }), now)).toBe(false);
    expect(isPastEvent(event({ isAllDay: true, startTime: '00:00', date: '2026-07-27' }), now)).toBe(true);
  });

  it('zero-duration events are past once their start time passes', () => {
    expect(isPastEvent(event({ startTime: '13:00', duration: 0 }), now)).toBe(true);
    expect(isPastEvent(event({ startTime: '14:30', duration: 0 }), now)).toBe(false);
  });
});
