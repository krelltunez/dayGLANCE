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
//
// `priority` joins them for the same reason (2026-09-06 field finding, the
// phantom re-stamp): scheduling a task from the inbox STRIPS the key, while
// a re-parse of an untimed Obsidian line carries `priority: 0`. Absent and 0
// are the SAME state ("none"); read as a change, that presence flip
// re-stamped a scheduled task on every phone that scanned a stale vault copy,
// and the fabricated stamp outranked a real completion made elsewhere.
//
// `deferrals` (utils/deferrals.js) is stripped for the same reason as
// `originalPlan`: the app writes it, not the user. It is derived from a
// reschedule that has already stamped on its own, and it also moves when a merge
// takes a higher count from another device, which is nobody's edit at all.
//
// `planTrail` (utils/planTrail.js) is the same field in list form and is
// stripped on the same grounds. Its merge is a UNION, so it grows whenever
// another device's history arrives — a change no user made, on a device nobody
// touched.
//
// `starredDate` is DEFAULTED rather than stripped, because unlike the fields
// below it is a real user action: starring a task is an edit and must re-stamp
// so it wins on other devices. Only the absent/null pair is canonicalised, since
// both mean "not starred" and a passive normalization between them is not an
// edit anyone should out-rank.
//
// `originalPlan` is stripped outright rather than defaulted, because unlike the
// fields above it is not a user-visible value at all: utils/originalPlan.js
// writes it during the persist pass, once, when a task is first observed being
// scheduled, and never rewrites it. So its appearance or absence can never be
// something the user did, and it must not out-rank something they did do on
// another device. Without this, the first save after the feature ships would
// re-stamp every newly scheduled task and those fabricated timestamps would beat
// real completions made elsewhere — the exact resurrection described above.
//
// `clientId` (intents/launcherWrites.js) is the GLANCElauncher's id for the
// write that created the task. The app stamps it right after the create, which
// has already stamped on its own; a copy gaining it later is sync carrying it,
// never a user's edit. Stripped like `originalPlan`.
//
// `createdAt` (utils/createdAt.js) is stamped by the persist pass the first
// time this device stores a task it created, once, and never rewritten; sync
// carries it to the other devices. Its appearance is bookkeeping, never a
// user's edit, so it is stripped like `originalPlan`: otherwise the save that
// stamps it would re-stamp `lastModified` too, and on a copy that arrived
// without it, a fabricated stamp could out-rank a real completion elsewhere.
//
// `obsidianNoteLinkSeen` / `obsidianNoteLinkSeenAt` are the Obsidian merge's
// record of when it last saw a task line carry the link to its note
// (utils/mergeObsidianTasks.js). The merge bumps the stamp whenever the note's
// mtime rises, and for a project task that note is the PROJECT note, so any
// edit to it touched every task linked in it. As an edit, that re-stamped a
// stale copy on a device that had not yet pulled newer ones, and the stale
// copy then won everywhere: it reverted project task order across devices and
// could as easily have resurrected a completion made elsewhere.
// `deadline` is DEFAULTED for the starredDate reason, not stripped: setting one
// is a real user edit that must re-stamp (the picker, and the editor's deadline
// field, write it), but "no deadline" reaches storage two ways — the key absent
// on a task that never had one, and an explicit `null` from a picker clear or
// from a save of the editor's deadline field. Those are the SAME state, so
// canonicalising
// the pair keeps a save that merely passes the field through from re-stamping a
// task nobody edited (a fabricated stamp that could out-rank a real completion
// elsewhere — see the resurrection note above). A date, cleared or changed,
// still differs from `null` and still stamps.
// `exceptionsTimestamps` (packages/dayglance-vault/src/recurringExceptions.js) is a series' per-date
// record of when each occurrence edit last changed. The save pass derives it
// from an edit that already re-stamps the row, and a merge moves it when it
// takes a newer stamp from another device, which is nobody's edit. Stripped
// like `planTrail`.
function normalizeField(task) {
  // obsidianClearedTime is bookkeeping for the inbox merge (utils/inboxMove.js):
  // set by the move that already stamps, and cleared when the line is next
  // observed untimed. Clearing it is not an edit anyone should out-rank.
  const { lastModified: _omit, obsidianClearedTime: _marker, originalPlan: _baseline, deferrals: _slips, planTrail: _stops,
    obsidianNoteLinkSeen: _linkSeen, obsidianNoteLinkSeenAt: _linkSeenAt, clientId: _launcherWrite, createdAt: _created,
    exceptionsTimestamps: _occurrenceStamps, ...rest } = task;
  return { ...rest, notes: rest.notes ?? '', subtasks: rest.subtasks ?? [], archived: rest.archived ?? false, priority: rest.priority ?? 0, starredDate: rest.starredDate ?? null, deadline: rest.deadline ?? null };
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
    // A file re-import can explicitly restore an id whose deletion is newer
    // than this device's clock. The importer orders that restore after both
    // the tombstone and the previous stored copy. Do not lower its explicit
    // stamp during save or outbound payload building. Ordinary edits retain
    // the stored stamp until changed, so they still take the normal path.
    if (t.imported && t.importSource === 'file' &&
        Date.parse(t.lastModified) > (Date.parse(prevTask?.lastModified) || 0)) return t;
    if (prevTask && prevTask.lastModified) {
      if (normalizedForCompare(prevTask) === normalizedForCompare(t)) {
        return { ...t, lastModified: prevTask.lastModified };
      }
      if (onRestamp) {
        try { onRestamp({ id: t.id, changedKeys: diffKeys(prevTask, t) }); } catch { /* diagnostic must never throw */ }
      }
    }
    if (!prevTask && t.lastModified) return t;
    // Later edits of a restored file task must also stay after its stored
    // restore stamp, even before the local clock has caught up with it.
    const previousTime = Date.parse(prevTask?.lastModified);
    const editedAt = t.imported && t.importSource === 'file' && previousTime >= Date.parse(now)
      ? new Date(previousTime + 1).toISOString()
      : now;
    return { ...t, lastModified: editedAt };
  });
}
