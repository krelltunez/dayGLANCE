import { describe, it, expect, vi } from 'vitest';
import useTaskActions from './useTaskActions.js';
import { parseRecurringId } from '../utils/recurringId.js';

// useTaskActions is a plain factory (no React hooks in its body), so it can be
// called directly with just the deps postponeTask touches.
const buildActions = (tasks, { conflicted = false } = {}) => {
  let state = tasks;
  const setTasks = vi.fn(fn => { state = fn(state); });
  const getAdjustedTimeForImportedConflicts = vi.fn(() => ({ conflicted, conflictingEvent: { title: 'Meeting' } }));
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { postponeTask } = useTaskActions({
    tasks, setTasks, getAdjustedTimeForImportedConflicts,
    pushUndo: vi.fn(() => 'Postponed'), setUndoToast: vi.fn(), playUISound: vi.fn(),
    setSyncNotification: vi.fn(),
    onboardingProgress: { hasUsedActionButtons: true }, setOnboardingProgress: vi.fn(),
  });
  return { postponeTask, getState: () => state, setTasks, getAdjustedTimeForImportedConflicts };
};

describe('postponeTask — all-day tasks', () => {
  it.each([null, undefined, ''])('moves an all-day task with startTime %p to the next day', (startTime) => {
    // lastGLANCE intents create date-only tasks with startTime: null.
    const { postponeTask, getState, getAdjustedTimeForImportedConflicts } = buildActions([
      { id: 'a', title: 'From lastGLANCE', date: '2026-10-17', startTime, isAllDay: true, source_app: 'lastglance' },
    ]);

    postponeTask('a');

    expect(getState()[0].date).toBe('2026-10-18');
    expect(getAdjustedTimeForImportedConflicts).not.toHaveBeenCalled();
  });

  it('does not let a timed conflict block an all-day task', () => {
    const { postponeTask, getState } = buildActions([
      { id: 'a', title: 'All day', date: '2026-10-17', startTime: '00:00', isAllDay: true },
    ], { conflicted: true });

    postponeTask('a');

    expect(getState()[0].date).toBe('2026-10-18');
  });

  it('still ignores a timed task with no start time', () => {
    const { postponeTask, setTasks } = buildActions([
      { id: 't', title: 'Broken', date: '2026-10-17', startTime: null, isAllDay: false },
    ]);

    postponeTask('t');

    expect(setTasks).not.toHaveBeenCalled();
  });

  it('still blocks a timed task on a conflict', () => {
    const { postponeTask, setTasks } = buildActions([
      { id: 't', title: 'Timed', date: '2026-10-17', startTime: '09:00', duration: 30, isAllDay: false },
    ], { conflicted: true });

    postponeTask('t');

    expect(setTasks).not.toHaveBeenCalled();
  });
});

// #2331: postponing one occurrence of a series makes a one-off on the next
// day, written field by field. It used to leave the series' energy override
// behind, so a block the user had marked Restore came back as Effort.
describe('postponeTask — a recurring occurrence keeps the series energy', () => {
  const build = (template) => {
    let tasks = [];
    let recurring = [template];
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { postponeTask } = useTaskActions({
      tasks, setTasks: vi.fn(fn => { tasks = fn(tasks); }),
      recurringTasks: recurring, setRecurringTasks: vi.fn(fn => { recurring = fn(recurring); }), parseRecurringId,
      getAdjustedTimeForImportedConflicts: vi.fn(() => ({ conflicted: false })),
      pushUndo: vi.fn(() => 'Postponed'), setUndoToast: vi.fn(), playUISound: vi.fn(),
      setSyncNotification: vi.fn(),
      onboardingProgress: { hasUsedActionButtons: true }, setOnboardingProgress: vi.fn(),
    });
    return { postponeTask, getTasks: () => tasks };
  };
  const series = (extra) => ({
    id: 'tpl', title: 'Deep work', startTime: '14:00', duration: 60, color: 'bg-blue-500',
    recurrence: { type: 'weekly', days: [1] }, exceptions: {}, ...extra,
  });

  it('carries the override onto the one-off', () => {
    const { postponeTask, getTasks } = build(series({ energy: 'restore' }));
    postponeTask('recurring-tpl-2026-11-09');
    expect(getTasks()).toHaveLength(1);
    expect(getTasks()[0]).toMatchObject({ date: '2026-11-10', energy: 'restore' });
  });

  it('adds no energy where the series had none', () => {
    const { postponeTask, getTasks } = build(series());
    postponeTask('recurring-tpl-2026-11-09');
    expect(getTasks()[0]).not.toHaveProperty('energy');
  });
});
