import { useEffect, useRef } from 'react';
import { taskColorToHex } from '../utils/colorUtils.js';
import { dateToString } from '../utils/taskUtils.js';
import {
  PROTOCOL_VERSION,
  MSG_DAY_STATE,
  MSG_DAY_FOCUS_START,
  MSG_DAY_FOCUS_STOP,
  MSG_DAY_FOCUS_SKIP,
  MSG_DAY_TASK_COMPLETE,
  MSG_DAY_HABIT_INCREMENT,
  MSG_DAY_ROUTINE_COMPLETE,
} from '../../electron/protocol';

const timeToMinutes = (time) => {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
};

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
  focusModeAvailable,
  showFocusMode,
  focusPhase,
  focusTimerSeconds,
  focusTimerRunning,
  focusWorkMinutes,
  focusBreakMinutes,
  enterFocusModeRef,
  exitFocusModeRef,
  skipFocusPhase,
  toggleComplete,
  // Habits
  activeHabits,
  getTodayHabitCount,
  habitsEnabled,
  incrementHabit,
  // Routines
  todayRoutines,
  routineCompletions,
  toggleRoutineCompletion,
}) {
  const skipFocusPhaseRef = useRef(skipFocusPhase);
  const toggleCompleteRef = useRef(toggleComplete);
  const incrementHabitRef = useRef(incrementHabit);
  const toggleRoutineCompletionRef = useRef(toggleRoutineCompletion);
  skipFocusPhaseRef.current = skipFocusPhase;
  toggleCompleteRef.current = toggleComplete;
  incrementHabitRef.current = incrementHabit;
  toggleRoutineCompletionRef.current = toggleRoutineCompletion;

  // Subscribe to commands from WebSocket clients once on mount.
  useEffect(() => {
    if (!window.electronAPI) return;
    const unsubscribe = window.electronAPI.onCommand((cmd) => {
      if (!cmd?.type) return;
      switch (cmd.type) {
        case MSG_DAY_FOCUS_START:
          enterFocusModeRef.current?.();
          break;
        case MSG_DAY_FOCUS_STOP:
          exitFocusModeRef.current?.();
          break;
        case MSG_DAY_FOCUS_SKIP:
          skipFocusPhaseRef.current?.();
          break;
        case MSG_DAY_TASK_COMPLETE:
          if (cmd.id) toggleCompleteRef.current?.(cmd.id);
          break;
        case MSG_DAY_HABIT_INCREMENT:
          if (cmd.id) incrementHabitRef.current?.(cmd.id);
          break;
        case MSG_DAY_ROUTINE_COMPLETE:
          if (cmd.id) toggleRoutineCompletionRef.current?.(cmd.id);
          break;
      }
    });
    return unsubscribe;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Push state snapshot whenever relevant state changes.
  useEffect(() => {
    if (!window.electronAPI) return;

    const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
    const scheduled = todayAgenda.filter(t => t._agendaType === 'scheduled' && !t.completed && t.startTime);

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
      startTime: t.startTime,
      duration: t.duration || 0,
      colorHex: taskColorToHex(t.color, t.nativeCalendarColor),
      tags: t.tags || [],
    } : null;

    const todayStr = dateToString(currentTime);
    const todayTasks = tasks.filter(t => t.date === todayStr && t.startTime && !t.isAllDay);

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

    window.electronAPI.pushState({
      v: PROTOCOL_VERSION,
      type: MSG_DAY_STATE,
      currentTask: mapTask(inProgress),
      nextTask: mapTask(nextUpcoming),
      today: {
        total: todayTasks.length,
        completed: todayTasks.filter(t => t.completed).length,
        date: todayStr,
      },
      focus: {
        available: focusModeAvailable,
        active: showFocusMode,
        phase: focusPhase,
        secondsRemaining: focusTimerSeconds,
        running: focusTimerRunning,
        workMinutes: focusWorkMinutes,
        breakMinutes: focusBreakMinutes,
      },
      habits,
      nextRoutine: nextRoutineRaw ? {
        id: nextRoutineRaw.id,
        name: nextRoutineRaw.name,
        startTime: nextRoutineRaw.startTime,
        completed: false,
      } : null,
    });
  }, [
    todayAgenda, currentTime, tasks, focusModeAvailable,
    showFocusMode, focusPhase, focusTimerSeconds, focusTimerRunning,
    focusWorkMinutes, focusBreakMinutes,
    activeHabits, getTodayHabitCount, habitsEnabled,
    todayRoutines, routineCompletions,
  ]);
}
