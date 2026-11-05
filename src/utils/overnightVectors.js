// Test vectors for the overnight carry rule (#2278), as data.
//
// agenda-core's overnight.js is the authority on what a timed task that runs
// past midnight leaves on the next date: the timelines, the Day Dial,
// occupancy, the overdue list and the MCP read model all derive it there. The
// GLANCElauncher (a separate repo, krelltunez/dayGLANCE-launcher) draws its
// own dial and timeline from the launcher snapshot's plain task rows
// (launcherSnapshot.js, docs/launcher-integration.md "Tasks that run past
// midnight"), so it implements the same rule natively. This module evaluates
// a curated set of rows through the real functions and serialises them to
// dayglance-ios/TestFixtures/overnight.vectors.json, so a port is checked
// against the numbers the app itself produces.
//
// Inputs are snapshot task rows (`taskRow` in launcherSnapshot.js: date,
// startTime, duration, isAllDay, completed, recurringId, native). The file is
// committed, and overnightVectors.test.js fails when it drifts from what this
// module now produces. Refresh with `npm run ios:vectors`.

import {
  continuationsFromPreviousDay, overnightSpillMinutes, taskEnd, computeAvailableSlots, shiftDateStr,
} from '@glance-apps/agenda-core';

export const OVERNIGHT_VECTORS_PATH = 'dayglance-ios/TestFixtures/overnight.vectors.json';
export const OVERNIGHT_VECTORS_FORMAT = 'overnight.vectors/1';

const MON = '2026-11-02';
const TUE = '2026-11-03';

// A snapshot task row, with only the fields the rule reads varying.
const row = (over = {}) => ({
  id: 't1', title: 'Task', date: MON, startTime: '23:00', duration: 120, isAllDay: false,
  completed: false, recurringId: null, native: false, ...over,
});

// Each row on its own: how many minutes it leaves on the next date, and where
// it really ends.
const SPILL_CASES = [
  { name: 'crosses midnight: the minutes past 24:00 carry', row: row() },
  { name: 'ends exactly at 24:00: carries nothing', row: row({ duration: 60 }) },
  { name: 'ends before midnight', row: row({ startTime: '09:00', duration: 60 }) },
  { name: 'starts at 23:45, 30 minutes', row: row({ startTime: '23:45', duration: 30 }) },
  { name: 'the longest a user task can be: 24 hours from 22:00', row: row({ startTime: '22:00', duration: 1440 }) },
  { name: 'an imported event longer than a day is clipped at the next date\'s end', row: row({ startTime: '23:30', duration: 2000, native: true }) },
  { name: 'all-day: never carries', row: row({ isAllDay: true, startTime: null, duration: 0 }) },
  { name: 'no start time: never carries', row: row({ startTime: null }) },
  { name: 'no duration: never carries', row: row({ duration: 0 }) },
  { name: 'completed still carries (shown completed)', row: row({ completed: true }) },
  { name: 'seconds in the start time are ignored', row: row({ startTime: '23:00:30' }) },
  { name: 'a year end', row: row({ date: '2026-12-31', startTime: '23:30', duration: 90 }) },
];

// A date's continuations from the previous date's rows, in row order.
const CONTINUATION_CASES = [
  {
    name: 'the previous date\'s rows: only the ones past midnight carry, each the task itself',
    prevDayRows: [
      row({ id: 'night', title: 'Night shift' }),
      row({ id: 'to-midnight', startTime: '23:00', duration: 60 }),
      row({ id: 'morning', startTime: '09:00', duration: 30 }),
      row({ id: `recurring-backup-${MON}`, title: 'Backup', startTime: '23:45', duration: 45, recurringId: 'backup' }),
      row({ id: 'native-cal-7-2026-11-02', title: 'Flight', startTime: '22:30', duration: 300, native: true }),
      row({ id: 'all-day', isAllDay: true, startTime: null, duration: 0 }),
    ],
  },
  { name: 'no rows: nothing', prevDayRows: [] },
];

// A frame's free time on the next date: busy from 00:00 to each piece's end.
// `slots` is what the snapshot ships in frames[].slots (computeAvailableSlots,
// no now floor).
const FRAME_CASES = [
  {
    name: 'a piece holds the frame from 00:00',
    frame: { start: '00:00', end: '03:00', bufferMinutes: 0 },
    prevDayRows: [row({ startTime: '23:00', duration: 120 })],
    dayRows: [],
  },
  {
    name: 'a piece and the date\'s own task, with a buffer',
    frame: { start: '00:00', end: '04:00', bufferMinutes: 10 },
    prevDayRows: [row({ startTime: '23:00', duration: 90 })],
    dayRows: [row({ id: 't2', date: TUE, startTime: '02:00', duration: 30 })],
  },
  {
    name: 'a task ending at midnight leaves the frame free',
    frame: { start: '00:00', end: '02:00', bufferMinutes: 0 },
    prevDayRows: [row({ startTime: '23:00', duration: 60 })],
    dayRows: [],
  },
  {
    name: 'a frame that starts after the piece ends is untouched',
    frame: { start: '06:00', end: '08:00', bufferMinutes: 0 },
    prevDayRows: [row({ startTime: '22:00', duration: 420 })],
    dayRows: [],
  },
];

export function buildOvernightVectors() {
  return {
    format: OVERNIGHT_VECTORS_FORMAT,
    description: 'The overnight carry rule (#2278, agenda-core overnight.js) evaluated over launcher snapshot task rows. '
      + 'docs/launcher-integration.md "Tasks that run past midnight" states the rule; these are its numbers.',
    spill: {
      description: 'overnightSpillMinutes: the minutes a row leaves on the next date (0: none). '
        + 'end: taskEnd, where the row really ends ({ date, minutes } since that date\'s midnight; null when all-day). '
        + 'taskEnd is the overdue rule\'s: a missing start reads as 00:00 and a missing duration as 30 minutes.',
      cases: SPILL_CASES.map(({ name, row: r }) => ({
        name,
        input: r,
        expected: { spillMinutes: overnightSpillMinutes(r), end: taskEnd(r) },
      })),
    },
    continuations: {
      description: 'continuationsFromPreviousDay: the pieces the previous date\'s rows leave on the next date, '
        + 'in row order, each [startMinutes, endMinutes) from 00:00, naming the task by id and the date it started.',
      cases: CONTINUATION_CASES.map(({ name, prevDayRows }) => ({
        name,
        input: { prevDayRows },
        expected: continuationsFromPreviousDay(prevDayRows).map((c) => ({
          id: c.task.id, fromDate: c.fromDate, startMinutes: c.startMinutes, endMinutes: c.endMinutes, minutes: c.minutes,
        })),
      })),
    },
    frameSlots: {
      description: 'computeAvailableSlots with prevDayTasks, no routines and no now floor: a frame\'s free time on the next date, '
        + 'as the snapshot ships it in frames[].slots.',
      cases: FRAME_CASES.map(({ name, frame, prevDayRows, dayRows }) => {
        const dateStr = shiftDateStr(prevDayRows[0]?.date ?? MON, 1);
        return {
          name,
          input: { date: dateStr, frame, prevDayRows, dayRows },
          expected: computeAvailableSlots(frame, {
            tasks: dayRows, prevDayTasks: prevDayRows, dateStr, todayStr: dateStr, nowMinutes: 0,
          }).map(({ start, end }) => ({ start, end })),
        };
      }),
    },
  };
}
