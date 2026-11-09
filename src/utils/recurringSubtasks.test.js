import { describe, it, expect } from 'vitest';
import { occurrenceSubtasks, withOccurrenceSubtask } from './recurringSubtasks.js';

// A repeating task's subtasks, ticked per occurrence.

const series = (extra = {}) => ({
  id: 'r1', subtasks: [{ id: 'w', title: 'Warm up', completed: true }, { id: 2, title: 'Lift', completed: false }], ...extra,
});

describe('occurrenceSubtasks', () => {
  it('the series\' list with that date\'s ticks only; the old shared tick is not read', () => {
    const t = series({ subtaskCompletions: { '2026-11-10': ['2'] } });
    expect(occurrenceSubtasks(t, '2026-11-10')).toEqual([
      { id: 'w', title: 'Warm up', completed: false },
      { id: 2, title: 'Lift', completed: true },
    ]);
    expect(occurrenceSubtasks(t, '2026-11-11').every((s) => !s.completed)).toBe(true);
  });

  it('a series without subtasks, or without a map, has an unticked list', () => {
    expect(occurrenceSubtasks({ id: 'r' }, '2026-11-10')).toEqual([]);
    expect(occurrenceSubtasks(series(), '2026-11-10').map((s) => s.completed)).toEqual([false, false]);
  });
});

describe('withOccurrenceSubtask', () => {
  it('ticks on that date only, ids sorted as strings, leaving the template\'s subtasks as they were', () => {
    const t = series();
    const a = withOccurrenceSubtask(t, '2026-11-10', 2);
    const b = withOccurrenceSubtask(a, '2026-11-10', 'w');
    expect(b.subtaskCompletions).toEqual({ '2026-11-10': ['2', 'w'] });
    expect(b.subtasks).toBe(t.subtasks);
  });

  it('a second toggle unticks, and a date left with none loses its key', () => {
    const t = withOccurrenceSubtask(series(), '2026-11-10', 'w');
    expect(withOccurrenceSubtask(t, '2026-11-10', 'w').subtaskCompletions).toEqual({});
  });

  it('an explicit state that is already so changes nothing', () => {
    const t = withOccurrenceSubtask(series(), '2026-11-10', 'w');
    expect(withOccurrenceSubtask(t, '2026-11-10', 'w', true)).toBe(t);
    expect(withOccurrenceSubtask(t, '2026-11-11', 'w', false)).toBe(t);
  });

  it('leaves other dates alone', () => {
    const t = withOccurrenceSubtask(series(), '2026-11-10', 'w');
    expect(withOccurrenceSubtask(t, '2026-11-11', 2).subtaskCompletions).toEqual({ '2026-11-10': ['w'], '2026-11-11': ['2'] });
  });
});
