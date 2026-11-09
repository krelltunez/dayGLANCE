import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../../locales.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import { SyncContext } from '../../context/SyncContext.jsx';
import GoalDashboard from './GoalDashboard.jsx';

// A project on hold on its REAL card (utils/projectStatus.js): muted, an "On
// hold" chip, and nothing asking for attention: no target-date warning and no
// hyperGLANCE session, beside an active twin that shows both. The space and
// its harness are GoalDashboard.space.test.jsx's, the card unmocked.
vi.mock('./GoalTimeline.jsx', () => ({
  DEFAULT_PERIOD: '6m',
  default: ({ goals, periodKey, showRange = true }) => (
    <div data-goal-timeline={goals.map(g => g.id).join(',')} data-period={periodKey} data-show-range={showRange ? '1' : '0'} />
  ),
  GoalRangeToggle: ({ value }) => <div data-goal-range={value} />,
}));

async function i18nFor(language) {
  const bundle = await loaders[language]();
  const i18n = i18next.createInstance();
  await i18n.init({ lng: language, fallbackLng: false, resources: { [language]: { translation: bundle } }, interpolation: { escapeValue: false } });
  return i18n;
}

const GOALS = [
  { id: 'done', title: 'Shipped goal', status: 'completed', color: 'bg-green-500', targetDate: '2026-01-01' },
  { id: 'ios', title: 'Ship iOS Apps', status: 'active', color: 'bg-blue-500', areaId: 'dev', targetDate: '2099-01-01' },
  { id: 'electron', title: 'Ship Electron Apps', status: 'active', color: 'bg-purple-500', areaId: 'dev' },
  { id: 'old', title: 'Archived goal', status: 'archived' },
];
const PROJECTS = [
  { id: 'asc', title: 'App Store Connect', goalId: 'ios', status: 'active', sortOrder: 0 },
  { id: 'billing', title: 'Setup App Billing', goalId: 'ios', status: 'completed', sortOrder: 10 },
  { id: 'dg', title: 'dayGLANCE', status: 'active' },
  { id: 'gone', title: 'Archived project', status: 'archived' },
];

const planner = () => ({
  tasks: [{ id: 't1', projectId: 'dg', title: 'x' }], unscheduledTasks: [{ id: 't2', projectId: 'dg', title: 'y' }], recurringTasks: [],
  setTasks: vi.fn(), setUnscheduledTasks: vi.fn(),
  getTodayStr: () => '2026-09-22',
  showAddTask: false, setShowAddTask: vi.fn(), setShowNewTaskDeadlinePicker: vi.fn(),
  isMobile: false, isTablet: false, darkMode: false, use24HourClock: false,
  cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', hoverBg: 'hover:bg-stone-100',
  expandedNotesTaskId: null, setExpandedNotesTaskId: vi.fn(),
  spaceCardSize: 'normal', setSpaceCardSize: vi.fn(),
});
const features = (overrides = {}) => ({
  goals: GOALS, projects: PROJECTS, setProjects: vi.fn(),
  areas: [{ id: 'dev', name: 'App Development', color: 'bg-orange-500', order: 0 }],
  goalsAreaFilter: 'all', setGoalsAreaFilter: vi.fn(), goalsViewMode: 'list', setGoalsViewMode: vi.fn(),
  goalsDashboardFocusId: null, setGoalsDashboardFocusId: vi.fn(),
  addGoal: vi.fn(), updateGoal: vi.fn(), deleteGoal: vi.fn(),
  addProject: vi.fn(), updateProject: vi.fn(), moveProject: vi.fn(),
  plannerProjectId: null, setPlannerProjectId: vi.fn(),
  isVisibleForUser: () => true, multiUserEnabled: false, users: [],
  ...overrides,
});

let i18n;
beforeEach(async () => { i18n = i18n || await i18nFor('en'); });

const today = new Date();
const todayIso = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 1).toISOString();
const hyperglance = {
  enabled: true, isRecurring: true, scheduledTime: '09:00', scheduledDuration: 60, completions: [], createdAt: todayIso,
  scheduledDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
};
// Twins under one goal, both overdue and with a session due today.
const twin = (id, status) => ({ id, title: id, goalId: 'ios', status, targetDate: '2020-01-01', sortOrder: 0, hyperglance });

const html = () => renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <DayPlannerContext.Provider value={{ ...planner(), currentTimeMinutes: 0, currentTime: new Date() }}>
      <FeaturesContext.Provider value={features({ projects: [twin('live', 'active'), twin('paused', 'on-hold')] })}>
        <SyncContext.Provider value={{ createProjectNote: vi.fn(), openInObsidian: vi.fn() }}>
          <GoalDashboard desktop isActive />
        </SyncContext.Provider>
      </FeaturesContext.Provider>
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);
// One card's markup: from its title to the next card's title.
const card = (markup, title) => {
  const start = markup.indexOf(`>${title}<`);
  expect(start, title).toBeGreaterThan(-1);
  const next = ['live', 'paused'].filter((t) => t !== title).map((t) => markup.indexOf(`>${t}<`, start + 1)).filter((i) => i > start);
  return markup.slice(Math.max(0, markup.lastIndexOf('<div', start - 200)), next.length ? Math.min(...next) : undefined);
};

describe('a project on hold, on its card', () => {
  it('is muted and says it is on hold, while its active twin does not', () => {
    const markup = html();
    expect(markup).toContain('data-project-on-hold="true"');
    expect(card(markup, 'paused')).toContain('data-on-hold-chip');
    expect(card(markup, 'live')).not.toContain('data-on-hold-chip');
  });

  // MUTATION: put the chip back among the header's buttons and this fails.
  it('the chip sits with the title, before any of the header\'s buttons', () => {
    const paused = card(html(), 'paused');
    const title = paused.indexOf('>paused<');
    const chip = paused.indexOf('data-on-hold-chip');
    const firstButton = paused.indexOf('<button', title);
    expect(chip).toBeGreaterThan(title);
    expect(firstButton === -1 || chip < firstButton).toBe(true);
    expect(paused.slice(paused.indexOf('data-project-title-block'), chip)).not.toContain('<button');
  });

  it('asks for nothing: no target-date warning and no hyperGLANCE session, both of which the active twin shows', () => {
    const markup = html();
    const live = card(markup, 'live');
    const paused = card(markup, 'paused');
    expect(live).toContain('lucide-zap');
    expect(paused).not.toContain('lucide-zap');
    expect(live).toMatch(/overdue/i);
    expect(paused).not.toMatch(/overdue/i);
  });
});
