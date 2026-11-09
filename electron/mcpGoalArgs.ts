// Argument-shape rules for the goal, project and subtask write tools
// (2026-10-04), extracted pure in the mcpUpdateArgs.ts style: every
// accept/reject decision that needs no app state lives here, unit-tested, so
// the tool handlers in mcpWriteTools.ts are wiring only. State-dependent
// rejections (unknown ids, the completion rules, archiving, a linked note
// holding the description) live in goalProjectMutations.js and
// taskMutations.js, where the records are visible.
//
// The update tools share the update_task contract: absent leaves a field
// alone, present sets it, a name in clear_fields removes it, and clearing is
// only ever the explicit list.

import { isValidLocalDate } from '@glance-apps/mcp-host';

type Reject = { ok: false; code: 'validation'; message: string };
const reject = (message: string): Reject => ({ ok: false, code: 'validation', message });

function nonEmpty(value: unknown, name: string): string | Reject {
  if (typeof value !== 'string' || !value.trim()) return reject(`${name} must be a non-empty string`);
  return value.trim();
}

function optionalString(value: unknown, name: string): string | undefined | Reject {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return reject(`${name} must be a string, got ${JSON.stringify(value)}`);
  return value;
}

function optionalDate(value: unknown, name: string): string | undefined | Reject {
  if (value === undefined) return undefined;
  if (!isValidLocalDate(value)) {
    return reject(`${name} must be a real local calendar date in strict YYYY-MM-DD form (no time), got ${JSON.stringify(value)}`);
  }
  return value as string;
}

function optionalIds(value: unknown, name: string, multiUser: boolean): string[] | undefined | Reject {
  if (value === undefined) return undefined;
  if (!multiUser) return reject(`${name} is accepted only while multi-user mode is on in dayGLANCE Settings.`);
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v.trim())) {
    return reject(`${name} must be an array of non-empty user id strings, got ${JSON.stringify(value)}`);
  }
  return value as string[];
}

function optionalStatus(value: unknown): 'active' | 'completed' | Reject | undefined {
  if (value === undefined) return undefined;
  if (value === 'active' || value === 'completed') return value;
  if (value === 'archived') {
    return reject('Archiving is not available over MCP by design: it is a step the user takes in dayGLANCE. status accepts "active" or "completed".');
  }
  return reject(`status must be "active" or "completed", got ${JSON.stringify(value)}`);
}

// A project can also be put on hold (src/utils/projectStatus.js): paused,
// not done and not put away. Goals have no such status.
function optionalProjectStatus(value: unknown): 'active' | 'on-hold' | 'completed' | Reject | undefined {
  if (value === 'on-hold') return value;
  if (value === undefined || value === 'active' || value === 'completed') return value;
  if (value === 'archived') {
    return reject('Archiving is not available over MCP by design: it is a step the user takes in dayGLANCE. status accepts "active", "on-hold" or "completed".');
  }
  return reject(`status must be "active", "on-hold" or "completed", got ${JSON.stringify(value)}`);
}

function clearList(value: unknown, allowed: readonly string[], multiUser: boolean): string[] | Reject {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return reject(`clear_fields must be an array of field names, got ${JSON.stringify(value)}`);
  const out: string[] = [];
  for (const field of value) {
    if (field === 'title') return reject('title is required and cannot be cleared. To change it, pass a new title instead.');
    if (typeof field !== 'string' || !allowed.includes(field)) {
      return reject(`${JSON.stringify(field)} is not a clearable field here. clear_fields accepts: ${allowed.join(', ')}.`);
    }
    if (field === 'assignees' && !multiUser) return reject('assignees can be cleared only while multi-user mode is on in dayGLANCE Settings.');
    if (!out.includes(field)) out.push(field);
  }
  return out;
}

const isReject = (v: unknown): v is Reject => typeof v === 'object' && v !== null && (v as Reject).ok === false;

// ── Goals ────────────────────────────────────────────────────────────────────

export interface CreateGoalPlan {
  title: string;
  description?: string;
  startDate?: string;
  targetDate?: string;
  areaId?: string;
  assigneeSyncIds?: string[];
}

export function planCreateGoal(args: Record<string, unknown>, multiUser: boolean): { ok: true; plan: CreateGoalPlan } | Reject {
  const title = nonEmpty(args['title'], 'title'); if (isReject(title)) return title;
  const description = optionalString(args['description'], 'description'); if (isReject(description)) return description;
  const startDate = optionalDate(args['start_date'], 'start_date'); if (isReject(startDate)) return startDate;
  const targetDate = optionalDate(args['target_date'], 'target_date'); if (isReject(targetDate)) return targetDate;
  const areaId = optionalString(args['area_id'], 'area_id'); if (isReject(areaId)) return areaId;
  if (areaId !== undefined && !areaId.trim()) return reject('area_id must be a non-empty area id');
  const assigneeSyncIds = optionalIds(args['assignee_ids'], 'assignee_ids', multiUser); if (isReject(assigneeSyncIds)) return assigneeSyncIds;
  if (startDate && targetDate && startDate > targetDate) return reject(`start_date ${startDate} is after target_date ${targetDate}`);
  return {
    ok: true,
    plan: {
      title,
      ...(description !== undefined ? { description } : {}),
      ...(startDate ? { startDate } : {}),
      ...(targetDate ? { targetDate } : {}),
      ...(areaId !== undefined ? { areaId } : {}),
      ...(assigneeSyncIds ? { assigneeSyncIds } : {}),
    },
  };
}

export const GOAL_CLEARABLE = ['description', 'start_date', 'target_date', 'area', 'assignees'] as const;

export interface UpdateGoalPlan {
  goalId: string;
  set: { title?: string; description?: string; descriptionBase?: string; startDate?: string; targetDate?: string; areaId?: string; status?: 'active' | 'completed'; assigneeSyncIds?: string[] };
  clear: string[];
}

/** description_base rides only with a description; alone it changes nothing and says so. */
function descriptionBase(args: Record<string, unknown>, set: { description?: string }): string | undefined | Reject {
  const base = args['description_base'];
  if (base === undefined) return undefined;
  if (typeof base !== 'string' || !base.trim()) return reject(`description_base must be the non-empty hash a read returned, got ${JSON.stringify(base)}`);
  if (set.description === undefined) return reject('description_base is only meaningful together with description.');
  return base;
}

export function planUpdateGoal(args: Record<string, unknown>, multiUser: boolean): { ok: true; plan: UpdateGoalPlan } | Reject {
  const goalId = nonEmpty(args['goal_id'], 'goal_id'); if (isReject(goalId)) return goalId;
  const clear = clearList(args['clear_fields'], GOAL_CLEARABLE, multiUser); if (isReject(clear)) return clear;
  const set: UpdateGoalPlan['set'] = {};
  if (args['title'] !== undefined) { const t = nonEmpty(args['title'], 'title'); if (isReject(t)) return t; set.title = t; }
  const description = optionalString(args['description'], 'description'); if (isReject(description)) return description;
  if (description !== undefined) set.description = description;
  const base = descriptionBase(args, set); if (isReject(base)) return base;
  if (base) set.descriptionBase = base;
  const startDate = optionalDate(args['start_date'], 'start_date'); if (isReject(startDate)) return startDate;
  if (startDate) set.startDate = startDate;
  const targetDate = optionalDate(args['target_date'], 'target_date'); if (isReject(targetDate)) return targetDate;
  if (targetDate) set.targetDate = targetDate;
  if (args['area_id'] !== undefined) { const a = nonEmpty(args['area_id'], 'area_id'); if (isReject(a)) return a; set.areaId = a; }
  const status = optionalStatus(args['status']); if (isReject(status)) return status;
  if (status) set.status = status;
  const assigneeSyncIds = optionalIds(args['assignee_ids'], 'assignee_ids', multiUser); if (isReject(assigneeSyncIds)) return assigneeSyncIds;
  if (assigneeSyncIds) set.assigneeSyncIds = assigneeSyncIds;

  const both = [
    ['description', set.description !== undefined], ['start_date', set.startDate !== undefined],
    ['target_date', set.targetDate !== undefined], ['area', set.areaId !== undefined], ['assignees', set.assigneeSyncIds !== undefined],
  ].find(([name, isSet]) => isSet && clear.includes(name as string));
  if (both) return reject(`${both[0]} is both set and named in clear_fields. Set it or clear it, not both.`);
  if (Object.keys(set).length === 0 && clear.length === 0) {
    return reject('Nothing to change: pass at least one field to set (title, description, start_date, target_date, area_id, status, assignee_ids) or name one in clear_fields.');
  }
  return { ok: true, plan: { goalId, set, clear } };
}

// ── Projects ─────────────────────────────────────────────────────────────────

export interface CreateProjectPlan {
  title: string;
  goalId?: string;
  description?: string;
  targetDate?: string;
  assigneeSyncIds?: string[];
}

export function planCreateProject(args: Record<string, unknown>, multiUser: boolean): { ok: true; plan: CreateProjectPlan } | Reject {
  const title = nonEmpty(args['title'], 'title'); if (isReject(title)) return title;
  const description = optionalString(args['description'], 'description'); if (isReject(description)) return description;
  let goalId: string | undefined;
  if (args['goal_id'] !== undefined) { const g = nonEmpty(args['goal_id'], 'goal_id'); if (isReject(g)) return g; goalId = g; }
  const targetDate = optionalDate(args['target_date'], 'target_date'); if (isReject(targetDate)) return targetDate;
  const assigneeSyncIds = optionalIds(args['assignee_ids'], 'assignee_ids', multiUser); if (isReject(assigneeSyncIds)) return assigneeSyncIds;
  return {
    ok: true,
    plan: {
      title,
      ...(goalId ? { goalId } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(targetDate ? { targetDate } : {}),
      ...(assigneeSyncIds ? { assigneeSyncIds } : {}),
    },
  };
}

export const PROJECT_CLEARABLE = ['description', 'goal', 'assignees', 'target_date'] as const;

export interface UpdateProjectPlan {
  projectId: string;
  set: { title?: string; description?: string; descriptionBase?: string; goalId?: string; status?: 'active' | 'on-hold' | 'completed'; targetDate?: string; assigneeSyncIds?: string[] };
  clear: string[];
}

export function planUpdateProject(args: Record<string, unknown>, multiUser: boolean): { ok: true; plan: UpdateProjectPlan } | Reject {
  const projectId = nonEmpty(args['project_id'], 'project_id'); if (isReject(projectId)) return projectId;
  const clear = clearList(args['clear_fields'], PROJECT_CLEARABLE, multiUser); if (isReject(clear)) return clear;
  const set: UpdateProjectPlan['set'] = {};
  if (args['title'] !== undefined) { const t = nonEmpty(args['title'], 'title'); if (isReject(t)) return t; set.title = t; }
  const description = optionalString(args['description'], 'description'); if (isReject(description)) return description;
  if (description !== undefined) set.description = description;
  const base = descriptionBase(args, set); if (isReject(base)) return base;
  if (base) set.descriptionBase = base;
  if (args['goal_id'] !== undefined) { const g = nonEmpty(args['goal_id'], 'goal_id'); if (isReject(g)) return g; set.goalId = g; }
  const targetDate = optionalDate(args['target_date'], 'target_date'); if (isReject(targetDate)) return targetDate;
  if (targetDate) set.targetDate = targetDate;
  const status = optionalProjectStatus(args['status']); if (isReject(status)) return status;
  if (status) set.status = status;
  const assigneeSyncIds = optionalIds(args['assignee_ids'], 'assignee_ids', multiUser); if (isReject(assigneeSyncIds)) return assigneeSyncIds;
  if (assigneeSyncIds) set.assigneeSyncIds = assigneeSyncIds;

  const both = [
    ['description', set.description !== undefined], ['goal', set.goalId !== undefined],
    ['assignees', set.assigneeSyncIds !== undefined], ['target_date', set.targetDate !== undefined],
  ].find(([name, isSet]) => isSet && clear.includes(name as string));
  if (both) return reject(`${both[0]} is both set and named in clear_fields. Set it or clear it, not both.`);
  if (Object.keys(set).length === 0 && clear.length === 0) {
    return reject('Nothing to change: pass at least one field to set (title, description, goal_id, status, target_date, assignee_ids) or name one in clear_fields.');
  }
  return { ok: true, plan: { projectId, set, clear } };
}

// ── Subtasks ─────────────────────────────────────────────────────────────────

export function planAddSubtask(args: Record<string, unknown>): { ok: true; plan: { taskId: string; title: string } } | Reject {
  const taskId = nonEmpty(args['task_id'], 'task_id'); if (isReject(taskId)) return taskId;
  const title = nonEmpty(args['title'], 'title'); if (isReject(title)) return title;
  return { ok: true, plan: { taskId, title } };
}

export function planUpdateSubtask(args: Record<string, unknown>): { ok: true; plan: { taskId: string; subtaskId: string; set: { title?: string; completed?: boolean } } } | Reject {
  const taskId = nonEmpty(args['task_id'], 'task_id'); if (isReject(taskId)) return taskId;
  const subtaskId = nonEmpty(args['subtask_id'], 'subtask_id'); if (isReject(subtaskId)) return subtaskId;
  const set: { title?: string; completed?: boolean } = {};
  if (args['title'] !== undefined) { const t = nonEmpty(args['title'], 'title'); if (isReject(t)) return t; set.title = t; }
  if (args['completed'] !== undefined) {
    if (typeof args['completed'] !== 'boolean') return reject(`completed must be a boolean, got ${JSON.stringify(args['completed'])}`);
    set.completed = args['completed'];
  }
  if (Object.keys(set).length === 0) return reject('Nothing to change: pass title, completed, or both.');
  return { ok: true, plan: { taskId, subtaskId, set } };
}
