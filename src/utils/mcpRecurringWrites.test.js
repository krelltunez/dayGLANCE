import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleMcpWrite, isWriteMethod } from './mcpWriteModel.js';
import { buildDayBlocks } from '@glance-apps/dayglance-mcp/model';
import { applyCreateTask, applyUpdateRecurringTask, applyUndoOps } from './taskMutations.js';
import { DELETED_TASK_IDS_KEY } from './deletedTaskTombstones.js';

// Repeating tasks over MCP (#2066), walked the way the app runs them: the
// write goes through handleMcpWrite, its setters land in a store, and the
// result is read back through buildDayBlocks, the get_day read. Asserting on
// the mutation's return value alone would not show that the series reaches
// the state the rest of the app reads.

const NOW = '2026-10-12T12:00:00.000Z';
// 2026-10-12 is a Monday.
const MON = '2026-10-12';
const WED = '2026-10-14';
const NEXT_MON = '2026-10-19';

function makeStore(initial = {}) {
  const store = {
    state: { tasks: [], unscheduledTasks: [], recurringTasks: [], recycleBin: [], projects: [], goals: [], users: [], ...initial },
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
  store.day = (date) => buildDayBlocks(store.state, { date }).blocks.filter((b) => b.type !== 'routine');
  return store;
}

const createSeries = (store, over = {}) => store.write('create_task', {
  taskId: 'series-1',
  title: 'Standup',
  schedule: { date: MON, startTime: '09:00', durationMinutes: 15, allDay: false },
  recurrence: { type: 'weekly', daysOfWeek: [1, 3] },
  ...over,
});

beforeEach(() => {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
});
afterEach(() => { delete globalThis.localStorage; });

describe('create_task with a repeat', () => {
  it('stores one template that get_day expands on every occurrence, with its pattern', () => {
    const store = makeStore();
    const r = createSeries(store);
    expect(r.ok).toBe(true);
    expect(r.data.series).toEqual({
      id: 'series-1', title: 'Standup', start_date: MON,
      repeat: { frequency: 'weekly', days_of_week: ['mon', 'wed'] },
    });
    expect(r.data.next_occurrences).toEqual([MON, WED, NEXT_MON, '2026-10-21', '2026-10-26']);
    expect(r.data.first_occurrence).toMatchObject({ id: `recurring-series-1-${MON}`, start_time: '09:00', duration_minutes: 15 });
    expect(r.undo).toEqual({
      summary: `Created repeating “Standup” from ${MON}`,
      op: { kind: 'remove_created_series', templateId: 'series-1' },
    });

    expect(store.state.tasks).toEqual([]);
    expect(store.state.recurringTasks).toHaveLength(1);
    const [template] = store.state.recurringTasks;
    expect(template).toMatchObject({
      id: 'series-1', startTime: '09:00', duration: 15, isAllDay: false, color: 'bg-blue-500',
      recurrence: { type: 'weekly', daysOfWeek: [1, 3], startDate: MON },
      completedDates: [], exceptions: {}, subtasks: [], lastModified: expect.any(String),
    });
    // Not a task row: no transitionId to declare to the sync layers.
    expect(template).not.toHaveProperty('transitionId');

    for (const date of [MON, WED, NEXT_MON]) {
      const [block] = store.day(date);
      expect(block).toMatchObject({
        id: `recurring-series-1-${date}`, type: 'recurring_task', series_id: 'series-1',
        repeat: { frequency: 'weekly', days_of_week: ['mon', 'wed'] }, series_start_date: MON,
      });
    }
    expect(store.day('2026-10-13')).toEqual([]);
  });

  it('stores all-day series as the UI does (startTime 00:00)', () => {
    const store = makeStore();
    createSeries(store, { schedule: { date: MON, startTime: '00:00', durationMinutes: 30, allDay: true }, recurrence: { type: 'daily' } });
    expect(store.state.recurringTasks[0]).toMatchObject({ startTime: '00:00', isAllDay: true });
    expect(store.day(WED)[0]).toMatchObject({ all_day: true, start_time: null });
  });

  it('a replay returns the series unchanged and journals nothing', () => {
    const store = makeStore();
    createSeries(store);
    const before = store.state.recurringTasks;
    const r = createSeries(store, { title: 'Different' });
    expect(r.ok).toBe(true);
    expect(r.data.replayed).toBe(true);
    expect(r.data.series.title).toBe('Standup');
    expect(r.undo).toBeUndefined();
    expect(store.state.recurringTasks).toBe(before);
  });

  it('inherits the project colour and users, like a one-off create', () => {
    const store = makeStore({
      projects: [{ id: 'p1', title: 'Work', color: 'bg-green-500', assignedUserSyncIds: ['u-a'] }],
    });
    const r = createSeries(store, { projectId: 'p1' });
    expect(store.state.recurringTasks[0]).toMatchObject({ projectId: 'p1', color: 'bg-green-500', assignedUserSyncIds: ['u-a'] });
    expect(r.data.series.project_id).toBe('p1');
  });

  it('rejects a pattern with no occurrence, and a first occurrence on a routine', () => {
    const empty = applyCreateTask({}, {
      taskId: 's', title: 'x', schedule: { date: MON, startTime: '09:00', durationMinutes: 15 },
      recurrence: { type: 'weekly', daysOfWeek: [3], endDate: '2026-10-13' }, nowIso: NOW,
    });
    expect(empty).toMatchObject({ ok: false, error: { code: 'validation' } });

    const routineState = {
      routines: [{ id: 'r1', name: 'Gym', startTime: '09:00', duration: 60, isAllDay: false }],
      routinesDate: MON, routineCompletions: {}, routinesEnabled: true, todayDate: MON,
    };
    const hit = applyCreateTask(routineState, {
      taskId: 's', title: 'x', schedule: { date: MON, startTime: '09:30', durationMinutes: 15 },
      recurrence: { type: 'daily' }, nowIso: NOW,
    });
    expect(hit).toMatchObject({ ok: false, error: { code: 'routine_conflict' } });
  });

  it('undo removes the series and tombstones it, as the app\'s own series delete does', () => {
    const store = makeStore();
    const created = createSeries(store);
    const r = store.write('undo_mcp_writes', { ops: [created.undo.op] });
    expect(r.data).toEqual({ undone: 1, skipped: 0 });
    expect(store.state.recurringTasks).toEqual([]);
    expect(store.state.recycleBin).toEqual([]);
    expect(Object.keys(JSON.parse(localStorage.getItem(DELETED_TASK_IDS_KEY)))).toEqual(['series-1']);
    expect(store.day(MON)).toEqual([]);
  });
});

describe('update_recurring_task', () => {
  const edit = (store, dateStr, scope, set = {}, clear = []) =>
    store.write('update_recurring_task', { taskId: `recurring-series-1-${dateStr}`, scope, set, clear });

  it('is a write method', () => {
    expect(isWriteMethod('update_recurring_task')).toBe(true);
  });

  it('scope occurrence moves that date only; undo puts it back', () => {
    const store = makeStore();
    createSeries(store);
    const r = edit(store, WED, 'occurrence', { startTime: '10:00', durationMinutes: 30 });
    expect(r.ok).toBe(true);
    expect(r.data.occurrence).toMatchObject({ id: `recurring-series-1-${WED}`, start_time: '10:00', duration_minutes: 30 });
    expect(r.data.scope).toBe('occurrence');
    expect(r.undo.summary).toBe(`Edited repeating “Standup” (${WED}: start_time, duration)`);

    expect(store.day(WED)[0]).toMatchObject({ start_time: '10:00', duration_minutes: 30 });
    expect(store.day(MON)[0]).toMatchObject({ start_time: '09:00', duration_minutes: 15 });
    expect(store.day(NEXT_MON)[0]).toMatchObject({ start_time: '09:00' });

    store.write('undo_mcp_writes', { ops: [r.undo.op] });
    expect(store.state.recurringTasks[0].exceptions).toEqual({});
    expect(store.day(WED)[0]).toMatchObject({ start_time: '09:00', duration_minutes: 15 });
  });

  it('scope series changes every date and clears that field from occurrence edits', () => {
    const store = makeStore();
    createSeries(store);
    edit(store, WED, 'occurrence', { startTime: '10:00', title: 'Moved standup' });
    const r = edit(store, MON, 'series', { startTime: '08:30' });
    expect(r.ok).toBe(true);
    for (const date of [MON, WED, NEXT_MON]) expect(store.day(date)[0].start_time).toBe('08:30');
    // The title the occurrence set on its own is not the edited field: it stays.
    expect(store.day(WED)[0].title).toBe('Moved standup');

    store.write('undo_mcp_writes', { ops: [r.undo.op] });
    expect(store.day(MON)[0].start_time).toBe('09:00');
    expect(store.day(WED)[0]).toMatchObject({ start_time: '10:00', title: 'Moved standup' });
  });

  it('notes, project and the pattern are series-level, and the pattern change shows on get_day', () => {
    const store = makeStore({ projects: [{ id: 'p1', title: 'Work' }] });
    createSeries(store);
    const r = edit(store, MON, 'series', {
      notes: 'Agenda in the doc', projectId: 'p1',
      recurrence: { type: 'weekly', daysOfWeek: [2], endDate: '2026-12-31' },
    });
    expect(r.ok).toBe(true);
    expect(r.data.series).toMatchObject({ notes: 'Agenda in the doc', project_id: 'p1', repeat: { frequency: 'weekly', days_of_week: ['tue'], until: '2026-12-31' } });
    // The edited Monday is no longer an occurrence once the series moved to Tuesdays.
    expect(r.data.occurrence).toBeNull();
    expect(store.day(MON)).toEqual([]);
    expect(store.day('2026-10-13')[0]).toMatchObject({ notes: 'Agenda in the doc', project_id: 'p1' });

    store.write('undo_mcp_writes', { ops: [r.undo.op] });
    const [template] = store.state.recurringTasks;
    expect(template.recurrence).toEqual({ type: 'weekly', daysOfWeek: [1, 3], startDate: MON });
    expect(template).not.toHaveProperty('projectId');
    expect(template.notes).toBe('');
    expect(store.day(MON)).toHaveLength(1);
  });

  it('never touches completions, forward or on undo', () => {
    const store = makeStore();
    createSeries(store);
    store.write('set_completion', { taskId: `recurring-series-1-${MON}`, completed: true });
    const r = edit(store, MON, 'series', { title: 'Daily sync' });
    expect(store.state.recurringTasks[0].completedDates).toEqual([MON]);
    store.write('undo_mcp_writes', { ops: [r.undo.op] });
    expect(store.state.recurringTasks[0].completedDates).toEqual([MON]);
    expect(store.state.recurringTasks[0].title).toBe('Standup');
  });

  it('all-day and back: all_day true, then start_time makes the occurrence timed', () => {
    const store = makeStore();
    createSeries(store);
    edit(store, WED, 'occurrence', { allDay: true });
    expect(store.day(WED)[0]).toMatchObject({ all_day: true, start_time: null });
    const back = edit(store, WED, 'occurrence', { startTime: '11:00' });
    expect(back.ok).toBe(true);
    expect(store.day(WED)[0]).toMatchObject({ all_day: false, start_time: '11:00' });
    const noTime = edit(store, WED, 'occurrence', { allDay: true });
    expect(noTime.ok).toBe(true);
    const r = edit(store, WED, 'occurrence', { allDay: false });
    expect(r).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('an edit that changes nothing succeeds and journals nothing', () => {
    const store = makeStore();
    createSeries(store);
    const before = store.state.recurringTasks;
    const r = edit(store, MON, 'occurrence', { startTime: '09:00' });
    expect(r.ok).toBe(true);
    expect(r.data.unchanged).toBe(true);
    expect(r.undo).toBeUndefined();
    expect(store.state.recurringTasks).toBe(before);
  });

  it('rejects a date the series does not fall on, an unknown series, project or user', () => {
    const store = makeStore();
    createSeries(store);
    expect(edit(store, '2026-10-13', 'occurrence', { title: 'x' })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(store.write('update_recurring_task', { taskId: `recurring-nope-${MON}`, scope: 'series', set: { title: 'x' }, clear: [] }))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(edit(store, MON, 'series', { projectId: 'nope' })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(edit(store, MON, 'occurrence', { assigneeSyncId: 'nobody' })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('assignee per occurrence or for the series; clearing it means everyone', () => {
    const store = makeStore({ users: [{ id: 1, syncId: 'u-a' }, { id: 2, syncId: 'u-b' }] });
    createSeries(store);
    edit(store, WED, 'occurrence', { assigneeSyncId: 'u-b' });
    expect(store.day(WED)[0].assignee_id).toBe('u-b');
    expect(store.day(MON)[0].assignee_id).toBeUndefined();
    edit(store, MON, 'series', { assigneeSyncId: 'u-a' });
    expect(store.day(WED)[0].assignee_id).toBe('u-a');
    edit(store, MON, 'series', {}, ['assignee']);
    expect(store.day(MON)[0].assignee_id).toBeUndefined();
  });

  it('rejects an occurrence move onto a routine; the series elsewhere is not checked', () => {
    const state = {
      recurringTasks: [{
        id: 's', title: 'Walk', startTime: '07:00', duration: 30, isAllDay: false,
        recurrence: { type: 'daily', startDate: MON }, completedDates: [], exceptions: {},
      }],
      routines: [{ id: 'r1', name: 'Gym', startTime: '09:00', duration: 60, isAllDay: false }],
      routinesDate: WED, routineCompletions: {}, routinesEnabled: true, todayDate: WED,
    };
    const hit = applyUpdateRecurringTask(state, { taskId: `recurring-s-${WED}`, scope: 'occurrence', set: { startTime: '09:30' }, nowIso: NOW });
    expect(hit).toMatchObject({ ok: false, error: { code: 'routine_conflict' } });
    const titleOnly = applyUpdateRecurringTask(state, { taskId: `recurring-s-${WED}`, scope: 'series', set: { title: 'Run' }, nowIso: NOW });
    expect(titleOnly.ok).toBe(true);
  });
});

describe('applyUndoOps — series kinds', () => {
  it('skips a series the user has already deleted', () => {
    const r = applyUndoOps({ recurringTasks: [] }, [
      { kind: 'remove_created_series', templateId: 's' },
      { kind: 'restore_series_fields', templateId: 's', before: { title: 'x' } },
    ], { nowIso: NOW });
    expect(r).toMatchObject({ undone: 0, skipped: 2, tombstones: [] });
  });

  it('matches numeric template ids written by older devices', () => {
    const r = applyUndoOps({ recurringTasks: [{ id: 42, title: 'New', exceptions: { [MON]: { title: 'x' } } }] }, [
      { kind: 'restore_series_fields', templateId: '42', before: { title: 'Old' }, absentBefore: ['notes'], exceptionsBefore: { [MON]: null } },
    ], { nowIso: NOW });
    expect(r.undone).toBe(1);
    expect(r.recurringTasks[0]).toMatchObject({ id: 42, title: 'Old', exceptions: {}, lastModified: NOW });
  });
});
