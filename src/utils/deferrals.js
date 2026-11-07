// How many times a task has been pushed back after it came due.
//
// WHAT IT COUNTS, AND WHY NOT EVERYTHING
// A reschedule is two different acts wearing one gesture. Laying out tomorrow
// morning by dragging four tasks around is PLANNING, and counting it would
// report on how you use the timeline rather than on anything about the work.
// Moving a task you were supposed to have started is a SLIP, and that is the
// thing worth a number: a task that keeps sliding wants breaking up, dropping,
// or scheduling honestly.
//
// So the line is not same-day versus cross-day, which cuts across the
// distinction in both directions. Moving a 09:00 task at 09:30 is a slip even
// though the day did not change; moving tomorrow's task to Friday is planning
// even though it did. The line is whether the task had already COME DUE at the
// moment you moved it.
//
// MONOTONIC ON PURPOSE
// The count only ever rises, which is what lets two devices merge it by taking
// the maximum. Summing would double-count the same slip observed twice; a
// carry-forward would lose a count made offline. Max is the best estimate either
// device can offer and needs no coordination. That property is worth protecting:
// anything that could lower the number breaks the merge.
//
// The merge itself, mergeDeferrals, lives in @glance-apps/dayglance-vault
// (#2280) beside the vault adapter that applies it; imported back here.
import { mergeDeferrals } from '@glance-apps/dayglance-vault';

export { mergeDeferrals };

// "HH:MM" to minutes. Parsed here rather than imported: the only exported copy
// lives in streamDeckPayload.js, which pulls in the Electron protocol, and a
// core scheduling rule should not depend on the Stream Deck.
const startMinutes = (time) => {
  const [h, m] = String(time).split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (Number.isFinite(m) ? m : 0) : null;
};

/** Minutes since midnight for `date`, for comparing against a task's start. */
const minutesOfDay = (date) => date.getHours() * 60 + date.getMinutes();

/**
 * Had `task` come due at `now` — that is, has its scheduled start passed?
 *
 * A task with no date or time has not come due and cannot slip: there is no
 * moment it was supposed to begin.
 */
export function hasComeDue(task, now, todayStr) {
  if (!task?.date || !task.startTime) return false;
  if (task.date < todayStr) return true;
  if (task.date > todayStr) return false;
  const start = startMinutes(task.startTime);
  return start !== null && start <= minutesOfDay(now);
}

/**
 * Did the edit from `prev` to `next` defer a task that had already come due?
 *
 * Requires the schedule to have actually moved. An edit to a due task's title
 * is not a deferral, and neither is completing it.
 */
export function isDeferral(prev, next, now, todayStr) {
  if (!prev || !next) return false;
  const moved = prev.date !== next.date || prev.startTime !== next.startTime;
  return moved && hasComeDue(prev, now, todayStr);
}

/**
 * Return `currentTasks` with `deferrals` incremented for any task the edit since
 * `prevTasks` pushed back after it came due.
 *
 * Returns `currentTasks` ITSELF when nothing changed, so the persist pass can
 * tell by identity whether to write the result back into state — the same
 * contract stampOriginalPlan uses, and for the same reason: a field that reaches
 * only storage is invisible to the sync layer.
 */
export function stampDeferrals(currentTasks, prevTasks, now = new Date(), todayStr) {
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
    return { ...task, deferrals: (Number(task.deferrals) || 0) + 1 };
  });
  return changed ? out : currentTasks;
}

/**
 * Copy computed counts back onto the in-memory tasks, taking the higher value.
 *
 * The persist pass works on a filtered array and its result cannot be written
 * back wholesale, so this enriches in place — the same shape as applyBaselines,
 * but with the max rule rather than never-overwrite, because a count that rises
 * is the point rather than a value to protect.
 */
export function applyDeferrals(all, computed) {
  const byId = new Map(
    (computed || []).filter((t) => t && t.deferrals).map((t) => [String(t.id), t.deferrals]),
  );
  const list = all || [];
  let changed = false;
  const out = list.map((task) => {
    if (!task) return task;
    const merged = mergeDeferrals(task.deferrals, byId.get(String(task.id)));
    if (merged === task.deferrals) return task;
    changed = true;
    return { ...task, deferrals: merged };
  });
  return changed ? out : list;
}
