// A realistically busy weekday for the month-cell layout, built from raw app
// data and run through agenda-core's own expansion (buildAgenda for tasks,
// recurring instances and calendar events; routinesForDate for routines) so
// the fixture carries exactly the item shapes the month view will receive.
//
// The day, in order:
//   06:30–07:00  Morning run (routine)          — starts before the window
//   07:00–07:30  Breakfast (routine)
//   08:30–09:00  Standup (calendar event)
//   09:00–10:30  Deep work: spec (task)
//   09:30–10:00  1:1 with Sam (calendar event)  — overlaps deep work
//   10:00–10:15  Quick call (task)              — 15 min, overlaps deep work
//   11:00        Dentist reminder (task, no duration) — a point
//   12:00–13:00  Lunch (routine)
//   13:00–14:00  Team meeting (calendar event)
//   13:30–14:30  Review PR (task)               — three-way overlap
//   13:45–14:15  Interview (calendar event)     —   with these two
//   15:00–15:15  Stretch (routine)              — 15 min
//   16:00–17:30  Workshop (weekly recurring task)
//   18:30–19:30  Gym (routine)
//   20:30–22:00  Dinner out (calendar event)    — runs past the window
//   22:30–23:00  Wind down (routine)            — entirely after the window
//   all day      Mom's birthday (calendar event), Submit expense report (task)

import { buildAgenda, routinesForDate } from '@glance-apps/agenda-core';

export const FIXTURE_DATE = '2026-09-16';

export function busyDayData() {
  return {
    tasks: [
      { id: 't-deep', title: 'Deep work: spec', date: FIXTURE_DATE, startTime: '09:00', duration: 90, color: 'bg-blue-500', completed: false },
      { id: 't-call', title: 'Quick call', date: FIXTURE_DATE, startTime: '10:00', duration: 15, color: 'bg-green-500', completed: true },
      { id: 't-dentist', title: 'Dentist reminder', date: FIXTURE_DATE, startTime: '11:00', duration: 0, color: 'bg-red-500', completed: false },
      { id: 't-review', title: 'Review PR', date: FIXTURE_DATE, startTime: '13:30', duration: 60, color: 'bg-purple-500', completed: false },
      { id: 't-expense', title: 'Submit expense report', date: FIXTURE_DATE, isAllDay: true, startTime: '00:00', duration: 0, completed: false },
      { id: 't-other-day', title: 'Not today', date: '2026-09-17', startTime: '09:00', duration: 30, completed: false },
      { id: 'ev-standup', title: 'Standup', date: FIXTURE_DATE, startTime: '08:30', duration: 30, imported: true, completed: false },
      { id: 'ev-1on1', title: '1:1 with Sam', date: FIXTURE_DATE, startTime: '09:30', duration: 30, imported: true, completed: false },
    ],
    recurringTasks: [
      {
        id: 'r-workshop', title: 'Workshop', startTime: '16:00', duration: 90, color: 'bg-amber-500',
        recurrence: { type: 'weekly', interval: 1, startDate: '2026-09-02', daysOfWeek: [3] },
        completedDates: [], exceptions: {},
      },
    ],
    calendarEvents: [
      { id: 'cal-team', title: 'Team meeting', date: FIXTURE_DATE, startTime: '13:00', duration: 60, calendarName: 'Work' },
      { id: 'cal-interview', title: 'Interview', date: FIXTURE_DATE, startTime: '13:45', duration: 30, calendarName: 'Work' },
      { id: 'cal-dinner', title: 'Dinner out', date: FIXTURE_DATE, startTime: '20:30', duration: 90, calendarName: 'Personal' },
      { id: 'cal-bday', title: "Mom's birthday", date: FIXTURE_DATE, isAllDay: true, calendarName: 'Personal' },
    ],
    todayRoutines: [
      { id: 'ro-run', name: 'Morning run', startTime: '06:30', duration: 30 },
      { id: 'ro-breakfast', name: 'Breakfast', startTime: '07:00', duration: 30 },
      { id: 'ro-lunch', name: 'Lunch', startTime: '12:00', duration: 60 },
      { id: 'ro-stretch', name: 'Stretch', startTime: '15:00', duration: 15 },
      { id: 'ro-gym', name: 'Gym', startTime: '18:30', duration: 60 },
      { id: 'ro-wind', name: 'Wind down', startTime: '22:30', duration: 30 },
    ],
    routinesDate: FIXTURE_DATE,
    routineCompletions: { 'ro-run': FIXTURE_DATE },
  };
}

/** The fixture as { agenda: AgendaItem[], routines: RoutineItem[] } for FIXTURE_DATE. */
export function busyDayItems() {
  const data = busyDayData();
  const agenda = buildAgenda(data, { from: FIXTURE_DATE, to: FIXTURE_DATE })[FIXTURE_DATE] || [];
  const routines = routinesForDate(data, FIXTURE_DATE);
  return { agenda, routines };
}
