import React from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../context/FeaturesContext.jsx';
import { SyncContext } from '../context/SyncContext.jsx';
import { loaders } from '../locales.js';
import GlanceSidebar from './GlanceSidebar.jsx';
import MobileBottomSheets from './MobileBottomSheets.jsx';
import MobileGlanceSection from './MobileGlanceSection.jsx';
import { liveHiddenProjectIds } from '../utils/calendarFilter.js';

// The calendar filter's Hide projects (#2307): a section of the same popover
// (desktop, tablet) and bottom sheet (phone) as the tag filter, and the count
// of what the filter leaves off the days on screen on its button. Clicking
// is in CalendarFilterProjects.test.jsx.

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};
beforeEach(() => store.clear());

const TODAY = '2026-09-08';
const tags = ['errand', 'work'];
const goal = { id: 'g1', title: 'Home life', color: 'bg-emerald-500', status: 'active' };
const projects = [
  { id: 'p-home', title: 'Household', goalId: 'g1', status: 'active' },
  { id: 'p-work', title: 'Day job', status: 'active' },
  { id: 'p-old', title: 'Old stuff', status: 'archived' },
  { id: 'p-done', title: 'Finished thing', status: 'completed' },
];

let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

function contexts({ hidden = ['p-home'], count = 3, selectedTags = tags, goalsProjectsEnabled = true, filterableTags = tags } = {}) {
  const planner = {
    currentTime: new Date(`${TODAY}T17:25:00`),
    tasks: [], unscheduledTasks: [], todayAgenda: [], recurringTasks: [], expandedRecurringTasks: [],
    filterableTags, selectedTags, minimizedSections: {},
    showMobileTagFilter: true, setShowMobileTagFilter: vi.fn(), setShowTagManager: vi.fn(), tagFilterBtnRef: { current: null },
    toggleTag: vi.fn(), selectAllTags: vi.fn(), clearTagFilter: vi.fn(),
    hiddenProjects: hidden,
    liveHiddenProjects: liveHiddenProjectIds(hidden, projects, { enabled: goalsProjectsEnabled }),
    toggleHiddenProject: vi.fn(), showAllProjects: vi.fn(),
    calendarHiddenCount: count,
    visibleDates: [new Date(`${TODAY}T12:00:00`)], weekViewDates: [], effectiveViewMode: 'multi',
    agendaNowMarker: { insideTask: false, insertAfterIndex: 0, nowTimeStr: '17:25' },
    glanceAhead: { dayLabel: 'Wednesday', committedMinutes: 0, isEmpty: true, taskCount: 0, eventCount: 0, deadlineCount: 0 },
    getTodayStr: () => TODAY, getOverdueTasks: () => [], filterByTags: (list) => list, filterForCalendar: (list) => list,
    formatTime: (time) => time,
    timeToMinutes: (time) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; },
    darkMode: false, textPrimary: 'text-stone-900', textSecondary: 'text-stone-500',
    cardBg: 'bg-white', borderClass: 'border-stone-200', hoverBg: 'hover:bg-stone-100',
  };
  const features = {
    aiConfig: { features: {} }, myFrames: [], getFrameInstancesForDate: () => [],
    goals: [goal], projects, areas: [], goalsProjectsEnabled, hgVisibleProjects: [], isVisibleForUser: () => true,
  };
  return { planner, features };
}

function render(surface, options) {
  const { planner, features } = contexts(options);
  const body = surface === 'sheet' ? <MobileBottomSheets />
    : surface === 'mobile' ? <MobileGlanceSection />
      : <GlanceSidebar variant={surface} />;
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <DayPlannerContext.Provider value={planner}>
        <FeaturesContext.Provider value={features}>
          <SyncContext.Provider value={{}}>{body}</SyncContext.Provider>
        </FeaturesContext.Provider>
      </DayPlannerContext.Provider>
    </I18nextProvider>,
  );
}

const section = (html) => html.slice(html.indexOf('data-calendar-filter-projects'));
const buttonOf = (html) => {
  const at = html.lastIndexOf('<button', html.indexOf('data-calendar-filter-button'));
  return html.slice(at, html.indexOf('</button>', at));
};

describe.each(['desktop', 'tablet', 'sheet'])('the %s calendar filter', (surface) => {
  it('adds a Hide projects section after the tags', async () => {
    const html = render(surface);
    expect(html).toContain('Filter calendar');
    expect(html).toContain('Hide projects');
    expect(html.indexOf('data-calendar-filter-projects')).toBeGreaterThan(html.indexOf('>work<'));
    // "Manage tags…" still leads (#2136).
    expect(html.indexOf('data-manage-tags')).toBeLessThan(html.indexOf('>errand<'));
  });

  it('offers active projects only, grouped by goal as the project pickers do', async () => {
    const html = section(render(surface));
    expect(html).toContain('Home life');
    expect(html).toContain('Household');
    expect(html.indexOf('Home life')).toBeLessThan(html.indexOf('Household'));
    expect(html).not.toContain('Old stuff');
    expect(html).not.toContain('Finished thing');
    // The standalone projects fold under their heading while goals exist.
    expect(html).toContain('data-calendar-filter-group="standalone"');
  });

  it('ticks a hidden project, and offers to show all', async () => {
    const html = section(render(surface));
    expect(html).toMatch(/data-hide-project="p-home" aria-pressed="true"/);
    expect(html).toContain('data-show-all-projects');
    expect(section(render(surface, { hidden: [] }))).not.toContain('data-show-all-projects');
  });

  it('ignores a stale id: nothing ticked, nothing to show', async () => {
    const html = section(render(surface, { hidden: ['p-old', 'gone'], count: 0 }));
    expect(html).not.toContain('aria-pressed="true"');
    expect(html).not.toContain('data-show-all-projects');
  });

  it('says how many are hidden in its header, and nothing at zero', async () => {
    expect(render(surface)).toContain('3 hidden');
    expect(render(surface, { count: 1 })).toContain('1 hidden');
    expect(render(surface, { count: 0 })).not.toContain('data-calendar-hidden-label');
  });

  it('has no Hide projects section with Goals & Projects off', async () => {
    expect(render(surface, { goalsProjectsEnabled: false })).not.toContain('data-calendar-filter-projects');
  });
});

describe.each(['desktop', 'tablet', 'mobile'])('the %s filter button', (surface) => {
  it('shows the count of hidden tasks on the days shown', async () => {
    const button = buttonOf(render(surface));
    expect(button).toContain('data-calendar-hidden-count');
    expect(button).toContain('>3</span>');
    expect(button).toContain('3 tasks hidden on the days shown');
  });

  it('shows no count at zero', async () => {
    expect(buttonOf(render(surface, { count: 0, hidden: [] }))).not.toContain('data-calendar-hidden-count');
  });

  it('lights while a project is hidden, though every tag is picked', async () => {
    expect(buttonOf(render(surface))).toContain('bg-blue-500 text-white');
    expect(buttonOf(render(surface, { hidden: [], count: 0 }))).not.toContain('bg-blue-500 text-white');
    // A stale id lights nothing.
    expect(buttonOf(render(surface, { hidden: ['gone'], count: 0 }))).not.toContain('bg-blue-500 text-white');
  });

  it('is offered with projects to hide and no tags at all', async () => {
    expect(render(surface, { filterableTags: [], selectedTags: [] })).toContain('data-calendar-filter-button');
    expect(render(surface, { filterableTags: [], selectedTags: [], goalsProjectsEnabled: false })).not.toContain('data-calendar-filter-button');
  });
});
