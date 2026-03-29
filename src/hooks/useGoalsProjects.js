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
      ...fields,
      id: crypto.randomUUID(),
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
  }, []);

  return {
    goals, setGoals,
    projects, setProjects,
    showGoalsDashboard, setShowGoalsDashboard,
    goalsProjectsEnabled, setGoalsProjectsEnabled,
    addGoal, updateGoal, deleteGoal,
    addProject, updateProject, deleteProject,
  };
};

export default useGoalsProjects;
