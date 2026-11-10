import React from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import useSchedAgendaState from './useSchedAgendaState.js';

// useSchedAgendaState reads view preferences from localStorage in its state
// initialisers; there is no DOM here, so give it an empty store.
// Node 25 defines a localStorage of its own that has no getItem without
// --localstorage-file, so stub unless a working one is already there.
if (typeof globalThis.localStorage?.getItem !== 'function') {
  delete globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}

// The optional dateRange must scope the agenda to exactly those days and
// leave the rolling window (the existing SCHED call path) untouched.

const dateToStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const byDate = {
  '2026-09-10': [{ id: 'a', title: 'A', date: '2026-09-10', startTime: '09:00', duration: 30 }],
  '2026-09-16': [{ id: 'b', title: 'B', date: '2026-09-16', startTime: '10:00', duration: 30 }, { id: 'c', title: 'C', date: '2026-09-16', isAllDay: true }],
  '2026-09-30': [{ id: 'd', title: 'D', date: '2026-09-30', startTime: '12:00', duration: 30 }],
};
const planner = {
  selectedDate: new Date('2026-09-12T12:00:00'), schedDaysShown: 14, setSchedDaysShown: () => {},
  tasks: [{ id: 'old', title: 'Overdue', date: '2026-09-01', completed: false }, ...Object.values(byDate).flat()],
  unscheduledTasks: [], expandedRecurringTasks: [], currentTime: new Date('2026-09-12T12:00:00'),
  getTasksForDate: (date) => byDate[dateToStr(date)] || [],
  getDeadlineTasksForDate: (dateStr) => (dateStr === '2026-09-16' ? [{ id: 'dl', title: 'Due', deadline: dateStr }] : []),
  setNewTask: () => {}, setShowAddTask: () => {}, scheduleTaskAtNextSlot: () => {},
};
const features = { isVisibleForUser: () => true, routinesEnabled: false, todayRoutines: [] };

const Probe = ({ options }) => {
  const s = useSchedAgendaState(options);
  return <pre>{JSON.stringify({ scoped: s.scoped, days: s.visibleDays.map((d) => `${d.dateStr}:${d.tasks.map((t) => t.id).join('')}:${d.deadlineTasks.map((t) => t.id).join('')}`), overdue: s.overdueTasks.map((t) => t.id) })}</pre>;
};
const probe = (options, overrides = {}) => JSON.parse(renderToStaticMarkup(
  <DayPlannerContext.Provider value={{ ...planner, ...overrides }}><FeaturesContext.Provider value={features}><Probe options={options} /></FeaturesContext.Provider></DayPlannerContext.Provider>,
).replace(/<[^>]+>/g, '').replace(/&quot;/g, '"'));

// The overdue section is the one thing this hook resolves against the REAL
// wall clock rather than the fixture's currentTime: useSchedAgendaState.js:196
// reads `new Date()` so a kiosk left running rolls over at midnight, which is
// the behaviour we want and not something to change for a test's convenience.
// The consequence is that every assertion below about a date that is NOT today
// only holds while the runner's clock agrees with that. Unpinned, this file
// went red on 2026-09-16 and would have again on the 20th and the 30th — the
// three dates the cases below name. Pin the clock to the fixture's own day so
// the suite means the same thing on every date it is ever run.
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-12T12:00:00'));
});
afterAll(() => { vi.useRealTimers(); });

describe('useSchedAgendaState dateRange', () => {
  it('leaves the rolling window untouched when no options are passed', () => {
    const out = probe(undefined);
    expect(out.scoped).toBe(false);
    // 14 days from the 12th, empty days hidden: only the days with items.
    expect(out.days).toEqual(['2026-09-16:cb:dl']);
    // Both the 1st and the 10th fall before the window (and before today).
    expect(out.overdue).toEqual(['old', 'a']);
  });

  it("scopes to exactly one date, shows it even when empty, and drops the overdue section on any day but today", () => {
    expect(probe({ dateRange: { from: '2026-09-16', to: '2026-09-16' } })).toEqual({ scoped: true, days: ['2026-09-16:cb:dl'], overdue: [] });
    expect(probe({ dateRange: { from: '2026-09-30', to: '2026-09-30' } })).toEqual({ scoped: true, days: ['2026-09-30:d:'], overdue: [] });
    expect(probe({ dateRange: { from: '2026-09-20', to: '2026-09-20' } })).toEqual({ scoped: true, days: ['2026-09-20::'], overdue: [] });
  });

  it("carries the overdue section, exactly as the rolling agenda has it, when the range starts today", () => {
    const today = dateToStr(new Date());
    const rolling = probe(undefined);
    const scopedToday = probe({ dateRange: { from: today, to: today } });
    expect(scopedToday.scoped).toBe(true);
    expect(scopedToday.days).toHaveLength(1);
    expect(scopedToday.days[0].startsWith(today)).toBe(true);
    expect(scopedToday.overdue).toEqual(rolling.overdue);
    expect(scopedToday.overdue).toContain('old');
    // A range that merely contains today but starts earlier is not today's agenda.
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    expect(probe({ dateRange: { from: dateToStr(yesterday), to: today } }).overdue).toEqual([]);
  });

  it('covers a multi-day range inclusively, in order', () => {
    const out = probe({ dateRange: { from: '2026-09-09', to: '2026-09-11' } });
    expect(out.days).toEqual(['2026-09-09::', '2026-09-10:a:', '2026-09-11::']);
  });

  it('treats an incomplete range as no range', () => {
    expect(probe({ dateRange: { from: '2026-09-16' } }).scoped).toBe(false);
  });
});

// #2116 review: the Overdue section holds both kinds of lateness — a scheduled
// task whose day is behind us, and an INBOX task whose deadline has passed. The
// DAY view has always listed the second (utils/getOverdueTasks.js); the agenda
// did not, so the same task nagged in DAY and disappeared from SCHED.
describe('useSchedAgendaState overdue includes past-deadline inbox tasks', () => {
  const unscheduled = [
    { id: 'late', title: 'Late', deadline: '2026-09-02', completed: false },
    { id: 'due-today', title: 'Due today', deadline: '2026-09-12', completed: false },
    { id: 'later', title: 'Due later', deadline: '2026-09-30', completed: false },
    { id: 'done', title: 'Done', deadline: '2026-09-02', completed: true },
    { id: 'someday', title: 'Someday', deadline: '2026-09-02', completed: false, bucketId: 'b2' },
    { id: 'plain', title: 'No deadline', completed: false },
  ];

  it('lists exactly the past-deadline, incomplete, unbucketed one', () => {
    // 'old' and 'a' are the scheduled kind and keep their order before it.
    expect(probe(undefined, { unscheduledTasks: unscheduled }).overdue).toEqual(['old', 'a', 'late']);
  });

  it('is empty on a scoped day other than today, as the scheduled kind is', () => {
    expect(probe({ dateRange: { from: '2026-09-16', to: '2026-09-16' } }, { unscheduledTasks: unscheduled }).overdue).toEqual([]);
  });

  it("rides into today's scoped agenda too", () => {
    const today = dateToStr(new Date());
    expect(probe({ dateRange: { from: today, to: today } }, { unscheduledTasks: unscheduled }).overdue)
      .toEqual(['old', 'a', 'late']);
  });
});
