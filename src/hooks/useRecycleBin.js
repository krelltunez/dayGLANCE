import { useState } from 'react';

export default function useRecycleBin({
  recycleBin,
  setRecycleBin,
  pushUndo,
  setTasks,
  setUnscheduledTasks,
  playUISound,
}) {
  const [showEmptyBinConfirm, setShowEmptyBinConfirm] = useState(false);
  const [showMobileRecycleBin, setShowMobileRecycleBin] = useState(false);

  const undeleteTask = (id) => {
    pushUndo();
    const task = recycleBin.find(t => t.id === id);
    if (task) {
      const { _deletedFrom, ...cleanTask } = task; // Remove metadata

      if (_deletedFrom === 'inbox') {
        setUnscheduledTasks(prev => [...prev, cleanTask]);
      } else {
        setTasks(prev => [...prev, cleanTask]);
      }

      setRecycleBin(prev => prev.filter(t => t.id !== id));
      playUISound('restore');
    }
  };

  const emptyRecycleBin = () => {
    setShowEmptyBinConfirm(true);
  };

  const confirmEmptyBin = () => {
    pushUndo();
    // Record tombstones for permanently deleted tasks (prevents resurrection during merge sync)
    const tombstones = JSON.parse(localStorage.getItem('day-planner-deleted-task-ids') || '{}');
    const now = new Date().toISOString();
    recycleBin.forEach(t => { tombstones[String(t.id)] = now; });
    localStorage.setItem('day-planner-deleted-task-ids', JSON.stringify(tombstones));
    // Deindex permanently deleted tasks from Spotlight so they don't linger.
    try {
      const ids = recycleBin.map(t => String(t.id));
      if (ids.length > 0) window.DayGlanceNative?.deindexSpotlight?.(JSON.stringify(ids));
    } catch (_) {}
    setRecycleBin([]);
    setShowEmptyBinConfirm(false);
    setShowMobileRecycleBin(false);
    playUISound('crumple');
  };

  return {
    showEmptyBinConfirm,
    setShowEmptyBinConfirm,
    showMobileRecycleBin,
    setShowMobileRecycleBin,
    undeleteTask,
    emptyRecycleBin,
    confirmEmptyBin,
  };
}
