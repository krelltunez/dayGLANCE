import { describe, it, expect } from 'vitest';
import { mergeCalendarProjections } from './calendar.js';
import { buildAgenda } from './agenda.js';

const proj = (deviceId, publishedAt, events) => ({ v: 1, kind: 'projection', type: 'calendar', deviceId, from: '2026-08-01', to: '2026-10-01', publishedAt, events });
const ev = (id, date, over = {}) => ({ id, title: `Event ${id}`, date, startTime: '10:00', duration: 30, isAllDay: false, completed: false, ...over });

describe('mergeCalendarProjections', () => {
  const now = Date.parse('2026-09-02T18:00:00Z');
  it('unions devices, freshest copy wins per id, stale projections and out-of-window events drop', () => {
    const { events, freshestAt } = mergeCalendarProjections([
      proj('desk', '2026-09-02T17:00:00Z', [ev('a', '2026-09-03', { title: 'Old title' }), ev('b', '2026-09-04')]),
      proj('phone', '2026-09-02T17:30:00Z', [ev('a', '2026-09-03', { title: 'New title' }), ev('n', '2026-09-02'), ev('far', '2026-12-01')]),
      proj('dead', '2026-08-20T00:00:00Z', [ev('z', '2026-09-05')]),
      { kind: 'observation' },
    ], { from: '2026-08-01', to: '2026-10-01', nowMs: now });
    expect(events.map((e) => e.id).sort()).toEqual(['a', 'b', 'n']);
    expect(events.find((e) => e.id === 'a').title).toBe('New title');
    expect(events.every((e) => e.imported && e.projected)).toBe(true);
    expect(freshestAt).toBe(Date.parse('2026-09-02T17:30:00Z'));
  });
  it('nothing qualifying → empty, freshestAt null', () => {
    expect(mergeCalendarProjections([], { from: '2026-08-01', to: '2026-10-01' })).toEqual({ events: [], freshestAt: null });
  });
});

describe('buildAgenda with calendarEvents', () => {
  it('places projected events on their date as read-only imported items, sorted with the rest; includeImported:false drops them', () => {
    const data = { tasks: [{ id: 't', title: 'Task', date: '2026-09-03', startTime: '09:00' }], calendarEvents: [ev('c', '2026-09-03', { calendarName: 'Work' }), ev('x', '2026-12-01')] };
    const agenda = buildAgenda(data, { from: '2026-09-01', to: '2026-09-30' });
    expect(agenda['2026-09-03'].map((i) => i.id)).toEqual(['t', 'c']);
    expect(agenda['2026-09-03'][1]).toMatchObject({ imported: true, projected: true, calendarName: 'Work', recurring: false });
    expect(agenda['2026-12-01']).toBeUndefined();
    expect(buildAgenda(data, { from: '2026-09-01', to: '2026-09-30', includeImported: false })['2026-09-03']).toHaveLength(1);
  });
});
