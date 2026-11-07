// Pure read models for the MCP tool surface (docs/mcp-server-spec.md §5.1),
// following the trayFetchGate.js precedent from PR #1302: the React-coupled
// part (the app's src/hooks/useMcpBridge.js) stays a thin subscription, and
// every decision that matters lives here, dependency-free and unit-tested.
// Formerly the app's src/utils/mcpReadModel.js; in this package so the desktop
// app and a GLANCEvault-client host answer the same tools through the same
// code (#2280).
//
// READ SOURCE: these functions take the state buildMcpReadState
// (readState.js) assembles. In the app that is LIVE React state — what the
// user sees in the main window right now — never localStorage. That is
// deliberate: _native device-calendar events are never persisted
// (useDataPersistence.js filters them out of every write), so a localStorage
// read could never include them, and everything else would lag state by one
// commit for no benefit. A host hands it its own reassembled copy.
//
// _native events (spec §5.1, revision 4): flagged with the distinct type
// 'device_calendar_event' plus read_only: true in ALL output, and included
// only when the caller (the Electron main process, which owns the consent
// tier) asks for them via include_native. The tier decision never lives here.

import {
  calculateGoalProgress,
  calculateProjectProgress,
  notBucketed,
  BUCKET_LIST_IDS,
  DEFAULT_BUCKET_CONFIG,
  buildRoutineBlocks,
  noteLinkOf,
  continuationsFromPreviousDay,
  shiftDateStr,
} from '@glance-apps/agenda-core';
import { buildFrames } from './frames.js';
import { expandRecurringForDate, rowsForDate } from './dayRows.js';
import { recurrenceToWire } from './repeat.js';
import { wireStamp } from './wireStamp.js';

export { expandRecurringForDate };

/**
 * Subtasks on the wire (2026-10-04): the task's own checklist, in order,
 * omitted when the task has none so unchanged consumers see no new key.
 */
export function wireSubtasks(task) {
  const list = Array.isArray(task?.subtasks) ? task.subtasks : [];
  if (list.length === 0) return undefined;
  return list.filter((st) => st && typeof st.id !== 'undefined').map((st) => ({
    id: String(st.id), title: st.title ?? '', completed: !!st.completed,
  }));
}

/** A goal's or project's linked Obsidian note, when it has one. */
function wireNote(entity) {
  const link = noteLinkOf(entity);
  if (!link) return undefined;
  return { path: link.path, name: link.name, missing: link.missing };
}

/**
 * Inbox-item wire shape, shared by the inbox read and the write responses.
 * `timeZone` (an IANA name) is the zone created_at and completed_at are
 * reported in; omitted, they are on this machine's clock, as the app reports
 * them. A host on a server passes the user's.
 */
export function inboxItem(t, { timeZone } = {}) {
  const item = {
    id: t.id,
    type: 'task',
    title: t.title ?? '',
    priority: typeof t.priority === 'number' ? t.priority : 0,
    completed: !!t.completed,
  };
  // When it was created and completed (#2135), null when not known: tasks
  // from before createdAt existed have none, and an open task no completion.
  item.created_at = wireStamp(t.createdAt, timeZone);
  item.completed_at = t.completed ? wireStamp(t.completedAt, timeZone) : null;
  if (t.deadline) item.deadline = t.deadline;
  if (t.projectId) item.project_id = t.projectId;
  if (t.notes) item.notes = t.notes;
  // The duration scheduling will default to (applyScheduleTask), so a reader
  // can plan a slot before it schedules.
  if (typeof t.duration === 'number') item.duration_minutes = t.duration;
  if (t.assignedUserSyncIds?.length) item.assignee_id = t.assignedUserSyncIds[0];
  const subtasks = wireSubtasks(t);
  if (subtasks) item.subtasks = subtasks;
  return item;
}

/**
 * The day's note (2026-10-04), read-only: the app's own record for the date,
 * which the Obsidian sync fills from the vault's daily note where one is
 * connected, so what the app shows is what this returns. Null when the date
 * has no note, an empty one, or a deleted one.
 */
export function dailyNoteFor(state, date) {
  const note = state.dailyNotes?.[date];
  if (!note || note.deleted || typeof note.text !== 'string' || !note.text.trim()) return null;
  return { text: note.text, ...(note.lastModified ? { last_modified: note.lastModified } : {}) };
}

/**
 * The Bucket List (someday/maybe): the two lists with the user's headings and
 * their open and completed items, archived ones left out as the modal leaves
 * them out. Items are inbox-shaped minus priority and deadline, which
 * demotion strips, plus bucket_id.
 */
export function buildBucketList(state) {
  const { unscheduledTasks = [], isVisibleForUser = () => true } = state;
  const headings = { ...DEFAULT_BUCKET_CONFIG.headings, ...(state.bucketConfig?.headings ?? {}) };
  return {
    lists: BUCKET_LIST_IDS.map((id) => ({
      id,
      heading: headings[id] ?? id,
      items: unscheduledTasks
        .filter((t) => t && t.bucketId === id && !t.archived && isVisibleForUser(t))
        .map((t) => {
          const { priority: _p, deadline: _d, ...item } = inboxItem(t, { timeZone: state.timeZone });
          return { ...item, bucket_id: id };
        }),
    })),
  };
}

/**
 * The §5.1 distinct type flag. 'device_calendar_event' marks data that came
 * from the user's device calendar (EventKit) rather than from dayGLANCE, so
 * neither the model nor a human reading a transcript can confuse the two.
 */
export function blockType(task) {
  if (task._native) return 'device_calendar_event';
  if (isImportedEvent(task)) return 'calendar_event';
  if (task.isRecurring) return 'recurring_task';
  return 'task';
}

/**
 * An event imported from an ICS or CalDAV calendar feed (2026-10-04): not a
 * dayGLANCE task, and not movable even in the app (useDragDrop refuses the
 * drag). A CalDAV task-calendar task is a task with a calendar behind it and
 * stays type 'task' with `source: 'caldav_tasks'`.
 */
export function isImportedEvent(task) {
  return !!task?.imported && !task.nativeEventId && !task.isTaskCalendar;
}

/**
 * One scheduled block in tool output. Field names are snake_case wire names.
 * `timeZone` as for inboxItem.
 */
export function toBlock(task, { timeZone } = {}) {
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
  // When a task was created and completed (#2135), as on inbox items. Not on
  // events or routines: they are not tasks dayGLANCE created or completes.
  if (type === 'task' || type === 'recurring_task') {
    block.created_at = wireStamp(task.createdAt, timeZone);
    block.completed_at = task.completed ? wireStamp(task.completedAt, timeZone) : null;
  }
  // Notes and subtasks ride the block too (2026-10-04): the inbox shape has
  // carried notes since Phase 2, and a scheduled task's notes are no less
  // the task's. Neither is a device event's.
  if (type !== 'device_calendar_event') {
    if (task.notes) block.notes = task.notes;
    const subtasks = wireSubtasks(task);
    if (subtasks) block.subtasks = subtasks;
  }
  // Whose task it is, when assigned (multi-user). The write responses have
  // always said; the reads now say too.
  if (task.assignedUserSyncIds?.length) block.assignee_id = task.assignedUserSyncIds[0];
  if (task.isTaskCalendar) block.source = 'caldav_tasks';
  // A recurring occurrence says which series it belongs to and how it repeats
  // (#2066), in the shape dayglance_update_recurring_task accepts back.
  if (type === 'recurring_task' && task.recurrence) {
    block.series_id = String(task.recurringTemplateId);
    block.repeat = recurrenceToWire(task.recurrence);
    block.series_start_date = task.recurrence.startDate ?? null;
  }
  // Device calendar events cannot be modified through dayGLANCE (EventKit
  // read access only) — carried on every item, not just in tool descriptions.
  // An imported calendar event is read-only the same way: the feed owns it.
  if (type === 'device_calendar_event' || type === 'calendar_event') block.read_only = true;
  return block;
}

/**
 * A task from the previous date that runs past midnight, as a block on this
 * date (#2278): the same task (same id, type and fields), placed at 00:00 for
 * the minutes it still runs, and marked `continues_from: <the date it
 * started>`. It occupies that time like any block. The task is the previous
 * date's: its own block there is unchanged and carries the full duration, and
 * a write targets it by its id as usual.
 */
export function continuationBlock(continuation, date, { timeZone } = {}) {
  return {
    ...toBlock(continuation.task, { timeZone }),
    date,
    start_time: '00:00',
    duration_minutes: continuation.minutes,
    continues_from: continuation.fromDate,
  };
}

/**
 * The blocks for one local calendar date: concrete tasks on that date,
 * recurring instances expanded for it, and (when include_native) device
 * calendar events. Sorted all-day first, then by wall-clock start. A task
 * from the previous date that runs past midnight leads the timed blocks as a
 * continuation (continuationBlock).
 */
export function buildDayBlocks(state, params) {
  const { date, include_native: includeNative = false } = params;

  const { concrete, recurring } = rowsForDate(state, date, includeNative);
  const prev = rowsForDate(state, shiftDateStr(date, -1), includeNative);
  const continuations = continuationsFromPreviousDay([...prev.concrete, ...prev.recurring])
    .map((c) => continuationBlock(c, date, { timeZone: state.timeZone }));

  // Routines are already block-shaped and already owner-scoped (the renderer
  // passes the filtered list, since isVisibleForUser cannot judge them), so
  // they join AFTER the map rather than going through toBlock, which reads
  // .title and .date and would silently type them as plain tasks.
  //
  // Not gated on include_native: a routine is dayGLANCE data the user created,
  // not device calendar data, so it rides the base read consent tier (§6.3).
  const routines = buildRoutineBlocks(state, date);

  const toMinutes = (hhmm) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : Number.MAX_SAFE_INTEGER;
  };
  const blocks = continuations.concat([...concrete, ...recurring].map((t) => toBlock(t, { timeZone: state.timeZone }))).concat(routines).sort((a, b) => {
    if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
    return toMinutes(a.start_time) - toMinutes(b.start_time);
  });

  // Frames ride ALONGSIDE blocks, not inside them. A block is a thing on the
  // day; a frame is a window the user set aside, and the useful part of it is
  // what is still empty. Putting frames in `blocks` would make every existing
  // caller that iterates blocks start seeing windows as if they were work.
  const frames = buildFrames(state, date, { includeNative });
  return { blocks, frames, daily_note: dailyNoteFor(state, date) };
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
export function buildUnscheduledItems(state, filter = {}) {
  const { unscheduledTasks = [], isVisibleForUser = () => true } = state;
  // Filter selection over structural fields, resolved by the main process
  // (inboxFilter.js, in the tool layer) and applied HERE, before the array crosses
  // IPC to paginate — so total/truncated/next_cursor are computed against
  // the filtered set by construction, never by post-filtering a page. The
  // predicates are the app's own: 'standalone' is the TRMNL inbox-count
  // shape (notBucketed && !projectId), with completion a separate axis.
  const { scope = 'all', includeCompleted = true } = filter;
  return {
    // Bucket List items never appear in Inbox output — the unconditional
    // exclusion bucketList.js (agenda-core) documents for EVERY consumer feeding
    // inbox lists or counts. This was the one consumer that missed the
    // invariant (bucket items leaked into MCP results). Unconditional by
    // design: not a scope value, not behind an argument — a caller wanting
    // bucket items needs a separate tool, so this list stays one thing.
    items: unscheduledTasks
      .filter(notBucketed)
      .filter(isVisibleForUser)
      .filter((t) => (scope === 'standalone' ? !t.projectId : scope === 'project' ? !!t.projectId : true))
      .filter((t) => includeCompleted || !t.completed)
      .map((t) => inboxItem(t, { timeZone: state.timeZone })),
  };
}

/**
 * A project as the goal tree reports it (2026-10-04: the record's own fields
 * beside the progress). `description` is the record's notes box; for a
 * project linked to an Obsidian note the box lives in that note's opening
 * section and the record is empty, which `obsidian_note` tells the reader.
 */
export function projectItem(p, progressTasks = []) {
  const projectTasks = progressTasks.filter((t) => t.projectId === p.id && !t.archived);
  const progress = calculateProjectProgress(p.id, progressTasks);
  const item = {
    id: p.id,
    title: p.title,
    status: p.status,
    description: typeof p.description === 'string' ? p.description : '',
    // null, not 0, when the project has nothing to measure — a reader that
    // cannot tell those apart will report "no progress" on a project that is
    // simply not measurable in tasks.
    progress_percent: progress === null ? null : Math.round(progress * 100),
    tasks_done: projectTasks.filter((t) => t.completed).length,
    tasks_total: projectTasks.length,
  };
  if (p.goalId) item.goal_id = p.goalId;
  if (p.assignedUserSyncIds?.length) item.assignee_ids = [...p.assignedUserSyncIds];
  // The project's own target date (2026-10-21), the same field a goal carries
  // as target_date; omitted when unset so unchanged consumers see no new key.
  if (p.targetDate) item.target_date = p.targetDate;
  const note = wireNote(p);
  if (note) item.obsidian_note = note;
  return item;
}

/** A goal as the goal tree reports it, without its projects. */
export function goalItem(g, state, progressTasks = []) {
  const item = {
    id: g.id,
    title: g.title,
    status: g.status,
    description: typeof g.description === 'string' ? g.description : '',
    start_date: g.startDate ?? null,
    target_date: g.targetDate ?? null,
    progress_percent: Math.round(calculateGoalProgress(g.id, state.projects ?? [], progressTasks) * 100),
  };
  if (g.areaId) {
    const area = (state.areas ?? []).find((a) => a && a.id === g.areaId);
    item.area_id = g.areaId;
    if (area) item.area_name = area.name ?? '';
  }
  if (g.assignedUserSyncIds?.length) item.assignee_ids = [...g.assignedUserSyncIds];
  const note = wireNote(g);
  if (note) item.obsidian_note = note;
  return item;
}

/** The areas goals can belong to, for dayglance_list_areas and create/update goal. */
export function buildAreas(state) {
  return {
    areas: [...(state.areas ?? [])]
      .filter((a) => a && a.id !== undefined)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((a) => ({ id: a.id, name: a.name ?? '' })),
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
 * Progress math reuses the exact functions the UI uses (agenda-core's
 * progress.js), so MCP never reports numbers the window would not show.
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

  const mapProject = (p) => projectItem(p, progressTasks);

  const result = selected.map((g) => ({
    ...goalItem(g, state, progressTasks),
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
      return { ok: true, data: buildUnscheduledItems(state, params?.filter) };
    case 'list_users':
      return { ok: true, data: buildUsers(state) };
    case 'list_areas':
      return { ok: true, data: buildAreas(state) };
    case 'list_bucket_list':
      return { ok: true, data: buildBucketList(state) };
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
