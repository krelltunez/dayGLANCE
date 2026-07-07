import { isObsidianTombstoned } from './obsidianDeletions.js';

// Merge an Obsidian scan into one task list (scheduled or inbox) WITHOUT deleting
// Obsidian tasks the scan didn't produce — unless a deletion tombstone says the
// task was really removed from the vault. The task-side counterpart to
// mergeObsidianDailyNotes; same fix for the same measured loop.
//
// RULE:
//   - a scanned task overrides its prior copy (fresh markdown), with app-only
//     fields (archived/completedAt/projectId/deadline/assignedUserSyncIds) carried
//     forward via `preserveAppFields`;
//   - a prior Obsidian task NOT in `scannedIdsAllLists` is RETAINED — it belongs to
//     another device's vault. `scannedIdsAllLists` spans BOTH scheduled and inbox
//     scans so a task that merely moved lists is treated as scanned (dropped here,
//     added by the other list) rather than duplicated;
//   - EXCEPT: any task whose deletion tombstone is at least as new as the task is
//     dropped — a genuine vault deletion propagates; a re-created task (newer
//     lastModified) wins and comes back;
//   - non-Obsidian tasks pass through untouched.
//
// @param {object[]} prevList            current tasks in THIS list
// @param {object[]} scannedList         this scan's tasks for THIS list
// @param {Set<string>} scannedIdsAllLists  string ids across BOTH scan lists
// @param {(old:object)=>object} preserveAppFields  app-only fields to carry forward
// @param {Record<string, string>} [tombstones]  deletedObsidianKeys (id → deletedAt ISO)
// @returns {object[]} merged list
export function mergeObsidianTasks(prevList, scannedList, scannedIdsAllLists, preserveAppFields, tombstones = {}) {
  const prev = prevList || [];
  const nonObsidian = prev.filter(t => t.importSource !== 'obsidian');
  const oldObsidian = prev.filter(t => t.importSource === 'obsidian');
  const oldMap = new Map(oldObsidian.map(t => [String(t.id), t]));
  const merged = (scannedList || []).map(t => {
    const old = oldMap.get(String(t.id));
    return old ? { ...t, ...preserveAppFields(old) } : t;
  }).filter(t => !isObsidianTombstoned(tombstones, String(t.id), t.lastModified));
  const retained = oldObsidian.filter(t =>
    !scannedIdsAllLists.has(String(t.id)) &&
    !isObsidianTombstoned(tombstones, String(t.id), t.lastModified));
  return [...nonObsidian, ...merged, ...retained];
}
