// The stops a task made between where it was first planned and where it sits
// now.
//
// `originalPlan` records the beginning and the task itself carries the end, so
// the history popover could say "planned for Monday 9am, now Friday 2pm" and
// nothing about the three moves in between. That is the question this answers:
// a task that slid Monday → Wednesday → Thursday → Friday is a different story
// from one moved once, and the two looked identical.
//
// WHAT GOES IN IT
// The same moves `deferrals` counts: a schedule change made after the task had
// already come due (utils/deferrals.js). Planning moves are left out for the
// reason they are left out of the count — dragging tomorrow's work around the
// timeline says something about how you plan, not about this task — and because
// a trail that grew on every drag would be mostly noise and would not fit in
// its cap.
//
// So the trail is the detail behind the count, not a second, competing number.
//
// BOUNDED, AND HONEST ABOUT IT
// Only the most recent TRAIL_CAP stops are kept. A task that slipped thirty
// times would otherwise carry thirty records forever, on every device, through
// every sync. The count keeps rising after the trail stops growing, which is
// exactly why `deferrals` is not derived from `trail.length`: the number stays
// true while the detail is necessarily partial, and the panel can say "+6
// earlier" under the oldest stop it kept because it has both.

import { isDeferral } from './deferrals.js';
// The merge (mergePlanTrail, sameTrail, TRAIL_CAP) lives in
// @glance-apps/dayglance-vault (#2280) beside the vault adapter that applies
// it; the trail's cleaning (planTrailStops, what counts as a recorded stop)
// in @glance-apps/agenda-core, which the merge and every reader share.
// Imported back here.
import { TRAIL_CAP, mergePlanTrail, sameTrail } from '@glance-apps/dayglance-vault';
import { planTrailStops as clean } from '@glance-apps/agenda-core';

export { TRAIL_CAP, mergePlanTrail, sameTrail };

/** The schedule a task moved TO, and when the move was observed. */
const stopAt = (task, now) => ({
  at: now.getTime(),
  date: task.date,
  startTime: task.startTime,
});

/**
 * Return `currentTasks` with a stop appended for any task the edit since
 * `prevTasks` pushed back after it came due.
 *
 * Returns `currentTasks` ITSELF when nothing moved, so the persist pass can tell
 * by identity whether to write the result back into React state. That contract
 * is not decoration: `originalPlan` shipped once writing only to localStorage,
 * where the sync layer could not see it, and the next apply wrote state back
 * over it.
 */
export function stampPlanTrail(currentTasks, prevTasks, now = new Date(), todayStr) {
  const today = todayStr ?? [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  const prevMap = new Map((prevTasks || []).map((t) => [String(t.id), t]));
  let changed = false;
  const out = currentTasks.map((task) => {
    const prevTask = prevMap.get(String(task.id));
    if (!isDeferral(prevTask, task, now, today)) return task;
    changed = true;
    return {
      ...task,
      planTrail: [...clean(task.planTrail), stopAt(task, now)].slice(-TRAIL_CAP),
    };
  });
  return changed ? out : currentTasks;
}

/**
 * Copy computed trails back onto the in-memory tasks, merging rather than
 * replacing.
 *
 * The persist pass works on a filtered array whose result cannot be written back
 * wholesale, so this enriches in place — the shape applyBaselines and
 * applyDeferrals use, with the union rule.
 */
export function applyPlanTrail(all, computed) {
  const byId = new Map(
    (computed || []).filter((t) => t && t.planTrail).map((t) => [String(t.id), t.planTrail]),
  );
  const list = all || [];
  let changed = false;
  const out = list.map((task) => {
    if (!task) return task;
    const incoming = byId.get(String(task.id));
    if (!incoming) return task;
    const merged = mergePlanTrail(task.planTrail, incoming);
    if (sameTrail(merged, task.planTrail)) return task;
    changed = true;
    return { ...task, planTrail: merged };
  });
  return changed ? out : list;
}

/**
 * The stops to show BETWEEN the baseline and the current plan.
 *
 * The last stop is normally where the task sits now, and the panel already ends
 * with that line under its own heading — repeating it would read as one move too
 * many. It is only dropped when it actually matches: a planning move made after
 * the final slip leaves the task somewhere the trail never recorded, and then
 * every stop really is intermediate.
 */
export function intermediatePlans(task) {
  const trail = clean(task?.planTrail);
  if (trail.length === 0) return [];
  const last = trail[trail.length - 1];
  const atCurrent = last.date === task.date && last.startTime === task.startTime;
  return atCurrent ? trail.slice(0, -1) : trail;
}

// How many slips happened before the ones the trail still holds (hiddenStops,
// the panel's "+N earlier") lives in @glance-apps/agenda-core, beside
// planHistory, because the MCP read surface reports the same count; imported
// back here.
export { hiddenStops } from '@glance-apps/agenda-core';
