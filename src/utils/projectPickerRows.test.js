import { describe, it, expect } from 'vitest';
import { groupInboxProjects } from './inboxProjectGroups.js';
import { projectPickerRows } from './projectPickerRows.js';

// #2279: the task editor's project picker, as the rows it draws.
const areas = [{ id: 'a-work', name: 'Work' }];
const goals = [
  { id: 'g-ship', title: 'Ship v6', areaId: 'a-work', color: 'bg-rose-500' },
  { id: 'g-read', title: 'Read more' },
];
const projects = [
  { id: 'p-api', title: 'API', goalId: 'g-ship' },
  { id: 'p-docs', title: 'Docs', goalId: 'g-ship' },
  { id: 'p-books', title: 'Books', goalId: 'g-read' },
  { id: 'p-solo', title: 'Solo' },
];
const keys = (rows) => rows.map((r) => (r.type === 'group' ? `${r.key}${r.open ? '' : '+'}@${r.level}` : `${r.project.id}@${r.level}`));

describe('projectPickerRows', () => {
  const groups = groupInboxProjects({ projects, goals, areas });

  it('areas open, goals folded, the standalone projects folded under them', () => {
    expect(keys(projectPickerRows(groups))).toEqual([
      'area-a-work@0', 'goal-g-ship+@1',
      'area-none@0', 'goal-g-read+@1',
      'standalone+@0',
    ]);
  });

  it('the group holding the task\'s project opens on it', () => {
    expect(keys(projectPickerRows(groups, { selectedId: 'p-docs' }))).toEqual([
      'area-a-work@0', 'goal-g-ship@1', 'p-api@2', 'p-docs@2',
      'area-none@0', 'goal-g-read+@1',
      'standalone+@0',
    ]);
    expect(keys(projectPickerRows(groups, { selectedId: 'p-solo' })).slice(-2)).toEqual(['standalone@0', 'p-solo@1']);
  });

  it('a fold the user set wins over the default', () => {
    const remembered = { 'area-a-work': false, 'goal-g-read': true };
    const isOpen = (key, def) => remembered[key] ?? def;
    expect(keys(projectPickerRows(groups, { isOpen, selectedId: 'p-api' }))).toEqual([
      'area-a-work+@0',
      'area-none@0', 'goal-g-read@1', 'p-books@2',
      'standalone+@0',
    ]);
  });

  it('while a filter is typed, every group is open', () => {
    const isOpen = () => false;
    expect(keys(projectPickerRows(groups, { isOpen, filtering: true }))).toEqual([
      'area-a-work@0', 'goal-g-ship@1', 'p-api@2', 'p-docs@2',
      'area-none@0', 'goal-g-read@1', 'p-books@2',
      'standalone@0', 'p-solo@1',
    ]);
  });

  it('with no area in use, goals sit at the top level; with no goals, the standalone projects are open', () => {
    const flat = groupInboxProjects({ projects, goals, areas: [] });
    expect(keys(projectPickerRows(flat))).toEqual(['goal-g-ship+@0', 'goal-g-read+@0', 'standalone+@0']);
    const none = groupInboxProjects({ projects: [{ id: 'p-solo', title: 'Solo' }], goals: [], areas: [] });
    expect(keys(projectPickerRows(none))).toEqual(['standalone@0', 'p-solo@1']);
  });

  it('a group row carries its title, colour and project count', () => {
    const [work, ship] = projectPickerRows(groups);
    expect(work).toMatchObject({ kind: 'area', title: 'Work', count: 2 });
    expect(ship).toMatchObject({ kind: 'goal', title: 'Ship v6', color: 'bg-rose-500', count: 2 });
  });
});
