import { describe, it, expect } from 'vitest';
import { buildStreamDeckState, timeToMinutes } from './streamDeckPayload.js';
import { fixtureInputs, FIXTURE_NOW } from './streamDeckPayload.fixture.js';
import { PROTOCOL_VERSION, MSG_DAY_STATE } from '../../electron/protocol';

// The ws:push-state payload is a WIRE FORMAT consumed by the Stream Deck
// plugin over ws://localhost:7892. The manifest test below freezes the full
// set of field paths the fixture produces (the fixture populates every
// branch: currentTask, nextTask, focus, hg.active, habits, goals, projects,
// nextRoutine, tomorrow), so dropping or renaming any field anywhere in the
// payload fails here before it breaks real users' buttons.

const build = (mutate) => {
  const inputs = fixtureInputs();
  if (mutate) mutate(inputs);
  return buildStreamDeckState(inputs);
};

function fieldPaths(value, prefix = '') {
  if (Array.isArray(value)) {
    const collected = new Set();
    for (const item of value) for (const p of fieldPaths(item, `${prefix}[]`)) collected.add(p);
    return collected.size ? [...collected] : [`${prefix}[]`];
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    return keys.length ? keys.flatMap(k => fieldPaths(value[k], prefix ? `${prefix}.${k}` : k)) : [prefix];
  }
  return [prefix];
}

describe('payload shape manifest (the wire contract)', () => {
  it('produces exactly the frozen set of field paths', () => {
    const { payload } = build();
    expect([...new Set(fieldPaths(payload))].sort()).toEqual([
      'currentTask.colorHex',
      'currentTask.completed',
      'currentTask.duration',
      'currentTask.id',
      'currentTask.imported',
      'currentTask.isAllDay',
      'currentTask.isHGSession',
      'currentTask.isTaskCalendar',
      'currentTask.startTime',
      'currentTask.tags[]',
      'currentTask.title',
      'focus.active',
      'focus.available',
      'focus.breakMinutes',
      'focus.cycleCount',
      'focus.longBreakMinutes',
      'focus.nextFocusTask.id',
      'focus.nextFocusTask.title',
      'focus.phase',
      'focus.running',
      'focus.secondsRemaining',
      'focus.setup',
      'focus.showStats',
      'focus.workMinutes',
      'goals[].colorHex',
      'goals[].daysLeft',
      'goals[].id',
      'goals[].progress',
      'goals[].title',
      'habits[].colorHex',
      'habits[].complete',
      'habits[].count',
      'habits[].id',
      'habits[].name',
      'habits[].ringColorHex',
      'habits[].target',
      'habits[].type',
      'habits[].unit',
      'hg.active.breakMinutes',
      'hg.active.colorHex',
      'hg.active.completed',
      'hg.active.cycleCount',
      'hg.active.longBreakMinutes',
      'hg.active.nextTask.id',
      'hg.active.nextTask.title',
      'hg.active.phase',
      'hg.active.projectId',
      'hg.active.running',
      'hg.active.secondsRemaining',
      'hg.active.setup',
      'hg.active.title',
      'hg.active.workMinutes',
      'hg.scheduled[].colorHex',
      'hg.scheduled[].date',
      'hg.scheduled[].projectId',
      'hg.scheduled[].reachable',
      'hg.scheduled[].startTime',
      'hg.scheduled[].title',
      'nextRoutine.completed',
      'nextRoutine.id',
      'nextRoutine.name',
      'nextRoutine.startTime',
      'nextTask.colorHex',
      'nextTask.completed',
      'nextTask.duration',
      'nextTask.id',
      'nextTask.imported',
      'nextTask.isAllDay',
      'nextTask.isHGSession',
      'nextTask.isTaskCalendar',
      'nextTask.startTime',
      'nextTask.tags[]',
      'nextTask.title',
      'projects[].colorHex',
      'projects[].goalDaysLeft',
      'projects[].goalTitle',
      'projects[].id',
      'projects[].progress',
      'projects[].tasksDone',
      'projects[].tasksTotal',
      'projects[].title',
      'scheduledTasks[].colorHex',
      'scheduledTasks[].completed',
      'scheduledTasks[].duration',
      'scheduledTasks[].id',
      'scheduledTasks[].imported',
      'scheduledTasks[].isAllDay',
      'scheduledTasks[].isHGSession',
      'scheduledTasks[].isTaskCalendar',
      'scheduledTasks[].startTime',
      'scheduledTasks[].tags[]',
      'scheduledTasks[].title',
      'today.completed',
      'today.date',
      'today.total',
      'tomorrow.tasks[].colorHex',
      'tomorrow.tasks[].completed',
      'tomorrow.tasks[].duration',
      'tomorrow.tasks[].id',
      'tomorrow.tasks[].imported',
      'tomorrow.tasks[].isAllDay',
      'tomorrow.tasks[].isHGSession',
      'tomorrow.tasks[].isTaskCalendar',
      'tomorrow.tasks[].startTime',
      'tomorrow.tasks[].tags[]',
      'tomorrow.tasks[].title',
      'tomorrow.total',
      'type',
      'use24Hour',
      'v',
    ]);
  });

  it('stamps the protocol version and message type verbatim', () => {
    const { payload } = build();
    expect(payload.v).toBe(PROTOCOL_VERSION);
    expect(payload.type).toBe(MSG_DAY_STATE);
  });

  it('applies mapTask defaults on sparse tasks (all-day recurring instance)', () => {
    const { payload } = build();
    const allDayRecurring = payload.scheduledTasks.find(t => t.id === 'recurring-allday-2026-08-16');
    expect(allDayRecurring).toMatchObject({
      startTime: null, duration: 0, tags: [], completed: false,
      isAllDay: true, isHGSession: false, imported: false, isTaskCalendar: false,
    });
  });
});

describe('current and next task selection', () => {
  it('picks the in-progress agenda item and the next upcoming one', () => {
    const { payload } = build();
    // 14:30 sits inside ag-1 (14:00 + 60); ag-2 at 16:00 beats the HG session at 17:00.
    expect(payload.currentTask.id).toBe('ag-1');
    expect(payload.nextTask.id).toBe('ag-2');
  });

  it('completed agenda items are never current or next', () => {
    const { payload } = build(i => { i.todayAgenda[0].completed = true; });
    expect(payload.currentTask).toBeNull();
    expect(payload.nextTask.id).toBe('ag-2');
  });
});

describe('badge count', () => {
  it('counts incomplete today tasks, excluding imported calendar events', () => {
    // t-timed + recurring-1 + the HG session; t-done is complete and
    // t-past-import is a read-only calendar event the user cannot complete.
    expect(build().badgeCount).toBe(3);
  });

  it('an imported task-calendar item IS completable and counts', () => {
    const { badgeCount } = build(i => {
      i.tasks.find(t => t.id === 't-past-import').isTaskCalendar = true;
    });
    expect(badgeCount).toBe(4);
  });
});

describe('today counts', () => {
  it('a past imported calendar event counts as completed for the day ratio', () => {
    const { payload } = build();
    // 7 = 3 timed + 1 recurring + 1 HG session + 2 all-day; completed = t-done
    // plus t-past-import whose 09:00-10:00 window has passed by 14:30.
    expect(payload.today).toMatchObject({ total: 7, completed: 2, date: '2026-08-16' });
  });

  it('a still-running imported event does not count as completed', () => {
    const { payload } = build(i => {
      i.tasks.find(t => t.id === 't-past-import').startTime = '14:00';
    });
    expect(payload.today.completed).toBe(1);
  });
});

describe('habit rings', () => {
  it('doMore at target is complete with its own color; limit exceeded goes red; untouched goes grey', () => {
    const { payload } = build();
    expect(payload.habits.map(({ id, complete, ringColorHex }) => ({ id, complete, ringColorHex }))).toEqual([
      { id: 'h-1', complete: true, ringColorHex: '#3b82f6' },
      { id: 'h-2', complete: false, ringColorHex: '#ef4444' },
      { id: 'h-3', complete: false, ringColorHex: '#d1d5db' },
    ]);
  });

  it('a limit habit at or under its limit rings green', () => {
    const { payload } = build(i => { i.getTodayHabitCount = () => 2; });
    expect(payload.habits.find(h => h.id === 'h-2').ringColorHex).toBe('#22c55e');
  });

  it('a doMore habit below target is started (colored ring) but not complete', () => {
    const { payload } = build(i => { i.getTodayHabitCount = () => 4; });
    const h1 = payload.habits.find(h => h.id === 'h-1');
    expect(h1.complete).toBe(false);
    expect(h1.ringColorHex).toBe('#3b82f6');
  });
});

describe('projects and goals', () => {
  it('orders goal-attached projects before standalone ones, each group by progress ascending', () => {
    const { payload } = build();
    // p-1 (50%, has a goal) leads despite higher progress than the standalone group.
    expect(payload.projects.map(p => p.id)).toEqual(['p-1', 'p-2', 'p-hg']);
    expect(payload.projects[0]).toMatchObject({ progress: 50, goalTitle: 'Ship it', tasksDone: 1, tasksTotal: 2 });
  });

  it('archived goals and completed projects are excluded; daysLeft is whole days to target', () => {
    const { payload } = build();
    expect(payload.goals).toHaveLength(1);
    expect(payload.goals[0]).toMatchObject({ id: 'g-1', progress: 50, daysLeft: 16 });
    expect(payload.projects.find(p => p.id === 'p-done')).toBeUndefined();
  });
});

describe('multi-user visibility', () => {
  it('another user\'s task never appears anywhere in the payload', () => {
    const { payload, badgeCount } = build();
    expect(JSON.stringify(payload)).not.toContain('hidden-1');
    // And it is excluded from counts, not just listings.
    const withVisible = build(i => { delete i.tasks.find(t => t.id === 'hidden-1').assignedUserSyncIds; });
    expect(withVisible.payload.today.total).toBe(8);
    expect(withVisible.badgeCount).toBe(badgeCount + 1);
  });
});

describe('timeToMinutes', () => {
  it('parses HH:MM, tolerates missing minutes, and maps empty to 0', () => {
    expect(timeToMinutes('14:30')).toBe(870);
    expect(timeToMinutes('14')).toBe(840);
    expect(timeToMinutes('')).toBe(0);
    expect(timeToMinutes(null)).toBe(0);
    expect(timeToMinutes('00:05')).toBe(5);
  });
});

describe('fixture sanity', () => {
  it('the fixture clock is what the tests above assume', () => {
    expect(FIXTURE_NOW.getHours()).toBe(14);
    expect(FIXTURE_NOW.getMinutes()).toBe(30);
  });
});

describe('project progress for an external plugin', () => {
  // calculateProjectProgress returns null for a project with nothing to
  // measure, but this payload is a contract with the Stream Deck plugin, which
  // sums and averages `progress` and renders it as a bar width. A key has no
  // way to draw an absence, so the coercion here is deliberate.
  it('sends 0, not null, for an unmeasurable project', () => {
    const { payload } = build(i => {
      i.projects = [...i.projects, { id: 'p-empty', title: 'Upkeep', status: 'active', color: 'bg-blue-500' }];
    });
    const p = payload.projects.find(x => x.id === 'p-empty');
    expect(p).toBeDefined();
    expect(p.progress).toBe(0);
    expect(p.progress).not.toBeNull();
  });
});
