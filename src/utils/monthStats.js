// The month view's headline numbers, with the All-Time Summary's
// definitions (hooks/useStats.js) narrowed to one calendar month:
//
//  • scheduled: the user's non-imported tasks dated in the month, recurring
//    occurrences that fall in it, and inbox tasks whose deadline falls in it;
//  • completed: those of them that are done; incomplete: the rest;
//  • percent: completed out of scheduled, null when nothing was scheduled;
//  • plannedMinutes / spentMinutes: the durations of the scheduled items and
//    of the completed ones, so "spent" compares like with like against
//    "planned" (an inbox task done without a deadline has no plan to compare
//    to and counts under inboxDone instead);
//  • inboxDone: plain inbox tasks (no deadline, no project) completed in the
//    span, by their completion stamp, the summary's "Inbox done";
//  • focusMinutes: focus-mode minutes logged on the counted tasks.
//
// Like the summary, only days up to and including today count: a task set
// for next week is not "incomplete" yet. So a past month is fully counted,
// the current month is counted through today, and a future month has
// nothing to report (`counted` is false) and the header shows nothing.

import { getOccurrencesInRange } from './recurrenceEngine.js';
import { notBucketed } from './bucketList.js';
import { daysInMonth } from './monthGrid.js';
import { skipTotals } from '../jobo/skipOccurrence.js';

const pad = (n) => String(n).padStart(2, '0');
const minutes = (t) => Number(t.duration) || 0;
const sum = (list, by) => list.reduce((acc, t) => acc + by(t), 0);
const EMPTY = { scheduled: 0, completed: 0, incomplete: 0, percent: null, plannedMinutes: 0, spentMinutes: 0, inboxDone: 0, focusMinutes: 0 };

/**
 * @param {object} args
 * @param {Array} args.tasks
 * @param {Array} [args.unscheduledTasks]
 * @param {Array} [args.recurringTasks]
 * @param {number} args.year
 * @param {number} args.month            1..12
 * @param {string} args.today            YYYY-MM-DD
 * @param {(task: object) => boolean} [args.isVisibleForUser]
 * @returns {{ counted: boolean, from: string, to: string, scheduled: number, completed: number, incomplete: number,
 *   percent: number|null, plannedMinutes: number, spentMinutes: number, inboxDone: number, focusMinutes: number }}
 */
export function monthStats({ tasks = [], unscheduledTasks = [], recurringTasks = [], year, month, today, isVisibleForUser = () => true }) {
  const from = `${year}-${pad(month)}-01`;
  const monthEnd = `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;
  const to = monthEnd < today ? monthEnd : today;
  if (to < from) return { counted: false, from, to: from, ...EMPTY };

  const inSpan = (d) => typeof d === 'string' && d >= from && d <= to;
  const own = tasks.filter((t) => !t.imported && !t.isExample && inSpan(t.date) && isVisibleForUser(t));
  const deadlines = unscheduledTasks.filter((t) => notBucketed(t) && inSpan(t.deadline) && isVisibleForUser(t));
  let recurringScheduled = 0;
  let recurringCompleted = 0;
  let recurringPlanned = 0;
  let recurringSpent = 0;
  for (const template of recurringTasks.filter(isVisibleForUser)) {
    const start = template.recurrence?.startDate && template.recurrence.startDate > from ? template.recurrence.startDate : from;
    if (start > to) continue;
    const occurrences = getOccurrencesInRange(template, start, to);
    const done = new Set(template.completedDates || []);
    const doneCount = occurrences.filter((d) => done.has(d)).length;
    // Skips from the Check are hidden by the engine but stay planned.
    const skips = skipTotals(template, start, to);
    recurringScheduled += occurrences.length + skips.count;
    recurringCompleted += doneCount + skips.completed;
    recurringPlanned += occurrences.length * minutes(template) + skips.minutes;
    recurringSpent += doneCount * minutes(template) + skips.completedMinutes;
  }

  const dated = [...own, ...deadlines];
  const datedDone = dated.filter((t) => t.completed);
  const scheduled = dated.length + recurringScheduled;
  const completed = datedDone.length + recurringCompleted;
  const inboxDone = unscheduledTasks.filter((t) => notBucketed(t) && t.completed && !t.deadline && !t.projectId
    && inSpan(String(t.completedAt || '').slice(0, 10)) && isVisibleForUser(t)).length;
  return {
    counted: true,
    from,
    to,
    scheduled,
    completed,
    incomplete: scheduled - completed,
    percent: scheduled > 0 ? Math.round((completed / scheduled) * 100) : null,
    plannedMinutes: sum(dated, minutes) + recurringPlanned,
    spentMinutes: sum(datedDone, minutes) + recurringSpent,
    inboxDone,
    focusMinutes: sum(dated, (t) => t.focusMinutes || 0),
  };
}
