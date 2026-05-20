import { dateToString } from '../utils/taskUtils.js';

export default function useDataPersistence({
  // setters for loadData
  setTasks, setUnscheduledTasks, setRecycleBin, setRecurringTasks,
  setDarkMode, setSyncUrl, setTaskCalendarUrl, setCompletedTaskUids,
  setDailyNotes, setRoutineDefinitions, setTodayRoutines, setRoutinesDate,
  setRemovedTodayRoutineIds, setHabits, setHabitLogs, setHabitsEnabled,
  setRoutinesEnabled, setGoals, setProjects, setGoalsProjectsEnabled, setDataLoaded,
  setUnscheduledOrderTimestamp,
  // values for saveData
  tasks, unscheduledTasks, recycleBin, recurringTasks, todayRoutines,
  darkMode, syncUrl, taskCalendarUrl, syncRetentionDays, completedTaskUids,
  routineDefinitions, routinesDate, removedTodayRoutineIds,
  habits, habitLogs, habitsEnabled, routinesEnabled, gtdFrames,
  goals, projects, goalsProjectsEnabled,
  unscheduledOrderTimestamp,
  cloudSyncConfig, cloudSyncInitialDoneRef, suppressTimestampRef,
  setUndoToast,
}) {
  // Stamp lastModified on tasks that changed since last save
  const stampTaskTimestamps = (currentTasks, storageKey) => {
    if (suppressTimestampRef.current) return currentTasks;
    const now = new Date().toISOString();
    let prev;
    try { prev = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { prev = []; }
    const prevMap = new Map(prev.map(t => [String(t.id), t]));
    return currentTasks.map(t => {
      const id = String(t.id);
      const prevTask = prevMap.get(id);
      if (prevTask && prevTask.lastModified) {
        const { lastModified: _a, ...prevRest } = prevTask;
        const { lastModified: _b, ...currRest } = t;
        if (JSON.stringify(prevRest) === JSON.stringify(currRest)) {
          return { ...t, lastModified: prevTask.lastModified };
        }
      }
      // If the task is new to localStorage but already carries a lastModified
      // (e.g. a fresh Obsidian import stamped with epoch, or a task arriving
      // via cloud sync), preserve it so cloud merge doesn't treat a passive
      // re-import as a newer edit than real user changes on other devices.
      if (!prevTask && t.lastModified) return t;
      // Task is new or changed — stamp it now so other devices see the update
      return { ...t, lastModified: now };
    });
  };

  const loadData = () => {
    try {
      const tasksData = localStorage.getItem('day-planner-tasks');
      const unscheduledData = localStorage.getItem('day-planner-unscheduled');
      const recycleBinData = localStorage.getItem('day-planner-recycle-bin');
      const darkModeData = localStorage.getItem('day-planner-darkmode');
      const syncUrlData = localStorage.getItem('day-planner-sync-url');
      const taskCalendarUrlData = localStorage.getItem('day-planner-task-calendar-url');
      const completedTaskUidsData = localStorage.getItem('day-planner-task-completed-uids');
      const recurringTasksData = localStorage.getItem('day-planner-recurring-tasks');
      const dailyNotesData = localStorage.getItem('day-planner-daily-notes');
      const welcomeDismissed = localStorage.getItem('welcomeDismissed') === 'true';

      // Parse existing data and normalize defaults so localStorage and React
      // state stay in sync.  Without this write-back, stampTaskTimestamps detects
      // the added defaults as "changes" and re-stamps lastModified on every task
      // at app load, making stale local tasks win during the initial cloud merge.
      const parsedTasks = tasksData ? JSON.parse(tasksData).map(t => ({
        ...t,
        notes: t.notes ?? '',
        subtasks: t.subtasks ?? []
      })) : [];
      if (tasksData) localStorage.setItem('day-planner-tasks', JSON.stringify(parsedTasks));

      const parsedUnscheduled = unscheduledData ? JSON.parse(unscheduledData).map(t => ({
        ...t,
        notes: t.notes ?? '',
        subtasks: t.subtasks ?? []
      })) : [];
      if (unscheduledData) localStorage.setItem('day-planner-unscheduled', JSON.stringify(parsedUnscheduled));

      // Load tasks normally; preserve any _native events already queued by Effect B
      // if it raced ahead of loadData in React's state update batch.
      setTasks(prev => [...parsedTasks, ...prev.filter(t => t._native)]);
      setUnscheduledTasks(parsedUnscheduled.filter(t => !t.imported));
      if (recycleBinData) {
        setRecycleBin(JSON.parse(recycleBinData));
      }

      if (darkModeData) {
        setDarkMode(JSON.parse(darkModeData));
      }
      if (syncUrlData) {
        // Migrate from JSON-stringified format (e.g. "\"https://...\"") to plain string
        setSyncUrl(syncUrlData.startsWith('"') ? JSON.parse(syncUrlData) : syncUrlData);
      }
      if (taskCalendarUrlData) {
        setTaskCalendarUrl(taskCalendarUrlData.startsWith('"') ? JSON.parse(taskCalendarUrlData) : taskCalendarUrlData);
      }
      if (completedTaskUidsData) {
        setCompletedTaskUids(new Set(JSON.parse(completedTaskUidsData)));
      }
      if (dailyNotesData) {
        try { setDailyNotes(JSON.parse(dailyNotesData)); } catch {}
      }
      if (recurringTasksData) {
        setRecurringTasks(JSON.parse(recurringTasksData));
      }

      // Load routines
      const routineDefsData = localStorage.getItem('day-planner-routine-definitions');
      const todayRoutinesData = localStorage.getItem('day-planner-today-routines');
      const routinesDateData = localStorage.getItem('day-planner-routines-date');
      if (routineDefsData) {
        setRoutineDefinitions(JSON.parse(routineDefsData));
      }
      const todayStr = dateToString(new Date());
      if (routinesDateData && routinesDateData === todayStr && todayRoutinesData) {
        setTodayRoutines(JSON.parse(todayRoutinesData));
        setRoutinesDate(todayStr);
        const removedData = localStorage.getItem('day-planner-removed-today-routine-ids');
        if (removedData) setRemovedTodayRoutineIds(JSON.parse(removedData));
      } else {
        // Auto-clear if different day
        setTodayRoutines([]);
        setRoutinesDate(todayStr);
        setRemovedTodayRoutineIds({});
        localStorage.removeItem('day-planner-removed-today-routine-ids');
      }

      // Load habit tracking data
      const habitsData = localStorage.getItem('day-planner-habits');
      if (habitsData) {
        const parsedHabits = JSON.parse(habitsData).map(h =>
          h.scheduledDays ? h : { ...h, scheduledDays: [0, 1, 2, 3, 4, 5, 6] }
        );
        localStorage.setItem('day-planner-habits', JSON.stringify(parsedHabits));
        setHabits(parsedHabits);
      }
      const habitLogsData = localStorage.getItem('day-planner-habit-logs');
      if (habitLogsData) setHabitLogs(JSON.parse(habitLogsData));
      const habitsEnabledData = localStorage.getItem('day-planner-habits-enabled');
      if (habitsEnabledData !== null) setHabitsEnabled(JSON.parse(habitsEnabledData));
      const routinesEnabledData = localStorage.getItem('day-planner-routines-enabled');
      if (routinesEnabledData !== null) setRoutinesEnabled(JSON.parse(routinesEnabledData));

      // Load unscheduled task order timestamp
      const orderTsData = localStorage.getItem('day-planner-unscheduled-order-ts');
      if (orderTsData) setUnscheduledOrderTimestamp(orderTsData);

      // Load goals and projects
      const goalsData = localStorage.getItem('day-planner-goals');
      if (goalsData) setGoals(JSON.parse(goalsData));
      const projectsData = localStorage.getItem('day-planner-projects');
      if (projectsData) setProjects(JSON.parse(projectsData));
      const goalsProjectsEnabledData = localStorage.getItem('day-planner-goals-projects-enabled');
      if (goalsProjectsEnabledData !== null) setGoalsProjectsEnabled(JSON.parse(goalsProjectsEnabledData));
    } catch (error) {
      console.log('No existing data found, starting fresh');
    }
    setDataLoaded(true);
  };

  const saveData = () => {
    // Write each key individually so a QuotaExceededError on one key does not
    // leave earlier keys updated and later keys stale (partial-write corruption).
    let quotaHit = false;
    const safeSet = (key, value) => {
      try {
        localStorage.setItem(key, value);
      } catch (e) {
        console.error('Error saving data:', key, e);
        if (!quotaHit && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
          quotaHit = true;
          setUndoToast({ message: 'Storage full — some data may not have saved. Clear old data or free browser storage.', actionable: false });
        }
      }
    };

    const stampedTasks = stampTaskTimestamps(tasks.filter(t => !t._native), 'day-planner-tasks');
    const stampedUnscheduled = stampTaskTimestamps(unscheduledTasks, 'day-planner-unscheduled');
    const stampedRecycleBin = stampTaskTimestamps(recycleBin, 'day-planner-recycle-bin');
    const stampedRecurring = stampTaskTimestamps(recurringTasks, 'day-planner-recurring-tasks');
    const stampedTodayRoutines = stampTaskTimestamps(todayRoutines, 'day-planner-today-routines');

    // Prune completedTaskUids to the retention window to prevent unbounded growth.
    // UIDs have the format "icalUid::YYYY-MM-DD"; discard entries whose date is
    // older than syncRetentionDays (same window used for task import).
    const uidCutoff = syncRetentionDays > 0 ? new Date(Date.now() - syncRetentionDays * 86400000) : null;
    const prunedUids = [...completedTaskUids].filter(uid => {
      if (!uidCutoff) return true;
      const m = uid.match(/::(\d{4}-\d{2}-\d{2})$/);
      return !m || new Date(m[1]) >= uidCutoff;
    });

    safeSet('day-planner-tasks', JSON.stringify(stampedTasks));
    safeSet('day-planner-unscheduled', JSON.stringify(stampedUnscheduled));
    safeSet('day-planner-recycle-bin', JSON.stringify(stampedRecycleBin));
    safeSet('day-planner-darkmode', JSON.stringify(darkMode));
    safeSet('day-planner-sync-url', syncUrl);
    safeSet('day-planner-task-calendar-url', taskCalendarUrl);
    safeSet('day-planner-sync-retention-days', JSON.stringify(syncRetentionDays));
    safeSet('day-planner-task-completed-uids', JSON.stringify(prunedUids));
    safeSet('day-planner-recurring-tasks', JSON.stringify(stampedRecurring));
    safeSet('day-planner-routine-definitions', JSON.stringify(routineDefinitions));
    safeSet('day-planner-today-routines', JSON.stringify(stampedTodayRoutines));
    safeSet('day-planner-routines-date', routinesDate);
    safeSet('day-planner-removed-today-routine-ids', JSON.stringify(removedTodayRoutineIds));
    safeSet('day-planner-habits', JSON.stringify(habits));
    safeSet('day-planner-habit-logs', JSON.stringify(habitLogs));
    safeSet('day-planner-habits-enabled', JSON.stringify(habitsEnabled));
    safeSet('day-planner-routines-enabled', JSON.stringify(routinesEnabled));
    safeSet('day-planner-gtd-frames', JSON.stringify(gtdFrames));
    safeSet('day-planner-goals', JSON.stringify(goals));
    safeSet('day-planner-projects', JSON.stringify(projects));
    safeSet('day-planner-goals-projects-enabled', JSON.stringify(goalsProjectsEnabled));
    if (unscheduledOrderTimestamp) safeSet('day-planner-unscheduled-order-ts', unscheduledOrderTimestamp);
    // Only update local-modified after initial cloud sync has run,
    // otherwise the initial loadData() sets it to "now" and overwrites remote
    if (!cloudSyncConfig?.enabled || cloudSyncInitialDoneRef.current) {
      safeSet('day-planner-cloud-sync-local-modified', new Date().toISOString());
    }
  };

  return { loadData, saveData, stampTaskTimestamps };
}
