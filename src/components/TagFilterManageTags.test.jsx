import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../context/FeaturesContext.jsx';
import { SyncContext } from '../context/SyncContext.jsx';
import { loaders } from '../locales.js';
import GlanceSidebar from './GlanceSidebar.jsx';
import MobileBottomSheets from './MobileBottomSheets.jsx';

// "Manage tags…" sat at the foot of the tag filter, below a list that
// scrolls, and went unfound (a user wrote in, 2026-10-27). It now leads the
// filter on both surfaces, and the desktop row names its key.

// Node 25 defines a localStorage of its own that has no getItem without
// --localstorage-file, so stub unless a working one is already there.
if (typeof globalThis.localStorage?.getItem !== 'function') {
  delete globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}

const TODAY = '2026-09-08';
const tags = ['app', 'chores', 'dayglance', 'family', 'financial', 'zzz-last'];

async function i18n() {
  const bundle = await loaders.en();
  const inst = i18next.createInstance();
  await inst.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return inst;
}

async function render(surface) {
  const planner = {
    currentTime: new Date(`${TODAY}T17:25:00`),
    tasks: [], unscheduledTasks: [], todayAgenda: [], recurringTasks: [], expandedRecurringTasks: [],
    filterableTags: tags, selectedTags: tags, minimizedSections: {},
    showMobileTagFilter: true, setShowMobileTagFilter: vi.fn(), setShowTagManager: vi.fn(), tagFilterBtnRef: { current: null },
    toggleTag: vi.fn(), selectAllTags: vi.fn(), clearTagFilter: vi.fn(),
    visibleDates: [new Date(`${TODAY}T12:00:00`)], weekViewDates: [], effectiveViewMode: 'multi',
    agendaNowMarker: { insideTask: false, insertAfterIndex: 0, nowTimeStr: '17:25' },
    glanceAhead: { dayLabel: 'Wednesday', committedMinutes: 0, isEmpty: true, taskCount: 0, eventCount: 0, deadlineCount: 0 },
    getTodayStr: () => TODAY, getOverdueTasks: () => [], filterByTags: (list) => list,
    formatTime: (time) => time,
    timeToMinutes: (time) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; },
    darkMode: false, textPrimary: 'text-stone-900', textSecondary: 'text-stone-500',
    cardBg: 'bg-white', borderClass: 'border-stone-200', hoverBg: 'hover:bg-stone-100',
  };
  const features = {
    aiConfig: { features: {} }, myFrames: [], getFrameInstancesForDate: () => [],
    goals: [], projects: [], hgVisibleProjects: [], isVisibleForUser: () => true,
  };
  return renderToStaticMarkup(
    <I18nextProvider i18n={await i18n()}>
      <DayPlannerContext.Provider value={planner}>
        <FeaturesContext.Provider value={features}>
          <SyncContext.Provider value={{}}>
            {surface === 'sheet' ? <MobileBottomSheets /> : <GlanceSidebar variant={surface} />}
          </SyncContext.Provider>
        </FeaturesContext.Provider>
      </DayPlannerContext.Provider>
    </I18nextProvider>,
  );
}

describe.each(['desktop', 'tablet', 'sheet'])('the %s tag filter', (surface) => {
  it('leads with "Manage tags…", above the tag list', async () => {
    const html = await render(surface);
    const manage = html.indexOf('data-manage-tags');
    expect(manage).toBeGreaterThan(-1);
    expect(manage).toBeLessThan(html.indexOf('>app<'));
    expect(manage).toBeLessThan(html.indexOf('>zzz-last<'));
  });
});

describe('the key on the row', () => {
  it('names # on the desktop, and not on a touch surface', async () => {
    const row = (html) => html.slice(html.indexOf('data-manage-tags'), html.indexOf('</button>', html.indexOf('data-manage-tags')));
    expect(row(await render('desktop'))).toContain('>#</kbd>');
    expect(row(await render('tablet'))).not.toContain('<kbd');
    expect(row(await render('sheet'))).not.toContain('<kbd');
  });
});
