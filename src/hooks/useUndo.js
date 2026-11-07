import { useState, useRef, useEffect } from 'react';
import { restoreFrames } from '../utils/undoFrames.js';
import { restoreFrameSets, recordFrameSetTombstones } from '../utils/frameSetEdits.js';
import { describeUndoLabel } from '../utils/undoLabels.js';

// How long a toast stays. Each kind has a floor: 2s for a passive note, 4s
// for one with a button (Undo or Redo), 8s for a warning, which says
// something went wrong and may ask for something, and 10s for a follow-up
// offer, which is a decision about what comes next, not a reflex. Past the
// floor a toast stays long enough to read: a second, plus 60ms a character
// (about 200 words a minute), up to 15s.
export function toastDelay(toast) {
  const floor = toast.followUp ? 10000
    : toast.kind === 'warning' ? 8000
      : toast.actionable || toast.redoable ? 4000 : 2000;
  const reading = 1000 + 60 * String(toast.message ?? '').length;
  return Math.max(floor, Math.min(reading, 15000));
}

const useUndo = ({ tasks, unscheduledTasks, recycleBin, recurringTasks, gtdFrames, frameSets, setTasks, setUnscheduledTasks, setRecycleBin, setRecurringTasks, setGtdFrames, setFrameSets, playUISound, t }) => {
  // Toast text, translated when the app passes t (tests may not).
  const say = (key, fallback) => (typeof t === 'function' ? t(key) : fallback);
  // "Undone: Completed "Write report"" when the step says what it did, else
  // a plain "Undone" (utils/undoLabels.js).
  const report = (direction, said) => (said && typeof t === 'function'
    ? t(direction === 'undo' ? 'undo.undone' : 'undo.redone', { action: said })
    : direction === 'undo' ? say('common.undone', 'Undone') : say('common.redone', 'Redone'));
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const tasksRef = useRef(tasks);
  const unscheduledTasksRef = useRef(unscheduledTasks);
  const recycleBinRef = useRef(recycleBin);
  const recurringTasksRef = useRef(recurringTasks);
  const gtdFramesRef = useRef(gtdFrames);
  const frameSetsRef = useRef(frameSets);

  const [undoToast, setUndoToast] = useState(null);
  // Action steps (a JOBO Do edit) run one at a time, in the order pressed.
  const actionQueueRef = useRef(Promise.resolve());

  // Keep refs in sync with state
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { unscheduledTasksRef.current = unscheduledTasks; }, [unscheduledTasks]);
  useEffect(() => { recycleBinRef.current = recycleBin; }, [recycleBin]);
  useEffect(() => { recurringTasksRef.current = recurringTasks; }, [recurringTasks]);
  useEffect(() => { gtdFramesRef.current = gtdFrames; }, [gtdFrames]);

  // Auto-dismiss the toast after toastDelay. A toast the pointer or keyboard
  // is on (`held`) stays until it is left, then gets its full time again.
  useEffect(() => {
    if (!undoToast || undoToast.held) return;
    const timer = setTimeout(() => setUndoToast(null), toastDelay(undoToast));
    return () => clearTimeout(timer);
  }, [undoToast]);
  // After the toast's effect, which the toast tests run by position.
  useEffect(() => { frameSetsRef.current = frameSets; }, [frameSets]);

  // Undo/redo: snapshot the task arrays and Frames (read from refs for latest
  // state). Frame edits (skip a day, adjust, resize) push undo steps too, so a
  // snapshot without them would say "Undone" and change nothing.
  const takeSnapshot = () => ({
    tasks: structuredClone(tasksRef.current),
    unscheduledTasks: structuredClone(unscheduledTasksRef.current),
    recycleBin: structuredClone(recycleBinRef.current),
    recurringTasks: structuredClone(recurringTasksRef.current),
    ...(Array.isArray(gtdFramesRef.current) ? { gtdFrames: structuredClone(gtdFramesRef.current) } : {}),
    // Frame sets, for a step that names the sets it touched (frameSetIds):
    // deleting a set is one step with its frames' unassignment.
    ...(Array.isArray(frameSetsRef.current) ? { frameSets: structuredClone(frameSetsRef.current) } : {}),
  });

  const applySnapshot = (snapshot) => {
    setTasks(prev => [...snapshot.tasks.filter(t => !t._native), ...prev.filter(t => t._native)]);
    setUnscheduledTasks(snapshot.unscheduledTasks);
    setRecycleBin(snapshot.recycleBin);
    setRecurringTasks(snapshot.recurringTasks);
    // Frames come back per frame, freshly stamped (utils/undoFrames.js).
    if (snapshot.gtdFrames && setGtdFrames) setGtdFrames(prev => restoreFrames(prev, snapshot.gtdFrames, Date.now()));
    // Only the sets the step touched, and a set the step removed goes again
    // with its tombstone (utils/frameSetEdits.js restoreFrameSets).
    if (snapshot.frameSets && snapshot.frameSetIds?.length && setFrameSets) {
      const now = Date.now();
      const { sets, removed } = restoreFrameSets(frameSetsRef.current, snapshot.frameSets, snapshot.frameSetIds, now);
      if (removed.length) recordFrameSetTombstones(removed, new Date(now).toISOString());
      if (sets !== frameSetsRef.current) {
        frameSetsRef.current = sets;
        setFrameSets(sets);
      }
    }
  };

  // `label` says what the step does (`{ key, taskId }`, utils/undoLabels.js).
  // It is put into words now, before the change, while the task still has
  // the title it had, and the words come back so the caller's own toast can
  // say the same thing ("Completed "Write report"", with its Undo button).
  // Null when there is no label or it cannot be said.
  const pushUndo = (label) => {
    const said = describeUndoLabel(t, label, {
      tasks: tasksRef.current, unscheduledTasks: unscheduledTasksRef.current,
      recycleBin: recycleBinRef.current, recurringTasks: recurringTasksRef.current,
    });
    const frameSetIds = Array.isArray(label?.frameSetIds) ? label.frameSetIds : undefined;
    undoStackRef.current = [...undoStackRef.current.slice(-49), { ...takeSnapshot(), said, ...(frameSetIds ? { frameSetIds } : {}) }];
    redoStackRef.current = [];
    return said;
  };

  // A step that is not a task snapshot: something another subsystem can undo
  // and redo itself, such as a Do edit in JOBO. It shares this history, so
  // Cmd+Z reverses whatever was done last. `undo` and `redo` are async and
  // resolve to { ok, message }; `said` is what the step did, in words.
  const pushUndoAction = (action, said = null) => {
    undoStackRef.current = [...undoStackRef.current.slice(-49), { action, said }];
    redoStackRef.current = [];
  };

  // The step moves to the other stack at once, so the order of the two
  // stacks is the order pressed; it comes off again if it cannot run (the
  // record changed, or the write failed), and the toast says why.
  // An undo offers Redo, and a redo offers Undo, so a step taken back by
  // mistake is one press away on a phone too, where Redo is a hidden
  // three-finger hold.
  const wayBack = (direction) => (direction === 'undo' ? { redoable: true } : { actionable: true });

  const runAction = (entry, direction, otherStackRef) => {
    otherStackRef.current = [...otherStackRef.current, entry];
    actionQueueRef.current = actionQueueRef.current.then(async () => {
      let result;
      try { result = await entry.action[direction](); } catch { result = { ok: false }; }
      if (result?.ok) {
        playUISound('undo');
        // What the step did, so an undo that lands off screen still says
        // what changed, and the way back.
        setUndoToast({ message: entry.said ? report(direction, entry.said) : result.message || report(direction), ...wayBack(direction) });
      } else {
        otherStackRef.current = otherStackRef.current.filter((e) => e !== entry);
        setUndoToast({ message: result?.message || (direction === 'undo' ? say('common.undoFailed', 'Could not undo') : say('common.redoFailed', 'Could not redo')), kind: 'warning' });
      }
    });
  };

  const performUndo = () => {
    if (undoStackRef.current.length === 0) {
      setUndoToast({ message: say('undo.nothingToUndo', 'Nothing to undo') });
      return;
    }
    const snapshot = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    if (snapshot.action) { runAction(snapshot, 'undo', redoStackRef); return; }
    // The redo step says the same thing as the step it reverses.
    redoStackRef.current = [...redoStackRef.current, { ...takeSnapshot(), said: snapshot.said, frameSetIds: snapshot.frameSetIds }];
    applySnapshot(snapshot);
    playUISound('undo');
    setUndoToast({ message: report('undo', snapshot.said), ...wayBack('undo') });
  };

  const performRedo = () => {
    if (redoStackRef.current.length === 0) {
      setUndoToast({ message: say('undo.nothingToRedo', 'Nothing to redo') });
      return;
    }
    const snapshot = redoStackRef.current[redoStackRef.current.length - 1];
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    if (snapshot.action) { runAction(snapshot, 'redo', undoStackRef); return; }
    undoStackRef.current = [...undoStackRef.current, { ...takeSnapshot(), said: snapshot.said, frameSetIds: snapshot.frameSetIds }];
    applySnapshot(snapshot);
    playUISound('undo');
    setUndoToast({ message: report('redo', snapshot.said), ...wayBack('redo') });
  };

  return { undoToast, setUndoToast, pushUndo, pushUndoAction, performUndo, performRedo };
};

export default useUndo;
