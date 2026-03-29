/**
 * Weighted-average progress for a goal across its child projects.
 *
 * Each child project's contribution is weighted by its total task duration,
 * so a project with more (or longer) tasks has more influence on the goal's
 * overall progress bar.  Only active and completed projects are included —
 * archived projects are excluded from both numerator and denominator.
 */

import { calculateProjectProgress, getProjectTotalDuration } from './projectProgress.js';

/**
 * Calculates weighted-average progress for a goal.
 *
 * @param {string} goalId
 * @param {Array} projects - all projects
 * @param {Array} allTasks - combined scheduled + unscheduled tasks
 * @returns {number} value between 0 and 1 (0 if no child projects with tasks)
 */
export function calculateGoalProgress(goalId, projects, allTasks) {
  const childProjects = projects.filter(
    p => p.goalId === goalId && p.status !== 'archived'
  );

  if (childProjects.length === 0) return 0;

  let totalWeight = 0;
  let weightedSum = 0;

  for (const project of childProjects) {
    const weight = getProjectTotalDuration(project.id, allTasks);
    const progress = calculateProjectProgress(project.id, allTasks);
    totalWeight += weight;
    weightedSum += progress * weight;
  }

  if (totalWeight === 0) return 0;

  return weightedSum / totalWeight;
}
