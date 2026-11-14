// The order of a project's unscheduled tasks, as a field on each task.
//
// Until 2026-09-08 that order was nothing more than the tasks' positions in
// the inbox array. It travelled on the file tier (a reorder timestamp picks
// whose array wins) but the DB tier syncs one row per task and carries no
// array order, so on GLANCEvault the order never left the device that set
// it; and every Obsidian cycle rebuilds the inbox array (app tasks, then
// vault tasks in scan order, then the rest), so a reorder lasted until the
// next cycle. A field on the task rides the row on both tiers, resolves by
// the task's own last-writer-wins, is compared by the stamp pass like any
// other edit, and is carried across a re-parse like any other app field.
//
// Ruling (2026-09-08): the order is the app's. The project note keeps its
// own line order and neither reads nor writes this field (buildout spec
// 2.5 records the deferred design for making the note follow it).

import { resolveRetirement } from './retiredTaskIds.js';

export const PROJECT_ORDER_STEP = 10;

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

/**
 * The open tasks of a project's inbox the user can drag, in the order shown.
 * Manual: all of them. By deadline: the undated ones, since a date decides
 * where a dated task sits.
 */
export function draggableProjectTasks(projectInbox, taskSort) {
  const open = sortByProjectOrder((projectInbox || []).filter((t) => t && !t.completed));
  return taskSort === TASK_SORT_DEADLINE ? open.filter((t) => !hasDeadline(t)) : open;
}

/**
 * The applyProjectReorder ids for a drag among the draggable tasks, from one
 * index of draggableProjectTasks to another. Under the deadline order the
 * dated tasks keep the manual places they hold and the dragged group is
 * rewritten around them, so the manual order stays whole underneath. Null
 * when either index is not a draggable task.
 */
export function dragReorderIds(projectInbox, taskSort, fromIdx, toIdx) {
  const dragged = draggableProjectTasks(projectInbox, taskSort).map((t) => t.id);
  if (dragged[fromIdx] === undefined || dragged[toIdx] === undefined) return null;
  const [moved] = dragged.splice(fromIdx, 1);
  dragged.splice(toIdx, 0, moved);
  const inGroup = new Set(dragged.map(String));
  let next = 0;
  const open = sortByProjectOrder((projectInbox || []).filter((t) => t && !t.completed))
    .map((t) => (inGroup.has(String(t.id)) ? dragged[next++] : t.id));
  return projectReorderIds(open, projectInbox);
}

/**
 * Apply a reorder of one project's tasks to the inbox array. `orderedIds` is
 * the project's WHOLE inbox group in its new order: the open tasks as dragged,
 * then the completed ones (projectReorderIds builds it). Each gets a
 * renumbered projectOrder (0, 10, 20, ...); the array positions move too, so
 * the file tier and the general inbox see the same order they always did.
 *
 * Every member is stamped, not only the ones whose number changed. The order
 * rides each task's own lastModified, and sync keeps the newer copy of each
 * task: stamping only the changed rows let two reorders made on two devices
 * mix, task by task, into duplicate numbers whose tie falls back to an array
 * order that differs per device, so the list reshuffled between syncs. With
 * the whole group stamped, the newest reorder wins as a whole. Completed tasks
 * are numbered too, after the open ones, so un-completing one cannot collide
 * with the number another task has since taken. A drop that changes nothing
 * returns the input untouched (no stamp, no push).
 */
export function applyProjectReorder(unscheduledTasks, orderedIds, now = new Date().toISOString()) {
  const ids = (orderedIds || []).map(String);
  const orderOf = new Map(ids.map((id, i) => [id, i * PROJECT_ORDER_STEP]));
  const byId = new Map((unscheduledTasks || []).map((t) => [String(t.id), t]));
  const unchanged = [...orderOf].every(([id, order]) => !byId.has(id) || byId.get(id).projectOrder === order);
  if (unchanged) return unscheduledTasks || [];
  const restamped = (t) => {
    const order = orderOf.get(String(t.id));
    if (order === undefined) return t;
    return { ...t, projectOrder: order, lastModified: now };
  };
  // Array positions: the moved group occupies the slots its members held,
  // in the new order; everything else stays where it was.
  const slots = [];
  (unscheduledTasks || []).forEach((t, i) => { if (orderOf.has(String(t.id))) slots.push(i); });
  const out = (unscheduledTasks || []).map(restamped);
  const members = ids.filter((id) => byId.has(id)).map((id) => restamped(byId.get(id)));
  slots.forEach((slot, k) => { if (k < members.length) out[slot] = members[k]; });
  return out;
}

/**
 * The ids applyProjectReorder takes for one project: the open inbox tasks in
 * their new order, then the completed ones in their current order.
 */
export function projectReorderIds(openIdsInNewOrder, projectInbox) {
  const done = sortByProjectOrder((projectInbox || []).filter((t) => t && t.completed)).map((t) => t.id);
  return [...(openIdsInNewOrder || []), ...done];
}

/**
 * The projectOrder that puts a new task at the top of a project's inbox: one
 * step above the lowest number it holds. Tasks with no number already sort
 * after every numbered one, so any number tops a list that has none. Only
 * the new task is written, so adding never restamps the rest of the group.
 */
export function topProjectOrder(projectInbox) {
  const orders = (projectInbox || []).filter(hasOrder).map((t) => t.projectOrder);
  return orders.length ? Math.min(...orders) - PROJECT_ORDER_STEP : 0;
}

/**
 * The applyProjectReorder ids that move one open task to the bottom of its
 * project's open tasks, the rest keeping their order. Null when the task is
 * not an open task of this inbox (completed, scheduled or gone since).
 *
 * `retired` is the retired-id record (utils/retiredTaskIds.js). A task added
 * to an Obsidian-linked project changes id once the writeback stamps its line
 * (the random id retires onto the block-derived one), usually within seconds
 * of the add, so the id the caller held is resolved through the record first.
 */
export function sendToBottomIds(projectInbox, id, retired = null) {
  const target = String(resolveRetirement(retired, id) ?? id);
  const open = sortByProjectOrder((projectInbox || []).filter((t) => t && !t.completed)).map((t) => t.id);
  const current = open.find((x) => String(x) === target);
  if (current === undefined) return null;
  const rest = open.filter((x) => String(x) !== target);
  return projectReorderIds([...rest, current], projectInbox);
}

/**
 * A project's tasks in the order the project card lists them: open scheduled
 * (by date), open unscheduled (sortProjectInbox, under the project's
 * taskSort), then the completed ones in the same two groups. The card and the
 * Project widget's payload both use this, so the widget lists the tasks
 * exactly as the app does.
 *
 * @param {object[]} scheduled    The project's scheduled tasks (already filtered).
 * @param {object[]} unscheduled  The project's unscheduled tasks (already filtered).
 * @param {string}  [taskSort]    The project's taskSort; absent for the manual order.
 */
export function orderProjectTasks(scheduled, unscheduled, taskSort) {
  const sched = [...(Array.isArray(scheduled) ? scheduled : [])]
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const inbox = sortProjectInbox(unscheduled, taskSort);
  return [
    ...sched.filter((t) => !t.completed),
    ...inbox.filter((t) => !t.completed),
    ...sched.filter((t) => t.completed),
    ...inbox.filter((t) => t.completed),
  ];
}

/**
 * Projects within a group (a goal's children, the standalone list) in the
 * order the Goals & Projects space draws them: by `sortOrder`, projects
 * without one after, in array order.
 */
export function sortProjectsByOrder(projects) {
  return [...(Array.isArray(projects) ? projects : [])].sort((a, b) => {
    if (a.sortOrder !== undefined && b.sortOrder !== undefined) return a.sortOrder - b.sortOrder;
    if (a.sortOrder !== undefined) return -1;
    if (b.sortOrder !== undefined) return 1;
    return 0;
  });
}
