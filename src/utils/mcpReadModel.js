// Pure read models for the MCP tool surface (docs/mcp-server-spec.md §5.1),
// following the trayFetchGate.js precedent from PR #1302: the React-coupled
// part (src/hooks/useMcpBridge.js) stays a thin subscription, and every
// decision that matters lives here, dependency-free and unit-tested.
//
// READ SOURCE: these functions take LIVE React state slices — what the user
// sees in the main window right now — never localStorage. That is deliberate:
// _native device-calendar events are never persisted (useDataPersistence.js
// filters them out of every write), so a localStorage read could never include
// them, and everything else would lag state by one commit for no benefit.
//
// _native events (spec §5.1, revision 4): flagged with the distinct type
// 'device_calendar_event' plus read_only: true in ALL output, and included
// only when the caller (the Electron main process, which owns the consent
// tier) asks for them via include_native. The tier decision never lives here.

import { getOccurrencesInRange } from './recurrenceEngine.js';
import { calculateGoalProgress } from './goalProgress.js';
import { calculateProjectProgress } from './projectProgress.js';
import { notBucketed } from './bucketList.js';

/**
 * The §5.1 distinct type flag. 'device_calendar_event' marks data that came
 * from the user's device calendar (EventKit) rather than from dayGLANCE, so
 * neither the model nor a human reading a transcript can confuse the two.
 */
export function blockType(task) {
  if (task._native) return 'device_calendar_event';
  if (task.isRecurring) return 'recurring_task';
  return 'task';
}

/** One scheduled block in tool output. Field names are snake_case wire names. */
export function toBlock(task) {
  const type = blockType(task);
  const block = {
    id: task.id,
    type,
    title: task.title ?? '',
    date: task.date ?? null,
    start_time: task.isAllDay ? null : (task.startTime ?? null), // local wall-clock HH:MM (§5.3)
    duration_minutes: typeof task.duration === 'number' ? task.duration : null,
    all_day: !!task.isAllDay,
    completed: !!task.completed,
  };
  if (task.projectId) block.project_id = task.projectId;
  // Device calendar events cannot be modified through dayGLANCE (EventKit
  // read access only) — carried on every item, not just in tool descriptions.
  if (type === 'device_calendar_event') block.read_only = true;
  return block;
}

/**
 * Expand recurring templates into instances for ONE date. Mirrors the
 * App.jsx expansion (exception overrides per field) with one deliberate
 * difference: no "hide past uncompleted" rule — that is a UI display choice,
 * and an MCP read of a past day should report what was scheduled.
 */
export function expandRecurringForDate(recurringTasks, date) {
  const instances = [];
  for (const template of recurringTasks ?? []) {
    const occurrences = getOccurrencesInRange(template, date, date);
    for (const dateStr of occurrences) {
      if (dateStr !== date) continue;
      const exception = template.exceptions?.[dateStr];
      instances.push({
        id: `recurring-${template.id}-${dateStr}`,
        title: exception?.title ?? template.title,
        startTime: exception?.startTime ?? template.startTime,
        duration: exception?.duration ?? template.duration,
        completed: (template.completedDates || []).includes(dateStr),
        isAllDay: exception?.isAllDay ?? template.isAllDay ?? false,
        assignedUserSyncIds: exception?.assignedUserSyncIds ?? template.assignedUserSyncIds,
        date: dateStr,
        isRecurring: true,
      });
    }
  }
  return instances;
}

/**
 * The blocks for one local calendar date: concrete tasks on that date,
 * recurring instances expanded for it, and (when include_native) device
 * calendar events. Sorted all-day first, then by wall-clock start.
 */
export function buildDayBlocks(state, params) {
  const { tasks = [], recurringTasks = [], isVisibleForUser = () => true } = state;
  const { date, include_native: includeNative = false } = params;

  const onDate = tasks.filter((t) => t.date === date && isVisibleForUser(t));
  const concrete = includeNative ? onDate : onDate.filter((t) => !t._native);
  const recurring = expandRecurringForDate(recurringTasks, date).filter(isVisibleForUser);

  const toMinutes = (hhmm) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : Number.MAX_SAFE_INTEGER;
  };
  const blocks = [...concrete, ...recurring].map(toBlock).sort((a, b) => {
    if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
    return toMinutes(a.start_time) - toMinutes(b.start_time);
  });
  return { blocks };
}

/**
 * The 7 local calendar dates of the week containing `dateStr`, starting on the
 * user's weekStartDay setting (App.jsx: 0=Sunday, 1=Monday, any 0-6). Pure
 * y/m/d arithmetic via a local Date at noon — noon so no DST transition can
 * shift the calendar date when adding days.
 *
 * This is the STRICT calendar week (the week containing today), deliberately
 * ignoring the weekViewMode='rolling' display preference: a rolling 7-day
 * strip anchored at today is a view of the NEXT seven days, not "the current
 * week", which is what the dayglance://schedule/week/current URI names.
 */
export function weekDatesFor(dateStr, weekStartDay) {
  const start = Number.isInteger(weekStartDay) && weekStartDay >= 0 && weekStartDay <= 6 ? weekStartDay : 0;
  const [y, m, d] = dateStr.split('-').map(Number);
  const base = new Date(y, m - 1, d, 12, 0, 0);
  const diff = (base.getDay() - start + 7) % 7;
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(y, m - 1, d - diff + i, 12, 0, 0);
    const p = (n) => String(n).padStart(2, '0');
    return `${day.getFullYear()}-${p(day.getMonth() + 1)}-${p(day.getDate())}`;
  });
}

/** The week resource payload: the day model repeated across the strict week. */
export function buildWeek(state, params) {
  const { date, include_native: includeNative = false } = params;
  const weekStartDay = Number.isInteger(state.weekStartDay) ? state.weekStartDay : 0;
  const days = weekDatesFor(date, weekStartDay).map((dayDate) => ({
    date: dayDate,
    ...buildDayBlocks(state, { date: dayDate, include_native: includeNative }),
  }));
  return { week_start_day: weekStartDay, days };
}

/** The unscheduled inbox, unpaginated — the main process owns paging (§5.1). */
export function buildUnscheduledItems(state) {
  const { unscheduledTasks = [], isVisibleForUser = () => true } = state;
  return {
    // Bucket List items never appear in Inbox output — the unconditional
    // exclusion utils/bucketList.js documents for EVERY consumer feeding
    // inbox lists or counts. This was the one consumer that missed the
    // invariant (bucket items leaked into MCP results). Unconditional by
    // design: not a scope value, not behind an argument — a caller wanting
    // bucket items needs a separate tool, so this list stays one thing.
    items: unscheduledTasks.filter(notBucketed).filter(isVisibleForUser).map((t) => {
      const item = {
        id: t.id,
        type: 'task',
        title: t.title ?? '',
        priority: typeof t.priority === 'number' ? t.priority : 0,
        completed: !!t.completed,
      };
      if (t.deadline) item.deadline = t.deadline;
      if (t.projectId) item.project_id = t.projectId;
      if (t.notes) item.notes = t.notes;
      return item;
    }),
  };
}

/**
 * Goal and project progress (§5.1: needs scope arguments — unscoped it returns
 * either too little or an unbounded tree).
 *
 *  - goal_id: narrow to one goal; unknown id is a not_found the tool layer
 *    turns into a typed error.
 *  - window: 'active' (default) or 'all' — goal/project status filter.
 *
 * Progress math reuses the exact functions the UI uses (goalProgress.js,
 * projectProgress.js), so MCP never reports numbers the window would not show.
 */
export function buildGoalProgress(state, params) {
  const {
    goals = [], projects = [], tasks = [], unscheduledTasks = [],
    isVisibleForUser = () => true,
  } = state;
  const { goal_id: goalId, window: windowParam } = params ?? {};

  const scope = windowParam === undefined || windowParam === 'active' ? 'active'
    : windowParam === 'all' ? 'all'
      : null;
  if (scope === null) {
    return { notFound: false, invalid: `window must be 'active' or 'all', got ${JSON.stringify(windowParam)}` };
  }

  const inScope = (entity) => scope === 'all' || entity.status === 'active';
  const allTasks = [...tasks, ...unscheduledTasks].filter(isVisibleForUser);
  // Progress denominators deliberately exclude device calendar events: they are
  // not completable dayGLANCE work and would dilute every percentage.
  const progressTasks = allTasks.filter((t) => !t._native);

  const visibleGoals = goals.filter((g) => isVisibleForUser(g) && inScope(g));
  const selected = goalId === undefined ? visibleGoals : visibleGoals.filter((g) => g.id === goalId);
  if (goalId !== undefined && selected.length === 0) {
    return { notFound: true, invalid: null };
  }

  const mapProject = (p) => {
    const projectTasks = progressTasks.filter((t) => t.projectId === p.id && !t.archived);
    return {
      id: p.id,
      title: p.title,
      status: p.status,
      progress_percent: Math.round(calculateProjectProgress(p.id, progressTasks) * 100),
      tasks_done: projectTasks.filter((t) => t.completed).length,
      tasks_total: projectTasks.length,
    };
  };

  const result = selected.map((g) => ({
    id: g.id,
    title: g.title,
    status: g.status,
    target_date: g.targetDate ?? null,
    progress_percent: Math.round(calculateGoalProgress(g.id, projects, progressTasks) * 100),
    projects: projects
      .filter((p) => p.goalId === g.id && isVisibleForUser(p) && inScope(p))
      .map(mapProject),
  }));

  // Projects with no parent goal are real work the model should see when the
  // question is unscoped; under a goal_id they are out of scope by definition.
  const standalone = goalId === undefined
    ? projects.filter((p) => !p.goalId && isVisibleForUser(p) && inScope(p)).map(mapProject)
    : [];

  return { notFound: false, invalid: null, goals: result, standalone_projects: standalone };
}

/**
 * The renderer-side dispatcher for main-process MCP requests. Every method
 * returns { ok: true, data } or { ok: false, error: { code, message } } —
 * the main process maps these onto §5.2 typed tool errors verbatim.
 *
 * 'ping' is the §3.3 health check: a crashed renderer cannot run this
 * function, so answering at all IS the health signal.
 */
/**
 * The multi-user roster for assignment (spec §5.1 list_users): ACTIVE members
 * only (soft-deleted rows keep their names for history but are not valid
 * assignees), each as { id, name } where id is the user's syncId — the value
 * assignedUserSyncIds actually matches on (with the same legacy id fallback
 * the UI's assignment badge uses). The roster stays renderer-side: the main
 * process gates the tool's existence on the multi-user flag but never holds
 * a copy of the user list.
 */
export function buildUsers(state) {
  return {
    users: (state.users ?? [])
      .filter((u) => !u.deleted)
      .map((u) => ({ id: u.syncId ?? u.id, name: u.name ?? '' })),
  };
}

export function handleMcpRequest(state, request) {
  const method = request?.method;
  const params = request?.params ?? {};
  switch (method) {
    case 'ping':
      return { ok: true, data: { pong: true } };
    case 'get_day':
      return { ok: true, data: buildDayBlocks(state, params) };
    case 'get_week':
      return { ok: true, data: buildWeek(state, params) };
    case 'list_unscheduled':
      return { ok: true, data: buildUnscheduledItems(state) };
    case 'list_users':
      return { ok: true, data: buildUsers(state) };
    case 'goal_progress': {
      const r = buildGoalProgress(state, params);
      if (r.invalid) return { ok: false, error: { code: 'validation', message: r.invalid } };
      if (r.notFound) return { ok: false, error: { code: 'not_found', message: `No goal with id ${JSON.stringify(params.goal_id)}` } };
      return { ok: true, data: { goals: r.goals, standalone_projects: r.standalone_projects } };
    }
    default:
      return { ok: false, error: { code: 'validation', message: `Unknown method ${JSON.stringify(method)}` } };
  }
}
