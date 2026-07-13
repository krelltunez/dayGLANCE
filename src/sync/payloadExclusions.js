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
