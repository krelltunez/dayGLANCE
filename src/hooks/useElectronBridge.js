import { useEffect, useRef, useState } from 'react';
import { taskColorToHex } from '../utils/colorUtils.js';
import { buildStreamDeckState, timeToMinutes } from '../utils/streamDeckPayload.js';
import { dispatchBackgroundAction } from '../utils/trayActionDispatch.js';
import {
  MSG_DAY_FOCUS_START,
  MSG_DAY_FOCUS_TIMER_START,
  MSG_DAY_FOCUS_STOP,
  MSG_DAY_FOCUS_SKIP,
  MSG_DAY_FOCUS_SET_DURATION,
  MSG_DAY_TASK_COMPLETE,
  MSG_DAY_HABIT_INCREMENT,
  MSG_DAY_ROUTINE_COMPLETE,
  MSG_DAY_FOCUS_DISMISS_STATS,
  MSG_DAY_HG_START,
  MSG_DAY_HG_TIMER_START,
  MSG_DAY_HG_STOP,
  MSG_DAY_HG_SKIP,
  MSG_DAY_HG_SET_DURATION,
  MSG_DAY_HG_COMPLETE,
  MSG_DAY_HG_TASK_COMPLETE,
} from '../../electron/protocol';
import { isTrayMode } from '../utils/trayMode.js';

// Pushes a lightweight state snapshot to the Electron WebSocket server
// (ws://localhost:7892) whenever app state changes, and routes incoming
// commands from connected clients (e.g. Stream Deck plugin) back to the app.
export default function useElectronBridge({
  todayAgenda,
  currentTime,
  tasks,
  expandedRecurringTasks,
  isVisibleForUser = () => true,
  todayHGSessions,
  focusModeAvailable,
  showFocusMode,
  focusPhase,
  focusTimerSeconds,
  focusTimerRunning,
  focusCycleCount,
  focusWorkMinutes,
  focusBreakMinutes,
  focusLongBreakMinutes,
  focusShowSettings,
  focusShowStats,
  focusBlockTasks,
  focusCompletedTasks,
  enterFocusModeRef,
  exitFocusModeRef,
  startFocusTimerRef,
  dismissFocusStats,
  skipFocusPhase,
  setFocusWorkMinutes,
  setFocusBreakMinutes,
  setFocusLongBreakMinutes,
  focusCompleteTask,
  hgCompleteTask,
  toggleComplete,
  // HyperGLANCE
  showHyperGlanceMode,
  hyperGlanceProjectId,
  hyperGlanceSessionDate,
  hgTimerSeconds,
  hgTimerRunning,
  hgTimerPhase,
  hgWorkMinutes,
  hgBreakMinutes,
  hgLongBreakMinutes,
  hgCycleCount,
  hgShowSettings,
  hgCompleted,
  startHyperGlanceTimer,
  skipHyperGlancePhase,
  setHgWorkMinutes,
  setHgBreakMinutes,
  setHgLongBreakMinutes,
  enterHyperGlanceMode,
  exitHyperGlanceMode,
  setHgCompleted,
  // Habits
  activeHabits,
  getTodayHabitCount,
  habitsEnabled,
  incrementHabit,
  setHabitCount,
  // Routines
  todayRoutines,
  routineCompletions,
  toggleRoutineCompletion,
  // Settings
  use24HourClock,
  // Goals
  goals,
  projects,
  unscheduledTasks,
  setUnscheduledTasks,
  setTasks,
  moveToRecycleBin,
  clearDeadline,
  goalsProjectsEnabled,
  goToDate,
  scrollToHour,
  // Reminders
  activeReminders,
  snoozeReminder,
  dismissReminder,
  // Reschedule modal
  setShowRescheduleModal,
  setRescheduleResults,
  setRescheduleError,
  // Routines / frames / habit modal (opened from tray navigate)
  openRoutinesDashboardRef,
  setShowFramesModal,
  setFramesModalTab,
  setEditingFrame,
  setShowHabitModal,
}) {
  const [pushTrigger, setPushTrigger] = useState(0);

  const skipFocusPhaseRef = useRef(skipFocusPhase);
  const dismissFocusStatsRef = useRef(dismissFocusStats);
  const focusCompleteTaskRef = useRef(focusCompleteTask);
  const hgCompleteTaskRef = useRef(hgCompleteTask);
  const toggleCompleteRef = useRef(toggleComplete);
  const incrementHabitRef = useRef(incrementHabit);
  const toggleRoutineCompletionRef = useRef(toggleRoutineCompletion);
  const setFocusWorkMinutesRef = useRef(setFocusWorkMinutes);
  const setFocusBreakMinutesRef = useRef(setFocusBreakMinutes);
  const setFocusLongBreakMinutesRef = useRef(setFocusLongBreakMinutes);
  const startHyperGlanceTimerRef = useRef(startHyperGlanceTimer);
  const skipHyperGlancePhaseRef = useRef(skipHyperGlancePhase);
  const enterHyperGlanceModeRef = useRef(enterHyperGlanceMode);
  const exitHyperGlanceModeRef = useRef(exitHyperGlanceMode);
  const setHgWorkMinutesRef = useRef(setHgWorkMinutes);
  const setHgBreakMinutesRef = useRef(setHgBreakMinutes);
  const setHgLongBreakMinutesRef = useRef(setHgLongBreakMinutes);
  const setHgCompletedRef = useRef(setHgCompleted);
  const setUnscheduledTasksRef = useRef(setUnscheduledTasks);
  const setTasksRef = useRef(setTasks);
  const moveToRecycleBinRef = useRef(moveToRecycleBin);
  const clearDeadlineRef = useRef(clearDeadline);
  const scrollToHourRef = useRef(scrollToHour);
  const setHabitCountRef = useRef(setHabitCount);
  const snoozeReminderRef = useRef(snoozeReminder);
  const dismissReminderRef = useRef(dismissReminder);
  const setShowRescheduleModalRef = useRef(setShowRescheduleModal);
  const setRescheduleResultsRef = useRef(setRescheduleResults);
  const setRescheduleErrorRef = useRef(setRescheduleError);
  const setShowFramesModalRef = useRef(setShowFramesModal);
  const setFramesModalTabRef = useRef(setFramesModalTab);
  const setEditingFrameRef = useRef(setEditingFrame);
  const setShowHabitModalRef = useRef(setShowHabitModal);
  skipFocusPhaseRef.current = skipFocusPhase;
  dismissFocusStatsRef.current = dismissFocusStats;
  focusCompleteTaskRef.current = focusCompleteTask;
  hgCompleteTaskRef.current = hgCompleteTask;
  toggleCompleteRef.current = toggleComplete;
  incrementHabitRef.current = incrementHabit;
  toggleRoutineCompletionRef.current = toggleRoutineCompletion;
  setFocusWorkMinutesRef.current = setFocusWorkMinutes;
  setFocusBreakMinutesRef.current = setFocusBreakMinutes;
  setFocusLongBreakMinutesRef.current = setFocusLongBreakMinutes;
  startHyperGlanceTimerRef.current = startHyperGlanceTimer;
  skipHyperGlancePhaseRef.current = skipHyperGlancePhase;
  enterHyperGlanceModeRef.current = enterHyperGlanceMode;
  exitHyperGlanceModeRef.current = exitHyperGlanceMode;
  setHgWorkMinutesRef.current = setHgWorkMinutes;
  setHgBreakMinutesRef.current = setHgBreakMinutes;
  setHgLongBreakMinutesRef.current = setHgLongBreakMinutes;
  setHgCompletedRef.current = setHgCompleted;
  setUnscheduledTasksRef.current = setUnscheduledTasks;
  setTasksRef.current = setTasks;
  moveToRecycleBinRef.current = moveToRecycleBin;
  clearDeadlineRef.current = clearDeadline;
  scrollToHourRef.current = scrollToHour;
  setHabitCountRef.current = setHabitCount;
  snoozeReminderRef.current = snoozeReminder;
  dismissReminderRef.current = dismissReminder;
  setShowRescheduleModalRef.current = setShowRescheduleModal;
  setRescheduleResultsRef.current = setRescheduleResults;
  setRescheduleErrorRef.current = setRescheduleError;
  setShowFramesModalRef.current = setShowFramesModal;
  setFramesModalTabRef.current = setFramesModalTab;
  setEditingFrameRef.current = setEditingFrame;
  setShowHabitModalRef.current = setShowHabitModal;

  // Subscribe to commands from WebSocket clients once on mount.
  useEffect(() => {
    if (!window.electronAPI) return;
    const unsubscribe = window.electronAPI.onCommand((cmd) => {
      if (!cmd?.type) return;
      switch (cmd.type) {
        case MSG_DAY_FOCUS_START:
          enterFocusModeRef.current?.();
          break;
        case MSG_DAY_FOCUS_TIMER_START:
          startFocusTimerRef.current?.();
          break;
        case MSG_DAY_FOCUS_STOP:
          exitFocusModeRef.current?.();
          break;
        case MSG_DAY_FOCUS_SKIP:
          skipFocusPhaseRef.current?.();
          break;
        case MSG_DAY_FOCUS_SET_DURATION:
          if (cmd.workMinutes !== undefined) setFocusWorkMinutesRef.current?.(Math.max(1, Math.min(120, cmd.workMinutes)));
          if (cmd.breakMinutes !== undefined) setFocusBreakMinutesRef.current?.(Math.max(1, Math.min(60, cmd.breakMinutes)));
          if (cmd.longBreakMinutes !== undefined) setFocusLongBreakMinutesRef.current?.(Math.max(1, Math.min(60, cmd.longBreakMinutes)));
          break;
        case MSG_DAY_FOCUS_DISMISS_STATS:
          dismissFocusStatsRef.current?.();
          break;
        case MSG_DAY_TASK_COMPLETE:
          if (cmd.id) focusCompleteTaskRef.current?.(cmd.id);
          break;
        case MSG_DAY_HABIT_INCREMENT:
          if (cmd.id) incrementHabitRef.current?.(cmd.id);
          break;
        case MSG_DAY_ROUTINE_COMPLETE:
          if (cmd.id) toggleRoutineCompletionRef.current?.(cmd.id);
          break;
        case MSG_DAY_HG_START:
          if (cmd.projectId && cmd.date) enterHyperGlanceModeRef.current?.(cmd.projectId, cmd.date);
          break;
        case MSG_DAY_HG_TIMER_START:
          startHyperGlanceTimerRef.current?.();
          break;
        case MSG_DAY_HG_STOP:
          exitHyperGlanceModeRef.current?.();
          break;
        case MSG_DAY_HG_SKIP:
          skipHyperGlancePhaseRef.current?.();
          break;
        case MSG_DAY_HG_SET_DURATION:
          if (cmd.workMinutes !== undefined) setHgWorkMinutesRef.current?.(Math.max(1, Math.min(120, cmd.workMinutes)));
          if (cmd.breakMinutes !== undefined) setHgBreakMinutesRef.current?.(Math.max(1, Math.min(60, cmd.breakMinutes)));
          if (cmd.longBreakMinutes !== undefined) setHgLongBreakMinutesRef.current?.(Math.max(1, Math.min(60, cmd.longBreakMinutes)));
          break;
        case MSG_DAY_HG_COMPLETE:
          setHgCompletedRef.current?.(true);
          exitHyperGlanceModeRef.current?.();
          break;
        case MSG_DAY_HG_TASK_COMPLETE:
          if (cmd.id) hgCompleteTaskRef.current?.(cmd.id);
          break;
      }
    });
    return unsubscribe;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When a Stream Deck plugin client connects before state has been pushed,
  // the server sends ws:request-state — re-trigger the push effect.
  useEffect(() => {
    if (!window.electronAPI?.onRequestState) return;
    return window.electronAPI.onRequestState(() => setPushTrigger(n => n + 1));
  }, []);

  // Handle navigation requests forwarded from the tray popup (main window only).
  useEffect(() => {
    if (isTrayMode || !window.electronAPI?.onTrayNavigate) return;
    return window.electronAPI.onTrayNavigate((payload) => {
      if (!payload?.action) return;
      const { action, date, projectId } = payload;
      if (action === 'goto-task' || action === 'goto-date') {
        if (date) goToDate(date);
        // Scroll to the task's time slot; delay so the calendar re-renders first
        // and the useTimelineScroll auto-scroll-to-current-time effect fires before us.
        if (payload.startTime) {
          setTimeout(() => scrollToHourRef.current?.(payload.startTime, true), 350);
        }
      } else if (action === 'focus-mode') {
        enterFocusModeRef.current?.();
      } else if (action === 'hyperglance') {
        if (projectId && date) enterHyperGlanceModeRef.current?.(projectId, date);
      } else if (action === 'reschedule') {
        setShowRescheduleModalRef.current?.(true);
        setRescheduleResultsRef.current?.(null);
        setRescheduleErrorRef.current?.('');
      } else if (action === 'routines') {
        openRoutinesDashboardRef?.current?.();
      } else if (action === 'habits') {
        setShowHabitModalRef.current?.(true);
      } else if (action === 'schedule-inbox') {
        setShowFramesModalRef.current?.(true);
        setFramesModalTabRef.current?.('schedule');
        setEditingFrameRef.current?.(null);
      }
    });
  }, [goToDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle background mutations from the tray (no window focus change).
  // Never registered in tray mode: the receiving preload acks each delivery,
  // so a tray-side listener would ack the tray's own sends and mask a dead
  // main window (the failure tray:action-applied exists to surface).
  useEffect(() => {
    if (isTrayMode || !window.electronAPI?.onBackgroundAction) return;
    return window.electronAPI.onBackgroundAction((payload) => dispatchBackgroundAction(payload, {
      toggleCompleteRef,
      setUnscheduledTasksRef,
      incrementHabitRef,
      setHabitCountRef,
      toggleRoutineCompletionRef,
      setTasksRef,
      moveToRecycleBinRef,
      clearDeadlineRef,
      exitFocusModeRef,
      skipFocusPhaseRef,
      dismissReminderRef,
      snoozeReminderRef,
    }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-register the stored global hotkeys after the main window (re)loads.
  useEffect(() => {
    if (isTrayMode || !window.electronAPI?.setGlobalHotkey) return;
    const stored = localStorage.getItem('dg-tray-hotkey');
    if (stored) window.electronAPI.setGlobalHotkey(stored);
    const storedMain = localStorage.getItem('dg-main-window-hotkey');
    if (storedMain) window.electronAPI.setMainWindowHotkey?.(storedMain);
  }, []);

  // Push active reminders to tray popup whenever they change. Guarded to main window only.
  useEffect(() => {
    if (isTrayMode || !window.electronAPI?.pushReminders) return;
    window.electronAPI.pushReminders(activeReminders ?? []);
  }, [activeReminders]); // eslint-disable-line react-hooks/exhaustive-deps

  // Push live focus state to main process every second when active (drives menu
  // bar countdown and tray popup focus view). Guarded to main window only.
  useEffect(() => {
    if (isTrayMode || !window.electronAPI?.pushFocusState) return;
    window.electronAPI.pushFocusState({
      active: showFocusMode && !focusShowStats && !focusShowSettings,
      phase: focusPhase,
      secondsRemaining: focusTimerSeconds,
      running: focusTimerRunning,
      cycleCount: focusCycleCount,
    });
  }, [showFocusMode, focusShowStats, focusShowSettings, focusPhase, focusTimerSeconds, focusTimerRunning, focusCycleCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Push currently-in-progress task to tray popup whenever it changes. Guarded to main window only.
  useEffect(() => {
    if (isTrayMode || !window.electronAPI?.pushCurrentTask) return;
    const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
    const hgSessions = todayHGSessions || [];
    const scheduled = [
      ...todayAgenda.filter(t => t._agendaType === 'scheduled' && !t.completed && t.startTime),
      ...hgSessions,
    ];
    const inProgress = scheduled.find(t => {
      const start = timeToMinutes(t.startTime);
      return start <= nowMin && start + (t.duration || 0) > nowMin;
    }) || null;
    window.electronAPI.pushCurrentTask(inProgress ? {
      id: inProgress.id,
      title: inProgress.title,
      startTime: inProgress.startTime ?? null,
      duration: inProgress.duration || 0,
      colorHex: inProgress.colorHex || taskColorToHex(inProgress.color, inProgress.nativeCalendarColor),
    } : null);
  }, [currentTime, todayAgenda, todayHGSessions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Push state snapshot whenever relevant state changes.
  useEffect(() => {
    if (!window.electronAPI) return;
    // Main window only. Guarded up here rather than just before the send: the
    // tray runs this same effect on its own 15 s clock tick, and used to build
    // the entire payload — goal/project progress, habit rings, tomorrow's
    // agenda — only to discard it, four times a minute in a background-throttled
    // renderer. Nothing between here and the send has a side effect.
    if (isTrayMode) return;

    const { payload, badgeCount } = buildStreamDeckState({
      currentTime, todayAgenda, todayHGSessions, tasks, unscheduledTasks,
      expandedRecurringTasks, isVisibleForUser,
      focusModeAvailable, showFocusMode, focusShowSettings, focusShowStats,
      focusPhase, focusTimerSeconds, focusTimerRunning, focusWorkMinutes,
      focusBreakMinutes, focusLongBreakMinutes, focusCycleCount,
      focusBlockTasks, focusCompletedTasks,
      showHyperGlanceMode, hyperGlanceProjectId, hgShowSettings, hgCompleted,
      hgTimerPhase, hgTimerSeconds, hgTimerRunning, hgCycleCount,
      hgWorkMinutes, hgBreakMinutes, hgLongBreakMinutes,
      habitsEnabled, activeHabits, getTodayHabitCount,
      todayRoutines, routineCompletions,
      use24HourClock, goalsProjectsEnabled, goals, projects,
    });
    window.electronAPI.setBadgeCount?.(badgeCount);
    window.electronAPI.pushState(payload);
    // isVisibleForUser is omitted: it is a filter applied at push time and is
    // recreated each render, so depending on it would re-push the snapshot on
    // every render. The push is intentionally keyed on the state values below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    todayAgenda, currentTime, tasks, expandedRecurringTasks, todayHGSessions, focusModeAvailable,
    showFocusMode, focusShowSettings, focusShowStats, focusPhase, focusTimerSeconds, focusTimerRunning,
    focusCycleCount, focusWorkMinutes, focusBreakMinutes, focusLongBreakMinutes,
    focusBlockTasks, focusCompletedTasks,
    showHyperGlanceMode, hyperGlanceProjectId, hyperGlanceSessionDate,
    hgTimerSeconds, hgTimerRunning, hgTimerPhase, hgCycleCount,
    hgWorkMinutes, hgBreakMinutes, hgLongBreakMinutes, hgShowSettings, hgCompleted,
    activeHabits, getTodayHabitCount, habitsEnabled,
    todayRoutines, routineCompletions, use24HourClock,
    goals, projects, unscheduledTasks, goalsProjectsEnabled,
    pushTrigger,
  ]);
}
