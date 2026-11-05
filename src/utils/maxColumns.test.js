import { describe, it, expect } from 'vitest';
import { wouldExceedMaxColumns } from './maxColumns.js';

// The drop rule's column limit: three side-by-side columns at most. #2278: the
// previous night's tasks still running after midnight take a column on the
// next date from 00:00, as the timelines lay them out and as occupancy counts
// them busy, and a drop that runs past midnight is held to the limit there too.

const TUE = '2026-11-03';
const WED = '2026-11-04';
const THU = '2026-11-05';
const task = (id, date, startTime, duration, over = {}) => ({ id, title: id, date, startTime, duration, ...over });
const drop = (tasks, droppedTask, startTime, dropDateStr, recurringTasks = []) => wouldExceedMaxColumns({
  tasks, recurringTasks, droppedTask, startTime, dropDateStr,
});
const mover = task('mover', THU, '12:00', 60);

describe('wouldExceedMaxColumns', () => {
  it('refuses a fourth column among the date\'s own tasks, and allows a third', () => {
    const two = [task('a', WED, '00:00', 60), task('b', WED, '00:00', 60)];
    expect(drop(two, mover, '00:15', WED)).toBe(false);
    expect(drop([...two, task('c', WED, '00:00', 60)], mover, '00:15', WED)).toBe(true);
  });

  it('counts the night before\'s piece after midnight as a column', () => {
    const tasks = [task('night', TUE, '23:00', 120), task('a', WED, '00:00', 60), task('b', WED, '00:00', 60)];
    expect(drop(tasks, mover, '00:15', WED)).toBe(true);
    // Past the piece's end (01:00), the column is free again.
    expect(drop(tasks, mover, '01:00', WED)).toBe(false);
    // A night task that ends at midnight leaves nothing on the next date.
    const toMidnight = [task('night', TUE, '23:00', 60), task('a', WED, '00:00', 60), task('b', WED, '00:00', 60)];
    expect(drop(toMidnight, mover, '00:15', WED)).toBe(false);
  });

  it('counts a recurring occurrence\'s piece, with that night\'s exception', () => {
    const series = {
      id: 'shift', title: 'Shift', startTime: '22:00', duration: 60, isAllDay: false,
      recurrence: { type: 'daily', startDate: '2026-11-01' },
      exceptions: { [TUE]: { startTime: '23:30', duration: 120 } },
    };
    const tasks = [task('a', WED, '00:00', 60), task('b', WED, '00:00', 60)];
    expect(drop(tasks, mover, '00:15', WED, [series])).toBe(true);
    // Without the exception the 22:00-23:00 occurrence never reaches Wednesday.
    expect(drop(tasks, mover, '00:15', WED, [{ ...series, exceptions: {} }])).toBe(false);
  });

  it('does not count the dropped task\'s own piece from its old place', () => {
    const night = task('night', TUE, '23:00', 120);
    const tasks = [night, task('a', WED, '00:00', 60), task('b', WED, '00:00', 60)];
    expect(drop(tasks, night, '00:15', WED)).toBe(false);
  });

  it('holds a drop past midnight to the limit on the next date too', () => {
    const tasks = [task('a', WED, '00:00', 90), task('b', WED, '00:00', 90), task('c', WED, '00:00', 90)];
    expect(drop(tasks, mover, '23:00', TUE)).toBe(false); // 60 minutes: ends at midnight
    expect(drop(tasks, { ...mover, duration: 120 }, '23:00', TUE)).toBe(true);
    expect(drop(tasks, { ...mover, duration: 120 }, '22:00', TUE)).toBe(false);
  });

  it('leaves imported events out, as the timelines lay them out full width', () => {
    const tasks = [
      task('event', TUE, '23:00', 120, { imported: true }),
      task('a', WED, '00:00', 60), task('b', WED, '00:00', 60),
    ];
    expect(drop(tasks, mover, '00:15', WED)).toBe(false);
  });
});
