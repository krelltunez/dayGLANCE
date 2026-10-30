// What archiving a project or a goal does to the rows under it, and how a
// restore undoes it (#2260).
//
// Archiving a project hides its completed tasks (`archived: true`) and detaches
// its open ones, which become ordinary Inbox/timeline tasks: the Inbox hides
// project tasks by default, so open work left inside an archived project would
// be visible nowhere. Archiving a goal does the same one level up: completed
// projects are archived with it, open ones become standalone.
//
// Before this module the cascade remembered nothing, so a restore only flipped
// the status back: the detached tasks stayed detached and the completed ones
// stayed hidden, and a restored project read as empty. Now the archive writes an
// `archiveRecord` on the project (or goal) itself, naming exactly the rows it
// changed and the status it had. Restore reverses those rows and nothing else:
// a task the user has since given another project keeps it, and a task that
// was archived before (the Inbox's auto-archive) stays archived. The record is
// a field of the project row, which syncs whole by `updatedAt`, so it travels
// with the archive that wrote it.
//
// Pure: App.jsx wraps updateProject / updateGoal with these, so every path that
// changes a status (the forms, the Archived list, an intent) reaches the same
// cascade. Each updater keeps the array identity when nothing changes.

const ARCHIVED = 'archived';

const idSet = (ids) => new Set((ids || []).map(String));
const has = (set, id) => set.has(String(id));

/** The status a restore returns to: the one the entity had when it was archived. */
export const restoredStatus = (entity) => {
  const prior = entity?.archiveRecord?.priorStatus;
  return prior && prior !== ARCHIVED ? prior : 'active';
};

const mapChanged = (rows, change) => {
  let changed = false;
  const next = rows.map((row) => {
    const out = change(row);
    if (out !== row) changed = true;
    return out;
  });
  return changed ? next : rows;
};

const isArchiving = (entity, updates) =>
  !!entity && updates?.status === ARCHIVED && entity.status !== ARCHIVED;
const isRestoring = (entity, updates) =>
  !!entity && updates?.status !== undefined && updates.status !== ARCHIVED && entity.status === ARCHIVED;

/**
 * A status change on a project, as a plan: `rowsUpdater` for the scheduled and
 * the Inbox task arrays (one function, applied to each), and `projectUpdates`
 * to merge into the update. Null when the change is not an archive or a
 * restore.
 *
 * @param {object} project  the project as it is now
 * @param {object} updates  the update about to be applied
 * @param {object[]} taskRows  every scheduled and Inbox task, to find its rows
 */
export function planProjectStatusChange(project, updates, taskRows = [], nowIso = new Date().toISOString()) {
  const projectId = project?.id;
  if (isArchiving(project, updates)) {
    const own = taskRows.filter((t) => t && t.projectId === projectId);
    const archivedTaskIds = own.filter((t) => t.completed && !t.archived).map((t) => t.id);
    const detachedTaskIds = own.filter((t) => !t.completed).map((t) => t.id);
    const hide = idSet(archivedTaskIds);
    const detach = idSet(detachedTaskIds);
    return {
      projectUpdates: { archiveRecord: { priorStatus: project.status || 'active', archivedAt: nowIso, archivedTaskIds, detachedTaskIds } },
      rowsUpdater: (rows) => mapChanged(rows, (t) => {
        if (t.projectId !== projectId) return t;
        if (has(hide, t.id)) return { ...t, archived: true, lastModified: nowIso };
        if (has(detach, t.id)) {
          const { projectId: _removed, ...rest } = t;
          return { ...rest, lastModified: nowIso };
        }
        return t;
      }),
    };
  }
  if (isRestoring(project, updates)) {
    const record = project.archiveRecord;
    // A project archived before the record existed: its hidden completed tasks
    // can still be shown again; which open tasks it detached is not known.
    const unhide = record ? idSet(record.archivedTaskIds) : null;
    const reattach = idSet(record?.detachedTaskIds);
    return {
      projectUpdates: { archiveRecord: null },
      rowsUpdater: (rows) => mapChanged(rows, (t) => {
        // `archived: false`, never a deleted key: both merges restore an
        // archived:true that the winning copy merely omits.
        if (t.projectId === projectId && t.archived === true && (!unhide || has(unhide, t.id))) {
          return { ...t, archived: false, lastModified: nowIso };
        }
        if (!t.projectId && has(reattach, t.id)) return { ...t, projectId, lastModified: nowIso };
        return t;
      }),
    };
  }
  return null;
}

/**
 * A status change on a goal, as a plan: `projectsUpdater` for the project list
 * and `goalUpdates` to merge into the update. Null when the change is not an
 * archive or a restore. A completed project archived with its goal carries its
 * own record, so restoring it alone brings it back as completed.
 */
export function planGoalStatusChange(goal, updates, projects = [], nowIso = new Date().toISOString()) {
  const goalId = goal?.id;
  if (isArchiving(goal, updates)) {
    const own = projects.filter((p) => p && p.goalId === goalId && p.status !== ARCHIVED);
    const archivedProjectIds = own.filter((p) => p.status === 'completed').map((p) => p.id);
    const detachedProjectIds = own.filter((p) => p.status !== 'completed').map((p) => p.id);
    const archive = idSet(archivedProjectIds);
    const detach = idSet(detachedProjectIds);
    return {
      goalUpdates: { archiveRecord: { priorStatus: goal.status || 'active', archivedAt: nowIso, archivedProjectIds, detachedProjectIds } },
      projectsUpdater: (rows) => mapChanged(rows, (p) => {
        if (p.goalId !== goalId) return p;
        if (has(archive, p.id)) {
          return {
            ...p, status: ARCHIVED, updatedAt: nowIso,
            archiveRecord: { priorStatus: p.status, archivedAt: nowIso, archivedTaskIds: [], detachedTaskIds: [] },
          };
        }
        if (has(detach, p.id)) {
          const { goalId: _removed, ...rest } = p;
          return { ...rest, updatedAt: nowIso };
        }
        return p;
      }),
    };
  }
  if (isRestoring(goal, updates)) {
    // A goal archived before the record existed: which projects it archived or
    // detached is not known, and those projects can be restored on their own.
    const record = goal.archiveRecord;
    const unarchive = idSet(record?.archivedProjectIds);
    const reattach = idSet(record?.detachedProjectIds);
    return {
      goalUpdates: { archiveRecord: null },
      projectsUpdater: (rows) => mapChanged(rows, (p) => {
        if (p.goalId === goalId && p.status === ARCHIVED && has(unarchive, p.id)) {
          return { ...p, status: restoredStatus(p), archiveRecord: null, updatedAt: nowIso };
        }
        if (!p.goalId && has(reattach, p.id)) return { ...p, goalId, updatedAt: nowIso };
        return p;
      }),
    };
  }
  return null;
}

/**
 * What an archived project held, for reviewing it (#2260): the completed tasks
 * the archive hid (or, for a project archived before the record, every hidden
 * task still pointing at it) and the open tasks it moved out, wherever they are
 * now. Sorted by completion, newest first.
 */
export function archivedProjectContents(project, taskRows = []) {
  if (!project) return { completed: [], detached: [] };
  const record = project.archiveRecord;
  const detachIds = idSet(record?.detachedTaskIds);
  const completed = taskRows
    .filter((t) => t && t.projectId === project.id && !has(detachIds, t.id))
    .sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
  const detached = taskRows.filter((t) => t && has(detachIds, t.id) && t.projectId !== project.id);
  return { completed, detached };
}

/**
 * The archived projects grouped by goal for the Archived list (#2260): one
 * group per goal they belong to, in goal order, then the ones with no goal (or
 * a goal this device does not have) under `goal: null`.
 */
export function groupArchivedProjects(archivedProjects = [], goals = []) {
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const groups = [];
  const byGoal = new Map();
  for (const project of archivedProjects) {
    const goal = project.goalId != null ? goalById.get(project.goalId) : undefined;
    const key = goal ? goal.id : null;
    if (!byGoal.has(key)) {
      const group = { goal: goal || null, projects: [] };
      byGoal.set(key, group);
      groups.push(group);
    }
    byGoal.get(key).projects.push(project);
  }
  const order = new Map(goals.map((g, i) => [g.id, i]));
  return groups.sort((a, b) => {
    if (!a.goal) return 1;
    if (!b.goal) return -1;
    return order.get(a.goal.id) - order.get(b.goal.id);
  });
}
