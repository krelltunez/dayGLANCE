import { describe, it, expect } from 'vitest';
import {
  planProjectStatusChange, planGoalStatusChange, restoredStatus,
  archivedProjectContents, groupArchivedProjects,
} from './archiveCascade.js';

// #2260: archiving a project detached its open tasks and hid its completed
// ones, and a restore undid neither, so a restored project read as empty.

const NOW = '2026-10-30T10:00:00.000Z';
const project = { id: 'p1', title: 'Launch', status: 'active' };
const rows = [
  { id: 'a', projectId: 'p1', completed: true, completedAt: '2026-10-01T09:00' },
  { id: 'b', projectId: 'p1', completed: false },
  { id: 'c', projectId: 'p1', completed: true, archived: true }, // auto-archived earlier
  { id: 'd', projectId: 'p2', completed: false },
  { id: 'e', completed: false },
];
const archive = () => planProjectStatusChange(project, { status: 'archived' }, rows, NOW);
const archivedProject = () => ({ ...project, status: 'archived', ...archive().projectUpdates });

describe('archiving a project', () => {
  it('hides the completed tasks, detaches the open ones, and records which', () => {
    const plan = archive();
    expect(plan.projectUpdates.archiveRecord).toEqual({
      priorStatus: 'active', archivedAt: NOW, archivedTaskIds: ['a'], detachedTaskIds: ['b'],
    });
    const after = plan.rowsUpdater(rows);
    expect(after.find(t => t.id === 'a')).toMatchObject({ projectId: 'p1', archived: true, lastModified: NOW });
    const b = after.find(t => t.id === 'b');
    expect('projectId' in b).toBe(false);
    expect(b.lastModified).toBe(NOW);
    // Rows that are not the project's, or that the archive did not change, stay the same objects.
    for (const id of ['c', 'd', 'e']) expect(after.find(t => t.id === id)).toBe(rows.find(t => t.id === id));
  });

  it('keeps the array when nothing in it belongs to the project', () => {
    const other = [rows[3], rows[4]];
    expect(archive().rowsUpdater(other)).toBe(other);
  });

  it('is not an archive when the status does not change to archived', () => {
    expect(planProjectStatusChange(project, { title: 'x' }, rows)).toBeNull();
    expect(planProjectStatusChange(project, { status: 'completed' }, rows)).toBeNull();
    expect(planProjectStatusChange({ ...project, status: 'archived' }, { status: 'archived' }, rows)).toBeNull();
    expect(planProjectStatusChange(undefined, { status: 'archived' }, rows)).toBeNull();
  });
});

describe('restoring a project', () => {
  it('puts back exactly what the archive changed', () => {
    const archived = archive().rowsUpdater(rows);
    const restore = planProjectStatusChange(archivedProject(), { status: 'active' }, archived, NOW);
    expect(restore.projectUpdates).toEqual({ archiveRecord: null });
    const back = restore.rowsUpdater(archived);
    expect(back.find(t => t.id === 'a')).toMatchObject({ projectId: 'p1', archived: false });
    expect(back.find(t => t.id === 'b')).toMatchObject({ projectId: 'p1', lastModified: NOW });
    // Archived before the project was: still archived.
    expect(back.find(t => t.id === 'c').archived).toBe(true);
    expect(back.find(t => t.id === 'e')).toBe(archived.find(t => t.id === 'e'));
  });

  it('unarchives with an explicit false, which the merges honour', () => {
    const archived = archive().rowsUpdater(rows);
    const back = planProjectStatusChange(archivedProject(), { status: 'active' }, archived, NOW).rowsUpdater(archived);
    expect(Object.prototype.hasOwnProperty.call(back.find(t => t.id === 'a'), 'archived')).toBe(true);
  });

  it('leaves a detached task the user has since given another project', () => {
    const archived = archive().rowsUpdater(rows).map(t => (t.id === 'b' ? { ...t, projectId: 'p2' } : t));
    const back = planProjectStatusChange(archivedProject(), { status: 'active' }, archived, NOW).rowsUpdater(archived);
    expect(back.find(t => t.id === 'b').projectId).toBe('p2');
  });

  it('shows the hidden tasks of a project archived before the record existed', () => {
    const legacy = { ...project, status: 'archived' };
    const back = planProjectStatusChange(legacy, { status: 'active' }, rows, NOW).rowsUpdater(rows);
    expect(back.find(t => t.id === 'c').archived).toBe(false);
    expect(back.find(t => t.id === 'e')).toBe(rows[4]);
  });

  it('returns to the status the project had', () => {
    expect(restoredStatus(archivedProject())).toBe('active');
    expect(restoredStatus({ status: 'archived', archiveRecord: { priorStatus: 'completed' } })).toBe('completed');
    expect(restoredStatus({ status: 'archived' })).toBe('active');
  });
});

describe('archiving and restoring a goal', () => {
  const goal = { id: 'g1', title: 'Grow', status: 'active' };
  const projects = [
    { id: 'p1', goalId: 'g1', status: 'active' },
    { id: 'p2', goalId: 'g1', status: 'completed' },
    { id: 'p3', goalId: 'g1', status: 'archived' },
    { id: 'p4', goalId: 'g2', status: 'active' },
  ];

  it('archives the completed projects, detaches the open ones, and puts both back', () => {
    const plan = planGoalStatusChange(goal, { status: 'archived' }, projects, NOW);
    expect(plan.goalUpdates.archiveRecord).toMatchObject({ archivedProjectIds: ['p2'], detachedProjectIds: ['p1'] });
    const archived = plan.projectsUpdater(projects);
    expect(archived.find(p => p.id === 'p2')).toMatchObject({ status: 'archived', archiveRecord: { priorStatus: 'completed' } });
    expect('goalId' in archived.find(p => p.id === 'p1')).toBe(false);
    expect(archived.find(p => p.id === 'p3')).toBe(projects[2]);

    const archivedGoal = { ...goal, status: 'archived', ...plan.goalUpdates };
    const back = planGoalStatusChange(archivedGoal, { status: 'active' }, archived, NOW).projectsUpdater(archived);
    expect(back.find(p => p.id === 'p2')).toMatchObject({ status: 'completed', archiveRecord: null });
    expect(back.find(p => p.id === 'p1').goalId).toBe('g1');
    // Archived on its own before the goal was: stays archived.
    expect(back.find(p => p.id === 'p3').status).toBe('archived');
    expect(back.find(p => p.id === 'p4')).toBe(projects[3]);
  });

  it('leaves a detached project the user has since put under another goal', () => {
    const plan = planGoalStatusChange(goal, { status: 'archived' }, projects, NOW);
    const moved = plan.projectsUpdater(projects).map(p => (p.id === 'p1' ? { ...p, goalId: 'g2' } : p));
    const archivedGoal = { ...goal, status: 'archived', ...plan.goalUpdates };
    const back = planGoalStatusChange(archivedGoal, { status: 'active' }, moved, NOW).projectsUpdater(moved);
    expect(back.find(p => p.id === 'p1').goalId).toBe('g2');
  });
});

describe('reviewing an archived project', () => {
  it('lists the tasks it kept and the ones it moved out, wherever they are now', () => {
    const archived = archive().rowsUpdater(rows).map(t => (t.id === 'b' ? { ...t, completed: true } : t));
    const { completed, detached } = archivedProjectContents(archivedProject(), archived);
    expect(completed.map(t => t.id)).toEqual(['a', 'c']);
    expect(detached.map(t => t.id)).toEqual(['b']);
  });
});

describe('grouping the Archived list by goal', () => {
  it('follows the goal order and puts projects with no goal last', () => {
    const goals = [{ id: 'g1', title: 'One' }, { id: 'g2', title: 'Two' }];
    const groups = groupArchivedProjects([
      { id: 'a', goalId: 'g2' }, { id: 'b' }, { id: 'c', goalId: 'g1' }, { id: 'd', goalId: 'g2' }, { id: 'e', goalId: 'gone' },
    ], goals);
    expect(groups.map(g => g.goal?.id ?? null)).toEqual(['g1', 'g2', null]);
    expect(groups.map(g => g.projects.map(p => p.id))).toEqual([['c'], ['a', 'd'], ['b', 'e']]);
  });
});
