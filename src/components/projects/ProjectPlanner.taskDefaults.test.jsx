import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../../locales.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import { SyncContext } from '../../context/SyncContext.jsx';
import ProjectPlanner from './ProjectPlanner.jsx';

// #2336: the planner's quick-add creates a task with the project's New task
// defaults, beside the colour and users it always copied. The card's
// quick-add builds its row with the same helper (utils/projectTaskDefaults.js
// projectTaskFields, tested there).

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const noop = () => {};

async function mount(project) {
  const bundle = await loaders.en();
  const i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  let rows = [];
  const setUnscheduledTasks = vi.fn((fn) => { rows = fn(rows); });
  let root;
  act(() => {
    root = create(
      <I18nextProvider i18n={i18n}>
        <DayPlannerContext.Provider value={{
          isMobile: false, isTablet: false, isLandscape: true, darkMode: false, use24HourClock: false,
          cardBg: '', borderClass: '', textPrimary: '', textSecondary: '', hoverBg: '',
          tasks: [], unscheduledTasks: [], recurringTasks: [],
          setUnscheduledTasks, reorderUnscheduledTasks: noop,
          openMobileEditTask: noop, scheduleTaskAtNextSlot: noop,
          formatTime: (t) => t, toggleComplete: noop, currentTime: new Date(), postponeTask: noop,
          updateTaskNotes: noop, addSubtask: noop, toggleSubtask: noop, deleteSubtask: noop, updateSubtaskTitle: noop,
        }}>
          <FeaturesContext.Provider value={{
            goals: [], projects: [project], goalsProjectsEnabled: true,
            updateProject: noop, isVisibleForUser: () => true,
            generateAISubtasks: noop, aiSubtasksLoadingForTask: null, aiConfig: null,
          }}>
            <SyncContext.Provider value={{ loadWikiNote: null, saveWikiNote: null, openInObsidian: null }}>
              <ProjectPlanner project={project} onClose={noop} />
            </SyncContext.Provider>
          </FeaturesContext.Provider>
        </DayPlannerContext.Provider>
      </I18nextProvider>,
      { createNodeMock: () => ({ focus: noop, scrollIntoView: noop, addEventListener: noop, removeEventListener: noop }) },
    );
  });
  const form = root.root.find((n) => n.type === 'form' && n.props['data-planner-quick-add'] !== undefined);
  const add = (title) => {
    act(() => { form.find((n) => n.type === 'input').props.onChange({ target: { value: title } }); });
    act(() => { form.props.onSubmit({ preventDefault: noop }); });
  };
  return { add, rows: () => rows };
}

describe('the planner quick-add', () => {
  it('a project with defaults gives the new task its duration, tags, notes and checklist', async () => {
    const { add, rows } = await mount({
      id: 'p-fit', title: 'Fitness', color: 'bg-emerald-500', assignedUserSyncIds: ['u1'],
      taskDefaults: { duration: 45, tags: ['health'], notes: 'Goal:', subtasks: ['Warm up'] },
    });
    add('Run 5k');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      title: 'Run 5k #health', duration: 45, notes: 'Goal:', color: 'bg-emerald-500',
      assignedUserSyncIds: ['u1'], projectId: 'p-fit', completed: false, priority: 0,
    });
    expect(rows()[0].subtasks.map((s) => s.title)).toEqual(['Warm up']);
  });

  it('a project without defaults adds what it always did', async () => {
    const { add, rows } = await mount({ id: 'p1', title: 'Plain', color: 'bg-orange-500' });
    add('Do it');
    expect(rows()[0]).toMatchObject({ title: 'Do it', duration: 30, notes: '', subtasks: [], color: 'bg-orange-500' });
    expect(rows()[0]).not.toHaveProperty('assignedUserSyncIds');
  });
});
