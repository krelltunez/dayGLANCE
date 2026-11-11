// Task references in notes (#2145): copying a link to a task, the `@@` picker
// that inserts one while typing a note, and the backlinks a linked task shows.
// Pure; the link itself is the follow-up's (utils/followUp.js), the app's own
// `dayglance://task?id=…` Markdown link, so none of this adds a task field.
//
// A link is to a task the app keeps: a scheduled or Inbox task, or one
// occurrence of a recurring task (its occurrence id). Never a calendar event
// (the calendar owns it, and its id is not ours) or a recurring template.
import { canFollowUp, doneDateOf, findTaskLinks, plainTitle, resolveTaskRef } from './followUp.js';
import { parseRecurringId } from './recurringId.js';
import { extractTags } from './taskUtils.js';

/** Whether `task` can be linked to: the follow-up's rule, a task we own. */
export const canLinkTask = canFollowUp;

/** What opens the picker: `@@` and the words typed after it. */
const PICKER_TRIGGER = '@@';
const PICKER_MAX = 8;

/**
 * The picker's query at the caret: `{ start, query }` when the text before
 * the caret ends in `@@` and the words after it (on this line, no second
 * `@@`), else null. `start` is where the `@@` begins.
 */
export function pickerQueryAt(text, caret) {
  const before = String(text ?? '').slice(0, caret);
  const start = before.lastIndexOf(PICKER_TRIGGER);
  if (start === -1) return null;
  const query = before.slice(start + PICKER_TRIGGER.length);
  if (/[\n@]/.test(query) || query.length > 60) return null;
  return { start, query };
}

/**
 * Replace the `@@query` ending at `caret` with a link to `task` and a space.
 * Returns the new text and where the caret goes (after the space).
 */
export function insertTaskLink(text, { start, caret }, task, link) {
  const value = String(text ?? '');
  const insert = `${link(task)} `;
  return { text: value.slice(0, start) + insert + value.slice(caret), caret: start + insert.length };
}

/**
 * The tasks the picker offers for `query`: linkable scheduled and Inbox
 * tasks (not `excludeId`, the task being edited) whose title, as plain
 * words, contains the query, or one of whose #tags does (#2369: the plain
 * title has no tags, so a task found by its tag was not found at all). A
 * leading `#` is the tag's own mark: `@@home` and `@@#home` both find
 * "Call the roofer #home", and `@@#home` only by its tag. Open before done,
 * then a title or a tag that starts with the query, then the most recently
 * dated. At most PICKER_MAX.
 *
 * Each candidate carries `tags`: the tags it was found by when its title
 * was not, for the picker to show why it is listed; empty otherwise.
 */
export function linkCandidates({ tasks = [], unscheduledTasks = [] }, query, { excludeId = null, limit = PICKER_MAX } = {}) {
  const q = String(query ?? '').trim().toLowerCase();
  const tagQ = q.replace(/^#+/, '');
  const seen = new Set();
  const out = [];
  for (const task of [...tasks, ...unscheduledTasks]) {
    if (!task || task._native || !canLinkTask(task)) continue;
    const id = String(task.id);
    if (id === String(excludeId) || seen.has(id)) continue;
    const title = plainTitle(task.title);
    if (!title) continue;
    const lower = title.toLowerCase();
    const byTitle = !q || lower.includes(q);
    const tags = byTitle || !tagQ ? [] : extractTags(task.title).filter((tag) => tag.includes(tagQ));
    if (!byTitle && !tags.length) continue;
    seen.add(id);
    const starts = !!q && (lower.startsWith(q) || tags.some((tag) => tag.startsWith(tagQ)));
    out.push({ task, title, tags, starts });
  }
  out.sort((a, b) =>
    (!!a.task.completed - !!b.task.completed)
    || (b.starts - a.starts)
    || String(b.task.date || '').localeCompare(String(a.task.date || '')));
  return out.slice(0, limit).map(({ task, title, tags }) => ({ task, title, tags }));
}

/**
 * The tasks whose notes link to `id`, in list order: scheduled tasks, then
 * the Inbox. A task linking to itself does not count. Recurring templates'
 * notes are not read: a link back to a template has nowhere to open.
 *
 * @returns {Array<{ task: object, title: string }>}
 */
export function findBacklinks(id, { tasks = [], unscheduledTasks = [] }) {
  if (id == null || id === '') return [];
  const key = String(id);
  // A cheap test before the parse: most notes link to nothing.
  const needle = `dayglance://task?id=${encodeURIComponent(key)}`;
  const out = [];
  const seen = new Set();
  for (const task of [...tasks, ...unscheduledTasks]) {
    if (!task || task._native || String(task.id) === key || seen.has(String(task.id))) continue;
    const notes = typeof task.notes === 'string' ? task.notes : '';
    if (!notes.includes(needle)) continue;
    if (!findTaskLinks(notes).some(link => link.id === key)) continue;
    seen.add(String(task.id));
    out.push({ task, title: plainTitle(task.title) });
  }
  return out;
}

/**
 * Every link between the tasks we keep, read in one pass over the notes:
 * `out` (id → the ids its notes link to, in order), `in` (id → the ids whose
 * notes link to it, in list order), `labels` (id → the first link's label,
 * what a task that is gone is still called) and `live` (id → the task).
 * Self-links and repeats are dropped. A recurring occurrence is never a
 * source: it carries its template's notes, and reading them would join every
 * occurrence of the series into one thread.
 */
export function buildLinkIndex({ tasks = [], unscheduledTasks = [] }) {
  const out = new Map();
  const into = new Map();
  const labels = new Map();
  const live = new Map();
  for (const task of [...tasks, ...unscheduledTasks]) {
    if (!task || task._native || task.id == null) continue;
    const id = String(task.id);
    if (live.has(id)) continue;
    live.set(id, task);
    const notes = typeof task.notes === 'string' ? task.notes : '';
    if (!notes.includes('dayglance://task?id=') || parseRecurringId(id)) continue;
    const targets = [];
    for (const link of findTaskLinks(notes)) {
      if (link.id === id || targets.includes(link.id)) continue;
      targets.push(link.id);
      if (!labels.has(link.id)) labels.set(link.id, link.label);
      if (!into.has(link.id)) into.set(link.id, []);
      into.get(link.id).push(id);
    }
    if (targets.length) out.set(id, targets);
  }
  return { out, in: into, labels, live };
}

/** How many tasks a thread lists before it says how many more. */
const THREAD_MAX = 30;

/**
 * The thread `id` belongs to: every task reachable from it over links, in
 * either direction. Nearest first up to `limit` (so a long thread drops the
 * farthest, not the oldest), then ordered by date: the day it was done, else
 * the day it is planned for; the Inbox and tasks that are gone come last.
 *
 * Links are followed both ways from the tasks we keep. A task in the Recycle
 * Bin, a recurring occurrence or one that is gone has no notes of its own in
 * the index, so only the links INTO it are followed.
 *
 * @param refs the lists `resolveTaskRef` reads, for what is not live
 * @returns {{ items: Array<{ id, task, where, title, date, isSelf }>, open: number, more: number }}
 *   `task` and `where` are null for a task that is gone. `open` counts the
 *   listed tasks not done (gone and deleted ones aside).
 */
export function taskThread(id, index, refs = {}, { limit = THREAD_MAX } = {}) {
  if (id == null || id === '' || !index) return { items: [], open: 0, more: 0 };
  const start = String(id);
  const seen = new Set([start]);
  const order = [start];
  for (let i = 0; i < order.length; i += 1) {
    const at = order[i];
    for (const next of [...(index.out.get(at) || []), ...(index.in.get(at) || [])]) {
      if (seen.has(next)) continue;
      seen.add(next);
      order.push(next);
    }
  }
  const items = order.slice(0, limit).map((key, hop) => {
    const kept = index.live.get(key);
    const found = kept
      ? { task: kept, where: kept.date ? 'calendar' : 'inbox' }
      : resolveTaskRef(key, refs);
    const task = found?.task || null;
    const date = !task || found.where === 'deleted' ? ''
      : task.completed ? doneDateOf(task, task.date || '') : (task.date || '');
    return {
      id: key,
      task,
      where: found?.where || null,
      title: (task ? plainTitle(task.title) : '') || index.labels.get(key) || '',
      date,
      isSelf: key === start,
      hop,
    };
  });
  items.sort((a, b) => (!a.date - !b.date) || a.date.localeCompare(b.date) || a.hop - b.hop);
  const open = items.filter(item => item.task && item.where !== 'deleted' && !item.task.completed).length;
  return { items: items.map(({ hop: _hop, ...item }) => item), open, more: order.length - items.length };
}
