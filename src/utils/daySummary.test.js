import { describe, it, expect } from 'vitest';
import { computeDaySummary, formatMinutes } from './daySummary.js';

// Minimal timeline block; tags live in the title as #hashtags, exactly as the
// timeline stores them.
const block = (startTime, duration, title = 'Untitled', extra = {}) => ({
  startTime, duration, title, ...extra,
});

describe('formatMinutes', () => {
  it('formats durations, not clock times', () => {
    expect(formatMinutes(0)).toBe('0m');
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(60)).toBe('1h');
    expect(formatMinutes(135)).toBe('2h 15m');
  });

  it('never renders a negative duration', () => {
    expect(formatMinutes(-30)).toBe('0m');
  });
});

describe('computeDaySummary — scope rules', () => {
  it('returns null unblocked time when there are no timed blocks', () => {
    // null, not 0: with nothing on the timeline there is no window to measure,
    // and rendering "0m unblocked" would claim a fully-booked day.
    const s = computeDaySummary([block(null, 60, '#work no start'), { title: 'allday', isAllDay: true, startTime: '09:00', duration: 60 }]);
    expect(s.unblockedMinutes).toBeNull();
    expect(s.categories).toEqual([]);
  });

  it('excludes all-day events and start-less blocks, includes native events', () => {
    const s = computeDaySummary([
      block('09:00', 60, 'Standup #work'),
      { title: 'Conference', isAllDay: true, startTime: '00:00', duration: 1440 },
      block('10:00', 30, 'Dentist', { _native: true, nativeCalendarColor: '#ff0000' }),
    ]);
    // All-day contributes nothing; the native event blocks real time.
    expect(s.blockedMinutes).toBe(90);
  });

  it('counts completed blocks — completing a meeting does not un-spend the hour', () => {
    const s = computeDaySummary([block('09:00', 60, '#work', { completed: true })]);
    expect(s.categories).toEqual([{
      tag: 'work', minutes: 60, colorHex: '#3b82f6',
      doneMinutes: 60, completableMinutes: 60,
    }]);
    expect(s.blockedMinutes).toBe(60);
  });
});

describe('computeDaySummary — category totals', () => {
  it('sums minutes per tag and sorts by minutes descending', () => {
    const s = computeDaySummary([
      block('09:00', 60, 'Standup #work'),
      block('10:00', 90, 'Deep block #work'),
      block('12:00', 30, 'Lunch walk #health'),
    ]);
    expect(s.categories.map((c) => [c.tag, c.minutes])).toEqual([
      ['work', 150],
      ['health', 30],
    ]);
  });

  it('a multi-tag block contributes its full duration to every tag (per-label sums, not a partition)', () => {
    const s = computeDaySummary([block('09:00', 60, '#work #deep')]);
    expect(s.categories.map((c) => [c.tag, c.minutes])).toEqual([
      ['deep', 60],
      ['work', 60],
    ]);
    // ...while blocked time counts the hour once.
    expect(s.blockedMinutes).toBe(60);
  });

  it('buckets tagless blocks as untagged so the strip total matches the visible day', () => {
    const s = computeDaySummary([
      block('09:00', 60, '#work'),
      block('10:00', 45, 'errands, no tag'),
    ]);
    expect(s.untaggedMinutes).toBe(45);
  });

  it('gives each tag the color of its dominant block, by minutes', () => {
    // No tag→color mapping exists in the data model — color is per-block — so a
    // tag spanning differently-colored blocks takes the color it mostly wears.
    const s = computeDaySummary([
      block('09:00', 30, '#work', { color: 'bg-red-500' }),
      block('10:00', 90, '#work', { color: 'bg-blue-500' }),
    ]);
    expect(s.categories[0].colorHex).not.toBe(undefined);
    expect(s.categories[0].colorHex).toBe(computeDaySummary([block('10:00', 90, '#work', { color: 'bg-blue-500' })]).categories[0].colorHex);
  });

  it('native calendar color wins for native blocks', () => {
    const s = computeDaySummary([block('09:00', 60, '#cal', { nativeCalendarColor: '#00ff00' })]);
    expect(s.categories[0].colorHex).toBe('#00ff00');
  });
});

describe('computeDaySummary — unblocked time', () => {
  it('measures gaps between blocks when no end-of-day is configured', () => {
    // 09:00–10:00, gap to 11:30, 11:30–12:00 → window 09:00–12:00, 90m blocked.
    const s = computeDaySummary([
      block('09:00', 60, 'a'),
      block('11:30', 30, 'b'),
    ]);
    expect(s.windowStartMin).toBe(9 * 60);
    expect(s.windowEndMin).toBe(12 * 60);
    expect(s.blockedMinutes).toBe(90);
    expect(s.unblockedMinutes).toBe(90);
  });

  it('overlapping blocks never double-count blocked time', () => {
    // 09:00–10:30 and 10:00–11:00 overlap by 30m: union is 2h, not 2h 30m.
    const s = computeDaySummary([
      block('09:00', 90, 'a'),
      block('10:00', 60, 'b'),
    ]);
    expect(s.blockedMinutes).toBe(120);
    expect(s.unblockedMinutes).toBe(0);
  });

  it('back-to-back blocks leave no phantom gap', () => {
    const s = computeDaySummary([
      block('09:00', 60, 'a'),
      block('10:00', 60, 'b'),
    ]);
    expect(s.unblockedMinutes).toBe(0);
  });

  it('extends the window to the configured end-of-day', () => {
    // Last block ends 10:00; end-of-day 22:00 → 12h of unblocked afternoon/evening.
    const s = computeDaySummary([block('09:00', 60, 'a')], '22:00');
    expect(s.windowEndMin).toBe(22 * 60);
    expect(s.unblockedMinutes).toBe(12 * 60);
  });

  it('a block running past end-of-day extends the window instead of going negative', () => {
    const s = computeDaySummary([block('21:00', 120, 'late')], '22:00');
    expect(s.windowEndMin).toBe(23 * 60);
    expect(s.unblockedMinutes).toBe(0);
  });
});

describe('computeDaySummary — planned vs done', () => {
  it('sums done minutes per category from completion state', () => {
    const s = computeDaySummary([
      block('09:00', 90, 'Deep block #work', { completed: true }),
      block('11:00', 60, 'Emails #work'),
      block('12:00', 30, 'Walk #health', { completed: true }),
    ]);
    const work = s.categories.find((c) => c.tag === 'work');
    expect(work.doneMinutes).toBe(90);
    expect(work.completableMinutes).toBe(150);
    expect(s.doneMinutes).toBe(120);
    expect(s.completableMinutes).toBe(180);
  });

  it('read-only calendar events are fixtures: excluded from BOTH sides of the metric', () => {
    // A native event can never be completed; counting it would permanently
    // depress the done fraction. It still counts toward the category total.
    const s = computeDaySummary([
      block('09:00', 60, 'Standup #work', { imported: true, _native: true }),
      block('10:00', 60, 'Prep #work', { completed: true }),
    ]);
    const work = s.categories.find((c) => c.tag === 'work');
    expect(work.minutes).toBe(120);           // total keeps the fixture
    expect(work.completableMinutes).toBe(60); // the metric does not
    expect(work.doneMinutes).toBe(60);
    expect(s.completableMinutes).toBe(60);
  });

  it('task-calendar to-dos CAN complete, so they are in the metric', () => {
    const s = computeDaySummary([
      block('09:00', 30, 'Errand', { imported: true, isTaskCalendar: true, completed: true }),
    ]);
    expect(s.doneMinutes).toBe(30);
    expect(s.completableMinutes).toBe(30);
  });

  it('tracks the untagged bucket with the same rules', () => {
    const s = computeDaySummary([
      block('09:00', 45, 'errands', { completed: true }),
      block('10:00', 30, 'more errands'),
      block('11:00', 60, 'Dentist', { imported: true, _native: true }),
    ]);
    expect(s.untaggedMinutes).toBe(135);
    expect(s.untaggedDoneMinutes).toBe(45);
    expect(s.untaggedCompletableMinutes).toBe(75);
  });

  it('a day with nothing done reports zero done, full completable', () => {
    const s = computeDaySummary([block('09:00', 60, '#work')]);
    expect(s.doneMinutes).toBe(0);
    expect(s.completableMinutes).toBe(60);
  });
});

describe('computeDaySummary — energy axis', () => {
  it('partitions block minutes into effort and restore', () => {
    const s = computeDaySummary([
      block('09:00', 120, 'Deep work #work'),
      block('12:00', 45, 'Lunch'),
      block('17:00', 60, 'Evening run'),
    ]);
    expect(s.effortMinutes).toBe(120);
    expect(s.restoreMinutes).toBe(105);
    // A partition: every timed block lands on exactly one side.
    expect(s.effortMinutes + s.restoreMinutes).toBe(225);
  });

  it('honors the per-block override over the derived default', () => {
    const s = computeDaySummary([
      block('12:00', 60, 'Lunch with investors', { energy: 'effort' }),
    ]);
    expect(s.effortMinutes).toBe(60);
    expect(s.restoreMinutes).toBe(0);
  });

  it('reports zeros for an empty day', () => {
    const s = computeDaySummary([], null, { start: '08:00', stop: '22:00' });
    expect(s.effortMinutes).toBe(0);
    expect(s.restoreMinutes).toBe(0);
  });
});

describe('computeDaySummary — START/STOP day-window markers', () => {
  it('the start marker opens the window before the first block, so morning slack counts', () => {
    // Day starts 07:00, first block 09:00–10:00 → 2h of morning now count.
    const s = computeDaySummary([block('09:00', 60, 'a')], null, { start: '07:00', stop: null });
    expect(s.windowStartMin).toBe(7 * 60);
    expect(s.unblockedMinutes).toBe(2 * 60);
  });

  it('the stop marker bounds the evening', () => {
    const s = computeDaySummary([block('09:00', 60, 'a')], null, { start: null, stop: '21:00' });
    expect(s.windowEndMin).toBe(21 * 60);
    expect(s.unblockedMinutes).toBe(11 * 60);
  });

  it('the stop marker supersedes the list-view end-of-day setting', () => {
    // Markers are an explicit per-day declaration; endOfDayTime is a borrowed
    // list-view global. When both exist the marker wins.
    const s = computeDaySummary([block('09:00', 60, 'a')], '23:00', { start: null, stop: '21:00' });
    expect(s.windowEndMin).toBe(21 * 60);
  });

  it('a block outside the markers extends the window rather than going negative', () => {
    // 6am run with a 07:00 start marker: same clamp rule as past-end-of-day.
    const s = computeDaySummary(
      [block('06:00', 60, 'run'), block('09:00', 60, 'work')],
      null,
      { start: '07:00', stop: '10:30' },
    );
    expect(s.windowStartMin).toBe(6 * 60);
    expect(s.blockedMinutes).toBe(120);
    expect(s.unblockedMinutes).toBe(4.5 * 60 - 120);
  });

  it('an empty day with both markers reports the whole window as unblocked', () => {
    // Markers make an empty day measurable — the strip can finally render for
    // a day with nothing scheduled yet.
    const s = computeDaySummary([], null, { start: '08:00', stop: '22:00' });
    expect(s.unblockedMinutes).toBe(14 * 60);
    expect(s.windowStartMin).toBe(8 * 60);
    expect(s.windowEndMin).toBe(22 * 60);
  });

  it('an empty day with only one marker still reports null', () => {
    expect(computeDaySummary([], null, { start: '08:00', stop: null }).unblockedMinutes).toBeNull();
    expect(computeDaySummary([], null, { start: null, stop: '22:00' }).unblockedMinutes).toBeNull();
  });

  it('an inverted empty-day window (stop before start) reports null rather than negative', () => {
    expect(computeDaySummary([], null, { start: '22:00', stop: '08:00' }).unblockedMinutes).toBeNull();
  });
});
