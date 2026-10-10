import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getOverdueTasks } from './getOverdueTasks.js';
import { dateToString } from './taskUtils.js';

const TODAY = '2026-10-10';
const at = (time) => new Date(`${TODAY}T${time}:00`);
const base = (patch = {}) => ({
  todayStr: TODAY,
  now: at('10:00'),
  tasks: [],
  expandedRecurringTasks: [],
  recurringTasks: [],
  unscheduledTasks: [],
  isVisibleForUser: (task) => task.owner !== 'other',
  ...patch,
});
const task = (id, patch = {}) => ({
  id, title: `Task ${id}`, date: TODAY, startTime: '09:30', duration: 30,
  ...patch,
});
const template = (id, patch = {}) => ({
  id, title: `Series ${id}`, isAllDay: true, duration: 45, color: 'bg-blue-500',
  recurrence: { type: 'daily', startDate: '2026-10-01' },
  ...patch,
});
const ids = (input) => getOverdueTasks(base(input)).map(item => item.id);
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('getOverdueTasks', () => {
  it('returns an empty list for empty task sources', () => {
    expect(getOverdueTasks(base())).toEqual([]);
  });

  it('keeps source order: scheduled, today recurring, past all-day recurring, Inbox deadlines', () => {
    const input = base({
      tasks: [task('second', { date: '2026-10-09' }), task('first')],
      expandedRecurringTasks: [task('r2'), task('r1')],
      recurringTasks: [template('b'), template('a')],
      unscheduledTasks: [task('d2', { deadline: '2026-10-08' }), task('d1', { deadline: '2026-10-07' })],
    });
    const result = getOverdueTasks(input);
    expect(result.map(item => item.id)).toEqual([
      'second', 'first', 'r2', 'r1',
      ...['09', '08', '07', '06', '05', '04', '03'].flatMap(day => [
        `recurring-b-2026-10-${day}`, `recurring-a-2026-10-${day}`,
      ]),
      'd2', 'd1',
    ]);
    expect(result.map(item => item._overdueType)).toEqual([
      ...Array(18).fill('scheduled'), 'deadline', 'deadline',
    ]);
  });

  it('includes ordinary past tasks of any age, including all-day tasks', () => {
    expect(ids({ tasks: [
      task('old', { date: '2020-01-01' }),
      task('past-all-day', { date: '2026-10-02', isAllDay: true }),
      task('today-all-day', { isAllDay: true }),
      task('future', { date: '2026-10-11' }),
      task('undated', { date: undefined }),
    ] })).toEqual(['old', 'past-all-day']);
  });

  it('excludes completed, imported, example and invisible scheduled tasks', () => {
    const excluded = [{ completed: true }, { imported: true }, { isExample: true }, { owner: 'other' }];
    expect(ids({ tasks: excluded.flatMap((patch, i) => [
      task(`today-${i}`, patch), task(`past-${i}`, { ...patch, date: '2026-10-09' }),
    ]) })).toEqual([]);
  });

  it.each(['tasks', 'expandedRecurringTasks'])('%s uses the inclusive end-minute boundary', (source) => {
    expect(ids({ [source]: [
      task('ended', { startTime: '09:00', duration: 59 }),
      task('boundary'),
      task('ongoing', { duration: 31 }),
      task('not-started', { startTime: '10:01' }),
      task('cross-midnight', { startTime: '23:45', duration: 30 }),
    ] })).toEqual(['ended', 'boundary']);
    expect(ids({ now: new Date(`${TODAY}T09:59:59`), [source]: [task('boundary')] })).toEqual([]);
  });

  it.each(['tasks', 'expandedRecurringTasks'])('%s preserves midnight and 30-minute fallbacks', (source) => {
    const rows = [
      task('missing', { startTime: undefined, duration: undefined }),
      task('empty', { startTime: '', duration: null }),
      task('zero-duration', { startTime: null, duration: 0 }),
      task('malformed', { startTime: 'not-a-time' }),
    ];
    expect(ids({ now: at('00:29'), [source]: rows })).toEqual([]);
    expect(ids({ now: at('00:30'), [source]: rows })).toEqual(['missing', 'empty', 'zero-duration']);
  });

  it('uses only visible incomplete timed recurring instances from today', () => {
    expect(ids({ expandedRecurringTasks: [
      task('today'),
      task('past', { date: '2026-10-09' }),
      task('future', { date: '2026-10-11' }),
      task('all-day', { isAllDay: true }),
      task('done', { completed: true }),
      task('example', { isExample: true }),
      task('hidden', { owner: 'other' }),
      // Unlike ordinary scheduled rows, this source has no imported guard.
      task('imported-instance', { imported: true }),
    ] })).toEqual(['today', 'imported-instance']);
  });

  it('looks back exactly 1–7 days for all-day recurring templates', () => {
    expect(ids({ recurringTasks: [
      template('daily'),
      template('timed', { isAllDay: false }),
      template('unspecified', { isAllDay: undefined }),
      template('example', { isExample: true }),
      template('hidden', { owner: 'other' }),
      template('no-recurrence', { recurrence: null }),
    ] })).toEqual(['09', '08', '07', '06', '05', '04', '03'].map(day => `recurring-daily-2026-10-${day}`));
  });

  it('uses the recurrence engine for weekdays, start/end bounds and occurrence limits', () => {
    expect(ids({ recurringTasks: [
      template('weekly', { recurrence: { type: 'weekly', startDate: '2026-10-01', daysOfWeek: [1, 5] } }),
      template('bounded', { recurrence: { type: 'daily', startDate: '2026-10-05', endDate: '2026-10-06' } }),
      template('capped', { recurrence: { type: 'daily', startDate: '2026-10-07', maxOccurrences: 1 } }),
    ] })).toEqual([
      'recurring-weekly-2026-10-09', 'recurring-capped-2026-10-07',
      'recurring-bounded-2026-10-06', 'recurring-weekly-2026-10-05', 'recurring-bounded-2026-10-05',
    ]);
  });

  it('omits completed dates and completed, deleted or skipped exceptions', () => {
    expect(ids({ recurringTasks: [template('daily', {
      completedDates: ['2026-10-09'],
      exceptions: {
        '2026-10-09': { completed: false },
        '2026-10-08': { completed: true },
        '2026-10-07': { deleted: true },
        '2026-10-06': { skipped: true },
        '2026-10-05': { completed: false },
      },
    })] })).toEqual(['05', '04', '03'].map(day => `recurring-daily-2026-10-${day}`));
  });

  it('retains the all-day occurrence field whitelist and series-level fields', () => {
    const series = template('one', {
      recurrence: { type: 'daily', startDate: '2026-10-09', endDate: '2026-10-09' },
      notes: 'Series notes', subtasks: [{ id: 's', title: 'Step' }], energy: 'high', projectId: 'p',
      owner: 'me', deadline: '2026-10-01', extra: 'not an instance field',
      exceptions: { '2026-10-09': {
        title: 'Exception title', duration: 60, color: 'bg-red-500',
        startTime: '15:00', isAllDay: false, notes: 'Ignored', subtasks: [], energy: 'low', projectId: 'other',
      } },
    });
    expect(getOverdueTasks(base({ recurringTasks: [series] }))).toEqual([{
      id: 'recurring-one-2026-10-09', title: 'Exception title', startTime: null,
      duration: 60, color: 'bg-red-500', completed: false, isAllDay: true,
      notes: 'Series notes', subtasks: series.subtasks, energy: 'high', date: '2026-10-09',
      isRecurring: true, recurringTemplateId: 'one', recurrenceType: 'daily', projectId: 'p',
      _overdueType: 'scheduled',
    }]);
  });

  it('preserves empty and zero exception overrides, and falls back only for nullish fields', () => {
    const series = template('one', { exceptions: {
      '2026-10-09': { title: '', duration: 0, color: '' },
      '2026-10-08': { title: null, duration: null, color: null },
    } });
    const result = getOverdueTasks(base({ recurringTasks: [series] }));
    expect(result[0]).toMatchObject({ title: '', duration: 0, color: '', notes: '', subtasks: [] });
    expect(result[1]).toMatchObject({ title: series.title, duration: series.duration, color: series.color });
  });

  it('suppresses an all-day occurrence already present in overdue scheduled rows', () => {
    expect(ids({
      tasks: [task('recurring-one-2026-10-09', { date: '2026-10-09' })],
      recurringTasks: [template('one')],
    })).toEqual(['09', '08', '07', '06', '05', '04', '03'].map(day => `recurring-one-2026-10-${day}`));
    // An excluded scheduled row does not hide the still-incomplete occurrence.
    expect(ids({
      tasks: [task('recurring-one-2026-10-09', { date: '2026-10-09', imported: true })],
      recurringTasks: [template('one')],
    })[0]).toBe('recurring-one-2026-10-09');
  });

  it('does not introduce global ID deduplication between the other sources', () => {
    expect(ids({
      tasks: [task('same')], expandedRecurringTasks: [task('same')],
      unscheduledTasks: [task('same', { deadline: '2026-10-09' })],
    })).toEqual(['same', 'same', 'same']);
  });

  it('includes only visible incomplete Inbox tasks with a strictly past deadline', () => {
    expect(ids({ unscheduledTasks: [
      task('past', { deadline: '2020-01-01' }),
      task('today', { deadline: TODAY }),
      task('future', { deadline: '2026-10-11' }),
      task('no-deadline'),
      task('empty-deadline', { deadline: '' }),
      task('done', { deadline: '2026-10-09', completed: true }),
      task('example', { deadline: '2026-10-09', isExample: true }),
      task('hidden', { deadline: '2026-10-09', owner: 'other' }),
      task('bucket1', { deadline: '2026-10-09', bucketId: 'b1' }),
      task('bucket2', { deadline: '2026-10-09', bucketId: 'b2' }),
      task('other-bucket', { deadline: '2026-10-09', bucketId: 'other' }),
      task('empty-bucket', { deadline: '2026-10-09', bucketId: '' }),
    ] })).toEqual(['past', 'empty-bucket']);
  });

  it('preserves complete source rows and returns new tagged rows without mutating inputs', () => {
    const input = freeze(base({
      tasks: [task('scheduled', { custom: { value: 1 }, _overdueType: 'old' })],
      expandedRecurringTasks: [task('expanded', { energy: 'low', projectId: 'p' })],
      recurringTasks: [template('series', { subtasks: [{ title: 'Step', completed: false }] })],
      unscheduledTasks: [task('deadline', { deadline: '2026-10-09', custom: ['kept'] })],
    }));
    const before = JSON.stringify(input);
    const result = getOverdueTasks(input);
    expect(result[0]).toEqual({ ...input.tasks[0], _overdueType: 'scheduled' });
    expect(result[1]).toEqual({ ...input.expandedRecurringTasks[0], _overdueType: 'scheduled' });
    expect(result.at(-1)).toEqual({ ...input.unscheduledTasks[0], _overdueType: 'deadline' });
    expect(result[0]).not.toBe(input.tasks[0]);
    expect(result[1]).not.toBe(input.expandedRecurringTasks[0]);
    expect(result.at(-1)).not.toBe(input.unscheduledTasks[0]);
    expect(JSON.stringify(input)).toBe(before);
    expect(getOverdueTasks(input)).toEqual(result);
  });

  it('keeps the wall-clock date separate from the supplied currentTime clock at rollover', () => {
    const result = getOverdueTasks(base({
      todayStr: '2026-10-11', now: at('23:59'),
      tasks: [task('wall-clock-past', { isAllDay: true })],
      expandedRecurringTasks: [task('wall-clock-today', { date: '2026-10-11' })],
      recurringTasks: [template('series')],
      unscheduledTasks: [task('deadline', { deadline: TODAY })],
    }));
    expect(result.map(item => item.id)).toEqual([
      'wall-clock-past', 'wall-clock-today',
      ...['09', '08', '07', '06', '05', '04', '03'].map(day => `recurring-series-2026-10-${day}`),
      'deadline',
    ]);
  });

  it('reads neither storage nor the ambient clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2040-01-01T00:00:00'));
    vi.stubGlobal('localStorage', new Proxy({}, { get() { throw new Error('storage accessed'); } }));
    const input = base({ tasks: [task('scheduled')], recurringTasks: [template('series')] });
    const expected = getOverdueTasks(input);
    vi.setSystemTime(new Date('1990-01-01T00:00:00'));
    expect(getOverdueTasks(input)).toEqual(expected);
    expect(expected).toHaveLength(8);
  });

  it.each([
    ['2026-03-09T00:30:00', ['2026-03-08', '2026-03-07', '2026-03-06', '2026-03-05', '2026-03-04', '2026-03-03', '2026-03-02']],
    ['2026-11-02T23:30:00', ['2026-11-01', '2026-10-31', '2026-10-30', '2026-10-29', '2026-10-28', '2026-10-27', '2026-10-26']],
  ])('walks local calendar days across DST from %s', (now, expected) => {
    // The normal suite runs in UTC; a separate process exercises local dates
    // and setDate across both New York clock changes, including a UTC rollover.
    const moduleUrl = new URL('./getOverdueTasks.js', import.meta.url).href;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
      import { getOverdueTasks } from ${JSON.stringify(moduleUrl)};
      const result = getOverdueTasks({
        todayStr: ${JSON.stringify(now.slice(0, 10))}, now: new Date(${JSON.stringify(now)}),
        tasks: [], expandedRecurringTasks: [], unscheduledTasks: [], isVisibleForUser: () => true,
        recurringTasks: [{ id: 'daily', isAllDay: true, recurrence: { type: 'daily', startDate: '2026-01-01' } }],
      });
      console.log(JSON.stringify(result.map(task => task.date)));
    `], { env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' });
    expect(JSON.parse(output.trim())).toEqual(expected);
  });
});

describe('App.jsx overdue wrapper', () => {
  // Exercise the real thin wrapper without copying its implementation or
  // mounting the planner's unrelated native, storage and sync integrations.
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  const wrapper = app.match(/const getOverdueTasks = \(\) => collectOverdueTasks\(\{[\s\S]*?\n  \}\);/)[0];
  const getTodayStr = app.match(/const getTodayStr = \(\) => [^\n]+/)[0];
  const makeWrapper = new Function('collectOverdueTasks', 'dateToString', 'input', `
    const { currentTime, tasks, recurringTasks, unscheduledTasks, isVisibleForUser } = input;
    ${getTodayStr}
    ${wrapper}
    const expandedRecurringTasks = input.expandedRecurringTasks;
    return getOverdueTasks;
  `);

  it('defers reading the later recurring expansion and clocks until the zero-argument call', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at('23:59'));
    const collect = vi.fn(getOverdueTasks);
    const input = base({ currentTime: at('23:59'), expandedRecurringTasks: [task('tomorrow', { date: '2026-10-11' })] });
    const getOverdue = makeWrapper(collect, dateToString, input);
    expect(getOverdue.length).toBe(0);
    expect(collect).not.toHaveBeenCalled();
    vi.setSystemTime(new Date('2026-10-11T00:01:00'));
    expect(getOverdue().map(item => item.id)).toEqual(['tomorrow']);
    expect(collect).toHaveBeenCalledWith({
      todayStr: '2026-10-11', now: input.currentTime,
      tasks: input.tasks, expandedRecurringTasks: input.expandedRecurringTasks,
      recurringTasks: input.recurringTasks, unscheduledTasks: input.unscheduledTasks,
      isVisibleForUser: input.isVisibleForUser,
    });
  });

  it.each([null, undefined])('falls back to the call-time clock when currentTime is %s', (currentTime) => {
    vi.useFakeTimers();
    vi.setSystemTime(at('09:59'));
    const getOverdue = makeWrapper(getOverdueTasks, dateToString, base({ currentTime, tasks: [task('boundary')] }));
    expect(getOverdue()).toEqual([]);
    vi.setSystemTime(at('10:00'));
    expect(getOverdue().map(item => item.id)).toEqual(['boundary']);
  });
});
