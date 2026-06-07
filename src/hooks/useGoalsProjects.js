/**
 * Goals & Projects feature state and CRUD operations.
 *
 * Follows the same pattern as useHabits and useRoutines:
 *   - State is initialised lazily from localStorage
 *   - Enabled flag defaults OFF for new installs; auto-enables if data already
 *     exists (upgrade migration path)
 *   - CRUD functions return the new/updated object so callers can chain
 */

import { useState, useCallback } from 'react';

const useGoalsProjects = () => {
  const [goals, setGoals] = useState([]);
  const [projects, setProjects] = useState([]);
  const [showGoalsDashboard, setShowGoalsDashboard] = useState(false);

  const [goalsProjectsEnabled, setGoalsProjectsEnabled] = useState(() => {
    const stored = localStorage.getItem('day-planner-goals-projects-enabled');
    if (stored !== null) return JSON.parse(stored);
    // Default OFF for new installs; ON if data already exists (upgrade migration)
    try {
      const existingGoals = JSON.parse(localStorage.getItem('day-planner-goals') || '[]');
      const existingProjects = JSON.parse(localStorage.getItem('day-planner-projects') || '[]');
      if (existingGoals.length > 0 || existingProjects.length > 0) return true;
    } catch (_) {}
    return false;
  });

  // ── Goal CRUD ────────────────────────────────────────────────────────────────

  const addGoal = useCallback((fields) => {
    const now = new Date().toISOString();
    const newGoal = {
      status: 'active',
      id: crypto.randomUUID(),
      ...fields,
      createdAt: now,
      updatedAt: now,
    };
    setGoals(prev => [...prev, newGoal]);
    return newGoal;
  }, []);

  const updateGoal = useCallback((id, updates) => {
    setGoals(prev => prev.map(g =>
      g.id === id
        ? { ...g, ...updates, updatedAt: new Date().toISOString() }
        : g
    ));
  }, []);

  const deleteGoal = useCallback((id) => {
    setGoals(prev => prev.filter(g => g.id !== id));
    // Record tombstone so cloud sync doesn't resurrect the goal from other devices
    const tombstones = JSON.parse(localStorage.getItem('day-planner-deleted-goal-ids') || '{}');
    tombstones[String(id)] = new Date().toISOString();
    localStorage.setItem('day-planner-deleted-goal-ids', JSON.stringify(tombstones));
  }, []);

  // ── Project CRUD ─────────────────────────────────────────────────────────────

  const addProject = useCallback((fields) => {
    const now = new Date().toISOString();
    const newProject = {
      status: 'active',
      ...fields,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    setProjects(prev => [...prev, newProject]);
    return newProject;
  }, []);

  const updateProject = useCallback((id, updates) => {
    setProjects(prev => prev.map(p =>
      p.id === id
        ? { ...p, ...updates, updatedAt: new Date().toISOString() }
        : p
    ));
  }, []);

  const deleteProject = useCallback((id) => {
    setProjects(prev => prev.filter(p => p.id !== id));
    // Record tombstone so cloud sync doesn't resurrect the project from other devices
    const tombstones = JSON.parse(localStorage.getItem('day-planner-deleted-project-ids') || '{}');
    tombstones[String(id)] = new Date().toISOString();
    localStorage.setItem('day-planner-deleted-project-ids', JSON.stringify(tombstones));
  }, []);

  // Move a project to a new goal (or standalone) and optionally insert it before
  // a specific sibling. Renumbers sortOrder for affected groups so the order syncs.
  const moveProject = useCallback((projectId, newGoalId, insertBeforeProjectId = null) => {
    setProjects(prev => {
      const now = new Date().toISOString();
      const movedIdx = prev.findIndex(p => p.id === projectId);
      if (movedIdx === -1) return prev;

      const sourceGoalId = prev[movedIdx].goalId ?? null;
      const targetGoalId = newGoalId ?? null;

      // Build updated project with new goalId
      const moved = targetGoalId
        ? { ...prev[movedIdx], goalId: targetGoalId, updatedAt: now }
        : { ...prev[movedIdx], updatedAt: now, goalId: undefined };

      // Remove from current position
      const without = prev.filter((_, i) => i !== movedIdx);

      // Find insertion index in the without-array
      let insertAt;
      if (insertBeforeProjectId) {
        insertAt = without.findIndex(p => p.id === insertBeforeProjectId);
        if (insertAt === -1) insertAt = without.length;
      } else {
        // Append to end of target group
        let lastIdx = -1;
        without.forEach((p, i) => {
          if ((p.goalId ?? null) === targetGoalId) lastIdx = i;
        });
        insertAt = lastIdx === -1 ? without.length : lastIdx + 1;
      }

      const result = [...without];
      result.splice(insertAt, 0, moved);

      // Renumber sortOrder (0, 10, 20…) for both affected groups so order syncs
      const affectedGroups = new Set([sourceGoalId, targetGoalId]);
      const groupCounters = {};
      return result.map(p => {
        const gk = p.goalId ?? null;
        if (affectedGroups.has(gk)) {
          const order = groupCounters[gk] ?? 0;
          groupCounters[gk] = order + 10;
          return { ...p, sortOrder: order, updatedAt: now };
        }
        return p;
      });
    });
  }, []);

  return {
    goals, setGoals,
    projects, setProjects,
    showGoalsDashboard, setShowGoalsDashboard,
    goalsProjectsEnabled, setGoalsProjectsEnabled,
    addGoal, updateGoal, deleteGoal,
    addProject, updateProject, deleteProject, moveProject,
  };
};

export default useGoalsProjects;
