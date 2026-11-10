import { describe, it, expect } from 'vitest';
import { planCreateTask } from './mcpCreateArgs.js';

// Argument-shape rules for the extended create_task. Load-bearing: the
// by-design rejections must READ as design (a model that sees "unsupported"
// retries another way; one that sees "by design" reports it to the user),
// and the two create shapes must come out exactly as the UI's own creation
// paths store them.

const TZ = 'America/Chicago';
const plan = (args: Record<string, unknown>) => planCreateTask(args, TZ);

describe('planCreateTask — inbox shape', () => {
  it('title alone → bare inbox plan', () => {
    expect(plan({ title: 'Buy milk' })).toEqual({ ok: true, plan: { title: 'Buy milk' } });
  });

  it('carries priority, deadline, duration, notes, project, assignee through', () => {
    const r = plan({ title: 'T', notes: 'n', priority: 3, deadline: '2026-09-01', duration_minutes: 45, assignee_id: 'sync-1' });
    expect(r).toEqual({
      ok: true,
      plan: { title: 'T', notes: 'n', priority: 3, deadline: '2026-09-01', durationMinutes: 45, assigneeSyncId: 'sync-1' },
    });
  });

  it('empty or missing title → validation', () => {
    for (const title of [undefined, '', '   ', 42]) {
      const r = plan({ title });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('validation');
    }
  });

  it('priority outside 0-3 or non-integer → validation naming the range', () => {
    for (const priority of [-1, 4, 1.5, '2']) {
      const r = plan({ title: 'T', priority });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/0-3/);
    }
    for (const priority of [0, 1, 2, 3]) {
      expect(plan({ title: 'T', priority }).ok).toBe(true);
    }
  });

  it('deadline must be a strict local date', () => {
    const r = plan({ title: 'T', deadline: '2026-9-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/YYYY-MM-DD/);
    expect(plan({ title: 'T', deadline: '2026-02-30' }).ok).toBe(false); // not a real date
  });

  it('all_day without start → validation pointing at start', () => {
    const r = plan({ title: 'T', all_day: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/start/);
  });
});

describe('planCreateTask — scheduled shape', () => {
  it('start "YYYY-MM-DD HH:MM" → direct scheduled plan, with no duration invented', () => {
    // The renderer gives a duration-less create its project's New task default,
    // else the user's default task duration: a 30 filled in here would hide both.
    const r = plan({ title: 'T', start: '2026-08-14 09:30' });
    expect(r).toEqual({
      ok: true,
      plan: { title: 'T', schedule: { date: '2026-08-14', startTime: '09:30', allDay: false } },
    });
    expect(r.ok && 'durationMinutes' in r.plan.schedule!).toBe(false);
  });

  it('duration_minutes overrides the scheduled default', () => {
    const r = plan({ title: 'T', start: '2026-08-14 09:30', duration_minutes: 90 });
    expect(r.ok && r.plan.schedule?.durationMinutes).toBe(90);
  });

  it('all_day takes a BARE date and stores the UI shape (00:00, allDay; the renderer fills the duration)', () => {
    const r = plan({ title: 'T', start: '2026-08-14', all_day: true });
    expect(r).toEqual({
      ok: true,
      plan: { title: 'T', schedule: { date: '2026-08-14', startTime: '00:00', allDay: true } },
    });
  });

  it('all_day with a time component → typed error saying all-day takes a date only', () => {
    const r = plan({ title: 'T', start: '2026-08-14 09:30', all_day: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/date only/);
  });

  it('all_day with duration_minutes → typed error naming the contradiction', () => {
    const r = plan({ title: 'T', start: '2026-08-14', all_day: true, duration_minutes: 60 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/contradict/);
  });

  it('timed create requires the HH:MM half (a bare date without all_day fails)', () => {
    const r = plan({ title: 'T', start: '2026-08-14' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/YYYY-MM-DD HH:MM/);
  });

  it('rejects DST-gap times through the shared §5.3 validator', () => {
    // 2026-03-08 02:30 does not exist in America/Chicago (spring forward).
    const r = plan({ title: 'T', start: '2026-03-08 02:30' });
    expect(r.ok).toBe(false);
  });
});

describe('planCreateTask — by-design rejections (copy must say design, not unsupported)', () => {
  it('priority or deadline alongside start → "by design", never "unsupported"', () => {
    for (const extra of [{ priority: 2 }, { deadline: '2026-09-01' }]) {
      const r = plan({ title: 'T', start: '2026-08-14 09:00', ...extra });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe('validation');
        expect(r.message).toMatch(/by design/);
        expect(r.message).not.toMatch(/unsupported/i);
      }
    }
  });

  it('priority and deadline alongside project_id → an unscheduled project task carrying both', () => {
    const r = plan({ title: 'T', project_id: 'p1', priority: 2, deadline: '2026-09-01' });
    expect(r).toEqual({ ok: true, plan: { title: 'T', projectId: 'p1', priority: 2, deadline: '2026-09-01' } });
  });

  it('a project deadline gets the same strict YYYY-MM-DD validation as an inbox one', () => {
    for (const bad of ['2026-9-1', '2026-02-30', '2026-09-01T10:00', 20260901]) {
      const r = plan({ title: 'T', project_id: 'p1', deadline: bad });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/strict YYYY-MM-DD/);
    }
  });

  it('a SCHEDULED project task still rejects priority and deadline by design', () => {
    for (const extra of [{ priority: 1 }, { deadline: '2026-09-01' }]) {
      const r = plan({ title: 'T', project_id: 'p1', start: '2026-08-14 09:00', ...extra });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/Scheduled dayGLANCE tasks do not carry priority or deadline by design/);
    }
  });

  it('repeat without start → by-design rejection: a series lives on the calendar', () => {
    const r = plan({ title: 'T', repeat: { frequency: 'weekly' } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('validation');
      expect(r.message).toMatch(/repeat needs start/);
    }
  });

  it('repeat with start → a series plan anchored on start (#2066)', () => {
    const r = plan({ title: 'Renew server', start: '2026-10-13 09:00', repeat: { frequency: 'monthly' } });
    expect(r).toEqual({
      ok: true,
      plan: {
        title: 'Renew server',
        schedule: { date: '2026-10-13', startTime: '09:00', allDay: false },
        recurrence: { type: 'monthly', monthDay: 13, monthWeekday: null, startDate: '2026-10-13' },
      },
    });
  });

  it('an all-day series takes its first date from the bare start', () => {
    const r = plan({ title: 'Bins', start: '2026-10-13', all_day: true, repeat: { frequency: 'weekly', days_of_week: ['tue'] } });
    expect(r.ok && r.plan.recurrence).toEqual({ type: 'weekly', daysOfWeek: [2], startDate: '2026-10-13' });
    expect(r.ok && r.plan.schedule?.allDay).toBe(true);
  });

  it('a series is scheduled, so priority and deadline are still rejected by design', () => {
    const r = plan({ title: 'T', start: '2026-10-13 09:00', priority: 2, repeat: { frequency: 'daily' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/by design/);
  });

  it('an invalid repeat is the repeat parser\'s validation error, before anything is written', () => {
    const r = plan({ title: 'T', start: '2026-10-13 09:00', repeat: { frequency: 'monthly', interval: 3 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/no interval by design/);
  });

  it('project without priority/deadline is fine (both shapes)', () => {
    expect(plan({ title: 'T', project_id: 'p1' }).ok).toBe(true);
    expect(plan({ title: 'T', project_id: 'p1', start: '2026-08-14 09:00' }).ok).toBe(true);
  });
});
