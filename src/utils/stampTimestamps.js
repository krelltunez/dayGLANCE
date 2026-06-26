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
function normalizeField(task) {
  const { lastModified: _omit, ...rest } = task;
  return { ...rest, notes: rest.notes ?? '', subtasks: rest.subtasks ?? [] };
}

function normalizedForCompare(task) {
  return JSON.stringify(normalizeField(task));
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
        try { onRestamp({ id: t.id, changedKeys: diffKeys(prevTask, t) }); } catch { /* diagnostic must never throw */ }
      }
    }
    if (!prevTask && t.lastModified) return t;
    return { ...t, lastModified: now };
  });
}
