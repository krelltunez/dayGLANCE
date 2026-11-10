// A goal's "General" project (#2365): somewhere to put a task that belongs to
// a goal but to none of its projects, without making one first. A task never
// links to a goal directly: projects are what a goal is made of (its progress
// is its projects', agenda-core progress.js), so the goal gets a project of
// its own for loose tasks, made the first time one is filed there and reused
// after that.
//
// The task editor's project picker offers it as a row under every goal
// (utils/projectPickerRows.js): the goal's General project when it has one,
// else a "General (new)" row that makes it as "New project…" does, when the
// task is saved (utils/pendingProject.js), so a cancelled editor leaves
// nothing behind. Picking a goal with no projects at all is how a task first
// lands under it.
//
// The project is told apart by `goalGeneral: true`, not by its name: the name
// is the user's to change, and is written in whatever language the app was in
// when it was made. A project row syncs whole (entity-grain LWW on updatedAt,
// packages/dayglance-vault adapter.js), so the flag rides with it. Only an
// open one counts (not completed, not archived): a goal whose General project
// was finished gets a fresh one the next time.

import { isActiveProject } from './inboxProjectGroups.js';

// The picker's value for "General" under a goal that has none yet.
const PREFIX = '__goal-general__:';

/** The picker value that files a task in `goalId`'s General project. */
export const generalValue = (goalId) => `${PREFIX}${goalId}`;

/** The goal id a picker value names, or null for any other value. */
export const goalIdOfGeneralValue = (value) => (typeof value === 'string' && value.startsWith(PREFIX)
  ? value.slice(PREFIX.length)
  : null);

/** Whether `project` is a goal's General project. */
export const isGoalGeneral = (project) => project?.goalGeneral === true;

/** `goalId`'s open General project, or null. */
export function findGoalGeneralProject(projects = [], goalId) {
  if (goalId == null) return null;
  return (projects || []).find((p) => isGoalGeneral(p) && isActiveProject(p) && String(p.goalId) === String(goalId)) || null;
}
