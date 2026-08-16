// Routes tray background actions (tray popup mutations relayed through the
// main process) to the app's mutators. Extracted pure from useElectronBridge
// so the mapping is unit-tested: these are the actions the end-to-end ack
// (tray:action-applied) depends on reaching a handler.
//
// `refs` is the hook's live-synced ref object: each entry is a React ref
// whose .current is reassigned every render, so handlers are read at call
// time, never captured.

export function dispatchBackgroundAction(payload, refs) {
  if (!payload?.action) return;
  const {
    toggleCompleteRef,
    setUnscheduledTasksRef,
    incrementHabitRef,
    setHabitCountRef,
    toggleRoutineCompletionRef,
    setTasksRef,
    moveToRecycleBinRef,
    clearDeadlineRef,
    exitFocusModeRef,
    skipFocusPhaseRef,
    dismissReminderRef,
    snoozeReminderRef,
  } = refs;
  if (payload.action === 'toggle-complete') {
    toggleCompleteRef.current?.(payload.taskId, false);
  } else if (payload.action === 'add-inbox-task' && payload.task) {
    setUnscheduledTasksRef.current?.(prev => [...(prev || []), payload.task]);
  } else if (payload.action === 'increment-habit' && payload.habitId) {
    incrementHabitRef.current?.(payload.habitId);
  } else if (payload.action === 'set-habit-count' && payload.habitId != null) {
    setHabitCountRef.current?.(payload.habitId, payload.count);
  } else if (payload.action === 'toggle-routine' && payload.routineId) {
    toggleRoutineCompletionRef.current?.(payload.routineId);
  } else if (payload.action === 'move-to-inbox' && payload.taskId) {
    setTasksRef.current?.(prev => prev.filter(t => t.id !== payload.taskId));
    if (payload.inboxTask) setUnscheduledTasksRef.current?.(prev => [...(prev || []), payload.inboxTask]);
  } else if (payload.action === 'move-to-recycle-bin' && payload.taskId) {
    moveToRecycleBinRef.current?.(payload.taskId, !!payload.isInbox);
  } else if (payload.action === 'clear-deadline' && payload.taskId) {
    clearDeadlineRef.current?.(payload.taskId);
  } else if (payload.action === 'focus-stop') {
    exitFocusModeRef.current?.(true);
  } else if (payload.action === 'focus-skip') {
    skipFocusPhaseRef.current?.();
  } else if (payload.action === 'dismiss-reminder' && payload.reminderId) {
    dismissReminderRef.current?.(payload.reminderId);
  } else if (payload.action === 'snooze-reminder' && payload.reminder) {
    snoozeReminderRef.current?.(payload.reminder);
  }
}
