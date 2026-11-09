import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../../locales.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import { SyncContext } from '../../context/SyncContext.jsx';
import GoalDashboard from './GoalDashboard.jsx';

// A request to go to a completed goal (a goal ring, the Goal widget, a link)
// while completed goals are hidden: the space shows them, on desktop and on
// the phone, rather than landing on nothing (utils/goalFilters.js). Effects,
// so mounted with the test renderer; the harness is GoalDashboard.space.test.jsx's.
vi.mock('../projects/ProjectCard.jsx', () => ({
  default: React.forwardRef(({ project, compact, onMoveToClick }, ref) => (
    <div ref={ref} data-project-card={project.id} data-compact={compact ? '1' : '0'} data-move-to={onMoveToClick ? '1' : '0'}>{project.title}</div>
  )),
}));
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
  showCompletedGoals: false, setShowCompletedGoals: vi.fn(),
  goalsDashboardFocusId: null, setGoalsDashboardFocusId: vi.fn(),
  addGoal: vi.fn(), updateGoal: vi.fn(), deleteGoal: vi.fn(),
  addProject: vi.fn(), updateProject: vi.fn(), moveProject: vi.fn(),
  plannerProjectId: null, setPlannerProjectId: vi.fn(),
  isVisibleForUser: () => true, multiUserEnabled: false, users: [],
  ...overrides,
});

let i18n;
beforeEach(async () => {
  i18n = i18n || await i18nFor('en');
  // No DOM in this suite: what the space's effects reach for.
  const listeners = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  globalThis.document = { ...listeners, activeElement: null, body: {} };
  globalThis.CSS = { escape: (v) => String(v) };
  globalThis.window = { ...listeners, innerWidth: 1400, innerHeight: 900, matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) };
});
afterEach(() => { delete globalThis.document; delete globalThis.window; delete globalThis.CSS; });

const mount = (props, feat) => {
  let root;
  act(() => {
    root = create(
      <I18nextProvider i18n={i18n}>
        <DayPlannerContext.Provider value={planner()}>
          <FeaturesContext.Provider value={features(feat)}>
            <SyncContext.Provider value={{ createProjectNote: vi.fn(), openInObsidian: vi.fn() }}>
              <GoalDashboard {...props} />
            </SyncContext.Provider>
          </FeaturesContext.Provider>
        </DayPlannerContext.Provider>
      </I18nextProvider>,
      { createNodeMock: () => ({ scrollIntoView: vi.fn(), scrollTo: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), getBoundingClientRect: () => ({ top: 0, left: 0, width: 800, height: 600, right: 800, bottom: 600 }), querySelector: () => null, querySelectorAll: () => [], offsetLeft: 0, offsetWidth: 0, clientWidth: 800, scrollLeft: 0, style: {} }) },
    );
  });
  return root;
};

describe('a request to go to a completed goal while they are hidden', () => {
  // MUTATION: widen only the area filter (as before) and the request lands on
  // nothing: the goal stays hidden for being completed.
  it('desktop: shows completed goals', () => {
    const setShowCompletedGoals = vi.fn();
    mount({ desktop: true, isActive: true }, { goalsDashboardFocusId: 'done', setShowCompletedGoals });
    expect(setShowCompletedGoals).toHaveBeenCalledWith(true);
  });

  it('phone: shows completed goals', () => {
    const setShowCompletedGoals = vi.fn();
    mount({ embedded: true, isActive: true }, { goalsDashboardFocusId: 'done', setShowCompletedGoals });
    expect(setShowCompletedGoals).toHaveBeenCalledWith(true);
  });

  it('leaves the setting alone for an active goal already shown', () => {
    const setShowCompletedGoals = vi.fn();
    mount({ desktop: true, isActive: true }, { goalsDashboardFocusId: 'ios', setShowCompletedGoals });
    expect(setShowCompletedGoals).not.toHaveBeenCalled();
  });
});
