import { describe, it, expect } from 'vitest';
import { handleMcpWrite, progressTasksOf } from './mcpWriteModel.js';
import { projectItem } from '@glance-apps/dayglance-mcp/model';

// A completed or archived project takes no new work over MCP (#2385). Walked
// the way the app runs a write: through handleMcpWrite, its setters landing in
// a store, and the result read back as dayglance_get_goal_progress reads a
// project (projectItem over the progress tasks). The bug was visible there: a
// finished project fell from 2/2 to 2/3 or 0/N once a write put an open task
// in it. Asserting on the mutation's return alone would not show the store
// was left as it was.

const NOW = '2026-11-13T12:00:00.000Z';
const MON = '2026-11-16';

function makeStore(initial = {}) {
  const store = {
    state: {
      tasks: [
        { id: 'd1', title: 'Done on the calendar', date: '2026-11-10', startTime: '09:00', duration: 30, completed: true, projectId: 'p-done' },
      ],
      unscheduledTasks: [
        { id: 'd2', title: 'Done in the list', completed: true, projectId: 'p-done' },
        { id: 'u1', title: 'Inbox task', completed: false },
        { id: 'a1', title: 'Other project task', completed: false, projectId: 'p-open' },
      ],
      recurringTasks: [],
      recycleBin: [],
      goals: [],
      users: [],
      projects: [
        { id: 'p-open', title: 'Open', status: 'active' },
        { id: 'p-hold', title: 'Paused', status: 'on-hold' },
        { id: 'p-done', title: 'Shipped', status: 'completed' },
        { id: 'p-arch', title: 'Shelved', status: 'archived' },
      ],
      ...initial,
    },
  };
  const setter = (key) => (value) => {
    store.state = { ...store.state, [key]: typeof value === 'function' ? value(store.state[key]) : value };
  };
  store.setters = {
    setTasks: setter('tasks'),
    setUnscheduledTasks: setter('unscheduledTasks'),
    setRecurringTasks: setter('recurringTasks'),
    setRecycleBin: setter('recycleBin'),
    setGoals: setter('goals'),
    setProjects: setter('projects'),
  };
  store.write = (method, params) => handleMcpWrite(store.state, store.setters, { method, params });
  store.project = (id) => projectItem(store.state.projects.find((p) => p.id === id), progressTasksOf(store.state));
  return store;
}

const createSeries = (store, over = {}) => store.write('create_task', {
  taskId: 'series-1', title: 'Standup',
  schedule: { date: MON, startTime: '09:00', durationMinutes: 15 },
  recurrence: { type: 'weekly', daysOfWeek: [1] },
  ...over,
});

const DONE = { tasks_done: 2, tasks_total: 2, progress_percent: 100 };

describe('create_task into a finished project', () => {
  it('a completed project refuses an unscheduled, a scheduled and a repeating create, and stays 2/2', () => {
    const store = makeStore();
    const before = store.state;
    const creates = [
      store.write('create_task', { taskId: 'n1', title: 'x', projectId: 'p-done' }),
      store.write('create_task', {
        taskId: 'n2', title: 'x', projectId: 'p-done', schedule: { date: MON, startTime: '10:00', durationMinutes: 30 },
      }),
      createSeries(store, { projectId: 'p-done' }),
    ];
    for (const r of creates) {
      expect(r).toMatchObject({ ok: false, error: { code: 'validation' } });
      expect(r.error.message).toContain('"Shipped" is completed');
      // The way out is named: reopen it with the tool that can.
      expect(r.error.message).toContain('dayglance_update_project');
      expect(r.undo).toBeUndefined();
    }
    expect(store.state).toBe(before);
    expect(store.project('p-done')).toMatchObject(DONE);
  });

  it('an archived project refuses the same creates, without offering a tool that cannot unarchive', () => {
    const store = makeStore();
    const before = store.state;
    const r = store.write('create_task', { taskId: 'n1', title: 'x', projectId: 'p-arch' });
    expect(r).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(r.error.message).toContain('"Shelved" is archived');
    expect(r.error.message).not.toContain('dayglance_update_project');
    expect(createSeries(store, { projectId: 'p-arch' })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(store.state).toBe(before);
  });

  it('an active and an on-hold project still take tasks, as the pickers offer both', () => {
    const store = makeStore();
    expect(store.write('create_task', { taskId: 'n1', title: 'x', projectId: 'p-open' }).ok).toBe(true);
    expect(store.write('create_task', { taskId: 'n2', title: 'y', projectId: 'p-hold' }).ok).toBe(true);
    expect(store.project('p-open').tasks_total).toBe(2);
    expect(store.project('p-hold').tasks_total).toBe(1);
  });

  it('a project with no status is open: rows from before the field existed', () => {
    const store = makeStore({ projects: [{ id: 'p-old', title: 'Old' }] });
    expect(store.write('create_task', { taskId: 'n1', title: 'x', projectId: 'p-old' }).ok).toBe(true);
  });

  it('a replay of a create that landed before the project was completed still answers with its task', () => {
    const store = makeStore();
    expect(store.write('create_task', { taskId: 'n1', title: 'x', projectId: 'p-open' }).ok).toBe(true);
    createSeries(store, { projectId: 'p-open' });
    store.setters.setProjects((prev) => prev.map((p) => (p.id === 'p-open' ? { ...p, status: 'completed' } : p)));
    const replay = store.write('create_task', { taskId: 'n1', title: 'x', projectId: 'p-open' });
    expect(replay).toMatchObject({ ok: true, data: { replayed: true } });
    expect(createSeries(store, { projectId: 'p-open' })).toMatchObject({ ok: true, data: { replayed: true } });
  });

  it('reopening the project is the way in: the create lands once it is active', () => {
    const store = makeStore();
    expect(store.write('update_project', { projectId: 'p-done', set: { status: 'active' }, clear: [] }).ok).toBe(true);
    expect(store.write('create_task', { taskId: 'n1', title: 'x', projectId: 'p-done' }).ok).toBe(true);
    expect(store.project('p-done')).toMatchObject({ tasks_done: 2, tasks_total: 3 });
  });
});

describe('update_task into a finished project', () => {
  it('refuses to move an inbox task or a scheduled one into a completed or archived project', () => {
    const store = makeStore();
    const before = store.state;
    for (const [taskId, projectId] of [['u1', 'p-done'], ['a1', 'p-done'], ['d1', 'p-arch'], ['u1', 'p-arch']]) {
      const r = store.write('update_task', { taskId, set: { projectId }, clear: [] });
      expect(r).toMatchObject({ ok: false, error: { code: 'validation' } });
    }
    expect(store.state).toBe(before);
    expect(store.project('p-done')).toMatchObject(DONE);
  });

  it('refuses the whole call: a title sent with the move does not land either', () => {
    const store = makeStore();
    const r = store.write('update_task', { taskId: 'u1', set: { title: 'Renamed', projectId: 'p-done' }, clear: [] });
    expect(r.ok).toBe(false);
    expect(store.state.unscheduledTasks.find((t) => t.id === 'u1').title).toBe('Inbox task');
  });

  it('a task already in the completed project can be edited with its own project named', () => {
    const store = makeStore();
    const r = store.write('update_task', { taskId: 'd2', set: { notes: 'Wrap-up', projectId: 'p-done' }, clear: [] });
    expect(r.ok).toBe(true);
    expect(store.state.unscheduledTasks.find((t) => t.id === 'd2')).toMatchObject({ notes: 'Wrap-up', projectId: 'p-done' });
    expect(store.project('p-done')).toMatchObject(DONE);
  });

  it('a task can leave a completed project, and an unknown project is still not_found', () => {
    const store = makeStore();
    expect(store.write('update_task', { taskId: 'd2', set: {}, clear: ['project'] }).ok).toBe(true);
    expect(store.write('update_task', { taskId: 'd1', set: { projectId: 'p-open' }, clear: [] }).ok).toBe(true);
    expect(store.project('p-done').tasks_total).toBe(0);
    expect(store.write('update_task', { taskId: 'u1', set: { projectId: 'nope' }, clear: [] }))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('the undo of a move out of a project completed since puts the task back: an undo is not a new assignment', () => {
    const store = makeStore({
      unscheduledTasks: [{ id: 'm1', title: 'Moved', completed: true, projectId: 'p-open' }],
    });
    const moved = store.write('update_task', { taskId: 'm1', set: {}, clear: ['project'] });
    expect(moved.ok).toBe(true);
    store.setters.setProjects((prev) => prev.map((p) => (p.id === 'p-open' ? { ...p, status: 'completed' } : p)));
    expect(store.write('undo_mcp_writes', { ops: [moved.undo.op] }).ok).toBe(true);
    expect(store.state.unscheduledTasks[0].projectId).toBe('p-open');
  });
});

describe('update_recurring_task into a finished project', () => {
  const edit = (store, set, clear = []) => store.write('update_recurring_task', {
    taskId: `recurring-series-1-${MON}`, scope: 'series', set, clear,
  });

  it('refuses to move a series into a completed or archived project and leaves the template alone', () => {
    const store = makeStore();
    createSeries(store);
    const before = store.state.recurringTasks;
    for (const projectId of ['p-done', 'p-arch']) {
      expect(edit(store, { projectId, notes: 'x' })).toMatchObject({ ok: false, error: { code: 'validation' } });
    }
    expect(store.state.recurringTasks).toBe(before);
    expect(before[0]).not.toHaveProperty('projectId');
  });

  it('a series already in the project keeps taking edits that name it, and can still be moved to an open one', () => {
    const store = makeStore();
    createSeries(store, { projectId: 'p-open' });
    store.setters.setProjects((prev) => prev.map((p) => (p.id === 'p-open' ? { ...p, status: 'completed' } : p)));
    expect(edit(store, { projectId: 'p-open', notes: 'Agenda' }).ok).toBe(true);
    expect(store.state.recurringTasks[0]).toMatchObject({ projectId: 'p-open', notes: 'Agenda' });
    expect(edit(store, { projectId: 'p-hold' }).ok).toBe(true);
    expect(store.state.recurringTasks[0].projectId).toBe('p-hold');
  });
});
