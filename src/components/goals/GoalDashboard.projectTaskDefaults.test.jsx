import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../../locales.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import { SyncContext } from '../../context/SyncContext.jsx';
import { ProjectForm } from './GoalDashboard.jsx';

// #2336: the project form's "New task defaults". It hands the project its
// defaults as one stored field (`taskDefaults`), absent when none, through
// the existing addProject/updateProject spread.

const planner = {
  tasks: [], unscheduledTasks: [], isMobile: false, isTablet: false, darkMode: false, use24HourClock: false,
  cardBg: '', borderClass: '', textPrimary: '', textSecondary: '', hoverBg: '',
};

async function renderForm(props, projects = []) {
  const bundle = await loaders.en();
  const i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  let root;
  await act(async () => {
    root = create(
      <I18nextProvider i18n={i18n}>
        <DayPlannerContext.Provider value={planner}>
          <FeaturesContext.Provider value={{ multiUserEnabled: false, users: [], goals: [], projects }}>
            <SyncContext.Provider value={{ obsidianConfig: { enabled: false } }}>
              <ProjectForm goals={[]} onCancel={vi.fn()} {...props} />
            </SyncContext.Provider>
          </FeaturesContext.Provider>
        </DayPlannerContext.Provider>
      </I18nextProvider>,
    );
  });
  const r = root.root;
  const byData = (attr) => r.findAll((n) => typeof n.type === 'string' && n.props[attr] !== undefined)[0];
  const type = (attr, value) => act(() => { byData(attr).props.onChange({ target: { value } }); });
  const submit = () => act(() => { r.find((n) => n.type === 'form').props.onSubmit({ preventDefault: vi.fn() }); });
  const toggle = () => act(() => { byData('data-project-task-defaults-toggle').props.onClick(); });
  const title = (value) => act(() => { r.findAll((n) => n.type === 'input')[0].props.onChange({ target: { value } }); });
  return { byData, type, submit, toggle, title };
}

const fitness = { id: 'p-fit', title: 'Fitness', status: 'active', taskDefaults: { duration: 45, tags: ['health'], notes: 'Goal:', subtasks: ['Warm up', 'Stretch'] } };

describe('ProjectForm: New task defaults', () => {
  it('folded on a new project, and a project saved without any carries none', async () => {
    const onSave = vi.fn();
    const f = await renderForm({ onSave });
    expect(f.byData('data-project-task-defaults-duration')).toBeUndefined();
    f.title('Roof');
    f.submit();
    expect(onSave.mock.calls[0][0].taskDefaults).toBeUndefined();
  });

  it('saves what is filled in, cleaned', async () => {
    const onSave = vi.fn();
    const f = await renderForm({ onSave });
    f.title('Fitness');
    f.toggle();
    f.type('data-project-task-defaults-duration', '45');
    f.type('data-project-task-defaults-tags', '#health, cardio #health');
    f.type('data-project-task-defaults-notes', 'Goal:\nResult:');
    f.type('data-project-task-defaults-subtasks', 'Warm up\n\nStretch\n');
    f.submit();
    expect(onSave.mock.calls[0][0].taskDefaults).toEqual({
      duration: 45, tags: ['health', 'cardio'], notes: 'Goal:\nResult:', subtasks: ['Warm up', 'Stretch'],
    });
  });

  it('opens on a project that has some, filled in, and clearing them all removes the field', async () => {
    const onSave = vi.fn();
    const f = await renderForm({ initial: fitness, onSave }, [fitness]);
    expect(f.byData('data-project-task-defaults-duration').props.value).toBe('45');
    expect(f.byData('data-project-task-defaults-tags').props.value).toBe('#health');
    expect(f.byData('data-project-task-defaults-subtasks').props.value).toBe('Warm up\nStretch');
    for (const field of ['duration', 'tags', 'notes', 'subtasks']) f.type(`data-project-task-defaults-${field}`, '');
    f.submit();
    expect(onSave.mock.calls[0][0]).toHaveProperty('taskDefaults', undefined);
  });

  it('copies another project\'s defaults, offering only projects that have some, and not itself', async () => {
    const onSave = vi.fn();
    const plain = { id: 'p-plain', title: 'Plain', status: 'active' };
    const self = { id: 'p-new', title: 'Running', status: 'active', taskDefaults: { duration: 10 } };
    const f = await renderForm({ initial: self, onSave }, [fitness, plain, self]);
    const select = f.byData('data-project-task-defaults-copy');
    const offered = select.findAll((n) => n.type === 'option').map((o) => o.props.value).filter(Boolean);
    expect(offered).toEqual(['p-fit']);
    act(() => { select.props.onChange({ target: { value: 'p-fit' } }); });
    f.submit();
    expect(onSave.mock.calls[0][0].taskDefaults).toEqual(fitness.taskDefaults);
  });
});
