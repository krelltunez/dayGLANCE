// Argument-shape rules for dayglance_update_task (spec §5.1), extracted pure
// in the mcpCreateArgs.ts style: every accept/reject decision that needs no
// task state lives here, unit-tested and mutation-verified, so the tool
// handler in mcpWriteTools.ts is wiring only. State-dependent rejections
// (scheduled/project tasks, _native, recurring instances, CalDAV) live in
// taskMutations.js applyUpdateTask, where the task is visible.
//
// FIELD SEMANTICS, the tool's whole contract:
//   absent   → leave the field alone
//   present  → set the field
//   named in clear_fields → remove the field
//
// clear_fields is an EXPLICIT list by design, not null-clears: models emit
// null when they have no value for a field, and a silent accidental clear is
// only recoverable through the journal. A field name has to be typed into a
// list on purpose. Only fields that can meaningfully be empty are clearable
// (deadline, notes, assignee); naming a required field like title, or any
// field outside the editable set, is a typed validation error.

import { isValidLocalDate } from './mcpDates.js';

export interface UpdateTaskArgs {
  task_id?: unknown;
  title?: unknown;
  notes?: unknown;
  priority?: unknown;
  deadline?: unknown;
  assignee_id?: unknown;
  clear_fields?: unknown;
}

/** What the renderer mutation needs; field names are its camelCase params. */
export interface UpdatePlan {
  taskId: string;
  set: {
    title?: string;
    notes?: string;
    priority?: number;
    deadline?: string;
    assigneeSyncId?: string;
  };
  clear: Array<'notes' | 'deadline' | 'assignee'>;
}

export type UpdatePlanResult =
  | { ok: true; plan: UpdatePlan }
  | { ok: false; code: 'validation'; message: string };

const reject = (message: string): UpdatePlanResult => ({ ok: false, code: 'validation', message });

const CLEARABLE = ['notes', 'deadline', 'assignee'] as const;
type Clearable = (typeof CLEARABLE)[number];

/**
 * Validate the wire arguments and shape the renderer mutation params.
 * `multiUser` gates assignee both ways: assignee_id only exists in the tool
 * schema while multi-user mode is on (mcpWriteTools.ts registration-time
 * gating), and 'assignee' in clear_fields is held to the same rule here so
 * the two halves of the field never diverge.
 */
export function planUpdateTask(args: UpdateTaskArgs, multiUser: boolean): UpdatePlanResult {
  const { task_id, title, notes, priority, deadline, assignee_id, clear_fields } = args;

  if (typeof task_id !== 'string' || !task_id.trim()) {
    return reject('task_id must be a non-empty string');
  }

  const clear: Clearable[] = [];
  if (clear_fields !== undefined) {
    if (!Array.isArray(clear_fields)) {
      return reject(`clear_fields must be an array of field names, got ${JSON.stringify(clear_fields)}`);
    }
    for (const field of clear_fields) {
      if (field === 'title') {
        return reject('title is required on every task and cannot be cleared. To change it, pass a new title instead.');
      }
      if (typeof field !== 'string' || !(CLEARABLE as readonly string[]).includes(field)) {
        return reject(
          `${JSON.stringify(field)} is not a clearable field. clear_fields accepts only fields that can ` +
          'meaningfully be empty: notes, deadline, assignee.',
        );
      }
      if (field === 'assignee' && !multiUser) {
        return reject('assignee can be cleared only while multi-user mode is on in dayGLANCE Settings.');
      }
      if (!clear.includes(field as Clearable)) clear.push(field as Clearable);
    }
  }

  // A field cannot be set and cleared in the same call: the two halves would
  // contradict, and silently picking one hides the caller's confusion.
  if (deadline !== undefined && clear.includes('deadline')) {
    return reject('deadline is both set and named in clear_fields. Set it or clear it, not both.');
  }
  if (notes !== undefined && clear.includes('notes')) {
    return reject('notes is both set and named in clear_fields. Set it or clear it, not both.');
  }
  if (assignee_id !== undefined && clear.includes('assignee')) {
    return reject('assignee_id is set while clear_fields names assignee. Set the assignee or clear it, not both.');
  }

  const set: UpdatePlan['set'] = {};
  if (title !== undefined) {
    if (typeof title !== 'string' || !title.trim()) {
      return reject('title must be a non-empty string');
    }
    set.title = title.trim();
  }
  if (notes !== undefined) {
    if (typeof notes !== 'string') {
      return reject(`notes must be a string, got ${JSON.stringify(notes)}`);
    }
    set.notes = notes;
  }
  if (priority !== undefined) {
    if (typeof priority !== 'number' || !Number.isInteger(priority) || priority < 0 || priority > 3) {
      return reject(`priority must be an integer 0-3 (0 none, 1 low, 2 medium, 3 high), got ${JSON.stringify(priority)}`);
    }
    set.priority = priority;
  }
  if (deadline !== undefined) {
    if (!isValidLocalDate(deadline)) {
      return reject(`deadline must be a real local calendar date in strict YYYY-MM-DD form (no time), got ${JSON.stringify(deadline)}`);
    }
    set.deadline = deadline as string;
  }
  if (assignee_id !== undefined) {
    if (typeof assignee_id !== 'string' || !assignee_id.trim()) {
      return reject(`assignee_id must be a non-empty user id string, got ${JSON.stringify(assignee_id)}`);
    }
    set.assigneeSyncId = assignee_id;
  }

  if (Object.keys(set).length === 0 && clear.length === 0) {
    return reject(
      'Nothing to change: pass at least one field to set (title, notes, priority, deadline, assignee_id) ' +
      'or name one in clear_fields.',
    );
  }

  return { ok: true, plan: { taskId: task_id, set, clear } };
}
