import { describe, it, expect, vi } from 'vitest';
import useTaskActions from './useTaskActions.js';
import { parseRecurringId } from '../utils/recurringId.js';
import { recurringTaskInstance } from '../utils/expandRecurringTasks.js';

// Ticking a repeating task's subtask (from its card, the notes panel, focus
// mode) ticks it on THAT occurrence only: each day starts fresh.

const build = (template, tasks = []) => {
  let recurring = [template];
  let list = tasks;
  const pushUndo = vi.fn();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { toggleSubtask } = useTaskActions({
    tasks: list, setTasks: vi.fn((fn) => { list = fn(list); }),
    recurringTasks: recurring, setRecurringTasks: vi.fn((fn) => { recurring = fn(recurring); }),
    setUnscheduledTasks: vi.fn(), parseRecurringId, pushUndo,
    setUndoToast: vi.fn(), playUISound: vi.fn(), setSyncNotification: vi.fn(),
    onboardingProgress: { hasUsedActionButtons: true }, setOnboardingProgress: vi.fn(),
  });
  return { toggleSubtask, series: () => recurring[0], tasks: () => list, pushUndo };
};

const gym = {
  id: 'g1', title: 'Gym', startTime: '07:00', duration: 60, recurrence: { type: 'daily', startDate: '2026-11-01' },
  completedDates: [], exceptions: {}, subtasks: [{ id: 'w', title: 'Warm up', completed: false }, { id: 'l', title: 'Lift', completed: false }],
};
const ticks = (template, date) => recurringTaskInstance(template, date).subtasks.filter((s) => s.completed).map((s) => s.id);

describe('toggleSubtask on a repeating task', () => {
  // MUTATION: route the recurring id back through the template's own
  // subtasks and Tuesday shows Monday's tick.
  it('ticks the occurrence\'s date only, as one undo step', () => {
    const h = build(gym);
    h.toggleSubtask('recurring-g1-2026-11-10', 'w', false);
    expect(ticks(h.series(), '2026-11-10')).toEqual(['w']);
    expect(ticks(h.series(), '2026-11-11')).toEqual([]);
    expect(h.series().subtasks).toEqual(gym.subtasks);
    expect(h.series().lastModified).toBeDefined();
    expect(h.pushUndo).toHaveBeenCalledWith({ key: 'subtaskChanged', taskId: 'recurring-g1-2026-11-10' });
  });

  it('a second toggle unticks it', () => {
    const h = build(gym);
    h.toggleSubtask('recurring-g1-2026-11-10', 'w', false);
    const after = build(h.series());
    after.toggleSubtask('recurring-g1-2026-11-10', 'w', false);
    expect(ticks(after.series(), '2026-11-10')).toEqual([]);
  });

  it('a one-off task still ticks its own subtask, as before', () => {
    const task = { id: 't1', title: 'Report', subtasks: [{ id: 's', title: 'Draft', completed: false }] };
    const h = build(gym, [task]);
    h.toggleSubtask('t1', 's', false);
    expect(h.tasks()[0].subtasks[0].completed).toBe(true);
  });
});
