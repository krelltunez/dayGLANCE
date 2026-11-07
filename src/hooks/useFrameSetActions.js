// The Frames UI's frame-set actions (#2305): create, rename, switch for today,
// plan periods, delete. Pure edits in utils/frameSetEdits.js; this binds them
// to state.
//
// While the stored sets could not be read (`frameSets` undefined), every
// action is refused: a list built from nothing would be pushed as the whole
// collection and read by the vault tier as every other set deleted (not
// loaded is not empty, utils/storedSlices.js readFrameSets).

import { useCallback } from 'react';
import {
  newFrameSet, renameFrameSet, switchFrameSet, setFrameSetPeriods,
  detachFramesFromSet, recordFrameSetTombstones,
} from '../utils/frameSetEdits.js';

const nowIso = () => new Date().toISOString();
const randomId = () => crypto.randomUUID();

/**
 * @param {object} deps
 * @param {Array|undefined} deps.frameSets
 * @param {Function} deps.setFrameSets
 * @param {Function} deps.setGtdFrames
 * @param {Function} deps.getTodayStr   today, 'YYYY-MM-DD', on the user's clock
 * @param {Function} [deps.pushUndo]    useUndo's; a set deletion is one step
 * @param {Function} [deps.setUndoToast] says what was deleted, with its Undo button
 * @param {{current: string|null}} [deps.ownerRef]  multi-user: the owner a new set is stamped with
 * @param {Function} [deps.newId]
 */
export default function useFrameSetActions({
  frameSets, setFrameSets, setGtdFrames, getTodayStr, pushUndo, setUndoToast, ownerRef,
  newId = randomId,
}) {
  const loaded = Array.isArray(frameSets);

  const createFrameSet = useCallback((name) => {
    if (!loaded || !String(name ?? '').trim()) return null;
    const set = newFrameSet({ id: newId(), name, now: nowIso(), ownerSyncId: ownerRef?.current ?? null });
    setFrameSets((prev) => (Array.isArray(prev) ? [...prev, set] : prev));
    return set.id;
  }, [loaded, newId, ownerRef, setFrameSets]);

  const renameSet = useCallback((id, name) => {
    if (!loaded) return;
    setFrameSets((prev) => renameFrameSet(prev, id, name, nowIso()));
  }, [loaded, setFrameSets]);

  const switchSet = useCallback((id, on) => {
    if (!loaded) return;
    setFrameSets((prev) => switchFrameSet(prev, id, on, getTodayStr(), nowIso()));
  }, [loaded, getTodayStr, setFrameSets]);

  const setPeriods = useCallback((id, periods) => {
    if (!loaded) return;
    setFrameSets((prev) => setFrameSetPeriods(prev, id, periods, nowIso()));
  }, [loaded, setFrameSets]);

  // Deleting a set unassigns its frames in the same step, and is one undo
  // step covering both (useUndo restores the set and the frames' setId).
  const deleteSet = useCallback((id) => {
    if (!loaded) return;
    const set = frameSets.find((s) => s && String(s.id) === String(id));
    if (!set) return;
    const said = pushUndo?.({ key: 'frameSetDeleted', title: set.name, frameSetIds: [String(id)] });
    const now = nowIso();
    recordFrameSetTombstones([id], now);
    setFrameSets((prev) => (Array.isArray(prev) ? prev.filter((s) => !s || String(s.id) !== String(id)) : prev));
    setGtdFrames((prev) => detachFramesFromSet(prev, id, now));
    if (said) setUndoToast?.({ message: said, actionable: true });
  }, [loaded, frameSets, pushUndo, setUndoToast, setFrameSets, setGtdFrames]);

  return {
    frameSetsLoaded: loaded,
    createFrameSet,
    renameFrameSet: renameSet,
    switchFrameSet: switchSet,
    setFrameSetPeriods: setPeriods,
    deleteFrameSet: deleteSet,
  };
}
