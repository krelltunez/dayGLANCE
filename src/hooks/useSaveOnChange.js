import { useEffect } from 'react';

export default function useSaveOnChange({
  saveData, checkConflicts,
  dataLoaded,
  suppressClearPendingRef, suppressCloudUploadRef, suppressTimestampRef,
  tasks, unscheduledTasks, recycleBin, taskCalendarUrl, syncUrl, syncRetentionDays,
  completedTaskUids, recurringTasks, routineDefinitions, todayRoutines, routinesDate,
  removedTodayRoutineIds, habits, habitLogs, habitsEnabled, routinesEnabled, gtdFrames,
}) {
  useEffect(() => {
    if (!dataLoaded) return; // Don't overwrite localStorage before initial load
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
  }, [dataLoaded, tasks, unscheduledTasks, recycleBin, taskCalendarUrl, syncUrl, syncRetentionDays, completedTaskUids, recurringTasks, routineDefinitions, todayRoutines, routinesDate, removedTodayRoutineIds, habits, habitLogs, habitsEnabled, routinesEnabled, gtdFrames]);
}
