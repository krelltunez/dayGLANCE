import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../../locales.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import { SyncContext } from '../../context/SyncContext.jsx';
import GoalDashboard from './GoalDashboard.jsx';

// The Goals & Projects test fixture (docs/fixtures/goals-space-test-data.json,
// made by scripts/gen-goals-space-test-data.mjs) is only useful while the app
// can actually render it. This regenerates it for today and renders the
// desktop space over it with the REAL GoalCard and ProjectCard, so a field the
// cards start expecting, or a state the generator claims (stalled, overdue,
// completed), fails here before someone restores the file to test by hand.

const generate = () => {
  const out = join(mkdtempSync(join(tmpdir(), 'gs-fixture-')), 'fixture.json');
  execFileSync('node', ['scripts/gen-goals-space-test-data.mjs', out], { cwd: process.cwd() });
  return JSON.parse(readFileSync(out, 'utf8'));
};

async function i18nFor(language) {
  const bundle = await loaders[language]();
  const i18n = i18next.createInstance();
  await i18n.init({ lng: language, fallbackLng: false, resources: { [language]: { translation: bundle } }, interpolation: { escapeValue: false } });
  return i18n;
}

const noop = () => {};
const render = async (data, features = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18nFor('en')}>
    <DayPlannerContext.Provider value={{
      tasks: data.tasks, unscheduledTasks: data.unscheduledTasks, recurringTasks: data.recurringTasks,
      setTasks: noop, setUnscheduledTasks: noop, reorderUnscheduledTasks: noop,
      openMobileEditTask: noop, getTodayStr: () => data.exportedAt.slice(0, 10), currentTimeMinutes: 600,
      showAddTask: false, setShowAddTask: noop, setShowNewTaskDeadlinePicker: noop,
      isMobile: false, isTablet: false, darkMode: false, use24HourClock: false,
      cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', hoverBg: 'hover:bg-stone-100',
      expandedNotesTaskId: null, setExpandedNotesTaskId: noop,
      updateTaskNotes: noop, addSubtask: noop, toggleSubtask: noop, deleteSubtask: noop, updateSubtaskTitle: noop,
      longPressTriggeredRef: { current: false }, longPressTimerRef: { current: null }, mobileActiveTab: 'dayglance',
    }}>
      <FeaturesContext.Provider value={{
        goals: data.goals, projects: data.projects, areas: data.areas, setProjects: noop,
        goalsAreaFilter: 'all', setGoalsAreaFilter: noop, goalsViewMode: 'list', setGoalsViewMode: noop,
        goalsDashboardFocusId: null, setGoalsDashboardFocusId: noop,
        addGoal: noop, updateGoal: noop, deleteGoal: noop, addProject: noop, updateProject: noop, deleteProject: noop, moveProject: noop,
        plannerProjectId: null, setPlannerProjectId: noop, generateAISubtasks: noop, aiSubtasksLoadingForTask: null, aiConfig: null,
        showGoalsDashboard: true, enterHyperGlanceMode: noop,
        isVisibleForUser: () => true, multiUserEnabled: false, users: [],
        ...features,
      }}>
        <SyncContext.Provider value={{ createProjectNote: noop, openInObsidian: noop, loadWikiNote: noop, saveWikiNote: noop }}>
          <GoalDashboard desktop isActive />
        </SyncContext.Provider>
      </FeaturesContext.Provider>
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);

describe('goals-space test fixture', () => {
  const data = generate().data;
  const byTitle = (title) => data.goals.find(g => g.title === title);

  it('restores through the backup format and enables the feature', () => {
    expect(generate()).toMatchObject({ version: 1, data: { goalsProjectsEnabled: true } });
  });

  it('renders the whole space over the real cards with the states the generator promises', async () => {
    // Completed goals shown: hidden by default (utils/goalFilters.js), and
    // this renders every state the generator promises.
    const html = await render(data, { showCompletedGoals: true });
    const sidebar = html.slice(html.indexOf('data-goals-sidebar'), html.indexOf('data-goals-main'));
    const main = html.slice(html.indexOf('data-goals-main'));
    // Every non-archived goal is a sidebar row; the archived one is not.
    for (const g of data.goals) {
      expect(sidebar.includes(`data-goal-row="${g.id}"`), g.title).toBe(g.status !== 'archived');
    }
    // Completed goals sort first; the default selection is the first active one.
    const order = [...sidebar.matchAll(/data-goal-row="([^"]+)"/g)].map(m => m[1]);
    expect(order[0]).toBe(byTitle('File 2025 taxes').id);
    expect(sidebar).toContain('Completed');
    expect(sidebar).toMatch(/\d+d overdue/);
    expect(sidebar).toContain('3d left');
    expect(sidebar).toContain('lucide-link-2'); // lifeGLANCE-linked goal
    // The default selection is the first ACTIVE goal in target-date order: the
    // emergency fund (3 days out). Its card and only its project cards render.
    const fund = byTitle('Build a 6-month emergency fund');
    expect(main).toContain(`data-goal-list-view="${fund.id}"`);
    expect(main).toContain('Monthly budget review');
    expect(main).toContain('2/3 tasks');
    expect(main).not.toContain('App Store Connect');
    expect(main).toContain('Archived (2)');
  });

  it('shows the stalled flag on Launch marketing and hides it on the half-marathon goal', async () => {
    const vault = byTitle('GLANCEvault Pro launch');
    const half = byTitle('Run a half marathon');
    const vaultHtml = await render(data);
    // Sidebar rows carry the caution triangle when a child is stalled and the goal does not hide it.
    const row = (html, id) => html.match(new RegExp(`<button[^>]*data-goal-row="${id}"[\\s\\S]*?</button>`))[0];
    expect(row(vaultHtml, vault.id)).toContain('lucide-triangle-alert');
    expect(row(vaultHtml, half.id)).not.toContain('lucide-triangle-alert');
  });

  it('counts the OPEN standalone projects on the Projects tab', async () => {
    const html = await render(data);
    const open = data.projects.filter(p => !p.goalId && p.status === 'active');
    expect(open).toHaveLength(5);
    expect(html).toContain(`Projects <span class="text-[11px] font-normal text-stone-500">${open.length}</span>`);
  });

  // #2116 review: the scheduled marker in a project row must not read as a
  // disabled deadline button, which is exactly what it looked like — the same
  // Calendar glyph, in the same slot. It is now a clock with a tooltip, and the
  // deadline button belongs to unscheduled rows alone.
  it('a scheduled row carries a marker that cannot be mistaken for the deadline button', async () => {
    const fund = byTitle('Build a 6-month emergency fund');
    const project = data.projects.find(p => p.goalId === fund.id && p.status === 'active');
    // The card folds after 3 rows, so give this project exactly the two under test.
    const WITHOUT = (list) => list.filter(t => t.projectId !== project.id);
    const onTheClock = { id: 'row-scheduled', title: 'On the clock', projectId: project.id, date: '2026-10-16', startTime: '09:00', duration: 30, completed: false };
    const inTheInbox = { id: 'row-inbox', title: 'In the inbox', projectId: project.id, completed: false };
    const html = await render({
      ...data,
      exportedAt: '2026-10-16T09:00:00.000Z',
      tasks: [...WITHOUT(data.tasks), onTheClock],
      unscheduledTasks: [...WITHOUT(data.unscheduledTasks), inTheInbox],
    });
    const row = (id) => {
      const at = html.indexOf(`data-project-task="${id}"`);
      expect(at, `${id} was not rendered`).toBeGreaterThan(-1);
      const rest = html.slice(at);
      const next = rest.indexOf('data-project-task="', 1);
      return next === -1 ? rest : rest.slice(0, next);
    };

    const scheduledRow = row('row-scheduled');
    expect(scheduledRow).toContain('data-scheduled-marker');
    expect(scheduledRow).toContain('title="Scheduled"');
    expect(scheduledRow).toContain('lucide-clock');
    expect(scheduledRow).not.toMatch(/title="(Set deadline|Deadline:)/);

    expect(row('row-inbox')).toMatch(/<button[^>]*title="Set deadline"/);
  });
});
