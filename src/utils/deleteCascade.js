// The delete-time cascades (utils/deleteCascade.js).
//
// The store mutations in useGoalsProjects only touch their own collection plus
// the tombstone. These wrappers are what the app actually exposes as
// deleteProject / deleteGoal, so the UI, the intent transports and the MCP
// write layer all reach the SAME cleanup — the archive path in App.jsx has had
// a task detach for a while, but the delete path had none, which is how tasks
// (and, for a goal, whole projects) became unreachable after a deletion.
//
// Kept as plain functions taking the React setters, so the cascade is testable
// without mounting App.
//
// A reference is removed here only for the entity being deleted. The
// tombstone-keyed repairs for rows written before these cascades existed live
// at the ingress points (utils/referentialIntegrity.js, useDataPersistence's
// loadData and useSyncEngineData's applyEngineData) — never a "not in my list
// means deleted" inference here.
import { stripProjectRefs, stripGoalRefs, stripUserRefs } from './referentialIntegrity.js';

/**
 * Delete-time cascade for a project: every task-shaped row (scheduled, inbox,
 * recurring template, recycle-bin entry) loses the `projectId`, so the tasks
 * fall back to the Inbox as standalone tasks instead of becoming hidden
 * "project tasks" of a project that no longer exists.
 *
 * `setX` take an updater, like the React setters they are passed as; the strip
 * keeps the array identity when there is nothing to detach.
 */
export function detachDeletedProject(projectId, {
  setTasks, setUnscheduledTasks, setRecurringTasks, setRecycleBin,
} = {}) {
  if (projectId == null) return;
  const deleted = new Set([String(projectId)]);
  const strip = (rows) => stripProjectRefs(rows, deleted);
  setTasks?.(strip);
  setUnscheduledTasks?.(strip);
  setRecurringTasks?.(strip);
  setRecycleBin?.(strip);
}

/**
 * Delete-time cascade for a goal: its child projects become standalone rather
 * than keeping a `goalId` that resolves to nothing. Before this lived in the
 * goal dashboard's delete handler, which only covered the dashboard's own
 * button — a goal deleted by a lifeGLANCE intent or by an MCP-undo replay left
 * its projects in neither the goal list nor the standalone list.
 *
 * The repair is stamped (bare `deleteGoal` writes the tombstone but no stamp):
 * deleting a goal and reparenting its projects is a real edit made here, and it
 * has to win last-writer-wins against a peer's copy that still carries the
 * goalId.
 */
export function reparentDeletedGoal(goalId, { setProjects } = {}, nowIso = new Date().toISOString()) {
  if (goalId == null) return;
  const deleted = new Set([String(goalId)]);
  setProjects?.((projects) => stripGoalRefs(projects, deleted, nowIso));
}

/**
 * Cascade for a soft-deleted member (multi-user). The roster removes a member
 * by flagging them `deleted`; the rows they are assigned to keep the syncId,
 * and `isVisibleForUser` only shows a task/project/goal to the members in its
 * `assignedUserSyncIds` (or to everyone when that list is empty). A reference
 * to a deleted member therefore hides the row from EVERY remaining user.
 * Habits, routines and frames use the single `ownerSyncId` field instead.
 *
 * Clearing the reference makes the row unassigned ("everyone"), which is the
 * same state an explicit "assign to all" leaves and the only one that does not
 * lose the row. Rows are stamped so the repair wins the next last-writer-wins
 * merge; frames carry no per-row stamp, and inventing one would make the frame
 * look edited to every merge tier, so theirs is left alone.
 */
export function clearDeletedMemberRefs(deletedUserSyncIds, {
  setTasks, setUnscheduledTasks, setRecurringTasks, setRecycleBin,
  setProjects, setGoals, setHabits, setRoutineDefinitions, setTodayRoutines, setGtdFrames, setFrameSets,
} = {}, nowIso = new Date().toISOString()) {
  if (!Array.isArray(deletedUserSyncIds) || deletedUserSyncIds.length === 0) return;
  const assignments = { deletedUserSyncIds, field: 'assignedUserSyncIds' };
  const assign = (set) => set?.((rows) => stripUserRefs(rows, assignments, nowIso));
  assign(setTasks);
  assign(setUnscheduledTasks);
  assign(setRecurringTasks);
  assign(setRecycleBin);
  // Projects and goals persist with updatedAt, not lastModified.
  const assignUpdated = (set) => set?.((rows) =>
    stripUserRefs(rows, { deletedUserSyncIds, field: 'assignedUserSyncIds', stampField: 'updatedAt' }, nowIso));
  assignUpdated(setProjects);
  assignUpdated(setGoals);
  const owner = (set) => set?.((rows) =>
    stripUserRefs(rows, { deletedUserSyncIds, field: 'ownerSyncId', stampField: 'lastModified' }, nowIso));
  owner(setHabits);
  owner(setTodayRoutines);
  setRoutineDefinitions?.((definitions) => {
    let changed = false;
    const next = {};
    for (const [bucket, chips] of Object.entries(definitions || {})) {
      const pruned = stripUserRefs(chips, { deletedUserSyncIds, field: 'ownerSyncId', stampField: 'lastModified' }, nowIso);
      if (pruned !== chips) changed = true;
      next[bucket] = pruned;
    }
    return changed ? next : definitions;
  });
  // Frames have no per-row timestamp; do not invent one.
  setGtdFrames?.((frames) =>
    stripUserRefs(frames, { deletedUserSyncIds, field: 'ownerSyncId', stampField: null }, nowIso));
  // Frame sets (#2305) are owned like the frames they group, and repaired the
  // same way, so a deleted member's set does not vanish from every view while
  // its frames still follow it. (Unreadable sets are undefined, left alone.)
  setFrameSets?.((sets) =>
    stripUserRefs(sets, { deletedUserSyncIds, field: 'ownerSyncId', stampField: null }, nowIso));
}
