import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import { SyncContext } from '../../context/SyncContext.jsx';
import { loaders } from '../../locales.js';
import MonthDaySheet from './MonthDaySheet.jsx';

// useSchedAgendaState reads view preferences from localStorage in its state
// initialisers; there is no DOM here, so give it an empty store.
if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}

// Static markup (no jsdom): what the sheet renders for a date. The dismissal
// paths are the controller's and are covered in utils/sheetDismissal.test.js.

async function i18nFor(language) {
  const bundle = await loaders[language]();
  const i18n = i18next.createInstance();
  await i18n.init({ lng: language, fallbackLng: false, resources: { [language]: { translation: bundle } }, interpolation: { escapeValue: false } });
  return i18n;
}
const dateToStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const byDate = {
  '2026-09-16': [{ id: 't16', title: 'Deep work on the sixteenth', date: '2026-09-16', startTime: '09:00', duration: 60, color: 'bg-blue-500' }],
  '2026-09-17': [{ id: 't17', title: 'Only on the seventeenth', date: '2026-09-17', startTime: '09:00', duration: 60, color: 'bg-red-500' }],
};
const planner = {
  darkMode: false, cardBg: 'bg-white', borderClass: 'border-stone-300', textPrimary: 'text-stone-900', textSecondary: 'text-stone-600', hoverBg: 'hover:bg-stone-100',
  selectedDate: new Date('2026-09-12T12:00:00'), schedDaysShown: 14, setSchedDaysShown: () => {},
  tasks: Object.values(byDate).flat(), unscheduledTasks: [], expandedRecurringTasks: [], currentTime: new Date('2026-09-12T12:00:00'),
  getTasksForDate: (date) => byDate[dateToStr(date)] || [],
  getDeadlineTasksForDate: () => [],
  formatTime: (t) => t, use24HourClock: true, isTablet: false,
  setNewTask: () => {}, setShowAddTask: () => {}, scheduleTaskAtNextSlot: () => {},
  toggleComplete: () => {}, openMobileEditTask: () => {}, postponeTask: () => {},
  updateTaskNotes: () => {}, addSubtask: () => {}, toggleSubtask: () => {}, deleteSubtask: () => {}, updateSubtaskTitle: () => {},
  calendarRef: { current: null },
};
const features = { isVisibleForUser: () => true, routinesEnabled: false, todayRoutines: [], routineCompletions: {}, projects: [], goals: [], goalsProjectsEnabled: false, aiConfig: { features: {} } };
const render = (i18n, date) => renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <DayPlannerContext.Provider value={planner}><FeaturesContext.Provider value={features}><SyncContext.Provider value={{}}>
      <MonthDaySheet date={date} onClose={() => {}} />
    </SyncContext.Provider></FeaturesContext.Provider></DayPlannerContext.Provider>
  </I18nextProvider>,
);

describe('MonthDaySheet', () => {
  it('opens as a dialog for the date and renders SCHED scoped to that one day', async () => {
    const html = render(await i18nFor('en'), '2026-09-16');
    expect(html).toContain('data-month-day-sheet="2026-09-16"');
    expect(html).toMatch(/role="dialog" aria-modal="true" aria-label="Wednesday, September 16"/);
    expect(html).toContain('data-sched-view="scoped"');
    expect(html).toContain('Deep work on the sixteenth');
    expect(html).not.toContain('Only on the seventeenth');
    expect(html).not.toContain('Show 14 more days');
    expect(html).not.toContain('Empty days');
  });

  it('shows an empty day rather than nothing', async () => {
    const html = render(await i18nFor('en'), '2026-09-20');
    expect(html).toContain('data-sched-view="scoped"');
    expect(html).toContain('Add task');
    expect(html).not.toContain('Nothing scheduled in this window');
  });

  it('carries the dismissal affordances: handle, close button, backdrop', async () => {
    const html = render(await i18nFor('en'), '2026-09-16');
    expect(html).toContain('data-month-day-sheet-handle');
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain('data-month-day-sheet-backdrop');
    expect(html).toContain('data-month-day-sheet-content');
    expect(html).toContain('h-[88vh]');
  });

  it('renders nothing without a date', async () => {
    expect(render(await i18nFor('en'), null)).toBe('');
  });

  it('localizes the title', async () => {
    const de = render(await i18nFor('de'), '2026-09-16');
    expect(de).toContain('aria-label="Mittwoch, 16. September"');
    expect(de).toContain('aria-label="Schließen"');
  });
});
