import { describe, it, expect } from 'vitest';
import { buildWidgetGoalsProjects, buildWidgetDueOn, WIDGET_PROJECT_TASK_LIMIT } from './widgetGoalsProjects.js';

const goal = { id: 'g1', title: 'Launch', status: 'active', color: 'bg-emerald-500' };
const build = (over = {}) => buildWidgetGoalsProjects({
  goals: [goal],
  projects: [],
  scheduled: [],
  unscheduled: [],
  todayStr: '2026-09-25',
  ...over,
});

describe('buildWidgetGoalsProjects: the Project widget', () => {
  it('lists a project\'s tasks in the project card\'s order', () => {
    const { allProjects } = build({
      projects: [{ id: 'p1', title: 'Site', goalId: 'g1', status: 'active' }],
      scheduled: [
        { id: 's-oct', projectId: 'p1', title: 'Ship', date: '2026-10-02' },
        { id: 's-sep', projectId: 'p1', title: 'Draft', date: '2026-09-28' },
        { id: 's-done', projectId: 'p1', title: 'Kickoff', date: '2026-09-01', completed: true },
      ],
      unscheduled: [
        { id: 'u-b', projectId: 'p1', title: 'Copy #web', projectOrder: 20 },
        { id: 'u-a', projectId: 'p1', title: '[[Logo]]', projectOrder: 10 },
        { id: 'u-archived', projectId: 'p1', title: 'Old', archived: true },
        { id: 'other', projectId: 'p2', title: 'Elsewhere' },
      ],
    });
    const [p] = allProjects;
    expect(p.tasks.map((t) => t.id)).toEqual(['s-sep', 's-oct', 'u-a', 'u-b', 's-done']);
    expect(p.tasks.map((t) => t.title)).toEqual(['Draft', 'Ship', 'Logo', 'Copy', 'Kickoff']);
    expect(p).toMatchObject({ totalTasks: 5, completedTasks: 1, progressPct: 20, goalTitle: 'Launch', goalColorHex: '#10b981', colorHex: '#10b981' });
  });

  it('carries up to the limit, while the totals count every task', () => {
    const unscheduled = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, projectId: 'p1', title: `T${i}`, projectOrder: i }));
    const [p] = build({ projects: [{ id: 'p1', title: 'Big', status: 'active' }], unscheduled }).allProjects;
    expect(p.tasks).toHaveLength(WIDGET_PROJECT_TASK_LIMIT);
    expect(p.totalTasks).toBe(20);
    expect(p.goalId).toBe('');
  });

  it('gives every project a colour: its own, else its goal\'s, else the fallback', () => {
    const { allProjects } = build({
      projects: [
        { id: 'own', title: 'Own', goalId: 'g1', status: 'active', color: 'bg-red-500' },
        { id: 'goal', title: 'Goal', goalId: 'g1', status: 'active' },
        { id: 'alone', title: 'Alone', status: 'active' },
      ],
    });
    expect(allProjects.map((p) => [p.id, p.colorHex, p.goalColorHex])).toEqual([
      ['own', '#ef4444', '#10b981'],
      ['goal', '#10b981', '#10b981'],
      ['alone', '#3b82f6', ''],
    ]);
  });

  it('leaves archived projects out', () => {
    const { allProjects } = build({ projects: [{ id: 'p1', title: 'A', status: 'archived' }] });
    expect(allProjects).toEqual([]);
  });

  it('lists only the projects the app shows: none under an archived, deleted or hidden goal', () => {
    const { allProjects } = build({
      goals: [goal, { id: 'g-old', title: 'Old', status: 'archived' }, { id: 'g-done', title: 'Done', status: 'completed' }],
      projects: [
        { id: 'under-active', goalId: 'g1', status: 'active' },
        { id: 'under-completed-goal', goalId: 'g-done', status: 'active' },
        { id: 'standalone', status: 'completed' },
        { id: 'under-archived', goalId: 'g-old', status: 'active' },
        { id: 'under-deleted', goalId: 'g-gone', status: 'active' },
      ],
    });
    // A completed project stays in the payload (a widget already pinned to
    // it shows it as done); the pickers hide completed ones themselves.
    expect(allProjects.map((p) => p.id)).toEqual(['under-active', 'under-completed-goal', 'standalone']);
  });
});

describe('buildWidgetGoalsProjects: the Goal widget', () => {
  it('lists a goal\'s projects by sortOrder, open before completed, archived left out', () => {
    const { allGoals } = build({
      projects: [
        { id: 'done-first', goalId: 'g1', status: 'completed', sortOrder: 0 },
        { id: 'second', goalId: 'g1', status: 'active', sortOrder: 2 },
        { id: 'unordered', goalId: 'g1', status: 'active' },
        { id: 'first', goalId: 'g1', status: 'active', sortOrder: 1 },
        { id: 'gone', goalId: 'g1', status: 'archived', sortOrder: 0 },
      ],
    });
    expect(allGoals[0].projects.map((p) => p.id)).toEqual(['first', 'second', 'unordered', 'done-first']);
  });

  it('only active goals, with days until due', () => {
    const { allGoals } = build({
      goals: [{ ...goal, targetDate: '2026-10-05' }, { id: 'g2', title: 'Paused', status: 'paused' }],
    });
    expect(allGoals.map((g) => g.id)).toEqual(['g1']);
    expect(allGoals[0].daysUntilDue).toBe(10);
  });
});

// #2160: a project's own target date, for the Project widget's due badge.
describe('buildWidgetGoalsProjects: a project\'s target date', () => {
  it('carries targetDate and daysUntilDue in the goal\'s shape', () => {
    const { allProjects } = build({
      projects: [
        { id: 'p1', title: 'Roof', status: 'active', targetDate: '2026-09-28' },
        { id: 'p2', title: 'Garden', status: 'active', targetDate: '2026-09-20' },
        { id: 'p3', title: 'Open-ended', status: 'active' },
      ],
    });
    const byId = Object.fromEntries(allProjects.map((p) => [p.id, p]));
    expect(byId.p1).toMatchObject({ targetDate: '2026-09-28', daysUntilDue: 3 });
    expect(byId.p2).toMatchObject({ targetDate: '2026-09-20', daysUntilDue: -5 });
    expect(byId.p3).toMatchObject({ targetDate: '', daysUntilDue: null });
  });
});

describe('buildWidgetDueOn', () => {
  it('lists the goals and projects due on a date, each in its own list', () => {
    const due = buildWidgetDueOn({
      goals: [{ id: 'g', title: 'Ship', status: 'active', targetDate: '2026-09-26' }],
      projects: [
        { id: 'gp', title: 'Child', status: 'active', goalId: 'g' },
        { id: 'p', title: 'Roof', status: 'active', targetDate: '2026-09-26' },
        { id: 'q', title: 'Other day', status: 'active', targetDate: '2026-09-27' },
      ],
      tasks: [{ id: 't1', projectId: 'gp', completed: true }, { id: 't2', projectId: 'p', completed: false }],
      dateStr: '2026-09-26',
    });
    expect(due.goals).toEqual([{ id: 'g', title: 'Ship', progressPct: 100, totalTasks: 1, completedTasks: 1 }]);
    expect(due.projects).toEqual([{ id: 'p', title: 'Roof', progressPct: 0, totalTasks: 1, completedTasks: 0 }]);
  });
});

// On hold (utils/projectStatus.js): still listed, after the active projects,
// with its status for the widget to draw it paused and without a due badge.
describe('buildWidgetGoalsProjects: projects on hold', () => {
  it('a goal lists them after its active projects and before its completed ones, whatever their sortOrder', () => {
    const { allGoals } = build({
      projects: [
        { id: 'paused', goalId: 'g1', status: 'on-hold', sortOrder: 0 },
        { id: 'done', goalId: 'g1', status: 'completed', sortOrder: 1 },
        { id: 'live', goalId: 'g1', status: 'active', sortOrder: 2 },
      ],
    });
    expect(allGoals[0].projects.map((p) => [p.id, p.status])).toEqual([['live', 'active'], ['paused', 'on-hold'], ['done', 'completed']]);
  });

  it('the project list offers them after the others, carrying status and target date', () => {
    const { allProjects } = build({
      projects: [
        { id: 'paused', title: 'Paused', status: 'on-hold', targetDate: '2026-09-20' },
        { id: 'live', title: 'Live', status: 'active' },
        { id: 'done', title: 'Done', status: 'completed' },
      ],
    });
    expect(allProjects.map((p) => p.id)).toEqual(['live', 'done', 'paused']);
    expect(allProjects[2]).toMatchObject({ status: 'on-hold', targetDate: '2026-09-20', daysUntilDue: -5 });
  });

  it('the day widgets\' due rows leave them out', () => {
    const due = buildWidgetDueOn({
      goals: [],
      projects: [{ id: 'paused', title: 'Paused', status: 'on-hold', targetDate: '2026-09-25' }],
      tasks: [],
      dateStr: '2026-09-25',
    });
    expect(due.projects).toEqual([]);
  });
});
