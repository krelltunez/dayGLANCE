import { describe, it, expect, vi } from 'vitest';
import useTaskActions from './useTaskActions.js';

// useTaskActions is a plain factory (no React hooks in its body), so it can be
// called directly with just the deps the function under test touches.
const buildActions = () => {
  const setNewTask = vi.fn();
  const setShowAddTask = vi.fn();
  const setShowRecurrencePicker = vi.fn();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { openNewAllDayTask } = useTaskActions({
    setNewTask, setShowAddTask, setShowRecurrencePicker,
  });
  return { openNewAllDayTask, setNewTask, setShowAddTask, setShowRecurrencePicker };
};

describe('openNewAllDayTask — date-header tap in every view', () => {
  it('opens the new-task form on the tapped date with All Day pre-selected', () => {
    const { openNewAllDayTask, setNewTask, setShowAddTask } = buildActions();

    openNewAllDayTask('2026-03-14');

    expect(setNewTask).toHaveBeenCalledTimes(1);
    const draft = setNewTask.mock.calls[0][0];
    expect(draft.date).toBe('2026-03-14');
    expect(draft.isAllDay).toBe(true);
    expect(draft.title).toBe('');
    expect(setShowAddTask).toHaveBeenCalledWith(true);
  });

  it('clears any recurrence carried over from a previous draft', () => {
    const { openNewAllDayTask, setNewTask, setShowRecurrencePicker } = buildActions();

    openNewAllDayTask('2026-03-14');

    expect(setNewTask.mock.calls[0][0].recurrence).toBeNull();
    expect(setShowRecurrencePicker).toHaveBeenCalledWith(false);
  });
});
