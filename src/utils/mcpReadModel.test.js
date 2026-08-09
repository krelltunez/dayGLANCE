import { describe, it, expect } from 'vitest';
import {
  blockType,
  toBlock,
  expandRecurringForDate,
  buildDayBlocks,
  buildUnscheduledItems,
  buildGoalProgress,
  handleMcpRequest,
} from './mcpReadModel.js';

// The renderer half of the MCP read surface. The load-bearing assertions:
// _native events carry the distinct type + read_only flag in ALL output
// (spec §5.1 r4) and are absent unless include_native is set; recurring
// templates expand for the requested date; goal math matches the UI's own
// progress functions; the dispatcher returns typed errors, never throws.

const T = (over = {}) => ({
  id: 'id-1', title: 'Task', date: '2026-08-10', startTime: '09:00',
  duration: 60, completed: false, isAllDay: false, ...over,
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

  it('imported alone does NOT mark a device event (CalDAV/ICS also set imported)', () => {
    expect(blockType(T({ imported: true }))).toBe('task');
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
      completed: false, deadline: '2026-08-20', notes: 'oat',
    }]);
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
});

describe('handleMcpRequest — the dispatcher', () => {
  const state = { tasks: [], recurringTasks: [], unscheduledTasks: [], goals: [], projects: [] };

  it('ping answers ok — running at all is the §3.3 health signal', () => {
    expect(handleMcpRequest(state, { method: 'ping' })).toEqual({ ok: true, data: { pong: true } });
  });

  it('routes the three read methods', () => {
    expect(handleMcpRequest(state, { method: 'get_day', params: { date: '2026-08-10' } }).ok).toBe(true);
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
});
