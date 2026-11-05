import { describe, it, expect } from 'vitest';
import { createDoRecord } from './core.js';
import { buildPastDayIndex, pastDayDisplay } from './pastDay.js';
import { continuationsForDate } from '../utils/continuations.js';
import { dateToString } from '../utils/taskUtils.js';

// #2278, phase 1 gaps: a past night's task that ran past midnight, as the
// timelines carry it (App.jsx getContinuationsForDate, which is
// continuationsForDate over the past-day display). On a past day a completed
// task's plan block gives way to its recorded Do (slice 6); its piece after
// midnight gives way with it, and the Do's own slice is what the next date
// draws. An unfinished task keeps its block, so its piece still carries.
// JOBO's Plan side reads the plan as it stood (asPlanned).

const TUE = '2026-11-03';
const WED = '2026-11-04';
const TODAY = '2026-11-10';
const stamp = '2026-11-04T02:00:00-05:00';
const night = (over = {}) => ({ id: 'night', title: 'Night shift', date: TUE, startTime: '23:00', duration: 120, color: 'bg-blue-500', ...over });
const record = (over = {}) => createDoRecord({
  id: 'manual:night', taskId: 'night', title: 'Night shift', source: 'manual', progress: 'completed',
  timing: 'timed', date: TUE, startTime: '23:00', endDate: WED, endTime: '01:30', planSnapshot: null,
  createdAt: stamp, updatedAt: stamp, observedAt: stamp, ...over,
});

// The app's two reads, over one fixture: the plan, and the date as shown.
function reads(tasks, records) {
  const readPlanned = (date) => tasks.filter((t) => t.date === dateToString(date));
  const index = buildPastDayIndex({ records, taskLookup: tasks });
  const readShown = (date) => pastDayDisplay({ dateStr: dateToString(date), todayStr: TODAY, dayTasks: readPlanned(date), index });
  return { readPlanned, readShown };
}
const wednesday = new Date(`${WED}T12:00:00`);
const pieces = (tasks, records, opts = {}) => continuationsForDate(wednesday, { ...reads(tasks, records), ...opts })
  .map((c) => [c.task.id, c.minutes]);

describe('the piece after midnight on a past day (#2278)', () => {
  it('a completed task whose block gave way to its Do carries no piece; the Do\'s slice is drawn instead', () => {
    const tasks = [night({ completed: true })];
    expect(pieces(tasks, [record()])).toEqual([]);
    // Wednesday draws the Do's own slice, from 00:00 to 01:30.
    expect(reads(tasks, [record()]).readShown(wednesday).map((t) => [t.id, t.startTime, t.duration]))
      .toEqual([[`jobo-do:manual:night:${WED}`, '00:00', 90]]);
  });

  it('JOBO\'s Plan side still carries the plan as it stood', () => {
    expect(pieces([night({ completed: true })], [record()], { asPlanned: true })).toEqual([['night', 60]]);
  });

  it('an unfinished task keeps its block, and its piece still carries', () => {
    expect(pieces([night({ completed: false })], [record({ progress: 'partial' })])).toEqual([['night', 60]]);
  });

  it('a completed task with no Do recorded carries as planned', () => {
    expect(pieces([night({ completed: true })], [])).toEqual([['night', 60]]);
  });
});
