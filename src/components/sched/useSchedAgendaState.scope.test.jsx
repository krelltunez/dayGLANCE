import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import useSchedAgendaState from './useSchedAgendaState.js';

// useSchedAgendaState reads view preferences from localStorage in its state
// initialisers; there is no DOM here, so give it an empty store.
if (typeof globalThis.localStorage === 'undefined') {
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
const probe = (options) => JSON.parse(renderToStaticMarkup(
  <DayPlannerContext.Provider value={planner}><FeaturesContext.Provider value={features}><Probe options={options} /></FeaturesContext.Provider></DayPlannerContext.Provider>,
).replace(/<[^>]+>/g, '').replace(/&quot;/g, '"'));

describe('useSchedAgendaState dateRange', () => {
  it('leaves the rolling window untouched when no options are passed', () => {
    const out = probe(undefined);
    expect(out.scoped).toBe(false);
    // 14 days from the 12th, empty days hidden: only the days with items.
    expect(out.days).toEqual(['2026-09-16:cb:dl']);
    // Both the 1st and the 10th fall before the window (and before today).
    expect(out.overdue).toEqual(['old', 'a']);
  });

  it('scopes to exactly one date, shows it even when empty, and drops the overdue section', () => {
    expect(probe({ dateRange: { from: '2026-09-16', to: '2026-09-16' } })).toEqual({ scoped: true, days: ['2026-09-16:cb:dl'], overdue: [] });
    expect(probe({ dateRange: { from: '2026-09-30', to: '2026-09-30' } })).toEqual({ scoped: true, days: ['2026-09-30:d:'], overdue: [] });
    expect(probe({ dateRange: { from: '2026-09-20', to: '2026-09-20' } })).toEqual({ scoped: true, days: ['2026-09-20::'], overdue: [] });
  });

  it('covers a multi-day range inclusively, in order', () => {
    const out = probe({ dateRange: { from: '2026-09-09', to: '2026-09-11' } });
    expect(out.days).toEqual(['2026-09-09::', '2026-09-10:a:', '2026-09-11::']);
  });

  it('treats an incomplete range as no range', () => {
    expect(probe({ dateRange: { from: '2026-09-16' } }).scoped).toBe(false);
  });
});
