// After a sync merge is applied to React state, re-add device-local tasks that
// the merge never governed — native OS tasks, imported calendar items, external-
// intent tasks, and Obsidian-derived tasks — which buildSyncPayload excludes from
// the payload (or which were added locally in the race window between payload-
// build and apply), so the merged result legitimately doesn't contain them and a
// plain replace would drop them.
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
// OBSIDIAN TASKS (the ala7ur fix): an Obsidian task (`importSource: 'obsidian'`)
// is re-derived from the local vault every scan, so it is device-owned in the same
// sense as a native/imported task — but it is ALSO a synced vault row, so the two
// subsystems race. Symptom: the Obsidian scan adds the task to state, then the very
// next DB-sync apply commits a merged set that (transiently) lacks it and — because
// it was not rescuable — drops it; the next scan re-adds it; repeat. That is the
// observed appear/vanish flicker of a note-backed task (e.g. an inline-dated task
// living in a differently-dated daily note). Making Obsidian tasks rescuable keeps
// a live, note-backed task stable across a merge apply that omits it. A GENUINELY
// vault-deleted task still stays gone: it is tombstoned in `deletedObsidianKeys`
// (the Obsidian deletion map, last-writer-wins via isObsidianTombstoned), so the
// rescue leaves it deleted — no resurrection. Deleting it in the dayGLANCE UI
// (which writes `deletedTaskIds`) is likewise honored by the shared guard below.
//
// KNOWN BOUNDARY (not a flaw): a tombstone only lives 60 days (the fence/GC window,
// src/sync/tombstoneRetention.js). A device offline longer than 60 days still holds
// the task in `prev`, its tombstone has been GC'd, and the fence-suppressed merged
// set lacks it — so the guard can't fire and the re-add resurrects it. This is the
// same 60-day limit the resurrection fence has, inherent to a finite tombstone
// policy, not specific to this rescue.

import { isObsidianTombstoned } from './obsidianDeletions.js';

// Default: the merge doesn't govern native / imported / intent / Obsidian tasks —
// each is re-provided locally (OS bridge, calendar re-import, external intent, or
// vault re-scan), so the merged set legitimately omitting one is not a deletion.
export const isDefaultRescuable = (t) =>
  !!(t && (t._native || t.imported || t._intentKey || t.importSource === 'obsidian'));

/**
 * @param {object[]} mergedList  the merged/committed list to keep as-is
 * @param {object[]} prevList    the current in-memory list (may hold local-only tasks)
 * @param {Record<string,string>} [deletedIds]  merged deletedTaskIds tombstones {id → ISO}
 * @param {(t:object)=>boolean} [isRescuable]  which prev-only tasks are eligible to rescue
 * @param {Record<string,string>} [obsidianTombstones]  merged deletedObsidianKeys {id → ISO};
 *   an Obsidian task tombstoned here (deletion at least as new as the task) is NOT rescued.
 * @returns {object[]} mergedList followed by the rescued (untombstoned) prev-only tasks
 */
export function rescueUnsyncedTasks(
  mergedList,
  prevList,
  deletedIds = {},
  isRescuable = isDefaultRescuable,
  obsidianTombstones = {},
) {
  const merged = Array.isArray(mergedList) ? mergedList : [];
  const mergedIds = new Set(merged.map((t) => String(t.id)));
  const tombstoned = deletedIds || {};
  const obsidianTombs = obsidianTombstones || {};
  const rescued = (Array.isArray(prevList) ? prevList : []).filter((t) => {
    if (!t) return false;
    const id = String(t.id);
    if (mergedIds.has(id)) return false;          // already present in the merged set
    if (!isRescuable(t)) return false;            // merge governs this task — an absence is a real delete
    if (tombstoned[id]) return false;             // deleted elsewhere (in-app / DB) — stay deleted
    // A vault-deleted Obsidian task stays deleted (LWW: deletion at least as new
    // as the task). A re-created / still-note-backed task (newer than any deletion)
    // is kept.
    if (t.importSource === 'obsidian' && isObsidianTombstoned(obsidianTombs, id, t.lastModified)) return false;
    return true;
  });
  return [...merged, ...rescued];
}
