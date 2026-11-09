// Which goals the Goals view shows: the area filter, and completed goals
// hidden unless the user shows them (the toggle beside the area filter, per
// device, hidden by default like the Projects tab's Open list). One rule for
// List and Roadmap, desktop and phone. Pure.
//
// Archived goals are not here: the view leaves them out before this, and its
// Archived section lists them.

import { areaFilterHides } from './goalsLink.js';

export const SHOW_COMPLETED_GOALS_KEY = 'day-planner-goals-show-completed';

const isCompleted = (goal) => goal?.status === 'completed';

/**
 * @param {object[]} goals  the goals in play (visible to the user, not archived)
 * @param {{ areaFilter?: string, areas?: object[], showCompleted?: boolean }} filters
 * @returns {{ goals: object[], completedCount: number }}  `goals` in their
 *   given order; `completedCount` the completed goals the area filter lets
 *   through, shown or not, for the toggle's count
 */
export function goalsForView(goals = [], { areaFilter = 'all', areas = [], showCompleted = false } = {}) {
  const inArea = goals.filter((goal) => !areaFilterHides(goal, areaFilter, areas));
  const completedCount = inArea.filter(isCompleted).length;
  return { goals: showCompleted ? inArea : inArea.filter((goal) => !isCompleted(goal)), completedCount };
}

/**
 * What to change so `goal` is shown, for a request to go to it (a goal ring,
 * a widget, a link): the area filter widened when it hides the goal, and
 * completed goals shown when it is one. Empty when the goal is already shown
 * or there is none.
 *
 * @returns {{ areaFilter?: 'all', showCompleted?: true }}
 */
export function goalRevealFilters(goal, { areaFilter = 'all', areas = [], showCompleted = false } = {}) {
  if (!goal) return {};
  const out = {};
  if (areaFilterHides(goal, areaFilter, areas)) out.areaFilter = 'all';
  if (isCompleted(goal) && !showCompleted) out.showCompleted = true;
  return out;
}

/** The saved setting; anything missing or unreadable is hidden (the default). */
export function readShowCompletedGoals(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(SHOW_COMPLETED_GOALS_KEY) === 'true';
  } catch {
    return false;
  }
}
