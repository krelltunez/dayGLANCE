// Assemble the overdue list without reading the clock, storage or React state.
// App.jsx supplies both clocks: todayStr comes from the wall clock, while now
// is currentTime (or its wall-clock fallback). Keep them separate at rollover.
import { dateToString } from './taskUtils.js';
import { getOccurrencesInRange } from './recurrenceEngine.js';
import { notBucketed } from './bucketList.js';

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

  const isOverdueToday = (t) => {
    if (t.date !== todayStr || t.isAllDay) return false;
    const [h, m] = (t.startTime || '00:00').split(':').map(Number);
    const endMinutes = h * 60 + m + (t.duration || 30);
    return endMinutes <= nowMinutes;
  };

  // Incomplete scheduled tasks from past dates (not imported events)
  // + today's tasks whose end time has passed
  const overdueScheduled = tasks.filter(t => {
    if (t.completed || t.imported || t.isExample || !isVisibleForUser(t)) return false;
    if (t.date < todayStr) return true;
    return isOverdueToday(t);
  }).map(t => ({ ...t, _overdueType: 'scheduled' }));

  // Today's recurring instances past their end time
  const todayRecurring = expandedRecurringTasks.filter(t =>
    t.date === todayStr && !t.completed && !t.isExample && isVisibleForUser(t) && isOverdueToday(t)
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
        subtasks: template.subtasks || [],
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
