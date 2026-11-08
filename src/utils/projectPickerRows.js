// The task editor's project picker (#2279) as the flat list of rows it draws:
// the Inbox filter's grouping (utils/inboxProjectGroups.js, #2232), areas,
// their goals and the goals' projects, then the standalone projects, with
// each group's fold applied. Flat, so the arrow keys walk the rows in the
// order they are drawn and the picker knows which rows are on screen.
//
// A goal opens folded unless it holds the task's project, so a long list
// opens as its goals; an area stays open; the standalone projects open when
// there is no goal to fold under, or when they hold the task's project. Those
// are defaults: the user's own fold, remembered on the device, wins
// (`isOpen`). While a filter is typed every group is open, since a match
// hidden under a fold would read as no match.

/**
 * @param {ReturnType<import('./inboxProjectGroups.js').groupInboxProjects>} groups
 * @param {object} options
 * @param {(key: string, defaultOpen: boolean) => boolean} [options.isOpen]  the fold
 *   in force for a group, given its default
 * @param {boolean} [options.filtering]  a filter is typed: every group open
 * @param {string|null} [options.selectedId]  the task's project
 *
 * A group row carries the ids of every project under it (`ids`, folded or
 * not), so a picker can act on the whole group: the calendar filter hides an
 * area or a goal in one click (#2332).
 * @returns {Array<
 *   { type: 'group', key: string, kind: 'area'|'goal'|'standalone', level: number, title: string|null, color?: string, count: number, ids: Array<string|number>, open: boolean }
 *   | { type: 'project', key: string, level: number, project: object }>}
 */
export function projectPickerRows(groups, { isOpen = (_key, def) => def, filtering = false, selectedId = null } = {}) {
  const rows = [];
  const holds = (projects) => !!selectedId && projects.some((p) => p.id === selectedId);
  const fold = (key, defaultOpen) => (filtering ? true : isOpen(key, defaultOpen));
  const projectRows = (projects, level) => projects.forEach((project) => {
    rows.push({ type: 'project', key: `project-${project.id}`, level, project });
  });
  const goalRows = (goal, level) => {
    const key = `goal-${goal.id}`;
    const open = fold(key, holds(goal.projects));
    rows.push({ type: 'group', key, kind: 'goal', level, title: goal.title, color: goal.color, count: goal.projects.length, ids: goal.projects.map((p) => p.id), open });
    if (open) projectRows(goal.projects, level + 1);
  };

  groups.areas.forEach((area) => {
    if (!groups.hasAreas) { area.goals.forEach((goal) => goalRows(goal, 0)); return; }
    const key = `area-${area.id ?? 'none'}`;
    const open = fold(key, true);
    const ids = area.goals.flatMap((goal) => goal.projects.map((p) => p.id));
    rows.push({ type: 'group', key, kind: 'area', level: 0, title: area.title, count: ids.length, ids, open });
    if (open) area.goals.forEach((goal) => goalRows(goal, 1));
  });

  if (groups.standalone.length) {
    const open = fold('standalone', groups.areas.length === 0 || holds(groups.standalone));
    rows.push({ type: 'group', key: 'standalone', kind: 'standalone', level: 0, title: null, count: groups.standalone.length, ids: groups.standalone.map((p) => p.id), open });
    if (open) projectRows(groups.standalone, 1);
  }
  return rows;
}
