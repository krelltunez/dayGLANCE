import { describe, it, expect } from 'vitest';
import {
  calendarFilterDates, countHiddenOnDates, isHiddenByProject, liveHiddenProjectIds,
  makeCalendarFilter, passesTagFilter, readHiddenProjects, HIDDEN_PROJECTS_KEY,
} from './calendarFilter.js';
import { recurringTaskInstance } from './expandRecurringTasks.js';

// The calendar filter (#2307): the tag filter and Hide projects, per device,
// view-only. The scheduling side of the line is held in useDayReads.test.js.

const DATE = '2026-11-09';
const task = (id, extra = {}) => ({ id, title: id, date: DATE, startTime: '10:00', duration: 60, ...extra });
const projects = [
  { id: 'household', title: 'Household' },
  { id: 'work', title: 'Work' },
  { id: 'old', title: 'Old', status: 'archived' },
  { id: 'done', title: 'Done', status: 'completed' },
  { id: 7, title: 'Numeric id' },
];
const ids = (list) => list.map((t) => t.id);

describe('liveHiddenProjectIds: stale ids are ignored, never pruned', () => {
  it('keeps the ids of active projects', () => {
    expect([...liveHiddenProjectIds(['household'], projects)]).toEqual(['household']);
  });

  it('ignores an archived, completed, deleted or unknown project', () => {
    const saved = ['old', 'done', 'deleted-long-ago', 'household'];
    expect([...liveHiddenProjectIds(saved, projects)]).toEqual(['household']);
    // The saved list itself is untouched: an unarchived project comes back hidden.
    expect(saved).toEqual(['old', 'done', 'deleted-long-ago', 'household']);
  });

  it('hides nothing while Goals & Projects is off', () => {
    expect(liveHiddenProjectIds(['household'], projects, { enabled: false }).size).toBe(0);
  });

  it('matches ids across number and string', () => {
    expect(liveHiddenProjectIds(['7'], projects).has('7')).toBe(true);
    expect(isHiddenByProject(task('n', { projectId: 7 }), liveHiddenProjectIds([7], projects))).toBe(true);
  });

  it('tolerates a list that is not one', () => {
    expect(liveHiddenProjectIds(null, projects).size).toBe(0);
    expect(liveHiddenProjectIds('household', projects).size).toBe(0);
  });
});

describe('isHiddenByProject', () => {
  const live = liveHiddenProjectIds(['household', 'work'], projects);

  it('hides a task of a hidden project', () => {
    expect(isHiddenByProject(task('a', { projectId: 'household' }), live)).toBe(true);
  });

  it('never hides a task with no project', () => {
    for (const projectId of [undefined, null, '']) {
      expect(isHiddenByProject(task('a', { projectId }), live)).toBe(false);
    }
  });

  it('keeps a task whose project is hidden only by a stale id', () => {
    const stale = liveHiddenProjectIds(['old'], projects);
    expect(isHiddenByProject(task('a', { projectId: 'old' }), stale)).toBe(false);
  });

  it('hides a recurring occurrence through its template\'s project', () => {
    const template = { id: 'tmpl', title: 'Laundry', startTime: '18:00', duration: 30, projectId: 'household', recurrence: { type: 'daily' } };
    expect(isHiddenByProject(recurringTaskInstance(template, DATE), live)).toBe(true);
  });
});

describe('makeCalendarFilter: tags and hidden projects together', () => {
  const day = [
    task('plain'),
    task('household-chore', { projectId: 'household' }),
    task('work-tagged', { title: 'report #work', projectId: 'work' }),
    task('home-tagged', { title: 'fix #home' }),
    task('event', { title: 'meeting #home', imported: true }),
    task('archived-project', { projectId: 'old' }),
  ];

  it('is the tag filter alone when no project is hidden', () => {
    const filter = makeCalendarFilter({ selectedTags: ['home', 'work'] });
    expect(filter(day)).toBe(day);
    expect(ids(makeCalendarFilter({ selectedTags: ['home'] })(day)))
      .toEqual(['plain', 'household-chore', 'home-tagged', 'event', 'archived-project']);
  });

  it('leaves out a hidden project\'s tasks whatever their tags', () => {
    const filter = makeCalendarFilter({ selectedTags: ['home', 'work'], liveHidden: liveHiddenProjectIds(['household', 'work', 'old'], projects) });
    expect(ids(filter(day))).toEqual(['plain', 'home-tagged', 'event', 'archived-project']);
  });

  it('applies both at once', () => {
    const filter = makeCalendarFilter({ selectedTags: ['work'], liveHidden: liveHiddenProjectIds(['household'], projects) });
    expect(ids(filter(day))).toEqual(['plain', 'work-tagged', 'event', 'archived-project']);
  });

  it('keeps the tag filter\'s rule: imported events and untagged tasks always show', () => {
    expect(passesTagFilter(task('e', { title: 'x #a', imported: true }), [])).toBe(true);
    expect(passesTagFilter(task('u'), [])).toBe(true);
    expect(passesTagFilter(task('t', { title: 'x #a' }), [])).toBe(false);
    expect(passesTagFilter(task('t', { title: 'x #a' }), ['a'])).toBe(true);
  });
});

describe('the count', () => {
  const byDate = {
    '2026-11-09': [
      task('a', { projectId: 'household' }),
      task('b', { title: 'x #errand' }),
      // Hidden twice over (an unselected tag AND a hidden project): counted once.
      task('c', { title: 'y #errand', projectId: 'household' }),
      task('d'),
    ],
    '2026-11-10': [task('e', { date: '2026-11-10', projectId: 'household' })],
    '2026-11-11': [task('f', { date: '2026-11-11', projectId: 'household' })],
  };
  const rows = (dateStr) => byDate[dateStr];
  const filter = makeCalendarFilter({ selectedTags: [], liveHidden: liveHiddenProjectIds(['household'], projects) });

  it('counts what the tag filter and hidden projects leave out, together', () => {
    expect(countHiddenOnDates(['2026-11-09'], rows, filter)).toBe(3);
  });

  it('counts only the dates on screen', () => {
    expect(countHiddenOnDates(['2026-11-09', '2026-11-10'], rows, filter)).toBe(4);
    expect(countHiddenOnDates(['2026-11-12'], rows, filter)).toBe(0);
  });

  it('is zero with nothing filtered', () => {
    const none = makeCalendarFilter({ selectedTags: ['errand'] });
    expect(countHiddenOnDates(Object.keys(byDate), rows, none)).toBe(0);
  });
});

describe('calendarFilterDates: the dates the view on screen draws', () => {
  const at = (s) => new Date(`${s}T12:00:00`);
  const base = {
    selectedDate: at('2026-11-09'),
    visibleDates: [at('2026-11-09'), at('2026-11-10'), at('2026-11-11')],
    weekViewDates: ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'].map(at),
    dayViewColumns: [
      { dateStr: '2026-11-09', date: at('2026-11-09') },
      { dateStr: '2026-11-10', date: at('2026-11-10') },
      { dateStr: '2026-11-10', date: at('2026-11-10') },
    ],
    monthViewRange: { from: '2026-10-26', to: '2026-12-06' },
  };

  it('MULTI and the phone grid: the visible columns', () => {
    expect(calendarFilterDates({ ...base, mode: 'multi' })).toEqual(['2026-11-09', '2026-11-10', '2026-11-11']);
    expect(calendarFilterDates({ ...base, mode: 'grid' })).toEqual(['2026-11-09', '2026-11-10', '2026-11-11']);
  });

  it('DAY: each date its columns reach, once', () => {
    expect(calendarFilterDates({ ...base, mode: 'day' })).toEqual(['2026-11-09', '2026-11-10']);
  });

  it('WEEK: the week strip', () => {
    expect(calendarFilterDates({ ...base, mode: 'week' })).toHaveLength(7);
  });

  it('MONTH: every cell of the grid', () => {
    const dates = calendarFilterDates({ ...base, mode: 'month' });
    expect(dates[0]).toBe('2026-10-26');
    expect(dates.at(-1)).toBe('2026-12-06');
    expect(dates).toHaveLength(42);
    expect(calendarFilterDates({ ...base, mode: 'month', monthViewRange: null })).toEqual([]);
  });

  it('LIST and JOBO: the selected date', () => {
    expect(calendarFilterDates({ ...base, mode: 'list' })).toEqual(['2026-11-09']);
    expect(calendarFilterDates({ ...base, mode: 'jobo' })).toEqual(['2026-11-09']);
  });

  it('SCHED: none, since it opts out of the calendar filter', () => {
    expect(calendarFilterDates({ ...base, mode: 'sched' })).toEqual([]);
  });
});

describe('readHiddenProjects', () => {
  const storage = (value) => ({ getItem: (key) => (key === HIDDEN_PROJECTS_KEY ? value : null) });

  it('reads the saved list', () => {
    expect(readHiddenProjects(storage('["household"]'))).toEqual(['household']);
  });

  it('reads anything unreadable as no list', () => {
    expect(readHiddenProjects(storage(null))).toEqual([]);
    expect(readHiddenProjects(storage('{oops'))).toEqual([]);
    expect(readHiddenProjects(storage('{"a":1}'))).toEqual([]);
    expect(readHiddenProjects({ getItem: () => { throw new Error('blocked'); } })).toEqual([]);
  });
});
