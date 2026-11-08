// What a project gives a task created in it (#2336). Pure.
//
// Copy at creation, the rule colour and assigned users already follow (the
// task modals' project field, the project quick-adds, taskMutations'
// createTask): a new task takes a COPY of the project's values, and editing
// the project later never reaches the tasks it already has. A task moved into
// a project later gets nothing from here: what the user wrote stays theirs.
//
// A project's "New task defaults" (`project.taskDefaults`, edited in the
// project form) add, on top of colour and users:
//   duration  minutes, instead of 30
//   tags      appended to the title as #tags where it lacks them
//   notes     the note a new task starts with (Summary / Purpose / Result…)
//   subtasks  the checklist a new task starts with, one title each
//
// One template per project, no goal or global level: goals hold no tasks of
// their own, and the colour already falls back from project to goal
// (getProjectColor). A project can copy another's defaults in the form.
//
// Values given explicitly win (an MCP create's notes or duration, a draft the
// user has already changed); the defaults fill only what is missing.

import { getProjectColor } from './colorUtils.js';
import { extractTags, tagsIn } from './taskUtils.js';

export const DEFAULT_TASK_DURATION = 30;
const MAX_DURATION = 24 * 60;

/** A tag as the title would read it back, without its '#', or null. */
export function cleanTag(raw) {
  const text = String(raw ?? '').trim().replace(/^#+/, '');
  if (!text) return null;
  const read = tagsIn(`#${text}`);
  return read.length === 1 && read[0] === text ? text : null;
}

/** Tags typed as "#a #b", "a, b" or a list, cleaned and without repeats (case-insensitive). */
export function parseTags(input) {
  const parts = Array.isArray(input) ? input : String(input ?? '').split(/[\s,，、]+/);
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    const tag = cleanTag(part);
    if (tag && !seen.has(tag.toLowerCase())) { seen.add(tag.toLowerCase()); out.push(tag); }
  }
  return out;
}

/** Subtask titles typed one per line, trimmed, empty lines dropped. */
export function parseSubtaskLines(input) {
  const lines = Array.isArray(input) ? input : String(input ?? '').split(/\r?\n/);
  return lines.map((line) => String(line ?? '').trim()).filter(Boolean);
}

/**
 * The stored shape, with anything empty or unreadable left out; undefined when
 * nothing is set, so a project without defaults carries no field at all.
 */
export function normalizeTaskDefaults(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const out = {};
  const duration = Number(raw.duration);
  if (Number.isFinite(duration) && duration > 0) out.duration = Math.min(Math.round(duration), MAX_DURATION);
  const tags = parseTags(raw.tags || []);
  if (tags.length) out.tags = tags;
  if (typeof raw.notes === 'string' && raw.notes.trim()) out.notes = raw.notes;
  const subtasks = parseSubtaskLines(raw.subtasks || []);
  if (subtasks.length) out.subtasks = subtasks;
  return Object.keys(out).length ? out : undefined;
}

/** A project's defaults, always an object (empty for none). */
export const taskDefaultsOf = (project) => normalizeTaskDefaults(project?.taskDefaults) || {};

/** `title` with each of `tags` appended as #tag where it lacks it. */
export function withTags(title, tags = []) {
  const text = String(title ?? '');
  const have = new Set(extractTags(text));
  const add = tags.filter((tag) => !have.has(tag.toLowerCase()));
  if (!add.length) return text;
  const sep = text && !/\s$/.test(text) ? ' ' : '';
  return `${text}${sep}${add.map((tag) => `#${tag}`).join(' ')}`;
}

/**
 * `title` without those of `tags` that end it, as withTags appended them:
 * only the trailing run of #tags is looked at, and it stops at the first tag
 * not in `tags`. Never anything earlier in the title: the new-task form keeps
 * natural-language spans as offsets into it (quickAddParser.js stripSpans),
 * and text removed before a span would move what the save cuts out. Returns
 * `title` itself when nothing goes.
 */
export function withoutTrailingTags(title, tags = []) {
  const text = String(title ?? '');
  if (!tags.length) return text;
  const drop = new Set(tags.map((tag) => tag.toLowerCase()));
  let out = text;
  for (;;) {
    const m = out.match(/(\s*)#([^\s#]+)\s*$/);
    if (!m || !drop.has(m[2].toLowerCase())) break;
    out = out.slice(0, m.index);
  }
  return out.length === text.length ? text : out;
}

/** Fresh subtasks from the defaults' titles. */
export const defaultSubtasks = (titles = [], newId = () => crypto.randomUUID()) =>
  titles.map((title) => ({ id: newId(), title, completed: false }));

/**
 * The fields a task created in `project` takes, given what the caller already
 * has (`given`): colour and users as before, plus the defaults wherever
 * `given` leaves them out. For a row built outright (the project quick-adds).
 *
 * @param {object} project
 * @param {object|null} parentGoal  for the colour's fallback
 * @param {{ title?: string, duration?: number, notes?: string, subtasks?: object[] }} [given]
 */
export function projectTaskFields(project, parentGoal, given = {}, { newId } = {}) {
  const d = taskDefaultsOf(project);
  return {
    title: withTags(given.title ?? '', d.tags),
    color: getProjectColor(project, parentGoal),
    duration: Number.isFinite(given.duration) ? given.duration : (d.duration ?? DEFAULT_TASK_DURATION),
    notes: typeof given.notes === 'string' && given.notes ? given.notes : (d.notes || ''),
    subtasks: Array.isArray(given.subtasks) && given.subtasks.length ? given.subtasks : defaultSubtasks(d.subtasks, newId),
    ...(project?.assignedUserSyncIds?.length ? { assignedUserSyncIds: project.assignedUserSyncIds } : {}),
  };
}

const sameTitles = (subtasks = [], titles = []) =>
  subtasks.length === titles.length && subtasks.every((st, i) => st?.title === titles[i] && !st?.completed);

/**
 * The new-task form's draft after its project changes from `from` to `to`
 * (either may be null). Each default replaces the draft's value only while
 * that value is still what the previous project (or nothing) put there, so
 * switching projects mid-draft never wipes what the user typed: a duration
 * still at the old default, notes and a checklist still as the old project
 * left them, and the old project's tags where they still end the title (a
 * tag the new project also has stays; see withoutTrailingTags).
 *
 * Colour and users are not here: the field sets those as it always has.
 */
export function draftWithProjectDefaults(draft, from, to, { newId } = {}) {
  const was = taskDefaultsOf(from);
  const next = taskDefaultsOf(to);
  const out = { ...draft };

  // Each field is written only when it changes, so a project without
  // defaults leaves the draft exactly as it was.
  const duration = draft.duration ?? DEFAULT_TASK_DURATION;
  const nextDuration = next.duration ?? DEFAULT_TASK_DURATION;
  if (duration === (was.duration ?? DEFAULT_TASK_DURATION) && duration !== nextDuration) out.duration = nextDuration;

  const notes = draft.notes || '';
  if (notes === (was.notes || '') && notes !== (next.notes || '')) out.notes = next.notes || '';

  const subtasks = draft.subtasks || [];
  const replaceable = subtasks.length === 0 || sameTitles(subtasks, was.subtasks);
  if (replaceable && !(subtasks.length === 0 && !next.subtasks)) {
    out.subtasks = defaultSubtasks(next.subtasks, newId);
  }

  const keep = new Set((next.tags || []).map((tag) => tag.toLowerCase()));
  const stale = (was.tags || []).filter((tag) => !keep.has(tag.toLowerCase()));
  const title = withTags(withoutTrailingTags(draft.title || '', stale), next.tags);
  if (title !== (draft.title || '')) out.title = title;
  return out;
}
