// "Schedule follow-up task": a finished task grows a follow-up in the Inbox,
// pre-filled from it, with a line in its notes that links back to it. Pure:
// the toast and the context menu open the app's own new-task form with what
// this returns, and saving there is the usual add.
//
// The link is the app's own deep link, `dayglance://task?id=…`, so it needs
// no new task field: inside the app a click shows the earlier task
// (components/TaskPeek.jsx), and on a phone the OS link opens the app on it.
import { followUpDraft } from '../jobo/carryForward.js';
import { TAG_NAME, splitTitleNoteLinks, stripMarkdownLinks, stripTags, tagsIn } from './taskUtils.js';
import { parseRecurringId } from './recurringId.js';
import { withTags } from './projectTaskDefaults.js';
import { occurrenceSubtasks } from './recurringSubtasks.js';

/** This device's tag for follow-ups, without its `#`; empty for none. */
export const FOLLOW_UP_TAG_KEY = 'dg-follow-up-tag';

/**
 * What the user typed in the setting, as a tag name: one word, any leading
 * `#` dropped. Anything that is not a valid tag is no tag.
 */
export function normalizeFollowUpTag(raw) {
  const name = String(raw ?? '').trim().replace(/^#+/, '');
  return TAG_NAME.test(name) ? name : '';
}

const TASK_LINK = 'dayglance://task?id=';

/** The window event a task link in a note fires; the app shows that task. */
export const PEEK_TASK_EVENT = 'dayglance:peek-task';

/**
 * A title as plain words, for the link and the peek: a [[wikilink]] reads as
 * its note's name, not dropped as lists drop it, so "Contact [[Robin]] re
 * meeting" stays a sentence; Markdown links read as their labels; no tags.
 */
export function plainTitle(title) {
  const words = splitTitleNoteLinks(stripMarkdownLinks(title))
    .map(part => (part.text !== undefined ? part.text : part.label)).join('');
  return stripTags(words).replace(/\s+/g, ' ').trim();
}

/** A Markdown link to `task`, labelled with its title as plain words. */
export function taskLink(task) {
  const label = plainTitle(task?.title).replace(/[[\]]/g, '').trim() || '…';
  return `[${label}](${TASK_LINK}${encodeURIComponent(String(task?.id ?? ''))})`;
}

/**
 * Every task link in `text`, as `{ index, length, label, id }`, in order.
 * Only links to a task: an ordinary Markdown link is left as typed.
 */
export function findTaskLinks(text) {
  const found = [];
  const re = /\[([^\]\n]+)\]\(dayglance:\/\/task\?id=([^)\s]+)\)/g;
  let match;
  while ((match = re.exec(String(text ?? ''))) !== null) {
    let id;
    try { id = decodeURIComponent(match[2]); } catch { continue; }
    found.push({ index: match.index, length: match[0].length, label: match[1], id });
  }
  return found;
}

/**
 * `text` as a note shows it: each task link reads as its label, the way
 * renderFormattedText draws it. Search reads notes this way, so "task" does
 * not find every note holding a link (its address is dayglance://task?id=…).
 */
export function taskLinksAsLabels(text) {
  const source = String(text ?? '');
  let out = '';
  let at = 0;
  for (const link of findTaskLinks(source)) {
    out += source.slice(at, link.index) + link.label;
    at = link.index + link.length;
  }
  return out + source.slice(at);
}

/** The civil date a task was finished on, else `fallback`. */
export function doneDateOf(task, fallback) {
  const stamp = typeof task?.completedAt === 'string' ? task.completedAt.slice(0, 10) : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(stamp)) return stamp;
  const occurrence = parseRecurringId(task?.id);
  return occurrence?.dateStr || fallback;
}

/** Whether a finished task can grow a follow-up: not a calendar event. */
export function canFollowUp(task) {
  if (!task || task.id == null) return false;
  if (task.imported && !task.isTaskCalendar) return false;
  return !task.nativeEventId;
}

/**
 * The new-task form's pre-fill for a follow-up to `task`.
 *
 * - The title is `prefix` and the task's title, with its tags and then the
 *   follow-up tag after it. `selection` covers the prefix, so typing
 *   ("Waiting on Robin:") replaces it.
 * - Its colour and, while that project is open, its project, as JOBO's
 *   follow-up (`followUpDraft`). Never its time, notes or subtasks.
 * - In a project, that project's New task defaults (#2336), as any task
 *   created there: their tags, duration and checklist. `note` wins over
 *   their notes, which fill in only without one.
 * - The Inbox, with no deadline yet: the deadline is the follow-up date.
 * - `note` as its notes: the line that links back.
 */
export function completionFollowUpDraft(task, { projects = [], prefix = '', tag = '', note = '' } = {}) {
  const base = followUpDraft(task, { projects });
  const seen = new Set();
  const tags = [...tagsIn(task?.title), ...(tag ? [tag] : [])]
    .filter(name => !seen.has(name.toLowerCase()) && seen.add(name.toLowerCase()));
  const body = stripTags(task?.title).replace(/\s+/g, ' ').trim();
  const head = [prefix.trim(), body].filter(Boolean).join(' ');
  const title = [head, ...tags.map(name => `#${name}`)].join(' ');
  return {
    // The project's default tags, which followUpDraft appended to its own.
    title: withTags(title, tagsIn(base.title)),
    selection: [0, prefix.trim().length],
    ...(base.color ? { color: base.color } : {}),
    ...(base.projectId != null ? { projectId: base.projectId } : {}),
    ...(base.duration ? { duration: base.duration } : {}),
    ...(base.subtasks ? { subtasks: base.subtasks } : {}),
    openInInbox: true,
    deadline: null,
    priority: 0,
    notes: note || base.notes || '',
  };
}

const occurrenceOf = (template, dateStr, id) => {
  const exception = template.exceptions?.[dateStr] || {};
  return {
    id,
    title: exception.title || template.title,
    notes: exception.notes !== undefined ? exception.notes : (template.notes || ''),
    subtasks: occurrenceSubtasks(template, dateStr),
    color: exception.color || template.color,
    date: dateStr,
    startTime: exception.startTime !== undefined ? exception.startTime : template.startTime,
    isAllDay: exception.isAllDay !== undefined ? exception.isAllDay : !!template.isAllDay,
    projectId: template.projectId,
    completed: (template.completedDates || []).includes(dateStr),
  };
};

/**
 * The task a link names, as it stands now: `{ task, where }`, where is
 * 'calendar', 'inbox', 'recurring' or 'deleted' (in the Recycle Bin). Null
 * when it is gone for good.
 */
export function resolveTaskRef(id, { tasks = [], unscheduledTasks = [], recurringTasks = [], recycleBin = [] } = {}) {
  if (id == null || id === '') return null;
  const key = String(id);
  const same = row => row && String(row.id) === key;
  const scheduled = tasks.find(same);
  if (scheduled) return { task: scheduled, where: 'calendar' };
  const inbox = unscheduledTasks.find(same);
  if (inbox) return { task: inbox, where: 'inbox' };
  const occurrence = parseRecurringId(key);
  if (occurrence) {
    const template = recurringTasks.find(row => String(row.id) === String(occurrence.templateId));
    if (template) return { task: occurrenceOf(template, occurrence.dateStr, key), where: 'recurring' };
  }
  const deleted = recycleBin.find(same);
  if (deleted) return { task: deleted, where: 'deleted' };
  return null;
}

/**
 * Where the peek's "Go to task" takes a resolved task (#2231), in the shape
 * search's navigation takes (useNavigation handleSpotlightSelect), so both
 * go the same way: the day it is on, scrolled to and highlighted, or its row
 * in the Inbox. An occurrence of a series is shown on its own day (its id is
 * the card's). Null where there is nowhere to go: a deleted task.
 */
export function peekNavigationTarget(found) {
  const task = found?.task;
  if (!task) return null;
  if (found.where === 'calendar' || found.where === 'recurring') {
    return task.date ? { task, source: 'scheduled' } : null;
  }
  if (found.where === 'inbox') return { task, source: task.archived ? 'archived' : 'inbox' };
  return null;
}
