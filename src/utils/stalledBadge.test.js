import { describe, expect, it } from 'vitest';
import { hasStalledChild, isProjectFlaggedStalled } from './stalledBadge.js';

// A project that the shared rule calls stalled: 50 days old, one open task,
// nothing completed in the last 7 days.
const old = new Date(Date.now() - 50 * 86400000).toISOString();
const goal = { id: 'g' };
const project = { id: 'p', goalId: 'g', status: 'active', createdAt: old };
const tasks = [{ id: 't', projectId: 'p', completed: false, duration: 30 }];
const today = new Date();
const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

describe('isProjectFlaggedStalled', () => {
  it('flags a goal-linked project the shared rule calls stalled', () => {
    expect(isProjectFlaggedStalled(project, goal, tasks, [], 600)).toBe(true);
  });

  it('never flags a standalone project (no per-project opt-out exists; momentum is the Weekly Review\'s)', () => {
    expect(isProjectFlaggedStalled({ ...project, goalId: undefined }, null, tasks, [], 600)).toBe(false);
  });

  it('never flags a project on hold: a paused project is not stalled', () => {
    expect(isProjectFlaggedStalled({ ...project, status: 'on-hold' }, goal, tasks, [], 600)).toBe(false);
    expect(hasStalledChild(goal, [{ ...project, status: 'on-hold' }], tasks, [], 600)).toBe(false);
  });

  it('respects the goal\'s hideStalled opt-out', () => {
    expect(isProjectFlaggedStalled(project, { ...goal, hideStalled: true }, tasks, [], 600)).toBe(false);
  });

  it('does not flag a project with an active hyperGLANCE session — the session is the plan', () => {
    const withSession = { ...project, hyperglance: { enabled: true, isRecurring: false, scheduledDate: ymd, scheduledTime: '14:00', scheduledDuration: 60, completions: [], createdAt: old } };
    expect(isProjectFlaggedStalled(withSession, goal, tasks, [], 600)).toBe(false);
  });

  it('does not flag a completed project, and not one with a recent completion', () => {
    expect(isProjectFlaggedStalled({ ...project, status: 'completed' }, goal, tasks, [], 600)).toBe(false);
    const recent = [...tasks, { id: 'd', projectId: 'p', completed: true, completedAt: new Date().toISOString(), duration: 30 }];
    expect(isProjectFlaggedStalled(project, goal, recent, [], 600)).toBe(false);
  });
});

describe('hasStalledChild', () => {
  it('is the OR of the children\'s badges, under the goal\'s opt-out', () => {
    expect(hasStalledChild(goal, [project], tasks, [], 600)).toBe(true);
    expect(hasStalledChild({ ...goal, hideStalled: true }, [project], tasks, [], 600)).toBe(false);
    expect(hasStalledChild(goal, [{ ...project, goalId: 'other' }], tasks, [], 600)).toBe(false);
  });
});
