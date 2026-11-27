// Referential integrity for deletions (#2137).
//
// dayGLANCE keeps its collections independent and syncs each one on its own:
// tasks point at a project with `projectId`, projects point at a goal with
// `goalId`, and members are referenced by `assignedUserSyncIds` / `ownerSyncId`.
// A deletion is a tombstone on the deleted entity and nothing else walks the
// surviving rows. A reference that outlives its target is INVISIBLE state: the
// Inbox treats "has a projectId" as "belongs to a project" and hides the task
// (useComputedViews.filteredUnscheduledTasks), while the goal dashboard can
// only show a project under its own goal or as standalone, so a project whose
// goal is gone belongs to neither list. The task/project is then reachable only
// from surfaces that do not look the reference up at all, e.g. the overdue
// list — which reads as "it was deleted, why is it still there?".
//
// The delete-time cascades (utils/deleteCascade.js) clean up new deletions; the
// same helpers repair rows written before they existed and rows a peer had not
// repaired yet, at the two ingress points (loadData, applyEngineData).
//
// THE ONE RULE: a reference is dangling because a TOMBSTONE says its target is
// deleted, never because the id is missing from a list this device holds. A
// list can be incomplete for reasons that have nothing to do with deletion: a
// vault pull that carried tasks but not projects, a fresh device whose projects
// key is still [], a payload from a client with Goals & Projects off. Treating
// absence as deletion would detach live rows — and the repair would then win
// last-writer-wins on every other device. This is the same line the Todoist
// integration holds ("a missing source record means no information, never
// deletion").
//
// The helpers are pure and return the SAME array identity when nothing changed,
// so callers can feed them through React setters without causing a re-render
// (and a needless lastModified re-stamp) on every sync cycle.

const sameList = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

/**
 * Accept the shapes a tombstone map arrives in: a Set, a plain id array, or the
 * map localStorage stores (`{ id: deletedAt }`).
 */
const toIdSet = (value) => {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value.map(String));
  return new Set(Object.keys(value || {}));
};

/**
 * The deletion map to trust at an apply boundary. Both sync tiers merge
 * tombstone bundles grow-only into the payload, so a payload carrying the map
 * already includes this device's deletions — and a restore replaces the local
 * maps with the backup's, which must also replace them for the repair (a
 * project restored from a backup written before its deletion comes back WITH
 * its tasks attached). Only an older client that omits the key leaves the
 * local map in force, because the apply does not replace it then.
 *
 * @param {object|undefined} carried  the payload's map, if it has one
 * @param {object} local              this device's stored map
 */
export function resolveDeletedIds(carried, local) {
  return carried && typeof carried === 'object' ? carried : (local || {});
}

/**
 * Remove `projectId` from every task-shaped row whose project is tombstoned.
 * Rows are copied only when they change; an untouched list comes back as the
 * same array.
 *
 * @param {Array} rows tasks, unscheduled tasks, recurring templates, bin rows
 * @param {Set<string>|string[]|object|null} deletedProjectIds tombstoned ids
 */
export function stripProjectRefs(rows, deletedProjectIds = null) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const deleted = toIdSet(deletedProjectIds);
  if (deleted.size === 0) return rows;

  let changed = false;
  const next = rows.map((row) => {
    if (!row || !row.projectId) return row;
    if (!deleted.has(String(row.projectId))) return row;
    changed = true;
    const copy = { ...row };
    delete copy.projectId;
    return copy;
  });
  return changed ? next : rows;
}

/**
 * An open task is never archived. Every writer of `archived: true` acts on a
 * COMPLETED task only (the Inbox auto-archive, the Archive button, the
 * project-archive cascade), and the Archived bar draws its rows as done work.
 * The state arises only from a reopen that left the flag behind (reopen paths
 * did not clear it before 2026-11-27), or from a sync carry of `archived:
 * true` onto a copy reopened elsewhere. Such a task is hidden from the Inbox
 * and from its project while it is live work.
 *
 * The repair writes an explicit `archived: false` (both merges honour an
 * explicit false and carry only an ABSENT value) and is UNSTAMPED, like the
 * project-ref strip: it is a deterministic function of the row, so every
 * device makes the same repair and a last-writer-wins tie keeps each side's
 * copy instead of flipping. Callers run it before the storage write-back so
 * the save pass sees no difference and fabricates no `lastModified`.
 *
 * @param {Array} rows tasks, unscheduled tasks or bin rows
 */
export function unarchiveOpenTasks(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  let changed = false;
  const next = rows.map((row) => {
    if (!row || row.archived !== true || row.completed) return row;
    changed = true;
    return { ...row, archived: false };
  });
  return changed ? next : rows;
}

/**
 * A task as a reopen leaves it. `before` is the row as it was, `after` the row
 * the caller built (`completed: false` and its own fields); when `before` was
 * not completed, `after` comes back untouched.
 *
 * A reopen writes an explicit `archived: false`. Explicit, not a deleted key,
 * because both sync tiers carry `archived: true` forward onto a winning copy
 * that merely OMITS the field; absent and false compare equal in the save
 * pass, so it fabricates no stamp.
 *
 * A reopen also unlinks a task whose project is archived: an archived project
 * takes no open tasks (archiving one detaches them, `archiveCascade.js`), and
 * an open task left in one is hidden from every list. That is an ordinary edit
 * the user made, so it is stamped and wins last-writer-wins on every device.
 * Restoring the project reattaches the task (`planProjectStatusChange`).
 *
 * `projects` unknown (null) unlinks nothing.
 */
export function reopenTask(before, after, projects = null, nowIso = new Date().toISOString()) {
  if (!before?.completed || !after || after.completed) return after;
  const next = { ...after, archived: false };
  const projectId = next.projectId;
  if (projectId && Array.isArray(projects)
      && projects.some((p) => p && p.id === projectId && p.status === 'archived')) {
    delete next.projectId;
    next.lastModified = nowIso;
  }
  return next;
}

/**
 * The ingress repairs for a task-shaped list, in one call: the tombstone-keyed
 * project strip, then the open-archived repair. Same array identity when
 * neither changes anything.
 */
export function repairTaskRows(rows, deletedProjectIds = null) {
  return unarchiveOpenTasks(stripProjectRefs(rows, deletedProjectIds));
}

/**
 * Remove the `goalId` of a tombstoned goal from every project, so the project
 * becomes standalone instead of belonging to neither list.
 *
 * `nowIso` is passed by the delete-time cascade only: that removal is this
 * device's real edit and has to win last-writer-wins. The boot/apply repairs
 * pass no stamp on purpose — they are derived deterministically from the
 * tombstone, so every device makes the same repair and a tie converges. (The
 * earlier version of this fix also inferred deletion from a missing goal id,
 * which is why it stamped: a wrong detach then beat every other device's copy.
 * Tombstone-only inference removes that hazard.)
 */
export function stripGoalRefs(projects, deletedGoalIds = null, nowIso = null) {
  if (!Array.isArray(projects) || projects.length === 0) return projects;
  const deleted = toIdSet(deletedGoalIds);
  if (deleted.size === 0) return projects;

  let changed = false;
  const next = projects.map((project) => {
    if (!project || !project.goalId) return project;
    if (!deleted.has(String(project.goalId))) return project;
    changed = true;
    const copy = { ...project };
    delete copy.goalId;
    if (nowIso) copy.updatedAt = nowIso;
    return copy;
  });
  return changed ? next : projects;
}

/**
 * Drop references to deleted members (multi-user): the `assignedUserSyncIds`
 * array on tasks/projects/goals, or `ownerSyncId` string on habits, routines
 * and frames (`ownerField`). A removed member's rows otherwise fail
 * `isVisibleForUser` for EVERY remaining user and become unreachable.
 *
 * `clearFieldWhenEmpty` also deletes the array field when it empties, matching
 * the shapes the create path writes (an absent assignment means "everyone").
 */
export function stripUserRefs(items, {
  deletedUserSyncIds = null, field = 'assignedUserSyncIds', clearFieldWhenEmpty = true, stampField = 'lastModified',
} = {}, nowIso = null) {
  if (!Array.isArray(items) || items.length === 0) return items;
  const deleted = toIdSet(deletedUserSyncIds);
  if (deleted.size === 0) return items;

  let changed = false;
  const next = items.map((item) => {
    if (!item) return item;
    const copy = { ...item };
    let itemChanged = false;

    if (field === 'ownerSyncId') {
      if (copy.ownerSyncId && deleted.has(String(copy.ownerSyncId))) {
        delete copy.ownerSyncId;
        itemChanged = true;
      }
    } else {
      const assigned = copy[field];
      if (Array.isArray(assigned) && assigned.length > 0) {
        const kept = assigned.filter(syncId => !deleted.has(String(syncId)));
        if (!sameList(kept, assigned)) {
          itemChanged = true;
          if (kept.length === 0 && clearFieldWhenEmpty) delete copy[field];
          else copy[field] = kept;
        }
      }
    }

    if (!itemChanged) return item;
    changed = true;
    if (nowIso && stampField) copy[stampField] = nowIso;
    return copy;
  });
  return changed ? next : items;
}
