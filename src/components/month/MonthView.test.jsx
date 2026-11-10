import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../../locales.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import { SyncContext } from '../../context/SyncContext.jsx';
import MonthView, { monthViewRangeFor } from './MonthView.jsx';

// Static markup, no DOM. The range lifecycle (publish while mounted, replace
// on navigation, clear on unmount) lives in an effect, which static
// rendering never runs, so it is covered by the browser check; the pure
// range helper and what the view draws for a selectedDate are covered here.

// Node 25 defines a localStorage of its own that has no getItem without
// --localstorage-file, so stub unless a working one is already there.
if (typeof globalThis.localStorage?.getItem !== 'function') {
  delete globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: () => null, length: 0 };
}

async function i18nFor(language) {
  const bundle = await loaders[language]();
  const i18n = i18next.createInstance();
  await i18n.init({ lng: language, fallbackLng: false, resources: { [language]: { translation: bundle } }, interpolation: { escapeValue: false } });
  return i18n;
}

const render = (i18n, selectedDate, weekStartDay = 0, extra = {}, size = { width: 1120, height: 700 }) => {
  const planner = {
    selectedDate, weekStartDay,
    goToDate: vi.fn(), setMonthViewRange: vi.fn(),
    // What the docked panel's SchedView and day header read.
    tasks: [], unscheduledTasks: [], expandedRecurringTasks: [], schedDaysShown: 14, setSchedDaysShown: vi.fn(),
    currentTime: selectedDate, setNewTask: vi.fn(), setShowAddTask: vi.fn(), scheduleTaskAtNextSlot: vi.fn(),
    borderClass: 'border-stone-300', cardBg: 'bg-white', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', hoverBg: '',
    calendarRef: { current: null }, darkMode: false, dailyNotes: {}, setDailyNotesModalDate: vi.fn(), openNewAllDayTask: vi.fn(),
    formatTime: (t) => t, use24HourClock: true, isTablet: false,
    toggleComplete: vi.fn(), openMobileEditTask: vi.fn(), postponeTask: vi.fn(),
    updateTaskNotes: vi.fn(), addSubtask: vi.fn(), toggleSubtask: vi.fn(), deleteSubtask: vi.fn(), updateSubtaskTitle: vi.fn(),
    ...extra,
    getTasksForDate: (date) => (date.getDate() === 16 && date.getMonth() === 8 ? [{ id: 't1', title: 'Design review', date: '2026-09-16', startTime: '14:00', duration: 60, isAllDay: false, completed: false }] : []),
    getDeadlineTasksForDate: () => [],
  };
  const features = { routinesEnabled: false, todayRoutines: [], routinesDate: null, routineCompletions: {}, isVisibleForUser: () => true, focusLog: {}, setFocusLogModalDate: vi.fn(), habitsEnabled: false, habitLogs: {}, activeHabits: [], projects: [], goals: [], goalsProjectsEnabled: false, aiConfig: { features: {} } };
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <DayPlannerContext.Provider value={planner}>
        <FeaturesContext.Provider value={features}>
          <SyncContext.Provider value={{}}>
            <MonthView width={size.width} height={size.height} />
          </SyncContext.Provider>
        </FeaturesContext.Provider>
      </DayPlannerContext.Provider>
    </I18nextProvider>,
  );
};

describe('monthViewRangeFor', () => {
  it('spans the whole drawn grid, leading and trailing days included', () => {
    expect(monthViewRangeFor(2026, 9, 0)).toEqual({ from: '2026-08-30', to: '2026-10-03' });
    expect(monthViewRangeFor(2026, 9, 1)).toEqual({ from: '2026-08-31', to: '2026-10-04' });
  });
  it('crosses the year for January and December', () => {
    expect(monthViewRangeFor(2027, 1, 0)).toEqual({ from: '2026-12-27', to: '2027-02-06' });
    expect(monthViewRangeFor(2026, 12, 0)).toEqual({ from: '2026-11-29', to: '2027-01-02' });
  });
});

describe('MonthView', () => {
  it("shows selectedDate's month with selectedDate highlighted and no sheet until a day is tapped", async () => {
    const html = render(await i18nFor('en'), new Date(2026, 8, 16, 12));
    expect(html).toContain('data-month-view');
    expect(html).toContain('data-month-grid="2026-09"');
    expect(html).toMatch(/data-month-cell="2026-09-16"[^>]*data-selected="true"/);
    expect((html.match(/data-selected="true"/g) || []).length).toBe(1);
    expect(html).not.toContain('data-month-day-sheet');
    // The grid has no header of its own: the app chrome names the month.
    expect(html).not.toContain('<h2');
  });

  it('follows selectedDate into another month and the week-start setting', async () => {
    const html = render(await i18nFor('de'), new Date(2027, 0, 5, 12), 1);
    expect(html).toContain('data-month-grid="2027-01"');
    expect(html).toMatch(/data-month-cell="2027-01-05"[^>]*data-selected="true"/);
    const weekdays = html.slice(html.indexOf('data-month-grid-weekdays'), html.indexOf('data-month-grid-area'));
    expect(weekdays.indexOf('Mo')).toBeLessThan(weekdays.indexOf('So'));
  });

  it('renders the sheet layout below the DAY breakpoint: no panel, the header row owns the day header', async () => {
    const html = render(await i18nFor('en'), new Date(2026, 8, 16, 12), 0, { canShowViewCycler: false });
    expect(html).toContain('data-month-view-layout="sheet"');
    expect(html).not.toContain('data-month-panel');
    expect(html).not.toContain('data-sched-view');
  });

  it("docks the selected day's agenda beside the grid at the DAY breakpoint, with the day header on top", async () => {
    const html = render(await i18nFor('en'), new Date(2026, 8, 16, 12), 0, { canShowViewCycler: true });
    expect(html).toContain('data-month-view-layout="docked"');
    expect(html).toContain('data-month-panel="2026-09-16"');
    // The panel is the scoped SCHED for exactly that day, headed by the shared day header.
    expect(html).toContain('data-sched-view="scoped"');
    expect(html).toContain('data-day-header="2026-09-16"');
    expect(html).toContain('Design review');
    expect(html).not.toContain('data-month-day-sheet');
    // The panel comes after the grid in the row.
    expect(html.indexOf('data-month-grid=')).toBeLessThan(html.indexOf('data-month-panel='));
  });

  it('sizes the docked panel from the row: the minimum on a narrow row, more where the grid leaves width unused', async () => {
    const i18n = await i18nFor('en');
    // 1120 wide, 700 tall: the grid uses 980 of it, a third is 373, so the minimum holds.
    expect(render(i18n, new Date(2026, 8, 16, 12), 0, { canShowViewCycler: true })).toMatch(/data-month-panel=[^>]*width:380px/);
    // 1800 wide, 700 tall: the grid still uses 980, the panel absorbs the rest up to its maximum.
    expect(render(i18n, new Date(2026, 8, 16, 12), 0, { canShowViewCycler: true }, { width: 1800, height: 700 })).toMatch(/data-month-panel=[^>]*width:640px/);
    // 1800 wide, 1400 tall: the cells hit their cap, the grid uses 1400, the third (600) wins.
    expect(render(i18n, new Date(2026, 8, 16, 12), 0, { canShowViewCycler: true }, { width: 1800, height: 1400 })).toMatch(/data-month-panel=[^>]*width:600px/);
  });
});

describe('MonthView — a month grid widget link', () => {
  // Static rendering runs no effects, so these pin that the linked day's
  // sheet is in the FIRST render. An effect-opened sheet came up only after
  // the Obsidian resume sync had freed the JS thread on a warm open.
  it("opens the linked day's sheet in the first render", async () => {
    const html = render(await i18nFor('en'), new Date(2026, 9, 1, 12), 0,
      { monthSheetRequest: '2026-10-01', setMonthSheetRequest: vi.fn() });
    expect(html).toContain('data-month-day-sheet="2026-10-01"');
  });

  it('opens nothing docked: the panel already shows the selected day', async () => {
    const html = render(await i18nFor('en'), new Date(2026, 9, 1, 12), 0,
      { monthSheetRequest: '2026-10-01', setMonthSheetRequest: vi.fn(), canShowViewCycler: true });
    expect(html).not.toContain('data-month-day-sheet');
  });

  it('opens nothing for a request that is not the selected day', async () => {
    const html = render(await i18nFor('en'), new Date(2026, 9, 1, 12), 0,
      { monthSheetRequest: '2026-10-02', setMonthSheetRequest: vi.fn() });
    expect(html).not.toContain('data-month-day-sheet');
  });
});

// JOBO slice 6: MONTH reads the day's display, as DAY and WEEK do, so a past
// day's bars follow the Do. The phone and portrait tablet render this same
// view, and since slice 8 they follow the Do too.
describe('MonthView — past days follow the Do', () => {
  const display = (date) => (date.getDate() === 15 && date.getMonth() === 8
    ? [{ id: 'jobo-do:manual:1:2026-09-15', title: 'Deep work', color: 'bg-blue-500', date: '2026-09-15', startTime: '09:30', duration: 45, isAllDay: false, completed: false, joboDo: true, joboRecordId: 'manual:1' }]
    : []);
  const drawn = (html) => html.includes('data-jobo-do="manual:1"');

  // MUTATION: bring back a phone-layout check and the phone's MONTH loses the Do.
  it('draws the Do on every layout: desktop, tablets either way up, and the phone', async () => {
    const i18n = await i18nFor('en');
    const at = (extra) => render(i18n, new Date(2026, 8, 16, 12), 0, { getDayDisplayForDate: display, ...extra });
    expect(drawn(at({}))).toBe(true);
    expect(drawn(at({ isTablet: true, isLandscape: true }))).toBe(true);
    expect(drawn(at({ isMobile: true }))).toBe(true);
    expect(drawn(at({ isTablet: true, isLandscape: false }))).toBe(true);
  });

  it('shows the plan where the app offers no display accessor', async () => {
    expect(drawn(render(await i18nFor('en'), new Date(2026, 8, 16, 12)))).toBe(false);
  });
});

