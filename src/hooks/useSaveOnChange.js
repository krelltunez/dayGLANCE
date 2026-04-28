import { useEffect } from 'react';

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
  goals, projects, goalsProjectsEnabled,
}) {
  useEffect(() => {
    if (isTrayMode || !dataLoaded) return;
    saveData();
    checkConflicts();
    // After the first save pass following applyRemoteData, clear the suppress flags
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
  }, [dataLoaded, tasks, unscheduledTasks, recycleBin, taskCalendarUrl, syncUrl, syncRetentionDays, completedTaskUids, recurringTasks, routineDefinitions, todayRoutines, routinesDate, removedTodayRoutineIds, habits, habitLogs, habitsEnabled, routinesEnabled, gtdFrames, goals, projects, goalsProjectsEnabled]);
}
