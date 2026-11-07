import { describe, it, expect, vi } from 'vitest';
import { detachDeletedProject, reparentDeletedGoal, clearDeletedMemberRefs } from './deleteCascade.js';

// The four task collectors, in the shapes the app keeps them. The harness
// models React's functional setter: setX(updater) replaces the slice with
// updater(current) and records the call.
function taskStore(initial) {
  const state = { ...initial };
  const setters = {};
  for (const key of Object.keys(initial)) {
    const setter = `set${key[0].toUpperCase()}${key.slice(1)}`;
    state[key] = initial[key];
    setters[setter] = vi.fn((updater) => { state[key] = updater(state[key]); });
  }
  return { state, setters };
}

describe('detachDeletedProject', () => {
  it('strips the project id from tasks in all four collections, and only that id', () => {
    const store = taskStore({
      tasks: [{ id: 's1', projectId: 'p1' }, { id: 's2', projectId: 'p2' }],
      unscheduledTasks: [{ id: 'u1', projectId: 'p1' }],
      recurringTasks: [{ id: 'r1', projectId: 'p1' }],
      recycleBin: [{ id: 'b1', projectId: 'p1', deletedAt: 'x' }],
    });
    detachDeletedProject('p1', store.setters);

    expect(store.state.tasks.map(t => t.projectId)).toEqual([undefined, 'p2']);
    expect(store.state.unscheduledTasks[0]).not.toHaveProperty('projectId');
    expect(store.state.recurringTasks[0]).not.toHaveProperty('projectId');
    expect(store.state.recycleBin[0]).not.toHaveProperty('projectId');
    // bin metadata and every other field survive
    expect(store.state.recycleBin[0].deletedAt).toBe('x');
  });

  it('leaves each slice untouched (same identity) when nothing references the project', () => {
    const store = taskStore({
      tasks: [{ id: 's2', projectId: 'p2' }],
      unscheduledTasks: [],
      recurringTasks: [],
      recycleBin: [],
    });
    const before = { ...store.state };
    detachDeletedProject('p1', store.setters);
    expect(store.state.tasks).toBe(before.tasks);
    expect(store.state.unscheduledTasks).toBe(before.unscheduledTasks);
  });

  it('does nothing without an id', () => {
    const store = taskStore({ tasks: [{ id: 's1', projectId: 'p1' }] });
    detachDeletedProject(null, store.setters);
    expect(store.setters.setTasks).not.toHaveBeenCalled();
  });
});

describe('reparentDeletedGoal', () => {
  it('makes the deleted goal\'s projects standalone and stamps updatedAt', () => {
    const state = {
      projects: [
        { id: 'a', goalId: 'g1', updatedAt: 'old' },
        { id: 'b', goalId: 'g2', updatedAt: 'old' },
      ],
    };
    const setProjects = vi.fn((updater) => { state.projects = updater(state.projects); });
    reparentDeletedGoal('g1', { setProjects }, 'now');

    expect(state.projects[0]).not.toHaveProperty('goalId');
    expect(state.projects[0].updatedAt).toBe('now');
    expect(state.projects[1].goalId).toBe('g2');
    expect(state.projects[1].updatedAt).toBe('old');
  });

  it('keeps the identity when no project belongs to the goal', () => {
    const projects = [{ id: 'b', goalId: 'g2' }];
    const state = { projects };
    const setProjects = vi.fn((updater) => { state.projects = updater(state.projects); });
    reparentDeletedGoal('g1', { setProjects }, 'now');
    expect(state.projects).toBe(projects);
  });
});

describe('clearDeletedMemberRefs', () => {
  function store(initial) {
    const state = { ...initial };
    const setters = {};
    for (const key of Object.keys(initial)) {
      const setter = `set${key[0].toUpperCase()}${key.slice(1)}`;
      setters[setter] = vi.fn((updater) => {
        const next = updater(state[key]);
        state[key] = next;
      });
    }
    return { state, setters };
  }

  it('unassigns the deleted member from tasks (array) and owners (single field)', () => {
    const s = store({
      tasks: [{ id: 't1', assignedUserSyncIds: ['u1', 'u2'] }, { id: 't2', assignedUserSyncIds: ['u1'] }, { id: 't3' }],
      unscheduledTasks: [{ id: 'u', assignedUserSyncIds: ['u1'] }],
      recurringTasks: [],
      recycleBin: [],
      projects: [{ id: 'p1', assignedUserSyncIds: ['u1'], updatedAt: 'old' }],
      goals: [{ id: 'g1', assignedUserSyncIds: ['u1'], updatedAt: 'old' }],
      habits: [{ id: 'h1', ownerSyncId: 'u1', lastModified: 'old' }],
      routineDefinitions: { morning: [{ id: 'c1', ownerSyncId: 'u1', lastModified: 'old' }, { id: 'c2', ownerSyncId: 'u2' }] },
      todayRoutines: [{ id: 'c1', ownerSyncId: 'u1', lastModified: 'old' }],
      gtdFrames: [{ id: 'f1', ownerSyncId: 'u1' }],
      frameSets: [{ id: 's1', name: 'Work', periods: [], ownerSyncId: 'u1' }, { id: 's2', name: 'Gym', periods: [], ownerSyncId: 'u2' }],
    });

    clearDeletedMemberRefs(['u1'], s.setters, 'now');

    expect(s.state.tasks[0].assignedUserSyncIds).toEqual(['u2']);
    expect(s.state.tasks[1]).not.toHaveProperty('assignedUserSyncIds');
    expect(s.state.tasks[1].lastModified).toBe('now');
    expect(s.state.tasks[2]).toEqual({ id: 't3' }); // untouched row
    expect(s.state.unscheduledTasks[0]).not.toHaveProperty('assignedUserSyncIds');
    expect(s.state.projects[0]).not.toHaveProperty('assignedUserSyncIds');
    expect(s.state.projects[0].updatedAt).toBe('now');
    expect(s.state.goals[0]).not.toHaveProperty('assignedUserSyncIds');
    expect(s.state.habits[0]).not.toHaveProperty('ownerSyncId');
    expect(s.state.routineDefinitions.morning[0]).not.toHaveProperty('ownerSyncId');
    expect(s.state.routineDefinitions.morning[1].ownerSyncId).toBe('u2');
    expect(s.state.todayRoutines[0]).not.toHaveProperty('ownerSyncId');
    expect(s.state.gtdFrames[0]).not.toHaveProperty('ownerSyncId');
    // no invented timestamp on frames
    expect(s.state.gtdFrames[0]).not.toHaveProperty('lastModified');
    // Frame sets are owned like frames, and repaired the same way (#2305).
    expect(s.state.frameSets[0]).not.toHaveProperty('ownerSyncId');
    expect(s.state.frameSets[1].ownerSyncId).toBe('u2');
  });

  it('does nothing when no member is deleted', () => {
    const s = store({ tasks: [{ id: 't1', assignedUserSyncIds: ['u1'] }] });
    clearDeletedMemberRefs([], s.setters, 'now');
    expect(s.setters.setTasks).not.toHaveBeenCalled();
  });
});
