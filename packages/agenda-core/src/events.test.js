import { describe, it, expect } from 'vitest';
import { isCalendarEvent, eventHasEnded, agendaClock } from './events.js';
import { buildAgenda } from './agenda.js';

describe('isCalendarEvent', () => {
  it('imported items are events unless they are task-calendar to-dos', () => {
    expect(isCalendarEvent({ imported: true })).toBe(true);
    expect(isCalendarEvent({ imported: true, projected: true })).toBe(true);
    expect(isCalendarEvent({ imported: true, isTaskCalendar: true })).toBe(false);
    expect(isCalendarEvent({ imported: false })).toBe(false);
    expect(isCalendarEvent(null)).toBe(false);
  });
  it('buildAgenda carries isTaskCalendar so the distinction survives', () => {
    const agenda = buildAgenda({ tasks: [
      { id: 'todo', title: 'Todo', date: '2026-09-02', imported: true, isTaskCalendar: true },
      { id: 'ev', title: 'Event', date: '2026-09-02', imported: true },
    ] }, { from: '2026-09-01', to: '2026-09-30' });
    const byId = Object.fromEntries(agenda['2026-09-02'].map((i) => [i.id, isCalendarEvent(i)]));
    expect(byId).toEqual({ todo: false, ev: true });
  });
});

describe('eventHasEnded', () => {
  const clock = { today: '2026-09-02', nowMinutes: 14 * 60 };
  it('past days have ended, future days have not, all-day today has not', () => {
    expect(eventHasEnded({ date: '2026-09-01', startTime: '23:00', duration: 30 }, clock)).toBe(true);
    expect(eventHasEnded({ date: '2026-09-03', startTime: '08:00', duration: 30 }, clock)).toBe(false);
    expect(eventHasEnded({ date: '2026-09-02', isAllDay: true }, clock)).toBe(false);
    expect(eventHasEnded({ date: '2026-09-02', startTime: null }, clock)).toBe(false);
  });
  it('a timed event today ends at start + duration, inclusive of the end minute', () => {
    expect(eventHasEnded({ date: '2026-09-02', startTime: '13:00', duration: 60 }, clock)).toBe(true);
    expect(eventHasEnded({ date: '2026-09-02', startTime: '13:30', duration: 60 }, clock)).toBe(false);
    expect(eventHasEnded({ date: '2026-09-02', startTime: '13:59', duration: null }, clock)).toBe(true);
    expect(eventHasEnded({ date: '2026-09-02', startTime: '14:00', duration: 0 }, clock)).toBe(true);
    expect(eventHasEnded({ date: '2026-09-02', startTime: '14:01' }, clock)).toBe(false);
  });
  it('agendaClock reads the local date and minute', () => {
    expect(agendaClock(new Date(2026, 8, 2, 9, 5))).toEqual({ today: '2026-09-02', nowMinutes: 545 });
  });
});
