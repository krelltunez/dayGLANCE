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

import {
  applyCreateTask,
  applyScheduleTask,
  applyMoveBlock,
  applyResizeBlock,
  applySetCompletion,
} from './taskMutations.js';
import { toBlock } from './mcpReadModel.js';

const WRITE_METHODS = new Set(['create_task', 'schedule_task', 'move_block', 'resize_block', 'set_completion']);

export function isWriteMethod(method) {
  return WRITE_METHODS.has(method);
}

/**
 * @param state   live slices: { tasks, unscheduledTasks, recurringTasks }
 * @param setters { setTasks, setUnscheduledTasks, setRecurringTasks }
 * @param request { method, params }
 * Returns { ok:true, data } | { ok:false, error:{ code, message } } — same
 * envelope as handleMcpRequest, mapped by the main process onto §5.2 errors.
 */
export function handleMcpWrite(state, setters, request) {
  const params = request?.params ?? {};
  const nowIso = new Date().toISOString();

  switch (request?.method) {
    case 'create_task': {
      const r = applyCreateTask(state, { ...params, nowIso });
      if (!r.ok) return r;
      if (!r.replayed) setters.setUnscheduledTasks(r.unscheduledTasks);
      return { ok: true, data: { task: inboxItem(r.task), replayed: r.replayed } };
    }
    case 'schedule_task': {
      const r = applyScheduleTask(state, { ...params, nowIso });
      if (!r.ok) return r;
      if (!r.replayed) {
        setters.setUnscheduledTasks(r.unscheduledTasks);
        setters.setTasks(r.tasks);
      }
      return { ok: true, data: { block: toBlock(r.task), replayed: r.replayed } };
    }
    case 'move_block': {
      const r = applyMoveBlock(state, params);
      if (!r.ok) return r;
      if (!r.replayed) setters.setTasks(r.tasks);
      return { ok: true, data: { block: toBlock(r.task), replayed: r.replayed } };
    }
    case 'resize_block': {
      const r = applyResizeBlock(state, params);
      if (!r.ok) return r;
      if (!r.replayed) setters.setTasks(r.tasks);
      return { ok: true, data: { block: toBlock(r.task), replayed: r.replayed } };
    }
    case 'set_completion': {
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
      return { ok: true, data: { ...entity, replayed: r.replayed } };
    }
    default:
      return { ok: false, error: { code: 'validation', message: `Unknown write method ${JSON.stringify(request?.method)}` } };
  }
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
