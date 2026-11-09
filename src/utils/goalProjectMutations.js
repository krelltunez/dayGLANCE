// Canonical goal and project mutation shapes for the MCP write path, pure
// state-in/state-out like taskMutations.js: every MCP write goes through the
// same store layer as a UI edit (spec §3.1 r5), and every decision that needs
// no React lives here, unit-tested.
//
// EACH SHAPE IS A TRANSCRIPTION of the Goals & Projects forms (GoalForm and
// ProjectForm in components/goals/GoalDashboard.jsx) and of useGoalsProjects:
// a goal is created active with createdAt/updatedAt, its colour copied from
// its area at creation; a project copies its goal's colour and assignees at
// creation and follows neither afterwards; "completed" is offered only when
// every child is completed (GoalForm canComplete, ProjectForm canComplete).
//
// WHAT IS NOT HERE, by the owner's rule for the MCP surface (2026-10-04):
// no deletes and no archiving. A status write may move between active and
// completed; 'archived' is refused with a typed error naming the rule. The
// agent's own creates are reversible through the write journal, which is the
// one route a created goal or project leaves the store.
//
// THE DESCRIPTION OF A LINKED ENTITY lives in its Obsidian note's opening
// section (companion spec §4.3, 2026-10-03), not on the record. The read
// surface cannot show that text (the read model is synchronous state, the
// note is a file), so a write to it is refused rather than landing on a
// record field nothing displays: the error names the note.

import { TASK_COLORS, PROJECT_FALLBACK_COLOR } from './colorUtils.js';
import { noteLinkOf } from './obsidianProjectNotes.js';
import { WRITE_ERROR_CODES } from './taskMutations.js';

const err = (code, message) => ({ ok: false, error: { code, message } });

const ARCHIVE_MSG = (kind) =>
  `Archiving a ${kind} is not available over MCP by design: archiving, like deleting, is a step the user takes ` +
  `in dayGLANCE. Status may be set to "active" or "completed".`;

const LINKED_DESCRIPTION_MSG = (kind, link) =>
  `This ${kind}'s description lives in its linked Obsidian note (${link.name}), not in dayGLANCE, so it cannot be ` +
  'edited over MCP. Edit the opening section of that note.';

/** Resolve assignee ids against the active roster, as the task shapes do. */
function resolveAssignees(state, assigneeSyncIds) {
  if (assigneeSyncIds === undefined) return { ok: true, ids: undefined };
  const ids = [];
  for (const wanted of assigneeSyncIds) {
    const member = (state.users ?? []).find((u) => !u.deleted && (u.syncId === wanted || u.id === wanted));
    if (!member) {
      return err(WRITE_ERROR_CODES.NOT_FOUND,
        `No active user with id ${JSON.stringify(wanted)}. Enumerate valid assignees with dayglance_list_users`);
    }
    const id = member.syncId ?? member.id;
    if (!ids.includes(id)) ids.push(id);
  }
  return { ok: true, ids };
}

function findArea(state, areaId) {
  const area = (state.areas ?? []).find((a) => a && a.id === areaId);
  return area ? { ok: true, area } : err(WRITE_ERROR_CODES.NOT_FOUND,
    `No area with id ${JSON.stringify(areaId)}. Enumerate areas with dayglance_list_areas`);
}

function findGoal(state, goalId) {
  const goal = (state.goals ?? []).find((g) => g && g.id === goalId);
  return goal ? { ok: true, goal } : err(WRITE_ERROR_CODES.NOT_FOUND, `No goal with id ${JSON.stringify(goalId)}`);
}

/**
 * The GoalForm's rule: "completed" is offered only when every active child
 * project is completed (an archived child does not block it).
 */
export function goalCanComplete(goalId, projects) {
  const children = (projects ?? []).filter((p) => p && p.goalId === goalId && p.status !== 'archived');
  return children.every((p) => p.status === 'completed');
}

/** The ProjectForm's rule: every non-archived task of the project is completed. */
export function projectCanComplete(projectId, tasks, unscheduledTasks) {
  const own = [...(tasks ?? []), ...(unscheduledTasks ?? [])].filter((t) => t && t.projectId === projectId && !t.archived);
  return own.every((t) => t.completed);
}

/**
 * CREATE GOAL. Idempotent on `goalId` (the caller derives it from its
 * idempotency key, the applyCreateTask precedent): an existing id returns the
 * existing goal unchanged.
 */
export function applyCreateGoal(state, {
  goalId, title, description, startDate, targetDate, areaId, assigneeSyncIds, nowIso,
}) {
  const trimmed = typeof title === 'string' ? title.trim() : '';
  if (!trimmed) return err(WRITE_ERROR_CODES.VALIDATION, 'title must be a non-empty string');
  const existing = (state.goals ?? []).find((g) => g && g.id === goalId);
  if (existing) return { ok: true, replayed: true, goal: existing };

  let area = null;
  if (areaId !== undefined) {
    const r = findArea(state, areaId);
    if (!r.ok) return r;
    area = r.area;
  }
  const assignees = resolveAssignees(state, assigneeSyncIds);
  if (!assignees.ok) return assignees;
  if (startDate && targetDate && startDate > targetDate) {
    return err(WRITE_ERROR_CODES.VALIDATION, `start_date ${startDate} is after target_date ${targetDate}`);
  }

  const goal = {
    id: goalId,
    title: trimmed,
    description: typeof description === 'string' ? description.trim() : '',
    status: 'active',
    // Copy-at-creation, as the form does: the area's colour, else the first palette colour.
    color: area?.color || TASK_COLORS[0].class,
    ...(area ? { areaId: area.id } : {}),
    ...(startDate ? { startDate } : {}),
    ...(targetDate ? { targetDate } : {}),
    ...(assignees.ids?.length ? { assignedUserSyncIds: assignees.ids } : {}),
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  return { ok: true, replayed: false, goal };
}

/**
 * UPDATE GOAL. `set` carries wire-shaped values already validated for form
 * by the main process (dates strict YYYY-MM-DD); `clear` names fields to
 * remove. Returns the next record and the storage keys touched, for the
 * undo descriptor.
 */
export function applyUpdateGoal(state, { goalId, set = {}, clear = [], nowIso }) {
  const found = findGoal(state, goalId);
  if (!found.ok) return found;
  const goal = found.goal;

  if (set.status !== undefined) {
    if (set.status === 'archived') return err(WRITE_ERROR_CODES.VALIDATION, ARCHIVE_MSG('goal'));
    if (set.status !== 'active' && set.status !== 'completed') {
      return err(WRITE_ERROR_CODES.VALIDATION, `status must be "active" or "completed", got ${JSON.stringify(set.status)}`);
    }
    if (set.status === 'completed' && goal.status !== 'completed' && !goalCanComplete(goalId, state.projects)) {
      return err(WRITE_ERROR_CODES.VALIDATION,
        'This goal cannot be completed while it has incomplete projects: dayGLANCE offers "completed" only once every ' +
        'active child project is completed. Complete or detach those projects first.');
    }
  }
  const link = noteLinkOf(goal);
  if ((set.description !== undefined || clear.includes('description')) && link && !link.missing) {
    return err(WRITE_ERROR_CODES.VALIDATION, LINKED_DESCRIPTION_MSG('goal', link));
  }
  let area;
  if (set.areaId !== undefined) {
    const r = findArea(state, set.areaId);
    if (!r.ok) return r;
    area = r.area;
  }
  const assignees = resolveAssignees(state, set.assigneeSyncIds);
  if (!assignees.ok) return assignees;

  const next = { ...goal };
  const touched = [];
  const touch = (key) => { if (!touched.includes(key)) touched.push(key); };
  if (set.title !== undefined) { next.title = set.title; touch('title'); }
  if (set.description !== undefined) { next.description = set.description; touch('description'); }
  if (set.startDate !== undefined) { next.startDate = set.startDate; touch('startDate'); }
  if (set.targetDate !== undefined) { next.targetDate = set.targetDate; touch('targetDate'); }
  if (area) { next.areaId = area.id; touch('areaId'); }
  if (set.status !== undefined) { next.status = set.status; touch('status'); }
  if (assignees.ids !== undefined) { next.assignedUserSyncIds = assignees.ids; touch('assignedUserSyncIds'); }
  for (const field of clear) {
    if (field === 'description') { next.description = ''; touch('description'); }
    else if (field === 'start_date') { delete next.startDate; touch('startDate'); }
    else if (field === 'target_date') { delete next.targetDate; touch('targetDate'); }
    else if (field === 'area') { delete next.areaId; touch('areaId'); }
    else if (field === 'assignees') { delete next.assignedUserSyncIds; touch('assignedUserSyncIds'); }
  }
  if (next.startDate && next.targetDate && next.startDate > next.targetDate) {
    return err(WRITE_ERROR_CODES.VALIDATION, `start_date ${next.startDate} would be after target_date ${next.targetDate}`);
  }
  if (touched.length === 0) return { ok: true, replayed: true, goal, touched: [] };
  next.updatedAt = nowIso;
  return { ok: true, replayed: false, goal: next, touched };
}

/**
 * CREATE PROJECT. Idempotent on `projectId`. A project under a goal copies
 * the goal's colour and assignees at creation (ProjectForm's inheritance),
 * and never follows them afterwards.
 */
export function applyCreateProject(state, { projectId, title, goalId, description, targetDate, assigneeSyncIds, nowIso }) {
  const trimmed = typeof title === 'string' ? title.trim() : '';
  if (!trimmed) return err(WRITE_ERROR_CODES.VALIDATION, 'title must be a non-empty string');
  const existing = (state.projects ?? []).find((p) => p && p.id === projectId);
  if (existing) return { ok: true, replayed: true, project: existing };

  let goal = null;
  if (goalId !== undefined) {
    const r = findGoal(state, goalId);
    if (!r.ok) return r;
    goal = r.goal;
  }
  const assignees = resolveAssignees(state, assigneeSyncIds);
  if (!assignees.ok) return assignees;
  const inherited = assignees.ids ?? (goal?.assignedUserSyncIds?.length ? [...goal.assignedUserSyncIds] : undefined);

  const project = {
    id: projectId,
    title: trimmed,
    description: typeof description === 'string' ? description.trim() : '',
    status: 'active',
    color: goal?.color || PROJECT_FALLBACK_COLOR,
    ...(goal ? { goalId: goal.id } : {}),
    // The project's own target date, validated in the main process (dates
    // strict YYYY-MM-DD) exactly like the goal tools' target_date.
    ...(targetDate ? { targetDate } : {}),
    ...(inherited?.length ? { assignedUserSyncIds: inherited } : {}),
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  return { ok: true, replayed: false, project };
}

/** UPDATE PROJECT. Same contract as applyUpdateGoal. */
export function applyUpdateProject(state, { projectId, set = {}, clear = [], nowIso }) {
  const project = (state.projects ?? []).find((p) => p && p.id === projectId);
  if (!project) return err(WRITE_ERROR_CODES.NOT_FOUND, `No project with id ${JSON.stringify(projectId)}`);

  if (set.status !== undefined) {
    if (set.status === 'archived') return err(WRITE_ERROR_CODES.VALIDATION, ARCHIVE_MSG('project'));
    // On hold (utils/projectStatus.js) is a project's own status: paused, not
    // done and not put away, so it is open to an assistant as the form offers it.
    if (set.status !== 'active' && set.status !== 'on-hold' && set.status !== 'completed') {
      return err(WRITE_ERROR_CODES.VALIDATION, `status must be "active", "on-hold" or "completed", got ${JSON.stringify(set.status)}`);
    }
    if (set.status === 'completed' && project.status !== 'completed'
      && !projectCanComplete(projectId, state.tasks, state.unscheduledTasks)) {
      return err(WRITE_ERROR_CODES.VALIDATION,
        'This project cannot be completed while it has incomplete tasks: dayGLANCE offers "completed" only once every ' +
        'task in the project is completed. Complete those tasks first.');
    }
  }
  const link = noteLinkOf(project);
  if ((set.description !== undefined || clear.includes('description')) && link && !link.missing) {
    return err(WRITE_ERROR_CODES.VALIDATION, LINKED_DESCRIPTION_MSG('project', link));
  }
  let goal;
  if (set.goalId !== undefined) {
    const r = findGoal(state, set.goalId);
    if (!r.ok) return r;
    goal = r.goal;
  }
  const assignees = resolveAssignees(state, set.assigneeSyncIds);
  if (!assignees.ok) return assignees;

  const next = { ...project };
  const touched = [];
  const touch = (key) => { if (!touched.includes(key)) touched.push(key); };
  if (set.title !== undefined) { next.title = set.title; touch('title'); }
  if (set.description !== undefined) { next.description = set.description; touch('description'); }
  if (goal) { next.goalId = goal.id; touch('goalId'); }
  if (set.targetDate !== undefined) { next.targetDate = set.targetDate; touch('targetDate'); }
  if (set.status !== undefined) { next.status = set.status; touch('status'); }
  if (assignees.ids !== undefined) { next.assignedUserSyncIds = assignees.ids; touch('assignedUserSyncIds'); }
  for (const field of clear) {
    if (field === 'description') { next.description = ''; touch('description'); }
    // Detaching from a goal removes the key, as handleSaveGoal's cascade does.
    else if (field === 'goal') { delete next.goalId; touch('goalId'); }
    else if (field === 'assignees') { delete next.assignedUserSyncIds; touch('assignedUserSyncIds'); }
    else if (field === 'target_date') { delete next.targetDate; touch('targetDate'); }
  }
  if (touched.length === 0) return { ok: true, replayed: true, project, touched: [] };
  next.updatedAt = nowIso;
  return { ok: true, replayed: false, project: next, touched };
}

/**
 * Undo for the goal and project shapes, mirror of applyUndoOps for tasks:
 * returns the next lists plus counts. `remove_created_*` drops the record the
 * agent created (the dispatcher routes the id through the hook's delete so
 * the sync tombstone is written); `restore_*_fields` puts touched fields
 * back, deleting the ones that did not exist before.
 */
export function applyGoalProjectUndoOps(state, ops, { nowIso }) {
  let goals = state.goals ?? [];
  let projects = state.projects ?? [];
  const removedGoals = [];
  const removedProjects = [];
  let undone = 0;
  let skipped = 0;
  const restore = (list, id, op) => list.map((e) => {
    if (e.id !== id) return e;
    const next = { ...e, ...op.before, updatedAt: nowIso };
    for (const key of op.absentBefore ?? []) delete next[key];
    return next;
  });
  for (const op of ops ?? []) {
    switch (op?.kind) {
      case 'remove_created_goal':
        if (!goals.some((g) => g.id === op.goalId)) { skipped += 1; break; }
        goals = goals.filter((g) => g.id !== op.goalId);
        removedGoals.push(op.goalId);
        undone += 1;
        break;
      case 'remove_created_project':
        if (!projects.some((p) => p.id === op.projectId)) { skipped += 1; break; }
        projects = projects.filter((p) => p.id !== op.projectId);
        removedProjects.push(op.projectId);
        undone += 1;
        break;
      case 'restore_goal_fields':
        if (!op.before || !goals.some((g) => g.id === op.goalId)) { skipped += 1; break; }
        goals = restore(goals, op.goalId, op);
        undone += 1;
        break;
      case 'restore_project_fields':
        if (!op.before || !projects.some((p) => p.id === op.projectId)) { skipped += 1; break; }
        projects = restore(projects, op.projectId, op);
        undone += 1;
        break;
      default:
        skipped += 1;
    }
  }
  return { goals, projects, removedGoals, removedProjects, undone, skipped };
}

export const GOAL_PROJECT_UNDO_KINDS = Object.freeze([
  'remove_created_goal', 'remove_created_project', 'restore_goal_fields', 'restore_project_fields',
]);
