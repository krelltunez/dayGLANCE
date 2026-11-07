// The tag manager (#2136): every tag in use, with the tasks that carry it,
// and renaming, merging or removing one across all of them. Pure.
//
// A tag is not a field: it is a `#word` in a task's title (taskUtils.js), so
// every change here is a title rewrite, the same edit a user makes by hand.
// It stamps, syncs, undoes and reaches an Obsidian-linked task's vault line
// the way that edit does, with no new field and no merge rule.
//
// What it rewrites: scheduled and Inbox tasks (Bucket List items included)
// and recurring series, each series' per-date title overrides too. What it
// leaves alone, and counts so the manager can say so:
//   - calendar events (`imported`): the calendar owns their titles;
//   - Todoist tasks (`task.todoist.id`): Todoist owns their titles, and the
//     integration sends nothing back but a completion, so a rewrite here
//     would only diverge from it;
//   - the Recycle Bin, which keeps what was deleted as it was.
//
// Tags compare without case, as the filters do (`#Work` is `#work`). A nested
// tag is its own tag: renaming `#work` leaves `#work/deep` as it is. A
// `#fragment` inside a web address is not a tag and is never touched.
import { TAG_NAME, TAG_OR_ADDRESS, extractTags } from './taskUtils.js';

const lower = (s) => String(s ?? '').toLowerCase();

/** A valid tag name typed by the user: one word, any leading `#` dropped, lower-cased. */
export function normalizeTagInput(raw) {
  const name = String(raw ?? '').trim().replace(/^#+/, '');
  return TAG_NAME.test(name) ? name.toLowerCase() : '';
}

/** Whether the manager may rewrite this row's title. */
export function isTagEditable(task) {
  return !!task && !task.imported && !task._native && !task.todoist?.id;
}

// Brackets a removed tag leaves empty go with it: `Buy milk (#errand)`.
const CLOSER = { '(': ')', '[': ']', '{': '}' };
// Punctuation that belongs to the words before a removed tag, so the space
// before the tag goes: `Call Bob #work, then` is `Call Bob, then`.
const TRAILING_PUNCT = /^[,.;:!?…)\]}]/u;
// After a tag that opened a line, its punctuation goes with it: `#work: plan` is `plan`.
const LABEL_PUNCT = /^[,.;:!?…]+[ \t]*/u;
const AT_LINE_START = /(^|\n)[ \t]*$/;

/**
 * `text` with tag `from` renamed to `to`, or removed when `to` is null. A
 * rename into a tag the text already has keeps only the first of the two.
 * Removing a tag tidies what it leaves: the spaces either side, the space
 * before punctuation that followed it, brackets it leaves empty, and the
 * punctuation after a tag that opened a line. Unchanged text comes back as is.
 */
export function rewriteTag(text, from, to) {
  const source = String(text ?? '');
  const target = lower(from);
  if (!target || !extractTags(source).includes(target)) return source;
  const into = to ? lower(to) : null;
  let seenInto = false;
  let out = '';
  let at = 0;
  for (const m of source.matchAll(TAG_OR_ADDRESS)) {
    const [all, address, name] = m;
    if (address) continue;
    const key = lower(name);
    const renamed = key === target ? into : key;
    let replacement = all;
    if (renamed === null) replacement = null;
    else if (renamed === into) {
      if (seenInto) replacement = null;
      else {
        seenInto = true;
        if (key === target) replacement = `#${into}`;
      }
    }
    if (replacement === all) continue;
    out += source.slice(at, m.index);
    at = m.index + all.length;
    if (replacement !== null) { out += replacement; continue; }
    // Removed: tidy what the tag leaves around it.
    const closer = CLOSER[out.slice(-1)];
    if (closer && source[at] === closer) {
      out = out.slice(0, -1);
      at += 1;
    } else if (closer) {
      while (source[at] === ' ' || source[at] === '\t') at += 1;
    } else if (TRAILING_PUNCT.test(source.slice(at))) {
      if (AT_LINE_START.test(out)) at += source.slice(at).match(LABEL_PUNCT)?.[0].length ?? 0;
      else out = out.replace(/[ \t]+$/, '');
    }
  }
  out += source.slice(at);
  return out === source ? source : out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/gm, '').replace(/^[ \t]+/gm, '');
}

/**
 * The task editor's tag picker (#2308): `title` with `#tag` at its end, one
 * space before it and none after, unless the title already carries the tag
 * in any case. An empty title becomes the tag alone; an invalid name changes
 * nothing.
 */
export function addTagToTitle(title, tag) {
  const source = String(title ?? '');
  const name = normalizeTagInput(tag);
  if (!name || extractTags(source).includes(name)) return source;
  const head = source.trimEnd();
  return head ? `${head} #${name}` : `#${name}`;
}

/** `title` without `#tag`, every occurrence and any case, tidied as the tag manager removes one. */
export const removeTagFromTitle = (title, tag) => rewriteTag(title, String(tag ?? '').replace(/^#+/, ''), null);

/** The picker's tap: removes `#tag` from a title that carries it, adds it to one that does not. */
export function toggleTagInTitle(title, tag) {
  const name = lower(String(tag ?? '').trim().replace(/^#+/, ''));
  return extractTags(String(title ?? '')).includes(name)
    ? removeTagFromTitle(title, name)
    : addTagToTitle(title, name);
}

const rewriteRecurring = (template, from, to) => {
  const title = rewriteTag(template.title, from, to);
  let exceptions = template.exceptions;
  if (exceptions && typeof exceptions === 'object') {
    let touched = false;
    const next = {};
    for (const [date, ex] of Object.entries(exceptions)) {
      if (ex && typeof ex.title === 'string') {
        const t = rewriteTag(ex.title, from, to);
        if (t !== ex.title) { touched = true; next[date] = { ...ex, title: t }; continue; }
      }
      next[date] = ex;
    }
    if (touched) exceptions = next;
  }
  return title === template.title && exceptions === template.exceptions ? template : { ...template, title, exceptions };
};

/**
 * One list with tag `from` renamed to `to` (null removes it) in every title
 * the manager may rewrite. Rows it does not change keep their identity, so a
 * setter fed this changes only what changed. `recurring` rewrites series and
 * their per-date title overrides.
 */
export function rewriteTagInList(list, from, to, { recurring = false } = {}) {
  if (!Array.isArray(list)) return list;
  let changed = false;
  const next = list.map((task) => {
    if (!isTagEditable(task)) return task;
    const out = recurring ? rewriteRecurring(task, from, to)
      : (() => { const title = rewriteTag(task.title, from, to); return title === task.title ? task : { ...task, title }; })();
    if (out !== task) changed = true;
    return out;
  });
  return changed ? next : list;
}

/**
 * Every tag in use, for the manager's list: `{ tag, count, tasks, locked }`
 * sorted by name. `tasks` are the rows that carry it ({ task, where }, where
 * is 'calendar', 'inbox' or 'recurring'); `count` is how many of them the
 * manager can rewrite; `locked` how many it must leave (Todoist tasks).
 * Calendar events and the Recycle Bin are not listed.
 */
export function collectTags({ tasks = [], unscheduledTasks = [], recurringTasks = [] }) {
  const byTag = new Map();
  const add = (task, where, titles) => {
    const seen = new Set();
    for (const title of titles) for (const tag of extractTags(title)) seen.add(tag);
    for (const tag of seen) {
      if (!byTag.has(tag)) byTag.set(tag, { tag, count: 0, locked: 0, tasks: [] });
      const entry = byTag.get(tag);
      entry.tasks.push({ task, where });
      if (isTagEditable(task)) entry.count += 1; else entry.locked += 1;
    }
  };
  for (const task of tasks) if (task && !task.imported && !task._native) add(task, 'calendar', [task.title]);
  for (const task of unscheduledTasks) if (task && !task.imported) add(task, 'inbox', [task.title]);
  for (const template of recurringTasks) {
    if (!template) continue;
    const overrides = Object.values(template.exceptions || {}).map(ex => ex?.title).filter(t => typeof t === 'string');
    add(template, 'recurring', [template.title, ...overrides]);
  }
  return [...byTag.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}

/**
 * A list of tag names (a filter's selection, a Frame's tag affinity) after
 * the change: `from` renamed to `to`, or dropped when `to` is null, with no
 * duplicate left. Null when the list did not hold `from`, so the caller
 * leaves it untouched.
 */
export function renameInTagList(names, from, to) {
  if (!Array.isArray(names)) return null;
  const target = lower(from);
  if (!names.some(n => lower(n) === target)) return null;
  const out = [];
  for (const n of names) {
    const v = lower(n) === target ? (to ? lower(to) : null) : n;
    if (v !== null && !out.some(o => lower(o) === lower(v))) out.push(v);
  }
  return out;
}
