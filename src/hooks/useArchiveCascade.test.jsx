import React, { useCallback, useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { act, create } from 'react-test-renderer';
import useArchiveCascade from './useArchiveCascade.js';

// #2260 through the wiring App uses: the store's update functions wrapped by
// the hook, state in React, an archive and a restore made the way the
// Archived list and the forms make them.

const stamp = () => new Date().toISOString();

function Harness({ initial, onRender }) {
  const [tasks, setTasks] = useState(initial.tasks);
  const [unscheduledTasks, setUnscheduledTasks] = useState(initial.unscheduledTasks);
  const [projects, setProjects] = useState(initial.projects);
  const [goals, setGoals] = useState(initial.goals);
  const tasksLiveRef = useRef(tasks);
  tasksLiveRef.current = tasks;
  const unscheduledLiveRef = useRef(unscheduledTasks);
  unscheduledLiveRef.current = unscheduledTasks;
  // As useGoalsProjects writes them: merge, and stamp updatedAt.
  const updateProjectEntity = useCallback((id, u) => setProjects(prev => prev.map(p => (p.id === id ? { ...p, ...u, updatedAt: stamp() } : p))), []);
  const updateGoalEntity = useCallback((id, u) => setGoals(prev => prev.map(g => (g.id === id ? { ...g, ...u, updatedAt: stamp() } : g))), []);
  const api = useArchiveCascade({
    projects, goals, tasksLiveRef, unscheduledLiveRef,
    updateProjectEntity, updateGoalEntity, setTasks, setUnscheduledTasks, setProjects,
  });
  onRender({ ...api, tasks, unscheduledTasks, projects, goals, setUnscheduledTasks });
  return null;
}

const mount = (initial) => {
  let latest;
  act(() => { create(<Harness initial={initial} onRender={(s) => { latest = s; }} />); });
  return () => latest;
};

const fixture = () => ({
  tasks: [{ id: 's1', projectId: 'p1', date: '2026-10-20', completed: true, completedAt: '2026-10-20T10:00' }],
  unscheduledTasks: [
    { id: 'u1', projectId: 'p1', completed: false },
    { id: 'u2', projectId: 'p1', completed: true },
    { id: 'u3', completed: false },
  ],
  projects: [{ id: 'p1', title: 'Launch', status: 'active', goalId: 'g1' }, { id: 'p2', title: 'Other', status: 'completed', goalId: 'g1' }],
  goals: [{ id: 'g1', title: 'Grow', status: 'active' }],
});

const find = (rows, id) => rows.find(r => r.id === id);

describe('useArchiveCascade (#2260)', () => {
  it('archives a project and a restore brings its tasks back', () => {
    const state = mount(fixture());
    act(() => state().updateProject('p1', { status: 'archived' }));
    expect(find(state().projects, 'p1')).toMatchObject({ status: 'archived', archiveRecord: { archivedTaskIds: ['s1', 'u2'], detachedTaskIds: ['u1'] } });
    expect(find(state().tasks, 's1').archived).toBe(true);
    expect(find(state().unscheduledTasks, 'u1').projectId).toBeUndefined();

    act(() => state().updateProject('p1', { status: 'active' }));
    expect(find(state().projects, 'p1')).toMatchObject({ status: 'active', archiveRecord: null });
    expect(find(state().tasks, 's1')).toMatchObject({ projectId: 'p1', archived: false });
    expect(find(state().unscheduledTasks, 'u1').projectId).toBe('p1');
    expect(find(state().unscheduledTasks, 'u2')).toMatchObject({ projectId: 'p1', archived: false });
    expect(find(state().unscheduledTasks, 'u3').projectId).toBeUndefined();
  });

  it('a task added to the project after the archive is not touched by the restore', () => {
    const state = mount(fixture());
    act(() => state().updateProject('p1', { status: 'archived' }));
    act(() => state().setUnscheduledTasks(prev => prev.map(t => (t.id === 'u1' ? { ...t, projectId: 'p2' } : t))));
    act(() => state().updateProject('p1', { status: 'active' }));
    expect(find(state().unscheduledTasks, 'u1').projectId).toBe('p2');
  });

  it('archiving a goal archives its completed project, and restoring it returns that project as completed', () => {
    const state = mount(fixture());
    act(() => state().updateGoal('g1', { status: 'archived' }));
    expect(find(state().projects, 'p2').status).toBe('archived');
    expect(find(state().projects, 'p1').goalId).toBeUndefined();
    act(() => state().updateGoal('g1', { status: 'active' }));
    expect(find(state().projects, 'p2').status).toBe('completed');
    expect(find(state().projects, 'p1').goalId).toBe('g1');
  });

  it('passes every other update through, and keeps its functions across renders', () => {
    const state = mount(fixture());
    const { updateProject, updateGoal, tasks } = state();
    act(() => updateProject('p1', { title: 'Renamed' }));
    expect(find(state().projects, 'p1')).toMatchObject({ title: 'Renamed', status: 'active' });
    expect(find(state().projects, 'p1').archiveRecord).toBeUndefined();
    expect(state().tasks).toBe(tasks);
    expect(state().updateProject).toBe(updateProject);
    expect(state().updateGoal).toBe(updateGoal);
  });
});
