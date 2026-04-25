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
} from '../../electron/protocol';

const timeToMinutes = (time) => {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
};

// Pushes a lightweight state snapshot to the Electron WebSocket server
// (ws://localhost:7892) whenever app state changes, and routes incoming
// commands from connected clients (e.g. Stream Deck plugin) back to the app.
//
// Message types pushed to clients:
//   { v: PROTOCOL_VERSION, type: MSG_DAY_STATE, currentTask, nextTask, today, focus }
//
// Commands received from clients:
//   { v: PROTOCOL_VERSION, type: MSG_DAY_FOCUS_START }
//   { v: PROTOCOL_VERSION, type: MSG_DAY_FOCUS_STOP }
//   { v: PROTOCOL_VERSION, type: MSG_DAY_FOCUS_SKIP }
//   { v: PROTOCOL_VERSION, type: MSG_DAY_TASK_COMPLETE, id: string }
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
}) {
  const skipFocusPhaseRef = useRef(skipFocusPhase);
  const toggleCompleteRef = useRef(toggleComplete);
  skipFocusPhaseRef.current = skipFocusPhase;
  toggleCompleteRef.current = toggleComplete;

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
    });
  }, [todayAgenda, currentTime, tasks, focusModeAvailable, showFocusMode, focusPhase, focusTimerSeconds, focusTimerRunning, focusWorkMinutes, focusBreakMinutes]);
}
