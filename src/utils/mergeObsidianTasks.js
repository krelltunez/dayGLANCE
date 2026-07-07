// Merge an Obsidian scan into one task list (scheduled or inbox) WITHOUT deleting
// Obsidian tasks the scan didn't produce — the task-side counterpart to
// mergeObsidianDailyNotes, and the same fix for the same measured loop.
//
// Replacing the Obsidian tasks with only the local scan deletes any Obsidian task
// this device's vault lacks; another device re-adds it, and the vault ping-pongs
// (`[pull] DELETE tasks:obsidian-… ↔ new tasks:obsidian-…`). Merge instead:
//   - a scanned task overrides its prior copy (fresh markdown), with app-only
//     fields (archived/completedAt/projectId/deadline/assignedUserSyncIds) carried
//     forward via `preserveAppFields`;
//   - a prior Obsidian task NOT in `scannedIdsAllLists` is RETAINED — it belongs to
//     another device's vault (or is outside this scan). `scannedIdsAllLists` spans
//     BOTH scheduled and inbox scans so a task that merely moved lists is treated
//     as scanned (dropped here, added by the other list) rather than duplicated.
//   - non-Obsidian tasks pass through untouched.
//
// @param {object[]} prevList            current tasks in THIS list
// @param {object[]} scannedList         this scan's tasks for THIS list
// @param {Set<string>} scannedIdsAllLists  string ids across BOTH scan lists
// @param {(old:object)=>object} preserveAppFields  app-only fields to carry forward
// @returns {object[]} merged list
export function mergeObsidianTasks(prevList, scannedList, scannedIdsAllLists, preserveAppFields) {
  const prev = prevList || [];
  const nonObsidian = prev.filter(t => t.importSource !== 'obsidian');
  const oldObsidian = prev.filter(t => t.importSource === 'obsidian');
  const oldMap = new Map(oldObsidian.map(t => [String(t.id), t]));
  const merged = (scannedList || []).map(t => {
    const old = oldMap.get(String(t.id));
    return old ? { ...t, ...preserveAppFields(old) } : t;
  });
  const retained = oldObsidian.filter(t => !scannedIdsAllLists.has(String(t.id)));
  return [...nonObsidian, ...merged, ...retained];
}
