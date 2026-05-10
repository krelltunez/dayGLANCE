/**
 * Task-level merge sync for cloud sync.
 *
 * Instead of "last write wins" at the whole-dataset level, these functions
 * merge tasks by ID — keeping newer versions when both sides have the same
 * task, preserving tasks that only exist on one side, and respecting
 * tombstones for permanently deleted tasks.
 */

// Last-writer-wins for scalar config fields using per-field updatedAt timestamps.
// Falls back to remote-wins when neither side has a timestamp (legacy payloads).
const pickConfigByTs = (localVal, localTs, remoteVal, remoteTs, defaultVal) => {
  const lTime = localTs ? new Date(localTs).getTime() : 0;
  const rTime = remoteTs ? new Date(remoteTs).getTime() : 0;
  const winner = rTime >= lTime ? remoteVal : localVal;
  return winner !== undefined ? winner : defaultVal;
};
const newerTs = (a, b) => {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
};

// Structural deep equality — key-order independent.
// Used instead of JSON.stringify comparisons to avoid spurious dirty flags
// when two objects have identical content but different key insertion order.
const deepEqual = (a, b) => {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
};

/**
 * Merges two task arrays by ID, preserving local ordering and appending
 * remote-only tasks at the end.
 *
 * @param {Array} localTasks  - Tasks from this device
 * @param {Array} remoteTasks - Tasks from the server
 * @param {Object} deletedIds - Map of task ID → deletion timestamp (tombstones)
 * @returns {{ merged: Array, localChanged: boolean, remoteChanged: boolean }}
 */
export const mergeTaskArrays = (localTasks, remoteTasks, deletedIds, syncHorizon = null) => {
  const remoteMap = new Map(remoteTasks.map(t => [String(t.id), t]));
  const localIds = new Set(localTasks.map(t => String(t.id)));
  let localChanged = false;
  let remoteChanged = false;
  const merged = [];

  // First pass: iterate local tasks in order
  for (const localTask of localTasks) {
    const id = String(localTask.id);
    if (deletedIds[id] && new Date(deletedIds[id]) > new Date(localTask.lastModified || 0)) {
      localChanged = true; // Removed a local task
      continue;
    }
    const remoteTask = remoteMap.get(id);
    if (remoteTask) {
      const localTime = new Date(localTask.lastModified || 0);
      const remoteTime = new Date(remoteTask.lastModified || 0);
      if (remoteTime > localTime) {
        merged.push(remoteTask);
        localChanged = true;
      } else if (localTime > remoteTime) {
        merged.push(localTask);
        remoteChanged = true;
      } else {
        merged.push(localTask); // Equal timestamps — keep local
      }
    } else {
      // Only in local. If the task is older than the sync horizon, the remote's
      // tombstone for it was likely pruned — treat it as a zombie rather than
      // uploading it and resurrecting a deleted task.
      if (syncHorizon && localTask.lastModified && new Date(localTask.lastModified) < syncHorizon) {
        localChanged = true; // drop silently — presumed zombie
      } else {
        merged.push(localTask);
        remoteChanged = true;
      }
    }
  }

  // Second pass: append remote-only tasks
  for (const remoteTask of remoteTasks) {
    const id = String(remoteTask.id);
    if (localIds.has(id)) continue;
    if (deletedIds[id] && new Date(deletedIds[id]) > new Date(remoteTask.lastModified || 0)) {
      remoteChanged = true; // Tell remote this was deleted
      continue;
    }
    merged.push(remoteTask);
    localChanged = true;
  }

  return { merged, localChanged, remoteChanged };
};

/**
 * Merges routine definitions by bucket (day of week), unioning chips by ID
 * and respecting tombstones for deleted chips.
 *
 * Each side's bucket is an array of { id, name } chips.  The merge preserves
 * local ordering and appends any remote-only chips at the end — mirroring the
 * task merge strategy.  Chips present in the deletedChipIds tombstone map are
 * excluded from the merged result.
 *
 * @param {Object} localDefs  - Local routine definitions (bucket → chip[])
 * @param {Object} remoteDefs - Remote routine definitions (bucket → chip[])
 * @param {Object} [deletedChipIds] - Map of chip ID → deletion timestamp (tombstones)
 * @returns {{ merged: Object, localChanged: boolean, remoteChanged: boolean }}
 */
export const mergeRoutineDefinitions = (localDefs, remoteDefs, deletedChipIds = {}) => {
  const allBuckets = new Set([...Object.keys(localDefs), ...Object.keys(remoteDefs)]);
  const merged = {};
  let localChanged = false;
  let remoteChanged = false;

  // Check if a chip is suppressed by its tombstone (deletion must be newer than chip)
  const isTombstoned = (chip) => {
    const deleteTime = deletedChipIds[String(chip.id)];
    if (!deleteTime) return false;
    // If chip has lastModified and it's newer than the deletion, chip wins (resurrects)
    if (chip.lastModified && new Date(chip.lastModified) > new Date(deleteTime)) return false;
    return true;
  };

  for (const bucket of allBuckets) {
    const localChips = localDefs[bucket] || [];
    const remoteChips = remoteDefs[bucket] || [];
    const localIds = new Set(localChips.map(c => String(c.id)));
    const remoteMap = new Map(remoteChips.map(c => [String(c.id), c]));

    // Start with local chips in order, filtering out tombstoned chips
    const bucketMerged = [];
    for (const chip of localChips) {
      if (isTombstoned(chip)) {
        localChanged = true; // chip removed locally
        continue;
      }
      bucketMerged.push(chip);
    }

    // Append remote-only chips (skip tombstoned)
    for (const remoteChip of remoteChips) {
      const id = String(remoteChip.id);
      if (localIds.has(id)) continue;
      if (isTombstoned(remoteChip)) {
        remoteChanged = true; // tell remote this was deleted
        continue;
      }
      bucketMerged.push(remoteChip);
      localChanged = true;
    }

    // Check for local-only chips (remote needs them)
    for (const localChip of localChips) {
      const id = String(localChip.id);
      if (isTombstoned(localChip)) continue; // don't flag deleted chips as needing push
      if (!remoteMap.has(id)) {
        remoteChanged = true;
      }
    }

    merged[bucket] = bucketMerged;
  }

  // Bucket only on remote → local needs it
  for (const bucket of Object.keys(remoteDefs)) {
    if (!localDefs[bucket] && remoteDefs[bucket]?.length > 0) {
      // Only flag if there are non-tombstoned chips
      if (remoteDefs[bucket].some(c => !isTombstoned(c))) {
        localChanged = true;
      }
    }
  }
  // Bucket only on local → remote needs it
  for (const bucket of Object.keys(localDefs)) {
    if (!remoteDefs[bucket] && localDefs[bucket]?.length > 0) {
      if (localDefs[bucket].some(c => !isTombstoned(c))) {
        remoteChanged = true;
      }
    }
  }

  return { merged, localChanged, remoteChanged };
};

/**
 * Merges daily notes by date key, keeping the newer version per day.
 * Entries with { deleted: true } are tombstones representing intentional
 * deletions — they participate in the "newer wins" comparison so that a
 * deletion on one device propagates to the other instead of being
 * resurrected by the non-deleted copy.
 *
 * @param {Object} localNotes  - Local daily notes { "YYYY-MM-DD": { text, lastModified, deleted? } }
 * @param {Object} remoteNotes - Remote daily notes
 * @returns {{ merged: Object, localChanged: boolean, remoteChanged: boolean }}
 */
export const mergeDailyNotes = (localNotes, remoteNotes) => {
  const allDates = new Set([...Object.keys(localNotes), ...Object.keys(remoteNotes)]);
  const merged = {};
  let localChanged = false;
  let remoteChanged = false;

  for (const dateKey of allDates) {
    const local = localNotes[dateKey];
    const remote = remoteNotes[dateKey];

    if (local && !remote) {
      // Only local has it — keep it (remote needs it, even if tombstone)
      merged[dateKey] = local;
      remoteChanged = true;
    } else if (!local && remote) {
      // Only remote has it — local needs it
      merged[dateKey] = remote;
      localChanged = true;
    } else {
      // Both have it — newer wins (tombstones included)
      const localTime = new Date(local.lastModified || 0);
      const remoteTime = new Date(remote.lastModified || 0);
      if (remoteTime > localTime) {
        merged[dateKey] = remote;
        localChanged = true;
      } else if (localTime > remoteTime) {
        merged[dateKey] = local;
        remoteChanged = true;
      } else {
        merged[dateKey] = local; // Equal — keep local
      }
    }
  }

  return { merged, localChanged, remoteChanged };
};

/**
 * Merges habit arrays by ID, preserving local ordering and appending
 * remote-only habits at the end.
 *
 * Habits don't have lastModified timestamps, so when both sides have the
 * same habit we keep the version with the most recent `createdAt` (in
 * practice they'll be identical).  For mutable fields like `archived` and
 * `name`, the version with a newer `createdAt` wins; if equal, local wins.
 *
 * Habits whose ID appears in either side's deletedHabitIds tombstone map
 * are suppressed and the tombstone is propagated to both sides so the
 * deletion persists across devices.
 *
 * @param {Array}  localHabits      - Habits from this device
 * @param {Array}  remoteHabits     - Habits from the server
 * @param {Object} localDeletedIds  - Map of habit ID → deletion timestamp (tombstones)
 * @param {Object} remoteDeletedIds - Map of habit ID → deletion timestamp (tombstones)
 * @returns {{ merged: Array, mergedDeletedIds: Object, localChanged: boolean, remoteChanged: boolean }}
 */
export const mergeHabits = (localHabits, remoteHabits, localDeletedIds = {}, remoteDeletedIds = {}) => {
  // Build the union of tombstones, keeping the most recent deletion timestamp
  const mergedDeletedIds = { ...localDeletedIds };
  for (const [id, ts] of Object.entries(remoteDeletedIds)) {
    if (!mergedDeletedIds[id] || new Date(ts) > new Date(mergedDeletedIds[id])) {
      mergedDeletedIds[id] = ts;
    }
  }

  const remoteMap = new Map(remoteHabits.map(h => [String(h.id), h]));
  const localIds = new Set(localHabits.map(h => String(h.id)));
  let localChanged = false;
  let remoteChanged = false;
  const merged = [];

  for (const localHabit of localHabits) {
    const id = String(localHabit.id);
    // Skip habits suppressed by a tombstone that is newer than the habit itself.
    // If the habit was modified after the deletion (e.g. recreated on another device),
    // the habit's lastModified wins and it is kept — matching task tombstone behaviour.
    if (mergedDeletedIds[id] && new Date(mergedDeletedIds[id]) > new Date(localHabit.lastModified || localHabit.createdAt || 0)) {
      remoteChanged = true; // remote may still have this habit
      continue;
    }
    const remoteHabit = remoteMap.get(id);
    if (remoteHabit) {
      const localTime = new Date(localHabit.lastModified || localHabit.createdAt || 0);
      const remoteTime = new Date(remoteHabit.lastModified || remoteHabit.createdAt || 0);
      if (remoteTime > localTime) {
        merged.push(remoteHabit);
        localChanged = true;
      } else if (localTime > remoteTime) {
        merged.push(localHabit);
        remoteChanged = true;
      } else {
        // Equal — check for field-level differences (e.g. archived on one side)
        if (!deepEqual(localHabit, remoteHabit)) {
          merged.push(localHabit); // keep local
          remoteChanged = true;
        } else {
          merged.push(localHabit);
        }
      }
    } else {
      merged.push(localHabit);
      remoteChanged = true;
    }
  }

  for (const remoteHabit of remoteHabits) {
    const id = String(remoteHabit.id);
    if (mergedDeletedIds[id] && new Date(mergedDeletedIds[id]) > new Date(remoteHabit.lastModified || remoteHabit.createdAt || 0)) {
      localChanged = true; // local may still have this habit
      continue;
    }
    if (!localIds.has(id)) {
      merged.push(remoteHabit);
      localChanged = true;
    }
  }

  // Propagate merged tombstones if either side is missing entries
  if (Object.keys(mergedDeletedIds).length !== Object.keys(localDeletedIds).length) localChanged = true;
  if (Object.keys(mergedDeletedIds).length !== Object.keys(remoteDeletedIds).length) remoteChanged = true;

  return { merged, mergedDeletedIds, localChanged, remoteChanged };
};

/**
 * Merges habit logs by date key.  Within each date, per-habit counts are
 * merged by taking the maximum value (counts only increase within a day).
 *
 * @param {Object} localLogs  - { "YYYY-MM-DD": { habitId: count } }
 * @param {Object} remoteLogs - { "YYYY-MM-DD": { habitId: count } }
 * @param {Object} [localTs]  - { "YYYY-MM-DD:habitId": ISO } timestamps for local entries
 * @param {Object} [remoteTs] - { "YYYY-MM-DD:habitId": ISO } timestamps for remote entries
 * @returns {{ merged: Object, mergedTimestamps: Object, localChanged: boolean, remoteChanged: boolean }}
 */
export const mergeHabitLogs = (localLogs, remoteLogs, localTs = {}, remoteTs = {}) => {
  const allDates = new Set([...Object.keys(localLogs), ...Object.keys(remoteLogs)]);
  const merged = {};
  const mergedTimestamps = { ...localTs };
  let localChanged = false;
  let remoteChanged = false;

  // Merge remote timestamps in (keep the newer of each key).
  for (const [k, v] of Object.entries(remoteTs)) {
    if (!mergedTimestamps[k] || new Date(v) > new Date(mergedTimestamps[k])) {
      mergedTimestamps[k] = v;
    }
  }

  for (const dateKey of allDates) {
    const local = localLogs[dateKey];
    const remote = remoteLogs[dateKey];

    if (local && !remote) {
      merged[dateKey] = local;
      remoteChanged = true;
    } else if (!local && remote) {
      merged[dateKey] = remote;
      localChanged = true;
    } else {
      // Both have it — per-habit merge using timestamps when available, Math.max for legacy.
      const allHabitIds = new Set([...Object.keys(local), ...Object.keys(remote)]);
      const dayMerged = {};
      for (const habitId of allHabitIds) {
        const localCount = local[habitId] !== undefined ? local[habitId] : 0;
        const remoteCount = remote[habitId] !== undefined ? remote[habitId] : 0;
        const tsKey = `${dateKey}:${habitId}`;
        const lTime = localTs[tsKey] ? new Date(localTs[tsKey]).getTime() : 0;
        const rTime = remoteTs[tsKey] ? new Date(remoteTs[tsKey]).getTime() : 0;

        let winner;
        if (lTime > 0 || rTime > 0) {
          // Timestamp-based: last-writer-wins (handles decrements).
          winner = lTime >= rTime ? localCount : remoteCount;
          if (lTime > rTime && localCount !== remoteCount) remoteChanged = true;
          if (rTime > lTime && localCount !== remoteCount) localChanged = true;
        } else {
          // Legacy (no timestamps): take the max to be safe.
          winner = Math.max(localCount, remoteCount);
          if (remoteCount > localCount) localChanged = true;
          if (localCount > remoteCount) remoteChanged = true;
        }
        dayMerged[habitId] = winner;
        if (local[habitId] === undefined && remote[habitId] !== undefined) localChanged = true;
        if (remote[habitId] === undefined && local[habitId] !== undefined) remoteChanged = true;
      }
      merged[dateKey] = dayMerged;
    }
  }

  return { merged, mergedTimestamps, localChanged, remoteChanged };
};

/**
 * Full data-level merge: combines local and remote sync snapshots with
 * per-task granularity.
 *
 * Handles: scheduled tasks, inbox tasks, recycle bin, recurring tasks,
 * completed UIDs, tombstones, and cross-list reconciliation.
 *
 * @param {Object} localData  - Local sync payload .data
 * @param {Object} remoteData - Remote sync payload .data
 * @returns {{ data: Object, localChanged: boolean, remoteChanged: boolean }}
 */
// Prune tombstone entries older than the cutoff date.
const pruneTombstones = (tombstones, cutoff) => {
  if (!cutoff) return tombstones;
  const pruned = {};
  for (const [id, ts] of Object.entries(tombstones)) {
    if (new Date(ts) >= cutoff) pruned[id] = ts;
  }
  return pruned;
};

export const mergeSyncData = (localData, remoteData, retentionDays = 90) => {
  // Combine tombstones (permanently deleted task IDs) from both sides
  const localDeleted = localData.deletedTaskIds || {};
  const remoteDeleted = remoteData.deletedTaskIds || {};
  const allDeletedIds = { ...localDeleted };
  for (const [id, ts] of Object.entries(remoteDeleted)) {
    if (!allDeletedIds[id] || new Date(ts) > new Date(allDeletedIds[id])) {
      allDeletedIds[id] = ts;
    }
  }

  // Fence: any local-only task older than the remote's pruned-before date may
  // have been deleted on another device whose tombstone was already pruned.
  // We suppress resurrection of such tasks rather than uploading them.
  const syncHorizon = remoteData.tombstonePrunedBefore
    ? new Date(remoteData.tombstonePrunedBefore)
    : null;

  // Merge each task list
  const tasksMerge = mergeTaskArrays(localData.tasks || [], remoteData.tasks || [], allDeletedIds, syncHorizon);
  const unschedMerge = mergeTaskArrays(localData.unscheduledTasks || [], remoteData.unscheduledTasks || [], allDeletedIds, syncHorizon);
  const binMerge = mergeTaskArrays(localData.recycleBin || [], remoteData.recycleBin || [], allDeletedIds, syncHorizon);
  const recurMerge = mergeTaskArrays(localData.recurringTasks || [], remoteData.recurringTasks || [], allDeletedIds, syncHorizon);

  // Combine routine chip tombstones from both sides
  const localDeletedChips = localData.deletedRoutineChipIds || {};
  const remoteDeletedChips = remoteData.deletedRoutineChipIds || {};
  const allDeletedChipIds = { ...localDeletedChips };
  for (const [id, ts] of Object.entries(remoteDeletedChips)) {
    if (!allDeletedChipIds[id] || new Date(ts) > new Date(allDeletedChipIds[id])) {
      allDeletedChipIds[id] = ts;
    }
  }

  // Merge routine definitions by bucket (with tombstone support)
  const routineMerge = mergeRoutineDefinitions(localData.routineDefinitions || {}, remoteData.routineDefinitions || {}, allDeletedChipIds);

  // Combine "removed from today" tombstones from both sides.
  // These are separate from deletedRoutineChipIds (which are for permanent
  // definition deletes) — removedTodayRoutineIds tracks routines the user
  // un-checked from Today's Routine without deleting the definition.
  const localRemovedToday = localData.removedTodayRoutineIds || {};
  const remoteRemovedToday = remoteData.removedTodayRoutineIds || {};
  const allRemovedTodayIds = { ...localRemovedToday };
  for (const [id, ts] of Object.entries(remoteRemovedToday)) {
    if (!allRemovedTodayIds[id] || new Date(ts) > new Date(allRemovedTodayIds[id])) {
      allRemovedTodayIds[id] = ts;
    }
  }

  // Build combined tombstone set for todayRoutines merge: permanent chip
  // deletes + today-specific removals both suppress a routine from reappearing.
  const todayRoutineTombstones = { ...allDeletedChipIds, ...allRemovedTodayIds };

  // Merge today's selected routines across devices.
  // Only union by ID when both sides are on the same date — if dates differ,
  // keep the newer date's routines (avoids mixing yesterday's with today's).
  const localRoutinesDate = localData.routinesDate || '';
  const remoteRoutinesDate = remoteData.routinesDate || '';
  let todayRoutinesMerge;
  let mergedRoutinesDate;
  if (localRoutinesDate === remoteRoutinesDate) {
    todayRoutinesMerge = mergeTaskArrays(localData.todayRoutines || [], remoteData.todayRoutines || [], todayRoutineTombstones, syncHorizon);
    mergedRoutinesDate = localRoutinesDate;
  } else if (localRoutinesDate > remoteRoutinesDate) {
    todayRoutinesMerge = { merged: localData.todayRoutines || [], localChanged: false, remoteChanged: true };
    mergedRoutinesDate = localRoutinesDate;
  } else {
    todayRoutinesMerge = { merged: remoteData.todayRoutines || [], localChanged: true, remoteChanged: false };
    mergedRoutinesDate = remoteRoutinesDate;
  }

  // Merge routine completions: union both sides, keeping only entries that match mergedRoutinesDate.
  // If the dates differed above, the losing side's completions are dropped (stale day).
  const localCompletions = localData.routineCompletions || {};
  const remoteCompletions = remoteData.routineCompletions || {};
  const mergedCompletions = {};
  for (const [id, date] of Object.entries(localCompletions)) {
    if (date === mergedRoutinesDate) mergedCompletions[id] = date;
  }
  for (const [id, date] of Object.entries(remoteCompletions)) {
    if (date === mergedRoutinesDate) mergedCompletions[id] = date;
  }

  // Merge daily notes by date key
  const dailyNotesMerge = mergeDailyNotes(localData.dailyNotes || {}, remoteData.dailyNotes || {});

  // Merge habits and habit logs
  const localDeletedHabitIds = localData.deletedHabitIds || {};
  const remoteDeletedHabitIds = remoteData.deletedHabitIds || {};
  const habitsMerge = mergeHabits(localData.habits || [], remoteData.habits || [], localDeletedHabitIds, remoteDeletedHabitIds);
  const habitLogsMerge = mergeHabitLogs(
    localData.habitLogs || {},
    remoteData.habitLogs || {},
    localData.habitLogTimestamps || {},
    remoteData.habitLogTimestamps || {}
  );

  // Detect routine completion changes: did the merge add completions that one side was missing?
  const localCompletionsFiltered = Object.fromEntries(Object.entries(localCompletions).filter(([, d]) => d === mergedRoutinesDate));
  const remoteCompletionsFiltered = Object.fromEntries(Object.entries(remoteCompletions).filter(([, d]) => d === mergedRoutinesDate));
  const completionsLocalChanged = Object.keys(mergedCompletions).some(id => !(id in localCompletionsFiltered));
  const completionsRemoteChanged = Object.keys(mergedCompletions).some(id => !(id in remoteCompletionsFiltered));

  let localChanged = tasksMerge.localChanged || unschedMerge.localChanged || binMerge.localChanged || recurMerge.localChanged || routineMerge.localChanged || todayRoutinesMerge.localChanged || dailyNotesMerge.localChanged || habitsMerge.localChanged || habitLogsMerge.localChanged || completionsLocalChanged;
  let remoteChanged = tasksMerge.remoteChanged || unschedMerge.remoteChanged || binMerge.remoteChanged || recurMerge.remoteChanged || routineMerge.remoteChanged || todayRoutinesMerge.remoteChanged || dailyNotesMerge.remoteChanged || habitsMerge.remoteChanged || habitLogsMerge.remoteChanged || completionsRemoteChanged;

  // Reconcile cross-list conflicts: task active on one device, in recycle bin on other
  const recycledMap = new Map(binMerge.merged.map(t => [String(t.id), t]));
  const reconciledTasks = tasksMerge.merged.filter(t => {
    const recycled = recycledMap.get(String(t.id));
    if (!recycled) return true;
    return new Date(t.lastModified || 0) > new Date(recycled.deletedAt || recycled.lastModified || 0);
  });
  const reconciledUnsched = unschedMerge.merged.filter(t => {
    const recycled = recycledMap.get(String(t.id));
    if (!recycled) return true;
    return new Date(t.lastModified || 0) > new Date(recycled.deletedAt || recycled.lastModified || 0);
  });
  const keptActiveIds = new Set([
    ...reconciledTasks.map(t => String(t.id)),
    ...reconciledUnsched.map(t => String(t.id))
  ]);
  const reconciledBin = binMerge.merged.filter(t => !keptActiveIds.has(String(t.id)));

  // Also reconcile tasks that moved between scheduled ↔ inbox across devices
  const inScheduled = new Map(reconciledTasks.map(t => [String(t.id), t]));
  const inInbox = new Map(reconciledUnsched.map(t => [String(t.id), t]));
  const crossListIds = new Set();
  for (const [id] of inScheduled) {
    if (inInbox.has(id)) crossListIds.add(id);
  }
  let finalTasks = reconciledTasks;
  let finalUnsched = reconciledUnsched;

  // Apply the ordering from whichever side last explicitly reordered their inbox.
  // Without this, reordering tasks in a project card would never propagate via sync
  // because individual task lastModified timestamps don't change on reorder.
  const localOrderTs = new Date(localData.unscheduledOrderTimestamp || 0);
  const remoteOrderTs = new Date(remoteData.unscheduledOrderTimestamp || 0);
  if (remoteOrderTs > localOrderTs && remoteData.unscheduledTasks?.length) {
    const remoteOrderIds = remoteData.unscheduledTasks.map(t => String(t.id));
    const unschedById = new Map(finalUnsched.map(t => [String(t.id), t]));
    const ordered = [];
    for (const id of remoteOrderIds) {
      if (unschedById.has(id)) ordered.push(unschedById.get(id));
    }
    // append tasks not present in remote order (new local-only tasks)
    const remoteOrderSet = new Set(remoteOrderIds);
    for (const t of finalUnsched) {
      if (!remoteOrderSet.has(String(t.id))) ordered.push(t);
    }
    finalUnsched = ordered;
    localChanged = true;
  }

  if (crossListIds.size > 0) {
    const keepInScheduled = new Set();
    const keepInInbox = new Set();
    for (const id of crossListIds) {
      const sTask = inScheduled.get(id);
      const iTask = inInbox.get(id);
      if (new Date(sTask.lastModified || 0) >= new Date(iTask.lastModified || 0)) {
        keepInScheduled.add(id);
      } else {
        keepInInbox.add(id);
      }
    }
    finalTasks = reconciledTasks.filter(t => !crossListIds.has(String(t.id)) || keepInScheduled.has(String(t.id)));
    finalUnsched = reconciledUnsched.filter(t => !crossListIds.has(String(t.id)) || keepInInbox.has(String(t.id)));
  }

  // Union of completed task UIDs, pruned to the retention window.
  // UIDs are "icalUid::YYYY-MM-DD"; entries with a parseable date outside the
  // retention window are dropped so the set doesn't grow unboundedly.
  const uidCutoff = retentionDays > 0 ? new Date(Date.now() - retentionDays * 86400000) : null;
  const mergedCompletedUids = [...new Set([
    ...(localData.completedTaskUids || []),
    ...(remoteData.completedTaskUids || [])
  ])].filter(uid => {
    if (!uidCutoff) return true;
    const m = uid.match(/::(\d{4}-\d{2}-\d{2})$/);
    return !m || new Date(m[1]) >= uidCutoff;
  });
  if (mergedCompletedUids.length !== (localData.completedTaskUids || []).length) localChanged = true;
  if (mergedCompletedUids.length !== (remoteData.completedTaskUids || []).length) remoteChanged = true;

  // Combine frame tombstones from both sides
  const localDeletedFrames = localData.deletedFrameIds || {};
  const remoteDeletedFrames = remoteData.deletedFrameIds || {};
  const allDeletedFrameIds = { ...localDeletedFrames };
  for (const [id, ts] of Object.entries(remoteDeletedFrames)) {
    if (!allDeletedFrameIds[id] || new Date(ts) > new Date(allDeletedFrameIds[id])) {
      allDeletedFrameIds[id] = ts;
    }
  }

  // Check if tombstones changed
  if (Object.keys(allDeletedIds).length !== Object.keys(localDeleted).length) localChanged = true;
  if (Object.keys(allDeletedIds).length !== Object.keys(remoteDeleted).length) remoteChanged = true;
  if (Object.keys(allDeletedChipIds).length !== Object.keys(localDeletedChips).length) localChanged = true;
  if (Object.keys(allDeletedChipIds).length !== Object.keys(remoteDeletedChips).length) remoteChanged = true;
  if (Object.keys(allRemovedTodayIds).length !== Object.keys(localRemovedToday).length) localChanged = true;
  if (Object.keys(allRemovedTodayIds).length !== Object.keys(remoteRemovedToday).length) remoteChanged = true;
  if (Object.keys(allDeletedFrameIds).length !== Object.keys(localDeletedFrames).length) localChanged = true;
  if (Object.keys(allDeletedFrameIds).length !== Object.keys(remoteDeletedFrames).length) remoteChanged = true;

  // Merge GTD frames by ID, respecting tombstones
  const localFrames = localData.gtdFrames || [];
  const remoteFrames = remoteData.gtdFrames || [];
  const localFrameIds = new Set(localFrames.map(f => String(f.id)));
  const remoteFrameMap = new Map(remoteFrames.map(f => [String(f.id), f]));
  const mergedFrames = [];

  // Keep local frames that aren't tombstoned, using lastModified to resolve conflicts.
  // When both sides differ but neither has a lastModified timestamp (legacy frames),
  // keep local rather than blindly preferring remote.
  for (const localFrame of localFrames) {
    const id = String(localFrame.id);
    if (allDeletedFrameIds[id] && new Date(allDeletedFrameIds[id]) > new Date(localFrame.lastModified || 0)) {
      localChanged = true; // frame was deleted (tombstone is newer)
      continue;
    }
    const remoteFrame = remoteFrameMap.get(id);
    if (remoteFrame && !deepEqual(localFrame, remoteFrame)) {
      const localTime = new Date(localFrame.lastModified || 0);
      const remoteTime = new Date(remoteFrame.lastModified || 0);
      if (remoteTime > localTime) {
        mergedFrames.push(remoteFrame);
        localChanged = true;
      } else {
        // Local is newer, or neither side has a timestamp — keep local.
        mergedFrames.push(localFrame);
        remoteChanged = true;
      }
    } else {
      mergedFrames.push(localFrame);
      if (!remoteFrame) remoteChanged = true; // local-only → remote needs it
    }
  }
  // Append remote-only frames that aren't tombstoned
  for (const remoteFrame of remoteFrames) {
    const id = String(remoteFrame.id);
    if (localFrameIds.has(id)) continue;
    if (allDeletedFrameIds[id] && new Date(allDeletedFrameIds[id]) > new Date(remoteFrame.lastModified || 0)) {
      remoteChanged = true; // tell remote this was deleted
      continue;
    }
    mergedFrames.push(remoteFrame);
    localChanged = true;
  }

  // habitsEnabled / routinesEnabled: last-writer-wins via per-field timestamps.
  const localHabitsEnabled = localData.habitsEnabled !== undefined ? localData.habitsEnabled : true;
  const remoteHabitsEnabled = remoteData.habitsEnabled !== undefined ? remoteData.habitsEnabled : true;
  const mergedHabitsEnabled = pickConfigByTs(localHabitsEnabled, localData.habitsEnabledUpdatedAt, remoteHabitsEnabled, remoteData.habitsEnabledUpdatedAt, true);
  const mergedHabitsEnabledUpdatedAt = newerTs(localData.habitsEnabledUpdatedAt, remoteData.habitsEnabledUpdatedAt);
  if (mergedHabitsEnabled !== localHabitsEnabled) localChanged = true;
  if (mergedHabitsEnabled !== remoteHabitsEnabled) remoteChanged = true;

  const localRoutinesEnabled = localData.routinesEnabled !== undefined ? localData.routinesEnabled : true;
  const remoteRoutinesEnabled = remoteData.routinesEnabled !== undefined ? remoteData.routinesEnabled : true;
  const mergedRoutinesEnabled = pickConfigByTs(localRoutinesEnabled, localData.routinesEnabledUpdatedAt, remoteRoutinesEnabled, remoteData.routinesEnabledUpdatedAt, true);
  const mergedRoutinesEnabledUpdatedAt = newerTs(localData.routinesEnabledUpdatedAt, remoteData.routinesEnabledUpdatedAt);
  if (mergedRoutinesEnabled !== localRoutinesEnabled) localChanged = true;
  if (mergedRoutinesEnabled !== remoteRoutinesEnabled) remoteChanged = true;

  // Combine goal and project tombstones from both sides
  const localDeletedGoalIds = localData.deletedGoalIds || {};
  const remoteDeletedGoalIds = remoteData.deletedGoalIds || {};
  const allDeletedGoalIds = { ...localDeletedGoalIds };
  for (const [id, ts] of Object.entries(remoteDeletedGoalIds)) {
    if (!allDeletedGoalIds[id] || new Date(ts) > new Date(allDeletedGoalIds[id])) {
      allDeletedGoalIds[id] = ts;
    }
  }
  const localDeletedProjectIds = localData.deletedProjectIds || {};
  const remoteDeletedProjectIds = remoteData.deletedProjectIds || {};
  const allDeletedProjectIds = { ...localDeletedProjectIds };
  for (const [id, ts] of Object.entries(remoteDeletedProjectIds)) {
    if (!allDeletedProjectIds[id] || new Date(ts) > new Date(allDeletedProjectIds[id])) {
      allDeletedProjectIds[id] = ts;
    }
  }

  // Merge goals by ID using updatedAt for conflict resolution (same strategy as frames)
  const localGoals = localData.goals || [];
  const remoteGoals = remoteData.goals || [];
  const localGoalIds = new Set(localGoals.map(g => String(g.id)));
  const remoteGoalMap = new Map(remoteGoals.map(g => [String(g.id), g]));
  const mergedGoals = [];
  for (const localGoal of localGoals) {
    const id = String(localGoal.id);
    if (allDeletedGoalIds[id] && new Date(allDeletedGoalIds[id]) > new Date(localGoal.updatedAt || 0)) {
      localChanged = true; // goal was deleted
      continue;
    }
    const remoteGoal = remoteGoalMap.get(id);
    if (remoteGoal && !deepEqual(localGoal, remoteGoal)) {
      const localTime = new Date(localGoal.updatedAt || 0);
      const remoteTime = new Date(remoteGoal.updatedAt || 0);
      if (remoteTime > localTime) {
        mergedGoals.push(remoteGoal);
        localChanged = true;
      } else {
        mergedGoals.push(localGoal);
        if (remoteTime < localTime) remoteChanged = true;
      }
    } else {
      mergedGoals.push(localGoal);
      if (!remoteGoal) remoteChanged = true;
    }
  }
  for (const remoteGoal of remoteGoals) {
    if (localGoalIds.has(String(remoteGoal.id))) continue;
    if (allDeletedGoalIds[String(remoteGoal.id)] && new Date(allDeletedGoalIds[String(remoteGoal.id)]) > new Date(remoteGoal.updatedAt || 0)) {
      remoteChanged = true; // tell remote this was deleted
      continue;
    }
    mergedGoals.push(remoteGoal);
    localChanged = true;
  }

  // Merge projects by ID using updatedAt for conflict resolution (same strategy as frames)
  const localProjects = localData.projects || [];
  const remoteProjects = remoteData.projects || [];
  const localProjectIds = new Set(localProjects.map(p => String(p.id)));
  const remoteProjectMap = new Map(remoteProjects.map(p => [String(p.id), p]));
  const mergedProjects = [];
  for (const localProject of localProjects) {
    const id = String(localProject.id);
    if (allDeletedProjectIds[id] && new Date(allDeletedProjectIds[id]) > new Date(localProject.updatedAt || 0)) {
      localChanged = true; // project was deleted
      continue;
    }
    const remoteProject = remoteProjectMap.get(id);
    if (remoteProject && !deepEqual(localProject, remoteProject)) {
      const localTime = new Date(localProject.updatedAt || 0);
      const remoteTime = new Date(remoteProject.updatedAt || 0);
      if (remoteTime > localTime) {
        mergedProjects.push(remoteProject);
        localChanged = true;
      } else {
        mergedProjects.push(localProject);
        if (remoteTime < localTime) remoteChanged = true;
      }
    } else {
      mergedProjects.push(localProject);
      if (!remoteProject) remoteChanged = true;
    }
  }
  for (const remoteProject of remoteProjects) {
    if (localProjectIds.has(String(remoteProject.id))) continue;
    if (allDeletedProjectIds[String(remoteProject.id)] && new Date(allDeletedProjectIds[String(remoteProject.id)]) > new Date(remoteProject.updatedAt || 0)) {
      remoteChanged = true; // tell remote this was deleted
      continue;
    }
    mergedProjects.push(remoteProject);
    localChanged = true;
  }

  // goalsProjectsEnabled: last-writer-wins
  const localGoalsProjectsEnabled = localData.goalsProjectsEnabled !== undefined ? localData.goalsProjectsEnabled : false;
  const remoteGoalsProjectsEnabled = remoteData.goalsProjectsEnabled !== undefined ? remoteData.goalsProjectsEnabled : false;
  const mergedGoalsProjectsEnabled = pickConfigByTs(localGoalsProjectsEnabled, localData.goalsProjectsEnabledUpdatedAt, remoteGoalsProjectsEnabled, remoteData.goalsProjectsEnabledUpdatedAt, false);
  const mergedGoalsProjectsEnabledUpdatedAt = newerTs(localData.goalsProjectsEnabledUpdatedAt, remoteData.goalsProjectsEnabledUpdatedAt);
  if (mergedGoalsProjectsEnabled !== localGoalsProjectsEnabled) localChanged = true;
  if (mergedGoalsProjectsEnabled !== remoteGoalsProjectsEnabled) remoteChanged = true;

  // obsidianConfig change detection (merge happens in return object via pickConfigByTs above)
  const mergedObsidianConfig = pickConfigByTs(localData.obsidianConfig, localData.obsidianConfigUpdatedAt, remoteData.obsidianConfig, remoteData.obsidianConfigUpdatedAt, null);
  if (JSON.stringify(mergedObsidianConfig) !== JSON.stringify(localData.obsidianConfig ?? null)) localChanged = true;
  if (JSON.stringify(mergedObsidianConfig) !== JSON.stringify(remoteData.obsidianConfig ?? null)) remoteChanged = true;

  // Detect calendar URL changes so the sync cycle completes even when URLs
  // are the only difference between local and remote.
  const mergedSyncUrl = remoteData.syncUrl || localData.syncUrl || '';
  const mergedTaskCalUrl = remoteData.taskCalendarUrl || localData.taskCalendarUrl || '';
  if (mergedSyncUrl !== (localData.syncUrl || '')) localChanged = true;
  if (mergedSyncUrl !== (remoteData.syncUrl || '')) remoteChanged = true;
  if (mergedTaskCalUrl !== (localData.taskCalendarUrl || '')) localChanged = true;
  if (mergedTaskCalUrl !== (remoteData.taskCalendarUrl || '')) remoteChanged = true;

  // Prune tombstones older than the retention window so they don't grow forever.
  // Pruning happens after merge resolution so stale tombstones still participate
  // in the current merge cycle before being discarded.
  const tombstoneCutoff = retentionDays > 0 ? new Date(Date.now() - retentionDays * 86400000) : null;
  // The merged fence is the later of the two sides' pruned-before dates so
  // downstream devices know the most aggressive point up to which tombstones
  // may be missing.
  const localFence = localData.tombstonePrunedBefore ? new Date(localData.tombstonePrunedBefore) : null;
  const remoteFence = remoteData.tombstonePrunedBefore ? new Date(remoteData.tombstonePrunedBefore) : null;
  const mergedFence = localFence && remoteFence
    ? (localFence > remoteFence ? localFence : remoteFence)
    : (localFence || remoteFence || tombstoneCutoff);
  const mergedTombstonePrunedBefore = mergedFence ? mergedFence.toISOString() : null;

  const prunedDeletedIds = pruneTombstones(allDeletedIds, tombstoneCutoff);
  const prunedDeletedChipIds = pruneTombstones(allDeletedChipIds, tombstoneCutoff);
  const prunedDeletedFrameIds = pruneTombstones(allDeletedFrameIds, tombstoneCutoff);
  const prunedRemovedTodayIds = pruneTombstones(allRemovedTodayIds, tombstoneCutoff);
  const prunedDeletedHabitIds = pruneTombstones(habitsMerge.mergedDeletedIds, tombstoneCutoff);
  const prunedDeletedGoalIds = pruneTombstones(allDeletedGoalIds, tombstoneCutoff);
  const prunedDeletedProjectIds = pruneTombstones(allDeletedProjectIds, tombstoneCutoff);

  return {
    data: {
      tasks: finalTasks,
      unscheduledTasks: finalUnsched,
      unscheduledOrderTimestamp: remoteOrderTs > localOrderTs
        ? remoteData.unscheduledOrderTimestamp
        : localData.unscheduledOrderTimestamp,
      recycleBin: reconciledBin,
      recurringTasks: recurMerge.merged,
      completedTaskUids: mergedCompletedUids,
      deletedTaskIds: prunedDeletedIds,
      deletedRoutineChipIds: prunedDeletedChipIds,
      deletedFrameIds: prunedDeletedFrameIds,
      removedTodayRoutineIds: prunedRemovedTodayIds,
      // Calendar URLs: prefer non-empty value (don't let a device without URLs configured wipe one that has them).
      // If both are non-empty and differ, prefer remote so a URL change propagates across devices.
      syncUrl: (remoteData.syncUrl || localData.syncUrl || ''),
      taskCalendarUrl: (remoteData.taskCalendarUrl || localData.taskCalendarUrl || ''),
      routineDefinitions: routineMerge.merged,
      todayRoutines: todayRoutinesMerge.merged,
      routinesDate: mergedRoutinesDate,
      routineCompletions: mergedCompletions,
      dailyNotes: dailyNotesMerge.merged,
      habits: habitsMerge.merged,
      deletedHabitIds: prunedDeletedHabitIds,
      habitLogs: habitLogsMerge.merged,
      habitLogTimestamps: habitLogsMerge.mergedTimestamps,
      habitsEnabled: mergedHabitsEnabled,
      habitsEnabledUpdatedAt: mergedHabitsEnabledUpdatedAt,
      routinesEnabled: mergedRoutinesEnabled,
      routinesEnabledUpdatedAt: mergedRoutinesEnabledUpdatedAt,
      gtdFrames: mergedFrames,
      goals: mergedGoals,
      deletedGoalIds: prunedDeletedGoalIds,
      projects: mergedProjects,
      deletedProjectIds: prunedDeletedProjectIds,
      goalsProjectsEnabled: mergedGoalsProjectsEnabled,
      goalsProjectsEnabledUpdatedAt: mergedGoalsProjectsEnabledUpdatedAt,
      // obsidianConfig: last-writer-wins via per-field timestamp.
      // On Android/iOS, applyRemoteData only applies the non-native fields.
      obsidianConfig: pickConfigByTs(localData.obsidianConfig, localData.obsidianConfigUpdatedAt, remoteData.obsidianConfig, remoteData.obsidianConfigUpdatedAt, null),
      obsidianConfigUpdatedAt: newerTs(localData.obsidianConfigUpdatedAt, remoteData.obsidianConfigUpdatedAt),
      minimizedSections: localData.minimizedSections, // UI pref — keep local
      use24HourClock: localData.use24HourClock, // device pref — keep local
      tombstonePrunedBefore: mergedTombstonePrunedBefore,
    },
    localChanged,
    remoteChanged
  };
};
