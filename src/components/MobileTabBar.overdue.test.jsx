import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';

// The Goals tab's count badge turns red when something is overdue: a goal
// past its target date, and now a project past its own (#2160).

const features = vi.hoisted(() => ({ current: null }));
vi.mock('../context/DayPlannerContext.jsx', () => ({
  useDayPlannerCtx: () => ({
    tabBarRef: null, currentTime: new Date(),
    mobileActiveTab: 'timeline', setMobileActiveTab: () => {},
    setMobileSettingsView: () => {},
    cardBg: '', borderClass: '', textSecondary: '',
    filteredUnscheduledTasks: [], todayAgenda: [],
    goToToday: () => {},
  }),
}));
vi.mock('../context/FeaturesContext.jsx', () => ({ useFeaturesCtx: () => features.current }));

const { default: MobileTabBar } = await import('./MobileTabBar.jsx');

const PAST = '2020-01-01';
const goal = { id: 'g1', title: 'Goal', status: 'active' };

async function badgeIsRed(projects, goals = [goal]) {
  features.current = {
    goalsProjectsEnabled: true, goals, projects, handleRoutinesDone: () => {},
    isVisibleForUser: (e) => !e.hidden,
  };
  const bundle = await loaders.en();
  const i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  const html = renderToStaticMarkup(<I18nextProvider i18n={i18n}><MobileTabBar /></I18nextProvider>);
  return html.includes('bg-red-600');
}

describe('MobileTabBar overdue badge', () => {
  beforeEach(() => { features.current = null; });

  it('turns red for an active project past its target date', async () => {
    expect(await badgeIsRed([{ id: 'p1', status: 'active', targetDate: PAST }])).toBe(true);
  });

  it('stays blue for a completed, archived or hidden project, or one not yet due', async () => {
    expect(await badgeIsRed([
      { id: 'p2', status: 'completed', targetDate: PAST },
      { id: 'p3', status: 'archived', targetDate: PAST },
      { id: 'p4', status: 'active', targetDate: PAST, hidden: true },
      { id: 'p5', status: 'active', targetDate: '2999-01-01' },
      // On hold: paused, so it stops asking for attention.
      { id: 'p6', status: 'on-hold', targetDate: PAST },
    ])).toBe(false);
  });

  it('still turns red for an overdue goal', async () => {
    expect(await badgeIsRed([], [{ ...goal, targetDate: PAST }])).toBe(true);
  });
});
