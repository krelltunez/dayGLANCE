import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../../locales.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import { SyncContext } from '../../context/SyncContext.jsx';
import ProjectCard from './ProjectCard.jsx';
import ProjectPlanner from './ProjectPlanner.jsx';

// Where a project's own target date becomes visible: the Goals card's header
// badge and the Project Planner's header line (2026-10-21). Both read
// utils/projectTargetDate.js, so the states are asserted once per surface:
// overdue red, due-soon amber (with the dark-mode variant), future neutral,
// and none/completed absent. Tasks keep their own deadlines; nothing here is
// about a task field.

const TODAY = '2026-10-21';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const noop = () => {};

async function i18n() {
  const bundle = await loaders.en();
  const inst = i18next.createInstance();
  await inst.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return inst;
}

const planner = () => ({
  isMobile: false, isTablet: false, isLandscape: true, darkMode: false, use24HourClock: false,
  cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', hoverBg: 'hover:bg-stone-100',
  tasks: [], unscheduledTasks: [], recurringTasks: [],
  setTasks: noop, setUnscheduledTasks: noop, reorderUnscheduledTasks: noop,
  openMobileEditTask: noop, scheduleTaskAtNextSlot: noop, postponeTask: noop, toggleComplete: noop, formatTime: (v) => v,
  getTodayStr: () => TODAY, currentTimeMinutes: 600,
  expandedNotesTaskId: null, setExpandedNotesTaskId: noop,
  updateTaskNotes: noop, addSubtask: noop, toggleSubtask: noop, deleteSubtask: noop, updateSubtaskTitle: noop,
  longPressTriggeredRef: { current: false }, longPressTimerRef: { current: null },
  mobileActiveTab: '', showDeadlinePicker: null, setShowDeadlinePicker: noop,
  pushUndo: noop, setUndoToast: noop,
});

const features = (projects) => ({
  goals: [], projects, goalsProjectsEnabled: true,
  deleteProject: noop, updateProject: noop, moveProject: noop, setPlannerProjectId: noop,
  generateAISubtasks: noop, aiSubtasksLoadingForTask: null, aiConfig: null,
  showGoalsDashboard: false, enterHyperGlanceMode: noop, isVisibleForUser: () => true,
});

const sync = { loadWikiNote: null, saveWikiNote: null, openInObsidian: null, obsidianConfig: { enabled: false }, bridgeHeartbeatRef: { current: null } };

// Only the fields under test vary: the PROJECT is always standalone (no goal),
// active unless the case says completed, and carries the target date under test.
const renderCard = async (project) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18n()}>
    <DayPlannerContext.Provider value={planner()}>
      <FeaturesContext.Provider value={features([project])}>
        <SyncContext.Provider value={sync}>
          <ProjectCard project={project} onEditClick={noop} />
        </SyncContext.Provider>
      </FeaturesContext.Provider>
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);

const renderPlanner = async (project) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18n()}>
    <DayPlannerContext.Provider value={planner()}>
      <FeaturesContext.Provider value={features([project])}>
        <SyncContext.Provider value={sync}>
          <ProjectPlanner project={project} onClose={noop} />
        </SyncContext.Provider>
      </FeaturesContext.Provider>
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);

const card = { id: 'p1', title: 'Roof', status: 'active', color: 'bg-blue-500' };

/** The badge's own class list, so unrelated hover: utilities cannot match. */
const badgeClass = (html) => /data-project-target-date="true"[^>]*class="([^"]*)"/.exec(html)?.[1] ?? '';

describe('the project card\'s target-date badge', () => {
  it('shows an overdue target date in red, naming the days overdue', async () => {
    const html = await renderCard({ ...card, targetDate: '2026-10-05' });
    expect(html).toContain('data-project-target-date');
    expect(badgeClass(html)).toContain('text-red-500');
    expect(html).toMatch(/Oct\s*5/);
    expect(html).toMatch(/16d overdue/);
    expect(html).toContain('Target:');
  });

  it('shows a due-soon target date in amber, matching the planner in dark mode, and a far one neutrally', async () => {
    const soon = await renderCard({ ...card, targetDate: '2026-10-25' });
    expect(soon).toContain('data-project-target-date');
    expect(badgeClass(soon)).toContain('text-amber-600');
    // The planner header already carried the dark variant; the card did not.
    expect(badgeClass(soon)).toContain('dark:text-amber-400');
    const far = await renderCard({ ...card, targetDate: '2026-12-31' });
    expect(far).toContain('data-project-target-date');
    expect(badgeClass(far)).not.toContain('text-red-500');
    expect(badgeClass(far)).not.toContain('text-amber-600');
  });

  it('sits under the title, not beside it, so the header buttons cannot squeeze the title under it', async () => {
    const html = await renderCard({ ...card, title: 'GLANCElauncher', targetDate: '2026-10-25' });
    // The title (with an On hold chip, when there is one) is a row of its
    // own; the date comes after that row, under it, never inside it.
    const block = html.slice(html.indexOf('data-project-title-block'));
    const row = /<div data-project-title-row="true"[^>]*>([\s\S]*?)<\/div>/.exec(block)?.[1] ?? '';
    expect(row).toContain('GLANCElauncher');
    expect(row).not.toContain('data-project-target-date');
    expect(block).toMatch(/GLANCElauncher<\/span><\/div><span data-project-target-date="true"/);
    // A one-word title wraps rather than running out of its box.
    expect(/<span class="([^"]*)">GLANCElauncher</.exec(block)?.[1]).toContain('break-words');
  });

  it('renders nothing without a target date, and hides it on a completed project', async () => {
    expect(await renderCard(card)).not.toContain('data-project-target-date');
    expect(await renderCard({ ...card, status: 'completed', targetDate: '2026-10-05' })).not.toContain('data-project-target-date');
  });
});

describe('the project planner\'s target-date line', () => {
  it('carries the date beside the goal/Planner subtitle, red when overdue', async () => {
    const html = await renderPlanner({ ...card, targetDate: '2026-10-05' });
    expect(html).toContain('data-project-target-date');
    expect(badgeClass(html)).toContain('text-red-500');
    expect(html).toMatch(/Oct\s*5/);
    expect(html).toContain('Standalone project');
  });

  it('is absent without a target date', async () => {
    expect(await renderPlanner(card)).not.toContain('data-project-target-date');
  });
});
