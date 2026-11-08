// The Frames UI's frame-set actions (#2305): create, rename, switch for today,
// plan periods, delete, and move a frame into a set by dragging it (#2335). Pure edits in utils/frameSetEdits.js; this binds them
// to state.
//
// While the stored sets could not be read (`frameSets` undefined), every
// action is refused: a list built from nothing would be pushed as the whole
// collection and read by the vault tier as every other set deleted (not
// loaded is not empty, utils/storedSlices.js readFrameSets).

import { useCallback } from 'react';
import {
  newFrameSet, renameFrameSet, switchFrameSet, setFrameSetPeriods,
  detachFramesFromSet, recordFrameSetTombstones, moveFrameToSet,
} from '../utils/frameSetEdits.js';
import { findFrameOverlap } from '../utils/frameOverlap.js';

const nowIso = () => new Date().toISOString();
const randomId = () => crypto.randomUUID();

/**
 * @param {object} deps
 * @param {Array|undefined} deps.frameSets
 * @param {Function} deps.setFrameSets
 * @param {Function} deps.setGtdFrames
 * @param {Array} [deps.gtdFrames]     every frame, which a move is checked against
 * @param {Function} deps.getTodayStr   today, 'YYYY-MM-DD', on the user's clock
 * @param {Function} [deps.pushUndo]    useUndo's; a set deletion is one step
 * @param {Function} [deps.setUndoToast] says what was deleted, with its Undo button
 * @param {{current: string|null}} [deps.ownerRef]  multi-user: the owner a new set is stamped with
 * @param {string} [deps.alwaysLabel]  what the undo step calls "no set" ("Always")
 * @param {Function} [deps.newId]
 */
export default function useFrameSetActions({
  frameSets, setFrameSets, gtdFrames, setGtdFrames, getTodayStr, pushUndo, setUndoToast, ownerRef,
  alwaysLabel = '', newId = randomId,
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

  // Dragging a frame into a set, or into "Always" (setId null). Held to the
  // editor's overlap rule (utils/frameOverlap.js): leaving a set, or joining
  // one, changes which frames it may overlap, and a drop must not make a
  // clash the editor would refuse. Refused, it changes nothing and says which
  // frame is in the way; moved, it is one undo step.
  //
  // @returns {{ ok: true } | { ok: false, overlap?: { frame, days } }}
  const moveFrame = useCallback((frameId, setId) => {
    if (!loaded) return { ok: false };
    const frame = (gtdFrames || []).find((f) => f && String(f.id) === String(frameId));
    if (!frame) return { ok: false };
    const target = setId == null || setId === '' ? null : setId;
    const set = target === null ? null : frameSets.find((s) => s && String(s.id) === String(target));
    if (target !== null && !set) return { ok: false };
    const current = frame.setId == null || frame.setId === '' ? null : String(frame.setId);
    if (current === (target === null ? null : String(target))) return { ok: true };
    const overlap = findFrameOverlap({ ...frame, setId: target ?? '' }, gtdFrames);
    if (overlap) return { ok: false, overlap };
    const said = pushUndo?.({ key: 'frameMoved', title: frame.label, set: set ? set.name : alwaysLabel });
    setGtdFrames((prev) => moveFrameToSet(prev, frameId, target, nowIso()));
    if (said) setUndoToast?.({ message: said, actionable: true });
    return { ok: true };
  }, [loaded, gtdFrames, frameSets, alwaysLabel, pushUndo, setUndoToast, setGtdFrames]);

  return {
    frameSetsLoaded: loaded,
    moveFrameToSet: moveFrame,
    createFrameSet,
    renameFrameSet: renameSet,
    switchFrameSet: switchSet,
    setFrameSetPeriods: setPeriods,
    deleteFrameSet: deleteSet,
  };
}
