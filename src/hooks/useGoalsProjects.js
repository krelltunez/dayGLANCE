/**
 * Goals & Projects feature state and CRUD operations.
 *
 * Follows the same pattern as useHabits and useRoutines:
 *   - State is initialised lazily from localStorage
 *   - Enabled flag defaults OFF for new installs; auto-enables if data already
 *     exists (upgrade migration path)
 *   - CRUD functions return the new/updated object so callers can chain
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { TASK_COLORS } from '../utils/colorUtils.js';
import { writeItem } from '../utils/storageWrites.js';
import { readGoalsProjectsEnabled } from '../utils/storedSlices.js';
import { readShowCompletedGoals, SHOW_COMPLETED_GOALS_KEY } from '../utils/goalFilters.js';

/**
 * The legacy `setShowGoalsDashboard(value)` maps onto the desktop space: true
 * (or an updater returning true) means the Goals & Projects space, false the
 * Calendar space. Pure, so the mapping is testable without rendering.
 */
export const spaceFromDashboardFlag = (prev, value) => {
  const next = typeof value === 'function' ? value(prev === 'goals') : value;
  return next ? 'goals' : 'calendar';
};

/**
 * The next desktop space for a requested value (or updater), given whether
 * Goals & Projects is enabled: with the feature off the Goals space cannot be
 * entered, so the request is ignored and the space stays where it is.
 */
export const resolveDesktopSpace = (prev, value, enabled) => {
  const next = typeof value === 'function' ? value(prev) : value;
  if (next === 'goals' && !enabled) return prev;
  return next === 'goals' ? 'goals' : 'calendar';
};

const useGoalsProjects = () => {
  const [goals, setGoals] = useState([]);
  const [projects, setProjects] = useState([]);
  // Areas group goals into a category level above them (e.g. "Money/Finance",
  // "App Development"). Standalone projects are never associated with an area.
  const [areas, setAreas] = useState([]);

  // Default OFF for new installs; ON if data already exists (upgrade migration).
  const [goalsProjectsEnabled, setGoalsProjectsEnabled] = useState(readGoalsProjectsEnabled);
  const goalsProjectsEnabledRef = useRef(goalsProjectsEnabled);
  goalsProjectsEnabledRef.current = goalsProjectsEnabled;

  // Desktop space: the header switcher swaps the sidebar + main area between
  // the Calendar space and the Goals & Projects space. Session only, never
  // persisted: the app always launches in the Calendar space. The phone
  // layout has its own tab (mobileActiveTab === 'goals') and ignores this.
  // The feature switch gates the space: while Goals & Projects is off no
  // caller can enter it (resolveDesktopSpace), and turning it off while in
  // the space returns to the calendar.
  const [desktopSpace, setDesktopSpaceRaw] = useState('calendar');
  const setDesktopSpace = useCallback((value) => {
    setDesktopSpaceRaw(prev => resolveDesktopSpace(prev, value, goalsProjectsEnabledRef.current));
  }, []);
  const toggleDesktopSpace = useCallback(() => {
    setDesktopSpace(prev => (prev === 'goals' ? 'calendar' : 'goals'));
  }, [setDesktopSpace]);
  useEffect(() => {
    if (!goalsProjectsEnabled) setDesktopSpaceRaw('calendar');
  }, [goalsProjectsEnabled]);
  // Legacy alias kept for the callers that "open the dashboard" (goal rings,
  // the GLANCE pill, future hyperGLANCE sessions, ProjectCard's notes portal):
  // every one of them now means "switch to the Goals space".
  const showGoalsDashboard = desktopSpace === 'goals';
  const setShowGoalsDashboard = useCallback((value) => {
    setDesktopSpace(prev => spaceFromDashboardFlag(prev, value));
  }, [setDesktopSpace]);

  // ── Dashboard UI prefs (device-local, not synced) ────────────────────────────
  // Which area the dashboard is filtered to: 'all' | 'uncategorized' | areaId.
  const [goalsAreaFilter, setGoalsAreaFilter] = useState(
    () => localStorage.getItem('day-planner-goals-area-filter') || 'all'
  );
  // Dashboard layout: 'list' (cards) | 'timeline' (temporal chart).
  const [goalsViewMode, setGoalsViewMode] = useState(
    () => localStorage.getItem('day-planner-goals-view-mode') || 'list'
  );
  useEffect(() => { writeItem('day-planner-goals-area-filter', goalsAreaFilter); }, [goalsAreaFilter]);
  useEffect(() => { writeItem('day-planner-goals-view-mode', goalsViewMode); }, [goalsViewMode]);
  // Completed goals in the Goals view: hidden unless shown (utils/goalFilters.js).
  const [showCompletedGoals, setShowCompletedGoals] = useState(() => readShowCompletedGoals());
  useEffect(() => { writeItem(SHOW_COMPLETED_GOALS_KEY, String(showCompletedGoals)); }, [showCompletedGoals]);

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

  // ── Area CRUD ────────────────────────────────────────────────────────────────

  const addArea = useCallback((fields) => {
    const now = new Date().toISOString();
    const newArea = {
      id: crypto.randomUUID(),
      name: '',
      color: TASK_COLORS[0].class,
      ...fields,
      createdAt: now,
      updatedAt: now,
    };
    setAreas(prev => [
      ...prev,
      { ...newArea, order: newArea.order ?? (prev.reduce((m, a) => Math.max(m, a.order ?? 0), 0) + 10) },
    ]);
    return newArea;
  }, []);

  const updateArea = useCallback((id, updates) => {
    setAreas(prev => prev.map(a =>
      a.id === id
        ? { ...a, ...updates, updatedAt: new Date().toISOString() }
        : a
    ));
  }, []);

  const deleteArea = useCallback((id) => {
    setAreas(prev => prev.filter(a => a.id !== id));
    // Detach the area from any goals that referenced it (they become
    // Uncategorized) rather than leaving a dangling areaId.
    setGoals(prev => prev.map(g => {
      if (g.areaId !== id) return g;
      const { areaId: _removed, ...rest } = g;
      return { ...rest, updatedAt: new Date().toISOString() };
    }));
    // Record tombstone so cloud sync doesn't resurrect the area from other devices
    const tombstones = JSON.parse(localStorage.getItem('day-planner-deleted-area-ids') || '{}');
    tombstones[String(id)] = new Date().toISOString();
    localStorage.setItem('day-planner-deleted-area-ids', JSON.stringify(tombstones));
  }, []);

  // Reassign order (0, 10, 20…) from an ordered list of area ids so the order syncs.
  const reorderAreas = useCallback((orderedIds) => {
    const now = new Date().toISOString();
    setAreas(prev => {
      const orderMap = new Map(orderedIds.map((id, i) => [id, i * 10]));
      return prev.map(a => orderMap.has(a.id) ? { ...a, order: orderMap.get(a.id), updatedAt: now } : a);
    });
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
    areas, setAreas,
    goalsAreaFilter, setGoalsAreaFilter,
    goalsViewMode, setGoalsViewMode,
    showCompletedGoals, setShowCompletedGoals,
    desktopSpace, setDesktopSpace, toggleDesktopSpace,
    showGoalsDashboard, setShowGoalsDashboard,
    goalsProjectsEnabled, setGoalsProjectsEnabled,
    addGoal, updateGoal, deleteGoal,
    addArea, updateArea, deleteArea, reorderAreas,
    addProject, updateProject, deleteProject, moveProject,
  };
};

export default useGoalsProjects;
