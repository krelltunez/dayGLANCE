// After a sync merge is applied to React state, re-add device-local tasks that
// the merge never governed — native OS tasks, imported calendar items, and
// external-intent tasks — which buildSyncPayload excludes from the payload (or
// which were added locally in the race window between payload-build and apply),
// so the merged result legitimately doesn't contain them and a plain replace
// would drop them.
//
// THE TOMBSTONE GUARD (the fix): a task that IS synced but carries one of those
// flags (e.g. old seed data with `imported: true`) sits in a gap — buildSyncPayload
// pushes it, so a delete on another device propagates here as an absence from the
// merged set, yet the flag-based rescue re-adds it every cycle. buildSyncPayload
// then re-pushes it and the peer re-deletes it: the seed-task resurrection
// ping-pong. The rescue therefore MUST skip any id the merge has tombstoned
// (`deletedIds`, the merged post-pull deletedTaskIds set) — those were deleted
// elsewhere and must stay deleted. An untombstoned flagged task is still a genuine
// race-add and is preserved.
//
// KNOWN BOUNDARY (not a flaw): a tombstone only lives 60 days (the fence/GC window,
// src/sync/tombstoneRetention.js). A device offline longer than 60 days still holds
// the task in `prev`, its tombstone has been GC'd, and the fence-suppressed merged
// set lacks it — so the guard can't fire and the re-add resurrects it. This is the
// same 60-day limit the resurrection fence has, inherent to a finite tombstone
// policy, not specific to this rescue.

// Default: the merge doesn't govern native / imported / intent tasks.
export const isDefaultRescuable = (t) => !!(t && (t._native || t.imported || t._intentKey));

/**
 * @param {object[]} mergedList  the merged/committed list to keep as-is
 * @param {object[]} prevList    the current in-memory list (may hold local-only tasks)
 * @param {Record<string,string>} [deletedIds]  merged deletedTaskIds tombstones {id → ISO}
 * @param {(t:object)=>boolean} [isRescuable]  which prev-only tasks are eligible to rescue
 * @returns {object[]} mergedList followed by the rescued (untombstoned) prev-only tasks
 */
export function rescueUnsyncedTasks(mergedList, prevList, deletedIds = {}, isRescuable = isDefaultRescuable) {
  const merged = Array.isArray(mergedList) ? mergedList : [];
  const mergedIds = new Set(merged.map((t) => String(t.id)));
  const tombstoned = deletedIds || {};
  const rescued = (Array.isArray(prevList) ? prevList : []).filter((t) =>
    t
    && !mergedIds.has(String(t.id))
    && isRescuable(t)
    && !tombstoned[String(t.id)]   // never resurrect a task the merge has tombstoned
  );
  return [...merged, ...rescued];
}
