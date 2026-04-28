import { useEffect, useRef, useState } from 'react';
import { taskColorToHex, TAILWIND_TO_HEX } from '../utils/colorUtils.js';
import { dateToString } from '../utils/taskUtils.js';
import { calculateGoalProgress } from '../utils/goalProgress.js';
import { calculateProjectProgress } from '../utils/projectProgress.js';
import {
  PROTOCOL_VERSION,
  MSG_DAY_STATE,
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

const timeToMinutes = (time) => {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
};

const isTrayMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('tray');

// Inline habit color map (mirrors HABIT_COLORS ring values from src/constants/habits.js)
const HABIT_COLOR_HEX = {
  blue: '#3b82f6', green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
  purple: '#a855f7', pink: '#ec4899', cyan: '#06b6d4', orange: '#f97316',
};

function habitRingColor(habit, count) {
  const base = HABIT_COLOR_HEX[habit.color] ?? '#3b82f6';
  if (habit.type === 'limit') {
    if (count === 0) return '#22c55e';
    if (count <= habit.target * 0.5) return '#eab308';
    if (count <= habit.target) return '#f59e0b';
    return '#ef4444';
  }
  return count === 0 ? '#d1d5db' : base;
}

// Pushes a lightweight state snapshot to the Electron WebSocket server
// (ws://localhost:7892) whenever app state changes, and routes incoming
// commands from connected clients (e.g. Stream Deck plugin) back to the app.
export default function useElectronBridge({
  todayAgenda,
  currentTime,
  tasks,
  expandedRecurringTasks,
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
  goalsProjectsEnabled,
  goToDate,
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
      } else if (action === 'focus-mode') {
        enterFocusModeRef.current?.();
      } else if (action === 'hyperglance') {
        if (projectId && date) enterHyperGlanceModeRef.current?.(projectId, date);
      }
    });
  }, [goToDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle background mutations from the tray (no window focus change).
  useEffect(() => {
    if (isTrayMode || !window.electronAPI?.onBackgroundAction) return;
    return window.electronAPI.onBackgroundAction((payload) => {
      if (!payload?.action) return;
      if (payload.action === 'toggle-complete') {
        toggleCompleteRef.current?.(payload.taskId, false);
      } else if (payload.action === 'refresh-inbox') {
        try {
          const fresh = JSON.parse(localStorage.getItem('day-planner-unscheduled') || '[]');
          setUnscheduledTasksRef.current?.(fresh);
        } catch {}
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Push state snapshot whenever relevant state changes.
  useEffect(() => {
    if (!window.electronAPI) return;

    const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
    const hgSessions = (todayHGSessions || []);
    const scheduled = [
      ...todayAgenda.filter(t => t._agendaType === 'scheduled' && !t.completed && t.startTime),
      ...hgSessions,
    ].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

    const inProgress = scheduled.find(t => {
      const start = timeToMinutes(t.startTime);
      return start <= nowMin && start + (t.duration || 0) > nowMin;
    }) || null;

    const nextUpcoming = scheduled
      .filter(t => timeToMinutes(t.startTime) > nowMin)
      .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))[0] || null;

    const mapTask = (t) => t ? {
      id: t.id,
      title: t.title,
      startTime: t.startTime ?? null,
      duration: t.duration || 0,
      colorHex: t.colorHex || taskColorToHex(t.color, t.nativeCalendarColor),
      tags: t.tags || [],
      completed: !!t.completed,
      isAllDay: !!t.isAllDay,
      isHGSession: !!t.isHGSession,
    } : null;

    const todayStr = dateToString(currentTime);
    const todayRecurring = (expandedRecurringTasks || []).filter(t => t.date === todayStr);
    // Include recurring instances in counts (stable denominator — all tasks regardless of completion/time)
    const todayTasks = [
      ...tasks.filter(t => t.date === todayStr && t.startTime && !t.isAllDay),
      ...todayRecurring.filter(t => t.startTime && !t.isAllDay),
      ...hgSessions,
    ];
    const allDayTasks = [
      ...tasks.filter(t => t.date === todayStr && t.isAllDay),
      ...todayRecurring.filter(t => t.isAllDay),
    ];

    // ── Habits ────────────────────────────────────────────────────────────
    const habits = habitsEnabled ? (activeHabits ?? []).map(h => {
      const count = getTodayHabitCount(h.id);
      const colorHex = HABIT_COLOR_HEX[h.color] ?? '#3b82f6';
      const ringColorHex = habitRingColor(h, count);
      return {
        id: h.id,
        name: h.name,
        colorHex,
        ringColorHex,
        count,
        target: h.target,
        unit: h.unit ?? '',
        type: h.type || 'doMore',
        complete: h.type === 'doMore' ? (h.target > 0 && count >= h.target) : false,
      };
    }) : [];

    // ── Next routine (next uncompleted scheduled routine for today) ────────
    const nextRoutineRaw = (todayRoutines ?? [])
      .filter(r => r.startTime && !r.isAllDay && !routineCompletions?.[r.id])
      .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))[0] ?? null;

    // ── Goals ─────────────────────────────────────────────────────────────
    const allTasksForGoals = [...tasks, ...(unscheduledTasks || [])];
    const todayMs = new Date(dateToString(currentTime) + 'T00:00:00').getTime();
    const goalsPayload = goalsProjectsEnabled ? (goals || [])
      .filter(g => g.status === 'active')
      .map(g => {
        const progress = Math.round(calculateGoalProgress(g.id, projects || [], allTasksForGoals) * 100);
        const colorHex = TAILWIND_TO_HEX[g.color] || '#3b82f6';
        const daysLeft = g.targetDate
          ? Math.round((new Date(g.targetDate + 'T00:00:00').getTime() - todayMs) / 86400000)
          : null;
        return { id: g.id, title: g.title, progress, colorHex, daysLeft };
      }) : [];

    // ── Projects ──────────────────────────────────────────────────────────
    const mapProject = (p) => {
      const progress = Math.round(calculateProjectProgress(p.id, allTasksForGoals) * 100);
      const colorHex = TAILWIND_TO_HEX[p.color] || '#3b82f6';
      const parentGoal = p.goalId ? (goals || []).find(g => g.id === p.goalId) : null;
      return { id: p.id, title: p.title, progress, colorHex, goalTitle: parentGoal?.title ?? null };
    };
    const sortByProgressAsc = (a, b) => a.progress - b.progress;
    const activeProjects = goalsProjectsEnabled ? (projects || []).filter(p => p.status === 'active') : [];
    const projectsPayload = [
      ...activeProjects.filter(p => p.goalId).map(mapProject).sort(sortByProgressAsc),
      ...activeProjects.filter(p => !p.goalId).map(mapProject).sort(sortByProgressAsc),
    ];

    if (isTrayMode) return;

    // Dock badge: incomplete scheduled tasks today
    window.electronAPI.setBadgeCount?.(todayTasks.filter(t => !t.completed).length);

    window.electronAPI.pushState({
      v: PROTOCOL_VERSION,
      type: MSG_DAY_STATE,
      currentTask: mapTask(inProgress),
      nextTask: mapTask(nextUpcoming),
      scheduledTasks: [
        ...allDayTasks.map(mapTask),
        ...[...todayTasks]
          .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))
          .map(mapTask),
      ],
      today: {
        total: todayTasks.length + allDayTasks.length,
        completed: todayTasks.filter(t => t.completed).length + allDayTasks.filter(t => t.completed).length,
        date: todayStr,
      },
      focus: {
        available: focusModeAvailable,
        active: showFocusMode,
        setup: !!focusShowSettings,
        showStats: !!focusShowStats,
        phase: focusPhase,
        secondsRemaining: focusTimerSeconds,
        running: focusTimerRunning,
        workMinutes: focusWorkMinutes,
        breakMinutes: focusBreakMinutes,
        longBreakMinutes: focusLongBreakMinutes,
        cycleCount: focusCycleCount || 0,
        nextFocusTask: (() => {
          const t = (focusBlockTasks || []).find(t => !t.completed && !focusCompletedTasks?.has(t.id));
          return t ? { id: t.id, title: t.title } : null;
        })(),
      },
      habits,
      nextRoutine: nextRoutineRaw ? {
        id: nextRoutineRaw.id,
        name: nextRoutineRaw.name,
        startTime: nextRoutineRaw.startTime,
        completed: false,
      } : null,
      use24Hour: !!use24HourClock,
      goals: goalsPayload,
      projects: projectsPayload,
      hg: {
        scheduled: (todayHGSessions || []).slice(0, 4).map(s => ({
          projectId: s.id,
          title: s.title,
          colorHex: s.colorHex,
          startTime: s.startTime,
          reachable: !!s.reachable,
          date: s.date,
        })),
        active: showHyperGlanceMode ? {
          projectId: hyperGlanceProjectId || '',
          title: (() => { const p = (projects || []).find(p => p.id === hyperGlanceProjectId); return p?.title || ''; })(),
          colorHex: (() => { const p = (projects || []).find(p => p.id === hyperGlanceProjectId); return p?.hyperglance?.color || '#4f46e5'; })(),
          setup: !!hgShowSettings,
          completed: !!hgCompleted,
          phase: hgTimerPhase || 'work',
          secondsRemaining: hgTimerSeconds || 0,
          running: !!hgTimerRunning,
          cycleCount: hgCycleCount || 0,
          workMinutes: hgWorkMinutes || 25,
          breakMinutes: hgBreakMinutes || 5,
          longBreakMinutes: hgLongBreakMinutes || 15,
          nextTask: (() => {
            if (!hyperGlanceProjectId) return null;
            const allT = [...(tasks || []), ...(unscheduledTasks || [])];
            const t = allT.find(t => t.projectId === hyperGlanceProjectId && !t.archived && !t.completed);
            return t ? { id: t.id, title: t.title } : null;
          })(),
        } : null,
      },
    });
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
