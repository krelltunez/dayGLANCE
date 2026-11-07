// Reading a task's plan history: where it was first planned (`originalPlan`),
// how often it slipped (`deferrals`) and where those slips landed
// (`planTrail`). The app's history panel (src/components/TaskPlanHistory.jsx)
// and the MCP read surface (@glance-apps/dayglance-mcp) both tell this story,
// so the rules that decide what there is to tell live here, once. Formerly
// planHistory in the app's src/utils/originalPlan.js and hiddenStops in its
// src/utils/planTrail.js, which import them back; the trail's validity rule
// was the vault merge's `clean` (@glance-apps/dayglance-vault planTrail.js),
// which imports it back too, so the merge and every reader agree on what a
// recorded stop is.
//
// What writes the fields (the persist pass's stamps) and how two devices
// merge them stay where they were: this is the reading half only.

/**
 * Describe how a task's current schedule differs from the plan it was first
 * given, or `null` when there is nothing to tell.
 *
 * `null` covers both "no baseline recorded" (every task that predates the
 * feature, and every task still sitting where it was first put) and "a baseline
 * that matches". Callers use it to decide whether to offer the history at all,
 * which is why a task that was never moved must NOT be reported as having any:
 * an affordance on every task that says "nothing happened" is worse than no
 * affordance.
 *
 * A baseline recorded before durations were carried has no `duration`, so that
 * field is only compared when the baseline actually holds one. An absent
 * duration is not a change from the current one.
 */
export function planHistory(task) {
  const plan = task?.originalPlan;
  if (!plan) return null;
  const changed = {
    date: plan.date !== task.date,
    startTime: plan.startTime !== task.startTime,
    duration: typeof plan.duration === 'number' && plan.duration !== task.duration,
  };
  if (!changed.date && !changed.startTime && !changed.duration) return null;
  return { plan, changed };
}

/**
 * The stops a stored `planTrail` really holds, in stored order: each with a
 * date, a start time and a finite `at`. Anything else (a non-array, a null
 * entry, a stop missing a part) is not a stop, and is dropped rather than
 * read. The vault merge cleans with this too, so a stop it would discard is
 * one no reader counts.
 */
export function planTrailStops(trail) {
  return (Array.isArray(trail) ? trail : [])
    .filter((e) => e && e.date && e.startTime && Number.isFinite(Number(e.at)));
}

/**
 * How many slips happened before the ones the trail still holds.
 *
 * Measured against the count, which is uncapped, rather than against the trail,
 * which is not — that is the whole reason both exist. Every RECORDED stop is on
 * screen somewhere (the newest as "now", the rest as intermediates), so the gap
 * is the count minus the trail's length, not minus the intermediates.
 *
 * Never negative: a union can briefly leave the trail longer than a count that
 * has not merged yet.
 */
export function hiddenStops(task) {
  return Math.max(0, (Number(task?.deferrals) || 0) - planTrailStops(task?.planTrail).length);
}
