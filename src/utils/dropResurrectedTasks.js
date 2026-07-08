// A device must never PUSH a task its own tombstones say is deleted.
//
// THE HAZARD: buildSyncPayload broadcasts whatever is in the in-memory task lists.
// If a stale local copy of a deleted task lingers in state (e.g. a local re-read
// restores it, or a merge race), the device re-uploads it live every cycle — and a
// peer that holds the tombstone dutifully re-deletes it, then this device re-pushes
// it: a delete↔re-add war over a task the user genuinely deleted (observed: 11 tasks
// tombstoned across weeks on one device, resurrected forever by the other).
//
// THE FILTER: drop a task from the outbound payload when it is tombstoned AND the
// tombstone is NEWER than the task's lastModified — i.e. the deletion is the latest
// word. This mirrors the merge's own suppression rule (@glance-apps/sync
// mergeArrayById: `deletedIds[id] > item.lastModified` drops the item), just applied
// at the PUSH side so a device can't resurrect its own deleted task in the first
// place. A legitimately RESTORED task (un-deleted, so its lastModified is newer than
// the tombstone) is kept and syncs normally. An unparseable/absent tombstone keeps
// the task (fail-safe: never drop live data on a bad tombstone).
//
// Applied to the active task lists (tasks, unscheduledTasks) only — never recycleBin
// (binned tasks are intentionally synced) and never tombstone-free tasks.

/**
 * @param {Array<{id:*, lastModified?:string}>} tasks
 * @param {Record<string,string>} [deletedIds]  {id → ISO deletion timestamp}
 * @returns {object[]} tasks minus any whose deletion is newer than the task
 */
export function dropResurrectedTasks(tasks, deletedIds = {}) {
  if (!Array.isArray(tasks)) return [];
  const tomb = deletedIds && typeof deletedIds === 'object' ? deletedIds : {};
  return tasks.filter((t) => {
    if (!t) return false;
    const ts = tomb[String(t.id)];
    if (!ts) return true; // not tombstoned → keep
    const del = new Date(ts).getTime();
    if (Number.isNaN(del)) return true; // unparseable tombstone → keep (fail-safe)
    const mod = new Date(t.lastModified || 0).getTime();
    return del <= mod; // keep only if the task is at least as new as its deletion
  });
}
