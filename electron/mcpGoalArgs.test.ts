import { describe, it, expect } from 'vitest';
import {
  planCreateGoal, planUpdateGoal, planCreateProject, planUpdateProject, planAddSubtask, planUpdateSubtask,
} from './mcpGoalArgs.js';

// Argument-shape rules for the goal, project and subtask tools (2026-10-04).
// State-dependent rejections live in goalProjectMutations.js and are tested
// there; this is the wire contract: absent leaves alone, present sets,
// clear_fields removes, archiving refused at the edge, dates strict.

describe('planCreateGoal', () => {
  it('shapes the plan, trimming the title and carrying dates, area and assignees', () => {
    expect(planCreateGoal({ title: ' Learn piano ', description: 'd', start_date: '2026-10-01', target_date: '2027-01-01', area_id: 'a1', assignee_ids: ['u1'] }, true))
      .toEqual({ ok: true, plan: { title: 'Learn piano', description: 'd', startDate: '2026-10-01', targetDate: '2027-01-01', areaId: 'a1', assigneeSyncIds: ['u1'] } });
    expect(planCreateGoal({ title: 'X' }, false)).toEqual({ ok: true, plan: { title: 'X' } });
  });
  it('rejects a blank title, a bad date, a start after the target, and assignees outside multi-user', () => {
    expect(planCreateGoal({ title: ' ' }, true)).toMatchObject({ ok: false, code: 'validation' });
    expect(planCreateGoal({ title: 'X', target_date: '2027-1-1' }, true)).toMatchObject({ ok: false });
    expect(planCreateGoal({ title: 'X', start_date: '2027-01-01', target_date: '2026-01-01' }, true)).toMatchObject({ ok: false });
    expect(planCreateGoal({ title: 'X', assignee_ids: ['u1'] }, false)).toMatchObject({ ok: false });
    expect(planCreateGoal({ title: 'X', assignee_ids: 'u1' }, true)).toMatchObject({ ok: false });
  });
});

describe('planUpdateGoal', () => {
  it('sets and clears, status limited to active/completed, archiving refused at the edge with the design named', () => {
    expect(planUpdateGoal({ goal_id: 'g1', title: 'New', status: 'completed', clear_fields: ['target_date', 'area'] }, false))
      .toEqual({ ok: true, plan: { goalId: 'g1', set: { title: 'New', status: 'completed' }, clear: ['target_date', 'area'] } });
    const archived = planUpdateGoal({ goal_id: 'g1', status: 'archived' }, false);
    expect(archived).toMatchObject({ ok: false, code: 'validation' });
    expect((archived as { message: string }).message).toMatch(/not available over MCP/);
  });
  it('description_base rides with a description and is rejected alone or blank', () => {
    expect(planUpdateGoal({ goal_id: 'g1', description: 'New', description_base: 'h1' }, false))
      .toEqual({ ok: true, plan: { goalId: 'g1', set: { description: 'New', descriptionBase: 'h1' }, clear: [] } });
    expect(planUpdateGoal({ goal_id: 'g1', description_base: 'h1' }, false)).toMatchObject({ ok: false });
    expect(planUpdateGoal({ goal_id: 'g1', description: 'New', description_base: ' ' }, false)).toMatchObject({ ok: false });
    expect(planUpdateProject({ project_id: 'p1', description: 'New', description_base: 'h1' }, false))
      .toMatchObject({ ok: true, plan: { set: { description: 'New', descriptionBase: 'h1' } } });
  });

  it('rejects set-and-clear of one field, clearing title, an unknown clearable, assignees outside multi-user, and an empty call', () => {
    expect(planUpdateGoal({ goal_id: 'g1', description: 'x', clear_fields: ['description'] }, false)).toMatchObject({ ok: false });
    expect(planUpdateGoal({ goal_id: 'g1', clear_fields: ['title'] }, false)).toMatchObject({ ok: false });
    expect(planUpdateGoal({ goal_id: 'g1', clear_fields: ['color'] }, false)).toMatchObject({ ok: false });
    expect(planUpdateGoal({ goal_id: 'g1', clear_fields: ['assignees'] }, false)).toMatchObject({ ok: false });
    expect(planUpdateGoal({ goal_id: 'g1', clear_fields: ['assignees'] }, true)).toMatchObject({ ok: true });
    expect(planUpdateGoal({ goal_id: 'g1' }, false)).toMatchObject({ ok: false });
    expect(planUpdateGoal({ title: 'x' }, false)).toMatchObject({ ok: false });
  });
});

describe('planCreateProject / planUpdateProject', () => {
  it('create: goal optional, description carried; update: goal set or cleared, status, assignees under multi-user', () => {
    expect(planCreateProject({ title: ' Mobile ', goal_id: 'g1', description: 'd' }, false))
      .toEqual({ ok: true, plan: { title: 'Mobile', goalId: 'g1', description: 'd' } });
    expect(planCreateProject({ title: 'Solo' }, false)).toEqual({ ok: true, plan: { title: 'Solo' } });
    expect(planUpdateProject({ project_id: 'p1', goal_id: 'g2', status: 'active' }, false))
      .toEqual({ ok: true, plan: { projectId: 'p1', set: { goalId: 'g2', status: 'active' }, clear: [] } });
    expect(planUpdateProject({ project_id: 'p1', clear_fields: ['goal'] }, false))
      .toEqual({ ok: true, plan: { projectId: 'p1', set: {}, clear: ['goal'] } });
    expect(planUpdateProject({ project_id: 'p1', assignee_ids: ['u1'] }, true)).toMatchObject({ ok: true, plan: { set: { assigneeSyncIds: ['u1'] } } });
  });
  it('rejects goal set-and-cleared, archiving, a blank goal id, and an empty call', () => {
    expect(planUpdateProject({ project_id: 'p1', goal_id: 'g2', clear_fields: ['goal'] }, false)).toMatchObject({ ok: false });
    expect(planUpdateProject({ project_id: 'p1', status: 'archived' }, false)).toMatchObject({ ok: false });
    expect(planCreateProject({ title: 'X', goal_id: ' ' }, false)).toMatchObject({ ok: false });
    expect(planUpdateProject({ project_id: 'p1' }, false)).toMatchObject({ ok: false });
  });

  it('carries the project\'s own target date on create and update, clears it by name, and keeps dates strict', () => {
    expect(planCreateProject({ title: 'Roof', target_date: '2026-12-01' }, false))
      .toEqual({ ok: true, plan: { title: 'Roof', targetDate: '2026-12-01' } });
    expect(planUpdateProject({ project_id: 'p1', target_date: '2026-12-01' }, false))
      .toEqual({ ok: true, plan: { projectId: 'p1', set: { targetDate: '2026-12-01' }, clear: [] } });
    expect(planUpdateProject({ project_id: 'p1', clear_fields: ['target_date'] }, false))
      .toEqual({ ok: true, plan: { projectId: 'p1', set: {}, clear: ['target_date'] } });
    // Same strict wire date every other tool takes, and set-and-clear at once is refused.
    expect(planCreateProject({ title: 'Roof', target_date: '2026-12-1' }, false)).toMatchObject({ ok: false });
    expect(planUpdateProject({ project_id: 'p1', target_date: 'soon' }, false)).toMatchObject({ ok: false });
    expect(planUpdateProject({ project_id: 'p1', target_date: '2026-12-01', clear_fields: ['target_date'] }, false)).toMatchObject({ ok: false });
  });

  // #2394: how a project lists its unscheduled tasks.
  it('task_order: "manual" or "deadline" on create and update, and anything else is refused by name', () => {
    expect(planCreateProject({ title: 'Degree', task_order: 'deadline' }, false))
      .toEqual({ ok: true, plan: { title: 'Degree', taskOrder: 'deadline' } });
    expect(planCreateProject({ title: 'Degree', task_order: 'manual' }, false))
      .toEqual({ ok: true, plan: { title: 'Degree', taskOrder: 'manual' } });
    expect(planCreateProject({ title: 'Degree' }, false)).toEqual({ ok: true, plan: { title: 'Degree' } });
    expect(planUpdateProject({ project_id: 'p1', task_order: 'deadline' }, false))
      .toEqual({ ok: true, plan: { projectId: 'p1', set: { taskOrder: 'deadline' }, clear: [] } });
    // Alone, it is a change: not "Nothing to change".
    expect(planUpdateProject({ project_id: 'p1', task_order: 'manual' }, false))
      .toEqual({ ok: true, plan: { projectId: 'p1', set: { taskOrder: 'manual' }, clear: [] } });
    for (const bad of ['priority', 'Deadline', '', 7, null, true]) {
      for (const r of [planCreateProject({ title: 'X', task_order: bad }, false), planUpdateProject({ project_id: 'p1', task_order: bad }, false)]) {
        expect(r).toMatchObject({ ok: false, code: 'validation' });
        expect((r as { message: string }).message).toContain('"manual"');
        expect((r as { message: string }).message).toContain('"deadline"');
      }
    }
    expect((planUpdateProject({ project_id: 'p1' }, false) as { message: string }).message).toContain('task_order');
  });
});

describe('planAddSubtask / planUpdateSubtask', () => {
  it('add needs a task and a title; update needs title or completed, typed', () => {
    expect(planAddSubtask({ task_id: 't1', title: ' Buy nails ' })).toEqual({ ok: true, plan: { taskId: 't1', title: 'Buy nails' } });
    expect(planAddSubtask({ task_id: 't1', title: '' })).toMatchObject({ ok: false });
    expect(planUpdateSubtask({ task_id: 't1', subtask_id: 's1', completed: true })).toEqual({ ok: true, plan: { taskId: 't1', subtaskId: 's1', set: { completed: true } } });
    expect(planUpdateSubtask({ task_id: 't1', subtask_id: 's1', title: 'Renamed' })).toMatchObject({ ok: true, plan: { set: { title: 'Renamed' } } });
    expect(planUpdateSubtask({ task_id: 't1', subtask_id: 's1', completed: 'yes' })).toMatchObject({ ok: false });
    expect(planUpdateSubtask({ task_id: 't1', subtask_id: 's1' })).toMatchObject({ ok: false });
    expect(planUpdateSubtask({ task_id: 't1', title: 'x' })).toMatchObject({ ok: false });
  });
});
