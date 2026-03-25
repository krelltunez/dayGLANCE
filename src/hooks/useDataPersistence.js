import { dateToString } from '../utils/taskUtils.js';

export default function useDataPersistence({
  // setters for loadData
  setTasks, setUnscheduledTasks, setRecycleBin, setRecurringTasks,
  setDarkMode, setSyncUrl, setTaskCalendarUrl, setCompletedTaskUids,
  setDailyNotes, setRoutineDefinitions, setTodayRoutines, setRoutinesDate,
  setRemovedTodayRoutineIds, setHabits, setHabitLogs, setHabitsEnabled,
  setRoutinesEnabled, setDataLoaded,
  // values for saveData
  tasks, unscheduledTasks, recycleBin, recurringTasks, todayRoutines,
  darkMode, syncUrl, taskCalendarUrl, syncRetentionDays, completedTaskUids,
  routineDefinitions, routinesDate, removedTodayRoutineIds,
  habits, habitLogs, habitsEnabled, routinesEnabled, gtdFrames,
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

      // Filter out imported tasks when checking if empty (only count user tasks)
      const userScheduledTasks = parsedTasks.filter(t => !t.imported);
      const userInboxTasks = parsedUnscheduled;

      // Show example tasks if both inbox and scheduled are empty (no saved tasks at all)
      const shouldShowExamples = userScheduledTasks.length === 0 && userInboxTasks.length === 0;

      if (shouldShowExamples) {
        // Create example tasks
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

        // Place example tasks around the current time so they're visible without scrolling
        const currentHour = today.getHours();
        const baseHour = Math.max(0, Math.min(20, currentHour - 1)); // 1 hour before now, clamped
        const toTime = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

        const exampleScheduledTasks = [
          {
            id: 'example-scheduled-1',
            title: 'Example: Morning standup #work',
            startTime: toTime(baseHour, 0),
            duration: 30,
            date: todayStr,
            color: 'bg-blue-500',
            completed: false,
            isExample: true,
            notes: '',
            subtasks: []
          },
          {
            id: 'example-scheduled-2',
            title: 'Example: Deep work session #focus',
            startTime: toTime(baseHour + 1, 0),
            duration: 120,
            date: todayStr,
            color: 'bg-purple-500',
            completed: false,
            isExample: true,
            notes: 'Tasks can have notes! Try adding a link:\nhttps://example.com',
            subtasks: [
              { id: 'sub-1', title: 'Break down the problem', completed: true },
              { id: 'sub-2', title: 'Write initial code', completed: false },
              { id: 'sub-3', title: 'Test and refine', completed: false }
            ]
          },
          {
            id: 'example-allday-1',
            title: 'Example: Team offsite #work',
            startTime: '00:00',
            duration: 60,
            date: tomorrowStr,
            color: 'bg-green-500',
            completed: false,
            isAllDay: true,
            isExample: true,
            notes: '',
            subtasks: []
          }
        ];

        const exampleInboxTasks = [
          {
            id: 'example-inbox-1',
            title: 'Example: Review quarterly report #work #review',
            color: 'bg-amber-500',
            completed: false,
            priority: 0,
            isExample: true,
            notes: '',
            subtasks: []
          },
          {
            id: 'example-inbox-2',
            title: 'Example: Pay taxes #admin',
            color: 'bg-rose-500',
            completed: false,
            priority: 0,
            deadline: todayStr,
            isExample: true,
            notes: '',
            subtasks: []
          },
          {
            id: 'example-inbox-3',
            title: 'Example: Call mom #personal',
            color: 'bg-cyan-500',
            completed: true,
            priority: 0,
            isExample: true,
            notes: '',
            subtasks: []
          }
        ];

        const exampleRecycleBin = [
          {
            id: 'example-deleted-1',
            title: 'Example: Restore me!',
            color: 'bg-gray-500',
            completed: false,
            deletedAt: new Date().toISOString(),
            _deletedFrom: 'inbox',
            isExample: true,
            notes: '',
            subtasks: []
          }
        ];

        const exampleRecurringTasks = [
          {
            id: 'example-recurring-1',
            title: 'Example: TPS reports #work',
            startTime: toTime(baseHour, 30),
            duration: 30,
            color: 'bg-teal-500',
            isAllDay: false,
            notes: '',
            subtasks: [],
            recurrence: { type: 'daily', startDate: todayStr },
            completedDates: [],
            exceptions: {},
            isExample: true
          }
        ];

        // Keep any imported tasks, add example tasks
        setTasks([...parsedTasks.filter(t => t.imported), ...exampleScheduledTasks]);
        setUnscheduledTasks(exampleInboxTasks);
        setRecycleBin(exampleRecycleBin);
        setRecurringTasks(exampleRecurringTasks);
      } else {
        // Load normally
        setTasks(parsedTasks);
        setUnscheduledTasks(parsedUnscheduled.filter(t => !t.imported));
        if (recycleBinData) {
          setRecycleBin(JSON.parse(recycleBinData));
        }
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
      if (!shouldShowExamples) {
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
      }

      // Load habit tracking data
      const habitsData = localStorage.getItem('day-planner-habits');
      if (habitsData) setHabits(JSON.parse(habitsData));
      const habitLogsData = localStorage.getItem('day-planner-habit-logs');
      if (habitLogsData) setHabitLogs(JSON.parse(habitLogsData));
      const habitsEnabledData = localStorage.getItem('day-planner-habits-enabled');
      if (habitsEnabledData !== null) setHabitsEnabled(JSON.parse(habitsEnabledData));
      const routinesEnabledData = localStorage.getItem('day-planner-routines-enabled');
      if (routinesEnabledData !== null) setRoutinesEnabled(JSON.parse(routinesEnabledData));
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
    // Only update local-modified after initial cloud sync has run,
    // otherwise the initial loadData() sets it to "now" and overwrites remote
    if (!cloudSyncConfig?.enabled || cloudSyncInitialDoneRef.current) {
      safeSet('day-planner-cloud-sync-local-modified', new Date().toISOString());
    }
  };

  return { loadData, saveData };
}
