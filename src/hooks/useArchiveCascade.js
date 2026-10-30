import { useCallback, useRef } from 'react';
import { planProjectStatusChange, planGoalStatusChange } from '../utils/archiveCascade.js';

// Archiving or restoring a project/goal changes the rows under it, and the
// archive records which ones so a restore can put them back (#2260,
// utils/archiveCascade.js). App wraps the store's updateProject / updateGoal
// with these, so every path that sets a status reaches the same cascade: the
// forms, the Archived list, an intent.
//
// The plans read the rows through live refs, so the returned functions keep
// their identity across renders (they are deps of many effects).
export default function useArchiveCascade({
  projects, goals, tasksLiveRef, unscheduledLiveRef,
  updateProjectEntity, updateGoalEntity, setTasks, setUnscheduledTasks, setProjects,
}) {
  const projectsLiveRef = useRef(projects);
  projectsLiveRef.current = projects;
  const goalsLiveRef = useRef(goals);
  goalsLiveRef.current = goals;

  const updateProject = useCallback((id, updates) => {
    const project = projectsLiveRef.current.find(p => p.id === id);
    const plan = planProjectStatusChange(project, updates, [...tasksLiveRef.current, ...unscheduledLiveRef.current]);
    if (plan) {
      setTasks(plan.rowsUpdater);
      setUnscheduledTasks(plan.rowsUpdater);
    }
    updateProjectEntity(id, plan ? { ...updates, ...plan.projectUpdates } : updates);
  }, [tasksLiveRef, unscheduledLiveRef, updateProjectEntity, setTasks, setUnscheduledTasks]);

  const updateGoal = useCallback((id, updates) => {
    const goal = goalsLiveRef.current.find(g => g.id === id);
    const plan = planGoalStatusChange(goal, updates, projectsLiveRef.current);
    if (plan) setProjects(plan.projectsUpdater);
    updateGoalEntity(id, plan ? { ...updates, ...plan.goalUpdates } : updates);
  }, [updateGoalEntity, setProjects]);

  return { updateProject, updateGoal };
}
