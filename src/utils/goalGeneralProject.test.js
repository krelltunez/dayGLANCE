import { describe, expect, it } from 'vitest';
import { findGoalGeneralProject, generalValue, goalIdOfGeneralValue, isGoalGeneral } from './goalGeneralProject.js';

describe('a goal\'s General project (#2365)', () => {
  it('the picker value names its goal, and no other value does', () => {
    expect(goalIdOfGeneralValue(generalValue('g-1'))).toBe('g-1');
    expect(goalIdOfGeneralValue(generalValue(42))).toBe('42');
    for (const other of ['', 'p-1', '__new-project__', null, undefined, 7]) expect(goalIdOfGeneralValue(other)).toBeNull();
  });

  it('is told apart by its flag, not its name', () => {
    expect(isGoalGeneral({ title: 'General' })).toBe(false);
    expect(isGoalGeneral({ title: 'Odds and ends', goalGeneral: true })).toBe(true);
  });

  it('only an open one under that goal counts', () => {
    const projects = [
      { id: 'named', title: 'General', goalId: 'g1' },
      { id: 'done', goalId: 'g1', goalGeneral: true, status: 'completed' },
      { id: 'archived', goalId: 'g1', goalGeneral: true, status: 'archived' },
      { id: 'other-goal', goalId: 'g2', goalGeneral: true },
      { id: 'open', goalId: 'g1', goalGeneral: true, status: 'on-hold' },
    ];
    expect(findGoalGeneralProject(projects, 'g1')?.id).toBe('open');
    expect(findGoalGeneralProject(projects.slice(0, 4), 'g1')).toBeNull();
    expect(findGoalGeneralProject(projects, 'g3')).toBeNull();
    expect(findGoalGeneralProject(projects, null)).toBeNull();
  });

  it('a numeric goal id matches its string form, as the picker passes it', () => {
    expect(findGoalGeneralProject([{ id: 'p', goalId: 7, goalGeneral: true }], '7')?.id).toBe('p');
  });
});
