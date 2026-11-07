import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  buildProjectedDay, buildScheduleSections, projectionDates, serializeWidgetTask,
  guardSnapshotSize, WIDGET_PROJECTION_DAYS, WIDGET_SNAPSHOT_CAP_BYTES, WIDGET_SNAPSHOT_WARN_BYTES,
} from './widgetDayProjection.js';
import { getOccurrencesInRange } from './recurrenceEngine.js';

// Pinned zone: sky and dial are solar/lunar and the fixture day is local.
let prevTZ;
beforeAll(() => { prevTZ = process.env.TZ; process.env.TZ = 'America/Denver'; });
afterAll(() => { if (prevTZ === undefined) delete process.env.TZ; else process.env.TZ = prevTZ; });

const D2 = new Date(2026, 8, 20, 12); // Sun Sep 20 2026 — "today + 2" for a Friday today
const D2_STR = '2026-09-20';
const projectNameFor = (t) => (t.projectId === 'p1' ? 'Platform migration' : '');

const task = (over) => ({
  id: 'a1', title: 'Deep work #deep [[Spec]]', color: 'bg-blue-500', date: D2_STR,
  startTime: '09:00', duration: 60, tags: ['deep'], completed: false, projectId: 'p1', ...over,
});

const build = (over = {}) => buildProjectedDay({
  date: D2, dateStr: D2_STR, dateLabel: 'Sun, Sep 20',
  dayTasks: [
    task(),
    task({ id: 'a2', title: 'Lunch', startTime: '12:00', duration: 45, tags: [], projectId: null, notes: 'secret', subtasks: [{ title: 'x', completed: false }] }),
    task({ id: 'a3', title: 'Birthday', isAllDay: true, startTime: '', duration: 0, tags: [] }),
    task({ id: 'a4', title: 'Done already', startTime: '15:00', duration: 30, completed: true }),
    task({ id: 'ex', title: 'Example', isExample: true }),
  ],
  prevDayTasks: [task({ id: 'p0', title: 'Late show', startTime: '23:00', duration: 120 })],
  deadlineTasks: [{ id: 'dl', title: 'Pay the invoice #money', color: 'bg-red-500', deadline: D2_STR, projectId: 'p1' }],
  frames: [{ frameId: 'f1', label: 'Morning focus', color: 'bg-green-500', start: '08:00', end: '11:00' }],
  frameAvailableMinutes: () => 120,
  dayWindow: { start: '07:00', stop: '23:00' },
  coords: { lat: 39.74, lon: -104.99 },
  goalsDue: [{ id: 'g1', title: 'Ship it', progressPct: 50, totalTasks: 4, completedTasks: 2 }],
  projectNameFor,
  ...over,
});

describe('projectionDates', () => {
  it('yields N consecutive local days after today, at noon', () => {
    const dates = projectionDates(new Date(2026, 8, 18, 23, 59));
    expect(dates.map(d => d.getDate())).toEqual([19, 20, 21]);
    expect(dates.every(d => d.getHours() === 12)).toBe(true);
    expect(dates.length).toBe(WIDGET_PROJECTION_DAYS);
  });

  it('crosses a month boundary and a DST change by the calendar, not by 24h', () => {
    expect(projectionDates(new Date(2026, 9, 31, 12)).map(d => d.toDateString().slice(4, 10)))
      .toEqual(['Nov 01', 'Nov 02', 'Nov 03']);
  });
});

describe('buildProjectedDay', () => {
  it('is keyed by its date and carries the label', () => {
    const day = build();
    expect(day.date).toBe(D2_STR);
    expect(day.dateLabel).toBe('Sun, Sep 20');
  });

  it('keeps per-task tags and project references — the dial hub needs them', () => {
    const day = build();
    const rows = day.sections.flatMap(s => s.tasks);
    const deep = rows.find(r => r.id === 'a1');
    expect(deep.tags).toEqual(['deep']);
    expect(deep.projectName).toBe('Platform migration');
    expect(deep.title).toBe('Deep work');            // wikilink and #tag stripped from the title
    const deepNext = [day.nextTask, ...day.upcomingTasks].find(r => r.id === 'a1');
    expect(deepNext.tags).toEqual(['deep']);
    expect(deepNext.projectName).toBe('Platform migration');
    expect(day.dial.blocks.find(b => b.id === 'a1').tag).toBe('deep');
    expect(day.deadlines[0].projectName).toBe('Platform migration');
  });

  it('trims today-only richness: no notes or subtasks on the next task', () => {
    const day = build();
    expect(day.nextTask).not.toHaveProperty('notes');
    expect(day.nextTask).not.toHaveProperty('subtasks');
    const lunch = day.upcomingTasks.find(t => t.id === 'a2');
    expect(lunch).not.toHaveProperty('notes');
  });

  it('carries no state that cannot exist yet: no habits, routines, overdue, hyperGLANCE, GLANCEahead, summary', () => {
    const day = build();
    for (const k of ['habits', 'routines', 'overdue', 'overdueToday', 'hyperGlance', 'glanceAhead', 'daySummary', 'nextUpNext', 'steps']) {
      expect(day, k).not.toHaveProperty(k);
    }
    // The dial is built without routines on purpose: chips are placed per day.
    expect(day.dial.blocks.some(b => b.type === 'routine')).toBe(false);
  });

  it('partitions like todayAgenda at the start of a day: all-day excludes completed, timed keeps everything', () => {
    const day = build();
    expect(day.allDay.map(a => a.id)).toEqual(['a3']);
    const timedIds = day.sections.flatMap(s => s.tasks).map(t => t.id);
    // The day before's Late show (23:00, two hours) opens the day (#2278);
    // completed a4 is still on the schedule.
    expect(timedIds).toEqual(['p0', 'a1', 'a2', 'a4']);
    expect(timedIds).not.toContain('ex');           // examples never ship
  });

  it('Up Next is the whole incomplete timed list in order, uncapped, first split out', () => {
    const day = build();
    expect(day.nextTask.id).toBe('p0');                             // the night before's, still running
    expect(day.upcomingTasks.map(t => t.id)).toEqual(['a1', 'a2']);  // a4 is completed
  });

  it('frames: a task inside the frame goes under it, the rest unframed', () => {
    const day = build();
    expect(day.sections.map(s => s.type)).toEqual(['unframed', 'frame', 'unframed']);
    expect(day.sections[0].tasks.map(t => t.id)).toEqual(['p0']);  // 00:00, before the frame
    expect(day.sections[1].tasks.map(t => t.id)).toEqual(['a1']);
    expect(day.sections[1].availableMinutes).toBe(120);
    expect(day.sections[2].tasks.map(t => t.id)).toEqual(['a2', 'a4']);
  });

  it('sky and dial are built for THAT day, with the overnight carry from the day before', () => {
    const day = build();
    expect(day.sky.hours).toHaveLength(24);
    expect(day.dial.date).toBe(D2_STR);
    const carried = day.dial.blocks.find(b => b.id === 'p0');
    expect(carried.startedPrevDay).toBe(true);
    expect(carried.startMin).toBe(0);
    expect(day.dial.blocks.filter(b => b.type === 'sleep')).toHaveLength(2);
  });

  // #2278: the night before's task still running after midnight. The widget
  // switches to this day at midnight with the app closed and promotes Up Next
  // by the clock through start + duration on the day's clock, so the piece has
  // to be in the list as 00:00 for the minutes it runs into the day.
  it('the night before’s task still running opens Up Next and the list, as its piece from 00:00', () => {
    const day = build();
    expect(day.nextTask).toMatchObject({ id: 'p0', title: 'Late show', startTime: '00:00', duration: 60 });
    expect(day.sections[0].tasks[0]).toMatchObject({ id: 'p0', startTime: '00:00', duration: 60 });
    // Only a task that crosses midnight, not done, not an example.
    const other = build({ prevDayTasks: [
      task({ id: 'evening', startTime: '20:00', duration: 60 }),
      task({ id: 'to-midnight', startTime: '23:00', duration: 60 }),
      task({ id: 'done', startTime: '23:00', duration: 120, completed: true }),
      task({ id: 'example', startTime: '23:00', duration: 120, isExample: true }),
    ] });
    expect(other.nextTask.id).toBe('a1');
    expect(other.sections.flatMap(s => s.tasks).map(t => t.id)).toEqual(['done', 'a1', 'a2', 'a4']);
  });

  it('no coords → no sky, and an empty day is still a complete, honest object', () => {
    const day = build({ coords: null, dayTasks: [], prevDayTasks: [], deadlineTasks: [], frames: [], goalsDue: [] });
    expect(day.sky).toBeNull();
    expect(day.nextTask).toBeNull();
    expect(day.upcomingTasks).toEqual([]);
    expect(day.sections).toEqual([]);
    expect(day.dial.blocks.filter(b => b.type !== 'sleep')).toEqual([]);
  });

  // The recurring-expansion finding: a recurring instance for today+2 is an
  // ordinary member of that day's task list, and the builder ships it like any
  // other block. Whether it IS in that list is the expansion range's job
  // (recurringExpansionRange.js), tested there.
  it('a recurring instance on today+2, expanded by the recurrence engine, lands in sections, Up Next and the dial', () => {
    const template = { id: 'r1', title: 'Standup #team', startTime: '09:30', duration: 15, color: 'bg-purple-500', tags: ['team'],
      recurrence: { type: 'daily', startDate: '2026-09-01' } };
    const occurrences = getOccurrencesInRange(template, D2_STR, D2_STR);
    expect(occurrences).toEqual([D2_STR]);
    const instance = { id: `recurring-${template.id}-${D2_STR}`, title: template.title, startTime: template.startTime,
      duration: template.duration, color: template.color, tags: template.tags, completed: false, isAllDay: false,
      date: D2_STR, isRecurring: true, recurringTemplateId: template.id };
    const day = build({ dayTasks: [task(), instance] });
    expect(day.sections.flatMap(s => s.tasks).map(t => t.id)).toContain(instance.id);
    expect(day.upcomingTasks.map(t => t.id)).toContain(instance.id);
    expect(day.dial.blocks.find(b => b.id === instance.id)?.tag).toBe('team');
  });
});

describe('buildScheduleSections', () => {
  const ser = (t) => serializeWidgetTask(t, () => '');
  it('a task before the first frame is an unframed section ahead of it', () => {
    const sections = buildScheduleSections({
      scheduled: [task({ id: 'early', startTime: '07:00' }), task({ id: 'in', startTime: '09:00' })],
      frames: [{ frameId: 'f', label: 'F', color: 'bg-blue-500', start: '08:00', end: '11:00' }],
      frameAvailableMinutes: () => 0,
      serialize: ser,
    });
    expect(sections.map(s => [s.type, s.tasks.map(t => t.id)])).toEqual([['unframed', ['early']], ['frame', ['in']]]);
  });

  it('an empty frame with no free time is omitted', () => {
    const sections = buildScheduleSections({
      scheduled: [], frames: [{ frameId: 'f', label: 'F', color: 'x', start: '08:00', end: '11:00' }],
      frameAvailableMinutes: () => 0, serialize: ser,
    });
    expect(sections).toEqual([]);
  });
});

describe('guardSnapshotSize', () => {
  const quiet = { warn: () => {}, error: () => {} };
  it('passes a normal snapshot through untouched', () => {
    const r = guardSnapshotSize({ date: 'x', days: [{ date: 'y' }] }, { log: quiet });
    expect(r.dropped).toBe(false);
    expect(JSON.parse(r.json).days).toHaveLength(1);
  });

  it('warns past the warning line, still sends everything', () => {
    const calls = [];
    const r = guardSnapshotSize({ date: 'x', pad: 'a'.repeat(50), days: [] }, { warn: 40, cap: 1000, log: { warn: (m) => calls.push(m), error: () => {} } });
    expect(calls).toHaveLength(1);
    expect(r.dropped).toBe(false);
  });

  it('over the cap, drops the projected days loudly and keeps today', () => {
    const calls = [];
    const r = guardSnapshotSize({ date: 'x', days: [{ pad: 'a'.repeat(200) }] }, { cap: 100, warn: 50, log: { warn: () => {}, error: (m) => calls.push(m) } });
    expect(calls).toHaveLength(1);
    expect(r.dropped).toBe(true);
    expect(JSON.parse(r.json)).toEqual({ date: 'x' });
  });

  it('the constants match the native cap and leave a signal before it', () => {
    expect(WIDGET_SNAPSHOT_CAP_BYTES).toBe(400_000);
    expect(WIDGET_SNAPSHOT_WARN_BYTES).toBeLessThan(WIDGET_SNAPSHOT_CAP_BYTES);
  });
});

describe('guardSnapshotSize: ids', () => {
  it('sends every id as a string, however deep, and leaves other numbers alone', () => {
    const { json } = guardSnapshotSize({
      nextTask: { id: 42, duration: 30 },
      allProjects: [{ id: 7, tasks: [{ id: 8, title: 'x' }], progressPct: 50 }],
      habits: [{ id: 'h1' }],
    });
    const out = JSON.parse(json);
    expect(out.nextTask).toEqual({ id: '42', duration: 30 });
    expect(out.allProjects[0].id).toBe('7');
    expect(out.allProjects[0].tasks[0].id).toBe('8');
    expect(out.allProjects[0].progressPct).toBe(50);
    expect(out.habits[0].id).toBe('h1');
  });
});
