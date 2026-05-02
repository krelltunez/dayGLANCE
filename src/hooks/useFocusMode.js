import { useState, useRef, useEffect } from 'react';
import { isNativeAndroid, nativeShowFocusTimerNotification, nativeDismissFocusTimerNotification, nativeGetFocusPendingAction } from '../native.js';

const useFocusMode = () => {
  const [showFocusMode, setShowFocusMode] = useState(false);
  const [focusPhase, setFocusPhase] = useState('work'); // 'work' | 'shortBreak' | 'longBreak'
  const [focusTimerSeconds, setFocusTimerSeconds] = useState(0);
  const [focusCycleCount, setFocusCycleCount] = useState(0);
  const [focusSessionStart, setFocusSessionStart] = useState(null);
  const [focusWorkMinutes, setFocusWorkMinutes] = useState(25);
  const [focusBreakMinutes, setFocusBreakMinutes] = useState(5);
  const [focusLongBreakMinutes, setFocusLongBreakMinutes] = useState(15);
  const [focusCompletedTasks, setFocusCompletedTasks] = useState(new Set());
  const [focusShowStats, setFocusShowStats] = useState(false);
  const [focusShowSettings, setFocusShowSettings] = useState(true);
  const [focusTimerRunning, setFocusTimerRunning] = useState(false);
  const [focusTaskMinutes, setFocusTaskMinutes] = useState({});
  const [focusBlockTasks, setFocusBlockTasks] = useState([]);
  const [focusLog, setFocusLog] = useState(() => {
    const saved = localStorage.getItem('day-planner-focus-log');
    return saved ? JSON.parse(saved) : {};
  });
  const [focusLogModalDate, setFocusLogModalDate] = useState(null);
  const wakeLockSentinel = useRef(null);
  const focusTimerRef = useRef(null);
  const handleFocusTimerEndRef = useRef(null);
  const exitFocusModeRef = useRef(null);
  const focusModeAvailableRef = useRef(false);

  // Persist focusLog to localStorage
  useEffect(() => {
    localStorage.setItem('day-planner-focus-log', JSON.stringify(focusLog));
  }, [focusLog]);

  // Focus Mode timer tick
  useEffect(() => {
    if (showFocusMode && focusTimerRunning && focusTimerSeconds > 0) {
      focusTimerRef.current = setInterval(() => {
        setFocusTimerSeconds(prev => {
          if (prev <= 1) return 0;
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(focusTimerRef.current);
    }
  }, [showFocusMode, focusTimerRunning, focusTimerSeconds > 0]);

  // Focus Mode timer end detection (reads from ref to avoid stale closure)
  useEffect(() => {
    if (showFocusMode && focusTimerRunning && focusTimerSeconds === 0 && !focusShowSettings) {
      setFocusTimerRunning(false);
      handleFocusTimerEndRef.current?.();
    }
  }, [focusTimerSeconds, showFocusMode, focusTimerRunning, focusShowSettings]);

  // Keep a ref to the current remaining seconds so the notification effect can read
  // it without depending on it — we only want to fire on meaningful transitions,
  // not every 1-second tick (which would reset the native chronometer and cause flicker).
  const focusTimerSecondsRef = useRef(focusTimerSeconds);
  useEffect(() => { focusTimerSecondsRef.current = focusTimerSeconds; }, [focusTimerSeconds]);

  // Sync the Android notification on state transitions only: start, pause, resume,
  // phase change, and session end. The native chronometer ticks independently between
  // these calls — calling notify() every second would reset it and cause flicker.
  useEffect(() => {
    if (!isNativeAndroid()) return;
    if (!showFocusMode || focusShowSettings || focusShowStats) {
      nativeDismissFocusTimerNotification();
      return;
    }
    nativeShowFocusTimerNotification(focusPhase, focusTimerSecondsRef.current, !focusTimerRunning);
  }, [showFocusMode, focusTimerRunning, focusPhase, focusShowSettings, focusShowStats]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll for notification button actions while a focus session is active.
  // visibilitychange doesn't fire when the app is already in the foreground, so polling
  // is needed to pick up Pause / Resume / Stop taps promptly.
  useEffect(() => {
    if (!isNativeAndroid() || !showFocusMode || focusShowSettings || focusShowStats) return;
    const interval = setInterval(() => {
      const action = nativeGetFocusPendingAction();
      if (!action) return;
      if (action === 'focus-pause') setFocusTimerRunning(false);
      else if (action === 'focus-resume') setFocusTimerRunning(true);
      else if (action === 'focus-stop') exitFocusModeRef.current?.(false);
    }, 500);
    return () => clearInterval(interval);
  }, [showFocusMode, focusShowSettings, focusShowStats]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    showFocusMode, setShowFocusMode,
    focusPhase, setFocusPhase,
    focusTimerSeconds, setFocusTimerSeconds,
    focusCycleCount, setFocusCycleCount,
    focusSessionStart, setFocusSessionStart,
    focusWorkMinutes, setFocusWorkMinutes,
    focusBreakMinutes, setFocusBreakMinutes,
    focusLongBreakMinutes, setFocusLongBreakMinutes,
    focusCompletedTasks, setFocusCompletedTasks,
    focusShowStats, setFocusShowStats,
    focusShowSettings, setFocusShowSettings,
    focusTimerRunning, setFocusTimerRunning,
    focusTaskMinutes, setFocusTaskMinutes,
    focusBlockTasks, setFocusBlockTasks,
    focusLog, setFocusLog,
    focusLogModalDate, setFocusLogModalDate,
    wakeLockSentinel,
    focusTimerRef,
    handleFocusTimerEndRef,
    exitFocusModeRef,
    focusModeAvailableRef,
  };
};

export default useFocusMode;
