// Which task rows buildSyncPayload structurally EXCLUDES from the sync payload —
// the single source of truth, shared by App.jsx (payload build) and the
// snapshot-delete classification in dbEngine.js. If the payload rule changes,
// it must change HERE so both sides stay in lockstep; a drift between them
// re-opens the churn loop this module exists to close.
//
// WHY THE CLASSIFIER NEEDS THIS: the push diff flags "in the snapshot baseline
// but absent from getData()" as a would-be delete. A row of an excluded class
// can sit in the BASELINE while being permanently unable to appear in
// getData() — the exclusion is deterministic, not a transient state glitch.
// Classic trigger: a fresh device's first full pull (cursor 0) ingests legacy
// vault rows of excluded classes (pushed by old builds before the exclusion
// rules existed) into its mirror and therefore its snapshot. Without this
// classification the delete guard treats them as glitch-suspects forever:
// skip → per-row re-fetch → re-commit → re-vanish, every cycle — the observed
// ~150-row recovery loop whose request storm rate-limited the vault (429s),
// which in turn kept the loop at full size. See dbEngine.js's call site.

/**
 * The payload's imported-task sync rule (verbatim from buildSyncPayload):
 * always drop read-only CalDAV events; keep isTaskCalendar to-dos and ICS file
 * imports as first-class data. In multi-user, additionally drop ALL
 * subscription-derived ('sync') items so a CalDAV feed never leaks to other
 * users — each device re-fetches from its own per-user URL.
 */
export function keepImportedTask(t, multiUserEnabled) {
  return !(t.imported && !t.isTaskCalendar && t.importSource !== 'file')
    && !(multiUserEnabled && t.imported && t.importSource === 'sync');
}

/**
 * True when [entity] — a mirror/snapshot wrap ({ _kind, value }, see
 * dbAdapter.js) — belongs to a class buildSyncPayload structurally excludes:
 *   tasks:            `_native` rows and imported rows failing keepImportedTask
 *   unscheduledTasks: imported rows failing keepImportedTask
 * Everything else (and anything unparseable) is NOT excluded — the caller's
 * conservative glitch handling then applies, which fails safe toward keeping.
 */
export function isPayloadExcludedEntity(entity, { multiUserEnabled = false } = {}) {
  if (!entity || typeof entity !== 'object') return false;
  const t = entity.value;
  if (!t || typeof t !== 'object') return false;
  if (entity._kind === 'tasks') return !!t._native || !keepImportedTask(t, multiUserEnabled);
  if (entity._kind === 'unscheduledTasks') return !keepImportedTask(t, multiUserEnabled);
  return false;
}

/**
 * Reason to RELEASE a would-be-glitch vanish whose snapshot copy the FILE TIER
 * (WebDAV / iCloud) will keep out of getData() every cycle — or null to keep the
 * glitch classification. Healing such a row is FUTILE: the file tier re-drops it,
 * the vault vanish-guard re-fetches it, forever (the observed endless GUARD churn
 * — 85 completed inbox rows + 65 completed scheduled rows on a device whose file
 * tier had aged them out while the vault kept resurrecting them).
 *
 * The mechanism is the shared file-tier merge's ZOMBIE-DROP (@glance-apps/sync
 * merge.js, mergeArrayById): a task that is local-only in the remote file AND
 * whose `lastModified` predates the remote's `tombstonePrunedBefore` (dayGLANCE
 * sets this to the 60-day tombstoneCutoff — see mergeSync.js) is SILENTLY dropped
 * rather than re-uploaded, on the theory its tombstone was already GC'd. Such a
 * row can therefore never reappear in getData(), yet it sits in the vault and the
 * snapshot baseline — a permanent would-be-delete with no fingerprint. Two shapes
 * qualify (tasks / unscheduledTasks only):
 *   'completed'    — a completed task. Completed rows stop being touched, so their
 *                    lastModified goes stale and the file tier zombie-drops them;
 *                    and a completed row that PERSISTENTLY vanishes is being aged
 *                    out, not glitching. (Every observed stuck row is completed.)
 *   'sync-horizon' — ANY row (incl. incomplete) whose lastModified predates the
 *                    sync horizon: this is exactly the zombie-drop condition, so
 *                    the file tier will re-drop it every cycle.
 *
 * Release = not propagated as a delete, not heal-fetched, dropped from the diff
 * baseline. The vault row is UNTOUCHED (it survives for other devices); the next
 * saved snapshot stops tracking it and the loop ends. Only would-be 'glitch' rows
 * reach here — tombstoned / stale-tombstone / cross-list are decided first.
 *
 * @param {object} entity  wrapped entity ({ _kind, value }, see dbAdapter.js)
 * @param {{ horizonMs?: number }} [opts]  horizonMs = the file-tier sync-horizon
 *   epoch ms (tombstoneCutoff().getTime()); omit / non-finite → skip the horizon
 *   branch (the 'completed' branch still applies).
 * @returns {'completed'|'sync-horizon'|null}
 */
export function agedOutReleaseReason(entity, { horizonMs = NaN } = {}) {
  if (!entity || typeof entity !== 'object') return null;
  if (entity._kind !== 'tasks' && entity._kind !== 'unscheduledTasks') return null;
  const t = entity.value;
  if (!t || typeof t !== 'object') return null;
  if (t.completed === true) return 'completed';
  if (Number.isFinite(horizonMs)) {
    const lm = new Date(t.lastModified).getTime();
    if (Number.isFinite(lm) && lm < horizonMs) return 'sync-horizon';
  }
  return null;
}
