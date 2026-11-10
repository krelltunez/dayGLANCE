import { describe, it, expect } from 'vitest';
import { filterProjectGroups, groupInboxProjects, projectIdsOf, projectOptionGroups, selectionState, toggleProjectGroup } from './inboxProjectGroups.js';

// #2232: the Inbox filter's projects by area and goal, and the goal/area chips.
const areas = [{ id: 'a-work', name: 'Work' }, { id: 'a-home', name: 'Home' }, { id: 'a-empty', name: 'Empty' }];
const goals = [
  { id: 'g-ship', title: 'Ship v6', areaId: 'a-work' },
  { id: 'g-house', title: 'Fix the house', areaId: 'a-home' },
  { id: 'g-loose', title: 'Read more' },
  { id: 'g-gone-area', title: 'Orphan goal', areaId: 'a-deleted' },
  { id: 'g-old', title: 'Old goal', areaId: 'a-work', status: 'archived' },
  { id: 'g-nothing', title: 'No projects', areaId: 'a-work' },
];
const projects = [
  { id: 'p-api', title: 'API', goalId: 'g-ship' },
  { id: 'p-docs', title: 'Docs', goalId: 'g-ship' },
  { id: 'p-roof', title: 'Roof', goalId: 'g-house' },
  { id: 'p-books', title: 'Books', goalId: 'g-loose' },
  { id: 'p-orphan', title: 'Orphan', goalId: 'g-gone-area' },
  { id: 'p-legacy', title: 'Legacy', goalId: 'g-old' },
  { id: 'p-solo', title: 'Solo' },
  { id: 'p-done', title: 'Done', goalId: 'g-ship', status: 'completed' },
  { id: 'p-arch', title: 'Archived', status: 'archived' },
];

describe('on-hold projects in the pickers', () => {
  it('are still offered, after the active ones in their group', () => {
    const groups = groupInboxProjects({
      goals: [{ id: 'g', title: 'G' }],
      projects: [
        { id: 'paused', goalId: 'g', status: 'on-hold' },
        { id: 'live', goalId: 'g', status: 'active' },
        { id: 'solo-paused', status: 'on-hold' },
        { id: 'solo', status: 'active' },
      ],
    });
    expect(groups.areas[0].goals[0].projects.map((p) => p.id)).toEqual(['live', 'paused']);
    expect(groups.standalone.map((p) => p.id)).toEqual(['solo', 'solo-paused']);
  });
});

describe('groupInboxProjects', () => {
  const groups = groupInboxProjects({ projects, goals, areas });

  it('areas in their own order, each with its goals and their projects; empty ones left out', () => {
    expect(groups.areas.map(a => [a.id, a.title, a.goals.map(g => [g.id, g.projects.map(p => p.id)])])).toEqual([
      ['a-work', 'Work', [['g-ship', ['p-api', 'p-docs']]]],
      ['a-home', 'Home', [['g-house', ['p-roof']]]],
      // Goals with no area, or an area that no longer exists, last.
      [null, null, [['g-loose', ['p-books']], ['g-gone-area', ['p-orphan']]]],
    ]);
    expect(groups.hasAreas).toBe(true);
  });

  it('standalone: projects with no goal, or whose goal is archived; no completed or archived project anywhere', () => {
    expect(groups.standalone.map(p => p.id)).toEqual(['p-legacy', 'p-solo']);
  });

  it('with no area in use, there is no area level', () => {
    const flat = groupInboxProjects({ projects, goals: goals.map(({ areaId: _a, ...g }) => g), areas });
    expect(flat.hasAreas).toBe(false);
    expect(flat.areas).toHaveLength(1);
    expect(flat.areas[0].id).toBeNull();
  });

  it('nothing to group', () => {
    expect(groupInboxProjects()).toEqual({ areas: [], standalone: [], hasAreas: false });
  });
});

describe('selecting a goal or an area', () => {
  const groups = groupInboxProjects({ projects, goals, areas });
  const work = groups.areas[0];
  const ship = work.goals[0];

  it('an area holds every project of its goals; a goal its own', () => {
    expect(projectIdsOf(work)).toEqual(['p-api', 'p-docs']);
    expect(projectIdsOf(ship)).toEqual(['p-api', 'p-docs']);
    expect(projectIdsOf(groups.areas[2])).toEqual(['p-books', 'p-orphan']);
  });

  it('reads all, some or none of a group as selected', () => {
    expect(selectionState(['p-api', 'p-docs', 'p-roof'], ['p-api', 'p-docs'])).toBe('all');
    expect(selectionState(['p-api'], ['p-api', 'p-docs'])).toBe('some');
    expect(selectionState(['p-roof'], ['p-api', 'p-docs'])).toBe('none');
    expect(selectionState(['p-roof'], [])).toBe('none');
  });

  it('none or some becomes all; all becomes none; other selections stay', () => {
    expect(toggleProjectGroup(['p-roof'], ['p-api', 'p-docs'])).toEqual(['p-roof', 'p-api', 'p-docs']);
    expect(toggleProjectGroup(['p-roof', 'p-api'], ['p-api', 'p-docs'])).toEqual(['p-roof', 'p-api', 'p-docs']);
    expect(toggleProjectGroup(['p-docs', 'p-roof', 'p-api'], ['p-api', 'p-docs'])).toEqual(['p-roof']);
  });
});

// #2250: the Day Dial's complication picker, a native <select>, lists
// projects by goal too: one labelled group per goal, then the standalone ones.
describe('projectOptionGroups', () => {
  it('one group per goal, area and goal named, in the space\'s order, standalone last', () => {
    const groups = projectOptionGroups({ projects, goals, areas });
    expect(groups.map(g => [g.key, g.area, g.goal, g.standalone, g.projects.map(p => p.id)])).toEqual([
      ['goal-g-ship', 'Work', 'Ship v6', false, ['p-api', 'p-docs']],
      ['goal-g-house', 'Home', 'Fix the house', false, ['p-roof']],
      ['goal-g-loose', null, 'Read more', false, ['p-books']],
      ['goal-g-gone-area', null, 'Orphan goal', false, ['p-orphan']],
      ['standalone', null, null, true, ['p-legacy', 'p-solo']],
    ]);
  });

  it('lists what the caller says: the dial\'s active projects, and the one a corner already shows', () => {
    const shown = 'p-done';
    const isListed = (p) => (p.status ?? 'active') === 'active' || p.id === shown;
    const ship = projectOptionGroups({ projects, goals, areas }, { isListed }).find(g => g.key === 'goal-g-ship');
    // p-done is completed: listed only because a corner shows it, so it can be taken off.
    expect(ship.projects.map(p => p.id)).toEqual(['p-api', 'p-docs', 'p-done']);
  });

  it('nothing to list, no groups', () => {
    expect(projectOptionGroups({ projects: [], goals, areas })).toEqual([]);
  });
});

// #2279: the task editor's project picker narrows the tree to a typed filter.
describe('filterProjectGroups', () => {
  const groups = groupInboxProjects({ projects, goals, areas });
  const ids = (g) => [g.areas.map(a => [a.id, a.goals.map(goal => [goal.id, goal.projects.map(p => p.id)])]), g.standalone.map(p => p.id)];

  it('a blank filter keeps everything', () => {
    expect(filterProjectGroups(groups, '  ')).toBe(groups);
    expect(filterProjectGroups(groups, undefined)).toBe(groups);
  });

  it('keeps the projects whose title holds it, ignoring case, and drops the groups left empty', () => {
    expect(ids(filterProjectGroups(groups, 'OO'))).toEqual([
      [['a-home', [['g-house', ['p-roof']]]], [null, [['g-loose', ['p-books']]]]],
      [],
    ]);
    expect(ids(filterProjectGroups(groups, 'sol'))).toEqual([[], ['p-solo']]);
  });

  it('a goal or an area that matches keeps all of its projects', () => {
    expect(ids(filterProjectGroups(groups, 'ship'))).toEqual([[['a-work', [['g-ship', ['p-api', 'p-docs']]]]], []]);
    expect(ids(filterProjectGroups(groups, 'home'))).toEqual([[['a-home', [['g-house', ['p-roof']]]]], []]);
  });

  it('nothing matching, nothing left', () => {
    expect(ids(filterProjectGroups(groups, 'zzz'))).toEqual([[], []]);
  });
});

// #2365: the task editor's picker offers a goal's General project, so a goal
// with no projects has to be listed there; the Inbox filter and the Day Dial
// still leave it out.
describe('keepEmptyGoals', () => {
  const lists = { goals: [{ id: 'g1', title: 'Garden' }, { id: 'g2', title: 'Books' }], projects: [{ id: 'p1', title: 'Reading list', goalId: 'g2' }] };

  it('is off by default: an empty goal is left out', () => {
    expect(groupInboxProjects(lists).areas.flatMap((a) => a.goals).map((g) => g.id)).toEqual(['g2']);
  });

  it('on, the empty goal is kept, with no projects', () => {
    const goals = groupInboxProjects(lists, { keepEmptyGoals: true }).areas.flatMap((a) => a.goals);
    expect(goals.map((g) => [g.id, g.projects.length])).toEqual([['g1', 0], ['g2', 1]]);
  });

  it('a filter that names an empty goal keeps it; one that does not drops it', () => {
    const groups = groupInboxProjects(lists, { keepEmptyGoals: true });
    expect(filterProjectGroups(groups, 'gard').areas.flatMap((a) => a.goals).map((g) => g.id)).toEqual(['g1']);
    expect(filterProjectGroups(groups, 'reading').areas.flatMap((a) => a.goals).map((g) => g.id)).toEqual(['g2']);
  });
});
