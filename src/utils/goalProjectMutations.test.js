import { describe, it, expect } from 'vitest';
import {
  applyCreateGoal, applyUpdateGoal, applyCreateProject, applyUpdateProject,
  applyGoalProjectUndoOps, goalCanComplete, projectCanComplete,
} from './goalProjectMutations.js';

// The goal and project write shapes for MCP (2026-10-04): transcriptions of
// the Goals & Projects forms, with the owner's two holes (no archiving, no
// deletes) and the linked-note rule for descriptions.

const NOW = '2026-10-04T12:00:00.000Z';
const state = (over = {}) => ({
  goals: [
    { id: 'g1', title: 'Ship v5', status: 'active', color: 'bg-blue-500', assignedUserSyncIds: ['u1'] },
    { id: 'g2', title: 'Home', status: 'active', description: 'Keep it dry.', obsidianNotePath: 'Goals/Home.md' },
  ],
  projects: [
    { id: 'p1', title: 'Backend', status: 'active', goalId: 'g1', description: 'API first.' },
    { id: 'p2', title: 'Docs', status: 'completed', goalId: 'g1' },
    { id: 'p3', title: 'Roof', status: 'active', goalId: 'g2', obsidianNotePath: 'Projects/Roof.md' },
  ],
  tasks: [{ id: 't1', projectId: 'p1', completed: false }],
  unscheduledTasks: [{ id: 't2', projectId: 'p1', completed: true }],
  areas: [{ id: 'a1', name: 'Work', color: 'bg-orange-500', order: 0 }],
  users: [{ syncId: 'u1', name: 'Ana' }, { id: 'u-legacy', name: 'Bo' }, { syncId: 'gone', deleted: true }],
  ...over,
});

describe('applyCreateGoal', () => {
  it('creates an active goal with the form defaults, the area colour copied at creation, dates and assignees carried', () => {
    const r = applyCreateGoal(state(), {
      goalId: 'g-new', title: '  Learn piano ', description: ' Weekly lessons ', startDate: '2026-10-01', targetDate: '2027-01-01',
      areaId: 'a1', assigneeSyncIds: ['u1', 'u-legacy', 'u1'], nowIso: NOW,
    });
    expect(r.ok).toBe(true);
    expect(r.goal).toEqual({
      id: 'g-new', title: 'Learn piano', description: 'Weekly lessons', status: 'active', color: 'bg-orange-500',
      areaId: 'a1', startDate: '2026-10-01', targetDate: '2027-01-01', assignedUserSyncIds: ['u1', 'u-legacy'],
      createdAt: NOW, updatedAt: NOW,
    });
  });
  it('without an area takes the first palette colour; replay returns the existing goal', () => {
    const r = applyCreateGoal(state(), { goalId: 'g-new', title: 'X', nowIso: NOW });
    expect(r.goal.color).toBe('bg-blue-500');
    expect(r.goal.description).toBe('');
    const again = applyCreateGoal(state({ goals: [r.goal] }), { goalId: 'g-new', title: 'Other', nowIso: NOW });
    expect(again).toEqual({ ok: true, replayed: true, goal: r.goal });
  });
  it('rejects an empty title, an unknown area, an unknown or deleted assignee, and a start after the target', () => {
    expect(applyCreateGoal(state(), { goalId: 'x', title: '  ', nowIso: NOW })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(applyCreateGoal(state(), { goalId: 'x', title: 'T', areaId: 'nope', nowIso: NOW })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(applyCreateGoal(state(), { goalId: 'x', title: 'T', assigneeSyncIds: ['gone'], nowIso: NOW })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(applyCreateGoal(state(), { goalId: 'x', title: 'T', startDate: '2027-01-01', targetDate: '2026-01-01', nowIso: NOW }))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});

describe('applyUpdateGoal', () => {
  it('sets and clears fields, reports the touched storage keys, stamps updatedAt', () => {
    const r = applyUpdateGoal(state(), {
      goalId: 'g1', set: { title: 'Ship v6', targetDate: '2027-06-01', areaId: 'a1' }, clear: ['assignees'], nowIso: NOW,
    });
    expect(r.ok).toBe(true);
    expect(r.goal).toEqual({ id: 'g1', title: 'Ship v6', status: 'active', color: 'bg-blue-500', targetDate: '2027-06-01', areaId: 'a1', updatedAt: NOW });
    expect(r.touched).toEqual(['title', 'targetDate', 'areaId', 'assignedUserSyncIds']);
  });
  it('a call that changes nothing is a replay', () => {
    expect(applyUpdateGoal(state(), { goalId: 'g1', set: {}, clear: [], nowIso: NOW })).toMatchObject({ ok: true, replayed: true, touched: [] });
  });
  it('ARCHIVING IS REFUSED by design; other unknown statuses are validation errors', () => {
    const r = applyUpdateGoal(state(), { goalId: 'g1', set: { status: 'archived' }, nowIso: NOW });
    expect(r).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(r.error.message).toMatch(/not available over MCP/);
    expect(applyUpdateGoal(state(), { goalId: 'g1', set: { status: 'paused' }, nowIso: NOW })).toMatchObject({ ok: false });
  });
  it('COMPLETION MIRRORS THE FORM: refused while an active child project is open; allowed once children are done or archived', () => {
    const blocked = applyUpdateGoal(state(), { goalId: 'g1', set: { status: 'completed' }, nowIso: NOW });
    expect(blocked).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(blocked.error.message).toMatch(/incomplete projects/);
    const done = state({ projects: [{ id: 'p1', goalId: 'g1', status: 'completed' }, { id: 'p9', goalId: 'g1', status: 'archived' }] });
    expect(applyUpdateGoal(done, { goalId: 'g1', set: { status: 'completed' }, nowIso: NOW }).goal.status).toBe('completed');
    // Reopening never needs the rule.
    const completedGoal = state({ goals: [{ id: 'g1', title: 'X', status: 'completed' }] });
    expect(applyUpdateGoal(completedGoal, { goalId: 'g1', set: { status: 'active' }, nowIso: NOW }).goal.status).toBe('active');
  });
  it('THE LINKED NOTE OWNS THE DESCRIPTION: set and clear are refused and the message names the note; a missing note lifts the rule', () => {
    const r = applyUpdateGoal(state(), { goalId: 'g2', set: { description: 'New' }, nowIso: NOW });
    expect(r).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(r.error.message).toContain('Goals/Home');
    expect(applyUpdateGoal(state(), { goalId: 'g2', clear: ['description'], nowIso: NOW })).toMatchObject({ ok: false });
    const missing = state({ goals: [{ id: 'g2', title: 'Home', status: 'active', obsidianNotePath: 'Goals/Home.md', obsidianNoteMissingAt: NOW }] });
    expect(applyUpdateGoal(missing, { goalId: 'g2', set: { description: 'New' }, nowIso: NOW }).goal.description).toBe('New');
  });
  it('unknown goal, area or assignee are not_found; a cleared start past a kept target is caught', () => {
    expect(applyUpdateGoal(state(), { goalId: 'nope', set: { title: 'x' }, nowIso: NOW })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(applyUpdateGoal(state(), { goalId: 'g1', set: { areaId: 'nope' }, nowIso: NOW })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(applyUpdateGoal(state(), { goalId: 'g1', set: { assigneeSyncIds: ['who'] }, nowIso: NOW })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    const dated = state({ goals: [{ id: 'g1', title: 'X', status: 'active', startDate: '2026-01-01', targetDate: '2026-06-01' }] });
    expect(applyUpdateGoal(dated, { goalId: 'g1', set: { startDate: '2026-12-01' }, nowIso: NOW })).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});

describe('applyCreateProject', () => {
  it('under a goal: copies the goal colour and assignees at creation; standalone: fallback colour, nothing inherited', () => {
    const under = applyCreateProject(state(), { projectId: 'p-new', title: 'Mobile', goalId: 'g1', description: 'iOS first', nowIso: NOW });
    expect(under.project).toEqual({
      id: 'p-new', title: 'Mobile', description: 'iOS first', status: 'active', color: 'bg-blue-500', goalId: 'g1',
      assignedUserSyncIds: ['u1'], createdAt: NOW, updatedAt: NOW,
    });
    const alone = applyCreateProject(state(), { projectId: 'p-solo', title: 'Garage', nowIso: NOW });
    expect(alone.project).toEqual({ id: 'p-solo', title: 'Garage', description: '', status: 'active', color: 'bg-blue-500', createdAt: NOW, updatedAt: NOW });
    // Explicit assignees override the inheritance.
    const explicit = applyCreateProject(state(), { projectId: 'p-x', title: 'X', goalId: 'g1', assigneeSyncIds: ['u-legacy'], nowIso: NOW });
    expect(explicit.project.assignedUserSyncIds).toEqual(['u-legacy']);
  });
  it('unknown goal is not_found; replay returns the existing project', () => {
    expect(applyCreateProject(state(), { projectId: 'x', title: 'T', goalId: 'nope', nowIso: NOW })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(applyCreateProject(state(), { projectId: 'p1', title: 'Other', nowIso: NOW })).toMatchObject({ ok: true, replayed: true, project: { id: 'p1', title: 'Backend' } });
  });
  it('carries the project\'s own target date when given, and leaves the key absent when not', () => {
    const dated = applyCreateProject(state(), { projectId: 'p-dated', title: 'Roof', targetDate: '2026-12-01', nowIso: NOW });
    expect(dated.project).toMatchObject({ id: 'p-dated', title: 'Roof', targetDate: '2026-12-01' });
    expect('targetDate' in applyCreateProject(state(), { projectId: 'p-plain', title: 'Plain', nowIso: NOW }).project).toBe(false);
  });
});

describe('applyUpdateProject', () => {
  it('moves between goals, detaches with clear goal, edits the description of an unlinked project', () => {
    const moved = applyUpdateProject(state(), { projectId: 'p1', set: { goalId: 'g2', description: 'Rewritten' }, nowIso: NOW });
    expect(moved.project).toMatchObject({ goalId: 'g2', description: 'Rewritten', updatedAt: NOW });
    expect(moved.touched).toEqual(['description', 'goalId']);
    const detached = applyUpdateProject(state(), { projectId: 'p1', clear: ['goal'], nowIso: NOW });
    expect('goalId' in detached.project).toBe(false);
  });
  it('puts a project on hold and resumes it; goals have no such status', () => {
    const paused = applyUpdateProject(state(), { projectId: 'p1', set: { status: 'on-hold' }, nowIso: NOW });
    expect(paused).toMatchObject({ ok: true, project: { status: 'on-hold' } });
    const resumed = applyUpdateProject({ ...state(), projects: [paused.project] }, { projectId: 'p1', set: { status: 'active' }, nowIso: NOW });
    expect(resumed.project.status).toBe('active');
    expect(applyUpdateGoal(state(), { goalId: 'g1', set: { status: 'on-hold' }, nowIso: NOW })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(applyUpdateProject(state(), { projectId: 'p1', set: { status: 'paused' }, nowIso: NOW }).error.message).toContain('"on-hold"');
  });

  it('a goal with a project on hold is not complete: on hold is not done', () => {
    const s = state({ projects: [{ id: 'p2', title: 'Docs', status: 'on-hold', goalId: 'g1' }] });
    expect(applyUpdateGoal(s, { goalId: 'g1', set: { status: 'completed' }, nowIso: NOW })).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('COMPLETION MIRRORS THE FORM: refused with an open task; allowed when every task is done', () => {
    expect(applyUpdateProject(state(), { projectId: 'p1', set: { status: 'completed' }, nowIso: NOW })).toMatchObject({ ok: false, error: { code: 'validation' } });
    const done = state({ tasks: [{ id: 't1', projectId: 'p1', completed: true }], unscheduledTasks: [] });
    expect(applyUpdateProject(done, { projectId: 'p1', set: { status: 'completed' }, nowIso: NOW }).project.status).toBe('completed');
    // An archived task does not count.
    const archived = state({ tasks: [{ id: 't1', projectId: 'p1', completed: false, archived: true }], unscheduledTasks: [] });
    expect(applyUpdateProject(archived, { projectId: 'p1', set: { status: 'completed' }, nowIso: NOW }).ok).toBe(true);
  });
  it('archiving refused; linked-note description refused; unknown project and goal are not_found', () => {
    expect(applyUpdateProject(state(), { projectId: 'p1', set: { status: 'archived' }, nowIso: NOW })).toMatchObject({ ok: false, error: { code: 'validation' } });
    const linked = applyUpdateProject(state(), { projectId: 'p3', set: { description: 'x' }, nowIso: NOW });
    expect(linked.error.message).toContain('Projects/Roof');
    expect(applyUpdateProject(state(), { projectId: 'nope', set: { title: 'x' }, nowIso: NOW })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(applyUpdateProject(state(), { projectId: 'p1', set: { goalId: 'nope' }, nowIso: NOW })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
  it('sets and clears the project\'s own target date, reporting the touched key for undo', () => {
    const set = applyUpdateProject(state(), { projectId: 'p1', set: { targetDate: '2026-12-01' }, nowIso: NOW });
    expect(set.project.targetDate).toBe('2026-12-01');
    expect(set.touched).toContain('targetDate');
    const dated = state({ projects: [{ id: 'p1', title: 'Backend', status: 'active', targetDate: '2026-12-01' }] });
    const cleared = applyUpdateProject(dated, { projectId: 'p1', clear: ['target_date'], nowIso: NOW });
    expect('targetDate' in cleared.project).toBe(false);
    expect(cleared.touched).toContain('targetDate');
  });
});

describe('the form rules on their own', () => {
  it('goalCanComplete ignores archived children; projectCanComplete ignores archived tasks and counts both lists', () => {
    expect(goalCanComplete('g1', [{ goalId: 'g1', status: 'archived' }])).toBe(true);
    expect(goalCanComplete('g1', [{ goalId: 'g1', status: 'active' }])).toBe(false);
    expect(goalCanComplete('g1', [])).toBe(true);
    expect(projectCanComplete('p', [{ projectId: 'p', completed: true }], [{ projectId: 'p', completed: false }])).toBe(false);
    expect(projectCanComplete('p', [], [{ projectId: 'p', completed: false, archived: true }])).toBe(true);
  });
});

describe('applyGoalProjectUndoOps', () => {
  it('removes created records (naming them for the tombstone delete), restores touched fields and deletes absent ones, skips what is gone', () => {
    const s = state({
      goals: [{ id: 'g1', title: 'Renamed', status: 'completed', targetDate: '2027-01-01' }, { id: 'g-new', title: 'Made by MCP', status: 'active' }],
      projects: [{ id: 'p1', title: 'Backend', status: 'active', goalId: 'g2' }, { id: 'p-new', title: 'Made', status: 'active' }],
    });
    const r = applyGoalProjectUndoOps(s, [
      { kind: 'remove_created_goal', goalId: 'g-new' },
      { kind: 'remove_created_project', projectId: 'p-new' },
      { kind: 'restore_goal_fields', goalId: 'g1', before: { title: 'Ship v5', status: 'active' }, absentBefore: ['targetDate'] },
      { kind: 'restore_project_fields', projectId: 'p1', before: { goalId: 'g1' } },
      { kind: 'remove_created_goal', goalId: 'never' },
      { kind: 'bogus' },
    ], { nowIso: NOW });
    expect(r.removedGoals).toEqual(['g-new']);
    expect(r.removedProjects).toEqual(['p-new']);
    expect(r.goals).toEqual([{ id: 'g1', title: 'Ship v5', status: 'active', updatedAt: NOW }]);
    expect(r.projects).toEqual([{ id: 'p1', title: 'Backend', status: 'active', goalId: 'g1', updatedAt: NOW }]);
    expect(r.undone).toBe(4);
    expect(r.skipped).toBe(2);
  });

  it('undo restores a project target date, and deletes one the edit introduced', () => {
    const s = state({ projects: [{ id: 'p1', title: 'Backend', status: 'active', targetDate: '2027-01-01' }] });
    const restored = applyGoalProjectUndoOps(s, [
      { kind: 'restore_project_fields', projectId: 'p1', before: { targetDate: '2026-12-01' } },
    ], { nowIso: NOW });
    expect(restored.projects[0].targetDate).toBe('2026-12-01');
    const removed = applyGoalProjectUndoOps(s, [
      { kind: 'restore_project_fields', projectId: 'p1', before: {}, absentBefore: ['targetDate'] },
    ], { nowIso: NOW });
    expect('targetDate' in removed.projects[0]).toBe(false);
  });
});
