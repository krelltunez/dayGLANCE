import { describe, it, expect } from 'vitest';
import { followUpDraft } from '../jobo/carryForward.js';
import { completionFollowUpDraft } from './followUp.js';

// #2336: a follow-up in a project is a new task there, so it takes the
// project's New task defaults; a project without them changes nothing.

const fitness = { id: 'p-fit', title: 'Fitness', status: 'active', taskDefaults: { duration: 45, tags: ['health'], notes: 'Goal:', subtasks: ['Warm up'] } };
const plain = { id: 'p-plain', title: 'Plain', status: 'active' };
const task = (projectId) => ({ id: 't', title: 'Run 5k #cardio', color: 'bg-emerald-500', projectId });

describe('follow-ups in a project with New task defaults', () => {
  it('JOBO\'s follow-up: the defaults\' tags after the task\'s own, and their duration, notes and checklist', () => {
    const d = followUpDraft(task('p-fit'), { projects: [fitness, plain] });
    expect(d).toMatchObject({ title: ' #cardio #health', cursor: 0, duration: 45, notes: 'Goal:', projectId: 'p-fit' });
    expect(d.subtasks.map((s) => s.title)).toEqual(['Warm up']);
  });

  it('JOBO\'s follow-up in a project without defaults is what it was', () => {
    const d = followUpDraft(task('p-plain'), { projects: [fitness, plain] });
    expect(d).toEqual({ title: ' #cardio', cursor: 0, color: 'bg-emerald-500', projectId: 'p-plain', keepUnscheduled: true });
  });

  it('the completion follow-up takes the tags, duration and checklist; its link note wins over the default notes', () => {
    const d = completionFollowUpDraft(task('p-fit'), { projects: [fitness], prefix: 'Next:', tag: 'followup', note: 'From [[Run 5k]]' });
    expect(d.title).toBe('Next: Run 5k #cardio #followup #health');
    expect(d).toMatchObject({ duration: 45, notes: 'From [[Run 5k]]', projectId: 'p-fit' });
    expect(d.subtasks.map((s) => s.title)).toEqual(['Warm up']);
    expect(completionFollowUpDraft(task('p-fit'), { projects: [fitness] }).notes).toBe('Goal:');
  });
});
