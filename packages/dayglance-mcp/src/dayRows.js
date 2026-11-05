// The rows the read model reads for one date (#2278, phase 1 gaps): the day's
// blocks (readModel.js buildDayBlocks) and its frames' free time (frames.js
// buildFrames) both build from these, so free time and the blocks a caller
// can see never tell different stories: the same visibility, the same
// consent tier, the same recurring occurrences with each date's exception.

import { getOccurrencesInRange } from '@glance-apps/agenda-core';

/**
 * Expand recurring templates into instances for ONE date. Mirrors the
 * App.jsx expansion (exception overrides per field) with one deliberate
 * difference: no "hide past uncompleted" rule — that is a UI display choice,
 * and an MCP read of a past day should report what was scheduled.
 */
export function expandRecurringForDate(recurringTasks, date) {
  const instances = [];
  for (const template of recurringTasks ?? []) {
    const occurrences = getOccurrencesInRange(template, date, date);
    for (const dateStr of occurrences) {
      if (dateStr !== date) continue;
      const exception = template.exceptions?.[dateStr];
      instances.push({
        id: `recurring-${template.id}-${dateStr}`,
        title: exception?.title ?? template.title,
        startTime: exception?.startTime ?? template.startTime,
        duration: exception?.duration ?? template.duration,
        completed: (template.completedDates || []).includes(dateStr),
        // The series' creation, and this date's completion, which the
        // template keeps per date (#2135).
        createdAt: template.createdAt,
        completedAt: template.completedDatesTimestamps?.[dateStr],
        isAllDay: exception?.isAllDay ?? template.isAllDay ?? false,
        assignedUserSyncIds: exception?.assignedUserSyncIds ?? template.assignedUserSyncIds,
        // Series-level, like assignment: the template owns it and every
        // instance inherits it, so toBlock can emit project_id for a
        // recurring block the same as for a concrete task.
        projectId: template.projectId,
        // Series-level as well: one set of notes for every occurrence.
        notes: template.notes,
        date: dateStr,
        isRecurring: true,
        recurringTemplateId: template.id,
        recurrence: template.recurrence,
      });
    }
  }
  return instances;
}

/**
 * The rows the day model reads for one date, under the same visibility and
 * consent rules: concrete tasks on it (device events only when includeNative)
 * and its recurring occurrences.
 */
export function rowsForDate(state, date, includeNative) {
  const { tasks = [], recurringTasks = [], isVisibleForUser = () => true } = state;
  const onDate = tasks.filter((t) => t.date === date && isVisibleForUser(t));
  const concrete = includeNative ? onDate : onDate.filter((t) => !t._native);
  const recurring = expandRecurringForDate(recurringTasks, date).filter(isVisibleForUser);
  return { concrete, recurring };
}
