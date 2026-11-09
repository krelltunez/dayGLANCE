// The notes & subtasks panel in the New/Edit Task modals (desktop and phone):
// which task it edits, and how a new task's draft is kept until Add.
//
// Editing a task that exists, the panel edits that task as it stands, saving
// through the app's own actions at once, as every other notes panel does;
// Save keeps them, since it writes over the task as it stands. A new task
// has no row yet, so its notes and subtasks are a draft on newTask, which
// addTask copies onto the task it creates.
import { parseRecurringId } from './recurringId.js';
import { occurrenceSubtasks } from './recurringSubtasks.js';

/**
 * What the panel shows.
 *
 * @param {object} p
 * @param {object | null} p.editingTask  the task the modal edits, if any
 * @param {*} [p.schedulingId]           an Inbox task the modal is scheduling (a phone swipe)
 * @returns {{ kind: 'live', task: object, isInbox: boolean } | { kind: 'draft' } | null}
 *   null where the modal has no panel: a calendar event (its notes are the
 *   event's own, edited elsewhere), a series template, or a task not found.
 */
export function modalNotesTarget({ editingTask, schedulingId, tasks = [], unscheduledTasks = [], recurringTasks = [] }) {
  const id = editingTask?.id ?? schedulingId ?? null;
  if (id == null) return { kind: 'draft' };
  const occurrence = parseRecurringId(id);
  if (occurrence) {
    // An occurrence's notes and subtask list are its series', and the app's
    // notes actions write them there; which subtasks are ticked is this
    // date's (utils/recurringSubtasks.js).
    const template = recurringTasks.find((candidate) => candidate.id === occurrence.templateId);
    if (!template) return null;
    return { kind: 'live', task: { ...editingTask, notes: template.notes || '', subtasks: occurrenceSubtasks(template, occurrence.dateStr) }, isInbox: false };
  }
  const inbox = unscheduledTasks.find((candidate) => candidate.id === id);
  if (inbox) return { kind: 'live', task: inbox, isInbox: true };
  const scheduled = tasks.find((candidate) => candidate.id === id);
  if (scheduled && !scheduled.imported) return { kind: 'live', task: scheduled, isInbox: false };
  return null;
}

/**
 * One edit to a new task's draft, or newTask unchanged when the draft is not
 * this panel's. The key is stamped on newTask as the panel opens; Add resets
 * newTask without it, so a save the panel makes as it closes (it saves
 * unsaved text on unmount) cannot reach the next new task.
 */
export function applyDraftEdit(newTask, key, edit) {
  if (!newTask || newTask.notesDraftKey !== key) return newTask;
  const subtasks = newTask.subtasks || [];
  switch (edit.type) {
    case 'notes':
      return { ...newTask, notes: edit.notes };
    case 'addSubtask':
      return { ...newTask, subtasks: [...subtasks, edit.subtask] };
    case 'toggleSubtask':
      return { ...newTask, subtasks: subtasks.map((st) => (st.id === edit.id ? { ...st, completed: !st.completed } : st)) };
    case 'deleteSubtask':
      return { ...newTask, subtasks: subtasks.filter((st) => st.id !== edit.id) };
    case 'renameSubtask':
      return { ...newTask, subtasks: subtasks.map((st) => (st.id === edit.id ? { ...st, title: edit.title } : st)) };
    default:
      return newTask;
  }
}

/** Whether a task, or a draft, holds any notes or subtasks: the toggle's dot. */
export const hasNotesContent = (task) => !!((task?.notes || '').trim() || (task?.subtasks || []).length);
