// The Inbox filter's projects, grouped the way the Goals & Projects space
// draws them (#2232): areas, their goals, each goal's projects, and the
// standalone projects last. With many projects in one flat row the filter was
// unreadable; a goal or an area also selects all of its projects at once.
//
// The saved filter stays a list of project ids (utils/inboxFilter.js), so the
// Inbox, its counts, the launcher snapshot and the headless refresh read it
// unchanged. Selecting a goal or an area selects the projects it holds now.
// Pure, so the grouping and the toggles are tested without the popover.
//
// The Day Dial's complication picker lists projects the same way (#2250),
// through projectOptionGroups below: a native <select> cannot nest or fold,
// so the tree is flattened into one labelled group per goal.

const activeProject = (p) => p && p.status !== 'archived' && p.status !== 'completed';

/**
 * @param {{ projects?: object[], goals?: object[], areas?: object[] }} lists
 * @param {{ isListed?: (project: object) => boolean }} [options]  which projects
 *   appear; by default every one not completed or archived
 * @returns {{ areas: Array<{ id: string|null, title: string|null, goals: Array<{ id, title, color, projects: object[] }> }>,
 *   standalone: object[], hasAreas: boolean }}
 *   `areas` in the areas' own order, then goals with no (or a missing) area
 *   under `id: null`; empty goals and empty areas are left out. `hasAreas` is
 *   false when no goal is in a real area: the popover then skips the area
 *   level and lists the goals directly.
 */
export function groupInboxProjects({ projects = [], goals = [], areas = [] } = {}, { isListed = activeProject } = {}) {
  const active = projects.filter((p) => p && isListed(p));
  const drawnGoals = goals.filter((g) => g && g.status !== 'archived');
  const goalIds = new Set(drawnGoals.map((g) => g.id));
  const goalGroups = drawnGoals
    .map((g) => ({ id: g.id, title: g.title, color: g.color, areaId: g.areaId, projects: active.filter((p) => p.goalId === g.id) }))
    .filter((g) => g.projects.length > 0);

  const areaIds = new Set(areas.map((a) => a.id));
  const inArea = (g) => g.areaId && areaIds.has(g.areaId);
  const strip = ({ areaId: _areaId, ...goal }) => goal;
  const grouped = areas
    // An area is named by `name` (useGoalsProjects addArea), a goal by `title`.
    .map((a) => ({ id: a.id, title: a.name, goals: goalGroups.filter((g) => g.areaId === a.id).map(strip) }))
    .filter((a) => a.goals.length > 0);
  const loose = goalGroups.filter((g) => !inArea(g)).map(strip);
  if (loose.length) grouped.push({ id: null, title: null, goals: loose });

  return {
    areas: grouped,
    // A project with no goal, or one whose goal is not drawn, stays filterable here.
    standalone: active.filter((p) => !p.goalId || !goalIds.has(p.goalId)),
    hasAreas: grouped.some((a) => a.id !== null),
  };
}

/** The project ids a group holds: a goal's, or every goal's in an area. */
export const projectIdsOf = (group) =>
  (group.goals ? group.goals.flatMap((g) => g.projects) : group.projects || []).map((p) => p.id);

/** 'all' | 'some' | 'none' of `ids` in the selection. */
export function selectionState(selected = [], ids = []) {
  if (!ids.length) return 'none';
  const chosen = ids.filter((id) => selected.includes(id)).length;
  return chosen === 0 ? 'none' : chosen === ids.length ? 'all' : 'some';
}

/**
 * Tapping a goal or an area: all of its projects selected becomes none of
 * them; anything less becomes all of them. Other selections are kept.
 */
export function toggleProjectGroup(selected = [], ids = []) {
  if (selectionState(selected, ids) === 'all') return selected.filter((id) => !ids.includes(id));
  return [...selected, ...ids.filter((id) => !selected.includes(id))];
}

/**
 * The projects as a native <select>'s groups (#2250): one per goal, labelled
 * by its area and itself, in the order groupInboxProjects gives, then the
 * standalone projects. `area` is null for a goal in no area; `standalone`
 * marks the last group, whose label the caller translates.
 *
 * @returns {Array<{ key: string, area: string|null, goal: string|null, standalone: boolean, projects: object[] }>}
 */
export function projectOptionGroups(lists, options) {
  const { areas, standalone } = groupInboxProjects(lists, options);
  const groups = areas.flatMap((area) => area.goals.map((goal) => ({
    key: `goal-${goal.id}`, area: area.title, goal: goal.title, standalone: false, projects: goal.projects,
  })));
  if (standalone.length) groups.push({ key: 'standalone', area: null, goal: null, standalone: true, projects: standalone });
  return groups;
}
