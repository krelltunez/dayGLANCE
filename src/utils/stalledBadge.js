import { isProjectStalled } from './projectProgress.js';
import { getActiveHGInstance } from '../hooks/useHyperGlance.js';
import { isOnHold } from './projectStatus.js';

/**
 * Whether a project SHOWS the Stalled badge — the one gate every surface in
 * the Goals & Projects space uses (project card, project sidebar row, and the
 * goal card / goal row / phone goal header through hasStalledChild), so a
 * goal's caution and its child's badge never disagree.
 *
 * On top of the shared rule (isProjectStalled: 7+ days old, an open task, no
 * completion in 7 days) a project is flagged only when:
 *   - it belongs to a goal — standalone projects are never flagged; there is
 *     no per-project opt-out, and momentum on them is the Weekly Review's job
 *   - that goal has not opted out (hideStalled)
 *   - it has no active hyperGLANCE session (a session IS the plan)
 *   - it is not completed, nor on hold (a paused project is not stalled)
 */
export function isProjectFlaggedStalled(project, parentGoal, allTasks, recurringTasks, nowMinutes) {
  if (!project || !project.goalId || project.status === 'completed' || isOnHold(project)) return false;
  if (parentGoal?.hideStalled) return false;
  if (project.hyperglance?.enabled && getActiveHGInstance(project, nowMinutes)) return false;
  return isProjectStalled(project.id, allTasks, project, recurringTasks);
}

/** Whether any of a goal's child projects shows the Stalled badge. */
export function hasStalledChild(goal, childProjects, allTasks, recurringTasks, nowMinutes) {
  if (!goal || goal.hideStalled) return false;
  return childProjects.some((p) => p.goalId === goal.id && isProjectFlaggedStalled(p, goal, allTasks, recurringTasks, nowMinutes));
}
