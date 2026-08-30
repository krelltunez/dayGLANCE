// BIN-VERSUS-VAULT — §3.10 ruling 5: THE VAULT WINS, UN-BIN VISIBLY.
//
// A task binned in dayGLANCE whose line still exists in the vault is
// RESTORED from the recycle bin, with the reason attached to the task.
// The reasoning (recorded in the spec's §3.10, ruling 5):
//   • It is already the rule. The vault controls task existence (ruling 4),
//     and the re-import is that rule executing correctly. The bug was never
//     that the vault wins — it is that it won silently and REPEATEDLY: the
//     bin copy's deliberately-fresh delete stamp beat the re-import's epoch
//     lastModified in the cross-list reconciler, which deleted the imported
//     copy every cycle while the next scan resupplied it (a delete/resupply
//     war of exactly the #1455 class).
//   • Bin-wins would mean dayGLANCE suppressing a line that exists in the
//     user's file — the app deciding a vault line shouldn't count — and
//     would need a tombstone channel the vault never sees (there is no
//     delete intent by the Phase 6 scope ruling): the split-brain state
//     §3.10's availability note warns about.
//   • The honest cost, accepted: binning is an explicit user action and
//     telling the user no is unfriendly. But the alternative is a line
//     sitting in their daily note that dayGLANCE deliberately ignores
//     forever — the invisible divergence vault-is-ground-truth exists to
//     prevent.
//
// SURFACING (the #1465 precedent — utils/obsidianTitleConflict.js): the
// task itself is the surface. The restored task carries a line in
// task.notes, which lights the card's notes button — the user sees a task
// they thought they deleted, notices the indicator, and finds the
// explanation attached to the exact object they're confused about. A
// transient toast is the immediate half; the notes entry is the durable
// artifact.
//
// RARE, NOT REPEATED: the un-bin itself repeats while the line exists —
// that IS the ruling — but the notes line is deterministic (locale-free,
// no timestamp) and appended through an include-guard, so binning the same
// task three times, or N devices racing their scans, produces ONE record,
// never a stack. Same unanimity trick as the title-conflict record.
//
// The restored copy's lastModified is stamped strictly NEWER than the bin
// entry's delete stamp (which useTaskActions deliberately made newer than
// the task), mirroring undeleteTask's rule: without the fresher stamp,
// peer devices' cross-list reconciliation would send the restore straight
// back to the bin.

import { stripObsidianDisplayTag } from './obsidianTitleConflict.js';

// App-owned fields carried from the bin copy onto the restored task —
// the same set the scan pipeline carries from a live existing task
// (mergeParsedObsidianTasks + preserveObsidianAppFields): once imported,
// dayGLANCE owns state (§3.10 ruling 4); the vault line only re-establishes
// existence and its own line-derived values.
const APP_FIELDS = [
  'notes', 'subtasks', 'color', 'duration', 'priority', 'deadline',
  'date', 'startTime', 'isAllDay',
  'projectId', 'assignedUserSyncIds', 'archived', 'completedAt',
];

/**
 * The durable notes record. Deterministic and locale-free on purpose: the
 * full line is its own idempotence key, so every device (and every repeat
 * of the same bin/restore round) produces the same line and the guard
 * below collapses them. `dateStr` is the daily note holding the line;
 * null falls back to naming the vault.
 */
export function binRestoreNoteLine(dateStr) {
  return dateStr
    ? `Restored from the recycle bin. This task's line still exists in your ${dateStr} daily note. Delete the line in Obsidian to remove it.`
    : `Restored from the recycle bin. This task's line still exists in your Obsidian vault. Delete the line in Obsidian to remove it.`;
}

/** Append the record to a notes string, once ever (see the header). */
export function appendBinRestoreNote(notes, dateStr) {
  const existing = typeof notes === 'string' ? notes : '';
  const line = binRestoreNoteLine(dateStr);
  if (existing.includes(line)) return notes;
  return existing ? `${existing}\n${line}` : line;
}

/** The fire-and-forget toast text (neutral, never red, never latched). */
export function binRestoreNoticeText(restored) {
  if (restored.length === 1) {
    const r = restored[0];
    const where = r.dateStr ? `your ${r.dateStr} daily note` : 'your Obsidian vault';
    return `Restored "${stripObsidianDisplayTag(r.title)}" from the recycle bin. Its line still exists in ${where}.`;
  }
  return `${restored.length} tasks were restored from the recycle bin. Their lines still exist in your vault. See each task's notes.`;
}

/**
 * Un-bin every recycle-bin task whose line this scan (or observation
 * batch) just produced. Pure: takes the bin plus the freshly SCANNED task
 * lists (pre-merge), returns replacements for all three plus the restored
 * summaries for the toast. The caller feeds the returned lists into the
 * normal merges — the restored copy rides the scanned slot, so everything
 * downstream (tombstone honoring, retention, snapshot) treats it exactly
 * like any scanned task.
 *
 * Restored task = the scanned copy (line truth: title, identity,
 * completion state as the line says now) overlaid with the bin copy's
 * app-owned fields, `completed` OR-merged like the pipeline does, the
 * notes record appended, and lastModified stamped past the delete stamp.
 * List placement honors `_deletedFrom` exactly like undeleteTask.
 */
export function restoreBinnedVaultTasks({ recycleBin, scheduledTasks, inboxTasks, nowMs = Date.now() }) {
  const bin = recycleBin || [];
  const scheduled = scheduledTasks || [];
  const inbox = inboxTasks || [];
  const none = { recycleBin: bin, scheduledTasks: scheduled, inboxTasks: inbox, restored: [] };
  if (!bin.length) return none;

  // Scanned index by id AND legacy hint (the one-time block-id switch: a
  // bin copy may still hold the content-derived id of a line that now
  // scans under its ^dg- identity).
  const index = new Map();
  for (const t of [...scheduled, ...inbox]) {
    index.set(String(t.id), t);
    if (t.obsidianLegacyId) index.set(String(t.obsidianLegacyId), t);
  }

  const replacements = new Map(); // scanned task → { task, target }
  const restored = [];
  const keptBin = [];
  for (const b of bin) {
    const scanned = b.importSource === 'obsidian' ? index.get(String(b.id)) : undefined;
    if (!scanned || replacements.has(scanned)) {
      // No vault line for this bin entry (stays binned — nothing to
      // restore FROM), or a second alias of a line already restored this
      // pass (kept conservatively; it converges through the normal merge).
      keptBin.push(b);
      continue;
    }
    const { _deletedFrom, deletedAt, ...appCopy } = b;
    const t = { ...scanned };
    if (appCopy.completed) t.completed = true; // OR-merge, like the pipeline
    for (const f of APP_FIELDS) {
      if (appCopy[f] !== undefined) t[f] = appCopy[f];
    }
    const dateStr = scanned.obsidianFileDate
      || String(scanned.id).match(/^obsidian-(\d{4}-\d{2}-\d{2})/)?.[1]
      || scanned.date
      || null;
    t.notes = appendBinRestoreNote(t.notes, dateStr);
    // Strictly newer than the delete stamp, or peers re-bin the restore.
    t.lastModified = new Date(Math.max(
      nowMs,
      (deletedAt ? Date.parse(deletedAt) : 0) + 1000,
      (b.lastModified ? Date.parse(b.lastModified) : 0) + 1000,
    )).toISOString();
    const target = _deletedFrom === 'inbox' ? 'inbox' : _deletedFrom === 'calendar' ? 'scheduled' : null;
    replacements.set(scanned, { task: t, target });
    restored.push({ id: String(t.id), title: t.title, dateStr });
  }
  if (!restored.length) return none;

  const outScheduled = [];
  const outInbox = [];
  for (const s of scheduled) {
    const r = replacements.get(s);
    if (!r) outScheduled.push(s);
    else (r.target === 'inbox' ? outInbox : outScheduled).push(r.task);
  }
  for (const s of inbox) {
    const r = replacements.get(s);
    if (!r) outInbox.push(s);
    else (r.target === 'scheduled' ? outScheduled : outInbox).push(r.task);
  }
  return { recycleBin: keptBin, scheduledTasks: outScheduled, inboxTasks: outInbox, restored };
}
