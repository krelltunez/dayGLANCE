// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  blockType,
  toBlock,
  expandRecurringForDate,
  buildDayBlocks,
  buildUnscheduledItems,
  buildGoalProgress,
  weekDatesFor,
  buildWeek,
  buildUsers,
  inboxItem,
  projectItem,
  buildProjectTasks,
  handleMcpRequest,
} from '../src/readModel.js';

// The renderer half of the MCP read surface. The load-bearing assertions:
// _native events carry the distinct type + read_only flag in ALL output
// (spec §5.1 r4) and are absent unless include_native is set; recurring
// templates expand for the requested date; goal math matches the UI's own
// progress functions; the dispatcher returns typed errors, never throws.

const T = (over = {}) => ({
  id: 'id-1', title: 'Task', date: '2026-08-10', startTime: '09:00',
  duration: 60, completed: false, isAllDay: false, ...over,
});

describe('link: a task another GLANCE app created', () => {
  const chore = { source_app: 'app.lastglance', source_entity_id: 'chore-sync-1' };

  it('says which app and which item, on blocks and inbox items alike', () => {
    expect(toBlock(T(chore)).link).toEqual({ app: 'lastglance', id: 'chore-sync-1' });
    expect(inboxItem({ id: 'u1', title: 'Mop kitchen', ...chore }).link).toEqual({ app: 'lastglance', id: 'chore-sync-1' });
    // A chore's id says nothing of its kind: no kind, lastglance_resolve_link answers.
    expect(toBlock(T(chore)).link).not.toHaveProperty('kind');
  });

  it('says "date" where the id shows it: a lastGLANCE date is <date id>:<year>', () => {
    expect(toBlock(T({ source_app: 'app.lastglance', source_entity_id: 'date-1:2026' })).link).toEqual({ app: 'lastglance', id: 'date-1:2026', kind: 'date' });
    expect(inboxItem({ id: 'u2', title: 'Sam\'s birthday', source_app: 'app.lastglance', source_entity_id: '7c1e0b9a-55aa-4c1d-9f00-0b6a0f3d2e11:2027' }).link.kind).toBe('date');
    // Not a year, or another app's id of that shape: no kind.
    expect(toBlock(T({ source_app: 'app.lastglance', source_entity_id: 'x:26' })).link).not.toHaveProperty('kind');
    expect(toBlock(T({ source_app: 'app.lifeglance', source_entity_id: 'm-1:2026' })).link).toEqual({ app: 'lifeglance', id: 'm-1:2026' });
  });

  it('is absent unless both halves are there, exactly when completions are reported back', () => {
    expect(toBlock(T())).not.toHaveProperty('link');
    expect(toBlock(T({ source_app: 'app.lastglance' }))).not.toHaveProperty('link');
    expect(inboxItem({ id: 'u1', title: 'x', source_entity_id: 'e' })).not.toHaveProperty('link');
  });

  it('leaves the CalDAV source alone: link is its own field', () => {
    const b = toBlock(T({ isTaskCalendar: true, imported: true, ...chore }));
    expect(b.source).toBe('caldav_tasks');
    expect(b.link).toEqual({ app: 'lastglance', id: 'chore-sync-1' });
  });
});

describe('blockType / toBlock — the §5.1 distinct type flag', () => {
  it('flags _native as device_calendar_event with read_only, everywhere', () => {
    const b = toBlock(T({ _native: true, id: 'native-cal-abc' }));
    expect(b.type).toBe('device_calendar_event');
    expect(b.read_only).toBe(true);
  });

  it('dayGLANCE tasks are type task and carry NO read_only flag', () => {
    const b = toBlock(T());
    expect(b.type).toBe('task');
    expect(b).not.toHaveProperty('read_only');
  });

  it('imported alone does NOT mark a device event: a feed event is calendar_event, a CalDAV task-calendar task a task (2026-10-04)', () => {
    expect(blockType(T({ imported: true }))).toBe('calendar_event');
    expect(blockType(T({ imported: true, isTaskCalendar: true }))).toBe('task');
    expect(blockType(T({ imported: true, nativeEventId: 'n', _native: true }))).toBe('device_calendar_event');
  });

  it('all-day blocks have a null start_time (no fake midnight)', () => {
    const b = toBlock(T({ isAllDay: true, startTime: '00:00' }));
    expect(b.all_day).toBe(true);
    expect(b.start_time).toBeNull();
  });
});

describe('expandRecurringForDate', () => {
  const template = {
    id: 'r1', title: 'Standup', startTime: '10:00', duration: 15,
    recurrence: { type: 'daily', startDate: '2026-01-01' },
    completedDates: ['2026-08-10'],
  };

  it('produces the instance for the requested date with completion state', () => {
    const [inst] = expandRecurringForDate([template], '2026-08-10');
    expect(inst).toMatchObject({
      id: 'recurring-r1-2026-08-10', title: 'Standup', date: '2026-08-10',
      completed: true, isRecurring: true,
    });
    expect(expandRecurringForDate([template], '2026-08-11')[0].completed).toBe(false);
  });

  it('applies per-date exception overrides field by field', () => {
    const withException = {
      ...template,
      exceptions: { '2026-08-10': { title: 'Standup (moved)', startTime: '11:30' } },
    };
    const [inst] = expandRecurringForDate([withException], '2026-08-10');
    expect(inst.title).toBe('Standup (moved)');
    expect(inst.startTime).toBe('11:30');
    expect(inst.duration).toBe(15); // un-overridden fields fall back to the template
  });

  it('includes past uncompleted instances — reads report what was scheduled', () => {
    const past = expandRecurringForDate([{ ...template, completedDates: [] }], '2026-02-01');
    expect(past).toHaveLength(1);
    expect(past[0].completed).toBe(false);
  });

  it('returns nothing for a date before the recurrence starts or with no templates', () => {
    expect(expandRecurringForDate([template], '2025-12-31')).toEqual([]);
    expect(expandRecurringForDate([], '2026-08-10')).toEqual([]);
    expect(expandRecurringForDate(undefined, '2026-08-10')).toEqual([]);
  });

  it('inherits the project from the template, so reads report the association', () => {
    const inProject = { ...template, projectId: 'p1' };
    expect(expandRecurringForDate([inProject], '2026-08-10')[0].projectId).toBe('p1');
    expect(toBlock(expandRecurringForDate([inProject], '2026-08-10')[0]).project_id).toBe('p1');
    // No project: the wire block omits the key rather than sending null.
    expect(toBlock(expandRecurringForDate([template], '2026-08-10')[0])).not.toHaveProperty('project_id');
  });
});

describe('buildDayBlocks', () => {
  const state = {
    tasks: [
      T({ id: 'a', date: '2026-08-10', startTime: '14:00' }),
      T({ id: 'b', date: '2026-08-10', startTime: '08:00' }),
      T({ id: 'allday', date: '2026-08-10', isAllDay: true, startTime: null }),
      T({ id: 'other-day', date: '2026-08-11' }),
      T({ id: 'native-cal-e1', date: '2026-08-10', _native: true, imported: true, startTime: '10:00' }),
    ],
    recurringTasks: [{
      id: 'r1', title: 'Standup', startTime: '10:30', duration: 15,
      recurrence: { type: 'daily', startDate: '2026-01-01' },
    }],
  };

  it('returns only the requested date, all-day first then by wall-clock start', () => {
    const { blocks } = buildDayBlocks(state, { date: '2026-08-10', include_native: true });
    expect(blocks.map((b) => b.id)).toEqual(['allday', 'b', 'native-cal-e1', 'recurring-r1-2026-08-10', 'a']);
  });

  it('excludes _native events unless include_native — absent means absent, not unflagged', () => {
    const { blocks } = buildDayBlocks(state, { date: '2026-08-10' });
    expect(blocks.some((b) => b.type === 'device_calendar_event')).toBe(false);
    const withNative = buildDayBlocks(state, { date: '2026-08-10', include_native: true }).blocks;
    const native = withNative.find((b) => b.id === 'native-cal-e1');
    expect(native.type).toBe('device_calendar_event');
    expect(native.read_only).toBe(true);
  });

  it('applies the multi-user visibility predicate the window applies', () => {
    const scoped = { ...state, isVisibleForUser: (t) => t.id !== 'a' };
    const { blocks } = buildDayBlocks(scoped, { date: '2026-08-10', include_native: true });
    expect(blocks.some((b) => b.id === 'a')).toBe(false);
  });

  it('an empty day is an empty blocks array (available ≠ empty is the transport layer)', () => {
    expect(buildDayBlocks(state, { date: '2027-01-01' }).blocks.filter((b) => !b.type.includes('recurring'))).toEqual(
      expect.any(Array),
    );
    expect(buildDayBlocks({ tasks: [], recurringTasks: [] }, { date: '2026-08-10' }).blocks).toEqual([]);
  });
});

describe('buildUnscheduledItems', () => {
  it('maps the inbox with priority/deadline and applies visibility', () => {
    const state = {
      unscheduledTasks: [
        { id: 'u1', title: 'Buy milk', priority: 2, deadline: '2026-08-20', notes: 'oat' },
        { id: 'u2', title: 'Hidden' },
      ],
      isVisibleForUser: (t) => t.id !== 'u2',
    };
    const { items } = buildUnscheduledItems(state);
    expect(items).toEqual([{
      id: 'u1', type: 'task', title: 'Buy milk', priority: 2,
      completed: false, created_at: null, completed_at: null, deadline: '2026-08-20', notes: 'oat',
    }]);
  });

  it('scope and includeCompleted filter over structural fields; defaults change nothing', () => {
    const state = {
      unscheduledTasks: [
        { id: 's-open', title: 'Standalone open' },
        { id: 's-done', title: 'Standalone done', completed: true },
        { id: 'p-open', title: 'Project open', projectId: 'p1' },
        { id: 'p-done', title: 'Project done', projectId: 'p1', completed: true },
        { id: 'bucket', title: 'Someday', bucketId: 'b1' },
      ],
    };
    const ids = (filter) => buildUnscheduledItems(state, filter).items.map((i) => i.id);
    // Defaults (explicit or omitted) = everything non-bucketed.
    expect(ids(undefined)).toEqual(['s-open', 's-done', 'p-open', 'p-done']);
    expect(ids({ scope: 'all', includeCompleted: true })).toEqual(['s-open', 's-done', 'p-open', 'p-done']);
    // The TRMNL standalone-open shape.
    expect(ids({ scope: 'standalone', includeCompleted: false })).toEqual(['s-open']);
    expect(ids({ scope: 'standalone' })).toEqual(['s-open', 's-done']);
    expect(ids({ scope: 'project' })).toEqual(['p-open', 'p-done']);
    expect(ids({ includeCompleted: false })).toEqual(['s-open', 'p-open']);
    // Bucket items appear under NO argument combination.
    for (const f of [undefined, { scope: 'all' }, { scope: 'standalone' }, { scope: 'project' }, { includeCompleted: false }]) {
      expect(ids(f)).not.toContain('bucket');
    }
  });

  it('a filter matching nothing returns an empty list, not an error', () => {
    const state = { unscheduledTasks: [{ id: 'p1', title: 'Project only', projectId: 'p' }] };
    expect(buildUnscheduledItems(state, { scope: 'standalone' }).items).toEqual([]);
  });

  it('excludes Bucket List items unconditionally — the bucketList.js invariant', () => {
    const state = {
      unscheduledTasks: [
        { id: 'u1', title: 'Get bloodwork done' },
        { id: 'b1', title: 'Go to US Open in NYC', bucketId: 'b1' },
        { id: 'b2', title: 'Honeymoon encore trip', bucketId: 'b2' },
      ],
    };
    const { items } = buildUnscheduledItems(state);
    expect(items.map((i) => i.id)).toEqual(['u1']);
    // And bucketId never reaches the wire: the tool excludes bucket items
    // rather than labeling them.
    expect(JSON.stringify(items)).not.toContain('bucketId');
  });
});

describe('buildGoalProgress', () => {
  const state = {
    goals: [
      { id: 'g1', title: 'Ship v5', status: 'active' },
      { id: 'g2', title: 'Old goal', status: 'archived' },
    ],
    projects: [
      { id: 'p1', title: 'Backend', status: 'active', goalId: 'g1' },
      { id: 'p2', title: 'Standalone', status: 'active' },
    ],
    tasks: [
      T({ id: 't1', projectId: 'p1', duration: 60, completed: true }),
      T({ id: 't2', projectId: 'p1', duration: 60, completed: false }),
      T({ id: 'n1', projectId: 'p1', duration: 600, completed: false, _native: true }),
    ],
    unscheduledTasks: [{ id: 'u1', projectId: 'p2', title: 'x', completed: false }],
  };

  it('computes duration-weighted progress with the UI math, excluding _native from denominators', () => {
    const r = buildGoalProgress(state, {});
    expect(r.goals).toHaveLength(1); // default window active
    const g = r.goals[0];
    expect(g.progress_percent).toBe(50); // 60 done / 120 total — the 600-min native event must not dilute
    expect(g.projects[0]).toMatchObject({ id: 'p1', tasks_done: 1, tasks_total: 2 });
    expect(r.standalone_projects.map((p) => p.id)).toEqual(['p2']);
  });

  it("window 'active' keeps a project on hold, with its status, and leaves out a completed one", () => {
    const s = { ...state, projects: [...state.projects,
      { id: 'p3', title: 'Paused', status: 'on-hold' }, { id: 'p4', title: 'Done', status: 'completed' }] };
    const standalone = buildGoalProgress(s, {}).standalone_projects;
    expect(standalone.map((p) => p.id)).toEqual(['p2', 'p3']);
    expect(standalone.find((p) => p.id === 'p3').status).toBe('on-hold');
  });

  it("window: 'all' includes archived goals; unscoped default is active-only", () => {
    expect(buildGoalProgress(state, { window: 'all' }).goals.map((g) => g.id)).toEqual(['g1', 'g2']);
  });

  it('goal_id narrows to one goal and drops standalone projects', () => {
    const r = buildGoalProgress(state, { goal_id: 'g1' });
    expect(r.goals.map((g) => g.id)).toEqual(['g1']);
    expect(r.standalone_projects).toEqual([]);
  });

  it('unknown goal_id is notFound; bad window is invalid', () => {
    expect(buildGoalProgress(state, { goal_id: 'nope' }).notFound).toBe(true);
    expect(buildGoalProgress(state, { window: 'weekly' }).invalid).toContain('window');
  });

  // A project whose only work is a recurring series has no countable tasks.
  // Reporting 0 would tell a reader it has made no progress; null says the
  // question does not apply.
  it('reports progress_percent null, not 0, for a project with nothing to measure', () => {
    const withEmptyProject = {
      ...state,
      projects: [...state.projects, { id: 'p3', title: 'Upkeep', status: 'active', goalId: 'g1' }],
    };
    const r = buildGoalProgress(withEmptyProject, { goal_id: 'g1' });
    const p3 = r.goals[0].projects.find((p) => p.id === 'p3');
    expect(p3.progress_percent).toBeNull();
    // The measurable sibling is unaffected, and so is the goal rollup.
    expect(r.goals[0].projects.find((p) => p.id === 'p1').progress_percent).toBe(50);
    expect(r.goals[0].progress_percent).toBe(50);
  });
});

describe('weekDatesFor — the strict calendar week, honoring weekStartDay', () => {
  it('Sunday start (0, the app default): 2026-08-12 is a Wednesday', () => {
    expect(weekDatesFor('2026-08-12', 0)).toEqual([
      '2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15',
    ]);
  });

  it('Monday start (1) shifts the same date into a different week window', () => {
    expect(weekDatesFor('2026-08-12', 1)).toEqual([
      '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16',
    ]);
  });

  it('every weekStartDay value 0-6 starts the week on that weekday and contains the date', () => {
    for (let start = 0; start <= 6; start++) {
      const days = weekDatesFor('2026-08-12', start);
      expect(days).toHaveLength(7);
      const [y, m, d] = days[0].split('-').map(Number);
      expect(new Date(y, m - 1, d, 12).getDay(), `start=${start}`).toBe(start);
      expect(days, `start=${start}`).toContain('2026-08-12');
    }
  });

  it('a date ON the start day begins its own week (diff 0, not 7)', () => {
    // 2026-08-09 is a Sunday.
    expect(weekDatesFor('2026-08-09', 0)[0]).toBe('2026-08-09');
  });

  it('crosses month and year boundaries correctly', () => {
    // 2026-01-01 is a Thursday; the Sunday-start week runs 2025-12-28 .. 2026-01-03.
    expect(weekDatesFor('2026-01-01', 0)).toEqual([
      '2025-12-28', '2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03',
    ]);
    expect(weekDatesFor('2028-02-29', 1)).toContain('2028-02-29'); // leap day inside its week
  });

  it('spans a DST transition without skipping or repeating a date', () => {
    // US spring forward 2026-03-08 (Sunday). Week must be 7 distinct consecutive dates.
    const days = weekDatesFor('2026-03-10', 0);
    expect(days).toEqual([
      '2026-03-08', '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14',
    ]);
  });

  it('falls back to Sunday for invalid weekStartDay values', () => {
    for (const bad of [-1, 7, 1.5, '1', null, undefined]) {
      expect(weekDatesFor('2026-08-12', bad)[0], String(bad)).toBe('2026-08-09');
    }
  });
});

describe('buildWeek — the day model repeated across the week', () => {
  const state = {
    weekStartDay: 1,
    tasks: [
      T({ id: 'mon', date: '2026-08-10', startTime: '09:00' }),
      T({ id: 'sun-next', date: '2026-08-16', startTime: '10:00' }),
      T({ id: 'outside', date: '2026-08-17', startTime: '10:00' }),
      T({ id: 'native-cal-w1', date: '2026-08-12', _native: true, imported: true, startTime: '11:00' }),
    ],
    recurringTasks: [],
  };

  it('returns 7 days honoring weekStartDay, each shaped exactly like get_day', () => {
    const week = buildWeek(state, { date: '2026-08-12', include_native: true });
    expect(week.week_start_day).toBe(1);
    expect(week.days).toHaveLength(7);
    expect(week.days[0].date).toBe('2026-08-10');
    expect(week.days[0].blocks.map((b) => b.id)).toEqual(['mon']);
    expect(week.days[6].date).toBe('2026-08-16');
    expect(week.days[6].blocks.map((b) => b.id)).toEqual(['sun-next']);
    expect(week.days.flatMap((d) => d.blocks.map((b) => b.id))).not.toContain('outside');
    const native = week.days[2].blocks.find((b) => b.id === 'native-cal-w1');
    expect(native.type).toBe('device_calendar_event');
    expect(native.read_only).toBe(true);
  });

  it('excludes _native events when include_native is off — same gate as get_day', () => {
    const week = buildWeek(state, { date: '2026-08-12' });
    expect(week.days.flatMap((d) => d.blocks.map((b) => b.type))).not.toContain('device_calendar_event');
  });

  it('defaults week_start_day to 0 when the slice is absent', () => {
    const week = buildWeek({ tasks: [], recurringTasks: [] }, { date: '2026-08-12' });
    expect(week.week_start_day).toBe(0);
    expect(week.days[0].date).toBe('2026-08-09');
  });
});

describe('handleMcpRequest — the dispatcher', () => {
  const state = { tasks: [], recurringTasks: [], unscheduledTasks: [], goals: [], projects: [] };

  it('ping answers ok — running at all is the §3.3 health signal', () => {
    expect(handleMcpRequest(state, { method: 'ping' })).toEqual({ ok: true, data: { pong: true } });
  });

  it('routes the four read methods', () => {
    expect(handleMcpRequest(state, { method: 'get_day', params: { date: '2026-08-10' } }).ok).toBe(true);
    expect(handleMcpRequest(state, { method: 'get_week', params: { date: '2026-08-10' } }).ok).toBe(true);
    expect(handleMcpRequest(state, { method: 'list_unscheduled' }).ok).toBe(true);
    expect(handleMcpRequest(state, { method: 'goal_progress', params: {} }).ok).toBe(true);
  });

  it('maps model failures onto typed error codes (§5.2)', () => {
    const nf = handleMcpRequest(state, { method: 'goal_progress', params: { goal_id: 'nope' } });
    expect(nf).toMatchObject({ ok: false, error: { code: 'not_found' } });
    const bad = handleMcpRequest(state, { method: 'goal_progress', params: { window: 'x' } });
    expect(bad).toMatchObject({ ok: false, error: { code: 'validation' } });
    const unknown = handleMcpRequest(state, { method: 'explode' });
    expect(unknown).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('routes list_project_tasks, and an unknown project is not_found', () => {
    const withProject = { ...state, projects: [{ id: 'p1', title: 'Website', status: 'active' }] };
    expect(handleMcpRequest(withProject, { method: 'list_project_tasks', params: { project_id: 'p1' } }))
      .toEqual({ ok: true, data: { project: { id: 'p1', title: 'Website', status: 'active' }, items: [] } });
    const nf = handleMcpRequest(withProject, { method: 'list_project_tasks', params: { project_id: 'nope' } });
    expect(nf).toEqual({ ok: false, error: { code: 'not_found', message: 'No project with id "nope"' } });
    expect(handleMcpRequest(withProject, { method: 'list_project_tasks' })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('routes list_users', () => {
    expect(handleMcpRequest(state, { method: 'list_users' })).toEqual({ ok: true, data: { users: [] } });
  });
});

describe('buildUsers — the assignment roster (multi-user)', () => {
  it('active members only, id is the syncId assignment matches on, legacy rows fall back to id', () => {
    const users = [
      { id: 'id-ana', syncId: 'sync-ana', name: 'Ana', updatedAt: 'x' },
      { id: 'id-legacy', name: 'Legacy' },
      { id: 'id-gone', syncId: 'sync-gone', name: 'Gone', deleted: true },
    ];
    expect(buildUsers({ users })).toEqual({
      users: [
        { id: 'sync-ana', name: 'Ana' },
        { id: 'id-legacy', name: 'Legacy' },
      ],
    });
  });

  it('missing state → empty roster, never a throw', () => {
    expect(buildUsers({})).toEqual({ users: [] });
  });
});

describe('the 2026-10-04 read additions: subtasks and notes on blocks, goal and project fields, areas', () => {
  it('toBlock carries notes and subtasks for tasks, omits them when empty, and never for device events', () => {
    const b = toBlock(T({ notes: 'Bring ladder', subtasks: [{ id: 1, title: 'Nails', completed: true }] }));
    expect(b.notes).toBe('Bring ladder');
    expect(b.subtasks).toEqual([{ id: '1', title: 'Nails', completed: true }]);
    expect('subtasks' in toBlock(T({ subtasks: [] }))).toBe(false);
    expect('notes' in toBlock(T({ notes: '' }))).toBe(false);
    const native = toBlock(T({ _native: true, id: 'native-1', notes: 'x', subtasks: [{ id: 's', title: 't' }] }));
    expect('notes' in native).toBe(false);
    expect('subtasks' in native).toBe(false);
  });
  it('inbox items carry subtasks too', () => {
    const { items } = buildUnscheduledItems({ unscheduledTasks: [{ id: 'u1', title: 'x', subtasks: [{ id: 's1', title: 'a', completed: false }] }] });
    expect(items[0].subtasks).toEqual([{ id: 's1', title: 'a', completed: false }]);
  });
  it('goals report description, dates, area (id and name), assignees and the linked note; projects report description, goal, assignees, note', () => {
    const r = buildGoalProgress({
      goals: [{ id: 'g1', title: 'Home', status: 'active', description: 'Dry roof.', startDate: '2026-01-01', targetDate: '2026-12-31', areaId: 'a1', assignedUserSyncIds: ['u1'], obsidianNotePath: 'Goals/Home.md' }],
      projects: [{ id: 'p1', title: 'Roof', status: 'active', goalId: 'g1', description: '', assignedUserSyncIds: ['u1'], obsidianNotePath: 'Projects/Roof.md', obsidianNoteMissingAt: '2026-10-01T00:00:00Z' }],
      areas: [{ id: 'a1', name: 'House' }],
      tasks: [], unscheduledTasks: [],
    }, {});
    expect(r.goals[0]).toMatchObject({
      id: 'g1', description: 'Dry roof.', start_date: '2026-01-01', target_date: '2026-12-31', area_id: 'a1', area_name: 'House',
      assignee_ids: ['u1'], obsidian_note: { path: 'Goals/Home.md', name: 'Goals/Home', missing: false },
    });
    expect(r.goals[0].projects[0]).toMatchObject({
      id: 'p1', description: '', goal_id: 'g1', assignee_ids: ['u1'], obsidian_note: { path: 'Projects/Roof.md', name: 'Projects/Roof', missing: true },
    });
    // Unlinked, unassigned, area-less: the optional keys are absent, the always-present ones are null or ''.
    const plain = buildGoalProgress({ goals: [{ id: 'g2', title: 'X', status: 'active' }], projects: [], tasks: [], unscheduledTasks: [] }, {}).goals[0];
    expect(plain).toMatchObject({ description: '', start_date: null, target_date: null });
    for (const key of ['area_id', 'area_name', 'assignee_ids', 'obsidian_note']) expect(key in plain).toBe(false);
  });
  it('list_areas returns id and name in order', () => {
    const r = handleMcpRequest({ areas: [{ id: 'b', name: 'Second', order: 10 }, { id: 'a', name: 'First', order: 0 }] }, { method: 'list_areas' });
    expect(r).toEqual({ ok: true, data: { areas: [{ id: 'a', name: 'First' }, { id: 'b', name: 'Second' }] } });
  });
});

describe('the read gaps closed 2026-10-04: imported events, assignees, inbox duration, daily notes, the Bucket List', () => {
  it('an imported feed event is type calendar_event and read_only; a CalDAV task-calendar task stays a task with its source', () => {
    const ev = toBlock(T({ id: 'ics-1', imported: true, icalUid: 'u', importSource: 'f' }));
    expect(ev).toMatchObject({ type: 'calendar_event', read_only: true });
    const caldav = toBlock(T({ id: 'cal-t', imported: true, isTaskCalendar: true, icalUid: 'u' }));
    expect(caldav.type).toBe('task');
    expect(caldav.source).toBe('caldav_tasks');
    expect('read_only' in caldav).toBe(false);
    // Device events keep their own type even though they are imported.
    expect(toBlock(T({ _native: true, imported: true, nativeEventId: 'n' })).type).toBe('device_calendar_event');
  });
  it('blocks and inbox items say whose task it is; inbox items carry the duration', () => {
    expect(toBlock(T({ assignedUserSyncIds: ['u1', 'u2'] })).assignee_id).toBe('u1');
    expect('assignee_id' in toBlock(T({}))).toBe(false);
    const { items } = buildUnscheduledItems({ unscheduledTasks: [{ id: 'u1', title: 'x', duration: 45, assignedUserSyncIds: ['u2'] }, { id: 'u2', title: 'y' }] });
    expect(items[0]).toMatchObject({ duration_minutes: 45, assignee_id: 'u2' });
    expect('duration_minutes' in items[1]).toBe(false);
  });
  it('get_day carries the day\'s note as the app shows it, null for none, empty or deleted', () => {
    const state = { tasks: [], recurringTasks: [], dailyNotes: {
      '2026-08-10': { text: 'Dentist at noon.', lastModified: 'L' },
      '2026-08-11': { text: '   ' },
      '2026-08-12': { text: 'Gone', deleted: true },
    } };
    expect(buildDayBlocks(state, { date: '2026-08-10' }).daily_note).toEqual({ text: 'Dentist at noon.', last_modified: 'L' });
    expect(buildDayBlocks(state, { date: '2026-08-11' }).daily_note).toBeNull();
    expect(buildDayBlocks(state, { date: '2026-08-12' }).daily_note).toBeNull();
    expect(buildDayBlocks(state, { date: '2026-08-13' }).daily_note).toBeNull();
  });
  it('list_bucket_list: two lists with the user\'s headings, archived left out, priority and deadline never on the wire', () => {
    const r = handleMcpRequest({
      bucketConfig: { headings: { b1: 'Anytime', b2: 'Maybe later' } },
      unscheduledTasks: [
        { id: 'k1', title: 'Learn Welsh', bucketId: 'b1', priority: 2, deadline: '2026-01-01', duration: 30 },
        { id: 'k2', title: 'Old', bucketId: 'b1', archived: true },
        { id: 'k3', title: 'Sail', bucketId: 'b2', completed: true },
        { id: 'u1', title: 'Inbox task' },
      ],
    }, { method: 'list_bucket_list' });
    expect(r.ok).toBe(true);
    expect(r.data.lists.map((l) => [l.id, l.heading, l.items.map((i) => i.id)])).toEqual([['b1', 'Anytime', ['k1']], ['b2', 'Maybe later', ['k3']]]);
    expect(r.data.lists[0].items[0]).toEqual({ id: 'k1', type: 'task', title: 'Learn Welsh', completed: false, created_at: null, completed_at: null, duration_minutes: 30, bucket_id: 'b1' });
    // Default headings stand in when the config has none.
    expect(handleMcpRequest({ unscheduledTasks: [] }, { method: 'list_bucket_list' }).data.lists.map((l) => l.heading)).toEqual(['Anytime', 'Someday']);
  });
});

// #2135: when a task was created and completed, in the wire's local convention
// (no offsets, no timestamps), null when not known.
describe('created_at and completed_at on the wire', () => {
  // The suite runs in UTC (vitest.config.js), so a stamp's local reading here
  // is its UTC reading.
  it('carries both on an inbox item, local date and HH:MM', () => {
    const item = inboxItem({ id: 'u1', title: 'Done', completed: true, createdAt: '2026-10-19T09:14:00+00:00', completedAt: '2026-10-21T16:02:30Z' });
    expect(item.created_at).toEqual({ date: '2026-10-19', time: '09:14' });
    expect(item.completed_at).toEqual({ date: '2026-10-21', time: '16:02' });
  });

  it('reads a local-offset stamp on this machine\'s clock, and a bare date with no time', () => {
    const item = inboxItem({ id: 'u2', title: 'Old', completed: true, createdAt: '2026-10-19T23:30:00-05:00', completedAt: '2026-08-01' });
    expect(item.created_at).toEqual({ date: '2026-10-20', time: '04:30' });
    expect(item.completed_at).toEqual({ date: '2026-08-01', time: null });
  });

  it('is null when not known, and completed_at is null on an open task even with a stale stamp', () => {
    const item = inboxItem({ id: 'u3', title: 'Reopened', completed: false, completedAt: '2026-10-21T16:02:30Z' });
    expect(item.created_at).toBeNull();
    expect(item.completed_at).toBeNull();
  });

  it('rides scheduled blocks and recurring occurrences, never events', () => {
    const r = handleMcpRequest({
      tasks: [
        { id: 't1', title: 'Call', date: '2026-10-22', startTime: '09:00', duration: 30, createdAt: '2026-10-20T08:00:00Z' },
        { id: 'e1', title: 'Feed event', imported: true, date: '2026-10-22', startTime: '10:00', duration: 30, createdAt: '2026-10-20T08:00:00Z' },
      ],
      recurringTasks: [{
        id: 'r1', title: 'Gym', startTime: '07:00', duration: 60, recurrence: { type: 'daily', startDate: '2026-10-01' },
        createdAt: '2026-10-01T06:00:00Z', completedDates: ['2026-10-22'], completedDatesTimestamps: { '2026-10-22': '2026-10-22T08:05:00Z' },
      }],
    }, { method: 'get_day', params: { date: '2026-10-22' } });
    expect(r.ok).toBe(true);
    const byId = Object.fromEntries(r.data.blocks.map((b) => [b.id, b]));
    expect(byId.t1.created_at).toEqual({ date: '2026-10-20', time: '08:00' });
    expect(byId.t1.completed_at).toBeNull();
    const gym = r.data.blocks.find((b) => b.type === 'recurring_task');
    expect(gym.created_at).toEqual({ date: '2026-10-01', time: '06:00' });
    expect(gym.completed_at).toEqual({ date: '2026-10-22', time: '08:05' });
    expect(byId.e1).not.toHaveProperty('created_at');
  });
});

describe('projectItem — the project\'s own target date on the wire', () => {
  const project = { id: 'p1', title: 'Roof', status: 'active' };

  it('carries target_date (YYYY-MM-DD) when the project has one, and no key when it does not', () => {
    expect(projectItem({ ...project, targetDate: '2026-12-01' })).toMatchObject({ id: 'p1', target_date: '2026-12-01' });
    expect(projectItem(project)).not.toHaveProperty('target_date');
  });
});
// #2392: a project's scheduled tasks could only be found one day read at a
// time. #2393: nothing listed the tasks tasks_done and tasks_total count.
describe('buildProjectTasks: the tasks a project\'s counters count', () => {
  const ME = 'u-me';
  const visible = (t) => !t.assignedUserSyncIds?.length || t.assignedUserSyncIds.includes(ME);
  const state = {
    isVisibleForUser: visible,
    projects: [
      { id: 'p1', title: 'Degree', status: 'active' },
      { id: 'p2', title: 'Other', status: 'active' },
      { id: 'p-sam', title: 'Sam\'s', status: 'active', assignedUserSyncIds: ['u-sam'] },
      { id: 'p-done', title: 'Finished', status: 'completed' },
    ],
    tasks: [
      T({ id: 'late', date: '2027-03-02', startTime: '14:00', projectId: 'p1' }),
      T({ id: 'noon', date: '2026-09-01', startTime: '12:00', projectId: 'p1', completed: true, completedAt: '2026-09-01T13:00:00.000Z' }),
      T({ id: 'early', date: '2026-09-01', startTime: '08:30', projectId: 'p1', notes: 'bring ID', subtasks: [{ id: 's1', title: 'Print form', completed: true }] }),
      T({ id: 'allday', date: '2026-09-01', isAllDay: true, startTime: '10:00', projectId: 'p1' }),
      T({ id: 'elsewhere', date: '2026-09-01', projectId: 'p2' }),
      T({ id: 'loose', date: '2026-09-01' }),
      T({ id: 'gone', date: '2026-09-02', projectId: 'p1', archived: true }),
      T({ id: 'sams', date: '2026-09-02', projectId: 'p1', assignedUserSyncIds: ['u-sam'] }),
      T({ id: 'device', date: '2026-09-02', projectId: 'p1', _native: true }),
      T({ id: 'wrap', date: '2026-08-01', projectId: 'p-done', completed: true }),
    ],
    unscheduledTasks: [
      { id: 'someday', title: 'Maybe a minor', projectId: 'p1', bucketId: 'someday', priority: 2, deadline: '2027-01-01' },
      { id: 'thesis', title: 'Thesis outline', projectId: 'p1', priority: 3, deadline: '2026-11-15', duration: 90 },
      { id: 'forms', title: 'Hand in forms', projectId: 'p1', completed: true },
      { id: 'inbox-other', title: 'Unrelated' },
      { id: 'old', title: 'Dropped idea', projectId: 'p1', archived: true },
    ],
    recurringTasks: [
      { id: 'weekly', title: 'Study group', projectId: 'p1', startTime: '18:00', duration: 60, recurrence: { type: 'daily', startDate: '2026-09-01' } },
    ],
  };
  const list = (params) => buildProjectTasks(state, params);
  const ids = (r) => r.items.map((i) => i.id);

  it('lists scheduled tasks by date, all-day first, then by start; then the inbox; then the Bucket List', () => {
    const r = list({ project_id: 'p1' });
    expect(r.project).toEqual({ id: 'p1', title: 'Degree', status: 'active' });
    expect(r.items.map((i) => [i.id, i.placement])).toEqual([
      ['allday', 'scheduled'], ['early', 'scheduled'], ['noon', 'scheduled'], ['late', 'scheduled'],
      ['thesis', 'inbox'], ['forms', 'inbox'],
      ['someday', 'bucket_list'],
    ]);
  });

  it('is the set the goal tree counts: as long as tasks_total, with tasks_done of them completed', () => {
    const tree = buildGoalProgress(state, { window: 'all' });
    for (const p of tree.standalone_projects) {
      const r = list({ project_id: p.id });
      expect(r.items.length, p.id).toBe(p.tasks_total);
      expect(r.items.filter((i) => i.completed).length, p.id).toBe(p.tasks_done);
    }
    expect(tree.standalone_projects.find((p) => p.id === 'p1')).toMatchObject({ tasks_total: 7, tasks_done: 2 });
  });

  it('leaves out what the counters leave out: archived, another member\'s, device events, other projects, recurring series', () => {
    const got = ids(list({ project_id: 'p1' }));
    for (const id of ['gone', 'old', 'sams', 'device', 'elsewhere', 'loose', 'inbox-other', 'weekly']) expect(got, id).not.toContain(id);
    expect(got.some((id) => String(id).startsWith('recurring-'))).toBe(false);
  });

  it('a scheduled task is a day block, an inbox task an inbox item, a Bucket List item has bucket_id and no priority or deadline', () => {
    const byId = Object.fromEntries(list({ project_id: 'p1' }).items.map((i) => [i.id, i]));
    const { placement: _p, ...block } = byId.early;
    expect(block).toEqual(toBlock(state.tasks[2]));
    expect(byId.early).toMatchObject({ date: '2026-09-01', start_time: '08:30', notes: 'bring ID', subtasks: [{ id: 's1', title: 'Print form', completed: true }] });
    expect(byId.allday).toMatchObject({ all_day: true, start_time: null });
    const { placement: _q, ...item } = byId.thesis;
    expect(item).toEqual(inboxItem(state.unscheduledTasks[1]));
    expect(byId.thesis).toMatchObject({ priority: 3, deadline: '2026-11-15', duration_minutes: 90 });
    expect(byId.thesis).not.toHaveProperty('date');
    expect(byId.someday).toMatchObject({ bucket_id: 'someday', placement: 'bucket_list' });
    expect(byId.someday).not.toHaveProperty('priority');
    expect(byId.someday).not.toHaveProperty('deadline');
  });

  it('include_completed false leaves only the open tasks, in the same order', () => {
    expect(ids(list({ project_id: 'p1', include_completed: false }))).toEqual(['allday', 'early', 'late', 'thesis', 'someday']);
  });

  it('a completed project lists like any other', () => {
    expect(ids(list({ project_id: 'p-done' }))).toEqual(['wrap']);
  });

  it('a project with no tasks is an empty list, not an error', () => {
    expect(list({ project_id: 'p2', include_completed: false })).toMatchObject({ notFound: false });
    expect(ids(buildProjectTasks({ ...state, tasks: [] }, { project_id: 'p2' }))).toEqual([]);
  });

  it('an unknown id, a missing one, and a project the user cannot see are not found', () => {
    expect(list({ project_id: 'nope' })).toEqual({ notFound: true });
    expect(list({})).toEqual({ notFound: true });
    expect(list(undefined)).toEqual({ notFound: true });
    expect(list({ project_id: 'p-sam' })).toEqual({ notFound: true });
  });

  it('stamps are reported in the state\'s zone, as in the day and inbox reads', () => {
    const r = buildProjectTasks({ ...state, timeZone: 'America/Los_Angeles' }, { project_id: 'p1' });
    expect(r.items.find((i) => i.id === 'noon').completed_at).toEqual({ date: '2026-09-01', time: '06:00' });
  });
});
