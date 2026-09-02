import { describe, it, expect } from 'vitest';
import { mergeCalendarProjections } from './calendar.js';
import { buildAgenda } from './agenda.js';

const proj = (deviceId, publishedAt, events) => ({ v: 1, kind: 'projection', type: 'calendar', deviceId, from: '2026-08-01', to: '2026-10-01', publishedAt, events });
const ev = (id, date, over = {}) => ({ id, title: `Event ${id}`, date, startTime: '10:00', duration: 30, isAllDay: false, completed: false, ...over });

describe('mergeCalendarProjections', () => {
  const now = Date.parse('2026-09-02T18:00:00Z');
  it('legacy payloads (no days): freshest projection owns every day of its window; stale projections and out-of-window events drop', () => {
    const { events, freshestAt, dayAsOf } = mergeCalendarProjections([
      proj('desk', '2026-09-02T17:00:00Z', [ev('a', '2026-09-03', { title: 'Old title' }), ev('b', '2026-09-04')]),
      proj('phone', '2026-09-02T17:30:00Z', [ev('a', '2026-09-03', { title: 'New title' }), ev('n', '2026-09-02'), ev('far', '2026-12-01')]),
      proj('dead', '2026-08-20T00:00:00Z', [ev('z', '2026-09-05')]),
      { kind: 'observation' },
    ], { from: '2026-08-01', to: '2026-10-01', nowMs: now });
    // phone is fresher and declares the whole window, so desk's b (09-04) is NOT unioned in.
    expect(events.map((e) => e.id).sort()).toEqual(['a', 'n']);
    expect(events.find((e) => e.id === 'a').title).toBe('New title');
    expect(events.every((e) => e.imported && e.projected)).toBe(true);
    expect(freshestAt).toBe(Date.parse('2026-09-02T17:30:00Z'));
    expect(dayAsOf['2026-09-04']).toBe(Date.parse('2026-09-02T17:30:00Z'));
  });
  it('per-day stamps: each date goes to the projection that fetched it most recently, so a narrow fresh fetch does not erase other days', () => {
    const desk = { ...proj('desk', '2026-09-02T17:00:00Z', [ev('a', '2026-09-03'), ev('b', '2026-09-10')]),
      days: { '2026-09-03': '2026-09-02T17:00:00Z', '2026-09-10': '2026-09-02T17:00:00Z' } };
    // The phone re-fetched 09-03 later and found `a` gone; it knows nothing about 09-10.
    const phone = { ...proj('phone', '2026-09-02T17:30:00Z', [ev('c', '2026-09-03')]),
      days: { '2026-09-03': '2026-09-02T17:30:00Z' } };
    const { events, dayAsOf } = mergeCalendarProjections([desk, phone], { from: '2026-08-01', to: '2026-10-01', nowMs: now });
    expect(events.map((e) => e.id).sort()).toEqual(['b', 'c']);
    expect(dayAsOf).toEqual({ '2026-09-03': Date.parse('2026-09-02T17:30:00Z'), '2026-09-10': Date.parse('2026-09-02T17:00:00Z') });
  });
  it('nothing qualifying → empty', () => {
    expect(mergeCalendarProjections([], { from: '2026-08-01', to: '2026-10-01' })).toEqual({ events: [], freshestAt: null, dayAsOf: {} });
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
