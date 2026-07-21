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
  if (standalone.length) groups.push({ label: 'Standalone', projects: standalone });
  return groups;
};
