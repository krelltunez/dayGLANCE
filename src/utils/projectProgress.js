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
 * Returns null, not 0, when there is nothing to measure. The two are different
 * claims — "measured, and no progress yet" versus "there is no measurement to
 * make" — and collapsing them meant a project whose only work is a recurring
 * series (series are excluded from progress on purpose, since a series never
 * completes) reported a confident 0% across every surface. Callers decide how
 * to render the absence; they must not treat null as a number.
 *
 * @param {string} projectId
 * @param {Array} allTasks - combined scheduled + unscheduled tasks
 * @returns {number|null} 0..1, or null when the project has no countable tasks
 */
export function calculateProjectProgress(projectId, allTasks) {
  const projectTasks = allTasks.filter(
    t => t.projectId === projectId && !t.archived
  );

  if (projectTasks.length === 0) return null;

  const totalDuration = projectTasks.reduce(
    (sum, t) => sum + (t.duration || DEFAULT_DURATION), 0
  );

  if (totalDuration === 0) return null;

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
 *   - project is at least 7 days old (grace period for new projects), AND
 *   - has at least one incomplete task, AND
 *   - no task has completedAt within the last 7 days, AND
 *   - no recurring series of the project was completed in the last 7 days
 *
 * @param {string} projectId
 * @param {Array} allTasks
 * @param {Object} project - the project object (needs createdAt)
 * @param {Array} [recurringTasks] - templates; their completedDates count as
 *   activity. Optional so callers with no access to them keep the old
 *   behaviour, which can only over-report stalling, never under-report it.
 * @returns {boolean}
 */
export function isProjectStalled(projectId, allTasks, project, recurringTasks = []) {
  // Grace period: don't flag projects created within the last 7 days
  if (project?.createdAt) {
    const ageMs = Date.now() - new Date(project.createdAt).getTime();
    if (ageMs < 7 * 24 * 60 * 60 * 1000) return false;
  }

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
  if (hasRecentCompletion) return false;

  // A project whose upkeep is a recurring series has no completed rows in
  // `allTasks` to find — completions live as dates on the template — so
  // ticking off a daily task every day still read as stalled. Recurring
  // activity only ever CLEARS the flag: a series is never counted as
  // outstanding work, so this can suppress a false positive but never raise a
  // new one.
  const hasRecentRecurringCompletion = recurringTasks.some(
    t => t.projectId === projectId
      && !t.archived
      && (t.completedDates || []).some(d => d >= cutoff)
  );

  return !hasRecentRecurringCompletion;
}
