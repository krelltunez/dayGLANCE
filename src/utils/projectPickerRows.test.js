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

  it('a group row carries the ids of every project under it, folded or not (#2332)', () => {
    const rows = projectPickerRows(groups);
    const byKey = Object.fromEntries(rows.filter((r) => r.type === 'group').map((r) => [r.key, r]));
    // Read more sits in no area, so "No defined area" holds it.
    expect(byKey['area-a-work'].ids).toEqual(['p-api', 'p-docs']);
    expect(byKey['goal-g-ship']).toMatchObject({ open: false, ids: ['p-api', 'p-docs'] });
    expect(byKey['area-none'].ids).toEqual(['p-books']);
    expect(byKey.standalone).toMatchObject({ open: false, ids: ['p-solo'] });
  });
});

// #2365: with `general`, each goal opens on its General project
// (utils/goalGeneralProject.js): the one it has, first, or a row to make one.
describe('a goal\'s General project in the rows', () => {
  const open = () => true;
  const keysG = (rows) => rows.map((r) => (r.type === 'group' ? r.key : r.type === 'general' ? r.key : r.project.id));
  const withEmpty = [...goals, { id: 'g-garden', title: 'Garden' }];

  it('off (as every other picker draws them), no General rows', () => {
    const rows = projectPickerRows(groupInboxProjects({ projects, goals, areas }), { isOpen: open });
    expect(rows.some((r) => r.type === 'general')).toBe(false);
  });

  it('on, each goal starts with a row that makes one, at its projects\' level; an empty goal has just that', () => {
    const rows = projectPickerRows(groupInboxProjects({ projects, goals: withEmpty, areas }, { keepEmptyGoals: true }), { isOpen: open, general: true });
    expect(keysG(rows)).toEqual([
      'area-a-work', 'goal-g-ship', 'general-g-ship', 'p-api', 'p-docs',
      'area-none', 'goal-g-read', 'general-g-read', 'p-books', 'goal-g-garden', 'general-g-garden',
      'standalone', 'p-solo',
    ]);
    const ship = rows.find((r) => r.key === 'general-g-ship');
    expect(ship.level).toBe(rows.find((r) => r.type === 'project' && r.project.id === 'p-api').level);
    expect(ship.goal.id).toBe('g-ship');
  });

  it('a goal with a General project lists that one first, and no row to make another', () => {
    const own = { id: 'p-gen', title: 'Odds and ends', goalId: 'g-ship', goalGeneral: true };
    const rows = projectPickerRows(groupInboxProjects({ projects: [...projects, own], goals, areas }), { isOpen: open, general: true });
    const ship = keysG(rows).slice(keysG(rows).indexOf('goal-g-ship') + 1, keysG(rows).indexOf('area-none'));
    expect(ship).toEqual(['p-gen', 'p-api', 'p-docs']);
  });

  it('showGeneral hides the row to make one (a filter naming neither it nor the goal), unless it is the task\'s choice', () => {
    const groups = groupInboxProjects({ projects, goals, areas });
    const hidden = projectPickerRows(groups, { isOpen: open, general: true, showGeneral: () => false });
    expect(hidden.some((r) => r.type === 'general')).toBe(false);
    const chosen = projectPickerRows(groups, { isOpen: open, general: true, showGeneral: () => false, selectedId: '__goal-general__:g-read' });
    expect(chosen.filter((r) => r.type === 'general').map((r) => r.key)).toEqual(['general-g-read']);
  });

  it('a goal whose General project is the task\'s pending choice opens unfolded', () => {
    const rows = projectPickerRows(groupInboxProjects({ projects, goals, areas }), { general: true, selectedId: '__goal-general__:g-read' });
    expect(rows.find((r) => r.key === 'goal-g-read').open).toBe(true);
    expect(rows.find((r) => r.key === 'goal-g-ship').open).toBe(false);
  });
});
