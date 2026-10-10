import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useTaskActions from './useTaskActions.js';
import { parseRecurringId } from '../utils/recurringId.js';
vi.mock('../native.js', () => ({ triggerHaptic: vi.fn() }));

const ordinary = { id: 'a', title: 'Write', date: '2026-10-09', startTime: '09:00', duration: 25, completed: false };
let state, deps;
function useActions(over = {}) {
  deps = {
    ...state,
    setTasks: fn => { state.tasks = fn(state.tasks); },
    setUnscheduledTasks: fn => { state.unscheduledTasks = fn(state.unscheduledTasks); },
    setRecurringTasks: fn => { state.recurringTasks = fn(state.recurringTasks); },
    setFocusCompletedTasks: fn => { state.focusCompletedTasks = fn(state.focusCompletedTasks); },
    focusBlockTasks: [ordinary],
    onboardingProgress: { hasCompletedTask: true },
    pushUndo: vi.fn(), playUISound: vi.fn(), setUndoToast: vi.fn(), playFocusSound: vi.fn(),
    exitFocusModeRef: { current: vi.fn() }, parseRecurringId,
    ...over,
  };
  return useTaskActions(deps);
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T09:25:00Z'));
  state = { tasks: [{ ...ordinary }], unscheduledTasks: [], recurringTasks: [], recycleBin: [], focusCompletedTasks: new Set() };
});
afterEach(() => vi.useRealTimers());

describe('Focus completion reuses native task completion', () => {
  it('settlement uses the normal completion stamp/undo, with no delayed second exit', () => {
    expect(useActions().focusCompleteTask('a', { exitWhenDone: false, fromSettlement: true })).toBe(true);
    expect(state.tasks[0]).toMatchObject({ completed: true, completedAt: '2026-10-09T09:25:00+00:00' });
    expect(state.tasks[0].transitionId).toBeTruthy();
    expect(deps.pushUndo).toHaveBeenCalledOnce();
    vi.runAllTimers(); expect(deps.exitFocusModeRef.current).not.toHaveBeenCalled();
  });
  it('Focus commands cannot complete while settlement is pending or saving', () => {
    let pending = true;
    const handler = useActions({ isFocusSettlementPending: () => pending });
    expect(handler.focusCompleteTask('a')).toBe(false);
    expect(state.tasks[0].completed).toBe(false);
    expect(deps.pushUndo).not.toHaveBeenCalled();
    pending = false;
    expect(handler.focusCompleteTask('a', { exitWhenDone: false, fromSettlement: true })).toBe(true);
    expect(state.tasks[0].completed).toBe(true);
  });
  it('the existing Complete button keeps its automatic exit', () => {
    useActions().focusCompleteTask('a'); vi.advanceTimersByTime(500);
    expect(deps.exitFocusModeRef.current).toHaveBeenCalledWith(true);
  });
  it('an already completed task cannot be toggled back by a stale settlement', () => {
    state.tasks[0].completed = true;
    expect(useActions().focusCompleteTask('a', { exitWhenDone: false, fromSettlement: true })).toBe(false);
    expect(state.tasks[0].completed).toBe(true); expect(deps.pushUndo).not.toHaveBeenCalled();
  });
  it('a task moved to Inbox completes through the Inbox branch', () => {
    state.tasks = []; state.unscheduledTasks = [{ ...ordinary, date: undefined, startTime: undefined }];
    useActions().focusCompleteTask('a', { exitWhenDone: false, fromSettlement: true });
    expect(state.unscheduledTasks[0].completed).toBe(true); expect(state.tasks).toEqual([]);
  });
  it('a recurring task completes only the occurrence with the normal per-date stamp', () => {
    const id = 'recurring-r1-2026-10-09';
    state.tasks = []; state.recurringTasks = [{ id: 'r1', title: 'Write', completedDates: [] }];
    useActions({ focusBlockTasks: [{ ...ordinary, id }] }).focusCompleteTask(id, { exitWhenDone: false, fromSettlement: true });
    expect(state.recurringTasks[0]).toMatchObject({ completedDates: ['2026-10-09'], completedDatesTimestamps: { '2026-10-09': '2026-10-09T09:25:00.000Z' } });
  });
  it('the old command still uses the existing toggle behavior outside settlement', () => {
    state.tasks[0].completed = true;
    useActions().focusCompleteTask('a');
    expect(state.tasks[0].completed).toBe(false);
    expect(deps.pushUndo).toHaveBeenCalledOnce();
  });
  it('deleted or missing tasks are not recreated or completed', () => {
    state.tasks = []; state.recycleBin = [ordinary];
    expect(useActions().focusCompleteTask('a', { fromSettlement: true })).toBe(false);
    expect(useActions().focusCompleteTask('missing', { fromSettlement: true })).toBe(false);
    expect(deps.pushUndo).not.toHaveBeenCalled();
  });
});
