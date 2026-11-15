import { useState, useEffect } from 'react';
import { writeItem } from '../utils/storageWrites.js';
import { expiredBinItems } from '../utils/recycleBinRetention.js';

export default function useRecycleBin({
  recycleBin,
  setRecycleBin,
  pushUndo,
  setTasks,
  setUnscheduledTasks,
  playUISound,
  onStorageFull,
  // Told what a per-task delete did, in words (or null), to offer its undo.
  onDeleted,
  // Automatic emptying (#2141): days after which a bin item is removed for
  // good, 0 for never. Runs once the data has loaded and whenever the setting
  // changes; the app reloads every night, which makes that a daily sweep.
  autoEmptyDays = 0,
  dataLoaded = false,
  isTrayMode = false,
}) {
  const [showEmptyBinConfirm, setShowEmptyBinConfirm] = useState(false);
  const [showMobileRecycleBin, setShowMobileRecycleBin] = useState(false);

  const undeleteTask = (id) => {
    pushUndo({ key: 'restored', taskId: id });
    const task = recycleBin.find(t => t.id === id);
    if (task) {
      // Drop the deletion metadata and re-stamp lastModified to "now" so the
      // restore wins against the bin entry on other devices (whose deletedAt is
      // the deletion-time stamp). Without a fresher lastModified the cross-list
      // reconciliation would just send the task straight back to the bin.
      const { _deletedFrom, deletedAt, ...rest } = task;
      const cleanTask = { ...rest, lastModified: new Date().toISOString() };

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

  // Record tombstones for permanently deleted tasks (prevents resurrection during merge sync).
  // PROVENANCE (see utils/retiredTaskIds.js): user-pressed delete — intent
  // known, no successor — so deletedTaskIds, never retiredTaskIds (the
  // commit-that-renames' channel) or deletedObsidianKeys (the detector's).
  // The automatic empty is the user's standing choice, so the same channel.
  //
  // The tombstones are what license the deletion on other devices, so a bin
  // emptied without them comes back on the next sync. Returns false when they
  // cannot be written (storage full); the caller then removes nothing (#2139).
  const writeBinTombstones = (items) => {
    let tombstones = {};
    try { tombstones = JSON.parse(localStorage.getItem('day-planner-deleted-task-ids') || '{}') || {}; } catch { tombstones = {}; }
    const now = new Date().toISOString();
    items.forEach(t => { tombstones[String(t.id)] = now; });
    return writeItem('day-planner-deleted-task-ids', JSON.stringify(tombstones));
  };

  // Deindex permanently deleted tasks from Spotlight so they don't linger.
  const deindex = (items) => {
    try {
      const ids = items.map(t => String(t.id));
      if (ids.length > 0) window.DayGlanceNative?.deindexSpotlight?.(JSON.stringify(ids));
    } catch (_) {}
  };

  const confirmEmptyBin = () => {
    if (!writeBinTombstones(recycleBin)) {
      setShowEmptyBinConfirm(false);
      onStorageFull?.();
      return;
    }
    pushUndo({ key: 'binEmptied' });
    deindex(recycleBin);
    setRecycleBin([]);
    setShowEmptyBinConfirm(false);
    setShowMobileRecycleBin(false);
    playUISound('crumple');
  };

  // One task, for good (#2406): the same tombstone, undo step and deindex as
  // emptying the bin, for the task the user pointed at. Nothing is removed
  // when the tombstone cannot be written.
  const deleteFromBin = (id) => {
    const task = recycleBin.find(t => String(t.id) === String(id));
    if (!task) return;
    if (!writeBinTombstones([task])) {
      onStorageFull?.();
      return;
    }
    const said = pushUndo({ key: 'binDeleted', taskId: id });
    deindex([task]);
    setRecycleBin(prev => prev.filter(t => String(t.id) !== String(id)));
    playUISound('crumple');
    // There is no confirmation to press, so the way back is said out loud.
    onDeleted?.(said);
  };

  // The automatic empty. No undo step and no sound: nobody pressed anything.
  // When the tombstones cannot be written nothing is removed, and the next
  // launch tries again.
  useEffect(() => {
    if (isTrayMode || !dataLoaded || !autoEmptyDays) return;
    const expired = expiredBinItems(recycleBin, autoEmptyDays);
    if (expired.length === 0 || !writeBinTombstones(expired)) return;
    deindex(expired);
    const ids = new Set(expired.map(t => String(t.id)));
    setRecycleBin(prev => prev.filter(t => !ids.has(String(t.id))));
    // Keyed on load and the setting, not on every bin change: a sweep per
    // launch is the cadence, and it keeps the purge out of sync applies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoaded, autoEmptyDays]);

  return {
    showEmptyBinConfirm,
    setShowEmptyBinConfirm,
    showMobileRecycleBin,
    setShowMobileRecycleBin,
    undeleteTask,
    emptyRecycleBin,
    confirmEmptyBin,
    deleteFromBin,
  };
}
