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
  it('start "YYYY-MM-DD HH:MM" → direct scheduled plan with default duration 30', () => {
    const r = plan({ title: 'T', start: '2026-08-14 09:30' });
    expect(r).toEqual({
      ok: true,
      plan: { title: 'T', schedule: { date: '2026-08-14', startTime: '09:30', durationMinutes: 30, allDay: false } },
    });
  });

  it('duration_minutes overrides the scheduled default', () => {
    const r = plan({ title: 'T', start: '2026-08-14 09:30', duration_minutes: 90 });
    expect(r.ok && r.plan.schedule?.durationMinutes).toBe(90);
  });

  it('all_day takes a BARE date and stores the UI shape (00:00, allDay, duration 30)', () => {
    const r = plan({ title: 'T', start: '2026-08-14', all_day: true });
    expect(r).toEqual({
      ok: true,
      plan: { title: 'T', schedule: { date: '2026-08-14', startTime: '00:00', durationMinutes: 30, allDay: true } },
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

  it('priority or deadline alongside project_id → the project-task by-design error', () => {
    for (const extra of [{ priority: 1 }, { deadline: '2026-09-01' }]) {
      const r = plan({ title: 'T', project_id: 'p1', ...extra });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.message).toMatch(/project tasks do not carry priority or deadline by design/);
        expect(r.message).not.toMatch(/unsupported/i);
      }
    }
  });

  it('repeat → typed v1 rejection naming v1', () => {
    const r = plan({ title: 'T', repeat: 'weekly' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('validation');
      expect(r.message).toMatch(/v1/);
    }
  });

  it('project without priority/deadline is fine (both shapes)', () => {
    expect(plan({ title: 'T', project_id: 'p1' }).ok).toBe(true);
    expect(plan({ title: 'T', project_id: 'p1', start: '2026-08-14 09:00' }).ok).toBe(true);
  });
});
