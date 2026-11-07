import React from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../context/FeaturesContext.jsx';
import { SyncContext } from '../context/SyncContext.jsx';
import { loaders } from '../locales.js';
import GlanceSidebar from './GlanceSidebar.jsx';
import MobileGlanceSection from './MobileGlanceSection.jsx';

// The GLANCE agenda's task rows print a start–end range (#2278). A task from
// 23:00 for two hours read "23:00 – 25:00"; it reads the real clock time with
// the app's next-day mark (components/TimeRange.jsx), on desktop and mobile.

const TODAY = '2026-11-06';
let inst;
beforeAll(async () => {
  const bundle = await loaders.en();
  inst = i18next.createInstance();
  await inst.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

const row = (over) => ({ id: 'x', title: 'Task', date: TODAY, startTime: '09:00', duration: 30, completed: false, color: 'bg-blue-500', _agendaType: 'scheduled', ...over });

function render(surface, todayAgenda) {
  const planner = {
    currentTime: new Date(`${TODAY}T08:00:00`),
    tasks: [], unscheduledTasks: [], todayAgenda, recurringTasks: [],
    filterableTags: [], selectedTags: [], minimizedSections: {},
    agendaNowMarker: { insideTask: false, insertAfterIndex: -1, nowTimeStr: '08:00', gapMinutes: 60 },
    glanceAhead: { dayLabel: 'Saturday', committedMinutes: 0, isEmpty: true, taskCount: 0, eventCount: 0, deadlineCount: 0 },
    getTodayStr: () => TODAY,
    getOverdueTasks: () => [],
    filterByTags: (tasks) => tasks,
    formatTime: (time) => time,
    timeToMinutes: (time) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; },
    darkMode: false,
    textPrimary: '', textSecondary: '', cardBg: '', borderClass: '', hoverBg: '',
  };
  const features = {
    aiConfig: { features: {} }, myFrames: [], getFrameInstancesForDate: () => [],
    goals: [], projects: [], hgVisibleProjects: [], goalsProjectsEnabled: false,
    isVisibleForUser: () => true,
  };
  return renderToStaticMarkup(
    <I18nextProvider i18n={inst}>
      <DayPlannerContext.Provider value={planner}>
        <FeaturesContext.Provider value={features}>
          <SyncContext.Provider value={{}}>
            {surface === 'mobile' ? <MobileGlanceSection /> : <GlanceSidebar variant="desktop" />}
          </SyncContext.Provider>
        </FeaturesContext.Provider>
      </DayPlannerContext.Provider>
    </I18nextProvider>,
  );
}

describe.each(['desktop', 'mobile'])('%s GLANCE agenda time range', (surface) => {
  it('a task running past midnight ends at 01:00, marked +1', () => {
    const html = render(surface, [row({ id: 'night', title: 'Two-Hour Task', startTime: '23:00', duration: 120 })]);
    expect(html).toMatch(/23:00 – 01:00<sup data-next-day="true"[^>]*>\+1<\/sup>/);
    expect(html).not.toContain('25:00');
  });

  it('an ordinary task is unchanged', () => {
    const html = render(surface, [row({ startTime: '09:00', duration: 30 })]);
    expect(html).toContain('09:00 – 09:30');
    expect(html).not.toContain('data-next-day');
  });
});
