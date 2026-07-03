import { useState, useEffect } from 'react';
import { dateToString } from '../utils/taskUtils.js';

// Local midnight (00:00:00) of the current day, as an ISO instant. This is the
// moment routine completions "reset" each day, and the timestamp used to stamp
// day-rollover tombstones. Choosing local midnight (rather than "now") is
// load-bearing for multi-device sync: the tombstone must be NEWER than a stale
// completion carried over from a PRIOR day (so it heals the resurrection), yet
// OLDER than any genuine completion made earlier TODAY on another device (whose
// timestamp is after midnight, so it still wins the LWW merge).
export const startOfTodayIso = (now = new Date()) => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

// Build the routine-completion state to load for `todayStr` from the persisted
// maps. Today's completions are kept verbatim; every routine that carried a
// prior-day completion or timestamp is reset for the new day — its completion
// dropped and its timestamp replaced with a `midnightIso` tombstone. That
// tombstone out-dates a stale remote completion on the day's first sync, so a
// freshly re-added routine no longer shows up already-completed. This runs on
// every load, so it fixes the common case (app closed overnight) that the
// open-across-midnight rollover effect below never reaches.
export const resetRoutineCompletionsForToday = (
  storedCompletions = {}, storedTimestamps = {}, todayStr, midnightIso,
) => {
  const completions = {};
  for (const [id, date] of Object.entries(storedCompletions)) {
    if (date === todayStr) completions[id] = date;
  }
  const timestamps = {};
  for (const id of new Set([...Object.keys(storedCompletions), ...Object.keys(storedTimestamps)])) {
    // A genuine completion made today keeps its real timestamp so its recency is
    // preserved for the LWW merge; anything older is reset to a midnight tombstone.
    if (completions[id] && typeof storedTimestamps[id] === 'string' && storedTimestamps[id] >= midnightIso) {
      timestamps[id] = storedTimestamps[id];
    } else {
      timestamps[id] = midnightIso;
    }
  }
  return { completions, timestamps };
};

const useRoutines = ({ currentTime, onboardingProgress, setOnboardingProgress, hrOwnerRef }) => {
  // The dashboard's active owner (multi-user) or null in single-user mode.
  const currentOwner = () => hrOwnerRef?.current ?? null;
  // True when a routine chip / today-routine belongs to `owner` (or is unowned).
  const ownedByOwner = (item, owner) => !owner || !item.ownerSyncId || item.ownerSyncId === owner;
  const [routineDefinitions, setRoutineDefinitions] = useState({ monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [], everyday: [] });
  const [todayRoutines, setTodayRoutines] = useState([]);
  const [routinesDate, setRoutinesDate] = useState('');
  const [removedTodayRoutineIds, setRemovedTodayRoutineIds] = useState({});
  // Load today's completion state from the persisted maps. Both the completions
  // and their sibling LWW timestamps are derived together so a routine reset for
  // the new day gets a midnight tombstone (see resetRoutineCompletionsForToday),
  // which stops a stale remote completion from resurrecting it on the first sync
  // — the "added-already-completed" bug. Read once, since the timestamp
  // initializer needs the raw completions too.
  const loadRoutineState = () => {
    try {
      const storedC = JSON.parse(localStorage.getItem('day-planner-routine-completions') || '{}');
      const storedTs = JSON.parse(localStorage.getItem('day-planner-routine-completion-timestamps') || '{}');
      return resetRoutineCompletionsForToday(storedC, storedTs, dateToString(new Date()), startOfTodayIso());
    } catch (_) { return { completions: {}, timestamps: {} }; }
  };
  const [routineCompletions, setRoutineCompletions] = useState(() => loadRoutineState().completions);
  // Per-routine completion timestamps (ISO), the sync LWW key that lets an
  // un-complete (or a day-rollover reset) win over a stale complete instead of
  // being resurrected by a grow-union merge.
  const [routineCompletionTimestamps, setRoutineCompletionTimestamps] = useState(() => loadRoutineState().timestamps);
  const [showRoutinesDashboard, setShowRoutinesDashboard] = useState(false);
  const [dashboardSelectedChips, setDashboardSelectedChips] = useState([]);
  const [routineAddingToBucket, setRoutineAddingToBucket] = useState(null);
  const [routineNewChipName, setRoutineNewChipName] = useState('');
  const [routineTimePickerChipId, setRoutineTimePickerChipId] = useState(null);
  const [routineDeleteConfirm, setRoutineDeleteConfirm] = useState(null); // { bucket, chipId, chipName }
  const [routineFocusedChipId, setRoutineFocusedChipId] = useState(null); // touch: first tap shows buttons, second executes
  const [routineDurationEditId, setRoutineDurationEditId] = useState(null); // id of routine chip being duration-edited on timeline
  const [routinesEnabled, setRoutinesEnabled] = useState(() => {
    // If the user has an explicit stored preference, use it.
    const stored = localStorage.getItem('day-planner-routines-enabled');
    if (stored !== null) return JSON.parse(stored);
    // No stored preference: default OFF for new installs, but ON if the user
    // already has routine data (upgrade migration — don't silently disable their routines).
    try {
      const existing = JSON.parse(localStorage.getItem('day-planner-routine-definitions') || 'null');
      if (existing) {
        const hasAny = Object.values(existing).some(arr => arr.length > 0);
        if (hasAny) return true;
      }
    } catch (_) {}
    return false;
  });

  // Persist completions to localStorage
  useEffect(() => {
    localStorage.setItem('day-planner-routine-completions', JSON.stringify(routineCompletions));
  }, [routineCompletions]);

  // Persist completion timestamps (the sync LWW key) alongside the completions.
  useEffect(() => {
    localStorage.setItem('day-planner-routine-completion-timestamps', JSON.stringify(routineCompletionTimestamps));
  }, [routineCompletionTimestamps]);

  // Auto-clear today's routines on day rollover
  useEffect(() => {
    const todayStr = dateToString(new Date());
    if (routinesDate && routinesDate !== todayStr) {
      setTodayRoutines([]);
      setRoutinesDate(todayStr);
      setRemovedTodayRoutineIds({});
      setRoutineCompletions({});
      // Don't just drop the completion timestamps — a bare clear leaves no
      // signal, so any device/vault snapshot still holding yesterday's
      // completion (with yesterday's timestamp) wins the LWW merge and
      // resurrects it, making a freshly-added routine show up completed today
      // (same zombie-resurrection class as the recycle-bin delete fix).
      // Instead, stamp a fresh tombstone (completion absent, timestamp = now)
      // for every id that carried a completion or an old timestamp, so the
      // cleared state out-dates the stale remote completion and heals it.
      // Stamp the reset at local midnight of the new day — the same instant the
      // load-time reset uses — so an un-complete made later today on another
      // device still out-dates this tombstone and wins the merge.
      const midnightIso = startOfTodayIso();
      const tombstones = {};
      for (const id of new Set([
        ...Object.keys(routineCompletions),
        ...Object.keys(routineCompletionTimestamps),
      ])) {
        tombstones[id] = midnightIso;
      }
      setRoutineCompletionTimestamps(tombstones);
      localStorage.removeItem('day-planner-removed-today-routine-ids');
      localStorage.setItem('day-planner-routine-completions', '{}');
      localStorage.setItem('day-planner-routine-completion-timestamps', JSON.stringify(tombstones));
    }
    // routineCompletions/routineCompletionTimestamps are read only to build the
    // rollover tombstones; the guard above no-ops every other (toggle-driven) run.
  }, [currentTime, routinesDate, routineCompletions, routineCompletionTimestamps]);

  const toggleRoutineCompletion = (routineId) => {
    const todayStr = dateToString(new Date());
    setRoutineCompletions(prev => {
      const next = { ...prev };
      if (next[routineId]) {
        delete next[routineId];
      } else {
        next[routineId] = todayStr;
      }
      return next;
    });
    // Stamp the toggle (complete AND un-complete) so sync resolves the latest
    // state by last-writer-wins instead of grow-unioning the completion back.
    setRoutineCompletionTimestamps(prev => ({ ...prev, [routineId]: new Date().toISOString() }));
  };

  // Pre-populate the dashboard center with the given owner's placed routines.
  const selectTodayChipsForOwner = (owner) => {
    setDashboardSelectedChips(
      todayRoutines
        .filter(r => ownedByOwner(r, owner))
        .map(r => ({ id: r.id, name: r.name, bucket: r.bucket, startTime: r.startTime || null }))
    );
  };

  const openRoutinesDashboard = () => {
    // Pre-populate center with the active owner's chips already placed today
    selectTodayChipsForOwner(currentOwner());
    setRoutineAddingToBucket(null);
    setRoutineNewChipName('');
    setShowRoutinesDashboard(true);
  };

  const addRoutineChip = (bucket) => {
    const name = routineNewChipName.trim();
    if (!name) return;
    const chipId = crypto.randomUUID();
    const owner = currentOwner();
    setRoutineDefinitions(prev => ({
      ...prev,
      [bucket]: [...prev[bucket], { id: chipId, name, ...(owner ? { ownerSyncId: owner } : {}), lastModified: new Date().toISOString() }]
    }));
    setRoutineNewChipName('');
    setRoutineAddingToBucket(null);
  };

  const deleteRoutineChip = (bucket, chipId) => {
    setRoutineDefinitions(prev => ({
      ...prev,
      [bucket]: prev[bucket].filter(c => c.id !== chipId)
    }));
    // Also remove from dashboard selected and today's routines if present
    setDashboardSelectedChips(prev => prev.filter(c => c.id !== chipId));
    setTodayRoutines(prev => prev.filter(r => r.id !== chipId));
    // Record tombstone so deletion syncs across devices
    const tombstones = JSON.parse(localStorage.getItem('day-planner-deleted-routine-chip-ids') || '{}');
    tombstones[String(chipId)] = new Date().toISOString();
    // Prune tombstones older than 90 days
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    for (const id in tombstones) {
      if (new Date(tombstones[id]).getTime() < cutoff) delete tombstones[id];
    }
    localStorage.setItem('day-planner-deleted-routine-chip-ids', JSON.stringify(tombstones));
  };

  const toggleRoutineChipSelection = (chip, bucket) => {
    const isSelected = dashboardSelectedChips.some(c => c.id === chip.id);
    if (isSelected) {
      setDashboardSelectedChips(prev => prev.filter(c => c.id !== chip.id));
    } else {
      const existingRoutine = todayRoutines.find(r => r.id === chip.id);
      setDashboardSelectedChips(prev => [...prev, { id: chip.id, name: chip.name, bucket, startTime: existingRoutine?.startTime || null }]);
    }
  };

  const handleRoutinesDone = () => {
    const todayStr = dateToString(new Date());
    const owner = currentOwner();
    // Preserve placement info for chips that were already placed on the timeline
    const existingMap = {};
    todayRoutines.forEach(r => { existingMap[r.id] = r; });

    const now = new Date().toISOString();
    const newTodayRoutines = dashboardSelectedChips.map(chip => {
      const existing = existingMap[chip.id];
      if (existing) {
        // chip.startTime reflects any time set in the modal; fall back to the
        // existing DnD-placed time so that opening and closing the modal without
        // touching the time picker never unschedules a placed routine.
        const startTime = chip.startTime !== null ? chip.startTime : (existing.startTime || null);
        return { ...existing, name: chip.name, bucket: chip.bucket, startTime, isAllDay: !startTime, ...(owner ? { ownerSyncId: existing.ownerSyncId ?? owner } : {}), lastModified: now };
      }
      return { id: chip.id, name: chip.name, bucket: chip.bucket, startTime: chip.startTime || null, duration: 15, isAllDay: !chip.startTime, ...(owner ? { ownerSyncId: owner } : {}), lastModified: now };
    });

    // Record tombstones for the active owner's routines that were removed from
    // today's list so the removal syncs. Other members' entries are left alone.
    const newIds = new Set(newTodayRoutines.map(r => String(r.id)));
    const removedIds = todayRoutines.filter(r => ownedByOwner(r, owner) && !newIds.has(String(r.id)));
    if (removedIds.length > 0) {
      setRemovedTodayRoutineIds(prev => {
        const updated = { ...prev };
        removedIds.forEach(r => { updated[String(r.id)] = now; });
        return updated;
      });
    }
    // Clear tombstones for routines that were re-added
    const prevIds = new Set(todayRoutines.map(r => String(r.id)));
    const readdedIds = newTodayRoutines.filter(r => !prevIds.has(String(r.id)));
    if (readdedIds.length > 0) {
      setRemovedTodayRoutineIds(prev => {
        const updated = { ...prev };
        readdedIds.forEach(r => { delete updated[String(r.id)]; });
        return updated;
      });
    }

    // Replace only the active owner's today routines; keep other members'.
    setTodayRoutines(prev => [...prev.filter(r => !ownedByOwner(r, owner)), ...newTodayRoutines]);
    setRoutinesDate(todayStr);
    setShowRoutinesDashboard(false);
    setRoutineTimePickerChipId(null);
    setRoutineFocusedChipId(null);
    if (!onboardingProgress.hasSetupRoutines) {
      setOnboardingProgress(prev => ({ ...prev, hasSetupRoutines: true }));
    }
  };

  return {
    routineDefinitions, setRoutineDefinitions,
    todayRoutines, setTodayRoutines,
    routinesDate, setRoutinesDate,
    removedTodayRoutineIds, setRemovedTodayRoutineIds,
    showRoutinesDashboard, setShowRoutinesDashboard,
    dashboardSelectedChips, setDashboardSelectedChips,
    routineAddingToBucket, setRoutineAddingToBucket,
    routineNewChipName, setRoutineNewChipName,
    routineTimePickerChipId, setRoutineTimePickerChipId,
    routineDeleteConfirm, setRoutineDeleteConfirm,
    routineFocusedChipId, setRoutineFocusedChipId,
    routineDurationEditId, setRoutineDurationEditId,
    routinesEnabled, setRoutinesEnabled,
    routineCompletions, setRoutineCompletions,
    routineCompletionTimestamps, setRoutineCompletionTimestamps,
    toggleRoutineCompletion,
    openRoutinesDashboard,
    addRoutineChip,
    deleteRoutineChip,
    toggleRoutineChipSelection,
    handleRoutinesDone,
    selectTodayChipsForOwner,
  };
};

export default useRoutines;
