import { describe, it, expect } from 'vitest';
import { applyCreateTask } from './taskMutations.js';

// #2336: a task created in a project through the shared create path (MCP,
// launcher intents) takes the project's New task defaults, as the app's own
// create paths do, filling only what the call leaves out.

const NOW = '2026-11-09T12:00:00.000Z';
const fitness = { id: 'p-fit', title: 'Fitness', color: 'bg-emerald-500', status: 'active',
  taskDefaults: { duration: 45, tags: ['health'], notes: 'Goal:\nResult:', subtasks: ['Warm up', 'Stretch'] } };
const plain = { id: 'p-plain', title: 'Plain', color: 'bg-blue-500', status: 'active' };
const state = () => ({ tasks: [], unscheduledTasks: [], recurringTasks: [], projects: [fitness, plain], goals: [], users: [] });

describe('applyCreateTask in a project with New task defaults', () => {
  it('fills duration, notes, tags and the checklist the call leaves out', () => {
    const r = applyCreateTask(state(), { taskId: 'k1', title: 'Run 5k', projectId: 'p-fit', nowIso: NOW });
    expect(r.ok).toBe(true);
    expect(r.task).toMatchObject({ title: 'Run 5k #health', duration: 45, notes: 'Goal:\nResult:', color: 'bg-emerald-500' });
    expect(r.task.subtasks).toEqual([
      { id: 'k1-st-1', title: 'Warm up', completed: false },
      { id: 'k1-st-2', title: 'Stretch', completed: false },
    ]);
  });

  it('what the call gives wins: its duration and its notes', () => {
    const r = applyCreateTask(state(), { taskId: 'k2', title: 'Run', projectId: 'p-fit', durationMinutes: 20, notes: 'mine', nowIso: NOW });
    expect(r.task).toMatchObject({ duration: 20, notes: 'mine' });
  });

  it('a tag the title already has is not added twice', () => {
    const r = applyCreateTask(state(), { taskId: 'k3', title: 'Run #Health', projectId: 'p-fit', nowIso: NOW });
    expect(r.task.title).toBe('Run #Health');
  });

  it('the same create applied twice writes the same row (subtask ids from the task id)', () => {
    const a = applyCreateTask(state(), { taskId: 'k4', title: 'Run', projectId: 'p-fit', nowIso: NOW });
    const b = applyCreateTask(state(), { taskId: 'k4', title: 'Run', projectId: 'p-fit', nowIso: NOW });
    expect(b.task).toEqual(a.task);
  });

  it('a project without defaults, or no project, creates what it always did', () => {
    expect(applyCreateTask(state(), { taskId: 'k5', title: 'T', projectId: 'p-plain', nowIso: NOW }).task)
      .toMatchObject({ title: 'T', duration: 30, notes: '', subtasks: [] });
    expect(applyCreateTask(state(), { taskId: 'k6', title: 'T', nowIso: NOW }).task)
      .toMatchObject({ title: 'T', duration: 30, notes: '', subtasks: [] });
  });

  it('a repeating series takes the tags, notes and checklist; its duration stays the schedule\'s', () => {
    const r = applyCreateTask(state(), {
      taskId: 'k7', title: 'Gym', projectId: 'p-fit', nowIso: NOW,
      schedule: { date: '2026-11-10', startTime: '07:00', durationMinutes: 60, allDay: false },
      recurrence: { type: 'weekly', days: [2] },
    });
    expect(r.ok).toBe(true);
    expect(r.template).toMatchObject({ title: 'Gym #health', duration: 60, notes: 'Goal:\nResult:' });
    expect(r.template.subtasks.map((s) => s.id)).toEqual(['k7-st-1', 'k7-st-2']);
  });
});
