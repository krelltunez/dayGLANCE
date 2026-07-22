import { describe, it, expect } from 'vitest';
import { parseICS, parseDatetime, filterByDateWindow, expandMultiDayEvent } from './icsParser.js';
import { dateToString } from './taskUtils.js';

const wrap = (body) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR`;

const vevent = (fields) => `BEGIN:VEVENT\r\n${fields.join('\r\n')}\r\nEND:VEVENT`;

describe('parseICS', () => {
  it('parses a basic timed VEVENT', () => {
    const events = parseICS(wrap(vevent([
      'UID:ev-1',
      'SUMMARY:Dentist',
      'DTSTART:20260721T090000',
      'DTEND:20260721T100000',
    ])));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ uid: 'ev-1', summary: 'Dentist', dtstart: '20260721T090000' });
    expect(events[0].isAllDay).toBeUndefined();
  });

  it('unfolds RFC 5545 line continuations and unescapes text', () => {
    const events = parseICS(wrap(vevent([
      'UID:ev-2',
      'SUMMARY:Part one\r\n  and part two\\, with comma\\; and semi\\nnewline',
      'DTSTART;VALUE=DATE:20260721',
    ])));
    expect(events[0].summary).toBe('Part one and part two, with comma; and semi\nnewline');
    expect(events[0].isAllDay).toBe(true);
  });

  it('uses DUE as dtstart for VTODOs without DTSTART', () => {
    const events = parseICS(wrap(
      'BEGIN:VTODO\r\nUID:todo-1\r\nSUMMARY:Pay rent\r\nDUE;VALUE=DATE:20260801\r\nEND:VTODO'
    ));
    expect(events).toHaveLength(1);
    expect(events[0].dtstart).toBe('20260801');
    expect(events[0].isAllDay).toBe(true);
  });

  it('drops cancelled events', () => {
    const events = parseICS(wrap(vevent([
      'UID:ev-3',
      'SUMMARY:Cancelled thing',
      'DTSTART:20260721T090000',
      'STATUS:CANCELLED',
    ])));
    expect(events).toHaveLength(0);
  });

  it('expands a weekly RRULE and honors EXDATE', () => {
    // Weekly on Mondays starting a recent Monday, excluding one occurrence.
    const events = parseICS(wrap(vevent([
      'UID:weekly-1',
      'SUMMARY:Standup',
      'DTSTART:20260706T093000', // a Monday
      'DTEND:20260706T100000',
      'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4',
      'EXDATE:20260713T093000',
    ])));
    const starts = events.map(e => e.dtstart);
    expect(starts).toContain('20260706T093000');
    expect(starts).toContain('20260720T093000');
    expect(starts).not.toContain('20260713T093000');
    // Excluded dates don't consume COUNT in this implementation, so COUNT=4
    // still yields 4 emitted occurrences with the series extending one week.
    expect(events).toHaveLength(4);
    expect(starts).toContain('20260803T093000');
    expect(events.every(e => e.isRecurringSeries)).toBe(true);
  });

  it('suppresses the master slot for a RECURRENCE-ID override and re-emits it at the new time', () => {
    const events = parseICS(wrap([
      vevent([
        'UID:series-1',
        'SUMMARY:Weekly sync',
        'DTSTART:20260706T140000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3',
      ]),
      vevent([
        'UID:series-1',
        'SUMMARY:Weekly sync (moved)',
        'RECURRENCE-ID:20260713T140000',
        'DTSTART:20260714T150000', // moved to Tuesday
      ]),
    ].join('\r\n')));
    const starts = events.map(e => e.dtstart);
    expect(starts).not.toContain('20260713T140000'); // original slot suppressed
    expect(starts).toContain('20260714T150000');     // override re-emitted
    expect(starts).toContain('20260706T140000');
    expect(starts).toContain('20260720T140000');
  });

  it('drops a cancelled RECURRENCE-ID override without re-emitting it', () => {
    const events = parseICS(wrap([
      vevent([
        'UID:series-2',
        'SUMMARY:Weekly sync',
        'DTSTART:20260706T140000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3',
      ]),
      vevent([
        'UID:series-2',
        'SUMMARY:Weekly sync',
        'RECURRENCE-ID:20260713T140000',
        'DTSTART:20260713T140000',
        'STATUS:CANCELLED',
      ]),
    ].join('\r\n')));
    const starts = events.map(e => e.dtstart);
    expect(starts).not.toContain('20260713T140000');
    // The suppressed slot doesn't consume COUNT, so the master emits three
    // occurrences (0706, 0720, 0727) and the cancelled override adds nothing.
    expect(events).toHaveLength(3);
  });

  it('exposes masterUids including series that expand to zero occurrences', () => {
    const events = parseICS(wrap([
      vevent([
        'UID:old-series',
        'SUMMARY:Long past',
        'DTSTART:20200101T090000',
        'RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20200301T000000', // entirely outside the window
      ]),
      vevent(['UID:plain', 'SUMMARY:Plain', 'DTSTART:20260722T090000']),
    ].join('\r\n')));
    expect(events.masterUids.has('old-series')).toBe(true);
    expect(events.masterUids.has('plain')).toBe(true);
    // masterUids must not appear during iteration/serialization
    expect(Object.keys(events)).not.toContain('masterUids');
  });
});

describe('parseDatetime', () => {
  it('parses date-only strings as local midnight', () => {
    const d = parseDatetime('20260721');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 6, 21, 0]);
  });

  it('parses local datetime strings as local time', () => {
    const d = parseDatetime('20260721T093000');
    expect([d.getHours(), d.getMinutes()]).toEqual([9, 30]);
  });

  it('converts Z-suffixed (UTC) datetimes to local time', () => {
    const d = parseDatetime('20260721T120000Z');
    expect(d.getTime()).toBe(Date.UTC(2026, 6, 21, 12, 0));
  });
});

describe('filterByDateWindow', () => {
  const mkTask = (daysAgo) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return { date: dateToString(d) };
  };

  it('keeps everything when retentionDays is 0 or unset', () => {
    const tasks = [mkTask(400), mkTask(0)];
    expect(filterByDateWindow(tasks, 0)).toHaveLength(2);
    expect(filterByDateWindow(tasks, undefined)).toHaveLength(2);
  });

  it('drops tasks older than the retention window', () => {
    const tasks = [mkTask(30), mkTask(5), mkTask(0)];
    const kept = filterByDateWindow(tasks, 7);
    expect(kept).toHaveLength(2);
  });
});

describe('expandMultiDayEvent', () => {
  it('produces a single task for a timed event with real duration', () => {
    const tasks = expandMultiDayEvent({
      uid: 'ev-1', summary: 'Meeting',
      dtstart: '20260721T090000', dtend: '20260721T103000',
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: 'Meeting', startTime: '09:00', duration: 90,
      date: '2026-07-21', imported: true, isAllDay: false,
    });
  });

  it('splits an all-day multi-day event into one task per day with exclusive DTEND', () => {
    const tasks = expandMultiDayEvent({
      uid: 'trip', summary: 'Trip',
      dtstart: '20260721', dtend: '20260724', isAllDay: true,
    });
    expect(tasks).toHaveLength(3);
    expect(tasks.map(t => t.date)).toEqual(['2026-07-21', '2026-07-22', '2026-07-23']);
    expect(tasks[0].title).toBe('Trip (Day 1/3)');
    expect(tasks[2].id).toBe('trip-2026-07-23-day3');
  });

  it('marks task-calendar items complete from freshCompletedUids', () => {
    const tasks = expandMultiDayEvent(
      { uid: 'todo-1', summary: 'Chore', dtstart: '20260721' },
      { asTaskCalendar: true, freshCompletedUids: new Set(['todo-1::2026-07-21']) }
    );
    expect(tasks[0]).toMatchObject({ completed: true, isTaskCalendar: true, color: 'task-calendar', duration: 15 });
  });
});
