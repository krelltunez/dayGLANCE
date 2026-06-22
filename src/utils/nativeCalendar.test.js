import { describe, it, expect } from 'vitest';
import { nativeEventToTask } from './nativeCalendar.js';

// The Electron EventKit helper emits the exact same JSON shape as the mobile
// DayGlanceNative bridge, so these fixtures double as the Electron contract.
const ev = (extra = {}) => ({
  id: 'ABC-123',
  title: 'Standup',
  start: '2026-06-22T09:00:00',
  end: '2026-06-22T09:30:00',
  allDay: false,
  notes: '',
  location: '',
  calendarId: 'cal-work',
  calendarName: 'Work',
  color: '#3b82f6',
  ...extra,
});

describe('nativeEventToTask', () => {
  it('maps a timed event with derived duration and _native flag', () => {
    const task = nativeEventToTask(ev());
    expect(task).toMatchObject({
      id: 'native-cal-ABC-123',
      nativeEventId: 'ABC-123',
      title: 'Standup',
      date: '2026-06-22',
      startTime: '09:00',
      duration: 30,
      isAllDay: false,
      imported: true,
      isTaskCalendar: false,
      completed: false,
      _native: true,
      nativeCalendarColor: '#3b82f6',
      calendarName: 'Work',
    });
  });

  it('clamps a too-short duration to a 15-minute minimum', () => {
    const task = nativeEventToTask(ev({ start: '2026-06-22T09:00:00', end: '2026-06-22T09:05:00' }));
    expect(task.duration).toBe(15);
  });

  it('falls back to a 60-minute duration when no end time is present', () => {
    const task = nativeEventToTask(ev({ end: '' }));
    expect(task.duration).toBe(60);
  });

  it('maps a single-day all-day event with no startTime', () => {
    const task = nativeEventToTask({
      ...ev(),
      allDay: true,
      start: '2026-06-22',
      end: '2026-06-22',
    });
    expect(task).toMatchObject({
      id: 'native-cal-ABC-123',
      date: '2026-06-22',
      startTime: null,
      isAllDay: true,
    });
  });

  it('gives multi-day all-day events a per-day id and uses the queried date', () => {
    const base = {
      ...ev(),
      id: 'TRIP',
      allDay: true,
      start: '2026-06-20',
      end: '2026-06-23',
    };
    const day1 = nativeEventToTask({ ...base, _queryDate: '2026-06-21' });
    const day2 = nativeEventToTask({ ...base, _queryDate: '2026-06-22' });
    expect(day1.id).toBe('native-cal-TRIP-2026-06-21');
    expect(day1.date).toBe('2026-06-21');
    expect(day2.id).toBe('native-cal-TRIP-2026-06-22');
    expect(day2.date).toBe('2026-06-22');
    // Distinct ids so each spanned day survives id-based dedup
    expect(day1.id).not.toBe(day2.id);
  });

  it('clamps an out-of-range queried date to the event span', () => {
    const base = { ...ev(), id: 'TRIP', allDay: true, start: '2026-06-20', end: '2026-06-22' };
    const before = nativeEventToTask({ ...base, _queryDate: '2026-06-18' });
    const after = nativeEventToTask({ ...base, _queryDate: '2026-06-25' });
    expect(before.date).toBe('2026-06-20');
    expect(after.date).toBe('2026-06-22');
  });

  it('flags task-list calendars via the task- id prefix', () => {
    const task = nativeEventToTask(ev({ id: 'task-42' }));
    expect(task.isTaskCalendar).toBe(true);
    expect(task.id).toBe('native-cal-task-42');
  });
});
