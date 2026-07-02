import { useEffect } from 'react';
import { schedulePush as scheduleVaultPush } from '../sync/dirtyTracker.js';

// The tray popup must never write to localStorage — it holds a snapshot of
// state as of the last reload and would overwrite fresher main-window data.
const isTrayMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('tray');

export default function useSaveOnChange({
  saveData, checkConflicts,
  dataLoaded,
  suppressClearPendingRef, suppressCloudUploadRef, suppressTimestampRef,
  tasks, unscheduledTasks, recycleBin, taskCalendarUrl, syncUrl, syncRetentionDays,
  completedTaskUids, recurringTasks, routineDefinitions, todayRoutines, routinesDate,
  removedTodayRoutineIds, habits, habitLogs, habitsEnabled, routinesEnabled, gtdFrames,
  goals, projects, areas, goalsProjectsEnabled,
}) {
  useEffect(() => {
    if (isTrayMode || !dataLoaded) return;
    saveData();
    checkConflicts();
    // Push-on-write to the GLANCEvault DB transport (debounced 3 s, vault-only).
    // Off-safe no-op when the vault is disabled; skipped while applying remote
    // data (suppressCloudUpload) so a pulled change never bounces back as a push.
    if (!suppressCloudUploadRef.current) scheduleVaultPush();
    // After the first save pass following applyEngineData, clear the suppress flags
    // so subsequent user actions (e.g. completing a task) get properly stamped and uploaded.
    if (suppressClearPendingRef.current) {
      suppressClearPendingRef.current = false;
      // Use microtask so the upload-debounce effect (which runs next in this batch)
      // still sees suppress=true for THIS pass, but clears before the next user action.
      queueMicrotask(() => {
        suppressCloudUploadRef.current = false;
        suppressTimestampRef.current = false;
      });
    }
    // Intentionally keyed on the DATA slices only: this effect should fire when
    // saved data changes, not when saveData/checkConflicts identities change (they
    // are called, not dependencies, and would over-trigger). The suppress* refs are
    // stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoaded, tasks, unscheduledTasks, recycleBin, taskCalendarUrl, syncUrl, syncRetentionDays, completedTaskUids, recurringTasks, routineDefinitions, todayRoutines, routinesDate, removedTodayRoutineIds, habits, habitLogs, habitsEnabled, routinesEnabled, gtdFrames, goals, projects, areas, goalsProjectsEnabled]);
}
