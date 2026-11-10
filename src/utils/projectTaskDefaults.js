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
//   energy    'effort' or 'restore': the task's own energy, as if the user had
//             set it, so a project of restoring things marks its tasks Restore
//             whatever their titles say. None: the title decides, as before.
//
// Tasks read their project's defaults only. A goal and an area can hold
// defaults too, but those are for NEW PROJECTS, one level at a time: a project
// created under a goal starts with a copy, each field from the goal, else from
// its area (seedTaskDefaults), and never follows them afterwards. Changing a
// goal's or an area's defaults reaches existing projects only through the
// explicit "Apply to projects" action (appliedTaskDefaults), which replaces
// theirs. A project can also copy another's defaults in the form.
//
// Values given explicitly win (an MCP create's notes or duration, a draft the
// user has already changed); the defaults fill only what is missing.
//
// A project with no default duration gives the app's default task duration
// (Settings > General, utils/defaultTaskDuration.js, #2367). This module stays
// pure, so callers read that setting and pass it as `defaultDuration`; 30 when
// they do not.

import { getProjectColor } from './colorUtils.js';
import { ENERGY_EFFORT, ENERGY_RESTORE } from './energyAxis.js';
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
  if (raw.energy === ENERGY_EFFORT || raw.energy === ENERGY_RESTORE) out.energy = raw.energy;
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

/** The task's `energy` from the defaults, spread into a new row: nothing when the project sets none. */
export const defaultEnergy = (defaults) => (defaults?.energy ? { energy: defaults.energy } : {});

/** Fresh subtasks from the defaults' titles. */
export const defaultSubtasks = (titles = [], newId = () => crypto.randomUUID()) =>
  titles.map((title) => ({ id: newId(), title, completed: false }));

/** The app's default task duration as passed in, or 30 for anything that is not a positive whole number. */
export const baseDuration = (minutes) => (Number.isInteger(minutes) && minutes > 0 ? minutes : DEFAULT_TASK_DURATION);

/**
 * The fields a task created in `project` takes, given what the caller already
 * has (`given`): colour and users as before, plus the defaults wherever
 * `given` leaves them out. For a row built outright (the project quick-adds).
 *
 * @param {object} project
 * @param {object|null} parentGoal  for the colour's fallback
 * @param {{ title?: string, duration?: number, notes?: string, subtasks?: object[] }} [given]
 * @param {{ newId?: () => string, defaultDuration?: number }} [opts]  `defaultDuration`:
 *   the app's default task duration, for a project that sets none
 */
export function projectTaskFields(project, parentGoal, given = {}, { newId, defaultDuration } = {}) {
  const d = taskDefaultsOf(project);
  return {
    title: withTags(given.title ?? '', d.tags),
    color: getProjectColor(project, parentGoal),
    duration: Number.isFinite(given.duration) ? given.duration : (d.duration ?? baseDuration(defaultDuration)),
    notes: typeof given.notes === 'string' && given.notes ? given.notes : (d.notes || ''),
    subtasks: Array.isArray(given.subtasks) && given.subtasks.length ? given.subtasks : defaultSubtasks(d.subtasks, newId),
    ...defaultEnergy(d),
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
export function draftWithProjectDefaults(draft, from, to, { newId, defaultDuration } = {}) {
  const was = taskDefaultsOf(from);
  const next = taskDefaultsOf(to);
  const out = { ...draft };

  // Each field is written only when it changes, so a project without
  // defaults leaves the draft exactly as it was. A draft no project has
  // touched starts at the app's default task duration (`defaultDuration`), so
  // that, not 30, is the duration still as "nothing" left it.
  const base = baseDuration(defaultDuration);
  const duration = draft.duration ?? base;
  const nextDuration = next.duration ?? base;
  if (duration === (was.duration ?? base) && duration !== nextDuration) out.duration = nextDuration;

  const notes = draft.notes || '';
  if (notes === (was.notes || '') && notes !== (next.notes || '')) out.notes = next.notes || '';

  const subtasks = draft.subtasks || [];
  const replaceable = subtasks.length === 0 || sameTitles(subtasks, was.subtasks);
  if (replaceable && !(subtasks.length === 0 && !next.subtasks)) {
    out.subtasks = defaultSubtasks(next.subtasks, newId);
  }

  // The form has no energy control: the draft's energy is the project's, and
  // follows it from project to project unless something else set it.
  if (draft.energy === was.energy && draft.energy !== next.energy) {
    if (next.energy) out.energy = next.energy;
    else delete out.energy;
  }

  const keep = new Set((next.tags || []).map((tag) => tag.toLowerCase()));
  const stale = (was.tags || []).filter((tag) => !keep.has(tag.toLowerCase()));
  const title = withTags(withoutTrailingTags(draft.title || '', stale), next.tags);
  if (title !== (draft.title || '')) out.title = title;
  return out;
}

// ─── Goal and area defaults: seeding new projects ────────────────────────────

const FIELDS = ['duration', 'tags', 'notes', 'subtasks', 'energy'];

/**
 * The New task defaults a project created under `goal` starts with: each
 * field the goal sets, else the one its `area` sets. Undefined when neither
 * sets any (a standalone project, with no goal, gets none).
 */
export function seedTaskDefaults(goal, area) {
  const fromGoal = normalizeTaskDefaults(goal?.taskDefaults) || {};
  const fromArea = normalizeTaskDefaults(area?.taskDefaults) || {};
  const out = {};
  for (const field of FIELDS) {
    if (fromGoal[field] !== undefined) out[field] = fromGoal[field];
    else if (fromArea[field] !== undefined) out[field] = fromArea[field];
  }
  return normalizeTaskDefaults(out);
}

/** seedTaskDefaults for a goal named by id, its area looked up in `areas`. */
export function seedTaskDefaultsFor(goalId, { goals = [], areas = [] } = {}) {
  const goal = goalId ? goals.find((g) => g.id === goalId) : null;
  if (!goal) return undefined;
  const area = goal.areaId ? areas.find((a) => a.id === goal.areaId) : null;
  return seedTaskDefaults(goal, area);
}

/** Open: still taking new tasks (active or on hold), not completed or archived. */
const isOpenProject = (p) => !!p && !p.archived && p.status !== 'archived' && p.status !== 'completed';

/**
 * The projects an "Apply to projects" on a goal or an area replaces the
 * defaults of: the goal's open projects, or the open projects of the area's
 * goals that are not archived.
 *
 * @param {{ scope: 'goal'|'area', id: string, goals?: object[], projects?: object[] }} input
 */
export function applyTargets({ scope, id, goals = [], projects = [] }) {
  const goalIds = scope === 'goal'
    ? new Set([id])
    : new Set(goals.filter((g) => g.areaId === id && g.status !== 'archived').map((g) => g.id));
  return projects.filter((p) => isOpenProject(p) && p.goalId && goalIds.has(p.goalId));
}

/**
 * `projects` after an "Apply to projects" on a goal or an area whose defaults
 * are being saved as `defaults`: each target's defaults become what a new
 * project in its goal would start with now (seedTaskDefaults), with the saved
 * value in place of the goal's or the area's. A goal's own field still wins
 * over its area's. A target left with none loses the field. Every target is
 * stamped, so the change syncs; nothing else is touched.
 */
export function appliedTaskDefaults(projects = [], options = {}) {
  const { scope, id, defaults, goals = [], areas = [], nowIso } = options;
  const saved = normalizeTaskDefaults(defaults);
  // A goal saved in the same step may have moved to another area: `areaId`,
  // when given (undefined for none), is the one its fallback comes from.
  const areaOf = (g) => (Object.prototype.hasOwnProperty.call(options, 'areaId') ? { areaId: options.areaId } : { areaId: g.areaId });
  const goalsNow = scope === 'goal' ? goals.map((g) => (g.id === id ? { ...g, ...areaOf(g), taskDefaults: saved } : g)) : goals;
  const areasNow = scope === 'area' ? areas.map((a) => (a.id === id ? { ...a, taskDefaults: saved } : a)) : areas;
  const targets = new Set(applyTargets({ scope, id, goals: goalsNow, projects }).map((p) => p.id));
  return projects.map((p) => {
    if (!targets.has(p.id)) return p;
    const seed = seedTaskDefaultsFor(p.goalId, { goals: goalsNow, areas: areasNow });
    const { taskDefaults: _old, ...rest } = p;
    return { ...rest, ...(seed ? { taskDefaults: seed } : {}), updatedAt: nowIso };
  });
}

