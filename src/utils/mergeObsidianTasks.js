import { isObsidianTombstoned, obsidianKeyDate } from './obsidianDeletions.js';
import { LINE_OWNED_TASK_FIELDS } from '@glance-apps/obsidian-format';

// Merge an Obsidian scan into one task list (scheduled or inbox) WITHOUT deleting
// Obsidian tasks the scan didn't produce — unless a deletion tombstone says the
// task was really removed from the vault. The task-side counterpart to
// mergeObsidianDailyNotes; same fix for the same measured loop.
//
// RULE:
//   - a scanned task overrides its prior copy (fresh markdown), with the
//     app's fields carried forward via `preserveAppFields` (the app's carry
//     is preserveObsidianAppFields below: everything the LINE does not own);
//   - a prior Obsidian task NOT in `scannedIdsAllLists` is RETAINED — it belongs to
//     another device's vault. `scannedIdsAllLists` spans BOTH scheduled and inbox
//     scans so a task that merely moved lists is treated as scanned (dropped here,
//     added by the other list) rather than duplicated;
//   - EXCEPT: any task whose deletion tombstone is at least as new as the task is
//     dropped — a genuine vault deletion propagates; a re-created task (newer
//     lastModified) wins and comes back;
//   - REVIVAL STAMPING (§3.10 ruling 6): a SCANNED row about to be dropped by a
//     tombstone OLDER than its note's mtime is admitted instead, with
//     lastModified lifted to that mtime — see reviveScannedAgainstTombstone;
//   - non-Obsidian tasks pass through untouched.
//
// @param {object[]} prevList            current tasks in THIS list
// @param {object[]} scannedList         this scan's tasks for THIS list
// @param {Set<string>} scannedIdsAllLists  string ids across BOTH scan lists
// @param {(old:object)=>object} preserveAppFields  app-only fields to carry forward
// @param {Record<string, string>} [tombstones]  deletedObsidianKeys (id → deletedAt ISO)
// @param {Record<string, string>} [noteMtimes]  note date → that note's lastModified
//   ISO for the notes THIS scan/observation batch actually read (revival evidence;
//   see below). Callers without note mtimes pass nothing and get the old behavior.
// @returns {object[]} merged list

const ts = (v) => {
  if (v == null) return 0;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
};

// REVIVAL STAMPING (§3.10 ruling 6 — what-wins-on-EXISTENCE-divergence).
// The tombstone question is an existence question, and the honest timestamp
// for "does the vault say this line exists" is the NOTE'S MTIME — the vault's
// statement time. The task record's lastModified answers a different question
// (content LWW). The two questions shared a field, which made the documented
// "a later re-creation in Obsidian wins" rule nominally true but mechanically
// inert for tasks: a fresh import carries an epoch lastModified, so a line
// deleted and retyped verbatim (same content hash — or, for a stamped task,
// the deterministic deriveBlockId re-minting the tombstoned token) lost to
// its tombstone until the 60-day GC. So: when a SCANNED row — a line this
// batch actually read out of its note — would be dropped by a tombstone
// OLDER than that note's mtime, the vault re-created (or still carries) the
// line after the deletion statement, and the row is admitted with
// lastModified LIFTED TO THE NOTE MTIME. The lift is what makes the revival
// propagate: the revived row out-LWWs its tombstone at the applyEngineData
// gate, the mergeSync cleanse, and the push guard with no changes to any of
// them. This is ruling 4 (the vault controls existence) working, not amended.
//
// KEEP IT NARROW — the lift happens ONLY when a tombstone exists AND the
// note was written after it. The obvious wider fix (stamp EVERY fresh import
// with its note's mtime instead of epoch) is wrong and stays wrong: epoch on
// fresh imports is load-bearing. A bare re-parse carries none of the
// app-only fields (projectId, color, notes, assignedUserSyncIds,
// completedAt), so an mtime-stamped default-filled copy from a cold-open /
// vaultless device would beat another device's real record in row-level LWW
// and wipe those fields fleet-wide. Epoch guarantees a parse never beats a
// record; the tombstone-older-than-note case is the one situation where
// there is no record left to beat. Widening this condition reintroduces
// exactly that hazard.
//
// The shape that does NOT work, recorded so it isn't re-proposed: clearing
// the tombstone key on reappearance. deletedObsidianKeys merges grow-union,
// newest-per-key (mergeSync's tombstone-bundle loop), so a local removal is
// re-added by every other device's copy — removals structurally don't stick
// in that channel. Out-timestamping the tombstone is the only durable win.
//
// RETAINED rows are deliberately not revived: their notes are not in this
// batch, so there is no fresh vault statement to lift from. A stamped task
// transiently dropped this way comes back on its note's next observation —
// which the stamp's own write guarantees exists.
const reviveScannedAgainstTombstone = (t, tombstones, noteMtimes) => {
  const at = tombstones[String(t.id)];
  // No tombstone, or the row already beats it: never touch the stamp — a
  // fresh import keeps epoch, and a row with a real content-LWW stamp must
  // not have it regressed toward an (older) note mtime.
  if (!at || ts(at) < ts(t.lastModified)) return t;
  // A non-daily task's note is named by path (companion §6); dates and
  // paths share the map without colliding.
  const noteDate = t.obsidianNotePath || t.obsidianFileDate || obsidianKeyDate(String(t.id));
  const mtime = noteDate ? noteMtimes[noteDate] : undefined;
  // The row is about to be dropped; the note was written AFTER the deletion
  // statement → revive. mtime > at >= lastModified, so the lift is always
  // upward.
  if (mtime && ts(mtime) > ts(at)) return { ...t, lastModified: mtime };
  return t; // tombstone as new as the note (or no mtime evidence) — stays gone
};

// THE APP-FIELD CARRY across a re-parse — BY EXCLUSION (2026-09-06).
//
// The scan/observation merge (obsidian.js mergeParsedObsidianTasks) rebuilds
// every task from its line, so whatever the markdown cannot reproduce must
// be carried from the app's existing copy or a re-parse wipes it. This used
// to be an allow-list of fields to carry; everything not on it was dropped
// by default, and the list was found one incident at a time: archived and
// completedAt (the cold-open churn), assignedUserSyncIds, then on the day
// of the SSE re-arm transitionId and the priority shape (the phantom
// re-stamp, below), then energy because it sat in the same place — and an
// audit at that point found focusMinutes (focus sessions accruing on a
// scheduled task, reset by every scan), bucketId (a task falling out of its
// bucket back to the inbox) and hyperglanceSessionDate being wiped with
// nobody having reported it. The allow-list was costing features.
//
// So the rule is inverted: every field on the app's copy is carried UNLESS
// the LINE owns it. The line-owned set is LINE_OWNED_TASK_FIELDS, exported
// by the parser's module beside the code that emits it, plus the two the
// per-note merge adds (lastModified, projectId); the key contract
// (obsidian.lineOwnedFields.test.js; taskLines.contract.test.js in the
// package) pins that set against the marker corpus, so a marker the parser
// learns cannot ship without the list learning it. A new app-side field is
// safe by default. A line-owned key absent from the scan is CLEARED, never
// carried — an un-scheduled line drops the schedule keys, a stripped token
// drops the block id — which is what keeps the inversion from re-creating
// the war shape of an inbox record carrying a stale startTime.
//
// The explicit rules that remain are real semantics on line-owned keys,
// each pinned by a removal or carry test, not a memory list:
//
//  • completedAt — APP WINS WHEN IT HAS A VALUE; THE VAULT MARKER FILLS THE
//    BLANK (the completion-timestamp feature's merge rule): the marker is
//    an echo of an action dayGLANCE performed, and a stale echo must not
//    overwrite the source. An explicit null (the app uncompleted the task)
//    is the app's statement and still wins; the adoption case (marker, no
//    app value) isn't a conflict, the parsed value stays.
//  • projectId — app-owned, carried across re-scans unless the SCAN adopted
//    a vault edit of the line's [project:: …] field (companion §4.3, ruling
//    G as amended): a resolved id wins, an explicit null (the field
//    removed) unassigns.
//  • deadline — same shape as projectId since Step 2: line-derived (📅),
//    adopted on a vault edit with an explicit null on removal, so ABSENCE
//    from the scan means "no opinion" and the app's value fills it.
//  • priority — the SHAPE: a scheduled copy carries NO priority key
//    (scheduling strips it) while the re-parse of an untimed line says 0.
//    Absent and 0 are the same state ("none"), so the app's shape wins and
//    the row hashes as it did; a vault marker edit is adopted onto a copy
//    that HAS the key (inbox-shaped) and is untouched here. (The compare
//    side is closed too: stampTimestamps.normalizeField reads absent and 0
//    as one state.)
//  • transitionId — rides with the completion STATE: carried while the
//    merge leaves that state as the app had it (the OR keeps a completed
//    copy completed), never onto a completion the vault just made (a fresh
//    transition owns no stale id; the notify emitter mints one).
//
// THE PHANTOM RE-STAMP, for the record: any key whose value or mere
// presence differs between the app's copy and the re-parse registers with
// stampTimestamps as an edit and fabricates a fresh lastModified on a task
// nobody touched; under DB-tier last-write-wins that stamp outranks real
// edits made elsewhere in the same window. A phone scanning a stale vault
// copy re-stamped a task every time it pulled a newer desktop copy, and a
// sidebar completion that landed inside that window was overwritten.
export const APP_LINE_OWNED_TASK_FIELDS = Object.freeze([...LINE_OWNED_TASK_FIELDS, 'lastModified', 'projectId']);
const LINE_OWNED = new Set(APP_LINE_OWNED_TASK_FIELDS);
// App fields the per-note merge DECIDES from the line each time rather than
// carries from the stored copy: the cleared-time marker (utils/inboxMove.js)
// survives only while the merge keeps re-asserting it (a still-timed stale
// line) and is dropped the moment the line is observed without a time or
// the task is scheduled from the line (§8 ruling, 2026-09-08).
const SCAN_DECIDED = new Set(['obsidianClearedTime']);

export function preserveObsidianAppFields(old, scanned = {}) {
  const carried = {};
  for (const k of Object.keys(old)) {
    if (!LINE_OWNED.has(k) && !SCAN_DECIDED.has(k) && old[k] !== undefined) carried[k] = old[k];
  }
  if (carried.transitionId !== undefined && !!old.completed !== !!scanned.completed) delete carried.transitionId;
  return {
    ...carried,
    ...(old.completedAt !== undefined ? { completedAt: old.completedAt } : {}),
    ...(scanned.projectId === null ? { projectId: undefined }
      : old.projectId && scanned.projectId === undefined ? { projectId: old.projectId } : {}),
    ...(old.deadline && scanned.deadline === undefined ? { deadline: old.deadline } : {}),
    ...(old.priority === undefined && scanned.priority === 0 ? { priority: undefined } : {}),
  };
}

export function mergeObsidianTasks(prevList, scannedList, scannedIdsAllLists, preserveAppFields, tombstones = {}, noteMtimes = {}) {
  const prev = prevList || [];
  const nonObsidian = prev.filter(t => t.importSource !== 'obsidian');
  const oldObsidian = prev.filter(t => t.importSource === 'obsidian');
  const oldMap = new Map(oldObsidian.map(t => [String(t.id), t]));
  const merged = (scannedList || []).map(t => {
    // Secondary lookup by the scanned task's legacy-id hint: bridges the
    // one-time switch from content-derived to ^dg- block-derived ids, so
    // app-only fields survive on a device that still holds the task under
    // its old id (see resolveExistingObsidianTask in obsidian.js).
    const old = oldMap.get(String(t.id))
      ?? (t.obsidianLegacyId ? oldMap.get(String(t.obsidianLegacyId)) : undefined);
    // The scanned task is passed alongside so preserveAppFields can decline
    // to stomp a value the SCAN itself produced — Step 2's per-field
    // vault-edit adoption sets `deadline` on the scan result, and a blind
    // old-side carry here would silently undo the adoption.
    return old ? { ...t, ...preserveAppFields(old, t) } : t;
  }).map(t => reviveScannedAgainstTombstone(t, tombstones, noteMtimes))
    .filter(t => !isObsidianTombstoned(tombstones, String(t.id), t.lastModified));
  const retained = oldObsidian.filter(t =>
    !scannedIdsAllLists.has(String(t.id)) &&
    !isObsidianTombstoned(tombstones, String(t.id), t.lastModified));
  return [...nonObsidian, ...merged, ...retained];
}

/** Note path → lastModified ISO, from an observation batch's scopedNotes shape (companion §6). */
export function noteMtimesFromScopedNotes(scopedNotes) {
  const out = {};
  for (const [path, note] of Object.entries(scopedNotes || {})) {
    if (note && note.lastModified) out[path] = note.lastModified;
  }
  return out;
}

/** Note date → lastModified ISO, from a scan/observation's dailyNotes shape. */
export function noteMtimesFromDailyNotes(dailyNotes) {
  const out = {};
  for (const [date, note] of Object.entries(dailyNotes || {})) {
    if (note && note.lastModified) out[date] = note.lastModified;
  }
  return out;
}
