// A project's status, and what "On hold" changes. Pure.
//
// Statuses: 'active', 'on-hold', 'completed', 'archived' (a plain string that
// already syncs). On hold is a pause: the project stays visible and intact,
// its tasks are left alone, and resuming is setting it back to Active. What
// it changes is what the project ASKS of you:
//   - no Stalled badge, no target-date or overdue warnings (the "due" lists
//     already read status === 'active' and leave it out);
//   - hyperGLANCE does not run (no bars, agenda entries or reminders);
//   - in the pickers it is still offered, after the active projects;
//   - it still counts toward its goal's progress (pausing is not failing),
//     and, not being done, still keeps its goal from being completed.
// Most of the app tests "not archived and not completed" for an open
// project, and keeps reading an on-hold project as open there: an older
// client that does not know the status sees it as active the same way.

export const PROJECT_ACTIVE = 'active';
export const PROJECT_ON_HOLD = 'on-hold';
export const PROJECT_COMPLETED = 'completed';

/** Whether a project is on hold. */
export const isOnHold = (project) => project?.status === PROJECT_ON_HOLD;

/** Whether a project's hyperGLANCE sessions run: enabled, not archived, not on hold. */
export const hyperGlanceRuns = (project) =>
  !!project && !project.archived && !!project.hyperglance?.enabled && !isOnHold(project);

/** `projects` with the on-hold ones moved after the others, each side in its given order. */
export function pausedLast(projects = []) {
  const list = Array.isArray(projects) ? projects : [];
  if (!list.some(isOnHold)) return list;
  return [...list.filter((p) => !isOnHold(p)), ...list.filter(isOnHold)];
}
