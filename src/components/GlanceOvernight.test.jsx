import React from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../context/FeaturesContext.jsx';
import { SyncContext } from '../context/SyncContext.jsx';
import { loaders } from '../locales.js';
import { buildTodayAgenda, buildAgendaNowMarker } from '../utils/todayAgenda.js';
import GlanceSidebar from './GlanceSidebar.jsx';
import MobileGlanceSection from './MobileGlanceSection.jsx';

// The GLANCE agenda across midnight (#2278). The owner's scenario: a Friday
// 23:00 task of two hours, looked at on Saturday. At 00:08 it is running
// until 01:00: the agenda lists it as SCHED and the phone list do ("00:00 ·
// 60m", "from Fri"), in progress, and claims no free time before it ends. At
// 01:30 it is over: gone from today's list, and the free time runs to the
// next item. Built through the real agenda and marker (utils/todayAgenda.js),
// not a hand-made list.

const FRI = '2026-11-06';
const SAT = '2026-11-07';
const night = { id: 'night', title: 'Two-Hour Task #night', date: FRI, startTime: '23:00', duration: 120, completed: false, color: 'bg-blue-500' };
const breakfast = { id: 'breakfast', title: 'Breakfast', date: SAT, startTime: '09:00', duration: 30, completed: false, color: 'bg-green-500' };

let inst;
beforeAll(async () => {
  const bundle = await loaders.en();
  inst = i18next.createInstance();
  await inst.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

function render(surface, hhmm, { filterForCalendar = (list) => list } = {}) {
  const currentTime = new Date(`${SAT}T${hhmm}:00`);
  const isVisibleForUser = () => true;
  const todayAgenda = buildTodayAgenda({
    todayStr: SAT, nowMinutes: currentTime.getHours() * 60 + currentTime.getMinutes(),
    tasks: [night, breakfast], expandedRecurringTasks: [], unscheduledTasks: [], isVisibleForUser,
  });
  const agendaNowMarker = buildAgendaNowMarker({ todayAgenda, now: currentTime, unscheduledTasks: [], isVisibleForUser });
  const planner = {
    currentTime,
    tasks: [night, breakfast], unscheduledTasks: [], todayAgenda, recurringTasks: [],
    filterableTags: [], selectedTags: [], minimizedSections: {},
    agendaNowMarker,
    glanceAhead: { dayLabel: 'Sunday', committedMinutes: 0, isEmpty: true, taskCount: 0, eventCount: 0, deadlineCount: 0 },
    getTodayStr: () => SAT,
    getOverdueTasks: () => [],
    filterByTags: (list) => list,
    filterForCalendar,
    formatTime: (time) => time,
    timeToMinutes: (time) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; },
    darkMode: false,
    textPrimary: '', textSecondary: '', cardBg: '', borderClass: '', hoverBg: '',
  };
  const features = {
    aiConfig: { features: {} }, myFrames: [], getFrameInstancesForDate: () => [],
    goals: [], projects: [], hgVisibleProjects: [], goalsProjectsEnabled: false,
    isVisibleForUser,
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

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe.each(['desktop', 'mobile'])('%s GLANCE agenda, the night before’s task (#2278)', (surface) => {
  it('at 00:08 it is listed first, as its piece from 00:00, from Fri, and in progress', () => {
    const html = render(surface, '00:08');
    const words = text(html);
    expect(words).toContain('Two-Hour Task');
    expect(words).toContain('00:00 · 60m');
    expect(html).toContain(`data-continuation-from="${FRI}"`);
    expect(words).toContain('from Fri');
    expect(words).toContain('In progress');
    // Listed before the day's own first task.
    expect(words.indexOf('Two-Hour Task')).toBeLessThan(words.indexOf('Breakfast'));
    // Never its own start as if it were tonight's.
    expect(words).not.toContain('23:00');
  });

  it('at 00:08 the now marker claims no free time', () => {
    const words = text(render(surface, '00:08'));
    expect(words).not.toContain('of free time');
    expect(words).not.toContain('all done');
  });

  it('at 01:30 it is over: gone from the list, and the free time starts now and runs to 09:00', () => {
    const words = text(render(surface, '01:30'));
    expect(words).not.toContain('Two-Hour Task');
    expect(words).toContain('01:30, 7h 30m of free time');
    expect(words.indexOf('of free time')).toBeLessThan(words.indexOf('Breakfast'));
  });

  it('follows the calendar filter, as the timelines’ continuations do', () => {
    const hideNight = (list) => list.filter((t) => !String(t.title).includes('#night'));
    const words = text(render(surface, '00:08', { filterForCalendar: hideNight }));
    expect(words).not.toContain('Two-Hour Task');
    expect(words).toContain('Breakfast');
  });
});
