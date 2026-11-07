import { hasTaskEnded } from '@glance-apps/agenda-core';
import { dateToString, extractTags } from './taskUtils.js';

/**
 * SCHED view filtering.
 *
 * Filters shape: { colors: string[], tags: string[], projectIds: string[] }.
 * An empty array means "no filter" for that dimension; a task must match
 * every non-empty dimension (AND across dimensions, OR within one).
 * The 'none' sentinel in projectIds matches tasks without a project.
 */
export const EMPTY_SCHED_FILTERS = Object.freeze({ colors: [], tags: [], projectIds: [] });

/**
 * The rolling agenda window: the selected day and the `daysShown - 1` days
 * after it, inclusive.
 *
 * One home for the rule because three things have to agree on it or the
 * agenda renders days nothing has prepared: the window useSchedAgendaState
 * walks, the range recurring templates are expanded over, and the span the
 * device-calendar fetch covers. The last one disagreed — the fetch reached
 * two days either side of the selection and no further — and device events
 * simply never arrived for the rest of the fortnight on screen.
 *
 * @param {Date} selectedDate
 * @param {number} daysShown  window length; anything under 1 is treated as 1.
 * @returns {{ from: string, to: string }}  YYYY-MM-DD, inclusive.
 */
export const schedRollingWindow = (selectedDate, daysShown) => {
  // Noon, not midnight, before the day arithmetic — the same convention
  // windowDates uses. A zone whose DST transition skips 00:00 has no midnight
  // to normalise to that day, and adding days from an hour near a transition
  // can land on the wrong one. Noon is an hour every local day has.
  const from = new Date(selectedDate);
  from.setHours(12, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + Math.max(1, Math.floor(daysShown || 1)) - 1);
  return { from: dateToString(from), to: dateToString(to) };
};

export const hasActiveSchedFilters = (filters) =>
  !!(filters && (filters.colors.length || filters.tags.length || filters.projectIds.length));

export const taskMatchesSchedFilters = (task, filters) => {
  if (!hasActiveSchedFilters(filters)) return true;
  if (filters.colors.length && !filters.colors.includes(task.color)) return false;
  if (filters.tags.length) {
    const taskTags = extractTags(task.title || '');
    if (!filters.tags.some(tag => taskTags.includes(tag))) return false;
  }
  if (filters.projectIds.length) {
    const pid = task.projectId || 'none';
    if (!filters.projectIds.includes(pid)) return false;
  }
  return true;
};

/**
 * Order-insensitive equality of two filter combos — used to detect which saved
 * preset (if any) matches the live filters, and to toggle it off on re-tap.
 */
export const schedFiltersEqual = (a, b) => {
  if (!a || !b) return false;
  return ['colors', 'tags', 'projectIds'].every(key => {
    const av = [...(a[key] || [])].sort();
    const bv = [...(b[key] || [])].sort();
    return av.length === bv.length && av.every((v, i) => v === bv[i]);
  });
};

/** Toggles a value in one filter dimension, returning a new filters object. */
export const toggleSchedFilter = (filters, dimension, value) => {
  const list = filters[dimension];
  return {
    ...filters,
    [dimension]: list.includes(value) ? list.filter(v => v !== value) : [...list, value],
  };
};

/**
 * Groups active projects for the SCHED filter UIs: one group per goal (in
 * goals-array order, only goals that have active projects), then a
 * 'Standalone' group for goal-less projects. Archived/completed projects and
 * goals contribute nothing.
 */
export const groupProjectsForFilter = (projects, goals) => {
  const active = projects.filter(p => p.status !== 'archived' && p.status !== 'completed');
  const visibleGoals = goals.filter(g => g.status !== 'archived');
  const groups = visibleGoals
    .map(g => ({ label: g.title, projects: active.filter(p => p.goalId === g.id) }))
    .filter(g => g.projects.length > 0);
  // Projects without a goal — or whose goal is archived — group under Standalone
  // so they stay filterable.
  const goalIds = new Set(visibleGoals.map(g => g.id));
  const standalone = active.filter(p => !p.goalId || !goalIds.has(p.goalId));
  // isStandalone lets the UI swap the label for its translation.
  if (standalone.length) groups.push({ label: 'Standalone', isStandalone: true, projects: standalone });
  return groups;
};

/**
 * True for imported calendar events that have already ENDED relative to `now`
 * (the "hide past events" view preference). Tasks — even past-due ones — are
 * never "past" here: they stay actionable until completed, and completed
 * tasks have their own toggle. All-day events last until their day ends.
 */
export const isPastEvent = (task, now) => {
  if (!task.imported || task.isTaskCalendar || !task.date) return false;
  const todayStr = dateToString(now);
  if (task.isAllDay || !task.startTime) return task.date < todayStr;
  // Judged by its REAL end (#2278): an event from 23:00 to 01:00 has not
  // ended at 00:30 the next day. No duration: over at its start.
  return hasTaskEnded(task, { todayStr, nowMinutes: now.getHours() * 60 + now.getMinutes(), defaultDuration: 0 });
};

/** Matches expanded recurring-occurrence ids: recurring-<templateId>-YYYY-MM-DD */
const RECURRING_OCCURRENCE_RE = /^recurring-(.+)-\d{4}-\d{2}-\d{2}$/;

/**
 * "Next instance only" mode for the SCHED agenda: collapses each recurring
 * series to its first incomplete occurrence in the window, dropping all other
 * occurrences (including already-completed ones) so daily/weekly tasks don't
 * flood the list. Non-recurring tasks pass through untouched.
 */
export const limitRecurringToNextInstance = (days) => {
  const seen = new Set();
  return days.map(day => ({
    ...day,
    tasks: day.tasks.filter(task => {
      const m = typeof task.id === 'string' && task.id.match(RECURRING_OCCURRENCE_RE);
      if (!m) return true;
      if (seen.has(m[1])) return false;
      if (task.completed) return false; // done — the next incomplete one represents the series
      seen.add(m[1]);
      return true;
    }),
  }));
};
