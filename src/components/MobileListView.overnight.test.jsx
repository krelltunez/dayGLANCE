import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { continuationsFromPreviousDay, shiftDateStr } from '@glance-apps/agenda-core';
import { loaders } from '../locales.js';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../context/FeaturesContext.jsx';
import MobileListView from './MobileListView.jsx';

// The phone's LIST timeline (the spine with "free" gaps and the Now pill),
// #2278. The owner's case: Sat 7 Nov at 00:08, "Two-Hour Task" (Fri 6 Nov,
// 23:00, 120 minutes) still runs until 01:00. The list drew nothing for that
// hour: "00:08 7h 52m free" and "7h 52m until Daily planning", as if empty.
// It draws the piece from 00:00 as the other timelines do, counts it busy
// (the first gap starts at 01:00), and shows it running, as a task in
// progress during the day is shown: its time left, and no Now pill.

let inst;
beforeAll(async () => {
  const bundle = await loaders.en();
  inst = i18next.createInstance();
  await inst.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});
afterEach(() => { vi.useRealTimers(); });

const FRI = '2026-11-06';
const SAT = '2026-11-07';
const twoHour = { id: 'two', title: 'Two-Hour Task', date: FRI, startTime: '23:00', duration: 120, completed: false, color: 'bg-blue-500' };
const planning = { id: 'plan', title: 'Daily planning', date: SAT, startTime: '08:00', duration: 30, completed: false, color: 'bg-green-500' };

const pad = (n) => String(n).padStart(2, '0');
const dateStrOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const noop = () => {};

const render = ({ now, day = SAT, tasks = [twoHour, planning], use24HourClock = true } = {}) => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const forDate = (d) => tasks.filter((t) => t.date === dateStrOf(d));
  const formatTime = (time) => {
    if (use24HourClock) return time;
    const [h, m] = time.split(':').map(Number);
    return `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`;
  };
  const planner = {
    selectedDate: new Date(`${day}T12:00:00`), currentTime: new Date(now),
    tasks, setTasks: noop, unscheduledTasks: [], setUnscheduledTasks: noop, expandedRecurringTasks: [],
    calendarRef: { current: null }, mobileDateHeaderRef: { current: null }, use24HourClock,
    darkMode: false, cardBg: '', borderClass: '', textPrimary: '', textSecondary: '',
    formatTime, timeToMinutes: toMin, minutesToTime: (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`,
    getTasksForDate: forDate, getCalendarTasksForDate: forDate,
    getContinuationsForDate: (d) => continuationsFromPreviousDay(forDate(new Date(`${shiftDateStr(dateStrOf(d), -1)}T12:00:00`))),
    getTaskCalendarStyle: () => ({}),
    toggleComplete: noop, postponeTask: noop, moveToInbox: noop, openMobileEditTask: noop,
    setExpandedNotesTaskId: noop, pushUndo: noop, playUISound: noop,
    listEndOfDayTime: null, filteredUnscheduledTasks: [],
  };
  const features = {
    routinesEnabled: false, todayRoutines: [], setTodayRoutines: noop, routineCompletions: {}, toggleRoutineCompletion: noop,
    projects: [], hgVisibleProjects: [], enterHyperGlanceMode: noop, setPendingEditProjectId: noop, updateProject: noop,
    getFrameInstancesForDate: () => [], computeAvailableSlots: () => [], setFrameContextMenu: noop,
  };
  return renderToStaticMarkup(
    <I18nextProvider i18n={inst}>
      <DayPlannerContext.Provider value={planner}>
        <FeaturesContext.Provider value={features}>
          <MobileListView hideInboxHandle />
        </FeaturesContext.Provider>
      </DayPlannerContext.Provider>
    </I18nextProvider>,
  );
};

const gaps = (html) => [...html.matchAll(/data-gap-from="(\d+)" data-gap-to="(\d+)"/g)].map(([, from, to]) => [Number(from), Number(to)]);

describe('the phone list on the date a task runs into', () => {
  it('at 00:08 draws the piece from 00:00, running, with the first gap from 01:00 and no free-time pill', () => {
    const html = render({ now: new Date(`${SAT}T00:08:00`) });
    expect(html).toContain(`data-continuation-row="${FRI}"`);
    expect(html).toContain('Two-Hour Task');
    expect(html).toContain('from Fri');
    // The piece's own range, from midnight.
    expect(html).toContain('00:00–01:00 · 1h');
    // Running: its time left in the time column, as a task in progress shows.
    expect(html).toContain('52m left');
    // Busy until 01:00: the free time runs from there to Daily planning.
    expect(gaps(html)[0]).toEqual([60, 480]);
    expect(html).not.toContain('7h 52m');
    // Something is running, so no "until next" pill.
    expect(html).not.toContain('until Daily planning');
    expect(html.indexOf('Two-Hour Task')).toBeLessThan(html.indexOf('Daily planning'));
  });

  it('at 01:30 the piece is past: folded into the earlier items, and the pill counts to Daily planning', () => {
    const html = render({ now: new Date(`${SAT}T01:30:00`) });
    expect(html).not.toContain('Two-Hour Task');
    expect(html).toContain('Show 1 earlier item');
    expect(html).toContain('6h 30m until Daily planning');
  });

  it('a task ending at midnight leaves nothing on the next date', () => {
    const html = render({ now: new Date(`${SAT}T00:08:00`), tasks: [{ ...twoHour, duration: 60 }, planning] });
    expect(html).not.toContain('data-continuation-row');
    expect(html).toContain('7h 52m until Daily planning');
  });
});

// The start date's own card printed the end as minutes past its midnight:
// "23:00–25:00 · 2h". It reads the real clock time, with the app's next-day
// mark (components/TimeRange.jsx, the task dialog's "+1").
describe('the phone list on the date the task starts', () => {
  const nextDay = '<sup data-next-day="true" class="ml-0.5 text-[0.75em] font-semibold opacity-70" title="Ends the next day">+1</sup>';

  it('prints the end as 01:00, marked +1, in 24-hour time', () => {
    const html = render({ now: new Date(`${FRI}T22:00:00`), day: FRI });
    expect(html).toContain(`23:00–01:00${nextDay} · 2h`);
    expect(html).not.toContain('25:00');
  });

  it('and as 1:00 AM in 12-hour time', () => {
    const html = render({ now: new Date(`${FRI}T22:00:00`), day: FRI, use24HourClock: false });
    expect(html).toContain(`11:00\u00A0PM–1:00\u00A0AM${nextDay} · 2h`);
    expect(html).not.toContain('–1:00\u00A0PM');
  });

  it('leaves an ordinary range as it was', () => {
    const html = render({ now: new Date(`${SAT}T06:00:00`), tasks: [planning] });
    expect(html).toContain('08:00–08:30 · 30m');
    expect(html).not.toContain('data-next-day');
  });
});
