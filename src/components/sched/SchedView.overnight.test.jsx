import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../../locales.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import { SyncContext } from '../../context/SyncContext.jsx';
import SchedView from './SchedView.jsx';

// The month view's day sheet is SchedView scoped to one date (#2278). The
// owner's case: on Sat 7 Nov at 00:08, "Two-Hour Task" (Fri 6 Nov, 23:00, 120
// minutes) is still running until 01:00. It is not overdue yet: the sheet's
// TODAY section shows its piece after midnight, as the timelines draw it,
// "from Fri" and happening now. From 01:00 it is overdue, listed once.

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}

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

const dateToStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const noop = () => {};

const render = (at, { tasks = [twoHour, planning] } = {}) => {
  vi.useFakeTimers();
  vi.setSystemTime(at);
  const byDate = {};
  for (const task of tasks) (byDate[task.date] ||= []).push(task);
  const planner = {
    darkMode: false, cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', hoverBg: '',
    calendarRef: { current: null },
    selectedDate: new Date(`${SAT}T12:00:00`), schedDaysShown: 14, setSchedDaysShown: noop,
    tasks, unscheduledTasks: [], expandedRecurringTasks: [], currentTime: new Date(at),
    getTasksForDate: (date) => byDate[dateToStr(date)] || [],
    getDeadlineTasksForDate: () => [],
    setNewTask: noop, setShowAddTask: noop, scheduleTaskAtNextSlot: noop,
    formatTime: (time) => time, toggleComplete: noop, openMobileEditTask: noop, postponeTask: noop,
    updateTaskNotes: noop, addSubtask: noop, toggleSubtask: noop, deleteSubtask: noop, updateSubtaskTitle: noop,
    getDoSessionsForTask: () => [], dailyNotes: {},
  };
  const features = {
    isVisibleForUser: () => true, routinesEnabled: false, todayRoutines: [],
    projects: [], goalsProjectsEnabled: false, generateAISubtasks: noop, aiSubtasksLoadingForTask: null, aiConfig: null,
    focusLog: {},
  };
  return renderToStaticMarkup(
    <I18nextProvider i18n={inst}>
      <DayPlannerContext.Provider value={planner}>
        <FeaturesContext.Provider value={features}>
          <SyncContext.Provider value={{ loadWikiNote: null, saveWikiNote: null, openInObsidian: null }}>
            <SchedView dateRange={{ from: SAT, to: SAT }} embedded />
          </SyncContext.Provider>
        </FeaturesContext.Provider>
      </DayPlannerContext.Provider>
    </I18nextProvider>,
  );
};

// The markup before the first day group is the Overdue section, if any.
const overdueSection = (html) => html.slice(0, html.indexOf('data-day-header-actions'));
const todaySection = (html) => html.slice(html.indexOf('data-day-header-actions'));

describe('the month day sheet with a task running past midnight', () => {
  it('at 00:08 the task is not overdue: TODAY shows its piece, from Fri, happening now', () => {
    const html = render(new Date(`${SAT}T00:08:00`));
    expect(overdueSection(html)).not.toContain('Overdue');
    expect(overdueSection(html)).not.toContain('Two-Hour Task');
    const today = todaySection(html);
    expect(today).toContain('Two-Hour Task');
    expect(today).toContain(`data-continuation-from="${FRI}"`);
    expect(today).toContain('from Fri');
    // The piece's own time, from midnight, as the timelines draw it.
    expect(today).toContain('00:00 · 60m');
    // Running, so the NOW mark, and not the past-due red.
    expect(today).toContain('Happening now');
    expect(today).not.toContain('text-red-400');
    // It is drawn before the day's own first task.
    expect(today.indexOf('Two-Hour Task')).toBeLessThan(today.indexOf('Daily planning'));
  });

  it('at 01:30 it has ended unfinished: overdue, listed there once', () => {
    const html = render(new Date(`${SAT}T01:30:00`));
    expect(overdueSection(html)).toContain('Overdue · 1');
    expect(overdueSection(html)).toContain('Two-Hour Task');
    expect(todaySection(html)).not.toContain('Two-Hour Task');
    expect(todaySection(html)).toContain('Daily planning');
  });

  it('a completed one is shown in TODAY as its piece, never overdue', () => {
    const html = render(new Date(`${SAT}T01:30:00`), { tasks: [{ ...twoHour, completed: true }, planning] });
    expect(overdueSection(html)).not.toContain('Two-Hour Task');
    expect(todaySection(html)).toContain(`data-continuation-from="${FRI}"`);
  });

  it('a task that ended before midnight is overdue at 00:08, with no piece', () => {
    const html = render(new Date(`${SAT}T00:08:00`), { tasks: [{ ...twoHour, startTime: '21:00' }, planning] });
    expect(overdueSection(html)).toContain('Overdue · 1');
    expect(html).not.toContain('data-continuation-from');
  });
});
