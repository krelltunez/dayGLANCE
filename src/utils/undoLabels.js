// What an undo step did, in words: "Completed "Write report"". Pure.
//
// A step is labelled where it is pushed (`pushUndo({ key, taskId })`), and the
// label is put into words then, while the task still has the title it had
// before the change. The same words serve the toast that confirms the action
// and the one that reports its undo ("Undone: Completed "Write report"") or
// redo, so the two always read as a pair.
//
// A task with no title, or one the lists do not hold, is named "Untitled"
// rather than shown as empty quotes.
import { parseRecurringId } from './recurringId.js';
import { stripWikilinksAndTags } from './taskUtils.js';

// Every label key, under `undo.action` in the locale bundles (a key with a
// count has `_one` / `_other` forms there). The test holds each one to a real
// entry in every language.
export const UNDO_LABELS = [
  'added',
  'edited',
  'renamed',
  'completed',
  'uncompleted',
  'deleted',
  'restored',
  'binEmptied',
  'moved',
  'resized',
  'toInbox',
  'toBucket',
  'scheduled',
  'scheduledDroppedDeadline',
  'postponed',
  'deadlineSet',
  'deadlinePostponed',
  'deadlineCleared',
  'priority',
  'energy',
  'color',
  'subtaskAdded',
  'subtasksAdded',
  'subtaskChanged',
  'subtaskDeleted',
  'subtasksReordered',
  'snoozed',
  'frameSkipped',
  'frameAdjusted',
  'frameSetDeleted',
  'smartScheduled',
  'rescheduled',
  'voiceApplied',
  'tagRenamed',
  'tagMerged',
  'tagRemoved',
];
const KNOWN = new Set(UNDO_LABELS);

const MAX_TITLE = 40;

/**
 * A task title as a toast quotes it: plain text, cut to fit one line. A note
 * link reads as its text ("Read [[Project brief]]" is "Read Project brief"),
 * where the task card would show it as a chip beside the title instead.
 */
export function shortTitle(title) {
  if (typeof title !== 'string') return '';
  const linked = title.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, note, alias) => alias || note);
  const plain = stripWikilinksAndTags(linked) || title.trim();
  return plain.length > MAX_TITLE ? `${plain.slice(0, MAX_TITLE - 1).trimEnd()}…` : plain;
}

/**
 * The title of the task `id` names, from the lists an undo step covers: a
 * scheduled or Inbox task, one in the recycle bin, or a recurring
 * occurrence's series. Empty when none has it.
 */
export function findTaskTitle(id, { tasks = [], unscheduledTasks = [], recycleBin = [], recurringTasks = [] } = {}) {
  if (id === undefined || id === null) return '';
  const same = (task) => task && String(task.id) === String(id);
  const found = tasks.find(same) || unscheduledTasks.find(same) || recycleBin.find(same);
  if (found) return found.title || '';
  const parsed = parseRecurringId(id);
  if (!parsed) return '';
  const template = recurringTasks.find((task) => task && String(task.id) === String(parsed.templateId));
  return template?.title || '';
}

/**
 * A label in words, or null when it has no known key (or there is no `t`).
 * `label` is `{ key, taskId?, title?, ...params }`: `title` is used as given,
 * otherwise `taskId` is looked up in `lists`. `t` is i18next's.
 */
export function describeUndoLabel(t, label, lists) {
  if (!label || typeof t !== 'function' || !KNOWN.has(label.key)) return null;
  const { key, taskId, title, ...params } = label;
  const name = shortTitle(title ?? findTaskTitle(taskId, lists)) || t('undo.untitled');
  return t(`undo.action.${key}`, { ...params, title: name });
}
