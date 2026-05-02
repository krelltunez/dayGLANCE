import { useState, useRef, useEffect } from 'react';

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
