// Completing a task from its continuation (#2278): the piece after midnight
// is the same task, so its checkbox completes the task, and the piece of a
// recurring occurrence completes THAT occurrence (the date it started on),
// never the next date's. Walked from the rows the next date draws through the
// app's own toggleComplete, and on to the JOBO detector, which keys its Do
// record on the completion stamp, not on the date it was seen on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { continuationsFromPreviousDay } from '@glance-apps/agenda-core';
import useTaskActions from './useTaskActions.js';
import { parseRecurringId } from '../utils/recurringId.js';
import { expandRecurringTasks } from '../utils/expandRecurringTasks.js';
import { buildJoboRecords, findJoboEdges, snapshotJoboState } from '../jobo/detector.js';
vi.mock('../native.js', () => ({ triggerHaptic: vi.fn() }));

const TUE = '2026-11-03';
const WED = '2026-11-04';
let state;
const useActions = () => useTaskActions({
  ...state,
  setTasks: fn => { state.tasks = fn(state.tasks); },
  setUnscheduledTasks: fn => { state.unscheduledTasks = fn(state.unscheduledTasks); },
  setRecurringTasks: fn => { state.recurringTasks = fn(state.recurringTasks); },
  onboardingProgress: { hasCompletedTask: true }, pushUndo: vi.fn(), playUISound: vi.fn(), setUndoToast: vi.fn(),
  parseRecurringId,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${WED}T00:30:00`)); // the task is still running
  state = { tasks: [], unscheduledTasks: [], recurringTasks: [], recycleBin: [] };
});
afterEach(() => { vi.useRealTimers(); });

describe('the continuation\'s checkbox', () => {
  it('completes the one task, which stays on the date it started', () => {
    state.tasks = [{ id: 't1', title: 'Night shift', date: TUE, startTime: '23:00', duration: 120, completed: false }];
    const [c] = continuationsFromPreviousDay(state.tasks.filter(t => t.date === TUE));
    useActions().toggleComplete(c.task.id);
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({ id: 't1', date: TUE, completed: true });
  });

  it('completes the recurring occurrence it belongs to (its own date), not the next date\'s', () => {
    state.recurringTasks = [{
      id: 's', title: 'Night shift', startTime: '23:00', duration: 120,
      recurrence: { type: 'daily', startDate: '2026-11-01' }, completedDates: [], exceptions: {},
    }];
    // The app's expansion keeps last night's still-running occurrence.
    const expanded = expandRecurringTasks(state.recurringTasks, { rangeStart: TUE, rangeEnd: WED, today: WED });
    const [c] = continuationsFromPreviousDay(expanded.filter(t => t.date === TUE));
    expect(c.task.id).toBe(`recurring-s-${TUE}`);
    useActions().toggleComplete(c.task.id);
    expect(state.recurringTasks[0].completedDates).toEqual([TUE]);
    expect(Object.keys(state.recurringTasks[0].completedDatesTimestamps)).toEqual([TUE]);
  });

  it('JOBO records one Do, keyed on the completion stamp, dated by it (unchanged by the continuation)', () => {
    state.tasks = [{ id: 't1', title: 'Night shift', date: TUE, startTime: '23:00', duration: 120, completed: false }];
    const prev = snapshotJoboState(state.tasks, [], []);
    const [c] = continuationsFromPreviousDay(state.tasks);
    useActions().toggleComplete(c.task.id);
    const edges = findJoboEdges(prev, snapshotJoboState(state.tasks, [], []), { tasks: state.tasks, recurringTasks: [] });
    const records = buildJoboRecords(edges, [], { observedAt: new Date().toISOString() });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ taskId: 't1', source: 'completion' });
    // The Do date is the stamp's own date (the moment it was checked), as for
    // any completion: the detector never reads the date it was drawn on.
    expect(records[0].date).toBe(state.tasks[0].completedAt.slice(0, 10));
  });
});
