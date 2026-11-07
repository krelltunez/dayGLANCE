// A task's plan history on the wire (#2321 follow-up): where it was first
// planned, how often it slipped, and where the recent slips landed, so an
// assistant can answer "which of today's tasks keep slipping?" or "what have
// I been putting off?" from the reads it already makes.
//
// The task row carries three synced fields the app records in its persist
// pass (src/utils/originalPlan.js, deferrals.js, planTrail.js) and shows in
// its history panel (src/components/TaskPlanHistory.jsx). This reports the
// same story the panel tells, by the same rules: planHistory, planTrailStops
// and hiddenStops are agenda-core's, shared with the panel.
//
// EVERY FIELD IS OMITTED WHEN IT HAS NOTHING TO SAY. Most tasks were never
// moved, and a key on every item saying "nothing happened" costs every
// payload for no information. Malformed values are omitted too, never
// guessed at and never thrown on: these rows arrive from sync, from other
// devices and from older versions.

import { planHistory, planTrailStops, hiddenStops } from '@glance-apps/agenda-core';
import { wireStamp } from './wireStamp.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// The start-time shape the read model already accepts (buildDayBlocks' sort).
const TIME = /^\d{1,2}:\d{2}$/;

const isDate = (v) => typeof v === 'string' && DATE.test(v);
const isTime = (v) => typeof v === 'string' && TIME.test(v);
const isMinutes = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * A recorded plan (`{ date, startTime, duration? }`) in the block's own field
 * names: `{ date, start_time, duration_minutes? }`. Null when it is not one.
 * An all-day plan records its time as 00:00, as the app stores it.
 */
function wirePlan(plan) {
  if (!plan || typeof plan !== 'object' || !isDate(plan.date) || !isTime(plan.startTime)) return null;
  const out = { date: plan.date, start_time: plan.startTime };
  if (isMinutes(plan.duration)) out.duration_minutes = plan.duration;
  return out;
}

/** A stop's `at` (epoch milliseconds) as a wire stamp, or null. */
function movedAt(at, timeZone) {
  const instant = new Date(Number(at));
  if (Number.isNaN(instant.getTime())) return null;
  return wireStamp(instant.toISOString(), timeZone);
}

/**
 * The plan-history fields for one task row, to spread onto its wire item:
 *
 *  - `original_plan`: `{ date, start_time, duration_minutes? }`, the plan the
 *    task was first given, only when its current plan differs from it (the
 *    panel's rule, planHistory). An inbox task that was once scheduled always
 *    differs: it has no plan now.
 *  - `deferrals`: how many times it slipped (was moved after it had come
 *    due), only when at least once.
 *  - `plan_trail`: the recorded slips, OLDEST FIRST, each `{ moved_at,
 *    date, start_time, duration_minutes? }`: when the move was made (a wire
 *    stamp in `timeZone`, as created_at) and where it moved the task to. The
 *    app keeps only the most recent six, so the newest is last and is
 *    usually where the task sits now.
 *  - `plan_trail_omitted`: beside `plan_trail`, how many counted slips it
 *    does not list (the panel's "+N earlier": the count minus the stops),
 *    only when there are any.
 *
 * Returns `{}` when there is nothing to tell.
 */
export function wirePlanHistory(task, timeZone) {
  const out = {};
  if (!task || typeof task !== 'object') return out;

  const history = planHistory(task);
  const original = history ? wirePlan(history.plan) : null;
  if (original) out.original_plan = original;

  const count = isMinutes(task.deferrals) ? Math.floor(task.deferrals) : 0;
  if (count > 0) out.deferrals = count;

  // Sorted by when the move was made: the merge keeps them so, but a row is
  // read as it arrives, and the order is part of what this promises.
  const stops = planTrailStops(task.planTrail)
    .filter((s) => isDate(s.date) && isTime(s.startTime))
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (Number(a.s.at) - Number(b.s.at)) || (a.i - b.i))
    .map(({ s }) => s);
  if (stops.length > 0) {
    out.plan_trail = stops.map((s) => {
      const stop = { moved_at: movedAt(s.at, timeZone), date: s.date, start_time: s.startTime };
      if (isMinutes(s.duration)) stop.duration_minutes = s.duration;
      return stop;
    });
    // Against the stops listed here, so a stop dropped above as malformed is
    // one of the slips not listed, never a gap the numbers hide.
    const omitted = hiddenStops({ deferrals: count, planTrail: stops });
    if (omitted > 0) out.plan_trail_omitted = omitted;
  }
  return out;
}
