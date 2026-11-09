// Assemble the overdue list without reading the clock, storage or React state.
// App.jsx supplies both clocks: todayStr comes from the wall clock, while now
// is currentTime (or its wall-clock fallback). Keep them separate at rollover.
import { hasTaskEnded, taskEnd } from '@glance-apps/agenda-core';
import { dateToString } from './taskUtils.js';
import { getOccurrencesInRange } from './recurrenceEngine.js';
import { notBucketed } from './bucketList.js';
import { occurrenceSubtasks } from './recurringSubtasks.js';

/**
 * @param {object} input
 * @param {string} input.todayStr Today's local YYYY-MM-DD from the wall clock.
 * @param {Date} input.now Clock used for end times and the recurring lookback.
 * @param {Array} input.tasks
 * @param {Array} input.expandedRecurringTasks
 * @param {Array} input.recurringTasks
 * @param {Array} input.unscheduledTasks
 * @param {Function} input.isVisibleForUser
 */
export function getOverdueTasks({
  todayStr, now, tasks, expandedRecurringTasks, recurringTasks, unscheduledTasks,
  isVisibleForUser,
}) {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  // Judged by the REAL end, date + start + duration (#2278): a 23:00-01:00
  // task is not overdue at 00:30 the next day, and is from 01:00. A missing
  // duration counts 30 minutes, as it always has here.
  const clock = { todayStr, nowMinutes };
  const hasEnded = (t) => !!t.date && t.date <= todayStr && hasTaskEnded(t, clock);

  // Incomplete scheduled tasks whose end has passed: every timed task of an
  // earlier date that has ended (all of them but one still running past
  // midnight), every all-day task of an earlier date, and today's timed tasks
  // whose end time has passed.
  const overdueScheduled = tasks.filter(t => {
    if (t.completed || t.imported || t.isExample || !isVisibleForUser(t)) return false;
    return hasEnded(t);
  }).map(t => ({ ...t, _overdueType: 'scheduled' }));

  // Recurring instances whose end fell today and has passed: today's, and
  // yesterday's that ran past midnight (an occurrence's own date + start +
  // duration). Timed occurrences of earlier dates leave the expansion instead.
  const todayRecurring = expandedRecurringTasks.filter(t =>
    !t.completed && !t.isExample && !t.isAllDay && isVisibleForUser(t)
    && hasEnded(t) && taskEnd(t)?.date === todayStr
  ).map(t => ({ ...t, _overdueType: 'scheduled' }));

  // Past uncompleted recurring all-day instances (look back up to 7 days)
  const overdueRecurringAllDay = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = dateToString(d);
    for (const template of recurringTasks) {
      if (template.isExample) continue;
      if (!isVisibleForUser(template)) continue;
      const isTemplateAllDay = template.isAllDay ?? false;
      if (!isTemplateAllDay) continue;
      const occs = getOccurrencesInRange(template, dateStr, dateStr);
      if (occs.length === 0) continue;
      if ((template.completedDates || []).includes(dateStr)) continue;
      const exception = template.exceptions?.[dateStr];
      if (exception?.completed) continue;
      const instanceId = `recurring-${template.id}-${dateStr}`;
      // Skip if already covered by overdueScheduled (shouldn't happen for recurring, but be safe)
      if (overdueScheduled.some(t => t.id === instanceId)) continue;
      overdueRecurringAllDay.push({
        id: instanceId,
        title: exception?.title ?? template.title,
        startTime: null,
        duration: exception?.duration ?? template.duration,
        color: exception?.color ?? template.color,
        completed: false,
        isAllDay: true,
        notes: template.notes || '',
        subtasks: occurrenceSubtasks(template, dateStr),
        // Energy-axis override is series-level (see setTaskEnergy); the
        // expansion is an explicit field list, so it must be carried here or
        // instances silently fall back to auto-derivation.
        energy: template.energy,
        date: dateStr,
        isRecurring: true,
        recurringTemplateId: template.id,
        recurrenceType: template.recurrence?.type,
        // Project membership is series-level (stored on the template);
        // instances inherit it so project-filtered views keep occurrences.
        projectId: template.projectId,
        _overdueType: 'scheduled',
      });
    }
  }

  // Inbox tasks with past deadlines (bucket items never nag)
  const overdueDeadlines = unscheduledTasks.filter(t =>
    notBucketed(t) && t.deadline && t.deadline < todayStr && !t.completed && !t.isExample && isVisibleForUser(t)
  ).map(t => ({ ...t, _overdueType: 'deadline' }));

  return [...overdueScheduled, ...todayRecurring, ...overdueRecurringAllDay, ...overdueDeadlines];
}
