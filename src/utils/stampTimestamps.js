// Pure timestamp-stamping for synced task arrays, extracted from
// useDataPersistence so it can be unit-tested in isolation.
//
// PURPOSE: a safety net that assigns `lastModified` to tasks that changed but
// weren't stamped at their mutation site, so other devices see the update.
//
// HAZARD it must avoid: re-stamping a task the user did NOT change. The file-tier
// cloud sync resolves tasks by last-write-wins on `lastModified`. If a stale
// device re-stamps an unchanged (e.g. still-incomplete) task with a fresh "now",
// that fabricated timestamp beats a real completion made elsewhere and the task
// RESURRECTS. So the change-detection must not fire on passive normalization
// (default fields that load/merge add to in-memory state but that may be absent
// from the stored copy it is compared against).

// Strip `lastModified` and default the fields that are normalized into in-memory
// tasks (see loadData / applyEngineData) but may be missing from the stored copy,
// so a passive default-add doesn't register as a user edit.
//
// `archived` belongs here for the SAME reason as notes/subtasks: a task that was
// never archived carries no `archived` key in storage, but an unarchive (or a
// merge from a device that does set it) leaves `archived: false` in memory. Absent
// and `false` are the SAME state ("not archived"), so they must compare equal —
// otherwise every cold-open re-stamps `lastModified` on those items (changed:
// ['archived']), which then dirties them for the DB-sync push. Canonicalising both
// sides to `false` makes archived round-trip identically for the diff while a real
// archive (`archived: true`) still reads as a genuine change.
function normalizeField(task) {
  const { lastModified: _omit, ...rest } = task;
  return { ...rest, notes: rest.notes ?? '', subtasks: rest.subtasks ?? [], archived: rest.archived ?? false };
}

// Order-INSENSITIVE stringify of the normalized task. A defaulted field (archived,
// notes, subtasks) lands at a different key position depending on whether it was
// already present in the stored copy or added by normalizeField — so a plain
// JSON.stringify would flag two semantically-equal objects as different purely on
// key order. Sorting the top-level keys makes the comparison depend on VALUES, not
// insertion order (diffKeys is already per-key, so it needs no change).
function normalizedForCompare(task) {
  const n = normalizeField(task);
  const sorted = {};
  for (const k of Object.keys(n).sort()) sorted[k] = n[k];
  return JSON.stringify(sorted);
}

// Keys whose (normalized) values differ between the stored and in-memory copy.
// Used only by the optional diagnostic below.
function diffKeys(prev, curr) {
  const p = normalizeField(prev);
  const c = normalizeField(curr);
  const keys = new Set([...Object.keys(p), ...Object.keys(c)]);
  const changed = [];
  for (const k of keys) {
    if (JSON.stringify(p[k]) !== JSON.stringify(c[k])) changed.push(k);
  }
  return changed;
}

/**
 * Return `currentTasks` with `lastModified` assigned:
 *  - unchanged from its stored copy (ignoring default normalization) → keep the
 *    stored `lastModified` (do NOT fabricate a newer one);
 *  - new to storage but already carrying a `lastModified` (e.g. arrived via cloud
 *    merge or an import) → keep it, so a passive re-import isn't treated as a
 *    newer edit than real changes elsewhere;
 *  - otherwise (genuinely new or changed) → stamp `now`.
 *
 * @param {object[]} currentTasks  in-memory task array
 * @param {object[]} prevTasks     the stored copy to diff against
 * @param {string}   now           ISO timestamp to stamp changed/new tasks with
 * @param {(info: {id: any, changedKeys: string[]}) => void} [onRestamp]
 *   Optional diagnostic, called when an EXISTING task (one that had a stored
 *   `lastModified`) is re-stamped because its content differs. `changedKeys` is
 *   the list of fields that actually differ — a real edit reports meaningful
 *   fields; a phantom re-stamp (the resurrection bug) reports an unexpected or
 *   default-only field. Off in production; wired behind a debug flag by the hook.
 */
export function stampTimestamps(currentTasks, prevTasks, now, onRestamp) {
  const prevMap = new Map((prevTasks || []).map((t) => [String(t.id), t]));
  return currentTasks.map((t) => {
    const prevTask = prevMap.get(String(t.id));
    if (prevTask && prevTask.lastModified) {
      if (normalizedForCompare(prevTask) === normalizedForCompare(t)) {
        return { ...t, lastModified: prevTask.lastModified };
      }
      if (onRestamp) {
        // Include the RAW (pre-normalization) prev/cur value for each changed key
        // so a debug build can log EXACTLY what differs — undefined vs false vs
        // true vs a string — instead of us guessing. `changed` carries the raw
        // values (not the `?? false`-normalized ones) so absent shows as undefined.
        const changedKeys = diffKeys(prevTask, t);
        const changed = changedKeys.map((k) => ({ key: k, prev: prevTask[k], cur: t[k] }));
        // Also hand over the raw prev/cur so the logger can print item context
        // (completed/completedAt/lastModified) — enough to tell in ONE paste whether
        // this is the auto-archive convergence path or something else.
        try { onRestamp({ id: t.id, changedKeys, changed, prev: prevTask, cur: t }); } catch { /* diagnostic must never throw */ }
      }
    }
    if (!prevTask && t.lastModified) return t;
    return { ...t, lastModified: now };
  });
}
