// The order a project lists its unscheduled tasks in, shared by the app's
// project card, Planner and widget (src/utils/projectOrder.js, which holds
// the writes: reorders, new-task placement) and by the MCP read surface
// (@glance-apps/dayglance-mcp), so an agent is shown a project's tasks in the
// order the user sees them.

const hasOrder = (t) => typeof t?.projectOrder === 'number' && Number.isFinite(t.projectOrder);

/**
 * Stable sort: tasks carrying projectOrder first, ascending; tasks without
 * one after, in their given order (a task newly added to the project lands
 * at the end, as before).
 */
export function sortByProjectOrder(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const ordered = list.filter(hasOrder).map((t, i) => ({ t, i }))
    .sort((a, b) => (a.t.projectOrder - b.t.projectOrder) || (a.i - b.i))
    .map(({ t }) => t);
  return [...ordered, ...list.filter((t) => !hasOrder(t))];
}

// A project can order its unscheduled tasks by deadline instead (#2394):
// `taskSort: 'deadline'` on the project, absent for the manual order. It is a
// view over projectOrder, never a rewrite of it: the tasks with a deadline
// lead, soonest first, and the rest follow in the manual order, which the
// user still arranges by dragging. Turning it off shows the manual order
// exactly as it was left.
export const TASK_SORT_DEADLINE = 'deadline';

const hasDeadline = (t) => typeof t?.deadline === 'string' && t.deadline !== '';

/**
 * One project's unscheduled tasks in the order its lists show them. Manual:
 * sortByProjectOrder. By deadline: the dated tasks first, by deadline (a
 * YYYY-MM-DD string, so it compares as text), two on one date keeping their
 * manual order; then the undated ones in manual order.
 */
export function sortProjectInbox(tasks, taskSort) {
  const manual = sortByProjectOrder(tasks);
  if (taskSort !== TASK_SORT_DEADLINE) return manual;
  const dated = manual.filter(hasDeadline).map((t, i) => ({ t, i }))
    .sort((a, b) => a.t.deadline.localeCompare(b.t.deadline) || (a.i - b.i))
    .map(({ t }) => t);
  return [...dated, ...manual.filter((t) => !hasDeadline(t))];
}
