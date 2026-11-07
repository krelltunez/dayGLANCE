import { describe, expect, it } from 'vitest';
import { buildTodayAgenda, buildAgendaNowMarker } from './todayAgenda.js';

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
