import { useState, useRef, useEffect } from 'react';

const useUndo = ({ tasks, unscheduledTasks, recycleBin, recurringTasks, setTasks, setUnscheduledTasks, setRecycleBin, setRecurringTasks, playUISound }) => {
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const tasksRef = useRef(tasks);
  const unscheduledTasksRef = useRef(unscheduledTasks);
  const recycleBinRef = useRef(recycleBin);
  const recurringTasksRef = useRef(recurringTasks);

  const [undoToast, setUndoToast] = useState(null);

  // Keep refs in sync with state
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { unscheduledTasksRef.current = unscheduledTasks; }, [unscheduledTasks]);
  useEffect(() => { recycleBinRef.current = recycleBin; }, [recycleBin]);
  useEffect(() => { recurringTasksRef.current = recurringTasks; }, [recurringTasks]);

  // Auto-dismiss undo/redo toast — 4s for actionable (with Undo button), 2s for passive
  useEffect(() => {
    if (!undoToast) return;
    const delay = undoToast.actionable ? 4000 : 2000;
    const timer = setTimeout(() => setUndoToast(null), delay);
    return () => clearTimeout(timer);
  }, [undoToast]);

  // Undo/redo: snapshot all 4 state arrays (read from refs for latest state)
  const pushUndo = () => {
    undoStackRef.current = [
      ...undoStackRef.current.slice(-49),
      {
        tasks: structuredClone(tasksRef.current),
        unscheduledTasks: structuredClone(unscheduledTasksRef.current),
        recycleBin: structuredClone(recycleBinRef.current),
        recurringTasks: structuredClone(recurringTasksRef.current),
      }
    ];
    redoStackRef.current = [];
  };

  const performUndo = () => {
    if (undoStackRef.current.length === 0) return;
    const snapshot = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [
      ...redoStackRef.current,
      {
        tasks: structuredClone(tasksRef.current),
        unscheduledTasks: structuredClone(unscheduledTasksRef.current),
        recycleBin: structuredClone(recycleBinRef.current),
        recurringTasks: structuredClone(recurringTasksRef.current),
      }
    ];
    setTasks(prev => [...snapshot.tasks.filter(t => !t._native), ...prev.filter(t => t._native)]);
    setUnscheduledTasks(snapshot.unscheduledTasks);
    setRecycleBin(snapshot.recycleBin);
    setRecurringTasks(snapshot.recurringTasks);
    playUISound('undo');
    setUndoToast({ message: 'Undone', actionable: false });
  };

  const performRedo = () => {
    if (redoStackRef.current.length === 0) return;
    const snapshot = redoStackRef.current[redoStackRef.current.length - 1];
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [
      ...undoStackRef.current,
      {
        tasks: structuredClone(tasksRef.current),
        unscheduledTasks: structuredClone(unscheduledTasksRef.current),
        recycleBin: structuredClone(recycleBinRef.current),
        recurringTasks: structuredClone(recurringTasksRef.current),
      }
    ];
    setTasks(prev => [...snapshot.tasks.filter(t => !t._native), ...prev.filter(t => t._native)]);
    setUnscheduledTasks(snapshot.unscheduledTasks);
    setRecycleBin(snapshot.recycleBin);
    setRecurringTasks(snapshot.recurringTasks);
    playUISound('undo');
    setUndoToast({ message: 'Redone', actionable: false });
  };

  return { undoToast, setUndoToast, pushUndo, performUndo, performRedo };
};

export default useUndo;
