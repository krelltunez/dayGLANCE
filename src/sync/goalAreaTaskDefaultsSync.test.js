import { describe, it, expect } from 'vitest';
import { mergeSyncData } from '../mergeSync.js';
import { shredState, reassembleState } from '@glance-apps/dayglance-vault';

// #2336: the New task defaults a goal or an area holds for new projects ride
// its row whole, on both tiers, like a project's own: the newer row wins and
// brings them (or their absence, once cleared) with it.

const OLD = '2026-11-01T10:00:00.000Z';
const NEW = '2026-11-02T10:00:00.000Z';
const defaults = { duration: 45, tags: ['health'], energy: 'restore' };
const base = ({ goals = [], areas = [] }) => ({
  tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: [],
  completedTaskUids: [], deletedTaskIds: {},
  goals, deletedGoalIds: {}, projects: [], deletedProjectIds: {},
  areas, deletedAreaIds: {},
});
const goal = (updatedAt, extra = {}) => ({ id: 'g1', title: 'Health', status: 'active', updatedAt, ...extra });
const area = (updatedAt, extra = {}) => ({ id: 'a1', name: 'Leisure', updatedAt, ...extra });

describe('file tier (mergeSyncData)', () => {
  it('a newer goal or area with defaults wins over an older one without, either side', () => {
    const local = base({ goals: [goal(OLD)], areas: [area(OLD)] });
    const remote = base({ goals: [goal(NEW, { taskDefaults: defaults })], areas: [area(NEW, { taskDefaults: defaults })] });
    for (const [a, b] of [[local, remote], [remote, local]]) {
      const { data } = mergeSyncData(a, b);
      expect(data.goals[0].taskDefaults).toEqual(defaults);
      expect(data.areas[0].taskDefaults).toEqual(defaults);
    }
  });

  it('defaults cleared later stay cleared', () => {
    const local = base({ goals: [goal(NEW)], areas: [area(NEW)] });
    const remote = base({ goals: [goal(OLD, { taskDefaults: defaults })], areas: [area(OLD, { taskDefaults: defaults })] });
    const { data } = mergeSyncData(remote, local);
    expect(data.goals[0]).not.toHaveProperty('taskDefaults');
    expect(data.areas[0]).not.toHaveProperty('taskDefaults');
  });
});

describe('vault tier (shred → wire → reassemble)', () => {
  it('goal and area rows come back with their defaults intact', () => {
    const rows = shredState(base({ goals: [goal(NEW, { taskDefaults: defaults })], areas: [area(NEW, { taskDefaults: defaults })] }))
      .map((r) => JSON.parse(JSON.stringify(r)));
    const back = reassembleState(rows);
    expect(back.goals[0].taskDefaults).toEqual(defaults);
    expect(back.areas[0].taskDefaults).toEqual(defaults);
  });
});
