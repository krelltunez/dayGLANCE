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

/**
 * Apply a reorder of one project's tasks to the inbox array. `orderedIds` is
 * the project's reorderable tasks in their new order. Each gets a renumbered
 * projectOrder (0, 10, 20, ...) and a fresh stamp so the change syncs and
 * wins the merge; the array positions move too, so the file tier and the
 * general inbox see the same order they always did.
 */
export function applyProjectReorder(unscheduledTasks, orderedIds, now = new Date().toISOString()) {
  const ids = (orderedIds || []).map(String);
  const orderOf = new Map(ids.map((id, i) => [id, i * PROJECT_ORDER_STEP]));
  const byId = new Map((unscheduledTasks || []).map((t) => [String(t.id), t]));
  const restamped = (t) => {
    const order = orderOf.get(String(t.id));
    if (order === undefined) return t;
    if (t.projectOrder === order) return t;                 // already there: no stamp, no push
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
