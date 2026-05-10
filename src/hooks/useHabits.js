import { useState, useRef, useEffect, useMemo } from 'react';
import { dateToString } from '../utils/taskUtils.js';

const useHabits = ({ playUISound }) => {
  const [habits, setHabits] = useState([]);
  const [habitLogs, setHabitLogs] = useState({});
  const [habitsEnabled, setHabitsEnabled] = useState(() => {
    // If the user has an explicit stored preference, use it.
    const stored = localStorage.getItem('day-planner-habits-enabled');
    if (stored !== null) return JSON.parse(stored);
    // No stored preference: default OFF for new installs, but ON if the user
    // already has habit data (upgrade migration — don't silently disable their habits).
    try {
      const existing = JSON.parse(localStorage.getItem('day-planner-habits') || '[]');
      if (existing.length > 0) return true;
    } catch (_) {}
    return false;
  });
  const [showHabitModal, setShowHabitModal] = useState(false);
  const [editingHabit, setEditingHabit] = useState(null); // null = adding new, object = editing
  const [draggedHabitIdx, setDraggedHabitIdx] = useState(null);
  const [habitOverflowOpen, setHabitOverflowOpen] = useState(false);
  const [habitLongPressId, setHabitLongPressId] = useState(null); // ID of habit showing long-press popover
  const [habitEditingCountId, setHabitEditingCountId] = useState(null); // ID of habit with count input open
  const [habitDayPopup, setHabitDayPopup] = useState(null); // date string for prior-day habit summary popup
  const habitLongPressTimer = useRef(null);
  const habitLongPressOpenedAt = useRef(null); // timestamp when popover last opened, used to swallow ghost clicks
  const editingHabitRef = useRef(editingHabit);
  editingHabitRef.current = editingHabit;

  useEffect(() => {
    if (!habitLongPressId) return;
    const handler = (e) => {
      if (e.key === 'Escape') { setHabitLongPressId(null); setHabitEditingCountId(null); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [habitLongPressId]);

  useEffect(() => {
    if (!showHabitModal) return;
    const handler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (editingHabitRef.current) setEditingHabit(null);
        else { setShowHabitModal(false); setEditingHabit(null); }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showHabitModal]);

  const activeHabits = useMemo(() =>
    habits.filter(h => !h.archived).map(h =>
      h.scheduledDays ? h : { ...h, scheduledDays: [0, 1, 2, 3, 4, 5, 6] }
    ),
  [habits]);

  // Compute habit streaks: { habitId: { current, best } }
  const habitStreaks = useMemo(() => {
    const streaks = {};
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    for (const habit of activeHabits) {
      const scheduledDays = habit.scheduledDays ?? [0, 1, 2, 3, 4, 5, 6];
      let current = 0;
      let best = 0;
      let streak = 0;
      let foundGap = false;
      // Walk backwards from today up to 365 days
      for (let i = 0; i < 365; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        // Skip days not in the habit's schedule -- they neither extend nor break
        if (!scheduledDays.includes(d.getDay())) continue;
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const count = habitLogs[ds]?.[habit.id] || 0;
        // Don't count days before the habit was created
        const createdDate = (habit.createdAt || '').slice(0, 10);
        if (createdDate && ds < createdDate) break;
        const met = habit.type === 'doMore' ? count >= habit.target : count <= habit.target;
        if (met) {
          streak++;
          best = Math.max(best, streak);
        } else {
          if (!foundGap) current = streak;
          foundGap = true;
          streak = 0;
        }
      }
      if (!foundGap) current = streak;
      best = Math.max(best, streak);
      streaks[habit.id] = { current, best };
    }
    return streaks;
  }, [activeHabits, habitLogs]);

  const getTodayHabitCount = (habitId) => {
    const todayStr = dateToString(new Date());
    return habitLogs[todayStr]?.[habitId] || 0;
  };

  const incrementHabit = (habitId) => {
    const todayStr = dateToString(new Date());
    playUISound('click');
    setHabitLogs(prev => ({
      ...prev,
      [todayStr]: {
        ...prev[todayStr],
        [habitId]: (prev[todayStr]?.[habitId] || 0) + 1
      }
    }));
  };

  const setHabitCount = (habitId, count) => {
    const todayStr = dateToString(new Date());
    setHabitLogs(prev => ({
      ...prev,
      [todayStr]: {
        ...prev[todayStr],
        [habitId]: Math.max(0, count)
      }
    }));
  };

  const addHabit = (habit) => {
    setHabits(prev => [...prev, { ...habit, id: Date.now().toString(), createdAt: new Date().toISOString(), archived: false }]);
  };

  const updateHabit = (id, updates) => {
    setHabits(prev => prev.map(h => h.id === id ? { ...h, ...updates, lastModified: new Date().toISOString() } : h));
  };

  const archiveHabit = (id) => {
    setHabits(prev => prev.map(h => h.id === id ? { ...h, archived: true, lastModified: new Date().toISOString() } : h));
  };

  const deleteHabit = (id) => {
    setHabits(prev => prev.filter(h => h.id !== id));
    const tombstones = JSON.parse(localStorage.getItem('day-planner-deleted-habit-ids') || '{}');
    tombstones[String(id)] = new Date().toISOString();
    localStorage.setItem('day-planner-deleted-habit-ids', JSON.stringify(tombstones));
  };

  const reorderHabits = (fromIndex, toIndex) => {
    setHabits(prev => {
      const updated = [...prev];
      const active = updated.filter(h => !h.archived);
      const [moved] = active.splice(fromIndex, 1);
      active.splice(toIndex, 0, moved);
      const archived = updated.filter(h => h.archived);
      return [...active, ...archived];
    });
  };

  // Ref kept current so the visibilitychange handler always calls the latest version
  const syncHealthConnectHabitsRef = useRef(null);

  // Pull native health data into habits that belong to this platform.
  // iOS reads from HealthKit (source:'healthKit'); Android reads from
  // HealthConnect (source:'healthConnect'). Habits synced from the other
  // platform carry the opposite source tag and are intentionally skipped,
  // preventing cross-platform overwriting of health counts.
  // Backfills the last 7 days so historical rings are accurate on first setup.
  const syncHealthConnectHabits = () => {
    if (!window.DayGlanceNative) return;
    const isIOS = !!window.DayGlanceIOS;
    const platformSource = isIOS ? 'healthKit' : 'healthConnect';
    const healthHabits = habits.filter(h => !h.archived && h.source === platformSource);
    if (!healthHabits.length) return;

    const today = new Date();
    const updates = {};
    for (let daysBack = 0; daysBack < 7; daysBack++) {
      const d = new Date(today);
      d.setDate(d.getDate() - daysBack);
      const dateStr = dateToString(d);
      for (const habit of healthHabits) {
        try {
          let count = 0;
          if (habit.unit === 'steps') {
            const result = JSON.parse(window.DayGlanceNative.getSteps(dateStr));
            count = result.steps ?? 0;
          } else if (habit.unit === 'min' || habit.unit === 'minutes') {
            const result = JSON.parse(window.DayGlanceNative.getSleep(dateStr));
            count = result.durationMinutes ?? 0;
          }
          if (!updates[dateStr]) updates[dateStr] = {};
          updates[dateStr][habit.id] = count;
        } catch (e) { /* ignore parse errors */ }
      }
    }
    if (Object.keys(updates).length > 0) {
      setHabitLogs(prev => {
        const next = { ...prev };
        for (const [dateStr, entries] of Object.entries(updates)) {
          const prevDay = next[dateStr] || {};
          const merged = { ...prevDay };
          for (const [habitId, count] of Object.entries(entries)) {
            // Never downgrade a count already in state (e.g. a value that arrived
            // via cloud sync from the other device's health platform).
            merged[habitId] = Math.max(prevDay[habitId] || 0, count);
          }
          next[dateStr] = merged;
        }
        return next;
      });
    }
  };

  // Keep ref current at render time (no stale closure in event listeners)
  syncHealthConnectHabitsRef.current = syncHealthConnectHabits;

  // Sync on mount and whenever the habits list changes (e.g. steps habit just added)
  useEffect(() => {
    syncHealthConnectHabitsRef.current?.();
  }, [habits]);

  // Create the steps habit pre-configured for the platform's health bridge.
  const addStepsHabit = () => {
    if (!window.DayGlanceNative) return;
    // Request permission — stub returns "granted", real impl launches HC/HK permission dialog
    try { window.DayGlanceNative.requestHealthPermission(); } catch (e) {}
    addHabit({
      name: 'Steps',
      icon: 'Footprints',
      color: 'green',
      type: 'doMore',
      target: 10000,
      unit: 'steps',
      source: window.DayGlanceIOS ? 'healthKit' : 'healthConnect',
      scheduledDays: [0, 1, 2, 3, 4, 5, 6],
    });
  };

  // Create the sleep habit pre-configured for the platform's health bridge.
  const addSleepHabit = () => {
    if (!window.DayGlanceNative) return;
    try { window.DayGlanceNative.requestHealthPermission(); } catch (e) {}
    addHabit({
      name: 'Sleep',
      icon: 'Moon',
      color: 'indigo',
      type: 'doMore',
      target: 480,
      unit: 'min',
      source: window.DayGlanceIOS ? 'healthKit' : 'healthConnect',
      scheduledDays: [0, 1, 2, 3, 4, 5, 6],
    });
  };

  return {
    habits, setHabits,
    habitLogs, setHabitLogs,
    habitsEnabled, setHabitsEnabled,
    showHabitModal, setShowHabitModal,
    editingHabit, setEditingHabit,
    draggedHabitIdx, setDraggedHabitIdx,
    habitOverflowOpen, setHabitOverflowOpen,
    habitLongPressId, setHabitLongPressId,
    habitEditingCountId, setHabitEditingCountId,
    habitDayPopup, setHabitDayPopup,
    habitLongPressTimer,
    habitLongPressOpenedAt,
    activeHabits,
    habitStreaks,
    getTodayHabitCount,
    incrementHabit,
    setHabitCount,
    addHabit,
    updateHabit,
    archiveHabit,
    deleteHabit,
    reorderHabits,
    syncHealthConnectHabitsRef,
    addStepsHabit,
    addSleepHabit,
  };
};

export default useHabits;
