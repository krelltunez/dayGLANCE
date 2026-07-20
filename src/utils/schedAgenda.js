import { extractTags } from './taskUtils.js';

/**
 * SCHED view filtering.
 *
 * Filters shape: { colors: string[], tags: string[], projectIds: string[] }.
 * An empty array means "no filter" for that dimension; a task must match
 * every non-empty dimension (AND across dimensions, OR within one).
 * The 'none' sentinel in projectIds matches tasks without a project.
 */
export const EMPTY_SCHED_FILTERS = Object.freeze({ colors: [], tags: [], projectIds: [] });

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

/** Toggles a value in one filter dimension, returning a new filters object. */
export const toggleSchedFilter = (filters, dimension, value) => {
  const list = filters[dimension];
  return {
    ...filters,
    [dimension]: list.includes(value) ? list.filter(v => v !== value) : [...list, value],
  };
};
