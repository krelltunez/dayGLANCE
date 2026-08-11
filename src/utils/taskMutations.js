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

export const WRITE_ERROR_CODES = Object.freeze({
  NOT_FOUND: 'not_found',
  VALIDATION: 'validation',
  NATIVE_READONLY: 'device_calendar_readonly',
});

const err = (code, message) => ({ ok: false, error: { code, message } });

const NATIVE_MSG = (id) =>
  `${id} is a device calendar event. dayGLANCE has read-only access to the device calendar and cannot modify, move, resize, or complete its events.`;

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
 * CREATE (inbox). Shape transcribed from useTaskActions.js addTask's inbox
 * branch (:155-174): base task + priority default 0, appended to
 * unscheduledTasks.
 *
 * Idempotent per the handleIntent.js:347-389 precedent (the one create-shaped
 * mutation-level dedup in the codebase): the caller derives `taskId`
 * deterministically from its idempotency key, so a replayed create finds the
 * id already present and returns the existing task unchanged.
 */
export function applyCreateTask(state, { taskId, title, notes, projectId, transitionId, nowIso }) {
  const unscheduled = state.unscheduledTasks ?? [];
  const trimmed = typeof title === 'string' ? title.trim() : '';
  if (!trimmed) return err(WRITE_ERROR_CODES.VALIDATION, 'title must be a non-empty string');

  const existing = unscheduled.find((t) => t.id === taskId) ?? (state.tasks ?? []).find((t) => t.id === taskId);
  if (existing) {
    return { ok: true, replayed: true, unscheduledTasks: unscheduled, task: existing };
  }

  const task = {
    id: taskId,
    title: trimmed,
    duration: 30,
    color: 'bg-blue-500',
    completed: false,
    isAllDay: false,
    notes: typeof notes === 'string' ? notes : '',
    subtasks: [],
    priority: 0,
    ...(projectId ? { projectId } : {}),
    ...(transitionId ? { transitionId } : {}),
    lastModified: nowIso,
  };
  return { ok: true, replayed: false, unscheduledTasks: [...unscheduled, task], task };
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

/** Shared lookup + guards for the block-mutating tools. */
function findWritableBlock(tasks, blockId, { operation }) {
  if (parseRecurringInstanceId(blockId)) {
    return err(
      WRITE_ERROR_CODES.VALIDATION,
      `${blockId} is a recurring-task instance; ${operation} on recurring instances is not supported in v1 — edit the series in dayGLANCE`,
    );
  }
  const task = tasks.find((t) => t.id === blockId);
  if (!task) return err(WRITE_ERROR_CODES.NOT_FOUND, `No scheduled block with id ${blockId}`);
  if (task._native) return err(WRITE_ERROR_CODES.NATIVE_READONLY, NATIVE_MSG(blockId));
  return { ok: true, task };
}

/**
 * MOVE. Shape transcribed from the canonical drop handler,
 * useDragDrop.js:466-470: `{ ...t, startTime, date, isAllDay: false,
 * transitionId }`. (lastModified is stamped by stampTaskTimestamps in the
 * save pass, exactly as for the UI drop.)
 */
export function applyMoveBlock(state, { blockId, date, startTime, transitionId }) {
  const tasks = state.tasks ?? [];
  const found = findWritableBlock(tasks, blockId, { operation: 'move_block' });
  if (!found.ok) return found;

  if (found.task.transitionId && transitionId && found.task.transitionId === transitionId) {
    return { ok: true, replayed: true, tasks, task: found.task };
  }
  const moved = { ...found.task, startTime, date, isAllDay: false, ...(transitionId ? { transitionId } : {}) };
  return { ok: true, replayed: false, tasks: tasks.map((t) => (t.id === blockId ? moved : t)), task: moved };
}

/**
 * RESIZE. Shape transcribed from the resize loop write,
 * useDragDrop.js:774-776: `{ ...t, duration }`. transitionId added on top
 * (the UI resize does not stamp one — noted in the Phase 3 trace) so the
 * emit correlation holds for MCP.
 */
export function applyResizeBlock(state, { blockId, durationMinutes, transitionId }) {
  const tasks = state.tasks ?? [];
  const found = findWritableBlock(tasks, blockId, { operation: 'resize_block' });
  if (!found.ok) return found;

  if (found.task.transitionId && transitionId && found.task.transitionId === transitionId) {
    return { ok: true, replayed: true, tasks, task: found.task };
  }
  const resized = { ...found.task, duration: durationMinutes, ...(transitionId ? { transitionId } : {}) };
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
 *  - inbox (:449-452): completed + completedAt + transitionId.
 *  - scheduled (:474-476): completed + transitionId (no completedAt — the UI
 *    scheduled branch does not set it, and this module matches the UI).
 *
 * NOT supported here, rejected explicitly rather than half-done:
 *  - _native events (read-only, see module header)
 *  - CalDAV task-calendar tasks (isTaskCalendar + icalUid): the UI pairs the
 *    local flip with a network write (syncTaskCompletionToCalDAV); doing the
 *    flip without the network half would desync the user's CalDAV server. A
 *    pure module cannot do the network half — v1 rejects.
 */
export function applySetCompletion(state, { taskId, completed, transitionId, todayStr, nowIso }) {
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
      completedDatesTimestamps: { ...(template.completedDatesTimestamps || {}), [instance.dateStr]: nowIso },
      lastModified: nowIso,
    };
    return {
      ok: true,
      replayed: false,
      recurringTasks: recurring.map((t) => (t.id === instance.templateId ? nextTemplate : t)),
      task: { id: taskId, completed },
    };
  }

  const inInbox = unscheduled.find((t) => t.id === taskId);
  const scheduled = tasks.find((t) => t.id === taskId);
  const task = inInbox ?? scheduled;
  if (!task) return err(WRITE_ERROR_CODES.NOT_FOUND, `No task with id ${taskId}`);
  if (task._native) return err(WRITE_ERROR_CODES.NATIVE_READONLY, NATIVE_MSG(taskId));
  if (task.isTaskCalendar && task.icalUid) {
    return err(
      WRITE_ERROR_CODES.VALIDATION,
      `${taskId} is a CalDAV task-calendar task; completing it requires a CalDAV write that MCP v1 does not perform`,
    );
  }

  if (!!task.completed === completed) {
    return { ok: true, replayed: true, tasks, unscheduledTasks: unscheduled, task };
  }

  if (inInbox) {
    const next = {
      ...task,
      completed,
      completedAt: completed ? todayStr : null,
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
  const next = { ...task, completed, ...(transitionId ? { transitionId } : {}) };
  return {
    ok: true,
    replayed: false,
    tasks: tasks.map((t) => (t.id === taskId ? next : t)),
    unscheduledTasks: unscheduled,
    task: next,
  };
}
