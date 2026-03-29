/**
 * Duration-weighted progress calculations for a single project.
 *
 * All tasks belonging to a project are weighted by their duration so that
 * a 2-hour task counts more than a 15-minute one.  Tasks with no duration
 * set fall back to DEFAULT_DURATION so they still contribute meaningfully
 * without forcing the user to assign a time estimate.
 */

const DEFAULT_DURATION = 30; // minutes — fallback for tasks with no duration set

/**
 * Calculates duration-weighted completion progress for a single project.
 *
 * @param {string} projectId
 * @param {Array} allTasks - combined scheduled + unscheduled tasks
 * @returns {number} value between 0 and 1 (0 if no tasks)
 */
export function calculateProjectProgress(projectId, allTasks) {
  const projectTasks = allTasks.filter(
    t => t.projectId === projectId && !t.archived
  );

  if (projectTasks.length === 0) return 0;

  const totalDuration = projectTasks.reduce(
    (sum, t) => sum + (t.duration || DEFAULT_DURATION), 0
  );

  if (totalDuration === 0) return 0;

  const completedDuration = projectTasks
    .filter(t => t.completed)
    .reduce((sum, t) => sum + (t.duration || DEFAULT_DURATION), 0);

  return completedDuration / totalDuration;
}

/**
 * Returns total task duration (minutes) for a project.
 * Used as the weight when computing goal-level progress.
 *
 * @param {string} projectId
 * @param {Array} allTasks
 * @returns {number} total minutes (0 if no tasks)
 */
export function getProjectTotalDuration(projectId, allTasks) {
  return allTasks
    .filter(t => t.projectId === projectId && !t.archived)
    .reduce((sum, t) => sum + (t.duration || DEFAULT_DURATION), 0);
}

/**
 * Returns whether a project is stalled:
 *   - has at least one incomplete task, AND
 *   - no task has completedAt within the last 7 days
 *
 * @param {string} projectId
 * @param {Array} allTasks
 * @returns {boolean}
 */
export function isProjectStalled(projectId, allTasks) {
  const projectTasks = allTasks.filter(
    t => t.projectId === projectId && !t.archived
  );

  const hasIncomplete = projectTasks.some(t => !t.completed);
  if (!hasIncomplete) return false;

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const cutoff = sevenDaysAgo.toISOString().slice(0, 10); // YYYY-MM-DD

  const hasRecentCompletion = projectTasks.some(
    t => t.completed && t.completedAt && t.completedAt >= cutoff
  );

  return !hasRecentCompletion;
}
