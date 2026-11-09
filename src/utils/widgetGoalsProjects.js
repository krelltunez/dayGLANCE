// The Goal and Project widgets' part of the widget snapshot (App.jsx pushes
// it with the rest through DayGlanceNative.updateWidgetSnapshot). Pure, so the
// order the widgets list things in is testable where they read it: both the
// Android and the iOS widgets draw these lists in the order given, so the
// order here is the order on the Home Screen.
//
// Order, matching the app:
//   - a goal's projects as the Goals & Projects space draws them: by
//     sortOrder (sortProjectsByOrder), active, then on hold, then completed;
//   - the project list the pickers offer: on-hold projects after the others
//     (pausedLast), as the app's own pickers list them;
//   - a project's tasks as its card lists them (orderProjectTasks): open
//     scheduled by date, open inbox by the drag order, then the completed.

import { TAILWIND_TO_HEX, getProjectColor } from './colorUtils.js';
import { calculateGoalProgress } from './goalProgress.js';
import { calculateProjectProgress } from './projectProgress.js';
import { stripWikilinksAndTags } from './taskUtils.js';
import { orderProjectTasks, sortProjectsByOrder } from './projectOrder.js';
import { pausedLast } from './projectStatus.js';

/** Tasks the Project widget payload carries per project: the iOS large
 *  widget's eight rows (Android shows six). The count line and "+N more" use
 *  the project's totals, not this list. */
export const WIDGET_PROJECT_TASK_LIMIT = 8;

const DEFAULT_HEX = '#3b82f6';
const daysUntil = (targetDate, todayStr) => (targetDate
  ? Math.round((new Date(targetDate) - new Date(todayStr)) / 86400000)
  : null);
const pct = (done, total) => (total > 0 ? Math.round((done / total) * 100) : 0);
const openFirst = (list) => [
  ...pausedLast(list.filter((p) => p.status !== 'completed')),
  ...list.filter((p) => p.status === 'completed'),
];

/**
 * @param {object} input
 * @param {object[]} input.goals        The user's visible goals.
 * @param {object[]} input.allGoals     Every goal (a project's parent lookup).
 * @param {object[]} input.projects     The user's visible projects.
 * @param {object[]} input.scheduled    Visible scheduled tasks.
 * @param {object[]} input.unscheduled  Visible unscheduled (inbox) tasks.
 * @param {string}   input.todayStr     Local today, 'YYYY-MM-DD'.
 * @returns {{ allGoals: object[], allProjects: object[] }}
 */
export function buildWidgetGoalsProjects({ goals = [], allGoals = goals, projects = [], scheduled = [], unscheduled = [], todayStr }) {
  const allTasks = [...scheduled, ...unscheduled];
  const live = (t) => !t.archived;
  const tasksOf = (projectId) => allTasks.filter((t) => t.projectId === projectId && live(t));

  const goalData = goals
    .filter((g) => g.status === 'active')
    .map((g) => {
      const childProjects = openFirst(sortProjectsByOrder(projects.filter((p) => p.goalId === g.id && p.status !== 'archived')));
      const childIds = new Set(childProjects.map((p) => p.id));
      const goalTasks = allTasks.filter((t) => childIds.has(t.projectId) && live(t));
      const daysUntilDue = daysUntil(g.targetDate, todayStr);
      return {
        id: g.id,
        title: g.title,
        colorHex: TAILWIND_TO_HEX[g.color] || DEFAULT_HEX,
        targetDate: g.targetDate || '',
        daysUntilDue,
        progressPct: Math.round(calculateGoalProgress(g.id, projects, allTasks) * 100),
        totalTasks: goalTasks.length,
        completedTasks: goalTasks.filter((t) => t.completed).length,
        projects: childProjects.map((p) => {
          const ptasks = tasksOf(p.id);
          const done = ptasks.filter((t) => t.completed).length;
          return {
            id: p.id,
            title: p.title,
            status: p.status,
            progressPct: pct(done, ptasks.length),
            totalTasks: ptasks.length,
            completedTasks: done,
          };
        }),
      };
    });

  // Only the projects the app shows (the Goals & Projects space draws a
  // project under its goal, or in the standalone list): not archived, and
  // either standalone or under a goal that exists, is visible and is not
  // archived. A project whose goal was archived or deleted has no card in the
  // app, and was still offered in the widget pickers.
  const shownGoalIds = new Set(goals.filter((g) => g.status !== 'archived').map((g) => g.id));
  // An on-hold project is still listed (the widget can show it, and the
  // pickers still offer it), after the others; its `status` tells the widget
  // to draw it paused and without a due badge.
  const projectData = pausedLast(projects
    .filter((p) => p.status !== 'archived' && (!p.goalId || shownGoalIds.has(p.goalId))))
    .map((p) => {
      const isMine = (t) => t.projectId === p.id && live(t);
      const ordered = orderProjectTasks(scheduled.filter(isMine), unscheduled.filter(isMine));
      const done = ordered.filter((t) => t.completed).length;
      const parentGoal = allGoals.find((g) => g.id === p.goalId);
      return {
        id: p.id,
        title: p.title,
        status: p.status,
        goalId: p.goalId || '',
        goalTitle: parentGoal?.title || '',
        goalColorHex: parentGoal ? (TAILWIND_TO_HEX[parentGoal.color] || DEFAULT_HEX) : '',
        // The project's own colour as the app draws it (its colour, else its
        // goal's, else the fallback): a standalone project has no goal colour.
        colorHex: TAILWIND_TO_HEX[getProjectColor(p, parentGoal)] || DEFAULT_HEX,
        // The project's own target date (#2160), in the goal's shape: the
        // widget computes its badge from targetDate at render time, and
        // daysUntilDue is the fallback for one that does not parse.
        targetDate: p.targetDate || '',
        daysUntilDue: daysUntil(p.targetDate, todayStr),
        progressPct: pct(done, ordered.length),
        totalTasks: ordered.length,
        completedTasks: done,
        tasks: ordered
          .slice(0, WIDGET_PROJECT_TASK_LIMIT)
          .map((t) => ({ id: t.id, title: stripWikilinksAndTags(t.title), completed: !!t.completed })),
      };
    });

  return { allGoals: goalData, allProjects: projectData };
}

/**
 * The day widgets' "due" rows for one date: goals, and projects with their
 * own target date (#2160), that are active and due on `dateStr`. Shared by
 * the pushed day (widgetSnapshot.js) and every projected day (App.jsx), which
 * built the goal rows separately before.
 *
 * Projects ride a separate `projectsDue` list rather than `goals`, so a
 * widget that does not know about them (the iOS widgets, an older Android
 * build) keeps drawing exactly what it did. A project with nothing to
 * measure carries `progressPct: null`, and the widget draws no bar for it.
 *
 * @param {object} input
 * @param {object[]} input.goals     Visible goals.
 * @param {object[]} input.projects  Visible projects.
 * @param {object[]} input.tasks     Visible tasks, scheduled and unscheduled.
 * @param {string}   input.dateStr   'YYYY-MM-DD'.
 * @returns {{ goals: object[], projects: object[] }}
 */
export function buildWidgetDueOn({ goals = [], projects = [], tasks = [], dateStr }) {
  const dueGoals = goals
    .filter(g => g.status === 'active' && g.targetDate === dateStr)
    .map(g => {
      const progressPct = Math.round(calculateGoalProgress(g.id, projects, tasks) * 100);
      const childProjects = projects.filter(p => p.goalId === g.id && p.status !== 'archived');
      const totalTasks = tasks.filter(task => childProjects.some(p => p.id === task.projectId) && !task.archived).length;
      const completedTasks = tasks.filter(task => childProjects.some(p => p.id === task.projectId) && !task.archived && task.completed).length;
      return { id: g.id, title: g.title, progressPct, totalTasks, completedTasks };
    });
  const dueProjects = projects
    .filter(p => p.status === 'active' && p.targetDate === dateStr)
    .map(p => {
      const progress = calculateProjectProgress(p.id, tasks);
      const own = tasks.filter(task => task.projectId === p.id && !task.archived);
      return {
        id: p.id,
        title: p.title,
        progressPct: progress === null ? null : Math.round(progress * 100),
        totalTasks: own.length,
        completedTasks: own.filter(task => task.completed).length,
      };
    });
  return { goals: dueGoals, projects: dueProjects };
}
