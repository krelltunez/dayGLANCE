import { describe, it, expect } from 'vitest';
import { mergeSyncData } from '../mergeSync.js';
import { shredState, reassembleState, applyRemoteEntity } from '@glance-apps/dayglance-vault';
import { sortProjectInbox } from '../utils/projectOrder.js';

// #2394: a project's task order (`taskSort`, utils/projectOrder.js) rides the
// project row whole on both tiers, like its New task defaults
// (projectTaskDefaultsSync.test.js): the newer row wins and brings the
// setting, or its absence once it was turned off. Nothing merges per field.

const OLD = '2026-11-13T10:00:00.000Z';
const NEW = '2026-11-14T10:00:00.000Z';
const base = (projects) => ({
  tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: [],
  completedTaskUids: [], deletedTaskIds: {},
  goals: [], deletedGoalIds: {}, projects, deletedProjectIds: {},
});
const row = (updatedAt, extra = {}) => ({ id: 'p1', title: 'Degree', status: 'active', updatedAt, ...extra });
const wire = (rows) => rows.map((r) => JSON.parse(JSON.stringify(r)));

describe('file tier (mergeSyncData)', () => {
  it('turned on later on one device, it reaches the other, whichever side merges', () => {
    const local = base([row(OLD)]);
    const remote = base([row(NEW, { taskSort: 'deadline' })]);
    expect(mergeSyncData(local, remote).data.projects[0].taskSort).toBe('deadline');
    expect(mergeSyncData(remote, local).data.projects[0].taskSort).toBe('deadline');
  });

  it('turned off later, it stays off', () => {
    const local = base([row(NEW)]);
    const remote = base([row(OLD, { taskSort: 'deadline' })]);
    expect(mergeSyncData(local, remote).data.projects[0]).not.toHaveProperty('taskSort');
    expect(mergeSyncData(remote, local).data.projects[0]).not.toHaveProperty('taskSort');
  });
});

describe('vault tier', () => {
  it('shred → wire → reassemble brings the row back with its order', () => {
    const back = reassembleState(wire(shredState(base([row(NEW, { taskSort: 'deadline' })]))));
    expect(back.projects[0].taskSort).toBe('deadline');
  });

  // The form and the Planner turn it off by writing `taskSort: undefined`,
  // which the wire drops, so "off" travels as a row without the field.
  it('turned off, the pushed row has no field, and applying it on another device turns it off there', () => {
    const [pushed] = wire(shredState(base([{ ...row(NEW, { taskSort: 'deadline' }), taskSort: undefined }])));
    expect(pushed.entity.value).not.toHaveProperty('taskSort');
    const other = base([row(OLD, { taskSort: 'deadline' })]);
    applyRemoteEntity(other, pushed.entity);
    expect(other.projects[0]).not.toHaveProperty('taskSort');
  });

  it('a pulled row that turns it on changes what the other device lists', () => {
    const other = {
      ...base([row(OLD)]),
      unscheduledTasks: [
        { id: 'loose', projectId: 'p1', projectOrder: 0 },
        { id: 'dated', projectId: 'p1', projectOrder: 10, deadline: '2026-11-20' },
      ],
    };
    const [pushed] = wire(shredState(base([row(NEW, { taskSort: 'deadline' })])));
    applyRemoteEntity(other, pushed.entity);
    expect(sortProjectInbox(other.unscheduledTasks, other.projects[0].taskSort).map((t) => t.id)).toEqual(['dated', 'loose']);
  });
});
