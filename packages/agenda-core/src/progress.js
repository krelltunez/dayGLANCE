// Project and goal progress math, shared verbatim by dayGLANCE and the
// dayglance-bridge plugin (companion spec §4.3, ruling C: the plugin renders
// the maintained frontmatter block from its mirror, so both sides must agree
// on every number). Moved here from the app's utils; the app re-exports.
//
// Duration-weighted: a 2-hour task counts more than a 15-minute one. Tasks
// with no duration fall back to DEFAULT_DURATION so they still contribute.

const DEFAULT_DURATION = 30; // minutes, for tasks with no duration set

/**
 * Duration-weighted completion for one project. Returns null, not 0, when
 * there is nothing to measure ("measured, no progress yet" and "nothing to
 * measure" are different claims; callers must not treat null as a number).
 * @returns {number|null} 0..1
 */
export function calculateProjectProgress(projectId, allTasks) {
  const projectTasks = allTasks.filter((t) => t.projectId === projectId && !t.archived);
  if (projectTasks.length === 0) return null;
  const totalDuration = projectTasks.reduce((sum, t) => sum + (t.duration || DEFAULT_DURATION), 0);
  if (totalDuration === 0) return null;
  const completedDuration = projectTasks
    .filter((t) => t.completed)
    .reduce((sum, t) => sum + (t.duration || DEFAULT_DURATION), 0);
  return completedDuration / totalDuration;
}

/** Whole percent, or null when the project has nothing to measure. */
export function projectProgressPercent(projectId, allTasks) {
  const progress = calculateProjectProgress(projectId, allTasks);
  return progress === null ? null : Math.round(progress * 100);
}

/** Total task minutes of a project (the weight in goal progress). */
export function getProjectTotalDuration(projectId, allTasks) {
  return allTasks
    .filter((t) => t.projectId === projectId && !t.archived)
    .reduce((sum, t) => sum + (t.duration || DEFAULT_DURATION), 0);
}

/**
 * Stalled: at least 7 days old, has an incomplete task, and nothing of it
 * (task or recurring series) completed in the last 7 days. Recurring
 * activity only ever CLEARS the flag.
 */
export function isProjectStalled(projectId, allTasks, project, recurringTasks = []) {
  if (project?.createdAt) {
    const ageMs = Date.now() - new Date(project.createdAt).getTime();
    if (ageMs < 7 * 24 * 60 * 60 * 1000) return false;
  }
  const projectTasks = allTasks.filter((t) => t.projectId === projectId && !t.archived);
  const hasIncomplete = projectTasks.some((t) => !t.completed);
  if (!hasIncomplete) return false;
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const cutoff = sevenDaysAgo.toISOString().slice(0, 10);
  const hasRecentCompletion = projectTasks.some((t) => t.completed && t.completedAt && t.completedAt >= cutoff);
  if (hasRecentCompletion) return false;
  const hasRecentRecurringCompletion = recurringTasks.some(
    (t) => t.projectId === projectId && !t.archived && (t.completedDates || []).some((d) => d >= cutoff),
  );
  return !hasRecentRecurringCompletion;
}

/**
 * Weighted-average progress for a goal across its active and completed
 * child projects (archived excluded). A project with nothing to measure
 * carries no opinion. 0 when no child project measures anything.
 * @returns {number} 0..1
 */
export function calculateGoalProgress(goalId, projects, allTasks) {
  const childProjects = projects.filter((p) => p.goalId === goalId && p.status !== 'archived');
  if (childProjects.length === 0) return 0;
  let totalWeight = 0;
  let weightedSum = 0;
  for (const project of childProjects) {
    const progress = calculateProjectProgress(project.id, allTasks);
    if (progress === null) continue;
    const weight = getProjectTotalDuration(project.id, allTasks);
    totalWeight += weight;
    weightedSum += progress * weight;
  }
  return totalWeight === 0 ? 0 : weightedSum / totalWeight;
}
