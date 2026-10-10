// Carries out what a Check entry offers (carryForward.js decides it) through
// the app's ordinary task actions. Nothing here touches the ledger.
//
// Continue is Postpone with a chosen slot: the same imported-event clash
// check, one step of undo history, and the same plain move of the task, so
// the persist pass counts it in `deferrals` and `planTrail` as it does any
// move of a task that had come due. The other actions open the app's own
// task form; saving there is the usual add or edit.
import { followUpDraft } from './carryForward.js';
import { obstacleName } from '../utils/dayOccupancy.js';

const sameId = (a, b) => String(a) === String(b);

export function createCarryForwardActions({
  tasks = [], setTasks, pushUndo, getAdjustedTimeForImportedConflicts, playUISound,
  openMobileEditTask, setNewTask, setShowAddTask, setMobileEditingTask, swipeSchedulingInboxTaskId,
  getNextQuarterHour, newTaskInputRef, projects = [], moveToInbox, moveToRecycleBin, openMakeTask,
  schedule = callback => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : setTimeout(callback, 0)),
}) {
  /**
   * Move the task to `action.slot`, unless it changed since the Check drew
   * the button (completed, moved or gone, here or from another device) or the
   * slot clashes with an imported event.
   */
  function continueTask(action, fromDate) {
    const id = action?.task?.id;
    const slot = action?.slot;
    const live = tasks.find(task => sameId(task.id, id));
    if (!live || !slot || live.completed || live.date !== fromDate) return { stale: true };
    if (!slot.isAllDay) {
      const { conflicted, conflictingEvent } = getAdjustedTimeForImportedConflicts(live.id, slot.startTime, slot.duration, slot.date) || {};
      if (conflicted) {
        playUISound?.('error');
        return { conflict: { title: obstacleName(conflictingEvent) || '' } };
      }
    }
    pushUndo();
    setTasks(prev => prev.map(task => (sameId(task.id, live.id)
      ? { ...task, date: slot.date, startTime: slot.startTime, duration: slot.duration }
      : task)));
    playUISound?.('slide');
    return { moved: true };
  }

  /** The task's own editor, opened on `date` (Edit after a clash, and Schedule…). */
  function editOn(task, date) {
    if (swipeSchedulingInboxTaskId) swipeSchedulingInboxTaskId.current = null;
    // Not the Inbox flavour: an unscheduled task saved from here is scheduled.
    openMobileEditTask(task, false);
    setNewTask(prev => ({ ...prev, date, keepUnscheduled: false }));
  }

  /** The new-task form, pre-filled as a follow-up; the caret goes before the tags. */
  function openFollowUp(task, date) {
    const { cursor, ...draft } = followUpDraft(task, { projects });
    if (swipeSchedulingInboxTaskId) swipeSchedulingInboxTaskId.current = null;
    setMobileEditingTask?.(null);
    setNewTask({
      startTime: getNextQuarterHour(), duration: 30, date, isAllDay: false, recurrence: null,
      ...draft,
    });
    setShowAddTask(true);
    // The form focuses its title on mount; place the caret only if it did.
    schedule(() => {
      const input = newTaskInputRef?.current;
      if (input && input === input.ownerDocument?.activeElement) input.setSelectionRange(cursor, cursor);
    });
  }

  // A task the Check still shows on `fromDate`, as it stands now, or null
  // when it changed since the button was drawn: completed, moved or gone,
  // here or from another device.
  const liveOn = (task, fromDate) => {
    const live = tasks.find(row => sameId(row.id, task?.id));
    return live && !live.completed && live.date === fromDate ? live : null;
  };

  /**
   * Take a task not started off the timeline, through the app's own move: it
   * keeps its project, so a project task lands in that project's list. One
   * step of undo history, which the move pushes itself.
   */
  function unscheduleTask(task, fromDate) {
    const live = liveOn(task, fromDate);
    if (!live || live.imported) return { stale: true };
    moveToInbox(live.id);
    return { moved: true };
  }

  /** Delete a task not started, through the app's own delete: to the Recycle Bin. */
  function deleteTask(task, fromDate) {
    const live = liveOn(task, fromDate);
    if (!live || live.imported) return { stale: true };
    moveToRecycleBin(live.id);
    return { deleted: true };
  }

  // "Make a task" from an unlinked Do: the app's opener (App.jsx), offered
  // only while the ledger can take the link, so it is absent otherwise.
  const makeTask = typeof openMakeTask === 'function' ? record => openMakeTask(record) : null;

  return { continueTask, editOn, openFollowUp, unscheduleTask, deleteTask, makeTask };
}
