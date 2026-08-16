import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchBackgroundAction } from './trayActionDispatch.js';

// The contract: every tray background action reaches exactly its handler with
// the right arguments, guarded routes no-op when their payload key is absent,
// unknown actions and missing handlers are silent, and the ackId the preload
// stamps onto every payload (PR #1381) rides along harmlessly.

const REF_NAMES = [
  'toggleCompleteRef', 'setUnscheduledTasksRef', 'incrementHabitRef',
  'setHabitCountRef', 'toggleRoutineCompletionRef', 'setTasksRef',
  'moveToRecycleBinRef', 'clearDeadlineRef', 'exitFocusModeRef',
  'skipFocusPhaseRef', 'dismissReminderRef', 'snoozeReminderRef',
];

let refs;
beforeEach(() => {
  refs = Object.fromEntries(REF_NAMES.map(n => [n, { current: vi.fn() }]));
});

const calledOnly = (...names) => {
  for (const n of REF_NAMES) {
    if (names.includes(n)) expect(refs[n].current, n).toHaveBeenCalledTimes(1);
    else expect(refs[n].current, n).not.toHaveBeenCalled();
  }
};

describe('dispatchBackgroundAction routing', () => {
  it('toggle-complete completes without opening the task (skipModal false)', () => {
    dispatchBackgroundAction({ action: 'toggle-complete', taskId: 't1' }, refs);
    expect(refs.toggleCompleteRef.current).toHaveBeenCalledWith('t1', false);
    calledOnly('toggleCompleteRef');
  });

  it('add-inbox-task appends the task, preserving existing inbox (null-safe)', () => {
    const task = { id: 'new' };
    dispatchBackgroundAction({ action: 'add-inbox-task', task }, refs);
    const updater = refs.setUnscheduledTasksRef.current.mock.calls[0][0];
    expect(updater([{ id: 'old' }])).toEqual([{ id: 'old' }, task]);
    expect(updater(null)).toEqual([task]);
  });

  it('increment-habit and set-habit-count route with their ids and count', () => {
    dispatchBackgroundAction({ action: 'increment-habit', habitId: 'h1' }, refs);
    expect(refs.incrementHabitRef.current).toHaveBeenCalledWith('h1');
    dispatchBackgroundAction({ action: 'set-habit-count', habitId: 'h1', count: 4 }, refs);
    expect(refs.setHabitCountRef.current).toHaveBeenCalledWith('h1', 4);
  });

  it('toggle-routine routes the routine id', () => {
    dispatchBackgroundAction({ action: 'toggle-routine', routineId: 'r1' }, refs);
    expect(refs.toggleRoutineCompletionRef.current).toHaveBeenCalledWith('r1');
  });

  it('move-to-inbox removes the task and appends the inbox copy when provided', () => {
    dispatchBackgroundAction({ action: 'move-to-inbox', taskId: 't1', inboxTask: { id: 't1' } }, refs);
    const removeUpdater = refs.setTasksRef.current.mock.calls[0][0];
    expect(removeUpdater([{ id: 't1' }, { id: 't2' }])).toEqual([{ id: 't2' }]);
    expect(refs.setUnscheduledTasksRef.current).toHaveBeenCalledTimes(1);
  });

  it('move-to-inbox without an inbox copy only removes', () => {
    dispatchBackgroundAction({ action: 'move-to-inbox', taskId: 't1' }, refs);
    expect(refs.setTasksRef.current).toHaveBeenCalledTimes(1);
    expect(refs.setUnscheduledTasksRef.current).not.toHaveBeenCalled();
  });

  it('move-to-recycle-bin normalizes isInbox to a boolean', () => {
    dispatchBackgroundAction({ action: 'move-to-recycle-bin', taskId: 't1' }, refs);
    expect(refs.moveToRecycleBinRef.current).toHaveBeenCalledWith('t1', false);
    dispatchBackgroundAction({ action: 'move-to-recycle-bin', taskId: 't2', isInbox: 1 }, refs);
    expect(refs.moveToRecycleBinRef.current).toHaveBeenCalledWith('t2', true);
  });

  it('clear-deadline routes the task id', () => {
    dispatchBackgroundAction({ action: 'clear-deadline', taskId: 't1' }, refs);
    expect(refs.clearDeadlineRef.current).toHaveBeenCalledWith('t1');
  });

  it('focus-stop exits silently (skipStats true); focus-skip advances the phase', () => {
    dispatchBackgroundAction({ action: 'focus-stop' }, refs);
    expect(refs.exitFocusModeRef.current).toHaveBeenCalledWith(true);
    dispatchBackgroundAction({ action: 'focus-skip' }, refs);
    expect(refs.skipFocusPhaseRef.current).toHaveBeenCalledWith();
  });

  it('dismiss-reminder and snooze-reminder route id and reminder object respectively', () => {
    dispatchBackgroundAction({ action: 'dismiss-reminder', reminderId: 'rem1' }, refs);
    expect(refs.dismissReminderRef.current).toHaveBeenCalledWith('rem1');
    const reminder = { id: 'rem2' };
    dispatchBackgroundAction({ action: 'snooze-reminder', reminder }, refs);
    expect(refs.snoozeReminderRef.current).toHaveBeenCalledWith(reminder);
  });
});

describe('dispatchBackgroundAction guards', () => {
  it('guarded routes no-op when their payload key is missing', () => {
    dispatchBackgroundAction({ action: 'add-inbox-task' }, refs);
    dispatchBackgroundAction({ action: 'increment-habit' }, refs);
    dispatchBackgroundAction({ action: 'set-habit-count' }, refs);
    dispatchBackgroundAction({ action: 'toggle-routine' }, refs);
    dispatchBackgroundAction({ action: 'move-to-inbox' }, refs);
    dispatchBackgroundAction({ action: 'move-to-recycle-bin' }, refs);
    dispatchBackgroundAction({ action: 'clear-deadline' }, refs);
    dispatchBackgroundAction({ action: 'dismiss-reminder' }, refs);
    dispatchBackgroundAction({ action: 'snooze-reminder' }, refs);
    calledOnly();
  });

  it('unknown actions, missing action, and null payloads are silent no-ops', () => {
    dispatchBackgroundAction({ action: 'not-a-thing', taskId: 't1' }, refs);
    dispatchBackgroundAction({}, refs);
    dispatchBackgroundAction(null, refs);
    dispatchBackgroundAction(undefined, refs);
    calledOnly();
  });

  it('a missing handler (ref.current unset) does not throw', () => {
    refs.toggleCompleteRef.current = undefined;
    expect(() => dispatchBackgroundAction({ action: 'toggle-complete', taskId: 't1' }, refs)).not.toThrow();
  });

  it('the preload-stamped ackId rides along without affecting routing', () => {
    dispatchBackgroundAction({ action: 'toggle-complete', taskId: 't1', ackId: 'uuid-1' }, refs);
    expect(refs.toggleCompleteRef.current).toHaveBeenCalledWith('t1', false);
    calledOnly('toggleCompleteRef');
  });
});
