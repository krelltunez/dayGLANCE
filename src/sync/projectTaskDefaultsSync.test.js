import { describe, it, expect } from 'vitest';
import { mergeSyncData } from '../mergeSync.js';
import { shredState, reassembleState } from '@glance-apps/dayglance-vault';

// #2336: a project's New task defaults ride the project row whole, on both
// tiers, like its colour and assignees: the newer row wins and brings its
// defaults (or their absence, once they were cleared) with it. Nothing merges
// per field, so there is nothing to carry forward; this pins that both tiers
// keep the nested field and pick by updatedAt.

const OLD = '2026-11-01T10:00:00.000Z';
const NEW = '2026-11-02T10:00:00.000Z';
const defaults = { duration: 45, tags: ['health'], notes: 'Goal:\nResult:', subtasks: ['Warm up', 'Stretch'] };
const base = (projects) => ({
  tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: [],
  completedTaskUids: [], deletedTaskIds: {},
  goals: [], deletedGoalIds: {}, projects, deletedProjectIds: {},
});
const row = (updatedAt, extra = {}) => ({ id: 'p-fit', title: 'Fitness', status: 'active', updatedAt, ...extra });

describe('file tier (mergeSyncData)', () => {
  it('a newer row with defaults wins over an older one without, either side', () => {
    const local = base([row(OLD)]);
    const remote = base([row(NEW, { taskDefaults: defaults })]);
    expect(mergeSyncData(local, remote).data.projects[0].taskDefaults).toEqual(defaults);
    expect(mergeSyncData(remote, local).data.projects[0].taskDefaults).toEqual(defaults);
  });

  it('defaults cleared later stay cleared', () => {
    const local = base([row(NEW)]);
    const remote = base([row(OLD, { taskDefaults: defaults })]);
    expect(mergeSyncData(local, remote).data.projects[0]).not.toHaveProperty('taskDefaults');
    expect(mergeSyncData(remote, local).data.projects[0]).not.toHaveProperty('taskDefaults');
  });
});

describe('vault tier (shred → wire → reassemble)', () => {
  it('the row comes back with its defaults intact', () => {
    const rows = shredState(base([row(NEW, { taskDefaults: defaults })]))
      .map((r) => JSON.parse(JSON.stringify(r)));
    const back = reassembleState(rows);
    expect(back.projects[0].taskDefaults).toEqual(defaults);
  });
});
