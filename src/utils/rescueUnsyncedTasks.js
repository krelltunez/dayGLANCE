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
// THE CROSS-LIST GUARD (2026-09-05, the phone-soak duplicate): a cross-list move
// leaves no tombstone — scheduling an inbox task moves its id from
// unscheduledTasks to tasks, and the DB tier's reconcile keeps exactly one copy
// per id. This rescue runs PER LIST and saw only its own list: a peer's move
// arrived as "the id is gone from the inbox result", the rescue found the old
// inbox copy in prev, rescuable and untombstoned, and put it back — undoing the
// reconcile's choice every cycle. The next diff saw it as new, the push
// soft-deleted its row, the reconcile dropped it again, the rescue re-added it:
// a delete/resupply loop that the war guard eventually froze as a visible
// duplicate (a task on the timeline AND in the inbox). The rescue therefore
// takes the ids LIVE ANYWHERE in the incoming result (both lists and the
// recycle bin — the same set the retirement pass uses) and never rescues one:
// an id the merge placed somewhere is governed by the merge, and its absence
// from THIS list is a move, not a loss.
//
// THE HORIZON GUARD (2026-10-06, the Android ghost): a tombstone only lives 60
// days (packages/dayglance-vault/src/tombstoneRetention.js). A device offline longer than that still
// holds the task in `prev`, its tombstone has been GC'd, and the merge drops the
// task by its own fence (a local-only task older than the remote's
// `tombstonePrunedBefore` is presumed deleted elsewhere, not uploaded). The
// tombstone guard above cannot fire, so the rescue re-added it, the next cycle's
// merge dropped it again, and the apply ran every 15 s forever: a phone that had
// not synced since June held one inbox task the rest of the fleet had deleted
// months before, and the diagnostics showed "would apply: YES" on every check.
// This used to be documented here as a known boundary. It is closed by giving
// the rescue the same fence the merge uses: a prev-only task the merge GOVERNS
// (one buildSyncPayload would have sent: not native, and not an import the
// payload excludes) whose lastModified is older than `horizon` is not rescued.
// Device-only tasks the payload never carries (native rows, excluded imports)
// are re-provided by their own source and are not subject to it; nor is
// anything when the caller has no horizon to offer.
//
// UNSTAMPED IS NOT OLD (2026-10-07): a fresh Obsidian import and a bridge
// inbound row carry lastModified = epoch on purpose (obsidian.js,
// obsidianBridgeInbound.js: "so cloud merge correctly prefers real user edits
// from other devices"). The file-tier fence reads that as 1970 and drops the
// task as a zombie rather than uploading it, and before this guard the rescue
// quietly kept it in state while the vault tier carried it to the fleet. The
// guard as first merged (#1992) read it the same way and would have dropped a
// brand-new note line from state on every apply. So a missing stamp or the
// epoch sentinel is exempt from the horizon: a task is a zombie only when a
// REAL stamp says it is older than the fence.

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
 * @param {Set<string>} [liveIds]  ids live ANYWHERE in the incoming result (both task
 *   lists and the recycle bin); a prev-only copy of one of these is a cross-list move
 *   the merge already resolved, never a loss to rescue.
 * @param {object} [opts]
 * @param {Date|string|null} [opts.horizon]  the merge's fence (the remote's
 *   `tombstonePrunedBefore`); a governed prev-only task older than it is presumed
 *   deleted elsewhere with its tombstone pruned, and is NOT rescued. Null → no fence.
 * @param {(t:object)=>boolean} [opts.isGoverned]  which tasks the merge governs
 *   (buildSyncPayload would have sent them); only these are subject to the horizon.
 *   Default: everything but `_native` rows.
 * @returns {object[]} mergedList followed by the rescued (untombstoned) prev-only tasks
 */
export function rescueUnsyncedTasks(
  mergedList,
  prevList,
  deletedIds = {},
  isRescuable = isDefaultRescuable,
  obsidianTombstones = {},
  liveIds = null,
  { horizon = null, isGoverned = (t) => !t._native } = {},
) {
  const merged = Array.isArray(mergedList) ? mergedList : [];
  const mergedIds = new Set(merged.map((t) => String(t.id)));
  const tombstoned = deletedIds || {};
  const obsidianTombs = obsidianTombstones || {};
  const fence = horizon ? new Date(horizon).getTime() : NaN;
  const rescued = (Array.isArray(prevList) ? prevList : []).filter((t) => {
    if (!t) return false;
    const id = String(t.id);
    if (mergedIds.has(id)) return false;          // already present in the merged set
    if (liveIds && liveIds.has(id)) return false; // live in another list of the result: a move, not a loss
    if (!isRescuable(t)) return false;            // merge governs this task — an absence is a real delete
    if (tombstoned[id]) return false;             // deleted elsewhere (in-app / DB) — stay deleted
    // Older than the fence and governed by the merge: the merge dropped it as a
    // zombie (its tombstone is gone), and rescuing it would start the loop.
    // Only a REAL stamp counts; absent or epoch means "not stamped yet".
    if (!Number.isNaN(fence) && isGoverned(t)) {
      const stamp = t.lastModified ? new Date(t.lastModified).getTime() : NaN;
      if (Number.isFinite(stamp) && stamp > 0 && stamp < fence) return false;
    }
    // A vault-deleted Obsidian task stays deleted (LWW: deletion at least as new
    // as the task). A re-created / still-note-backed task (newer than any deletion)
    // is kept.
    if (t.importSource === 'obsidian' && isObsidianTombstoned(obsidianTombs, id, t.lastModified)) return false;
    return true;
  });
  return [...merged, ...rescued];
}
