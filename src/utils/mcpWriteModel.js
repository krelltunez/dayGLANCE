// Renderer-side dispatcher for MCP write requests (spec §10 Phase 3),
// companion to mcpReadModel.js. Pure decisions live in taskMutations.js;
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

import {
  applyCreateTask,
  applyScheduleTask,
  applyMoveBlock,
  applyResizeBlock,
  applySetCompletion,
  applyUndoOps,
  parseRecurringInstanceId,
} from './taskMutations.js';
import { toBlock } from './mcpReadModel.js';

const WRITE_METHODS = new Set([
  'create_task', 'schedule_task', 'move_block', 'resize_block', 'set_completion',
  'undo_mcp_writes',
]);

export function isWriteMethod(method) {
  return WRITE_METHODS.has(method);
}

const q = (title) => `“${title ?? ''}”`;
const at = (date, startTime) => (startTime ? `${date} ${startTime}` : `${date}`);

/**
 * @param state   live slices: { tasks, unscheduledTasks, recurringTasks }
 * @param setters { setTasks, setUnscheduledTasks, setRecurringTasks }
 * @param request { method, params }
 * Returns { ok:true, data, undo? } | { ok:false, error:{ code, message } } —
 * same envelope as handleMcpRequest plus the §4.3 undo descriptor, which the
 * main process journals and strips before anything reaches the MCP client.
 */
export function handleMcpWrite(state, setters, request) {
  const params = request?.params ?? {};
  const nowIso = new Date().toISOString();

  switch (request?.method) {
    case 'create_task': {
      const r = applyCreateTask(state, { ...params, nowIso });
      if (!r.ok) return r;
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
      const r = applyScheduleTask(state, { ...params, nowIso });
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
            note: `Scheduling dropped ${dropped.join(' and ')} — inbox-only fields by design. Tell the user if they asked to keep them.`,
          } : {}),
        },
        ...(undo ? { undo } : {}),
      };
    }
    case 'move_block': {
      const before = (state.tasks ?? []).find((t) => t.id === params.blockId);
      const r = applyMoveBlock(state, params);
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
      const r = applyResizeBlock(state, params);
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
    case 'undo_mcp_writes': {
      // The §4.3 bulk undo. Not itself journaled (the main process clears the
      // journal on success), and applied through the same store layer as every
      // other write, so sync, GLANCEintents, and tray:data-changed all fire.
      // Undone creates land in the recycle bin (cross-list move, the UI's own
      // delete shape) so the vault propagates a legitimate delete instead of
      // healing back a fingerprint-less vanish — see applyUndoOps.
      const r = applyUndoOps(state, params.ops, { nowIso });
      setters.setTasks(r.tasks);
      setters.setUnscheduledTasks(r.unscheduledTasks);
      setters.setRecurringTasks(r.recurringTasks);
      setters.setRecycleBin(r.recycleBin);
      return { ok: true, data: { undone: r.undone, skipped: r.skipped } };
    }
    default:
      return { ok: false, error: { code: 'validation', message: `Unknown write method ${JSON.stringify(request?.method)}` } };
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

/** Inbox-item wire shape, matching buildUnscheduledItems in mcpReadModel.js. */
function inboxItem(t) {
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
}
