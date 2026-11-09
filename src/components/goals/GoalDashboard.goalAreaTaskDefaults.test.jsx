import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../../locales.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import { SyncContext } from '../../context/SyncContext.jsx';
import { AreaTaskDefaults, GoalForm, ManageAreas, ProjectForm } from './GoalDashboard.jsx';

// #2336, option 1: a goal and an area hold New task defaults for NEW
// projects. The real forms: the project form seeds a new project from its
// goal (else the goal's area) and follows the goal picker while untouched;
// the goal and area forms save their defaults and offer "Apply to open
// projects", which asks, then saves with the apply.

const planner = {
  tasks: [], unscheduledTasks: [], isMobile: false, isTablet: false, darkMode: false, use24HourClock: false,
  cardBg: '', borderClass: '', textPrimary: '', textSecondary: '', hoverBg: '',
};
const areas = [{ id: 'a1', name: 'Life', taskDefaults: { energy: 'restore', notes: 'Why:' } }];
const goals = [
  { id: 'g1', title: 'Health', status: 'active', areaId: 'a1', taskDefaults: { duration: 45 } },
  { id: 'g2', title: 'Work', status: 'active' },
];
const projects = [
  { id: 'p1', title: 'Run', status: 'active', goalId: 'g1' },
  { id: 'p2', title: 'Swim', status: 'on-hold', goalId: 'g1' },
  { id: 'p3', title: 'Old', status: 'completed', goalId: 'g1' },
];

async function render(element, features = {}) {
  const bundle = await loaders.en();
  const i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  let root;
  await act(async () => {
    root = create(
      <I18nextProvider i18n={i18n}>
        <DayPlannerContext.Provider value={planner}>
          <FeaturesContext.Provider value={{ multiUserEnabled: false, users: [], goals, projects, areas, ...features }}>
            <SyncContext.Provider value={{ obsidianConfig: { enabled: false } }}>
              {element}
            </SyncContext.Provider>
          </FeaturesContext.Provider>
        </DayPlannerContext.Provider>
      </I18nextProvider>,
    );
  });
  const r = root.root;
  const byData = (attr) => r.findAll((n) => typeof n.type === 'string' && n.props[attr] !== undefined)[0];
  return {
    r,
    byData,
    type: (attr, value) => act(() => { byData(attr).props.onChange({ target: { value } }); }),
    click: (attr) => act(() => { byData(attr).props.onClick(); }),
    submit: () => act(() => { r.find((n) => n.type === 'form').props.onSubmit({ preventDefault: vi.fn() }); }),
    title: (value) => act(() => { r.findAll((n) => n.type === 'input')[0].props.onChange({ target: { value } }); }),
    goalSelect: () => r.findAll((n) => n.type === 'select').find((s) => s.findAll((o) => o.type === 'option').some((o) => o.props.value === 'g2')),
  };
}

describe('ProjectForm: a new project seeded from its goal and area', () => {
  it('starts with the goal\'s defaults, the area filling what the goal leaves out', async () => {
    const onSave = vi.fn();
    const f = await render(<ProjectForm goals={goals} defaultGoalId="g1" onSave={onSave} onCancel={vi.fn()} />);
    expect(f.byData('data-project-task-defaults-duration').props.value).toBe('45');
    expect(f.byData('data-project-task-defaults-energy').props.value).toBe('restore');
    f.title('Cycle');
    f.submit();
    expect(onSave.mock.calls[0][0].taskDefaults).toEqual({ duration: 45, notes: 'Why:', energy: 'restore' });
  });

  // MUTATION: drop the "still as seeded" check and an edit is wiped on a goal change.
  it('follows the goal picker while untouched, and keeps what the user changed', async () => {
    const onSave = vi.fn();
    const f = await render(<ProjectForm goals={goals} defaultGoalId="g1" onSave={onSave} onCancel={vi.fn()} />);
    act(() => { f.goalSelect().props.onChange({ target: { value: 'g2' } }); });
    f.title('Plan');
    f.submit();
    expect(onSave.mock.calls[0][0].taskDefaults).toBeUndefined();

    const g = await render(<ProjectForm goals={goals} defaultGoalId="g1" onSave={vi.fn()} onCancel={vi.fn()} />);
    g.type('data-project-task-defaults-duration', '90');
    act(() => { g.goalSelect().props.onChange({ target: { value: 'g2' } }); });
    expect(g.byData('data-project-task-defaults-duration').props.value).toBe('90');
  });

  it('an existing project keeps its own, whatever its goal holds', async () => {
    const onSave = vi.fn();
    const f = await render(<ProjectForm initial={{ id: 'p1', title: 'Run', status: 'active', goalId: 'g1' }} goals={goals} onSave={onSave} onCancel={vi.fn()} />);
    f.submit();
    expect(onSave.mock.calls[0][0].taskDefaults).toBeUndefined();
  });
});

describe('GoalForm: defaults for new projects', () => {
  it('saves them, and "Apply to open projects" asks, counting active and on-hold projects, then saves with the apply', async () => {
    const onSave = vi.fn();
    const f = await render(<GoalForm initial={goals[0]} onSave={onSave} onCancel={vi.fn()} />);
    expect(f.byData('data-project-task-defaults-duration').props.value).toBe('45');
    f.type('data-project-task-defaults-duration', '30');
    expect(f.byData('data-apply-task-defaults').children.join('')).toContain('(2)');
    f.click('data-apply-task-defaults');
    expect(onSave).not.toHaveBeenCalled();
    f.click('data-apply-task-defaults-save');
    expect(onSave.mock.calls[0][0]).toMatchObject({ taskDefaults: { duration: 30 }, applyToProjects: true, areaId: 'a1' });
  });

  it('a plain save does not apply, and a goal with no open project offers no apply', async () => {
    const onSave = vi.fn();
    const f = await render(<GoalForm initial={goals[0]} onSave={onSave} onCancel={vi.fn()} />);
    f.submit();
    expect(onSave.mock.calls[0][0]).toMatchObject({ applyToProjects: false });
    const g = await render(<GoalForm initial={goals[1]} onSave={vi.fn()} onCancel={vi.fn()} />);
    g.click('data-project-task-defaults-toggle');
    expect(g.byData('data-apply-task-defaults')).toBeUndefined();
  });
});

describe('Manage Areas: an area\'s defaults for new projects in its goals', () => {
  const ctx = (over = {}) => ({ updateArea: vi.fn(), applyTaskDefaultsToProjects: vi.fn(), addArea: vi.fn(), deleteArea: vi.fn(), reorderAreas: vi.fn(), ...over });

  it('every area row in the dialog has them', async () => {
    const f = await render(<ManageAreas onClose={vi.fn()} />, ctx());
    expect(f.byData('data-area-task-defaults')?.props['data-area-task-defaults']).toBe('a1');
  });

  it('saved with their own button, only once changed; the area is not written while typing', async () => {
    const c = ctx();
    const f = await render(<AreaTaskDefaults area={areas[0]} />, c);
    expect(f.byData('data-area-task-defaults-save')).toBeUndefined();
    f.type('data-project-task-defaults-energy', 'effort');
    expect(c.updateArea).not.toHaveBeenCalled();
    f.click('data-area-task-defaults-save');
    expect(c.updateArea).toHaveBeenCalledWith('a1', { taskDefaults: { notes: 'Why:', energy: 'effort' } });
    expect(c.applyTaskDefaultsToProjects).not.toHaveBeenCalled();
  });

  it('"Apply to open projects" counts the open projects in the area\'s goals, asks, then saves and applies', async () => {
    const c = ctx();
    const f = await render(<AreaTaskDefaults area={areas[0]} />, c);
    expect(f.byData('data-apply-task-defaults').children.join('')).toContain('(2)');
    f.type('data-project-task-defaults-notes', 'Purpose:');
    f.click('data-apply-task-defaults');
    expect(c.updateArea).not.toHaveBeenCalled();
    f.click('data-apply-task-defaults-save');
    expect(c.updateArea).toHaveBeenCalledWith('a1', { taskDefaults: { notes: 'Purpose:', energy: 'restore' } });
    expect(c.applyTaskDefaultsToProjects).toHaveBeenCalledWith({ scope: 'area', id: 'a1', defaults: { notes: 'Purpose:', energy: 'restore' } });
  });
});
