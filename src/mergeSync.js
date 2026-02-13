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

  let localChanged = tasksMerge.localChanged || unschedMerge.localChanged || binMerge.localChanged || recurMerge.localChanged;
  let remoteChanged = tasksMerge.remoteChanged || unschedMerge.remoteChanged || binMerge.remoteChanged || recurMerge.remoteChanged;

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

  return {
    data: {
      tasks: finalTasks,
      unscheduledTasks: finalUnsched,
      recycleBin: reconciledBin,
      recurringTasks: recurMerge.merged,
      completedTaskUids: mergedCompletedUids,
      deletedTaskIds: allDeletedIds,
      // Settings: prefer remote for shared settings, local values are kept per-device
      syncUrl: remoteData.syncUrl !== undefined ? remoteData.syncUrl : localData.syncUrl,
      taskCalendarUrl: remoteData.taskCalendarUrl !== undefined ? remoteData.taskCalendarUrl : localData.taskCalendarUrl,
      routineDefinitions: remoteData.routineDefinitions || localData.routineDefinitions,
      todayRoutines: localData.todayRoutines, // daily state — keep local
      routinesDate: localData.routinesDate,
      minimizedSections: localData.minimizedSections, // UI pref — keep local
      use24HourClock: localData.use24HourClock // device pref — keep local
    },
    localChanged,
    remoteChanged
  };
};
