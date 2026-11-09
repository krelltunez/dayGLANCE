import { describe, it, expect, vi } from 'vitest';
import useTaskActions from './useTaskActions.js';
import { draftWithProjectDefaults } from '../utils/projectTaskDefaults.js';
import { blockEnergySource } from '../utils/energyAxis.js';
import { TASK_COLORS } from '../utils/colorUtils.js';

// #2336 follow-up: a project's energy default reaches the task the new-task
// form saves. Walks the draft as the form's project field writes it
// (draftWithProjectDefaults), then Add, and reads the row the app stores and
// the energy its card would show.
const DAY = '2026-11-09';
const calm = { id: 'p-calm', title: 'Unwind', color: 'bg-teal-500', taskDefaults: { energy: 'restore' } };

function build(newTask) {
  const setTasks = vi.fn();
  const setUnscheduledTasks = vi.fn();
  const setRecurringTasks = vi.fn();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const actions = useTaskActions({
    tasks: [], setTasks, unscheduledTasks: [], setUnscheduledTasks,
    recurringTasks: [], setRecurringTasks,
    selectedDate: new Date(`${DAY}T12:00:00`), newTask, setNewTask: vi.fn(), setShowAddTask: vi.fn(),
    pushUndo: vi.fn(), playUISound: vi.fn(), setUndoToast: vi.fn(), setSyncNotification: vi.fn(),
    getAdjustedTimeForImportedConflicts: (_id, startTime) => ({ conflicted: false, adjustedStartTime: startTime, conflictingEvent: null }),
    onboardingProgress: { hasAddedScheduledTask: true, hasAddedInboxTask: true, hasUsedTags: true, hasCreatedRecurring: true },
    setOnboardingProgress: vi.fn(), swipeSchedulingInboxTaskId: { current: null },
    colors: TASK_COLORS, getNextQuarterHour: () => '09:00', parseRecurringId: () => null,
  });
  const stored = (setter) => setter.mock.calls[0][0]([]).at(-1);
  return { actions, stored: () => stored(setTasks), storedInbox: () => stored(setUnscheduledTasks), storedTemplate: () => stored(setRecurringTasks) };
}

const draft = (over = {}) => draftWithProjectDefaults(
  { title: 'Write the report', startTime: '10:00', duration: 30, date: DAY, isAllDay: false, recurrence: null, notes: '', subtasks: [], ...over },
  null, calm,
);

describe('a new task in a project with an energy default', () => {
  // MUTATION: drop carryEnergy(newTask) from addTask and these fail.
  it('scheduled: Restore, though its title would read Effort, and shown as the user\'s own', () => {
    const { actions, stored } = build({ ...draft(), projectId: 'p-calm' });
    actions.addTask(false);
    expect(stored().energy).toBe('restore');
    expect(blockEnergySource(stored())).toEqual({ energy: 'restore', setByUser: true });
  });

  it('to the Inbox, and as a series', () => {
    const inbox = build({ ...draft(), projectId: 'p-calm' });
    inbox.actions.addTask(true);
    expect(inbox.storedInbox().energy).toBe('restore');
    const series = build({ ...draft({ recurrence: { type: 'daily', interval: 1 } }), projectId: 'p-calm' });
    series.actions.addTask(false);
    expect(series.storedTemplate().energy).toBe('restore');
  });

  it('a task in no project gets no energy field', () => {
    const { actions, stored } = build({ title: 'Plain', startTime: '10:00', duration: 30, date: DAY, isAllDay: false });
    actions.addTask(false);
    expect(stored()).not.toHaveProperty('energy');
  });
});
