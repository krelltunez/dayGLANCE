import { useState, useRef } from 'react';
import { dateToString } from '../utils/taskUtils.js';

export default function useDeadlinePriority({
  unscheduledTasks,
  setUnscheduledTasks,
  pushUndo,
  playUISound,
  onboardingProgress,
  setOnboardingProgress,
}) {
  const [pendingPriorities, setPendingPriorities] = useState({});
  const priorityTimeouts = useRef({});

  // Get inbox tasks with deadlines for a specific date (not overdue)
  const getDeadlineTasksForDate = (dateStr) => {
    const todayStr = dateToString(new Date());
    return unscheduledTasks.filter(t =>
      t.deadline === dateStr && (t.deadline >= todayStr || t.completed)
    );
  };

  const cyclePriority = (taskId) => {
    pushUndo();
    const task = unscheduledTasks.find(t => t.id === taskId);
    const currentPriority = pendingPriorities[taskId] ?? task?.priority ?? 0;
    const newPriority = (currentPriority + 1) % 4;

    // Update visual immediately
    setPendingPriorities(prev => ({ ...prev, [taskId]: newPriority }));
    playUISound('click');

    // Track for onboarding
    if (!onboardingProgress.hasSetPriority) {
      setOnboardingProgress(prev => ({ ...prev, hasSetPriority: true }));
    }

    // Cancel any pending timeout for this task
    if (priorityTimeouts.current[taskId]) {
      clearTimeout(priorityTimeouts.current[taskId]);
    }

    // Update actual priority (triggers reorder) after delay
    // Longer delay allows for multiple clicks to reach desired priority
    priorityTimeouts.current[taskId] = setTimeout(() => {
      setUnscheduledTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, priority: newPriority } : t
      ));
      setPendingPriorities(prev => {
        const { [taskId]: _, ...rest } = prev;
        return rest;
      });
      delete priorityTimeouts.current[taskId];
    }, 1200);
  };

  return {
    pendingPriorities,
    cyclePriority,
    getDeadlineTasksForDate,
  };
}
