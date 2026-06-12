import { useState, useRef, useEffect, useMemo } from 'react';
import { dateToString } from '../utils/taskUtils.js';
import { getDeviceId, isNativeIOS } from '../native.js';

const useHabits = ({ playUISound, hrOwnerRef }) => {
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

  const stampHabitLogTs = (dateStr, habitId) => {
    const ts = JSON.parse(localStorage.getItem('day-planner-habit-log-timestamps') || '{}');
    ts[`${dateStr}:${habitId}`] = new Date().toISOString();
    localStorage.setItem('day-planner-habit-log-timestamps', JSON.stringify(ts));
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
    stampHabitLogTs(todayStr, habitId);
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
    stampHabitLogTs(todayStr, habitId);
  };

  const addHabit = (habit) => {
    // Multi-user: stamp the dashboard's active owner so the habit only shows for
    // that user. Single-user mode leaves it unowned (ref is null).
    const owner = hrOwnerRef?.current;
    setHabits(prev => [...prev, {
      ...habit,
      ...(habit.ownerSyncId || owner ? { ownerSyncId: habit.ownerSyncId ?? owner } : {}),
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      archived: false,
    }]);
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
    // In multi-user mode the indices come from the owner-filtered list shown in
    // the dashboard, so reorder only within that owner's active habits and leave
    // other members' positions untouched.
    const owner = hrOwnerRef?.current ?? null;
    setHabits(prev => {
      const updated = [...prev];
      const archived = updated.filter(h => h.archived);
      const active = updated.filter(h => !h.archived);
      if (!owner) {
        const [moved] = active.splice(fromIndex, 1);
        active.splice(toIndex, 0, moved);
        return [...active, ...archived];
      }
      const isOwners = (h) => !h.ownerSyncId || h.ownerSyncId === owner;
      const ownerActive = active.filter(isOwners);
      const [moved] = ownerActive.splice(fromIndex, 1);
      ownerActive.splice(toIndex, 0, moved);
      let oi = 0;
      const rebuiltActive = active.map(h => isOwners(h) ? ownerActive[oi++] : h);
      return [...rebuiltActive, ...archived];
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
    const platformSource = isNativeIOS() ? 'healthKit' : 'healthConnect';
    const healthHabits = habits.filter(h => !h.archived && h.source === platformSource);
    if (!healthHabits.length) return;

    const today = new Date();
    const updates = {};
    // Track habits that successfully read today's data — they get the lastAutoSync marker.
    const syncedTodayIds = new Set();
    for (let daysBack = 0; daysBack < 7; daysBack++) {
      const d = new Date(today);
      d.setDate(d.getDate() - daysBack);
      const dateStr = dateToString(d);
      for (const habit of healthHabits) {
        // Skip types whose permission is known revoked (=== false, not null = "not yet checked").
        if (habit.unit === 'steps' && healthPerms.steps === false) continue;
        if ((habit.unit === 'min' || habit.unit === 'minutes') && healthPerms.sleep === false) continue;
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
          if (daysBack === 0) syncedTodayIds.add(habit.id);
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
    if (syncedTodayIds.size > 0) {
      const deviceId = getDeviceId();
      const platform = isNativeIOS() ? 'iOS' : 'Android';
      const timestamp = new Date().toISOString();
      setHabits(prev => prev.map(h => {
        if (!syncedTodayIds.has(h.id)) return h;
        return { ...h, lastAutoSync: { deviceId, platform, timestamp }, lastModified: timestamp };
      }));
    }
  };

  // Keep ref current at render time (no stale closure in event listeners)
  syncHealthConnectHabitsRef.current = syncHealthConnectHabits;

  // Sync on mount and whenever the habits list changes (e.g. steps habit just added)
  useEffect(() => {
    syncHealthConnectHabitsRef.current?.();
  }, [habits]);

  // Per-type Health Connect permission state: null = not yet checked, true/false = result.
  const [healthPerms, setHealthPerms] = useState({ steps: null, sleep: null });

  const refreshHealthPerms = () => {
    if (!window.DayGlanceNative) return;
    try {
      const steps = window.DayGlanceNative.checkStepsPermission() === 'granted';
      const sleep = window.DayGlanceNative.checkSleepPermission() === 'granted';
      setHealthPerms({ steps, sleep });
    } catch (e) { /* bridge unavailable — leave state unchanged */ }
  };
  const refreshHealthPermsRef = useRef(null);
  refreshHealthPermsRef.current = refreshHealthPerms;

  // Check permissions once on mount.
  useEffect(() => { refreshHealthPerms(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When a permission transitions true → false (revoked), clear today's counts for the
  // affected habits so the ring empties immediately instead of showing stale data.
  const prevHealthPermsRef = useRef({ steps: null, sleep: null });
  useEffect(() => {
    const prev = prevHealthPermsRef.current;
    const stepsRevoked = prev.steps === true && healthPerms.steps === false;
    const sleepRevoked = prev.sleep === true && healthPerms.sleep === false;
    if (stepsRevoked || sleepRevoked) {
      const todayStr = dateToString(new Date());
      setHabitLogs(prev => {
        const today = { ...(prev[todayStr] || {}) };
        for (const h of habits) {
          if (h.archived) continue;
          if (stepsRevoked && h.unit === 'steps' && h.source === 'healthConnect') delete today[h.id];
          if (sleepRevoked && (h.unit === 'min' || h.unit === 'minutes') && h.source === 'healthConnect') delete today[h.id];
        }
        return { ...prev, [todayStr]: today };
      });
    }
    prevHealthPermsRef.current = healthPerms;
  }, [healthPerms]); // eslint-disable-line react-hooks/exhaustive-deps

  const addStepsHabit = () => addHabit({
    name: 'Steps',
    icon: 'Footprints',
    color: 'green',
    type: 'doMore',
    target: 10000,
    unit: 'steps',
    source: window.DayGlanceIOS ? 'healthKit' : 'healthConnect',
    scheduledDays: [0, 1, 2, 3, 4, 5, 6],
  });

  const addSleepHabit = () => addHabit({
    name: 'Sleep',
    icon: 'Moon',
    color: 'indigo',
    type: 'doMore',
    target: 480,
    unit: 'min',
    source: window.DayGlanceIOS ? 'healthKit' : 'healthConnect',
    scheduledDays: [0, 1, 2, 3, 4, 5, 6],
  });

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
    refreshHealthPermsRef,
    healthPerms,
    addStepsHabit,
    addSleepHabit,
  };
};

export default useHabits;
