// Canonical task-mutation shapes, extracted as pure state-in/state-out
// functions (trayFetchGate.js style) for the MCP write path — spec §3.1 as
// restated in revision 5: every MCP write goes through the same store layer
// via this shared module, so the save pass, dirty tracking, tombstones, and
// tray:data-changed all engage identically to a UI edit.
//
// EACH SHAPE IS A TRANSCRIPTION of the UI's own write, cited per function.
// The UI call sites still perform these inline (useDragDrop.js drag/resize
// handlers, useTaskActions.js) — converting them to call this module is a
// planned follow-up, deliberately NOT part of Phase 3, so the drag paths
// stay untouched while MCP lands.
//
// DELIBERATE DIFFERENCES from the UI handlers, per spec §3.1 (r5):
//  - no pushUndo() — the §4.3 write journal is the undo surface for MCP writes
//  - no playUISound() / haptics — an agent write must not chirp the speaker
//  - no onboarding-progress side effects
//
// _NATIVE GUARD (spec §5.2): dayGLANCE holds EventKit read access only. The
// UI's drag handlers write the device calendar via nativeUpdateEvent and fall
// back to display overrides; a store-layer write would be a transient visual
// lie discarded on the next calendar refetch. Every mutating function here
// rejects _native explicitly — and none of this module touches localStorage,
// so no day-planner-native-time-overrides entry can ever be written from it.

import { parseRoutineBlockId, routineBlockId } from '@glance-apps/agenda-core';
import { findRoutineConflict, minutesToTime } from './dayOccupancy.js';
import { completionTimestamp } from './taskUtils.js';
import { createdTimestamp } from './createdAt.js';

// `createdAt` for a task a write creates: the write's own clock, in the
// local-offset form every createdAt uses.
const createdStamp = (nowIso) => createdTimestamp(nowIso ? new Date(nowIso) : new Date());
// A recurring occurrence's per-date stamp: the write's own instant (nowIso,
// as lastModified), in the own-offset form an ordinary completedAt uses, so
// it names the local date the occurrence was done on (JOBO's Do date) and
// can close a Focus session. The sync merge compares stamps as instants.
const offsetStampAt = (nowIso) => completionTimestamp(Number.isFinite(Date.parse(nowIso)) ? new Date(nowIso) : new Date());
import { getProjectColor } from './colorUtils.js';
import { getOccurrencesInRange } from './recurrenceEngine.js';
import { applyRecurringInstanceEdit } from './recurringInstanceEdit.js';

export const WRITE_ERROR_CODES = Object.freeze({
  NOT_FOUND: 'not_found',
  VALIDATION: 'validation',
  NATIVE_READONLY: 'device_calendar_readonly',
  CALENDAR_EVENT_READONLY: 'calendar_event_readonly',
  ROUTINE_READONLY: 'routine_readonly',
  ROUTINE_CONFLICT: 'routine_conflict',
});

const err = (code, message) => ({ ok: false, error: { code, message } });

const NATIVE_MSG = (id) =>
  `${id} is a device calendar event. dayGLANCE has read-only access to the device calendar and cannot modify, move, resize, or complete its events.`;

/**
 * An event imported from an ICS or CalDAV calendar feed (2026-10-04): the
 * feed owns it, the app itself refuses to drag it, and a store-layer edit
 * would be overwritten by the next fetch. Rejected like a device event, with
 * its own code so a model can tell the two apart. CalDAV task-calendar tasks
 * are not events and keep their own rules below.
 */
const isImportedEvent = (task) => !!task?.imported && !task.nativeEventId && !task.isTaskCalendar;
const IMPORTED_MSG = (id) =>
  `${id} is a calendar event imported from a calendar feed. dayGLANCE shows it so you can schedule around it, but it belongs to the feed and cannot be modified, moved, resized, or completed here.`;
/** The read-only guards every task write shares: device events, then imported events. */
const readOnlyGuard = (task, id) => {
  if (task?._native) return err(WRITE_ERROR_CODES.NATIVE_READONLY, NATIVE_MSG(id));
  if (isImportedEvent(task)) return err(WRITE_ERROR_CODES.CALENDAR_EVENT_READONLY, IMPORTED_MSG(id));
  return null;
};

/**
 * Routines are read-only over MCP BY DESIGN, not by omission (spec §5.2).
 *
 * The read surface reports them so a model can see the time is occupied, and
 * a model that can see a block will reasonably try to move or complete it.
 * Letting that fall through to `not_found` would be a lie in the direction
 * that causes damage: the model would conclude the block does not exist and
 * either retry or recreate it as a task. Naming the real reason lets it tell
 * the user why instead.
 */
const ROUTINE_MSG = (id, operation) =>
  `${id} is a dayGLANCE routine block. Routines are read-only over MCP: ${operation} is not supported because routines are ` +
  'edited through the routines dashboard in dayGLANCE, whose write shape is not a task mutation. The block is occupied ' +
  'time; schedule around it.';

/**
 * Reject a routine id, or return null when `id` is not one. Two detectors,
 * because they fail in different directions:
 *
 *   the `routine-` prefix   catches every id the read surface hands out, with
 *                           no routine state needed (§3.7: the write path is
 *                           not given routine slices)
 *   the raw-id membership   catches a caller that stripped the prefix, or one
 *                           working from an id it saw in an export or a log
 *
 * `state.routines` is the owner-scoped list the renderer already passes for
 * reads; when it is absent (any caller that does not thread it) the prefix
 * check still stands on its own.
 */
function routineGuard(state, id, operation) {
  const prefixed = parseRoutineBlockId(id);
  if (prefixed) return err(WRITE_ERROR_CODES.ROUTINE_READONLY, ROUTINE_MSG(id, operation));
  const raw = (state?.routines ?? []).some((r) => String(r.id) === String(id));
  if (raw) return err(WRITE_ERROR_CODES.ROUTINE_READONLY, ROUTINE_MSG(routineBlockId(id), operation));
  return null;
}

/**
 * Reject a placement that would land on a routine (spec §5.2).
 *
 * WHY REJECT RATHER THAN SLIDE. The app's own drag-and-drop resolver slides a
 * dropped task past a routine, and mirroring that here was the alternative.
 * It is the wrong behaviour for an agent: a model that asked for 10:00 and
 * received a success will tell the user "scheduled at 10:00", and the silent
 * twenty-minute shift only surfaces when the user looks at the timeline. A
 * human dragging a block watches it land somewhere else and sees the
 * adjustment; a model has no such feedback channel. So the write fails, names
 * what it hit, and the model re-plans against get_day, which reports routine
 * blocks as of PR #1729.
 *
 * ROUTINES ONLY. Task-on-task overlap stays legal here exactly as it is in
 * the UI: users double-book on purpose and the timeline renders conflict
 * columns for it. A routine is different because MCP cannot move it, so a
 * collision has no recovery from either side.
 *
 * There is deliberately no force flag. The app offers no gesture that drops a
 * task onto a routine either, so an escape hatch here would make the agent
 * surface more permissive than the UI it is standing in for.
 */
const ROUTINE_CONFLICT_MSG = (conflict, startTime, duration) =>
  `${startTime}-${minutesToTime(timeToMinutesStrict(startTime) + duration)} overlaps the routine ` +
  `${JSON.stringify(conflict.label)} (${minutesToTime(conflict.start)}-${minutesToTime(conflict.end)}). ` +
  'Routines are read-only over MCP, so dayGLANCE cannot move it out of the way and will not silently ' +
  'shift your task instead. Pick a time that does not overlap; dayglance_get_day lists routine blocks ' +
  'for the date so you can see what is free.';

/** Local HH:MM to minutes; callers here have already validated the shape. */
const timeToMinutesStrict = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

/**
 * @returns an error result when the placement hits a routine, else null.
 * `state` carries the routine slices the renderer already threads for reads.
 */
function routineConflictGuard(state, date, { startTime, durationMinutes, allDay }) {
  const conflict = findRoutineConflict(state, date, { startTime, durationMinutes, allDay });
  if (!conflict) return null;
  return err(WRITE_ERROR_CODES.ROUTINE_CONFLICT, ROUTINE_CONFLICT_MSG(conflict, startTime, durationMinutes));
}

/** The recurring-instance id shape, mirroring App.jsx parseRecurringId. */
export function parseRecurringInstanceId(id) {
  if (typeof id !== 'string' || !id.startsWith('recurring-')) return null;
  const parts = id.split('-');
  const dateStr = parts.slice(-3).join('-');
  const rawTemplateId = parts.slice(1, -3).join('-');
  const templateId = /^\d+$/.test(rawTemplateId) ? Number(rawTemplateId) : rawTemplateId;
  return { templateId, dateStr };
}

/**
 * CREATE. Two shapes, transcribed from useTaskActions.js addTask:
 *  - inbox (:155-174): base task + priority default 0 (+ optional deadline),
 *    appended to unscheduledTasks.
 *  - scheduled (:236-248, via `schedule`): the SAME base task with
 *    date/startTime/duration/isAllDay, appended DIRECTLY to tasks — never
 *    inbox-then-schedule. One transition, one slice, so §5.2 atomicity holds
 *    by construction, and applyScheduleTask's by-design priority/deadline
 *    strip is never in the path. All-day stores startTime '00:00' with
 *    isAllDay true, the UI's own shape. Deliberately NOT transcribed: the
 *    UI's conflict auto-adjustment (getAdjustedTimeForImportedConflicts) —
 *    MCP writes take exact times, as schedule_task and move_block already do.
 *
 * ASSIGNMENT (multi-user): assigneeSyncId must name an ACTIVE roster member
 * (state.users, matched on syncId with the legacy id fallback the UI's own
 * badge uses) — an unknown id would produce a task invisible to every user,
 * so it is a not_found error, not a silent write. Stored as the UI stores
 * it: assignedUserSyncIds array.
 *
 * PROJECT INHERITANCE: a create with projectId copies the project's effective
 * color (getProjectColor: its own, else its goal's) and, when no assignee is
 * named, its assigned users — the copy-at-creation rule every UI create path
 * follows (ProjectCard/ProjectPlanner quick-add, the new-task modals). An
 * explicit assigneeSyncId wins over the project's users. An unknown projectId
 * inherits nothing and falls back to the default color.
 *
 * Idempotent per the handleIntent.js:347-389 precedent (the one create-shaped
 * mutation-level dedup in the codebase): the caller derives `taskId`
 * deterministically from its idempotency key, so a replayed create finds the
 * id already present and returns the existing task unchanged.
 */
export function applyCreateTask(state, {
  taskId, title, notes, projectId, assigneeSyncId,
  priority, deadline, durationMinutes, schedule, recurrence,
  transitionId, nowIso,
}) {
  const unscheduled = state.unscheduledTasks ?? [];
  const tasks = state.tasks ?? [];
  const trimmed = typeof title === 'string' ? title.trim() : '';
  if (!trimmed) return err(WRITE_ERROR_CODES.VALIDATION, 'title must be a non-empty string');

  // A routine id as the idempotency key is not merely pointless: the create
  // would succeed and mint a TASK carrying a routine block id, which then
  // collides with the routine's own id on the read surface and makes the two
  // indistinguishable to the caller that has to tell them apart.
  const routineRejection = routineGuard(state, taskId, 'creating a task under that id');
  if (routineRejection) return routineRejection;

  let assignedUserSyncIds;
  if (assigneeSyncId !== undefined) {
    const member = (state.users ?? []).find(
      (u) => !u.deleted && (u.syncId === assigneeSyncId || u.id === assigneeSyncId),
    );
    if (!member) {
      return err(WRITE_ERROR_CODES.NOT_FOUND,
        `No active user with id ${JSON.stringify(assigneeSyncId)}. Enumerate valid assignees with dayglance_list_users`);
    }
    assignedUserSyncIds = [member.syncId ?? member.id];
  }

  if (recurrence) {
    return createRecurringSeries(state, {
      taskId, title: trimmed, notes, projectId, assignedUserSyncIds, schedule, recurrence, nowIso,
    });
  }

  const existing = unscheduled.find((t) => t.id === taskId) ?? tasks.find((t) => t.id === taskId);
  if (existing) {
    return {
      ok: true, replayed: true, unscheduledTasks: unscheduled, tasks,
      task: existing, scheduled: existing.date !== undefined,
    };
  }

  const project = projectId ? (state.projects ?? []).find((p) => p.id === projectId) : undefined;
  const parentGoal = project?.goalId ? (state.goals ?? []).find((g) => g.id === project.goalId) : undefined;
  if (!assignedUserSyncIds && project?.assignedUserSyncIds?.length) {
    assignedUserSyncIds = [...project.assignedUserSyncIds];
  }

  const base = {
    id: taskId,
    title: trimmed,
    duration: typeof durationMinutes === 'number' ? durationMinutes : 30,
    color: project ? getProjectColor(project, parentGoal) : 'bg-blue-500',
    completed: false,
    isAllDay: false,
    notes: typeof notes === 'string' ? notes : '',
    subtasks: [],
    ...(projectId ? { projectId } : {}),
    ...(assignedUserSyncIds ? { assignedUserSyncIds } : {}),
    ...(transitionId ? { transitionId } : {}),
    // Stamped here as well as by the persist pass (utils/createdAt.js), so the
    // write's own response already says when the task was created.
    createdAt: createdStamp(nowIso),
    lastModified: nowIso,
  };

  if (schedule) {
    // Placed directly on the calendar, so it can land on a routine exactly as
    // schedule_task can. Checked after the `existing` replay branch above: a
    // retry of a create that already succeeded must stay a no-op replay even
    // if a routine has since been placed over it.
    const conflict = routineConflictGuard(state, schedule.date, {
      startTime: schedule.startTime,
      durationMinutes: schedule.durationMinutes,
      allDay: !!schedule.allDay,
    });
    if (conflict) return conflict;

    const task = {
      ...base,
      date: schedule.date,
      startTime: schedule.startTime,
      duration: schedule.durationMinutes,
      isAllDay: !!schedule.allDay,
    };
    return { ok: true, replayed: false, unscheduledTasks: unscheduled, tasks: [...tasks, task], task, scheduled: true };
  }

  const task = {
    ...base,
    priority: typeof priority === 'number' ? priority : 0,
    ...(deadline ? { deadline } : {}),
  };
  return { ok: true, replayed: false, unscheduledTasks: [...unscheduled, task], tasks, task, scheduled: false };
}

/** Default colour of a series with no project, as the UI's colors[0]. */
const DEFAULT_COLOR = 'bg-blue-500';

/**
 * CREATE A REPEATING SERIES (#2066). The template is transcribed from the UI's
 * "convert to recurring" save (App.jsx, the newTask.recurrence branch of the
 * mobile editor): one row in recurringTasks under the caller's deterministic
 * id, `recurrence.startDate` the requested date, all-day stored as startTime
 * '00:00'. Project colour and users are inherited as for a one-off create.
 *
 * Deliberately NOT carried: transitionId. A template is not a task row, and a
 * field the template never had would be a new field to declare to every sync
 * layer (CLAUDE.md "Adding a field to a task"). The replay check needs none:
 * the id itself is derived from the idempotency key.
 *
 * The routine guard runs on the FIRST OCCURRENCE, the date the caller is told
 * the series starts on; later occurrences are not checked, exactly as the app
 * does not check them when a series is created in the editor.
 */
function createRecurringSeries(state, {
  taskId, title, notes, projectId, assignedUserSyncIds, schedule, recurrence, nowIso,
}) {
  const recurring = state.recurringTasks ?? [];
  const existing = recurring.find((t) => String(t.id) === String(taskId));
  if (existing) return { ok: true, replayed: true, recurringTasks: recurring, template: existing, series: true };

  if (!schedule?.date) {
    return err(WRITE_ERROR_CODES.VALIDATION, 'A repeating task needs a start date: pass start with repeat.');
  }
  const project = projectId ? (state.projects ?? []).find((p) => p.id === projectId) : undefined;
  const parentGoal = project?.goalId ? (state.goals ?? []).find((g) => g.id === project.goalId) : undefined;
  let users = assignedUserSyncIds;
  if (!users && project?.assignedUserSyncIds?.length) users = [...project.assignedUserSyncIds];

  const allDay = !!schedule.allDay;
  const template = {
    id: taskId,
    title,
    startTime: allDay ? '00:00' : schedule.startTime,
    duration: schedule.durationMinutes,
    color: project ? getProjectColor(project, parentGoal) : DEFAULT_COLOR,
    isAllDay: allDay,
    notes: typeof notes === 'string' ? notes : '',
    subtasks: [],
    recurrence: { ...recurrence, startDate: schedule.date },
    completedDates: [],
    exceptions: {},
    ...(projectId ? { projectId } : {}),
    ...(users ? { assignedUserSyncIds: users } : {}),
    createdAt: createdStamp(nowIso),
    lastModified: nowIso,
  };

  const [first] = getOccurrencesInRange(template, schedule.date, '9999-12-31', 1);
  if (!first) {
    return err(WRITE_ERROR_CODES.VALIDATION,
      `That repeat produces no occurrence on or after ${schedule.date} before it ends, so the series would be empty.`);
  }
  const conflict = routineConflictGuard(state, first, {
    startTime: template.startTime, durationMinutes: template.duration, allDay,
  });
  if (conflict) return conflict;

  return { ok: true, replayed: false, recurringTasks: [...recurring, template], template, series: true };
}

/** The template fields a series edit can touch, restored whole by its undo. */
const SERIES_UNDO_KEYS = ['title', 'startTime', 'duration', 'isAllDay', 'color', 'assignedUserSyncIds', 'notes', 'projectId', 'recurrence'];

const NOT_AN_OCCURRENCE_MSG = (id) =>
  `${id} is not an occurrence of its series: the series does not fall on that date. Read the day with ` +
  'dayglance_get_day and use an id it lists.';

/**
 * EDIT A REPEATING SERIES OR ONE OCCURRENCE (#2066), through the app's own
 * save (applyRecurringInstanceEdit, #2049): 'occurrence' writes the changed
 * fields to that date's exception, 'series' writes them to the template and
 * clears them from every exception. Notes, project and the pattern are
 * series-level; the argument layer accepts them only with scope 'series'.
 *
 * A pattern change (`set.recurrence`) replaces the whole pattern, its end
 * included, and the start never moves earlier (editedSeriesStart). Completions
 * are never touched, here or by the undo.
 *
 * Returns the undo snapshot alongside the result: every SERIES_UNDO_KEYS value
 * before the edit, the keys that were absent, and each exception date the edit
 * changed with its prior value (null when it had none).
 */
export function applyUpdateRecurringTask(state, { taskId, scope, set = {}, clear = [], nowIso }) {
  const recurring = state.recurringTasks ?? [];
  const parsed = parseRecurringInstanceId(taskId);
  if (!parsed) return err(WRITE_ERROR_CODES.VALIDATION, `${taskId} is not a recurring occurrence id`);
  const template = recurring.find((t) => String(t.id) === String(parsed.templateId));
  if (!template) return err(WRITE_ERROR_CODES.NOT_FOUND, `No recurring series behind ${taskId}`);
  if (!getOccurrencesInRange(template, parsed.dateStr, parsed.dateStr, 1).includes(parsed.dateStr)) {
    return err(WRITE_ERROR_CODES.NOT_FOUND, NOT_AN_OCCURRENCE_MSG(taskId));
  }

  let assignedUserSyncIds;
  if (set.assigneeSyncId !== undefined) {
    const member = (state.users ?? []).find(
      (u) => !u.deleted && (u.syncId === set.assigneeSyncId || u.id === set.assigneeSyncId),
    );
    if (!member) {
      return err(WRITE_ERROR_CODES.NOT_FOUND,
        `No active user with id ${JSON.stringify(set.assigneeSyncId)}. Enumerate valid assignees with dayglance_list_users`);
    }
    assignedUserSyncIds = [member.syncId ?? member.id];
  }
  if (clear.includes('assignee')) assignedUserSyncIds = [];
  if (set.projectId !== undefined && !(state.projects ?? []).some((p) => p && p.id === set.projectId)) {
    return err(WRITE_ERROR_CODES.NOT_FOUND,
      `No project with id ${JSON.stringify(set.projectId)}. Enumerate projects with dayglance_get_goal_progress`);
  }

  const current = recurringTaskInstanceFields(template, parsed.dateStr);
  if (set.allDay === false && current.isAllDay && set.startTime === undefined) {
    return err(WRITE_ERROR_CODES.VALIDATION,
      'This occurrence is all-day; pass start_time with all_day false so it has a time to move to.');
  }

  const edit = {};
  if (set.title !== undefined) edit.title = set.title;
  if (set.allDay !== undefined) edit.isAllDay = set.allDay;
  // A start time makes an all-day occurrence timed (the argument layer has
  // already rejected start_time together with all_day true).
  if (set.startTime !== undefined) { edit.startTime = set.startTime; edit.isAllDay = false; }
  if (set.allDay === true) edit.startTime = '00:00';
  if (set.durationMinutes !== undefined) edit.duration = set.durationMinutes;
  if (assignedUserSyncIds !== undefined) edit.assignedUserSyncIds = assignedUserSyncIds;

  const projectId = clear.includes('project') ? undefined : (set.projectId ?? template.projectId);
  let next = applyRecurringInstanceEdit(template, {
    dateStr: parsed.dateStr,
    edit,
    scope: scope === 'series' ? 'all' : 'this',
    projectId,
    recurrence: set.recurrence,
    now: nowIso,
  });
  if (!projectId) delete next.projectId;
  if (set.notes !== undefined) next = { ...next, notes: set.notes };
  if (clear.includes('notes')) next = { ...next, notes: '' };

  // The edited occurrence lands on a routine only if its own time changed, as
  // move_block and resize_block check it; other dates are not checked, as the
  // app does not check them when a series is edited in the editor.
  const after = recurringTaskInstanceFields(next, parsed.dateStr);
  const occurs = getOccurrencesInRange(next, parsed.dateStr, parsed.dateStr, 1).includes(parsed.dateStr);
  if (occurs && (current.isAllDay !== after.isAllDay || current.startTime !== after.startTime || current.duration !== after.duration)) {
    const conflict = routineConflictGuard(state, parsed.dateStr, {
      startTime: after.startTime, durationMinutes: after.duration, allDay: after.isAllDay,
    });
    if (conflict) return conflict;
  }

  const before = {};
  const absentBefore = [];
  for (const key of SERIES_UNDO_KEYS) {
    if (key in template && template[key] !== undefined) before[key] = template[key];
    else absentBefore.push(key);
  }
  const exceptionsBefore = {};
  const priorExceptions = template.exceptions || {};
  const nextExceptions = next.exceptions || {};
  for (const d of new Set([...Object.keys(priorExceptions), ...Object.keys(nextExceptions)])) {
    if (JSON.stringify(priorExceptions[d]) !== JSON.stringify(nextExceptions[d])) {
      exceptionsBefore[d] = priorExceptions[d] ?? null;
    }
  }
  const changed = SERIES_UNDO_KEYS.some((k) => JSON.stringify(template[k]) !== JSON.stringify(next[k]))
    || Object.keys(exceptionsBefore).length > 0;

  if (!changed) {
    return {
      ok: true, replayed: false, unchanged: true, recurringTasks: recurring, template, dateStr: parsed.dateStr,
      undoSnapshot: null,
    };
  }
  return {
    ok: true, replayed: false, unchanged: false,
    recurringTasks: recurring.map((t) => (t === template ? next : t)),
    template: next, dateStr: parsed.dateStr,
    undoSnapshot: { templateId: template.id, before, absentBefore, exceptionsBefore },
  };
}

/** The occurrence's own values: the template with that date's exception over it. */
function recurringTaskInstanceFields(template, dateStr) {
  const exc = template.exceptions?.[dateStr] || {};
  return {
    isAllDay: exc.isAllDay ?? template.isAllDay ?? false,
    startTime: exc.startTime ?? template.startTime,
    duration: exc.duration ?? template.duration,
  };
}

/**
 * SCHEDULE (inbox → day + time). Shape transcribed from useTaskActions.js
 * scheduleDeadlineTaskAt (:791-806): strip priority/deadline, remove from the
 * inbox, append to tasks with date/startTime/duration/isAllDay:false and a
 * fresh lastModified. transitionId added on top (the drop path at
 * useDragDrop.js:468 stamps it; the deadline path predates it) so the
 * GLANCEintents emit correlates to the caller's idempotency key.
 */
export function applyScheduleTask(state, { taskId, date, startTime, durationMinutes, transitionId, nowIso }) {
  const unscheduled = state.unscheduledTasks ?? [];
  const tasks = state.tasks ?? [];

  const routineRejection = routineGuard(state, taskId, 'scheduling');
  if (routineRejection) return routineRejection;

  const task = unscheduled.find((t) => t.id === taskId);
  if (!task) {
    const scheduled = tasks.find((t) => t.id === taskId);
    if (scheduled?._native) return err(WRITE_ERROR_CODES.NATIVE_READONLY, NATIVE_MSG(taskId));
    if (scheduled) {
      // Replay of a completed schedule lands here: already on the calendar.
      if (scheduled.transitionId && transitionId && scheduled.transitionId === transitionId) {
        return { ok: true, replayed: true, unscheduledTasks: unscheduled, tasks, task: scheduled };
      }
      return err(WRITE_ERROR_CODES.VALIDATION, `${taskId} is already scheduled; use move_block to change its time`);
    }
    return err(WRITE_ERROR_CODES.NOT_FOUND, `No unscheduled task with id ${taskId}`);
  }
  if (task._native) return err(WRITE_ERROR_CODES.NATIVE_READONLY, NATIVE_MSG(taskId));

  const scheduleConflict = routineConflictGuard(state, date, {
    startTime,
    durationMinutes: durationMinutes ?? task.duration ?? 30,
  });
  if (scheduleConflict) return scheduleConflict;

  const { priority: _p, deadline: _d, ...preserved } = task;
  const scheduledTask = {
    ...preserved,
    date,
    startTime,
    duration: durationMinutes ?? task.duration ?? 30,
    isAllDay: false,
    ...(transitionId ? { transitionId } : {}),
    lastModified: nowIso,
  };
  return {
    ok: true,
    replayed: false,
    unscheduledTasks: unscheduled.filter((t) => t.id !== taskId),
    tasks: [...tasks, scheduledTask],
    task: scheduledTask,
  };
}

/**
 * UPDATE (edit fields in place). Shapes transcribed from the UI's own edits:
 * title from the edit-modal save (App.jsx ~3517: trimmed string + fresh
 * transitionId), notes from useTaskActions.updateTaskNotes, priority from
 * useDeadlinePriority.cyclePriority's commit map, deadline from
 * useTaskActions.setDeadline, assignee from the edit modal's direct
 * assignedUserSyncIds write. lastModified is stamped HERE, at the write
 * (#2083), as every other MCP write already does; see stampedAt below.
 *
 * DELIBERATE DIFFERENCE from the UI edit modal: no cleanTitle(). Sigil
 * parsing ($fri, !2) is a typing-UI affordance; an agent writing "$fri" in a
 * title means the literal text, and silently converting it into a deadline
 * would be state the caller never requested. create_task set this precedent.
 *
 * FIELD RULES, all typed and by-design in wording (§5.2):
 *  - priority/deadline (set OR clear) rejected on scheduled tasks: the UI
 *    disables both controls there, and scheduling strips them. Unscheduled
 *    PROJECT tasks are inbox tasks and take both, as in the UI (the Inbox's
 *    priority and deadline controls, and the deadline button on project
 *    card rows and the PLANNER's unscheduled cards).
 *  - _native (module header), recurring instances (synthetic per-instance
 *    ids, dedicated error), and CalDAV task-calendar tasks (a local-only
 *    edit desyncs the user's CalDAV server; the set_task_completion
 *    precedent) are all rejected before any field is touched.
 *
 * CLEAR SHAPES, matching what the UI produces: notes clears to '' (the
 * create default), deadline and assignedUserSyncIds are deleted outright
 * (create only adds them when set, and every reader treats an absent
 * assignedUserSyncIds identically to an empty one: isVisibleForUser and
 * UserAssignmentBadge both coalesce to []).
 *
 * Returns `touched`: the STORAGE keys this call changed, in a stable order,
 * so the caller can capture exact before-state for the §4.3 undo journal.
 */
export function applyUpdateTask(state, { taskId, set = {}, clear = [], transitionId, nowIso }) {
  const tasks = state.tasks ?? [];
  const unscheduled = state.unscheduledTasks ?? [];

  if (parseRecurringInstanceId(taskId)) {
    return err(
      WRITE_ERROR_CODES.VALIDATION,
      `${taskId} is a recurring-task occurrence: its id is a synthetic per-date view of the series, not a ` +
      'one-off task. Edit the series or this occurrence with dayglance_update_recurring_task, which asks for the scope.',
    );
  }

  const routineRejection = routineGuard(state, taskId, 'editing');
  if (routineRejection) return routineRejection;

  const inInbox = unscheduled.find((t) => t.id === taskId);
  const scheduled = tasks.find((t) => t.id === taskId);
  const task = inInbox ?? scheduled;
  if (!task) return err(WRITE_ERROR_CODES.NOT_FOUND, `No task with id ${taskId}`);
  const readOnly = readOnlyGuard(task, taskId);
  if (readOnly) return readOnly;
  if (task.isTaskCalendar && task.icalUid) {
    return err(
      WRITE_ERROR_CODES.VALIDATION,
      `${taskId} is a CalDAV task-calendar task; editing it requires a CalDAV write that MCP v1 does not perform`,
    );
  }

  const touchesPressure = set.priority !== undefined || set.deadline !== undefined || clear.includes('deadline');
  if (touchesPressure && !inInbox) {
    return err(
      WRITE_ERROR_CODES.VALIDATION,
      'Scheduled dayGLANCE tasks do not carry priority or deadline by design: those fields belong to inbox ' +
      'tasks only. Edit the other fields, or work with the task before scheduling it.',
    );
  }

  let assignedUserSyncIds;
  if (set.assigneeSyncId !== undefined) {
    const member = (state.users ?? []).find(
      (u) => !u.deleted && (u.syncId === set.assigneeSyncId || u.id === set.assigneeSyncId),
    );
    if (!member) {
      return err(WRITE_ERROR_CODES.NOT_FOUND,
        `No active user with id ${JSON.stringify(set.assigneeSyncId)}. Enumerate valid assignees with dayglance_list_users`);
    }
    assignedUserSyncIds = [member.syncId ?? member.id];
  }

  // The project a task belongs to (2026-10-04): set to an existing project's
  // id, or cleared. The record changes as the UI's project picker changes it,
  // projectId alone; the Obsidian placement pass reacts to the new home on
  // its own, exactly as it does to a UI reassignment.
  if (set.projectId !== undefined && !(state.projects ?? []).some((p) => p && p.id === set.projectId)) {
    return err(WRITE_ERROR_CODES.NOT_FOUND,
      `No project with id ${JSON.stringify(set.projectId)}. Enumerate projects with dayglance_get_goal_progress`);
  }

  if (task.transitionId && transitionId && task.transitionId === transitionId) {
    return { ok: true, replayed: true, tasks, unscheduledTasks: unscheduled, task, touched: [], scheduled: !inInbox };
  }

  const next = { ...task, ...(transitionId ? { transitionId } : {}), ...stampedAt(nowIso) };
  const touched = [];
  const touch = (key) => { if (!touched.includes(key)) touched.push(key); };

  if (set.title !== undefined) { next.title = set.title; touch('title'); }
  if (set.projectId !== undefined) { next.projectId = set.projectId; touch('projectId'); }
  if (set.notes !== undefined) { next.notes = set.notes; touch('notes'); }
  if (set.priority !== undefined) { next.priority = set.priority; touch('priority'); }
  if (set.deadline !== undefined) { next.deadline = set.deadline; touch('deadline'); }
  if (assignedUserSyncIds !== undefined) { next.assignedUserSyncIds = assignedUserSyncIds; touch('assignedUserSyncIds'); }
  for (const field of clear) {
    if (field === 'notes') { next.notes = ''; touch('notes'); }
    else if (field === 'deadline') { delete next.deadline; touch('deadline'); }
    else if (field === 'assignee') { delete next.assignedUserSyncIds; touch('assignedUserSyncIds'); }
    else if (field === 'project') { delete next.projectId; touch('projectId'); }
  }

  if (inInbox) {
    return {
      ok: true, replayed: false, tasks,
      unscheduledTasks: unscheduled.map((t) => (t.id === taskId ? next : t)),
      task: next, touched, scheduled: false,
    };
  }
  return {
    ok: true, replayed: false, unscheduledTasks: unscheduled,
    tasks: tasks.map((t) => (t.id === taskId ? next : t)),
    task: next, touched, scheduled: true,
  };
}

/** Shared lookup + guards for the block-mutating tools. */
function findWritableBlock(state, tasks, blockId, { operation }) {
  const routineRejection = routineGuard(state, blockId, operation === 'move_block' ? 'moving' : 'resizing');
  if (routineRejection) return routineRejection;
  if (parseRecurringInstanceId(blockId)) {
    return err(
      WRITE_ERROR_CODES.VALIDATION,
      `${blockId} is a recurring-task occurrence; ${operation} does not apply to one. Change its time or duration ` +
      'with dayglance_update_recurring_task, which asks whether the change is for this occurrence or the series.',
    );
  }
  const task = tasks.find((t) => t.id === blockId);
  if (!task) return err(WRITE_ERROR_CODES.NOT_FOUND, `No scheduled block with id ${blockId}`);
  const readOnly = readOnlyGuard(task, blockId);
  if (readOnly) return readOnly;
  return { ok: true, task };
}

/**
 * THE WRITE'S OWN STAMP (#2083). update_task, move_block and resize_block
 * used to leave lastModified to the save pass, which diff-stamps against
 * storage. While a sync apply is being committed that pass skips stamping
 * altogether (suppressTimestampRef: it cannot tell the apply's rows from an
 * edit), and it persists the rows as they are, so an MCP write landing in that
 * window kept the stamp of the copy it replaced forever. At an equal stamp the
 * merge then decides by content (mergeSync.js breakTimestampTies), not by who
 * edited last, and the edit could be reverted. Stamping at the write makes the
 * edit newer than the copy it supersedes whatever the save pass does; when the
 * pass does run it finds the content changed and stamps the same moment again.
 */
function stampedAt(nowIso) {
  return nowIso ? { lastModified: nowIso } : {};
}

/**
 * MOVE. Shape transcribed from the canonical drop handler,
 * useDragDrop.js:466-470: `{ ...t, startTime, date, isAllDay: false,
 * transitionId }`, plus the write's own lastModified (stampedAt, #2083).
 */
export function applyMoveBlock(state, { blockId, date, startTime, transitionId, nowIso }) {
  const tasks = state.tasks ?? [];
  const found = findWritableBlock(state, tasks, blockId, { operation: 'move_block' });
  if (!found.ok) return found;

  if (found.task.transitionId && transitionId && found.task.transitionId === transitionId) {
    return { ok: true, replayed: true, tasks, task: found.task };
  }
  // After the replay check by design: a retry of a move that already landed
  // must not start failing because a routine was placed there afterwards.
  const moveConflict = routineConflictGuard(state, date, {
    startTime,
    durationMinutes: found.task.duration ?? 30,
  });
  if (moveConflict) return moveConflict;

  const moved = { ...found.task, startTime, date, isAllDay: false, ...(transitionId ? { transitionId } : {}), ...stampedAt(nowIso) };
  return { ok: true, replayed: false, tasks: tasks.map((t) => (t.id === blockId ? moved : t)), task: moved };
}

/**
 * RESIZE. Shape transcribed from the resize loop write,
 * useDragDrop.js:774-776: `{ ...t, duration }`. transitionId added on top
 * (the UI resize does not stamp one — noted in the Phase 3 trace) so the
 * emit correlation holds for MCP.
 */
export function applyResizeBlock(state, { blockId, durationMinutes, transitionId, nowIso }) {
  const tasks = state.tasks ?? [];
  const found = findWritableBlock(state, tasks, blockId, { operation: 'resize_block' });
  if (!found.ok) return found;

  if (found.task.transitionId && transitionId && found.task.transitionId === transitionId) {
    return { ok: true, replayed: true, tasks, task: found.task };
  }
  // A resize keeps its start and grows its end, so it reaches a routine that
  // the original span cleared.
  const resizeConflict = routineConflictGuard(state, found.task.date, {
    startTime: found.task.startTime,
    durationMinutes,
    allDay: !!found.task.isAllDay,
  });
  if (resizeConflict) return resizeConflict;

  const resized = { ...found.task, duration: durationMinutes, ...(transitionId ? { transitionId } : {}), ...stampedAt(nowIso) };
  return { ok: true, replayed: false, tasks: tasks.map((t) => (t.id === blockId ? resized : t)), task: resized };
}

/**
 * COMPLETION — a SETTER, not the UI's toggle (§5.1: setter gives the agent
 * its own undo without a delete-shaped tool), so it is naturally idempotent:
 * setting the state a task is already in is a no-op replay.
 *
 * Branches transcribed from useTaskActions.js toggleComplete:
 *  - recurring instance (:415-431): completedDates membership on the template,
 *    stamped per-date in completedDatesTimestamps so sync resolves by
 *    last-writer-wins per date.
 *  - inbox: completed + completedAt + transitionId.
 *  - scheduled: completed + completedAt + transitionId. The scheduled branch
 *    stamping completedAt is NEW (Obsidian completion markers regenerate
 *    from it — the UI branch stamps it too); for years it deliberately did
 *    not, and the old absence was pinned by taskMutations.pinning.test.js.
 *
 * NOT supported here, rejected explicitly rather than half-done:
 *  - _native events (read-only, see module header)
 *  - CalDAV task-calendar tasks (isTaskCalendar + icalUid): the UI pairs the
 *    local flip with a network write (syncTaskCompletionToCalDAV); doing the
 *    flip without the network half would desync the user's CalDAV server. A
 *    pure module cannot do the network half — v1 rejects.
 */
/**
 * The task a subtask write targets: not a recurring instance (the UI edits a
 * template's subtasks through the instance, but the MCP surface treats the
 * series as app-managed, like update_task does), not a routine, not a
 * device event. Returns the task and which list holds it.
 */
function findSubtaskHost(state, taskId, operation) {
  if (parseRecurringInstanceId(taskId)) {
    return err(
      WRITE_ERROR_CODES.VALIDATION,
      `${taskId} is a recurring-task instance: ${operation} on recurring series is not supported over MCP. Edit the series in dayGLANCE`,
    );
  }
  const routineRejection = routineGuard(state, taskId, operation);
  if (routineRejection) return routineRejection;
  const inInbox = (state.unscheduledTasks ?? []).find((t) => t.id === taskId);
  const scheduled = (state.tasks ?? []).find((t) => t.id === taskId);
  const task = inInbox ?? scheduled;
  if (!task) return err(WRITE_ERROR_CODES.NOT_FOUND, `No task with id ${taskId}`);
  const readOnly = readOnlyGuard(task, taskId);
  if (readOnly) return readOnly;
  return { ok: true, task, inInbox: !!inInbox };
}

function replaceTask(state, taskId, inInbox, next) {
  const tasks = state.tasks ?? [];
  const unscheduled = state.unscheduledTasks ?? [];
  return inInbox
    ? { tasks, unscheduledTasks: unscheduled.map((t) => (t.id === taskId ? next : t)) }
    : { tasks: tasks.map((t) => (t.id === taskId ? next : t)), unscheduledTasks: unscheduled };
}

/**
 * ADD SUBTASK. Shape transcribed from useTaskActions.js addSubtask: a new
 * { id, title, completed: false } appended to the task's subtasks. Idempotent
 * on `subtaskId` (derived from the idempotency key by the caller).
 */
export function applyAddSubtask(state, { taskId, subtaskId, title, nowIso }) {
  const trimmed = typeof title === 'string' ? title.trim() : '';
  if (!trimmed) return err(WRITE_ERROR_CODES.VALIDATION, 'title must be a non-empty string');
  const host = findSubtaskHost(state, taskId, 'adding a subtask');
  if (!host.ok) return host;
  const existing = (host.task.subtasks || []).find((st) => st.id === subtaskId);
  if (existing) return { ok: true, replayed: true, task: host.task, subtask: existing, scheduled: !host.inInbox, ...replaceTask(state, taskId, host.inInbox, host.task) };
  const subtask = { id: subtaskId, title: trimmed, completed: false };
  const next = { ...host.task, subtasks: [...(host.task.subtasks || []), subtask], lastModified: nowIso };
  return { ok: true, replayed: false, task: next, subtask, scheduled: !host.inInbox, ...replaceTask(state, taskId, host.inInbox, next) };
}

/**
 * UPDATE SUBTASK. Title (useTaskActions.js updateSubtaskTitle) and completion
 * (toggleSubtask, as a setter rather than a toggle so a retry is safe), each
 * only when given. Returns the touched subtask keys for the undo descriptor.
 */
export function applyUpdateSubtask(state, { taskId, subtaskId, set = {}, nowIso }) {
  const host = findSubtaskHost(state, taskId, 'editing a subtask');
  if (!host.ok) return host;
  const current = (host.task.subtasks || []).find((st) => st.id === subtaskId);
  if (!current) return err(WRITE_ERROR_CODES.NOT_FOUND, `No subtask with id ${JSON.stringify(subtaskId)} on task ${taskId}`);
  if (set.title !== undefined && (typeof set.title !== 'string' || !set.title.trim())) {
    return err(WRITE_ERROR_CODES.VALIDATION, 'title must be a non-empty string');
  }
  const touched = [];
  const subtask = { ...current };
  if (set.title !== undefined && set.title.trim() !== current.title) { subtask.title = set.title.trim(); touched.push('title'); }
  if (set.completed !== undefined && !!set.completed !== !!current.completed) { subtask.completed = !!set.completed; touched.push('completed'); }
  if (touched.length === 0) return { ok: true, replayed: true, task: host.task, subtask: current, touched, scheduled: !host.inInbox, ...replaceTask(state, taskId, host.inInbox, host.task) };
  const next = {
    ...host.task,
    subtasks: host.task.subtasks.map((st) => (st.id === subtaskId ? subtask : st)),
    lastModified: nowIso,
  };
  return { ok: true, replayed: false, task: next, subtask, touched, scheduled: !host.inInbox, ...replaceTask(state, taskId, host.inInbox, next) };
}

/**
 * BULK UNDO (§4.3): apply a list of reversal ops produced by the main
 * process's write journal (buildUndoPlan in @glance-apps/mcp-host). Ops arrive
 * in REVERSE chronological order, so compound histories unwind correctly:
 * create → schedule → move undoes as restore-fields → restore-to-inbox →
 * remove-created, each op finding exactly the state its write produced.
 *
 * Same store-layer path as every other write in this module: the caller
 * invokes the setters with the returned slices, so the save pass, sync push,
 * GLANCEintents diff, and tray:data-changed all engage as for a UI edit.
 * Deliberately NOT pushed onto the user's undo stack (it IS the undo).
 *
 * SYNC SHAPE, per op kind — the two halves fail differently and the guard
 * in src/sync/snapshotDeleteGuard.js polices the difference:
 *  - The four restore_* kinds are FIELD UPDATES stamped with a fresh
 *    lastModified, so newest-write-wins carries the reversal fleet-wide.
 *  - remove_created is a DELETION, and a bare array filter is exactly the
 *    fingerprint-less vanish partitionSnapshotDeletes classifies as a
 *    'glitch' and healGlitchSkips actively restores from the vault (the
 *    undone task reappeared seconds later — the resurrection bug). So it is
 *    a RECYCLE-BIN MOVE instead, the same cross-list shape as the UI's
 *    moveToRecycleBin in useTaskActions.js, including the anti-zombie stamp
 *    (deletedAt = lastModified = max(now, task.lastModified + 1s)). The bin
 *    also keeps a whole-session undo itself recoverable, which a tombstone
 *    would not. No MCP-provenance marker on the bin entry — the shape is
 *    synced and consumed by undeleteTask on every device; a field nothing
 *    displays is scope creep (deliberate skip, revisit on user demand).
 *
 * Tolerant by design: a task the user deleted or edited away since the MCP
 * write is SKIPPED and counted, never an error — the user's own actions
 * outrank the reversal. _native can never appear here (every forward write
 * rejects it), but ops touching one are skipped anyway, fail-closed.
 */
export function applyUndoOps(state, ops, { nowIso }) {
  let tasks = state.tasks ?? [];
  let unscheduled = state.unscheduledTasks ?? [];
  let recurring = state.recurringTasks ?? [];
  let recycleBin = state.recycleBin ?? [];
  const tombstones = [];
  let undone = 0;
  let skipped = 0;

  for (const op of ops ?? []) {
    switch (op?.kind) {
      case 'remove_created': {
        const inScheduled = tasks.find((t) => t.id === op.taskId);
        const inInbox = unscheduled.find((t) => t.id === op.taskId);
        const task = inInbox ?? inScheduled;
        if (!task || task._native) { skipped += 1; break; }
        const actuallyInInbox = !!inInbox && !inScheduled;
        // The UI's anti-zombie stamp (useTaskActions.js moveToRecycleBin):
        // strictly newer than the task's own lastModified, so the bin entry
        // survives horizon pruning and wins the cross-list reconciliation.
        const deletedStamp = new Date(
          Math.max(Date.parse(nowIso), (task.lastModified ? Date.parse(task.lastModified) : 0) + 1000),
        ).toISOString();
        const binEntry = {
          ...task,
          _deletedFrom: actuallyInInbox ? 'inbox' : 'calendar',
          deletedAt: deletedStamp,
          lastModified: deletedStamp,
        };
        tasks = tasks.filter((t) => t.id !== op.taskId);
        unscheduled = unscheduled.filter((t) => t.id !== op.taskId);
        if (!recycleBin.some((t) => t.id === op.taskId)) {
          recycleBin = [...recycleBin, binEntry];
        }
        undone += 1;
        break;
      }
      case 'restore_unscheduled': {
        const scheduled = tasks.find((t) => t.id === op.taskId);
        if (!scheduled || scheduled._native || !op.beforeTask) { skipped += 1; break; }
        tasks = tasks.filter((t) => t.id !== op.taskId);
        if (!unscheduled.some((t) => t.id === op.taskId)) {
          unscheduled = [...unscheduled, { ...op.beforeTask, lastModified: nowIso }];
        }
        undone += 1;
        break;
      }
      case 'restore_block_fields': {
        const block = tasks.find((t) => t.id === op.blockId);
        if (!block || block._native || !op.before) { skipped += 1; break; }
        tasks = tasks.map((t) => (t.id === op.blockId ? { ...t, ...op.before, lastModified: nowIso } : t));
        undone += 1;
        break;
      }
      case 'restore_task_fields': {
        // Reverses an update_task edit: `before` carries the prior values of
        // every touched field, and `absentBefore` names touched fields that
        // did not exist pre-edit, which a spread alone cannot un-set (undoing
        // "add a deadline" must DELETE the key, not write undefined into it).
        const inInbox = unscheduled.find((t) => t.id === op.taskId);
        const scheduled = tasks.find((t) => t.id === op.taskId);
        const task = inInbox ?? scheduled;
        if (!task || task._native || !op.before) { skipped += 1; break; }
        const next = { ...task, ...op.before, lastModified: nowIso };
        for (const key of op.absentBefore ?? []) delete next[key];
        if (inInbox) unscheduled = unscheduled.map((t) => (t.id === op.taskId ? next : t));
        else tasks = tasks.map((t) => (t.id === op.taskId ? next : t));
        undone += 1;
        break;
      }
      case 'restore_completion': {
        const inInbox = unscheduled.find((t) => t.id === op.taskId);
        const scheduled = tasks.find((t) => t.id === op.taskId);
        const task = inInbox ?? scheduled;
        if (!task || task._native || !op.before) { skipped += 1; break; }
        const next = {
          ...task,
          completed: !!op.before.completed,
          ...(op.before.completedAt !== undefined ? { completedAt: op.before.completedAt } : {}),
          lastModified: nowIso,
        };
        if (inInbox) unscheduled = unscheduled.map((t) => (t.id === op.taskId ? next : t));
        else tasks = tasks.map((t) => (t.id === op.taskId ? next : t));
        undone += 1;
        break;
      }
      case 'remove_created_subtask':
      case 'restore_subtask_fields': {
        // Subtask ops touch the host task only: the subtask the agent added is
        // dropped, or its touched fields are put back.
        const inInbox = unscheduled.find((t) => t.id === op.taskId);
        const scheduled = tasks.find((t) => t.id === op.taskId);
        const task = inInbox ?? scheduled;
        if (!task || task._native || !(task.subtasks || []).some((st) => st.id === op.subtaskId)) { skipped += 1; break; }
        const subtasks = op.kind === 'remove_created_subtask'
          ? task.subtasks.filter((st) => st.id !== op.subtaskId)
          : task.subtasks.map((st) => (st.id === op.subtaskId ? { ...st, ...(op.before ?? {}) } : st));
        const next = { ...task, subtasks, lastModified: nowIso };
        if (inInbox) unscheduled = unscheduled.map((t) => (t.id === op.taskId ? next : t));
        else tasks = tasks.map((t) => (t.id === op.taskId ? next : t));
        undone += 1;
        break;
      }
      case 'restore_recurring_completion': {
        const template = recurring.find((t) => t.id === op.templateId);
        if (!template) { skipped += 1; break; }
        const has = (template.completedDates || []).includes(op.dateStr);
        if (has === op.wasCompleted) { undone += 1; break; } // already in the before-state
        const nextTemplate = {
          ...template,
          completedDates: op.wasCompleted
            ? [...(template.completedDates || []), op.dateStr]
            : (template.completedDates || []).filter((d) => d !== op.dateStr),
          completedDatesTimestamps: { ...(template.completedDatesTimestamps || {}), [op.dateStr]: offsetStampAt(nowIso) },
          lastModified: nowIso,
        };
        recurring = recurring.map((t) => (t.id === op.templateId ? nextTemplate : t));
        undone += 1;
        break;
      }
      case 'remove_created_series': {
        // A series leaves the way the app's own series delete does: the
        // template goes and its id is tombstoned (the caller writes
        // `tombstones`), so sync does not bring it back. Templates have no
        // recycle-bin form in the app, so there is none here either.
        const template = recurring.find((t) => String(t.id) === String(op.templateId));
        if (!template) { skipped += 1; break; }
        recurring = recurring.filter((t) => t !== template);
        tombstones.push(String(template.id));
        undone += 1;
        break;
      }
      case 'restore_series_fields': {
        // Reverses update_recurring_task: the touched template fields and the
        // exception dates it changed go back. Completions stay as they are.
        const template = recurring.find((t) => String(t.id) === String(op.templateId));
        if (!template || !op.before) { skipped += 1; break; }
        const next = { ...template, ...op.before, lastModified: nowIso };
        for (const key of op.absentBefore ?? []) delete next[key];
        const exceptions = { ...(template.exceptions || {}) };
        for (const [d, exc] of Object.entries(op.exceptionsBefore ?? {})) {
          if (exc === null) delete exceptions[d];
          else exceptions[d] = exc;
        }
        next.exceptions = exceptions;
        recurring = recurring.map((t) => (t === template ? next : t));
        undone += 1;
        break;
      }
      default:
        skipped += 1;
    }
  }

  return { ok: true, tasks, unscheduledTasks: unscheduled, recurringTasks: recurring, recycleBin, tombstones, undone, skipped };
}

export function applySetCompletion(state, { taskId, completed, transitionId, nowIso }) {
  const tasks = state.tasks ?? [];
  const unscheduled = state.unscheduledTasks ?? [];
  const recurring = state.recurringTasks ?? [];

  const instance = parseRecurringInstanceId(taskId);
  if (instance) {
    const template = recurring.find((t) => t.id === instance.templateId);
    if (!template) return err(WRITE_ERROR_CODES.NOT_FOUND, `No recurring series behind ${taskId}`);
    const isCompleted = (template.completedDates || []).includes(instance.dateStr);
    if (isCompleted === completed) {
      return { ok: true, replayed: true, recurringTasks: recurring, task: { id: taskId, completed } };
    }
    const nextTemplate = {
      ...template,
      completedDates: completed
        ? [...(template.completedDates || []), instance.dateStr]
        : (template.completedDates || []).filter((d) => d !== instance.dateStr),
      completedDatesTimestamps: { ...(template.completedDatesTimestamps || {}), [instance.dateStr]: offsetStampAt(nowIso) },
      lastModified: nowIso,
    };
    return {
      ok: true,
      replayed: false,
      recurringTasks: recurring.map((t) => (t.id === instance.templateId ? nextTemplate : t)),
      task: { id: taskId, completed },
    };
  }

  const routineRejection = routineGuard(state, taskId, 'completing');
  if (routineRejection) return routineRejection;

  const inInbox = unscheduled.find((t) => t.id === taskId);
  const scheduled = tasks.find((t) => t.id === taskId);
  const task = inInbox ?? scheduled;
  if (!task) return err(WRITE_ERROR_CODES.NOT_FOUND, `No task with id ${taskId}`);
  const readOnly = readOnlyGuard(task, taskId);
  if (readOnly) return readOnly;
  if (task.isTaskCalendar && task.icalUid) {
    return err(
      WRITE_ERROR_CODES.VALIDATION,
      `${taskId} is a CalDAV task-calendar task; completing it requires a CalDAV write that MCP v1 does not perform`,
    );
  }

  if (!!task.completed === completed) {
    return { ok: true, replayed: true, tasks, unscheduledTasks: unscheduled, task };
  }

  // Both branches stamp completedAt with the SAME local-offset ISO datetime
  // the UI stamps (completionTimestamp — not nowIso, so the two sides emit
  // byte-identical values and the Obsidian completion marker regenerates the
  // same bytes whichever side completed the task). The scheduled branch
  // setting it is NEW: the marker regenerates from this stored value, so
  // every completion path must record it. Mirrors useTaskActions.toggleComplete.
  const completedAt = completed ? completionTimestamp() : null;
  if (inInbox) {
    const next = {
      ...task,
      completed,
      completedAt,
      ...(transitionId ? { transitionId } : {}),
    };
    return {
      ok: true,
      replayed: false,
      tasks,
      unscheduledTasks: unscheduled.map((t) => (t.id === taskId ? next : t)),
      task: next,
    };
  }
  const next = { ...task, completed, completedAt, ...(transitionId ? { transitionId } : {}) };
  return {
    ok: true,
    replayed: false,
    tasks: tasks.map((t) => (t.id === taskId ? next : t)),
    unscheduledTasks: unscheduled,
    task: next,
  };
}
