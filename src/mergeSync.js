/**
 * Task-level merge sync for cloud sync.
 *
 * Instead of "last write wins" at the whole-dataset level, these functions
 * merge tasks by ID — keeping newer versions when both sides have the same
 * task, preserving tasks that only exist on one side, and respecting
 * tombstones for permanently deleted tasks.
 */

/**
 * Merges two task arrays by ID, preserving local ordering and appending
 * remote-only tasks at the end.
 *
 * @param {Array} localTasks  - Tasks from this device
 * @param {Array} remoteTasks - Tasks from the server
 * @param {Object} deletedIds - Map of task ID → deletion timestamp (tombstones)
 * @returns {{ merged: Array, localChanged: boolean, remoteChanged: boolean }}
 */
export const mergeTaskArrays = (localTasks, remoteTasks, deletedIds) => {
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
      // Only in local — keep it (new local task)
      merged.push(localTask);
      remoteChanged = true;
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
 * @param {Array} localHabits  - Habits from this device
 * @param {Array} remoteHabits - Habits from the server
 * @returns {{ merged: Array, localChanged: boolean, remoteChanged: boolean }}
 */
export const mergeHabits = (localHabits, remoteHabits) => {
  const remoteMap = new Map(remoteHabits.map(h => [String(h.id), h]));
  const localIds = new Set(localHabits.map(h => String(h.id)));
  let localChanged = false;
  let remoteChanged = false;
  const merged = [];

  for (const localHabit of localHabits) {
    const id = String(localHabit.id);
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
        if (JSON.stringify(localHabit) !== JSON.stringify(remoteHabit)) {
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
    if (!localIds.has(String(remoteHabit.id))) {
      merged.push(remoteHabit);
      localChanged = true;
    }
  }

  return { merged, localChanged, remoteChanged };
};

/**
 * Merges habit logs by date key.  Within each date, per-habit counts are
 * merged by taking the maximum value (counts only increase within a day).
 *
 * @param {Object} localLogs  - { "YYYY-MM-DD": { habitId: count } }
 * @param {Object} remoteLogs - { "YYYY-MM-DD": { habitId: count } }
 * @returns {{ merged: Object, localChanged: boolean, remoteChanged: boolean }}
 */
export const mergeHabitLogs = (localLogs, remoteLogs) => {
  const allDates = new Set([...Object.keys(localLogs), ...Object.keys(remoteLogs)]);
  const merged = {};
  let localChanged = false;
  let remoteChanged = false;

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
      // Both have it — merge per habit, taking the max count
      const allHabitIds = new Set([...Object.keys(local), ...Object.keys(remote)]);
      const dayMerged = {};
      for (const habitId of allHabitIds) {
        const localCount = local[habitId] || 0;
        const remoteCount = remote[habitId] || 0;
        dayMerged[habitId] = Math.max(localCount, remoteCount);
        if (remoteCount > localCount) localChanged = true;
        if (localCount > remoteCount) remoteChanged = true;
        if (!local[habitId] && remote[habitId]) localChanged = true;
        if (local[habitId] && !remote[habitId]) remoteChanged = true;
      }
      merged[dateKey] = dayMerged;
    }
  }

  return { merged, localChanged, remoteChanged };
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
export const mergeSyncData = (localData, remoteData) => {
  // Combine tombstones (permanently deleted task IDs) from both sides
  const localDeleted = localData.deletedTaskIds || {};
  const remoteDeleted = remoteData.deletedTaskIds || {};
  const allDeletedIds = { ...localDeleted };
  for (const [id, ts] of Object.entries(remoteDeleted)) {
    if (!allDeletedIds[id] || new Date(ts) > new Date(allDeletedIds[id])) {
      allDeletedIds[id] = ts;
    }
  }

  // Merge each task list
  const tasksMerge = mergeTaskArrays(localData.tasks || [], remoteData.tasks || [], allDeletedIds);
  const unschedMerge = mergeTaskArrays(localData.unscheduledTasks || [], remoteData.unscheduledTasks || [], allDeletedIds);
  const binMerge = mergeTaskArrays(localData.recycleBin || [], remoteData.recycleBin || [], allDeletedIds);
  const recurMerge = mergeTaskArrays(localData.recurringTasks || [], remoteData.recurringTasks || [], allDeletedIds);

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
    todayRoutinesMerge = mergeTaskArrays(localData.todayRoutines || [], remoteData.todayRoutines || [], todayRoutineTombstones);
    mergedRoutinesDate = localRoutinesDate;
  } else if (localRoutinesDate > remoteRoutinesDate) {
    todayRoutinesMerge = { merged: localData.todayRoutines || [], localChanged: false, remoteChanged: true };
    mergedRoutinesDate = localRoutinesDate;
  } else {
    todayRoutinesMerge = { merged: remoteData.todayRoutines || [], localChanged: true, remoteChanged: false };
    mergedRoutinesDate = remoteRoutinesDate;
  }

  // Merge daily notes by date key
  const dailyNotesMerge = mergeDailyNotes(localData.dailyNotes || {}, remoteData.dailyNotes || {});

  // Merge habits and habit logs
  const habitsMerge = mergeHabits(localData.habits || [], remoteData.habits || []);
  const habitLogsMerge = mergeHabitLogs(localData.habitLogs || {}, remoteData.habitLogs || {});

  let localChanged = tasksMerge.localChanged || unschedMerge.localChanged || binMerge.localChanged || recurMerge.localChanged || routineMerge.localChanged || todayRoutinesMerge.localChanged || dailyNotesMerge.localChanged || habitsMerge.localChanged || habitLogsMerge.localChanged;
  let remoteChanged = tasksMerge.remoteChanged || unschedMerge.remoteChanged || binMerge.remoteChanged || recurMerge.remoteChanged || routineMerge.remoteChanged || todayRoutinesMerge.remoteChanged || dailyNotesMerge.remoteChanged || habitsMerge.remoteChanged || habitLogsMerge.remoteChanged;

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

  // Union of completed task UIDs
  const mergedCompletedUids = [...new Set([
    ...(localData.completedTaskUids || []),
    ...(remoteData.completedTaskUids || [])
  ])];
  if (mergedCompletedUids.length !== (localData.completedTaskUids || []).length) localChanged = true;
  if (mergedCompletedUids.length !== (remoteData.completedTaskUids || []).length) remoteChanged = true;

  // Check if tombstones changed
  if (Object.keys(allDeletedIds).length !== Object.keys(localDeleted).length) localChanged = true;
  if (Object.keys(allDeletedIds).length !== Object.keys(remoteDeleted).length) remoteChanged = true;
  if (Object.keys(allDeletedChipIds).length !== Object.keys(localDeletedChips).length) localChanged = true;
  if (Object.keys(allDeletedChipIds).length !== Object.keys(remoteDeletedChips).length) remoteChanged = true;
  if (Object.keys(allRemovedTodayIds).length !== Object.keys(localRemovedToday).length) localChanged = true;
  if (Object.keys(allRemovedTodayIds).length !== Object.keys(remoteRemovedToday).length) remoteChanged = true;
  if (Object.keys(allDeletedFrameIds).length !== Object.keys(localDeletedFrames).length) localChanged = true;
  if (Object.keys(allDeletedFrameIds).length !== Object.keys(remoteDeletedFrames).length) remoteChanged = true;

  // Combine frame tombstones from both sides
  const localDeletedFrames = localData.deletedFrameIds || {};
  const remoteDeletedFrames = remoteData.deletedFrameIds || {};
  const allDeletedFrameIds = { ...localDeletedFrames };
  for (const [id, ts] of Object.entries(remoteDeletedFrames)) {
    if (!allDeletedFrameIds[id] || new Date(ts) > new Date(allDeletedFrameIds[id])) {
      allDeletedFrameIds[id] = ts;
    }
  }

  // Merge GTD frames by ID, respecting tombstones
  const localFrames = localData.gtdFrames || [];
  const remoteFrames = remoteData.gtdFrames || [];
  const localFrameIds = new Set(localFrames.map(f => String(f.id)));
  const remoteFrameMap = new Map(remoteFrames.map(f => [String(f.id), f]));
  const mergedFrames = [];

  // Keep local frames that aren't tombstoned, preferring remote version if it differs
  for (const localFrame of localFrames) {
    const id = String(localFrame.id);
    if (allDeletedFrameIds[id]) {
      localChanged = true; // frame was deleted
      continue;
    }
    const remoteFrame = remoteFrameMap.get(id);
    if (remoteFrame && JSON.stringify(localFrame) !== JSON.stringify(remoteFrame)) {
      mergedFrames.push(remoteFrame);
      localChanged = true;
    } else {
      mergedFrames.push(localFrame);
      if (!remoteFrame) remoteChanged = true; // local-only → remote needs it
    }
  }
  // Append remote-only frames that aren't tombstoned
  for (const remoteFrame of remoteFrames) {
    const id = String(remoteFrame.id);
    if (localFrameIds.has(id)) continue;
    if (allDeletedFrameIds[id]) {
      remoteChanged = true; // tell remote this was deleted
      continue;
    }
    mergedFrames.push(remoteFrame);
    localChanged = true;
  }

  // Check if habitsEnabled setting differs
  const localHabitsEnabled = localData.habitsEnabled !== undefined ? localData.habitsEnabled : true;
  const remoteHabitsEnabled = remoteData.habitsEnabled !== undefined ? remoteData.habitsEnabled : true;
  if (localHabitsEnabled !== remoteHabitsEnabled) {
    // Prefer remote (propagates the toggle across devices)
    localChanged = true;
    remoteChanged = false; // remote already has it
  }

  // Check if routinesEnabled setting differs
  const localRoutinesEnabled = localData.routinesEnabled !== undefined ? localData.routinesEnabled : true;
  const remoteRoutinesEnabled = remoteData.routinesEnabled !== undefined ? remoteData.routinesEnabled : true;
  if (localRoutinesEnabled !== remoteRoutinesEnabled) {
    localChanged = true;
    remoteChanged = false;
  }

  return {
    data: {
      tasks: finalTasks,
      unscheduledTasks: finalUnsched,
      recycleBin: reconciledBin,
      recurringTasks: recurMerge.merged,
      completedTaskUids: mergedCompletedUids,
      deletedTaskIds: allDeletedIds,
      deletedRoutineChipIds: allDeletedChipIds,
      deletedFrameIds: allDeletedFrameIds,
      removedTodayRoutineIds: allRemovedTodayIds,
      // Settings: prefer remote for shared settings, local values are kept per-device
      syncUrl: remoteData.syncUrl !== undefined ? remoteData.syncUrl : localData.syncUrl,
      taskCalendarUrl: remoteData.taskCalendarUrl !== undefined ? remoteData.taskCalendarUrl : localData.taskCalendarUrl,
      routineDefinitions: routineMerge.merged,
      todayRoutines: todayRoutinesMerge.merged,
      routinesDate: mergedRoutinesDate,
      dailyNotes: dailyNotesMerge.merged,
      habits: habitsMerge.merged,
      habitLogs: habitLogsMerge.merged,
      habitsEnabled: remoteData.habitsEnabled !== undefined ? remoteData.habitsEnabled : localData.habitsEnabled,
      routinesEnabled: remoteData.routinesEnabled !== undefined ? remoteData.routinesEnabled : localData.routinesEnabled,
      gtdFrames: mergedFrames,
      minimizedSections: localData.minimizedSections, // UI pref — keep local
      use24HourClock: localData.use24HourClock // device pref — keep local
    },
    localChanged,
    remoteChanged
  };
};
