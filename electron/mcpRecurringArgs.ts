// Argument-shape rules for dayglance_update_recurring_task (#2066), pure in the
// mcpUpdateArgs.ts style: every decision that needs no task state lives here,
// unit-tested, so the tool handler in mcpWriteTools.ts is wiring only. State-
// dependent rejections (an unknown series, a date that is not an occurrence)
// live in taskMutations.js applyUpdateRecurringTask, where the series is visible.
//
// THE SCOPE IS THE CALLER'S CHOICE, and it is required. The app asks the same
// question when an occurrence is edited (#2049): "This occurrence" or "All
// occurrences". An agent picks it explicitly, so an edit never lands on more
// (or less) of the series than the user asked for.
//
//   occurrence  title, start_time, duration_minutes, all_day and assignee are
//               written to that date only.
//   series      the same fields go to the series and are cleared from every
//               occurrence's own edits; notes, project and repeat are
//               series-level by design and are accepted only here.
//
// FIELD SEMANTICS as in update_task: absent leaves a field alone, present sets
// it, and clear_fields (an explicit list, never null) removes it.

import { isValidLocalDate, validateStartTime } from '@glance-apps/mcp-host';
import { validateDurationMinutes } from './mcpLocalTime.js';
import { parseRepeat, type RecurrencePattern } from './mcpRepeatArgs.js';

export interface UpdateRecurringArgs {
  task_id?: unknown;
  scope?: unknown;
  title?: unknown;
  notes?: unknown;
  start_time?: unknown;
  duration_minutes?: unknown;
  all_day?: unknown;
  repeat?: unknown;
  project_id?: unknown;
  assignee_id?: unknown;
  clear_fields?: unknown;
}

export type RecurringScope = 'occurrence' | 'series';

/** What the renderer mutation needs; field names are its camelCase params. */
export interface UpdateRecurringPlan {
  taskId: string;
  scope: RecurringScope;
  set: {
    title?: string;
    notes?: string;
    startTime?: string;
    durationMinutes?: number;
    allDay?: boolean;
    recurrence?: RecurrencePattern;
    projectId?: string;
    assigneeSyncId?: string;
  };
  clear: Array<'notes' | 'project' | 'assignee'>;
}

export type UpdateRecurringPlanResult =
  | { ok: true; plan: UpdateRecurringPlan }
  | { ok: false; code: 'validation'; message: string };

const reject = (message: string): UpdateRecurringPlanResult => ({ ok: false, code: 'validation', message });

/** The synthetic instance id the read surface hands out: recurring-<series>-<YYYY-MM-DD>. */
export function parseRecurringInstanceIdArg(id: unknown): { dateStr: string } | null {
  if (typeof id !== 'string' || !id.startsWith('recurring-')) return null;
  const m = /^recurring-.+-(\d{4}-\d{2}-\d{2})$/.exec(id);
  return m && isValidLocalDate(m[1]) ? { dateStr: m[1]! } : null;
}

const SERIES_ONLY =
  'belongs to the whole series by design: the app keeps one value for every occurrence. ' +
  'Pass scope "series" to change it for the series.';

/**
 * Validate the wire arguments and shape the renderer mutation params.
 * `multiUser` gates assignee as in update_task; `timeZone` resolves start_time
 * on the edited occurrence's date (DST gap/repeat rejected there).
 */
export function planUpdateRecurringTask(
  args: UpdateRecurringArgs,
  multiUser: boolean,
  timeZone: string,
): UpdateRecurringPlanResult {
  const { task_id, scope, title, notes, start_time, duration_minutes, all_day, repeat, project_id, assignee_id, clear_fields } = args;

  const instance = parseRecurringInstanceIdArg(task_id);
  if (!instance) {
    return reject(
      `task_id must be a recurring occurrence id, recurring-<series>-<YYYY-MM-DD>, as dayglance_get_day and ` +
      `dayglance_create_task return it; got ${JSON.stringify(task_id)}. One-off tasks are edited with dayglance_update_task.`,
    );
  }
  if (scope !== 'occurrence' && scope !== 'series') {
    return reject(
      `scope must be "occurrence" (this date only) or "series" (every occurrence), got ${JSON.stringify(scope)}. ` +
      'The app asks the same question when an occurrence is edited; ask the user which they meant if unsure.',
    );
  }

  const set: UpdateRecurringPlan['set'] = {};

  if (title !== undefined) {
    if (typeof title !== 'string' || !title.trim()) return reject('title must be a non-empty string; it can be set, never cleared');
    set.title = title.trim();
  }
  if (notes !== undefined) {
    if (typeof notes !== 'string') return reject(`notes must be a string, got ${JSON.stringify(notes)}`);
    if (scope === 'occurrence') return reject(`notes ${SERIES_ONLY}`);
    set.notes = notes;
  }
  if (all_day !== undefined && typeof all_day !== 'boolean') {
    return reject(`all_day must be a boolean, got ${JSON.stringify(all_day)}`);
  }
  if (all_day === true && start_time !== undefined) {
    return reject('all_day and start_time contradict each other: an all-day occurrence has no start time.');
  }
  if (all_day === true && duration_minutes !== undefined) {
    return reject('all_day and duration_minutes contradict each other: an all-day task has no meaningful duration.');
  }
  if (start_time !== undefined) {
    if (typeof start_time !== 'string') return reject(`start_time must be local "HH:MM", got ${JSON.stringify(start_time)}`);
    const timeError = validateStartTime(instance.dateStr, start_time, timeZone);
    if (timeError) return reject(timeError);
    set.startTime = start_time;
  }
  if (duration_minutes !== undefined) {
    const durationError = validateDurationMinutes(duration_minutes);
    if (durationError) return reject(durationError);
    set.durationMinutes = duration_minutes as number;
  }
  if (typeof all_day === 'boolean') set.allDay = all_day;

  if (repeat !== undefined) {
    if (scope === 'occurrence') return reject(`repeat ${SERIES_ONLY}`);
    const parsed = parseRepeat(repeat, instance.dateStr);
    if (!parsed.ok) return parsed;
    set.recurrence = parsed.recurrence;
  }
  if (project_id !== undefined) {
    if (typeof project_id !== 'string' || !project_id) return reject(`project_id must be a project id string, got ${JSON.stringify(project_id)}`);
    if (scope === 'occurrence') return reject(`project ${SERIES_ONLY}`);
    set.projectId = project_id;
  }
  if (assignee_id !== undefined) {
    if (!multiUser) return reject('assignee_id exists only while multi-user mode is on in dayGLANCE.');
    if (typeof assignee_id !== 'string' || !assignee_id) return reject(`assignee_id must be a user id string, got ${JSON.stringify(assignee_id)}`);
    set.assigneeSyncId = assignee_id;
  }

  const clearable = multiUser ? ['notes', 'project', 'assignee'] : ['notes', 'project'];
  const clear: UpdateRecurringPlan['clear'] = [];
  if (clear_fields !== undefined) {
    if (!Array.isArray(clear_fields)) return reject(`clear_fields must be an array of field names, got ${JSON.stringify(clear_fields)}`);
    for (const field of clear_fields) {
      if (typeof field !== 'string' || !clearable.includes(field)) {
        return reject(`clear_fields accepts only ${clearable.map((f) => JSON.stringify(f)).join(', ')}; got ${JSON.stringify(field)}. Title, time and duration can be set but never cleared.`);
      }
      if ((field === 'notes' || field === 'project') && scope === 'occurrence') return reject(`${field} ${SERIES_ONLY}`);
      if (!clear.includes(field as UpdateRecurringPlan['clear'][number])) clear.push(field as UpdateRecurringPlan['clear'][number]);
    }
  }
  const setAndCleared = [
    clear.includes('notes') && set.notes !== undefined ? 'notes' : null,
    clear.includes('project') && set.projectId !== undefined ? 'project' : null,
    clear.includes('assignee') && set.assigneeSyncId !== undefined ? 'assignee' : null,
  ].filter(Boolean);
  if (setAndCleared.length) return reject(`${setAndCleared.join(', ')} cannot be both set and cleared in one call.`);

  if (!Object.keys(set).length && !clear.length) {
    return reject('Nothing to change: pass at least one field to set or a field name in clear_fields.');
  }

  return { ok: true, plan: { taskId: task_id as string, scope, set, clear } };
}
