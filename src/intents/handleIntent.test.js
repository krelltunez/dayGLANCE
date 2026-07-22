import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createKey, TABS, QUERY_RETURN_VARS, ENTITY_TYPES, SOURCE_APPS } from '@glance-apps/intents';
import { handleIntent } from './handleIntent.js';

// ─── create ────────────────────────────────────────────────────────────────

describe('handleIntent create', () => {
  it('succeeds with a minimal valid payload', async () => {
    const r = await handleIntent('create', { title: 'Buy milk' });
    expect(r.success).toBe(true);
    expect(r.error).toBe('');
    expect(r._normalized.title).toBe('Buy milk');
  });

  it('fails when title is missing', async () => {
    const r = await handleIntent('create', {});
    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('fails on unknown fields (strict schema)', async () => {
    const r = await handleIntent('create', { title: 'Test', bogus: true });
    expect(r.success).toBe(false);
  });

  it('normalizes priority from string to number', async () => {
    const r = await handleIntent('create', { title: 'Test', priority: 'HIGH' });
    expect(r.success).toBe(true);
    expect(r._normalized.priority).toBe(3);
  });

  it('normalizes priority from integer', async () => {
    const r = await handleIntent('create', { title: 'Test', priority: 2 });
    expect(r._normalized.priority).toBe(2);
  });

  it('parses inline #tags from title and merges with tags field', async () => {
    const r = await handleIntent('create', { title: 'Buy milk #groceries', tags: 'errands' });
    // _normalized.title is the clean title (tags stripped); tags are in _normalized.tags.
    expect(r._normalized.title).toBe('Buy milk');
    expect(r._normalized.tags).toContain('groceries');
    expect(r._normalized.tags).toContain('errands');
  });

  it('deduplicates tags across title and tags field', async () => {
    const r = await handleIntent('create', { title: 'Task #home', tags: 'home,work' });
    const count = r._normalized.tags.filter(t => t === 'home').length;
    expect(count).toBe(1);
    expect(r._normalized.tags).toContain('work');
  });

  it('normalizes a date-only due to all_day', async () => {
    const r = await handleIntent('create', { title: 'Test', due: '2026-05-21' });
    expect(r._normalized.due).toBe('2026-05-21');
    expect(r._normalized.all_day).toBe(true);
  });

  it('normalizes a datetime due to timed task', async () => {
    const r = await handleIntent('create', { title: 'Test', due: '2026-05-21T10:00:00Z' });
    expect(r._normalized.all_day).toBe(false);
  });

  it('explicit all_day overrides the inferred value', async () => {
    const r = await handleIntent('create', { title: 'Test', due: '2026-05-21', all_day: false });
    expect(r._normalized.all_day).toBe(false);
  });

  it('expands recurring shorthand to a FREQ= rule string', async () => {
    const r = await handleIntent('create', { title: 'Test', recurring: 'daily' });
    expect(r._normalized.recurring).toBe('FREQ=DAILY');
  });

  it('passes through raw FREQ= strings unchanged', async () => {
    const rrule = 'FREQ=WEEKLY;BYDAY=MO,WE,FR';
    const r = await handleIntent('create', { title: 'Test', recurring: rrule });
    expect(r._normalized.recurring).toBe(rrule);
  });

  it('fails on invalid recurring strings', async () => {
    const r = await handleIntent('create', { title: 'Test', recurring: 'RRULE:FREQ=DAILY' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('recurring');
  });

  it('omits intentKey when source_app is absent', async () => {
    const r = await handleIntent('create', { title: 'Test' });
    expect(r._intentKey).toBeNull();
  });

  it('computes intentKey when source_app and source_entity_id are present', async () => {
    const r = await handleIntent('create', {
      title: 'Test',
      source_app: 'app.lastglance',
      source_entity_id: 'chore_1',
      due: '2026-06-01',
    });
    expect(r._intentKey).toBeTruthy();
    expect(typeof r._intentKey).toBe('string');
  });

  it('produces a stable intentKey for the same inputs', async () => {
    const payload = { title: 'T', source_app: 'app.lastglance', source_entity_id: 'c1', due: '2026-06-01' };
    const r1 = await handleIntent('create', payload);
    const r2 = await handleIntent('create', payload);
    expect(r1._intentKey).toBe(r2._intentKey);
  });

  it('warns when a matching non-completed task already exists', async () => {
    const key = await createKey('app.lastglance', 'chore_42', '2026-06-01');
    const existing = { id: 'tsk_1', _intentKey: key, completed: false };

    const r = await handleIntent('create', {
      title: 'Existing chore',
      source_app: 'app.lastglance',
      source_entity_id: 'chore_42',
      due: '2026-06-01',
    }, { tasks: [existing] });

    expect(r.success).toBe(true);
    expect(r.warning).toContain('tsk_1');
  });

  it('does not warn when the matching task is already completed', async () => {
    const key = await createKey('app.lastglance', 'chore_42', '2026-06-01');
    const existing = { id: 'tsk_1', _intentKey: key, completed: true };

    const r = await handleIntent('create', {
      title: 'Existing chore',
      source_app: 'app.lastglance',
      source_entity_id: 'chore_42',
      due: '2026-06-01',
    }, { tasks: [existing] });

    expect(r.warning).toBe('');
  });
});

// ─── complete ──────────────────────────────────────────────────────────────

describe('handleIntent complete', () => {
  it('succeeds with a valid title', async () => {
    const r = await handleIntent('complete', { title: 'Feed cat' });
    expect(r.success).toBe(true);
    expect(r._normalized.title).toBe('Feed cat');
  });

  it('fails when title is missing', async () => {
    const r = await handleIntent('complete', {});
    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('accepts an optional completed_at timestamp', async () => {
    const r = await handleIntent('complete', {
      title: 'Feed cat',
      completed_at: '2026-05-21T09:00:00Z',
    });
    expect(r.success).toBe(true);
    expect(r._normalized.completed_at).toBe('2026-05-21T09:00:00Z');
  });

  it('fails on unknown fields', async () => {
    const r = await handleIntent('complete', { title: 'Feed cat', bogus: true });
    expect(r.success).toBe(false);
  });
});

// ─── complete execution ────────────────────────────────────────────────────

function task(overrides) {
  return { id: crypto.randomUUID(), title: 'Task', completed: false, duration: 30, color: 'bg-blue-500', ...overrides };
}

describe('handleIntent complete execution', () => {
  it('fails when no task matches', async () => {
    const ctx = makeCapture({ tasks: [task({ title: 'Feed cat' })] });
    const r = await handleIntent('complete', { title: 'Walk dog' }, ctx);
    expect(r.success).toBe(false);
    expect(r.error).toBe('no matching task');
  });

  it('completes an exact-match scheduled task', async () => {
    const t = task({ title: 'Feed cat', date: '2026-06-01' });
    const ctx = makeCapture({ tasks: [t] });
    const r = await handleIntent('complete', { title: 'Feed cat' }, ctx);
    expect(r.success).toBe(true);
    expect(r.task_id).toBe(t.id);
    expect(ctx._tasks[0].completed).toBe(true);
    expect(ctx._tasks[0].completedAt).toBeTruthy();
  });

  it('completes an exact-match inbox task', async () => {
    const t = task({ title: 'Buy milk', priority: 1 });
    const ctx = makeCapture({ unscheduledTasks: [t] });
    const r = await handleIntent('complete', { title: 'Buy milk' }, ctx);
    expect(r.success).toBe(true);
    expect(ctx._inbox[0].completed).toBe(true);
  });

  it('uses the provided completed_at timestamp', async () => {
    const t = task({ title: 'Feed cat', date: '2026-06-01' });
    const ctx = makeCapture({ tasks: [t] });
    await handleIntent('complete', { title: 'Feed cat', completed_at: '2026-06-01T08:00:00Z' }, ctx);
    expect(ctx._tasks[0].completedAt).toBe('2026-06-01T08:00:00Z');
  });

  it('falls back to a partial match when no exact match exists', async () => {
    const t = task({ title: 'Feed cat #home', date: '2026-06-01' });
    const ctx = makeCapture({ tasks: [t] });
    const r = await handleIntent('complete', { title: 'Feed cat' }, ctx);
    expect(r.success).toBe(true);
    expect(ctx._tasks[0].completed).toBe(true);
  });

  it('prefers exact match over partial when both exist', async () => {
    const exact = task({ id: 'exact', title: 'Feed cat', date: '2026-06-02' });
    const partial = task({ id: 'partial', title: 'Feed cat and dog', date: '2026-06-01' });
    const ctx = makeCapture({ tasks: [partial, exact] });
    const r = await handleIntent('complete', { title: 'Feed cat' }, ctx);
    expect(r.task_id).toBe('exact');
    expect(r.warning).toBe('');
  });

  it('completes soonest-due task and sets warning on multiple matches', async () => {
    const later = task({ id: 'later', title: 'Feed cat', date: '2026-06-10' });
    const sooner = task({ id: 'sooner', title: 'Feed cat', date: '2026-06-01' });
    const ctx = makeCapture({ tasks: [later, sooner] });
    const r = await handleIntent('complete', { title: 'Feed cat' }, ctx);
    expect(r.task_id).toBe('sooner');
    expect(r.warning).toContain('2 tasks matched');
    expect(ctx._tasks.find(t => t.id === 'sooner').completed).toBe(true);
    expect(ctx._tasks.find(t => t.id === 'later').completed).toBe(false);
  });

  it('tasks without a date sort after dated tasks in tiebreak', async () => {
    const nodueInbox = task({ id: 'nodueInbox', title: 'Feed cat', priority: 0 });
    const dated = task({ id: 'dated', title: 'Feed cat', date: '2026-06-10' });
    const ctx = makeCapture({ tasks: [dated], unscheduledTasks: [nodueInbox] });
    const r = await handleIntent('complete', { title: 'Feed cat' }, ctx);
    expect(r.task_id).toBe('dated');
  });

  it('skips already-completed tasks in search', async () => {
    const done = task({ title: 'Feed cat', date: '2026-06-01', completed: true });
    const todo = task({ id: 'todo', title: 'Feed cat', date: '2026-06-02' });
    const ctx = makeCapture({ tasks: [done, todo] });
    const r = await handleIntent('complete', { title: 'Feed cat' }, ctx);
    expect(r.task_id).toBe('todo');
    expect(r.warning).toBe('');
  });

  it('is case-insensitive', async () => {
    const t = task({ title: 'Feed Cat', date: '2026-06-01' });
    const ctx = makeCapture({ tasks: [t] });
    const r = await handleIntent('complete', { title: 'feed cat' }, ctx);
    expect(r.success).toBe(true);
  });
});

// ─── open ──────────────────────────────────────────────────────────────────

describe('handleIntent open', () => {
  it('succeeds with a recognised tab name', async () => {
    const r = await handleIntent('open', { tab: 'inbox' });
    expect(r.success).toBe(true);
    expect(r._normalized.tab).toBe(TABS.INBOX);
  });

  it('falls back to glance for an unrecognised tab', async () => {
    const r = await handleIntent('open', { tab: 'does-not-exist' });
    expect(r.success).toBe(true);
    expect(r._normalized.tab).toBe(TABS.GLANCE);
  });

  it('falls back to glance when tab is omitted', async () => {
    const r = await handleIntent('open', {});
    expect(r.success).toBe(true);
    expect(r._normalized.tab).toBe(TABS.GLANCE);
  });

  it('accepts every valid tab value', async () => {
    for (const tab of Object.values(TABS)) {
      const r = await handleIntent('open', { tab });
      expect(r._normalized.tab).toBe(tab);
    }
  });
});

// ─── open execution ────────────────────────────────────────────────────────

describe('handleIntent open execution', () => {
  it('calls navigate with the resolved tab', async () => {
    const calls = [];
    const ctx = { navigate: tab => calls.push(tab) };
    await handleIntent('open', { tab: 'inbox' }, ctx);
    expect(calls).toEqual(['inbox']);
  });

  it('calls navigate with glance when tab is unrecognised', async () => {
    const calls = [];
    const ctx = { navigate: tab => calls.push(tab) };
    await handleIntent('open', { tab: 'nowhere' }, ctx);
    expect(calls).toEqual(['glance']);
  });

  it('calls navigate with glance when tab is omitted', async () => {
    const calls = [];
    const ctx = { navigate: tab => calls.push(tab) };
    await handleIntent('open', {}, ctx);
    expect(calls).toEqual(['glance']);
  });

  it('does not throw when navigate is absent (skeleton mode)', async () => {
    const r = await handleIntent('open', { tab: 'timeline' }, {});
    expect(r.success).toBe(true);
    expect(r._normalized.tab).toBe('timeline');
  });
});

// ─── query ─────────────────────────────────────────────────────────────────

describe('handleIntent query', () => {
  it('succeeds with an empty payload', async () => {
    const r = await handleIntent('query', {});
    expect(r.success).toBe(true);
  });

  it('returns all 10 query return variables', async () => {
    const r = await handleIntent('query', {});
    for (const key of Object.values(QUERY_RETURN_VARS)) {
      expect(key in r).toBe(true);
    }
  });

  it('returns zero-values for integer vars and empty string for string vars', async () => {
    const r = await handleIntent('query', {});
    expect(r['%dg_count_today']).toBe(0);
    expect(r['%dg_in_progress_title']).toBe('');
    expect(r['%dg_next_title']).toBe('');
  });

  it('fails on unknown fields', async () => {
    const r = await handleIntent('query', { scope: 'all' });
    expect(r.success).toBe(false);
  });
});

// ─── query execution ───────────────────────────────────────────────────────

// Fixed "now": May 21, 2026, 10:00 AM local time.
const NOW = new Date(2026, 4, 21, 10, 0, 0); // month is 0-indexed
const TODAY = '2026-05-21';

function scheduledTask(overrides) {
  return {
    id: crypto.randomUUID(),
    title: 'Task',
    completed: false,
    duration: 60,
    isAllDay: true,
    date: TODAY,
    ...overrides,
  };
}

describe('handleIntent query execution', () => {
  it('counts tasks scheduled for today', async () => {
    const ctx = {
      tasks: [scheduledTask({ date: TODAY }), scheduledTask({ date: TODAY })],
      unscheduledTasks: [],
      now: NOW,
    };
    const r = await handleIntent('query', {}, ctx);
    expect(r.success).toBe(true);
    expect(r['%dg_count_today']).toBe(2);
  });

  it('counts overdue tasks (date before today)', async () => {
    const ctx = {
      tasks: [scheduledTask({ date: '2026-05-20' }), scheduledTask({ date: TODAY })],
      unscheduledTasks: [],
      now: NOW,
    };
    const r = await handleIntent('query', {}, ctx);
    expect(r['%dg_count_overdue']).toBe(1);
  });

  it('counts tasks within the next 7 days (today + 6)', async () => {
    const ctx = {
      tasks: [
        scheduledTask({ date: TODAY }),          // today — in
        scheduledTask({ date: '2026-05-27' }),   // today+6 — in
        scheduledTask({ date: '2026-05-28' }),   // today+7 — out
        scheduledTask({ date: '2026-05-20' }),   // overdue — out
      ],
      unscheduledTasks: [],
      now: NOW,
    };
    const r = await handleIntent('query', {}, ctx);
    expect(r['%dg_count_week']).toBe(2);
  });

  it('counts total incomplete tasks across scheduled and inbox', async () => {
    const ctx = {
      tasks: [scheduledTask(), scheduledTask()],
      unscheduledTasks: [{ id: 'u1', title: 'Inbox', completed: false }],
      now: NOW,
    };
    const r = await handleIntent('query', {}, ctx);
    expect(r['%dg_count_total']).toBe(3);
  });

  it('counts inbox (unscheduled) tasks', async () => {
    const ctx = {
      tasks: [],
      unscheduledTasks: [
        { id: 'u1', title: 'A', completed: false },
        { id: 'u2', title: 'B', completed: false },
      ],
      now: NOW,
    };
    const r = await handleIntent('query', {}, ctx);
    expect(r['%dg_count_inbox']).toBe(2);
  });

  it('excludes completed tasks from all counts', async () => {
    const ctx = {
      tasks: [
        scheduledTask({ date: TODAY, completed: true }),
        scheduledTask({ date: '2026-05-20', completed: true }),
      ],
      unscheduledTasks: [{ id: 'u1', title: 'Done', completed: true }],
      now: NOW,
    };
    const r = await handleIntent('query', {}, ctx);
    expect(r['%dg_count_today']).toBe(0);
    expect(r['%dg_count_overdue']).toBe(0);
    expect(r['%dg_count_total']).toBe(0);
    expect(r['%dg_count_inbox']).toBe(0);
  });

  it('excludes _native OS calendar tasks from all counts', async () => {
    const ctx = {
      tasks: [scheduledTask({ date: TODAY, _native: true })],
      unscheduledTasks: [{ id: 'u1', title: 'Native inbox', completed: false, _native: true }],
      now: NOW,
    };
    const r = await handleIntent('query', {}, ctx);
    expect(r['%dg_count_today']).toBe(0);
    expect(r['%dg_count_total']).toBe(0);
    expect(r['%dg_count_inbox']).toBe(0);
  });

  it('detects an in-progress timed task', async () => {
    // NOW is 10:00; task runs 09:30–10:30 (60 min)
    const ctx = {
      tasks: [scheduledTask({ date: TODAY, isAllDay: false, startTime: '09:30', duration: 60, title: 'Team sync' })],
      unscheduledTasks: [],
      now: NOW,
    };
    const r = await handleIntent('query', {}, ctx);
    expect(r['%dg_in_progress_title']).toBe('Team sync');
    expect(r['%dg_in_progress_end']).toBe('10:30');
    expect(r['%dg_in_progress_remaining_min']).toBe(30);
  });

  it('reports no in-progress task when now is before it starts', async () => {
    // NOW is 10:00; task starts 11:00
    const ctx = {
      tasks: [scheduledTask({ date: TODAY, isAllDay: false, startTime: '11:00', duration: 60 })],
      unscheduledTasks: [],
      now: NOW,
    };
    const r = await handleIntent('query', {}, ctx);
    expect(r['%dg_in_progress_title']).toBe('');
    expect(r['%dg_in_progress_remaining_min']).toBe(0);
  });

  it('reports no in-progress task when now is at or after it ends', async () => {
    // NOW is 10:00; task ran 08:00–09:00 (60 min)
    const ctx = {
      tasks: [scheduledTask({ date: TODAY, isAllDay: false, startTime: '08:00', duration: 60 })],
      unscheduledTasks: [],
      now: NOW,
    };
    const r = await handleIntent('query', {}, ctx);
    expect(r['%dg_in_progress_title']).toBe('');
  });

  it('ignores all-day tasks when computing in-progress', async () => {
    const ctx = {
      tasks: [scheduledTask({ date: TODAY, isAllDay: true })],
      unscheduledTasks: [],
      now: NOW,
    };
    const r = await handleIntent('query', {}, ctx);
    expect(r['%dg_in_progress_title']).toBe('');
  });

  it('reports the next upcoming timed task today', async () => {
    // NOW is 10:00; two future tasks at 11:00 and 14:00 — next is 11:00
    const ctx = {
      tasks: [
        scheduledTask({ date: TODAY, isAllDay: false, startTime: '14:00', title: 'Later' }),
        scheduledTask({ date: TODAY, isAllDay: false, startTime: '11:00', title: 'Standup' }),
      ],
      unscheduledTasks: [],
      now: NOW,
    };
    const r = await handleIntent('query', {}, ctx);
    expect(r['%dg_next_title']).toBe('Standup');
    expect(r['%dg_next_time']).toBe('11:00');
  });

  it('returns empty next fields when no timed tasks remain today', async () => {
    // Only past timed task (09:00 ended before 10:00)
    const ctx = {
      tasks: [scheduledTask({ date: TODAY, isAllDay: false, startTime: '08:00', duration: 30 })],
      unscheduledTasks: [],
      now: NOW,
    };
    const r = await handleIntent('query', {}, ctx);
    expect(r['%dg_next_title']).toBe('');
    expect(r['%dg_next_time']).toBe('');
  });

  it('does not show in-progress task as next-up', async () => {
    // NOW is 10:00; task 09:30–10:30 is in progress — nothing is "next"
    const ctx = {
      tasks: [scheduledTask({ date: TODAY, isAllDay: false, startTime: '09:30', duration: 60, title: 'Sync' })],
      unscheduledTasks: [],
      now: NOW,
    };
    const r = await handleIntent('query', {}, ctx);
    expect(r['%dg_in_progress_title']).toBe('Sync');
    expect(r['%dg_next_title']).toBe('');
  });

  it('returns zero-values when no context is provided (skeleton mode)', async () => {
    const r = await handleIntent('query', {});
    expect(r['%dg_count_today']).toBe(0);
    expect(r['%dg_count_total']).toBe(0);
    expect(r['%dg_in_progress_title']).toBe('');
    expect(r['%dg_next_title']).toBe('');
  });
});

// ─── unknown action ────────────────────────────────────────────────────────

describe('handleIntent unknown action', () => {
  it('returns failure for an unrecognised action', async () => {
    const r = await handleIntent('destroy_everything', {});
    expect(r.success).toBe(false);
    expect(r.error).toContain('Unknown action');
  });
});

// ─── create execution ──────────────────────────────────────────────────────

// Capture context: handler reads tasks/projects from it and writes via setters.
// Tests read _tasks/_inbox/_recurring to inspect results after the handler runs.
function makeCapture(initial = {}) {
  const state = {
    tasks: [...(initial.tasks ?? [])],
    unscheduledTasks: [...(initial.unscheduledTasks ?? [])],
    recurringTasks: [...(initial.recurringTasks ?? [])],
    projects: initial.projects ?? [],
  };

  const ctx = {
    get tasks() { return state.tasks; },
    get unscheduledTasks() { return state.unscheduledTasks; },
    get recurringTasks() { return state.recurringTasks; },
    get projects() { return state.projects; },
    setTasks: fn => { state.tasks = fn(state.tasks); },
    setUnscheduledTasks: fn => { state.unscheduledTasks = fn(state.unscheduledTasks); },
    setRecurringTasks: fn => { state.recurringTasks = fn(state.recurringTasks); },
    // Aliases for clarity in test assertions.
    get _tasks() { return state.tasks; },
    get _inbox() { return state.unscheduledTasks; },
    get _recurring() { return state.recurringTasks; },
    ...(initial.deletedTaskIds ? { deletedTaskIds: initial.deletedTaskIds } : {}),
  };
  return ctx;
}

describe('handleIntent create execution', () => {
  it('returns task_id on success', async () => {
    const ctx = makeCapture();
    const r = await handleIntent('create', { title: 'Buy milk' }, ctx);
    expect(r.success).toBe(true);
    expect(r.task_id).toBeTruthy();
  });

  it('creates an inbox task when due is absent', async () => {
    const ctx = makeCapture();
    await handleIntent('create', { title: 'Buy milk', priority: 2 }, ctx);
    expect(ctx._inbox).toHaveLength(1);
    expect(ctx._tasks).toHaveLength(0);
    expect(ctx._inbox[0].priority).toBe(2);
  });

  it('creates a scheduled task when due is a date', async () => {
    const ctx = makeCapture();
    await handleIntent('create', { title: 'Dentist', due: '2026-06-10' }, ctx);
    expect(ctx._tasks).toHaveLength(1);
    expect(ctx._tasks[0].date).toBe('2026-06-10');
    expect(ctx._tasks[0].isAllDay).toBe(true);
  });

  it('creates a timed scheduled task when due includes a time', async () => {
    const ctx = makeCapture();
    await handleIntent('create', { title: 'Standup', due: '2026-06-10T09:00:00Z' }, ctx);
    expect(ctx._tasks).toHaveLength(1);
    expect(ctx._tasks[0].isAllDay).toBe(false);
    expect(ctx._tasks[0].startTime).toMatch(/^\d{2}:\d{2}$/);
  });

  it('creates a recurring template when recurring is provided', async () => {
    const ctx = makeCapture();
    await handleIntent('create', { title: 'Morning run', recurring: 'daily', due: '2026-06-01' }, ctx);
    expect(ctx._recurring).toHaveLength(1);
    expect(ctx._recurring[0].recurrence.type).toBe('daily');
    expect(ctx._tasks).toHaveLength(0);
  });

  it('stores title with tags embedded', async () => {
    const ctx = makeCapture();
    await handleIntent('create', { title: 'Buy milk #grocery', tags: 'errands' }, ctx);
    const t = ctx._inbox[0];
    expect(t.title).toContain('#grocery');
    expect(t.title).toContain('#errands');
  });

  it('stores source_app, source_entity_id, and _intentKey on the task', async () => {
    const ctx = makeCapture();
    await handleIntent('create', {
      title: 'Chore',
      source_app: 'app.lastglance',
      source_entity_id: 'chore_1',
    }, ctx);
    const t = ctx._inbox[0];
    expect(t.source_app).toBe('app.lastglance');
    expect(t.source_entity_id).toBe('chore_1');
    expect(t._intentKey).toBeTruthy();
  });

  it('resolves project by name', async () => {
    const ctx = makeCapture({ projects: [{ id: 'proj-1', name: 'Home' }] });
    await handleIntent('create', { title: 'Fix sink', project: 'Home' }, ctx);
    expect(ctx._inbox[0].projectId).toBe('proj-1');
  });

  it('resolves project by id', async () => {
    const ctx = makeCapture({ projects: [{ id: 'proj-1', name: 'Home' }] });
    await handleIntent('create', { title: 'Fix sink', project: 'proj-1' }, ctx);
    expect(ctx._inbox[0].projectId).toBe('proj-1');
  });

  it('omits projectId when project does not match', async () => {
    const ctx = makeCapture({ projects: [{ id: 'proj-1', name: 'Home' }] });
    await handleIntent('create', { title: 'Fix sink', project: 'Unknown Project' }, ctx);
    expect(ctx._inbox[0].projectId).toBeUndefined();
  });

  it('sets the deadline on inbox tasks', async () => {
    const ctx = makeCapture();
    await handleIntent('create', { title: 'Tax return', deadline: '2026-04-15' }, ctx);
    expect(ctx._inbox[0].deadline).toBe('2026-04-15');
  });

  it('updates existing task instead of duplicating (idempotency)', async () => {
    const key = await createKey('app.lastglance', 'chore_42', '2026-06-01');
    const existing = { id: 'tsk_1', title: 'Old title', notes: '', priority: 0, _intentKey: key, completed: false };
    const ctx = makeCapture({ tasks: [existing] });

    const r = await handleIntent('create', {
      title: 'New title',
      source_app: 'app.lastglance',
      source_entity_id: 'chore_42',
      due: '2026-06-01',
    }, ctx);

    expect(r.success).toBe(true);
    expect(r.task_id).toBe('tsk_1');
    expect(r.warning).toContain('Updated');
    expect(ctx._tasks).toHaveLength(1);
    expect(ctx._tasks[0].title).toBe('New title');
  });

  it('uses default color and 30-min duration when not specified', async () => {
    const ctx = makeCapture();
    await handleIntent('create', { title: 'Quick task' }, ctx);
    expect(ctx._inbox[0].color).toBe('bg-blue-500');
    expect(ctx._inbox[0].duration).toBe(30);
  });

  // ── Re-delivery guards: a transport re-presenting an old create event must
  //    never resurrect a task whose completion synced through another channel ──

  it('no-ops a re-delivered create whose task is already completed', async () => {
    const key = await createKey('app.lastglance', 'chore_42', '2026-06-01');
    const existing = { id: 'tsk_1', title: 'Chore', _intentKey: key, completed: true };
    const ctx = makeCapture({ tasks: [existing] });

    const r = await handleIntent('create', {
      title: 'Chore',
      source_app: 'app.lastglance',
      source_entity_id: 'chore_42',
      due: '2026-06-01',
    }, ctx);

    expect(r.success).toBe(true);
    expect(r.task_id).toBe('tsk_1');
    expect(r.warning).toContain('already completed');
    expect(ctx._tasks).toHaveLength(1);
    expect(ctx._tasks[0].completed).toBe(true);
    expect(ctx._inbox).toHaveLength(0);
  });

  it('no-ops a re-delivered create when the completed copy lives in the other list', async () => {
    const key = await createKey('app.lastglance', 'chore_43', null);
    const existing = { id: 'tsk_2', title: 'Chore', _intentKey: key, completed: true };
    // Original was created unscheduled (no due) but was later scheduled — the
    // completed copy now lives in tasks while the redelivered create targets inbox.
    const ctx = makeCapture({ tasks: [existing] });

    const r = await handleIntent('create', {
      title: 'Chore',
      source_app: 'app.lastglance',
      source_entity_id: 'chore_43',
    }, ctx);

    expect(r.success).toBe(true);
    expect(r.warning).toContain('already completed');
    expect(ctx._inbox).toHaveLength(0);
  });

  it('no-ops a re-delivered create whose deterministic id is tombstoned', async () => {
    const key = await createKey('app.lastglance', 'chore_44', '2026-06-01');
    const { deterministicTaskId } = await import('./handleIntent.js');
    const doomedId = await deterministicTaskId(key);
    const ctx = makeCapture({ deletedTaskIds: { [doomedId]: '2026-07-01T00:00:00Z' } });

    const r = await handleIntent('create', {
      title: 'Chore',
      source_app: 'app.lastglance',
      source_entity_id: 'chore_44',
      due: '2026-06-01',
    }, ctx);

    expect(r.success).toBe(true);
    expect(r.warning).toContain('ignored re-delivered create');
    expect(ctx._tasks).toHaveLength(0);
    expect(ctx._inbox).toHaveLength(0);
  });
});

// ─── inbound goal create supersedes a stale tombstone (create/delete-loop fix) ──

describe('handleIntent create goal — clears stale tombstone', () => {
  const DELETED_GOAL_IDS_KEY = 'day-planner-deleted-goal-ids';

  function memLocalStorage() {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
      clear: () => m.clear(),
    };
  }

  const readTombstones = () =>
    JSON.parse(localStorage.getItem(DELETED_GOAL_IDS_KEY) || '{}');

  const goalPayload = {
    title: 'Rule of 55',
    entity_type: ENTITY_TYPES.GOAL,
    source_app: SOURCE_APPS.LIFEGLANCE,
    source_entity_id: 'milestone_55',
  };

  beforeEach(() => {
    global.localStorage = memLocalStorage();
  });
  afterAll(() => { delete global.localStorage; });

  it('create path: clears the goal tombstone so the next merge keeps the goal', async () => {
    // First create to learn the deterministic id the create path derives.
    let capturedId = null;
    const addGoal = (fields) => { capturedId = fields.id; return { id: fields.id }; };
    await handleIntent('create', goalPayload, { goals: [], addGoal });
    expect(capturedId).toBeTruthy();

    // Simulate: the goal was later deleted (tombstone recorded) and dropped from
    // state by a sync merge. lifeGLANCE re-emits the create.
    localStorage.setItem(DELETED_GOAL_IDS_KEY, JSON.stringify({
      [capturedId]: '2026-07-01T00:00:00.000Z',
      'unrelated-goal': '2026-06-01T00:00:00.000Z',
    }));

    let secondId = null;
    const addGoal2 = (fields) => { secondId = fields.id; return { id: fields.id }; };
    const r = await handleIntent('create', goalPayload, { goals: [], addGoal: addGoal2 });

    expect(r.success).toBe(true);
    expect(secondId).toBe(capturedId);         // same deterministic id
    const tombstones = readTombstones();
    expect(tombstones[capturedId]).toBeUndefined();   // superseded
    expect(tombstones['unrelated-goal']).toBe('2026-06-01T00:00:00.000Z'); // untouched
  });

  it('idempotency path: clears the tombstone for an already-existing goal', async () => {
    const existing = {
      id: 'goal-existing',
      title: 'True retirement',
      source_app: SOURCE_APPS.LIFEGLANCE,
      source_entity_id: 'milestone_tr',
    };
    localStorage.setItem(DELETED_GOAL_IDS_KEY, JSON.stringify({
      'goal-existing': '2026-07-01T00:00:00.000Z',
    }));

    let addCalled = false;
    const addGoal = () => { addCalled = true; return { id: 'x' }; };
    const r = await handleIntent(
      'create',
      { ...goalPayload, title: 'True retirement', source_entity_id: 'milestone_tr' },
      { goals: [existing], addGoal },
    );

    expect(r.success).toBe(true);
    expect(r.task_id).toBe('goal-existing');
    expect(r.warning).toContain('already exists');
    expect(addCalled).toBe(false);                        // no duplicate created
    expect(readTombstones()['goal-existing']).toBeUndefined(); // tombstone cleared
  });

  it('leaves an unrelated tombstone alone when no tombstone exists for the created goal', async () => {
    localStorage.setItem(DELETED_GOAL_IDS_KEY, JSON.stringify({
      'some-other-id': '2026-06-01T00:00:00.000Z',
    }));
    const addGoal = (fields) => ({ id: fields.id });
    const r = await handleIntent('create', goalPayload, { goals: [], addGoal });

    expect(r.success).toBe(true);
    expect(readTombstones()['some-other-id']).toBe('2026-06-01T00:00:00.000Z');
  });
});
