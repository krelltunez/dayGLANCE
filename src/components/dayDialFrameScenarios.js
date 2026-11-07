// The Day Dial's frame preview scenarios (docs/day-dial-frames-spec.html):
// the spec's own day at 17:18, as tasks and frame instances the dial takes.
// Shared by DayDial.frames.test.jsx; the iOS and Android previews draw the
// same four from their own fixtures.
import { frameInstancesForDate, computeAvailableSlots } from '@glance-apps/agenda-core';

export const SCENARIO_DATE = '2026-09-26';
export const SCENARIO_NOW = 17 * 60 + 18;
export const SCENARIO_WINDOW = { start: '06:30', stop: '22:30' };

const task = (id, title, startTime, duration, color, over = {}) => ({
  id, title, startTime, duration, color, date: SCENARIO_DATE, isAllDay: false, completed: false, ...over,
});

const BASE = [
  task('a', 'Inbox zero', '09:00', 60, 'bg-blue-500', { completed: true }),
  task('b', 'Spec review', '10:00', 60, 'bg-purple-500', { completed: true }),
  task('c', 'Design sync', '11:30', 60, 'bg-blue-600', { imported: true }),
  task('d', 'Invoices', '14:30', 60, 'bg-green-500', { completed: true }),
  task('e', 'Expenses', '15:30', 75, 'bg-yellow-500', { completed: true }),
  task('f', 'Dinner', '19:45', 60, 'bg-pink-500'),
  task('g', 'Read', '20:45', 45, 'bg-blue-500'),
];
const RUNNING = task('r', 'Monthly budget review #finance', '17:00', 90, 'bg-green-500');

const frameDef = (id, label, color, start, end) => ({
  id, label, color, start, end, days: [], singleDate: SCENARIO_DATE, enabled: true, bufferMinutes: 5,
});

const FRAMES = {
  disjoint: [
    frameDef('deep', 'Deep work', 'bg-blue-200', '09:00', '12:30'),
    frameDef('admin', 'Admin', 'bg-amber-200', '14:00', '17:45'),
    frameDef('evening', 'Evening', 'bg-rose-200', '19:30', '22:10'),
  ],
  nested: [
    frameDef('workday', 'Work day', 'bg-blue-200', '09:00', '17:45'),
    frameDef('focus', 'Focus', 'bg-green-200', '10:00', '12:30'),
    frameDef('evening', 'Evening', 'bg-rose-200', '19:30', '22:10'),
  ],
  empty: [frameDef('reading', 'Reading', 'bg-teal-200', '17:00', '18:30')],
};

/** Frame instances with their unfloored slots, as App.jsx's dialFramesForDate. */
// The scenario frames belong to no set, so the set list is empty (#2305).
const framesFor = (defs, tasks) => frameInstancesForDate(defs, SCENARIO_DATE, { frameSets: [] }).map((f) => ({
  ...f,
  slots: computeAvailableSlots(f, { tasks, dateStr: SCENARIO_DATE, todayStr: SCENARIO_DATE, nowMinutes: 0 }),
}));

const scenario = (title, tasks, frameDefs) => ({ title, dayTasks: tasks, frames: framesFor(frameDefs, tasks) });

export const FRAME_SCENARIOS = {
  running: scenario('Task running, with frames', [...BASE, RUNNING], FRAMES.disjoint),
  frameRows: scenario('Nothing running: the frame rows', BASE, FRAMES.disjoint),
  nested: scenario('Nested frames', BASE, FRAMES.nested),
  empty: scenario('A frame at 0 %', [], FRAMES.empty),
};
