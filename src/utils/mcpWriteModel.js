// Renderer-side dispatcher for MCP write requests (spec §10 Phase 3),
// companion to the read model (@glance-apps/dayglance-mcp). Pure decisions live in taskMutations.js;
// this module maps request methods onto them, applies the results through
// the provided React setters, and shapes the §5.2 response (the resulting
// entity state, via the same toBlock the read surface uses).
//
// ATOMICITY (§5.2 no-partial-success): each mutation computes every affected
// slice from the same input state, and the setters are invoked back-to-back
// in the same handler tick — React batches them into one commit, so a
// schedule_task can never land with the task removed from the inbox but not
// yet on the calendar. A failed validation returns before any setter runs.
//
// UNDO DESCRIPTORS (§4.3, Phase 5b): every successful non-replayed write also
// returns an `undo` envelope — { summary, op } — captured HERE, from the
// before-state, because this is the only place that still has it: the journal
// in the main process records it, and bulk undo replays the ops back through
// applyUndoOps. Replayed writes carry no descriptor (nothing changed).
//
// THE DEFAULT TASK DURATION (#2367) rides in `state.defaultTaskDuration`,
// read per write by the bridge as retiredTaskIds is: a create or a schedule
// the call gives no duration takes the project's New task defaults, else this,
// as the app's own create paths do (taskMutations.js createDuration).
//
// RETIRED IDS RESOLVE TO THEIR SUCCESSOR (resolveMcpTaskId). A task id an MCP
// client holds can stop naming anything while the task lives on: the Obsidian
// placement pass re-keys a project task to obsidian-dg-<blockId> seconds after
// create_task returned its UUID. The commit that renames records the move in
// retiredTaskIds (utils/retiredTaskIds.js), so every id a write takes is
// resolved through that record before dispatch. A response for a resolved id
// carries `resolved_from` alongside the entity, whose id is the current one.

import {
  applyCreateTask,
  applyScheduleTask,
  applyMoveBlock,
  applyResizeBlock,
  applySetCompletion,
  applyUpdateTask,
  applyUpdateRecurringTask,
  applyAddSubtask,
  applyUpdateSubtask,
  applyUndoOps,
  parseRecurringInstanceId,
} from './taskMutations.js';
import {
  applyCreateGoal, applyUpdateGoal, applyCreateProject, applyUpdateProject,
  applyGoalProjectUndoOps, GOAL_PROJECT_UNDO_KINDS,
} from './goalProjectMutations.js';
import { toBlock, inboxItem, goalItem, projectItem, recurrenceToWire } from '@glance-apps/dayglance-mcp/model';
import { resolveRetirement } from './retiredTaskIds.js';
import { recurringTaskInstance } from './expandRecurringTasks.js';
import { getOccurrencesInRange } from './recurrenceEngine.js';
import { recordDeletedTaskTombstone } from './deletedTaskTombstones.js';

const WRITE_METHODS = new Set([
  'create_task', 'schedule_task', 'move_block', 'resize_block', 'set_completion',
  'update_task', 'update_recurring_task', 'add_subtask', 'update_subtask',
  'create_goal', 'update_goal', 'create_project', 'update_project',
  'undo_mcp_writes',
]);

export function isWriteMethod(method) {
  return WRITE_METHODS.has(method);
}

const q = (title) => `“${title ?? ''}”`;
const at = (date, startTime) => (startTime ? `${date} ${startTime}` : `${date}`);

/**
 * @param state   live slices: { tasks, unscheduledTasks, recurringTasks, goals, projects, areas, users }
 * @param setters { setTasks, setUnscheduledTasks, setRecurringTasks, setRecycleBin,
 *                  setGoals, setProjects, deleteGoal, deleteProject }
 * @param request { method, params }
 * Returns { ok:true, data, undo? } | { ok:false, error:{ code, message } } —
 * same envelope as handleMcpRequest plus the §4.3 undo descriptor, which the
 * main process journals and strips before anything reaches the MCP client.
 */
export function handleMcpWrite(state, setters, request) {
  const { params, resolvedFrom } = resolveRequestIds(state, request?.method, request?.params ?? {});
  const response = dispatchWrite(state, setters, request?.method, params);
  if (!resolvedFrom || !response.ok || !response.data) return response;
  return { ...response, data: { ...response.data, resolved_from: resolvedFrom } };
}

/**
 * The id a write should act on. An id that is live as given is used as given,
 * so a task the rename has not reached yet is never redirected. A retired id
 * resolves to its successor only when that successor is live: a device that
 * has the record but not yet the successor row keeps the original id, and the
 * caller gets an honest not_found rather than an edit landing elsewhere.
 * `retiredTaskIds` is the record as useMcpBridge read it for this request.
 */
export function resolveMcpTaskId(state, id) {
  if (typeof id !== 'string' || !id) return id;
  const isLive = (x) => (state.unscheduledTasks ?? []).some((t) => t.id === x)
    || (state.tasks ?? []).some((t) => t.id === x);
  if (isLive(id)) return id;
  const successor = resolveRetirement(state.retiredTaskIds, id);
  return successor && isLive(successor) ? successor : id;
}

const ID_PARAM = {
  create_task: 'taskId', update_task: 'taskId', schedule_task: 'taskId',
  set_completion: 'taskId', move_block: 'blockId', resize_block: 'blockId',
  add_subtask: 'taskId', update_subtask: 'taskId',
};

/**
 * Resolve the one id a write takes, plus the ids inside undo ops: the journal
 * recorded them at write time, and a create the vault has since claimed must
 * still undo. create_task resolves too, for its replay check: a deterministic
 * id the vault already re-keyed means the create happened, so the replay
 * returns that task instead of creating a second one.
 */
function resolveRequestIds(state, method, params) {
  if (method === 'undo_mcp_writes') {
    const ops = (params.ops ?? []).map((op) => {
      if (!op || typeof op !== 'object') return op;
      const next = { ...op };
      if (typeof op.taskId === 'string') next.taskId = resolveMcpTaskId(state, op.taskId);
      if (typeof op.blockId === 'string') next.blockId = resolveMcpTaskId(state, op.blockId);
      return next;
    });
    return { params: { ...params, ops }, resolvedFrom: null };
  }
  const key = ID_PARAM[method];
  if (!key) return { params, resolvedFrom: null };
  const resolved = resolveMcpTaskId(state, params[key]);
  if (resolved === params[key]) return { params, resolvedFrom: null };
  return { params: { ...params, [key]: resolved }, resolvedFrom: params[key] };
}

function dispatchWrite(state, setters, method, params) {
  const nowIso = new Date().toISOString();

  switch (method) {
    case 'create_task': {
      const r = applyCreateTask(state, { ...params, defaultDurationMinutes: state.defaultTaskDuration, nowIso });
      if (!r.ok) return r;
      if (r.series) {
        // A repeating task (#2066) is one template in recurringTasks; its
        // undo removes the series the way the app's own series delete does.
        if (!r.replayed) setters.setRecurringTasks(r.recurringTasks);
        const undo = r.replayed ? undefined : {
          summary: `Created repeating ${q(r.template.title)} from ${r.template.recurrence.startDate}`,
          op: { kind: 'remove_created_series', templateId: r.template.id },
        };
        return { ok: true, data: { ...seriesEntity(r.template), replayed: r.replayed }, ...(undo ? { undo } : {}) };
      }
      // One slice changed per shape (the other comes back by reference);
      // scheduled creates land directly in tasks — §5.2 atomicity is one
      // transition, not two batched ones.
      if (!r.replayed) {
        if (r.scheduled) setters.setTasks(r.tasks);
        else setters.setUnscheduledTasks(r.unscheduledTasks);
      }
      const undo = r.replayed ? undefined : {
        summary: r.scheduled
          ? `Created ${q(r.task.title)} at ${at(r.task.date, r.task.isAllDay ? null : r.task.startTime)}`
          : `Created ${q(r.task.title)}`,
        // A scheduled create still reverses as remove_created: applyUndoOps
        // finds it in tasks and bins it (_deletedFrom 'calendar') — no new
        // undo kind, no undoGroupKey extension.
        op: { kind: 'remove_created', taskId: r.task.id },
      };
      const entity = r.scheduled ? { block: toBlock(r.task) } : { task: inboxItem(r.task) };
      if (r.task.assignedUserSyncIds?.length) entity.assignee_id = r.task.assignedUserSyncIds[0];
      return { ok: true, data: { ...entity, replayed: r.replayed }, ...(undo ? { undo } : {}) };
    }
    case 'schedule_task': {
      // Captured BEFORE the mutation: applyScheduleTask strips priority and
      // deadline on the way to the calendar, so this snapshot is the only
      // faithful record of the inbox task.
      const beforeTask = (state.unscheduledTasks ?? []).find((t) => t.id === params.taskId);
      const r = applyScheduleTask(state, { ...params, defaultDurationMinutes: state.defaultTaskDuration, nowIso });
      if (!r.ok) return r;
      if (!r.replayed) {
        setters.setUnscheduledTasks(r.unscheduledTasks);
        setters.setTasks(r.tasks);
      }
      const undo = r.replayed || !beforeTask ? undefined : {
        summary: `Scheduled ${q(beforeTask.title)} at ${at(params.date, params.startTime)}`,
        op: { kind: 'restore_unscheduled', taskId: params.taskId, beforeTask },
      };
      // Scheduling strips priority/deadline BY DESIGN (applyScheduleTask);
      // the response must say so, so the model can tell the user instead of
      // the loss being silent. Priority 0 is "no priority" — nothing dropped.
      const dropped = r.replayed ? [] : scheduleDroppedFields(beforeTask);
      return {
        ok: true,
        data: {
          block: toBlock(r.task),
          replayed: r.replayed,
          ...(dropped.length ? {
            dropped_fields: dropped,
            note: `Scheduling dropped ${dropped.join(' and ')}: inbox-only fields by design. Tell the user if they asked to keep them.`,
          } : {}),
        },
        ...(undo ? { undo } : {}),
      };
    }
    case 'move_block': {
      const before = (state.tasks ?? []).find((t) => t.id === params.blockId);
      const r = applyMoveBlock(state, { ...params, nowIso });
      if (!r.ok) return r;
      if (!r.replayed) setters.setTasks(r.tasks);
      const undo = r.replayed || !before ? undefined : {
        summary: `Moved ${q(before.title)} from ${at(before.date, before.startTime)} to ${at(params.date, params.startTime)}`,
        op: {
          kind: 'restore_block_fields',
          blockId: params.blockId,
          before: { date: before.date, startTime: before.startTime ?? null, isAllDay: !!before.isAllDay },
        },
      };
      return { ok: true, data: { block: toBlock(r.task), replayed: r.replayed }, ...(undo ? { undo } : {}) };
    }
    case 'resize_block': {
      const before = (state.tasks ?? []).find((t) => t.id === params.blockId);
      const r = applyResizeBlock(state, { ...params, nowIso });
      if (!r.ok) return r;
      if (!r.replayed) setters.setTasks(r.tasks);
      const undo = r.replayed || !before ? undefined : {
        summary: `Resized ${q(before.title)} from ${before.duration ?? '?'} to ${params.durationMinutes} min`,
        op: { kind: 'restore_block_fields', blockId: params.blockId, before: { duration: before.duration ?? null } },
      };
      return { ok: true, data: { block: toBlock(r.task), replayed: r.replayed }, ...(undo ? { undo } : {}) };
    }
    case 'set_completion': {
      const undoSource = completionUndo(state, params);
      const r = applySetCompletion(state, { ...params, nowIso });
      if (!r.ok) return r;
      if (!r.replayed) {
        if (r.recurringTasks) setters.setRecurringTasks(r.recurringTasks);
        if (r.tasks) setters.setTasks(r.tasks);
        if (r.unscheduledTasks) setters.setUnscheduledTasks(r.unscheduledTasks);
      }
      const entity = r.task.date !== undefined || r.task.startTime !== undefined
        ? { block: toBlock(r.task) }
        : { task: { id: r.task.id, completed: !!r.task.completed } };
      const undo = r.replayed ? undefined : undoSource;
      return { ok: true, data: { ...entity, replayed: r.replayed }, ...(undo ? { undo } : {}) };
    }
    case 'update_task': {
      // Captured BEFORE the mutation: the undo op needs the prior value of
      // every field this call touches, and after the setters run this state
      // is gone.
      const beforeTask = (state.unscheduledTasks ?? []).find((t) => t.id === params.taskId)
        ?? (state.tasks ?? []).find((t) => t.id === params.taskId);
      const r = applyUpdateTask(state, { ...params, nowIso });
      if (!r.ok) return r;
      if (!r.replayed) {
        if (r.scheduled) setters.setTasks(r.tasks);
        else setters.setUnscheduledTasks(r.unscheduledTasks);
      }
      const undo = r.replayed || !beforeTask ? undefined : {
        // ONE-QUOTED-SPAN RULE, load-bearing: summaryTitle() extracts the
        // title as first “ to last ”, so a summary may contain exactly ONE
        // quoted span. Never quote two titles (a rename written as
        // Renamed “Old” to “New” would extract the garbage span Old” to “New).
        // The quoted title is the POST-EDIT one, so journalGroups'
        // latest-entry-wins labeling shows the task's current name.
        summary: `Edited ${q(r.task.title)} (${updatedFieldNames(r.touched).join(', ')})`,
        op: updateUndoOp(params.taskId, beforeTask, r.touched),
      };
      const entity = r.scheduled ? { block: toBlock(r.task) } : { task: inboxItem(r.task) };
      if (r.task.assignedUserSyncIds?.length) entity.assignee_id = r.task.assignedUserSyncIds[0];
      return { ok: true, data: { ...entity, replayed: r.replayed }, ...(undo ? { undo } : {}) };
    }
    case 'update_recurring_task': {
      const r = applyUpdateRecurringTask(state, { ...params, nowIso });
      if (!r.ok) return r;
      if (!r.unchanged) setters.setRecurringTasks(r.recurringTasks);
      const undo = r.undoSnapshot ? {
        // One quoted span (see update_task): the post-edit series title.
        summary: `Edited repeating ${q(r.template.title)} (${params.scope === 'series' ? 'series' : r.dateStr}: ${recurringFieldNames(params).join(', ')})`,
        op: { kind: 'restore_series_fields', ...r.undoSnapshot },
      } : undefined;
      const occurs = getOccurrencesInRange(r.template, r.dateStr, r.dateStr, 1).includes(r.dateStr);
      return {
        ok: true,
        data: {
          ...seriesEntity(r.template, { from: r.dateStr }),
          // The edited occurrence as it now reads; null when a pattern change
          // means the series no longer falls on that date.
          occurrence: occurs ? toBlock(occurrenceTask(r.template, r.dateStr)) : null,
          scope: params.scope,
          unchanged: !!r.unchanged,
        },
        ...(undo ? { undo } : {}),
      };
    }
    case 'add_subtask': {
      const r = applyAddSubtask(state, { ...params, nowIso });
      if (!r.ok) return r;
      if (!r.replayed) {
        if (r.scheduled) setters.setTasks(r.tasks);
        else setters.setUnscheduledTasks(r.unscheduledTasks);
      }
      const undo = r.replayed ? undefined : {
        summary: `Added subtask to ${q(r.task.title)}`,
        op: { kind: 'remove_created_subtask', taskId: params.taskId, subtaskId: r.subtask.id },
      };
      return { ok: true, data: { ...taskEntity(r), subtask: wireSubtask(r.subtask), replayed: r.replayed }, ...(undo ? { undo } : {}) };
    }
    case 'update_subtask': {
      const before = subtaskBefore(state, params.taskId, params.subtaskId);
      const r = applyUpdateSubtask(state, { ...params, nowIso });
      if (!r.ok) return r;
      if (!r.replayed) {
        if (r.scheduled) setters.setTasks(r.tasks);
        else setters.setUnscheduledTasks(r.unscheduledTasks);
      }
      const undo = r.replayed || !before ? undefined : {
        summary: `Edited a subtask of ${q(r.task.title)} (${r.touched.join(', ')})`,
        op: {
          kind: 'restore_subtask_fields', taskId: params.taskId, subtaskId: params.subtaskId,
          before: Object.fromEntries(r.touched.map((k) => [k, before[k]])),
        },
      };
      return { ok: true, data: { ...taskEntity(r), subtask: wireSubtask(r.subtask), replayed: r.replayed }, ...(undo ? { undo } : {}) };
    }
    case 'create_goal': {
      const r = applyCreateGoal(state, { ...params, nowIso });
      if (!r.ok) return r;
      if (!r.replayed) setters.setGoals((prev) => [...(prev ?? []), r.goal]);
      const undo = r.replayed ? undefined : {
        summary: `Created goal ${q(r.goal.title)}`,
        op: { kind: 'remove_created_goal', goalId: r.goal.id },
      };
      return { ok: true, data: { goal: goalItem(r.goal, stateWith(state, { goals: [...(state.goals ?? []), r.goal] })), replayed: r.replayed }, ...(undo ? { undo } : {}) };
    }
    case 'update_goal': {
      const beforeGoal = (state.goals ?? []).find((g) => g && g.id === params.goalId);
      const r = applyUpdateGoal(state, { ...params, nowIso });
      if (!r.ok) return r;
      const nextGoals = (state.goals ?? []).map((g) => (g.id === params.goalId ? r.goal : g));
      if (!r.replayed) setters.setGoals(() => nextGoals);
      const undo = r.replayed || !beforeGoal ? undefined : {
        summary: `Edited goal ${q(r.goal.title)} (${entityFieldNames(r.touched).join(', ')})`,
        op: { kind: 'restore_goal_fields', goalId: params.goalId, ...beforeFields(beforeGoal, r.touched) },
      };
      return { ok: true, data: { goal: goalItem(r.goal, stateWith(state, { goals: nextGoals })), replayed: r.replayed }, ...(undo ? { undo } : {}) };
    }
    case 'create_project': {
      const r = applyCreateProject(state, { ...params, nowIso });
      if (!r.ok) return r;
      if (!r.replayed) setters.setProjects((prev) => [...(prev ?? []), r.project]);
      const undo = r.replayed ? undefined : {
        summary: `Created project ${q(r.project.title)}`,
        op: { kind: 'remove_created_project', projectId: r.project.id },
      };
      return { ok: true, data: { project: projectItem(r.project, progressTasksOf(state)), replayed: r.replayed }, ...(undo ? { undo } : {}) };
    }
    case 'update_project': {
      const beforeProject = (state.projects ?? []).find((p) => p && p.id === params.projectId);
      const r = applyUpdateProject(state, { ...params, nowIso });
      if (!r.ok) return r;
      if (!r.replayed) setters.setProjects((prev) => (prev ?? []).map((p) => (p.id === params.projectId ? r.project : p)));
      const undo = r.replayed || !beforeProject ? undefined : {
        summary: `Edited project ${q(r.project.title)} (${entityFieldNames(r.touched).join(', ')})`,
        op: { kind: 'restore_project_fields', projectId: params.projectId, ...beforeFields(beforeProject, r.touched) },
      };
      return { ok: true, data: { project: projectItem(r.project, progressTasksOf(state)), replayed: r.replayed }, ...(undo ? { undo } : {}) };
    }
    case 'undo_mcp_writes': {
      // The §4.3 bulk undo. Not itself journaled (the main process clears the
      // journal on success), and applied through the same store layer as every
      // other write, so sync, GLANCEintents, and tray:data-changed all fire.
      // Undone creates land in the recycle bin (cross-list move, the UI's own
      // delete shape) so the vault propagates a legitimate delete instead of
      // healing back a fingerprint-less vanish — see applyUndoOps.
      const ops = params.ops ?? [];
      const taskOps = ops.filter((op) => !GOAL_PROJECT_UNDO_KINDS.includes(op?.kind));
      const entityOps = ops.filter((op) => GOAL_PROJECT_UNDO_KINDS.includes(op?.kind));
      const r = applyUndoOps(state, taskOps, { nowIso });
      setters.setTasks(r.tasks);
      setters.setUnscheduledTasks(r.unscheduledTasks);
      setters.setRecurringTasks(r.recurringTasks);
      setters.setRecycleBin(r.recycleBin);
      // An undone series create is a delete: tombstoned as the app's own
      // series delete does, so sync does not bring it back.
      for (const id of r.tombstones ?? []) recordDeletedTaskTombstone(id, nowIso);
      let undone = r.undone;
      let skipped = r.skipped;
      if (entityOps.length) {
        // Goal and project reversals (2026-10-04): field restores go through
        // the list setters; an undone create goes through the hook's own
        // delete, which writes the sync tombstone the UI's delete writes.
        const e = applyGoalProjectUndoOps(state, entityOps, { nowIso });
        if (setters.setGoals) setters.setGoals(() => e.goals);
        if (setters.setProjects) setters.setProjects(() => e.projects);
        for (const id of e.removedGoals) setters.deleteGoal?.(id);
        for (const id of e.removedProjects) setters.deleteProject?.(id);
        undone += e.undone;
        skipped += e.skipped;
      }
      return { ok: true, data: { undone, skipped } };
    }
    default:
      return { ok: false, error: { code: 'validation', message: `Unknown write method ${JSON.stringify(method)}` } };
  }
}

/**
 * Which inbox-only fields applyScheduleTask's by-design strip will actually
 * lose for this task: priority only when it carries one (0 is "no priority"),
 * deadline only when set. Pure so the rule is testable on its own.
 */
export function scheduleDroppedFields(beforeTask) {
  const dropped = [];
  if (typeof beforeTask?.priority === 'number' && beforeTask.priority > 0) dropped.push('priority');
  if (beforeTask?.deadline) dropped.push('deadline');
  return dropped;
}

/**
 * The restore_task_fields undo op for an update_task edit: `before` carries
 * the pre-edit value of every touched STORAGE key, and touched keys the task
 * did not have land in `absentBefore` so undo deletes them instead of
 * writing undefined into them. Pure so the before/absent split is testable
 * on its own.
 */
export function updateUndoOp(taskId, beforeTask, touched) {
  const before = {};
  const absentBefore = [];
  for (const key of touched ?? []) {
    if (beforeTask && Object.prototype.hasOwnProperty.call(beforeTask, key)) before[key] = beforeTask[key];
    else absentBefore.push(key);
  }
  return {
    kind: 'restore_task_fields',
    taskId,
    before,
    ...(absentBefore.length ? { absentBefore } : {}),
  };
}

/** Storage keys → the wire field names the summary shows the user. */
export function updatedFieldNames(touched) {
  return (touched ?? []).map((key) => (key === 'assignedUserSyncIds' ? 'assignee' : key));
}

/** Before-state for set_completion, across the three branches applySetCompletion handles. */
function completionUndo(state, { taskId, completed }) {
  const instance = parseRecurringInstanceId(taskId);
  if (instance) {
    const template = (state.recurringTasks ?? []).find((t) => t.id === instance.templateId);
    if (!template) return undefined;
    const wasCompleted = (template.completedDates || []).includes(instance.dateStr);
    return {
      summary: `Marked ${q(template.title)} (${instance.dateStr}) ${completed ? 'complete' : 'incomplete'}`,
      op: { kind: 'restore_recurring_completion', templateId: template.id, dateStr: instance.dateStr, wasCompleted },
    };
  }
  const task = (state.unscheduledTasks ?? []).find((t) => t.id === taskId)
    ?? (state.tasks ?? []).find((t) => t.id === taskId);
  if (!task) return undefined;
  return {
    summary: `Marked ${q(task.title)} ${completed ? 'complete' : 'incomplete'}`,
    op: {
      kind: 'restore_completion',
      taskId,
      before: { completed: !!task.completed, completedAt: task.completedAt ?? null },
    },
  };
}

/** How many upcoming dates a series response lists. */
const NEXT_OCCURRENCES = 5;

/** An occurrence as the read surface builds it, for toBlock. */
function occurrenceTask(template, dateStr) {
  return { ...recurringTaskInstance(template, dateStr), recurrence: template.recurrence };
}

/**
 * The series part of a create or update_recurring_task response: the series,
 * its pattern in the wire shape, and its next dates from `from` (the start
 * for a create) so the caller can confirm the pattern is the one it meant.
 */
function seriesEntity(template, { from } = {}) {
  const start = template.recurrence?.startDate;
  const dates = getOccurrencesInRange(template, from && from > start ? from : start, '9999-12-31', NEXT_OCCURRENCES);
  const data = {
    series: {
      id: String(template.id),
      title: template.title ?? '',
      repeat: recurrenceToWire(template.recurrence),
      start_date: start ?? null,
      ...(template.projectId ? { project_id: template.projectId } : {}),
      ...(template.notes ? { notes: template.notes } : {}),
    },
    next_occurrences: dates,
  };
  if (!from) data.first_occurrence = dates.length ? toBlock(occurrenceTask(template, dates[0])) : null;
  if (template.assignedUserSyncIds?.length) data.assignee_id = template.assignedUserSyncIds[0];
  return data;
}

/** The wire names of what an update_recurring_task call changed, for its summary. */
export function recurringFieldNames(params) {
  const names = { startTime: 'start_time', durationMinutes: 'duration', allDay: 'all_day', recurrence: 'repeat', projectId: 'project', assigneeSyncId: 'assignee' };
  const set = Object.keys(params.set ?? {}).map((k) => names[k] ?? k);
  const cleared = (params.clear ?? []).filter((k) => !set.includes(k));
  return [...set, ...cleared];
}

/** The task entity of a subtask write's response: block or inbox item, as update_task shapes it. */
function taskEntity(r) {
  return r.scheduled ? { block: toBlock(r.task) } : { task: inboxItem(r.task) };
}

function wireSubtask(st) {
  return { id: String(st.id), title: st.title ?? '', completed: !!st.completed };
}

function subtaskBefore(state, taskId, subtaskId) {
  const task = (state.unscheduledTasks ?? []).find((t) => t.id === taskId) ?? (state.tasks ?? []).find((t) => t.id === taskId);
  const st = (task?.subtasks || []).find((s) => s.id === subtaskId);
  return st ? { title: st.title ?? '', completed: !!st.completed } : null;
}

/** before / absentBefore for a goal or project edit, the updateUndoOp split. */
function beforeFields(entity, touched) {
  const before = {};
  const absentBefore = [];
  for (const key of touched ?? []) {
    if (Object.prototype.hasOwnProperty.call(entity, key)) before[key] = entity[key];
    else absentBefore.push(key);
  }
  return { before, ...(absentBefore.length ? { absentBefore } : {}) };
}

/** Storage keys → wire names for goal and project summaries. */
export function entityFieldNames(touched) {
  const names = { assignedUserSyncIds: 'assignees', areaId: 'area', goalId: 'goal', startDate: 'start_date', targetDate: 'target_date' };
  return (touched ?? []).map((key) => names[key] ?? key);
}

const stateWith = (state, patch) => ({ ...state, ...patch });

/** The denominator the read surface uses: every visible task that is not a device event. */
export function progressTasksOf(state) {
  const visible = typeof state.isVisibleForUser === 'function' ? state.isVisibleForUser : () => true;
  return [...(state.tasks ?? []), ...(state.unscheduledTasks ?? [])].filter(visible).filter((t) => !t._native);
}
