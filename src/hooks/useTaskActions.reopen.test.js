import { describe, it, expect, vi } from 'vitest';
import useTaskActions from './useTaskActions.js';

// Reopening a task whose project is archived unlinks it, as the user's own
// stamped edit (referentialIntegrity.reopenTask). The toggle is the path the
// Inbox and timeline checkboxes take.
const archived = { id: 'p1', status: 'archived' };
const live = { id: 'p2', status: 'active' };
const done = (id, projectId) => ({
  id, title: id, completed: true, completedAt: '2026-11-01T09:00:00-07:00', archived: true, projectId,
  lastModified: '2026-11-01T16:00:00.000Z',
});

const build = ({ tasks = [], unscheduledTasks = [] }) => {
  const state = { tasks, unscheduledTasks };
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { toggleComplete } = useTaskActions({
    tasks, unscheduledTasks, recurringTasks: [], projects: [archived, live],
    setTasks: vi.fn((fn) => { state.tasks = fn(state.tasks); }),
    setUnscheduledTasks: vi.fn((fn) => { state.unscheduledTasks = fn(state.unscheduledTasks); }),
    pushUndo: vi.fn(() => 'Marked not done'), setUndoToast: vi.fn(), playUISound: vi.fn(),
    onboardingProgress: { hasCompletedTask: true }, setOnboardingProgress: vi.fn(),
    syncTaskCompletionToCalDAV: vi.fn(),
  });
  return { toggleComplete, state };
};

describe('toggleComplete: a reopen in an archived project', () => {
  it('Inbox: unlinks, unarchives and stamps', () => {
    const { toggleComplete, state } = build({ unscheduledTasks: [done('u1', 'p1')] });
    toggleComplete('u1', true);
    const [row] = state.unscheduledTasks;
    expect(row).not.toHaveProperty('projectId');
    expect(row).toMatchObject({ completed: false, archived: false });
    expect(row.lastModified > '2026-11-01T16:00:00.000Z').toBe(true);
  });

  it('timeline: the same', () => {
    const { toggleComplete, state } = build({ tasks: [{ ...done('t1', 'p1'), date: '2026-11-27', startTime: '09:00' }] });
    toggleComplete('t1');
    expect(state.tasks[0]).not.toHaveProperty('projectId');
  });

  it('a live project keeps its task', () => {
    const { toggleComplete, state } = build({ unscheduledTasks: [done('u2', 'p2')] });
    toggleComplete('u2', true);
    expect(state.unscheduledTasks[0]).toMatchObject({ projectId: 'p2', completed: false, archived: false });
  });
});
