import { describe, it, expect } from 'vitest';
import { buildAgenda, expandRecurringTemplate, datesWithItems, shiftDateStr, recurringInstanceId } from './agenda.js';

// The sidebar renders THIS agenda (companion spec 4.2); the app's own
// glanceAhead/todayAgenda expansion is the reference the pins mirror:
// per-date exceptions override fields, `deleted` drops the instance,
// completedDates marks completion, inbox tasks never appear.

const daily = (over = {}) => ({
  id: 'r1', title: 'Meditate', startTime: '07:00', duration: 15, color: 'bg-green-500',
  recurrence: { type: 'daily', interval: 1, startDate: '2026-09-01' },
  completedDates: ['2026-09-02'],
  exceptions: { '2026-09-03': { deleted: true }, '2026-09-04': { startTime: '08:30', title: 'Meditate (late)' } },
  ...over,
});

describe('expandRecurringTemplate', () => {
  it('one instance per occurrence, honoring completedDates and exceptions exactly like the app', () => {
    const inst = expandRecurringTemplate(daily(), '2026-09-01', '2026-09-05');
    expect(inst.map((i) => i.instanceDate)).toEqual(['2026-09-01', '2026-09-02', '2026-09-04', '2026-09-05']); // 09-03 deleted
    expect(inst.find((i) => i.instanceDate === '2026-09-02').completed).toBe(true);
    expect(inst.find((i) => i.instanceDate === '2026-09-04')).toMatchObject({ startTime: '08:30', title: 'Meditate (late)', recurring: true });
    expect(inst[0].id).toBe(recurringInstanceId('r1', '2026-09-01'));
  });

  it('archived templates and templates without recurrence contribute nothing', () => {
    expect(expandRecurringTemplate(daily({ archived: true }), '2026-09-01', '2026-09-05')).toEqual([]);
    expect(expandRecurringTemplate({ id: 'x', title: 'no rec' }, '2026-09-01', '2026-09-05')).toEqual([]);
  });
});

describe('buildAgenda', () => {
  const tasks = [
    { id: 't1', title: 'Standup', date: '2026-09-02', startTime: '09:30', duration: 30, completed: false },
    { id: 't2', title: 'Errand', date: '2026-09-02', isAllDay: true, completed: true },
    { id: 'ev', title: 'Dentist', date: '2026-09-02', startTime: '14:00', imported: true },
    { id: 'out', title: 'Out of window', date: '2026-10-15', startTime: '09:00' },
    { id: 'ex', title: 'Example', date: '2026-09-02', isExample: true },
  ];
  it('merges tasks and recurring instances per date, all-day first then by time', () => {
    const agenda = buildAgenda({ tasks, recurringTasks: [daily()] }, { from: '2026-09-01', to: '2026-09-05' });
    expect(agenda['2026-09-02'].map((i) => i.title)).toEqual(['Errand', 'Meditate', 'Standup', 'Dentist']);
    expect(agenda['2026-10-15']).toBeUndefined();
    expect(agenda['2026-09-02'].some((i) => i.id === 'ex')).toBe(false);
    expect(datesWithItems(agenda)).toEqual(new Set(['2026-09-01', '2026-09-02', '2026-09-04', '2026-09-05']));
  });
  it('imported events can be excluded; inbox tasks never appear', () => {
    const agenda = buildAgenda({ tasks, recurringTasks: [], unscheduledTasks: [{ id: 'i', title: 'inbox' }] }, { from: '2026-09-02', to: '2026-09-02', includeImported: false });
    expect(agenda['2026-09-02'].map((i) => i.id)).toEqual(['t2', 't1']);
  });
});

describe('date helpers', () => {
  it('shiftDateStr does local calendar arithmetic across month ends', () => {
    expect(shiftDateStr('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftDateStr('2026-09-01', -35)).toBe('2026-07-28');
  });
});
