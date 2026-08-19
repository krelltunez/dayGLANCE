import { describe, it, expect } from 'vitest';
import { calculateGoalProgress } from './goalProgress.js';

const project = (id, goalId = 'g1') => ({ id, goalId, status: 'active' });
const task = (projectId, over = {}) => ({ id: `${projectId}-t`, projectId, duration: 60, completed: false, ...over });

describe('calculateGoalProgress', () => {
  it('weights each project by its total duration', () => {
    const projects = [project('p1'), project('p2')];
    const tasks = [
      task('p1', { id: 'a', duration: 180, completed: true }),
      task('p2', { id: 'b', duration: 60 }),
    ];
    // 180 of 240 minutes done.
    expect(calculateGoalProgress('g1', projects, tasks)).toBeCloseTo(0.75);
  });

  // The reason the null return is safe here: a project with nothing to measure
  // carries no opinion about its goal, rather than voting 0%.
  it('skips projects with nothing to measure instead of averaging in a zero', () => {
    const projects = [project('p1'), project('p2')];
    const tasks = [task('p1', { completed: true })]; // p2 has no tasks at all
    expect(calculateGoalProgress('g1', projects, tasks)).toBe(1);
  });

  it('is 0 when the goal has no projects, or none of them measurable', () => {
    expect(calculateGoalProgress('g1', [], [])).toBe(0);
    expect(calculateGoalProgress('g1', [project('p1')], [])).toBe(0);
  });

  it('ignores archived projects and other goals', () => {
    const projects = [
      { id: 'p1', goalId: 'g1', status: 'archived' },
      project('p2', 'g2'),
    ];
    expect(calculateGoalProgress('g1', projects, [task('p1', { completed: true })])).toBe(0);
  });
});
