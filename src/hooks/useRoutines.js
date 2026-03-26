import { useState, useEffect } from 'react';
import { dateToString } from '../utils/taskUtils.js';

const useRoutines = ({ currentTime, onboardingProgress, setOnboardingProgress }) => {
  const [routineDefinitions, setRoutineDefinitions] = useState({ monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [], everyday: [] });
  const [todayRoutines, setTodayRoutines] = useState([]);
  const [routinesDate, setRoutinesDate] = useState('');
  const [removedTodayRoutineIds, setRemovedTodayRoutineIds] = useState({});
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

  // Auto-clear today's routines on day rollover
  useEffect(() => {
    const todayStr = dateToString(new Date());
    if (routinesDate && routinesDate !== todayStr) {
      setTodayRoutines([]);
      setRoutinesDate(todayStr);
      setRemovedTodayRoutineIds({});
      localStorage.removeItem('day-planner-removed-today-routine-ids');
    }
  }, [currentTime]);

  const openRoutinesDashboard = () => {
    // Pre-populate center with chips already placed today
    setDashboardSelectedChips(todayRoutines.map(r => ({ id: r.id, name: r.name, bucket: r.bucket, startTime: r.startTime || null })));
    setRoutineAddingToBucket(null);
    setRoutineNewChipName('');
    setShowRoutinesDashboard(true);
  };

  const addRoutineChip = (bucket) => {
    const name = routineNewChipName.trim();
    if (!name) return;
    const chipId = crypto.randomUUID();
    setRoutineDefinitions(prev => ({
      ...prev,
      [bucket]: [...prev[bucket], { id: chipId, name, lastModified: new Date().toISOString() }]
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
      setDashboardSelectedChips(prev => [...prev, { id: chip.id, name: chip.name, bucket, startTime: null }]);
    }
  };

  const handleRoutinesDone = () => {
    const todayStr = dateToString(new Date());
    // Preserve placement info for chips that were already placed on the timeline
    const existingMap = {};
    todayRoutines.forEach(r => { existingMap[r.id] = r; });

    const now = new Date().toISOString();
    const newTodayRoutines = dashboardSelectedChips.map(chip => {
      const existing = existingMap[chip.id];
      if (existing) {
        return { ...existing, name: chip.name, bucket: chip.bucket, startTime: chip.startTime, isAllDay: !chip.startTime, lastModified: now };
      }
      return { id: chip.id, name: chip.name, bucket: chip.bucket, startTime: chip.startTime || null, duration: 15, isAllDay: !chip.startTime, lastModified: now };
    });

    // Record tombstones for routines that were removed from today's list
    // so the removal syncs across devices instead of being re-added by merge.
    const newIds = new Set(newTodayRoutines.map(r => String(r.id)));
    const removedIds = todayRoutines.filter(r => !newIds.has(String(r.id)));
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

    setTodayRoutines(newTodayRoutines);
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
    openRoutinesDashboard,
    addRoutineChip,
    deleteRoutineChip,
    toggleRoutineChipSelection,
    handleRoutinesDone,
  };
};

export default useRoutines;
