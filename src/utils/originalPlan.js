// Preserve the schedule a task was FIRST given, so "what I meant to do" survives
// being rescheduled into "what I ended up doing".
//
// WHY THIS EXISTS
// Rescheduling overwrites `date` and `startTime` in place. The moment a task
// planned for 09:00 is dragged to 16:00, the 09:00 intention is gone and cannot
// be recovered from anything the app stores. Every day the app runs without
// recording it destroys history permanently, which is why this is the piece
// worth landing before any of the comparison UI that eventually reads it.
//
// The record is `originalPlan: { date, startTime, duration }`, written onto the
// task itself. That placement is the point: tasks already flow through backup,
// restore, cloud sync and the vault, so the baseline rides all of them without a
// new store, a new reset path or a new quota to worry about.
//
// THREE RULES, ALL OF THEM LOAD-BEARING
//
// 1. WRITE ONCE, AND CARRIED FORWARD. A task that already carries an
//    `originalPlan` is returned untouched, whatever it arrived from — a local
//    edit, a cloud merge, a restored backup. The first value is the only true
//    one; a later write would overwrite the very thing this exists to keep.
//
//    The carrying forward is not tidiness, it is what makes the record survive at
//    all. This runs inside the persist pass, so what it returns goes to storage
//    but never back into React state. Without copying a stored baseline onto the
//    in-memory task, the very next save would write state — which has never seen
//    the field — straight over it, and the baseline would live for exactly one
//    save. `lastModified` is re-derived from the stored copy on every pass for
//    the same reason; this follows it.
//
// 2. ONLY WHEN THE SCHEDULING IS OBSERVED. A baseline is recorded when a task
//    goes from having no schedule to having one: new to this store entirely, or
//    stored previously without a date and time. If the stored copy was ALREADY
//    scheduled, nothing is written.
//
// 3. SO EXISTING TASKS ARE NEVER BACKFILLED, DELIBERATELY. It is tempting to
//    stamp every scheduled task on first run with its current schedule. That
//    would be a fabrication: for a task rescheduled three times last week, its
//    current schedule is precisely NOT its original plan, and recording it as
//    such invents history that is then indistinguishable from the real thing.
//    An absent `originalPlan` honestly means "not known". A wrong one is worse
//    than none, because anything built on top of this will believe it.
//
//    Refusing to backfill also avoids adding a field to every task at once,
//    which matters for a reason documented at length in stampTimestamps.js: a
//    mass field addition reads as a mass edit, re-stamps `lastModified` on
//    everything, and that fabricated timestamp outranks real completions made on
//    other devices. See also the `originalPlan` entry in normalizeField there,
//    which is the belt to this braces.

// A task counts as scheduled once it has both a date and a start time. All-day
// tasks carry `startTime: '00:00'`, so they qualify too and their baseline is
// effectively the date, which is the only part of an all-day plan that can move.
function scheduleOf(task) {
  if (!task || !task.date || !task.startTime) return null;
  const plan = { date: task.date, startTime: task.startTime };
  if (typeof task.duration === 'number') plan.duration = task.duration;
  return plan;
}

/**
 * Return `currentTasks` with `originalPlan` added to any task observed being
 * scheduled for the first time. Pure; every other task is returned by reference.
 *
 * Returns `currentTasks` ITSELF when nothing was added. Callers rely on that
 * identity to know whether anything changed, and the write-back in the persist
 * pass uses it to avoid re-rendering (and so re-saving) on every save.
 *
 * @param {object[]} currentTasks  in-memory task array about to be persisted
 * @param {object[]} prevTasks     the stored copy, to tell a new schedule from an
 *                                 existing one
 */
export function stampOriginalPlan(currentTasks, prevTasks) {
  const prevMap = new Map((prevTasks || []).map((t) => [String(t.id), t]));
  let changed = false;
  const out = currentTasks.map((task) => {
    if (task.originalPlan) return task;
    const prevTask = prevMap.get(String(task.id));
    if (prevTask && prevTask.originalPlan) {
      changed = true;
      return { ...task, originalPlan: prevTask.originalPlan };
    }
    const plan = scheduleOf(task);
    if (!plan) return task;
    if (prevTask && scheduleOf(prevTask)) return task;
    changed = true;
    return { ...task, originalPlan: plan };
  });
  return changed ? out : currentTasks;
}

/**
 * Copy the baselines from `planned` onto `all`, matching by id.
 *
 * The persist pass works on a FILTERED array (native calendar rows and, on some
 * devices, subscription imports are dropped before saving), so its result cannot
 * be written back to state wholesale without deleting those rows. This enriches
 * in place instead: nothing is added, nothing is removed, and an existing
 * baseline is never overwritten.
 */
export function applyBaselines(all, planned) {
  const byId = new Map(
    planned.filter((t) => t && t.originalPlan).map((t) => [String(t.id), t.originalPlan]),
  );
  const list = all || [];
  let changed = false;
  const out = list.map((task) => {
    if (!task || task.originalPlan) return task;
    const plan = byId.get(String(task.id));
    if (!plan) return task;
    changed = true;
    return { ...task, originalPlan: plan };
  });
  return changed ? out : list;
}

// Reading the baseline back (planHistory: what changed since the first plan,
// or null when nothing did) lives in @glance-apps/agenda-core, beside the rest
// of the plan history's reading rules, because the MCP read surface reports
// the same story the app's panel tells; imported back here.
export { planHistory } from '@glance-apps/agenda-core';
