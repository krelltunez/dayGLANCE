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
 * Idempotent per the handleIntent.js:347-389 precedent (the one create-shaped
 * mutation-level dedup in the codebase): the caller derives `taskId`
 * deterministically from its idempotency key, so a replayed create finds the
 * id already present and returns the existing task unchanged.
 */
export function applyCreateTask(state, {
  taskId, title, notes, projectId, assigneeSyncId,
  priority, deadline, durationMinutes, schedule,
  transitionId, nowIso,
}) {
  const unscheduled = state.unscheduledTasks ?? [];
  const tasks = state.tasks ?? [];
  const trimmed = typeof title === 'string' ? title.trim() : '';
  if (!trimmed) return err(WRITE_ERROR_CODES.VALIDATION, 'title must be a non-empty string');

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

  const existing = unscheduled.find((t) => t.id === taskId) ?? tasks.find((t) => t.id === taskId);
  if (existing) {
    return {
      ok: true, replayed: true, unscheduledTasks: unscheduled, tasks,
      task: existing, scheduled: existing.date !== undefined,
    };
  }

  const base = {
    id: taskId,
    title: trimmed,
    duration: typeof durationMinutes === 'number' ? durationMinutes : 30,
    color: 'bg-blue-500',
    completed: false,
    isAllDay: false,
    notes: typeof notes === 'string' ? notes : '',
    subtasks: [],
    ...(projectId ? { projectId } : {}),
    ...(assignedUserSyncIds ? { assignedUserSyncIds } : {}),
    ...(transitionId ? { transitionId } : {}),
    lastModified: nowIso,
  };

  if (schedule) {
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

/**
 * UPDATE (edit fields in place). Shapes transcribed from the UI's own edits:
 * title from the edit-modal save (App.jsx ~3517: trimmed string + fresh
 * transitionId), notes from useTaskActions.updateTaskNotes, priority from
 * useDeadlinePriority.cyclePriority's commit map, deadline from
 * useTaskActions.setDeadline, assignee from the edit modal's direct
 * assignedUserSyncIds write. lastModified is deliberately NOT stamped here:
 * the save pass (useDataPersistence stampTaskTimestamps) diff-stamps both
 * tasks and unscheduledTasks, the applyMoveBlock/applyResizeBlock precedent.
 *
 * DELIBERATE DIFFERENCE from the UI edit modal: no cleanTitle(). Sigil
 * parsing ($fri, !2) is a typing-UI affordance; an agent writing "$fri" in a
 * title means the literal text, and silently converting it into a deadline
 * would be state the caller never requested. create_task set this precedent.
 *
 * FIELD RULES, all typed and by-design in wording (§5.2):
 *  - priority/deadline (set OR clear) rejected on scheduled tasks and on
 *    project tasks: the UI disables both controls there, so writing them
 *    would create state the UI cannot display, edit, or clear.
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
export function applyUpdateTask(state, { taskId, set = {}, clear = [], transitionId }) {
  const tasks = state.tasks ?? [];
  const unscheduled = state.unscheduledTasks ?? [];

  if (parseRecurringInstanceId(taskId)) {
    return err(
      WRITE_ERROR_CODES.VALIDATION,
      `${taskId} is a recurring-task instance: its id is a synthetic per-date view of the series, not an ` +
      'editable task, and update_task on recurring instances is not supported in v1. Edit the series in dayGLANCE',
    );
  }

  const inInbox = unscheduled.find((t) => t.id === taskId);
  const scheduled = tasks.find((t) => t.id === taskId);
  const task = inInbox ?? scheduled;
  if (!task) return err(WRITE_ERROR_CODES.NOT_FOUND, `No task with id ${taskId}`);
  if (task._native) return err(WRITE_ERROR_CODES.NATIVE_READONLY, NATIVE_MSG(taskId));
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
  if (touchesPressure && task.projectId) {
    return err(
      WRITE_ERROR_CODES.VALIDATION,
      'dayGLANCE project tasks do not carry priority or deadline by design: the app manages project work ' +
      'through the project itself, and the UI disables both controls for them.',
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

  if (task.transitionId && transitionId && task.transitionId === transitionId) {
    return { ok: true, replayed: true, tasks, unscheduledTasks: unscheduled, task, touched: [], scheduled: !inInbox };
  }

  const next = { ...task, ...(transitionId ? { transitionId } : {}) };
  const touched = [];
  const touch = (key) => { if (!touched.includes(key)) touched.push(key); };

  if (set.title !== undefined) { next.title = set.title; touch('title'); }
  if (set.notes !== undefined) { next.notes = set.notes; touch('notes'); }
  if (set.priority !== undefined) { next.priority = set.priority; touch('priority'); }
  if (set.deadline !== undefined) { next.deadline = set.deadline; touch('deadline'); }
  if (assignedUserSyncIds !== undefined) { next.assignedUserSyncIds = assignedUserSyncIds; touch('assignedUserSyncIds'); }
  for (const field of clear) {
    if (field === 'notes') { next.notes = ''; touch('notes'); }
    else if (field === 'deadline') { delete next.deadline; touch('deadline'); }
    else if (field === 'assignee') { delete next.assignedUserSyncIds; touch('assignedUserSyncIds'); }
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
function findWritableBlock(tasks, blockId, { operation }) {
  if (parseRecurringInstanceId(blockId)) {
    return err(
      WRITE_ERROR_CODES.VALIDATION,
      `${blockId} is a recurring-task instance; ${operation} on recurring instances is not supported in v1. Edit the series in dayGLANCE`,
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
/**
 * BULK UNDO (§4.3): apply a list of reversal ops produced by the main
 * process's write journal (electron/mcpJournal.ts buildUndoPlan). Ops arrive
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
          completedDatesTimestamps: { ...(template.completedDatesTimestamps || {}), [op.dateStr]: nowIso },
          lastModified: nowIso,
        };
        recurring = recurring.map((t) => (t.id === op.templateId ? nextTemplate : t));
        undone += 1;
        break;
      }
      default:
        skipped += 1;
    }
  }

  return { ok: true, tasks, unscheduledTasks: unscheduled, recurringTasks: recurring, recycleBin, undone, skipped };
}

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
