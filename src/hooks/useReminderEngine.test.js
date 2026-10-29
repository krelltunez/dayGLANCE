import { beforeAll, describe, expect, it } from 'vitest';
import i18n from 'i18next';
import en from '../../public/locales/en/translation.json';
import { LEAD_AHEAD_MINUTES, isAheadReminder, reminderMessage, reminderPointsToday } from './useReminderEngine.js';

// #2249: reminder lead times up to 12 hours. A lead past midnight lands the
// evening before the task, so the engine reads today's and tomorrow's tasks
// and keeps the reminders that land today.
beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
});

const settings = (scheduled, extra = {}) => ({
  morningReminderTime: '08:00',
  categories: { scheduledTasks: scheduled, allDayTasks: { morningReminder: true }, ...extra },
});
const task = (id, startTime, extra = {}) => ({ id, title: id, startTime, duration: 30, ...extra });
const landing = (args) => reminderPointsToday(args).map((p) => [p.key, p.minute]);
const at = (h, m = 0) => h * 60 + m;

describe('reminderPointsToday', () => {
  it('a lead past midnight fires the evening before: 12 hours before tomorrow\'s 9:00 is 21:00 today', () => {
    const reminderSettings = settings({ ahead720: true });
    expect(landing({ tomorrowTasks: [task('jog', '09:00')], reminderSettings })).toEqual([['a720-jog', at(21)]]);
  });

  it('…and not again tomorrow: today\'s 9:00 task, 12 hours ahead, belonged to yesterday', () => {
    const reminderSettings = settings({ ahead720: true });
    expect(landing({ todayTasks: [task('jog', '09:00')], reminderSettings })).toEqual([]);
  });

  it('every lead, longest first in the settings, lands where it should', () => {
    const all = Object.fromEntries(LEAD_AHEAD_MINUTES.map((m) => [`ahead${m}`, true]));
    const today = landing({ todayTasks: [task('flight', '18:00')], reminderSettings: settings(all) });
    expect(today).toEqual([
      ['a30-flight', at(17, 30)], ['a60-flight', at(17)], ['a120-flight', at(16)],
      ['a240-flight', at(14)], ['a480-flight', at(10)], ['a720-flight', at(6)],
    ]);
  });

  it('the existing reminders are unchanged, and a 15-minute one now reaches across midnight', () => {
    const reminderSettings = settings({ before15: true, atStart: true });
    expect(landing({ todayTasks: [task('a', '10:00')], reminderSettings })).toEqual([['b15-a', at(9, 45)], ['start-a', at(10)]]);
    // Tomorrow 00:10: its 15-minute reminder is 23:55 tonight (dropped before).
    expect(landing({ tomorrowTasks: [task('late', '00:10')], reminderSettings })).toEqual([['b15-late', at(23, 55)]]);
  });

  it('tomorrow\'s morning reminder for an all-day task waits for tomorrow; completed tasks remind of nothing', () => {
    const reminderSettings = settings({ ahead720: true });
    expect(landing({ tomorrowTasks: [{ id: 'd', title: 'd', isAllDay: true }], reminderSettings })).toEqual([]);
    expect(landing({ tomorrowTasks: [task('done', '09:00', { completed: true })], reminderSettings })).toEqual([]);
  });

  it('no setting for a category, no reminders', () => {
    expect(landing({ todayTasks: [task('a', '10:00')], reminderSettings: { categories: {} } })).toEqual([]);
  });
});

describe('early-notice reminders', () => {
  it('are named ahead<minutes>, which the native sides read as "no Snooze"', () => {
    expect(LEAD_AHEAD_MINUTES.map((m) => isAheadReminder(`ahead${m}`))).toEqual(LEAD_AHEAD_MINUTES.map(() => true));
    expect(['before15', 'start', 'end', 'morning'].some(isAheadReminder)).toBe(false);
  });

  it('say how long until the start', () => {
    expect(reminderMessage('ahead30')).toBe('Starts in 30m');
    expect(reminderMessage('ahead120')).toBe('Starts in 2h');
    expect(reminderMessage('ahead720')).toBe('Starts in 12h');
    expect(reminderMessage('before15')).toBe('Starts in 15 minutes');
  });
});
