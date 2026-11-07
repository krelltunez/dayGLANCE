import { describe, expect, it } from 'vitest';
import { buildTodayAgenda, buildAgendaNowMarker, agendaItemSpan, agendaNowAndNext } from './todayAgenda.js';

// Today's agenda (GLANCE's list) and its now marker, moved out of App.jsx.

const TODAY = '2026-11-07';
const visible = () => true;
const at = (hhmm) => new Date(`${TODAY}T${hhmm}:00`);
const minutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

const agenda = ({ now = '08:00', tasks = [], expandedRecurringTasks = [], unscheduledTasks = [] } = {}) =>
  buildTodayAgenda({ todayStr: TODAY, nowMinutes: minutes(now), tasks, expandedRecurringTasks, unscheduledTasks, isVisibleForUser: visible });

const task = (over) => ({ id: 'x', title: 'Task', date: TODAY, startTime: '09:00', duration: 30, completed: false, ...over });

describe('buildTodayAgenda', () => {
  it('lists deadlines, then all-day items, then timed ones in start order, each tagged', () => {
    const list = agenda({
      tasks: [task({ id: 'b', startTime: '10:00' }), task({ id: 'a', startTime: '09:00' }), task({ id: 'ad', isAllDay: true })],
      unscheduledTasks: [{ id: 'dl', title: 'Due', deadline: TODAY }],
    });
    expect(list.map(t => [t.id, t._agendaType])).toEqual([['dl', 'deadline'], ['ad', 'allday'], ['a', 'scheduled'], ['b', 'scheduled']]);
  });

  it('keeps an unfinished task that has ended, and drops a finished one and a past event', () => {
    const list = agenda({
      now: '12:00',
      tasks: [
        task({ id: 'late' }),
        task({ id: 'done', completed: true }),
        task({ id: 'event', imported: true }),
        task({ id: 'next', startTime: '13:00' }),
      ],
    });
    expect(list.map(t => t.id)).toEqual(['late', 'next']);
  });

  it('includes today’s recurring occurrences and leaves out examples and other dates', () => {
    const list = agenda({
      tasks: [task({ id: 'ex', isExample: true }), task({ id: 'tomorrow', date: '2026-11-08' })],
      expandedRecurringTasks: [task({ id: 'recurring-r-2026-11-07' })],
    });
    expect(list.map(t => t.id)).toEqual(['recurring-r-2026-11-07']);
  });
});

describe('buildAgendaNowMarker', () => {
  const marker = (list, now) => buildAgendaNowMarker({ todayAgenda: list, now: at(now), unscheduledTasks: [], isVisibleForUser: visible });

  it('before everything: the marker goes first and the free time runs to the first task', () => {
    const list = agenda({ tasks: [task({ startTime: '09:00' })] });
    expect(marker(list, '08:00')).toMatchObject({ insertAfterIndex: -1, insideTask: false, gapMinutes: 60, nowTimeStr: '08:00' });
  });

  it('inside a task: in progress, no free time claimed', () => {
    const list = agenda({ now: '09:10', tasks: [task({ startTime: '09:00' })] });
    expect(marker(list, '09:10')).toMatchObject({ insideTask: true, insertAfterIndex: -1 });
  });

  it('after everything: the rest of the day is free', () => {
    const list = agenda({ now: '10:00', tasks: [task({ id: 'late', startTime: '09:00' })] });
    expect(marker(list, '10:00')).toMatchObject({ insideTask: false, insertAfterIndex: 0, gapMinutes: 24 * 60 - 600 });
  });
});

// #2278: the owner's scenario. A Friday 23:00 task of two hours, looked at
// on Saturday: at 00:08 it is running until 01:00.
describe('the night before’s task still running (#2278)', () => {
  const FRI = '2026-11-06';
  const night = task({ id: 'night', title: 'Two-Hour Task', date: FRI, startTime: '23:00', duration: 120 });
  const breakfast = task({ id: 'breakfast', title: 'Breakfast', startTime: '09:00', duration: 30 });
  const marker = (list, now) => buildAgendaNowMarker({ todayAgenda: list, now: at(now), unscheduledTasks: [], isVisibleForUser: visible });

  it('at 00:08 it is listed first, as the task’s own row tagged as a continuation', () => {
    const list = agenda({ now: '00:08', tasks: [breakfast, night] });
    expect(list.map(t => t.id)).toEqual(['night', 'breakfast']);
    // The real row (its own date, start and duration), so its actions act on the task.
    expect(list[0]).toMatchObject({ date: FRI, startTime: '23:00', duration: 120, _agendaType: 'scheduled', _continuation: { fromDate: FRI, minutes: 60 } });
    expect(agendaItemSpan(list[0])).toEqual({ start: 0, end: 60 });
  });

  it('at 00:08 the now marker is inside it: in progress, no free time before 01:00', () => {
    const list = agenda({ now: '00:08', tasks: [breakfast, night] });
    expect(marker(list, '00:08')).toMatchObject({ insideTask: true, insertAfterIndex: -1 });
  });

  it('at 01:30 it is over and gone; the free time runs from now to 09:00', () => {
    const list = agenda({ now: '01:30', tasks: [breakfast, night] });
    expect(list.map(t => t.id)).toEqual(['breakfast']);
    expect(marker(list, '01:30')).toMatchObject({ insideTask: false, insertAfterIndex: -1, gapMinutes: 9 * 60 - 90 });
  });

  it('a recurring occurrence from last night carries too, with its own id', () => {
    const occurrence = task({ id: 'recurring-r-2026-11-06', date: FRI, startTime: '23:30', duration: 60 });
    const list = agenda({ now: '00:10', expandedRecurringTasks: [occurrence] });
    expect(list.map(t => [t.id, t._continuation?.minutes])).toEqual([['recurring-r-2026-11-06', 30]]);
  });

  it('done while running it stays, shown as done, until it ends; an imported event too', () => {
    const done = { ...night, completed: true };
    expect(agenda({ now: '00:08', tasks: [done] }).map(t => t.id)).toEqual(['night']);
    expect(agenda({ now: '01:00', tasks: [done] })).toEqual([]);
    const event = { ...night, id: 'ev', imported: true };
    expect(agenda({ now: '00:30', tasks: [event] }).map(t => t.id)).toEqual(['ev']);
  });

  it('only a task that crosses midnight, is this user’s, and is not an example', () => {
    const list = agenda({
      now: '00:08',
      tasks: [
        task({ id: 'evening', date: FRI, startTime: '20:00', duration: 60 }),
        task({ id: 'to-midnight', date: FRI, startTime: '23:00', duration: 60 }),
        task({ id: 'allday', date: FRI, isAllDay: true }),
        { ...night, id: 'example', isExample: true },
      ],
    });
    expect(list).toEqual([]);
    const notMine = buildTodayAgenda({
      todayStr: TODAY, nowMinutes: 8, tasks: [night], expandedRecurringTasks: [], unscheduledTasks: [],
      isVisibleForUser: (t) => t.id !== 'night',
    });
    expect(notMine).toEqual([]);
  });

  it('agendaNowAndNext: at 00:08 it is current and breakfast is next; at 01:30 breakfast is next', () => {
    const early = agendaNowAndNext(agenda({ now: '00:08', tasks: [breakfast, night] }), 8);
    expect(early.current.task.id).toBe('night');
    expect(early.current).toMatchObject({ startTime: '00:00', duration: 60 });
    expect(early.next.task.id).toBe('breakfast');
    const later = agendaNowAndNext(agenda({ now: '01:30', tasks: [breakfast, night] }), 90);
    expect(later.current).toBeNull();
    expect(later.next.task.id).toBe('breakfast');
  });
});
