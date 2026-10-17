// "Skip this occurrence" from the Check (docs/jobo-skip-occurrence.md, agreed
// with Lcub3d on #2057). Pure helpers over recurring templates: no React, no
// storage, no ledger writes.
//
// A skip is an occurrence exception that already exists, `skipped: true`
// (every consumer hides the date and never counts it overdue), plus a small
// evidence record, `skip: { at, plan }`, that says it was skipped rather than
// moved. A `skipped` exception without `skip` is a move (Postpone, or a date
// change), as before.
import { recurringTaskInstance } from '../utils/expandRecurringTasks.js';

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

/** An exception that is a skip from the Check, not a move. */
export const isSkipException = exception => exception?.skipped === true
  && exception.skip != null && typeof exception.skip === 'object' && typeof exception.skip.at === 'string';

/**
 * The plan an occurrence shows, frozen into the skip: a later series edit
 * cannot rewrite what a skip says was planned.
 */
export function occurrencePlan(template, date) {
  const instance = recurringTaskInstance(template, date);
  return {
    startTime: instance.isAllDay ? null : instance.startTime ?? null,
    duration: Number.isFinite(Number(instance.duration)) ? Number(instance.duration) : 0,
    isAllDay: instance.isAllDay === true,
  };
}

/**
 * The template with `date` skipped, as a newer version. `at` is the skip's
 * own-clock stamp; it identifies the skip for Undo and Restore. `plan` puts
 * back a skip's own frozen plan (redo, or undoing a Restore); a new skip
 * freezes the plan the occurrence shows now. Null when the date already
 * carries a skip or a move, so a second press changes nothing.
 */
export function skipOccurrence(template, date, { at, plan, lastModified = at } = {}) {
  if (!template || typeof date !== 'string' || typeof at !== 'string') return null;
  const exception = template.exceptions?.[date];
  if (exception?.skipped || exception?.deleted) return null;
  return {
    ...template,
    exceptions: {
      ...(template.exceptions || {}),
      [date]: { ...(exception || {}), skipped: true, skip: { at, plan: plan ?? occurrencePlan(template, date) } },
    },
    lastModified,
  };
}

/**
 * Undo and Restore: one targeted inverse. Removes `skipped` and `skip` on that
 * date and nothing else. The exception's key stays, even if empty, since its
 * presence marks a saved occurrence for the statistics history (the rule the
 * series editor follows). Null unless the date still carries THIS skip
 * (`at`), so an inverse never acts on a skip it did not make, or on a date
 * that sync, a move or another restore has changed since.
 */
export function restoreOccurrence(template, date, at, { lastModified = new Date().toISOString() } = {}) {
  const exception = template?.exceptions?.[date];
  if (!isSkipException(exception) || exception.skip.at !== at) return null;
  const { skipped: _skipped, skip: _skip, ...rest } = exception;
  return { ...template, exceptions: { ...template.exceptions, [date]: rest }, lastModified };
}

/** Apply `change` to the template `templateId` in a list; null if it refused. */
export function updateTemplate(recurringTasks, templateId, change) {
  const index = (recurringTasks || []).findIndex(template => sameId(template?.id, templateId));
  if (index < 0) return null;
  const next = change(recurringTasks[index]);
  if (!next) return null;
  const copy = recurringTasks.slice();
  copy[index] = next;
  return copy;
}

/** The dates in [from, to] that carry a skip from the Check, sorted. */
export function skippedDates(template, from, to) {
  return Object.entries(template?.exceptions || {})
    .filter(([date, exception]) => date >= from && date <= to && isSkipException(exception))
    .map(([date]) => date)
    .sort();
}

/**
 * What a skipped occurrence is now. A Do is execution evidence, not a
 * completion; a completion wins over both.
 *  - 'completed': the occurrence was completed after the skip;
 *  - 'worked': a Do was recorded against it (its task and captured date);
 *  - 'skipped': neither. Only these count, and are labelled, as Skipped.
 */
export function skipState(template, date, records = []) {
  if ((template.completedDates || []).includes(date)) return 'completed';
  const worked = (records || []).some(record => record && !record.deleted
    && record.source !== 'completion' && sameId(record.taskId, template.id)
    && record.planSnapshot?.date === date);
  return worked ? 'worked' : 'skipped';
}

/**
 * Every occurrence on `date` that carries a skip, task-shaped for the Check's
 * Skipped group and the statistics: the frozen plan, the template's current
 * title and colour, and its state. Visible to the current user only.
 */
export function skippedOccurrences(recurringTasks, date, { records = [], isVisibleForUser } = {}) {
  const rows = [];
  for (const template of recurringTasks || []) {
    const exception = template?.exceptions?.[date];
    if (!isSkipException(exception)) continue;
    const instance = recurringTaskInstance(template, date);
    if (typeof isVisibleForUser === 'function' && !isVisibleForUser(instance)) continue;
    const plan = exception.skip.plan || {};
    rows.push({
      ...instance,
      startTime: plan.isAllDay ? instance.startTime : plan.startTime ?? instance.startTime,
      duration: Number.isFinite(Number(plan.duration)) ? Number(plan.duration) : instance.duration,
      isAllDay: plan.isAllDay ?? instance.isAllDay,
      priority: template.priority,
      skippedAt: exception.skip.at,
      skipState: skipState(template, date, records),
    });
  }
  return rows.sort((a, b) => String(a.startTime || '').localeCompare(String(b.startTime || ''))
    || String(a.title).localeCompare(String(b.title)));
}

/**
 * A series' skips from the Check in [from, to], for statistics outside JOBO
 * (MONTH, the daily summary). They read occurrences through the recurrence
 * engine, which hides skipped dates; adding these back keeps a skip in the
 * denominator as planned and not done, or done if completed after the skip
 * (decision 5 of docs/jobo-skip-occurrence.md). Moves stay excluded.
 */
export function skipTotals(template, from, to) {
  const done = new Set(template?.completedDates || []);
  let count = 0, completed = 0, minutes = 0, completedMinutes = 0;
  for (const date of skippedDates(template, from, to)) {
    const duration = Number(template.exceptions[date].skip.plan?.duration) || 0;
    count += 1;
    minutes += duration;
    if (done.has(date)) { completed += 1; completedMinutes += duration; }
  }
  return { count, completed, minutes, completedMinutes };
}
